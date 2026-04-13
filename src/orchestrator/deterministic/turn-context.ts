/**
 * TurnContext Computation — Layer 0
 *
 * Computes a canonical DeterministicTurnContext per turn from graph, analysis,
 * and conversation data. Pure function, no async, no side effects.
 *
 * Replaces Zone 2 assembly for the deterministic pipeline.
 */

import type { OrchestratorTurnRequest, V2RunResponseEnvelope, DecisionStage } from "../types.js";
import type { GraphV3T, NodeV3T } from "../../schemas/cee-v3.js";
import type {
  DeterministicTurnContext,
  DisambiguationHint,
  EntityRegistry,
  EntityEntry,
  EdgeEntry,
  GraphSummary,
  AnalysisSummary,
  DriverSummary,
  TurnCapabilities,
  Blocker,
  TurnSignals,
  ConversationSummary,
} from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_NAMES } from "./actions/types.js";
import { inferStage } from "../pipeline/phase1-enrichment/stage-inference.js";
import { DEFAULT_EXISTS_PROBABILITY } from "../context/constants.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

/** Winner margin threshold for close_call signal (5 percentage points). */
const CLOSE_CALL_THRESHOLD = 0.05;

/** Sensitivity ratio threshold for dominant_factor signal. */
const DOMINANT_FACTOR_RATIO = 2.0;

/** Edge strength threshold for weak_edges signal. */
const WEAK_EDGE_THRESHOLD = 0.3;

// ============================================================================
// Stage → ActionName mapping (extends tool-based stage policy)
// ============================================================================

// generate_artefact excluded: permanently blocked by prerequisite. Re-add when artefact pipeline is implemented.
const STAGE_ACTION_POLICY: Record<DecisionStage, ReadonlySet<ActionName>> = {
  frame: new Set<ActionName>(['set_factor_value', 'add_factor', 'set_goal_target', 'add_constraint']),
  ideate: new Set<ActionName>(['set_factor_value', 'add_constraint', 'add_factor', 'adjust_edge_strength', 'add_option', 'remove_factor', 'set_goal_target']),
  evaluate: new Set<ActionName>(['run_analysis', 'explain_result', 'compare_options', 'challenge_assumption', 'run_premortem', 'what_would_flip', 'set_factor_value', 'adjust_edge_strength', 'add_constraint']),
  decide: new Set<ActionName>(['explain_result', 'compare_options', 'what_would_flip', 'challenge_assumption', 'run_premortem']),
  optimise: new Set<ActionName>(['set_factor_value', 'adjust_edge_strength', 'add_constraint', 'run_analysis', 'explain_result', 'compare_options', 'challenge_assumption', 'run_premortem', 'what_would_flip']),
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute the canonical TurnContext from a turn request.
 * Pure function — deterministic, synchronous, no side effects.
 */
export function computeTurnContext(turnRequest: OrchestratorTurnRequest): DeterministicTurnContext {
  const ctx = turnRequest.context;
  const graph = ctx.graph ?? turnRequest.graph_state ?? null;
  const analysis = ctx.analysis_response ?? turnRequest.analysis_state ?? null;
  const analysisInputs = ctx.analysis_inputs ?? null;

  // ── Phase A: graph + conversation (no analysis dependency) ──────────

  // Stage inference
  const stageResult = inferStage(ctx, turnRequest.system_event);
  const stage: DecisionStage = stageResult?.stage ?? 'frame';

  // Build entity registry
  const entities = buildEntityRegistry(graph);

  // Graph summary
  const graphSummary = computeGraphSummary(graph, entities);

  // Conversation summary
  const conversation = computeConversationSummary(turnRequest);

  // Disambiguation hints
  const disambiguationHints = computeDisambiguationHints(turnRequest.message, entities);

  // Currency hint from raw user message — honoured by set_factor_value when
  // the LLM's tool params omit `unit`. See detectCurrencyInMessage below.
  const userCurrencyHint = detectCurrencyInMessage(turnRequest.message);

  // ── Phase B: analysis-derived (may fail on malformed analysis_state) ─

  let analysisSummary: AnalysisSummary | null = null;
  let capabilities: TurnCapabilities;
  let blockers: Blocker[];
  let signals: TurnSignals;

  try {
    analysisSummary = computeAnalysisSummary(analysis);
    capabilities = computeCapabilities(graph, analysis);
    blockers = computeBlockers(graph, analysis, capabilities);
    signals = computeSignals(graph, analysis, entities);
  } catch (error) {
    log.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'turn_context.phase_b_fallback: analysis-derived computation failed, preserving graph and conversation state',
    );
    // Safe fallback: graph present but analysis unusable
    const hasGraph = graph != null && Array.isArray(graph.nodes) && graph.nodes.length > 0;
    const hasOptions = hasGraph && (graph!.nodes?.some((n: NodeV3T) => n.kind === 'option') ?? false);
    capabilities = {
      can_run_analysis: hasGraph && hasOptions,
      can_explain_results: false,
      can_edit_graph: hasGraph,
      can_compare_options: false,
      can_challenge: false,
      can_generate_artefact: false,
    };
    blockers = computeBlockers(graph, null, capabilities);
    // Compute graph-derived signals (uncertainty, weak edges) without analysis
    signals = computeSignals(graph, null, entities);
  }

  // Eligible actions (uses Phase A + Phase B results)
  const eligibleActions = computeEligibleActions(stage, capabilities, blockers, conversation.recent_actions_taken);

  return {
    stage,
    entities,
    graph_summary: graphSummary,
    analysis_summary: analysisSummary,
    capabilities,
    blockers,
    signals,
    conversation,
    eligible_actions: eligibleActions,
    disambiguation_hints: disambiguationHints,
    graph,
    analysis,
    conversational_state: ctx.conversational_state ?? null,
    scenario_id: ctx.scenario_id,
    turn_id: '', // Set by pipeline after context computation
    analysis_inputs: analysisInputs,
    user_currency_hint: userCurrencyHint,
  };
}

// ============================================================================
// Currency detection from user message
// ============================================================================

/**
 * Detect a currency the user mentioned explicitly in their message.
 * Returns a canonical code ("USD", "GBP", ...) or null when no currency
 * is detectable.
 *
 * Rules (precedence):
 *   1. Explicit symbol attached to a number ($100, £100, €100, ¥100, ₹100)
 *   2. Symbol anywhere in the message
 *   3. Uppercase 3-letter ISO code (USD, GBP, EUR, JPY, INR)
 *   4. null
 *
 * Set_factor_value reads this via `ctx.user_currency_hint` and treats it as
 * higher-precedence than the graph node's stored unit — the brief says we
 * must not silently override the user's stated currency with the graph's
 * default.
 */
export function detectCurrencyInMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = message;

  const symbolToCode: Record<string, string> = {
    '$': 'USD',
    '£': 'GBP',
    '€': 'EUR',
    '¥': 'JPY',
    '₹': 'INR',
  };

  // Prefer a symbol directly attached to a number, e.g. "$100,000".
  const attached = text.match(/([$£€¥₹])\s?-?\s?\d/);
  if (attached) {
    return symbolToCode[attached[1]] ?? null;
  }

  // Fall through to bare symbol anywhere.
  const bare = text.match(/[$£€¥₹]/);
  if (bare) {
    return symbolToCode[bare[0]] ?? null;
  }

  // ISO codes — require word boundaries to avoid matching fragments inside
  // larger words ("USDA", "EURASIA" etc.).
  const iso = text.match(/\b(USD|GBP|EUR|JPY|INR|CAD|AUD|CHF|CNY|SEK|NOK|DKK|NZD)\b/);
  if (iso) return iso[1];

  return null;
}

// ============================================================================
// Entity Registry Builder
// ============================================================================

export function buildEntityRegistry(graph: GraphV3T | null): EntityRegistry {
  const nodes = new Map<string, EntityEntry>();
  const edges: EdgeEntry[] = [];
  const optionIds: string[] = [];
  let goalId: string | null = null;

  if (!graph) {
    return { nodes, edges, option_ids: optionIds, goal_id: null };
  }

  // Build node entries
  for (const node of graph.nodes ?? []) {
    const entry: EntityEntry = {
      id: node.id,
      label: node.label ?? node.id,
      kind: node.kind,
      aliases: buildAliases(node),
      category: (node as Record<string, unknown>).category as string | undefined,
      is_action_target: node.kind !== 'decision',
    };

    // Factor-specific fields
    const observed = (node as Record<string, unknown>).observed_state as Record<string, unknown> | undefined;
    if (observed) {
      if (typeof observed.value === 'number') entry.value = observed.value;
      if (typeof observed.unit === 'string') entry.unit = observed.unit;
      if (typeof observed.cap === 'number') entry.cap = observed.cap;
    }

    nodes.set(node.id, entry);

    if (node.kind === 'option') optionIds.push(node.id);
    if (node.kind === 'goal') goalId = node.id;
  }

  // Build edge entries
  for (const edge of graph.edges ?? []) {
    const fromEntry = nodes.get(edge.from);
    const toEntry = nodes.get(edge.to);
    edges.push({
      from: edge.from,
      to: edge.to,
      from_label: fromEntry?.label ?? edge.from,
      to_label: toEntry?.label ?? edge.to,
      strength_mean: edge.strength?.mean ?? 0,
      strength_std: edge.strength?.std ?? 0,
      exists_probability: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
      effect_direction: edge.effect_direction as 'positive' | 'negative' | undefined,
    });
  }

  return { nodes, edges, option_ids: optionIds, goal_id: goalId };
}

// ============================================================================
// Graph Summary
// ============================================================================

function computeGraphSummary(graph: GraphV3T | null, entities: EntityRegistry): GraphSummary {
  if (!graph) {
    return {
      node_count: 0,
      edge_count: 0,
      option_count: 0,
      option_labels: [],
      goal_label: null,
      missing_structural: ['no goal node'],
    };
  }

  const optionLabels = entities.option_ids
    .map((id) => entities.nodes.get(id)?.label ?? id);

  // Check for structural issues
  const issues: string[] = [];
  const goalId = entities.goal_id;

  if (!goalId) {
    issues.push('no goal node');
  }

  // Check constraints on goal
  if (goalId) {
    const goalNode = graph.nodes?.find((n) => n.id === goalId);
    const constraints = (goalNode as Record<string, unknown> | undefined)?.goal_constraints;
    if (!constraints || (Array.isArray(constraints) && constraints.length === 0)) {
      issues.push('no constraints');
    }
  }

  // Check for external factors
  const hasExternal = [...entities.nodes.values()].some(
    (n) => n.kind === 'factor' && n.category === 'external',
  );
  if (!hasExternal) {
    issues.push('no external factors');
  }

  // Check each option has a path to goal
  if (goalId && entities.option_ids.length > 0) {
    for (const optId of entities.option_ids) {
      const hasEdgeToGoal = entities.edges.some(
        (e) => (e.from === optId && e.to === goalId) || (e.to === optId && e.from === goalId),
      );
      if (!hasEdgeToGoal) {
        const label = entities.nodes.get(optId)?.label ?? optId;
        issues.push(`option ${label} has no path to goal`);
      }
    }
  }

  return {
    node_count: graph.nodes?.length ?? 0,
    edge_count: graph.edges?.length ?? 0,
    option_count: entities.option_ids.length,
    option_labels: optionLabels,
    goal_label: goalId ? (entities.nodes.get(goalId)?.label ?? null) : null,
    missing_structural: issues,
  };
}

// ============================================================================
// Analysis Summary
// ============================================================================

// ============================================================================
// Robustness Band Mapping
// ============================================================================

/** Canonical robustness band vocabulary. */
export type CanonicalRobustnessBand = 'fragile' | 'moderate' | 'stable' | 'highly_stable';

const ISL_ROBUSTNESS_MAP: Record<string, CanonicalRobustnessBand> = {
  very_low: 'fragile',
  low: 'fragile',
  medium: 'moderate',
  high: 'stable',
  very_high: 'highly_stable',
  robust: 'highly_stable',
  // Already canonical — pass through
  fragile: 'fragile',
  moderate: 'moderate',
  stable: 'stable',
  highly_stable: 'highly_stable',
};

/**
 * Map an ISL robustness band value to the canonical vocabulary.
 * Logs a warning for unmapped values and defaults to 'moderate'.
 */
export function mapRobustnessBand(raw: string | null): CanonicalRobustnessBand | null {
  if (raw == null) return null;
  const normalised = raw.toLowerCase().trim();
  const mapped = ISL_ROBUSTNESS_MAP[normalised];
  if (mapped) return mapped;
  log.warn({ raw_robustness_band: raw }, 'deterministic.unknown_robustness_band');
  return 'moderate';
}

// ============================================================================
// Analysis Field Resolution Helpers
// ============================================================================

/**
 * Resolve the driver/sensitivity source from the analysis envelope.
 * The UI may send this data in several locations:
 *  1. factor_sensitivity (canonical PLoT field)
 *  2. drivers (plain array)
 *  3. drivers.top_drivers (object with nested array)
 *  4. top_drivers (envelope root)
 *  5. compact_summary.top_drivers (compact analysis)
 */
function resolveDriverSource(analysis: V2RunResponseEnvelope): unknown[] | null {
  if (Array.isArray(analysis.factor_sensitivity) && analysis.factor_sensitivity.length > 0) {
    return analysis.factor_sensitivity;
  }
  const r = analysis as Record<string, unknown>;
  // drivers may be an object { top_drivers: [...] } or a plain array
  const drivers = r.drivers;
  if (Array.isArray(drivers) && drivers.length > 0) {
    return drivers;
  }
  if (drivers && typeof drivers === 'object' && !Array.isArray(drivers)) {
    const nested = (drivers as Record<string, unknown>).top_drivers;
    if (Array.isArray(nested) && nested.length > 0) return nested;
  }
  // top_drivers at envelope root
  const topDrivers = r.top_drivers;
  if (Array.isArray(topDrivers) && topDrivers.length > 0) {
    return topDrivers;
  }
  const compact = r.compact_summary as Record<string, unknown> | undefined;
  if (compact && Array.isArray(compact.top_drivers) && compact.top_drivers.length > 0) {
    return compact.top_drivers;
  }
  return null;
}

/**
 * Resolve the robustness level string from the analysis envelope.
 * Checks robustness.level first, then compact_summary.robustness.level.
 */
function resolveRobustnessLevel(analysis: V2RunResponseEnvelope): string | null {
  if (typeof analysis.robustness?.level === 'string') {
    return analysis.robustness.level;
  }
  const r = analysis as Record<string, unknown>;
  const compact = r.compact_summary as Record<string, unknown> | undefined;
  const compactRobustness = compact?.robustness as Record<string, unknown> | undefined;
  if (typeof compactRobustness?.level === 'string') {
    return compactRobustness.level;
  }
  return null;
}

// ============================================================================
// Analysis Summary
// ============================================================================

function computeAnalysisSummary(analysis: V2RunResponseEnvelope | null): AnalysisSummary | null {
  if (!analysis || !analysis.results || !Array.isArray(analysis.results) || analysis.results.length === 0) {
    return null;
  }

  // Extract option results sorted by win probability
  const results = (analysis.results as Array<Record<string, unknown>>)
    .filter((r) => typeof r.win_probability === 'number')
    .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

  const winner = results[0] ?? null;
  const runnerUp = results[1] ?? null;

  // Extract top drivers from factor_sensitivity, or fallback to top-level
  // drivers/compact_summary fields the UI may send instead.
  const topDrivers: DriverSummary[] = [];
  const driverSource = resolveDriverSource(analysis);
  if (driverSource) {
    for (const fs of driverSource) {
      const entry = fs as Record<string, unknown>;
      const label = pickString(entry.label) ?? pickString(entry.factor_label);
      // Magnitude source preference: elasticity → sensitivity → influence_percent.
      // The UI forwards factor_sensitivity with only `influence_percent` (no
      // elasticity or sensitivity), and before this change those entries were
      // silently dropped — leaving top_drivers empty and forcing every
      // post-analysis handler (explain_result, compare_options, what_would_flip)
      // into its zero-drivers fallback branch. Mirrors the dominant_factor
      // computation below (lines ~750), which already accepted influence_percent.
      //
      // Uses pickFiniteNumber throughout so malformed inputs (strings,
      // NaN, Infinity) are rejected rather than silently coerced.
      const elasticity = pickFiniteNumber(entry.elasticity);
      const sensitivity = pickFiniteNumber(entry.sensitivity);
      const influencePercent = pickFiniteNumber(entry.influence_percent);
      const mag = elasticity != null
        ? Math.abs(elasticity)
        : sensitivity != null
          ? Math.abs(sensitivity)
          : influencePercent != null
            ? Math.abs(influencePercent)
            : null;
      if (label != null && mag != null) {
        topDrivers.push({
          label,
          factor_id: pickString(entry.factor_id) ?? label,
          sensitivity: mag,
          direction: pickString(entry.direction) ?? 'unknown',
        });
      }
    }
    topDrivers.sort((a, b) => b.sensitivity - a.sensitivity);
  }

  // Fragile edges — count and labelled details.
  // `fragile_edge_count` mirrors the raw upstream array length so existing
  // call-sites that count "edges in the model" stay correct. The detailed
  // `fragile_edges` array can be shorter because we drop entries without a
  // finite switch_probability and cap at 5.
  const fragileEdgesRaw = Array.isArray(analysis.robustness?.fragile_edges)
    ? (analysis.robustness!.fragile_edges as Array<Record<string, unknown>>)
    : [];
  const fragileEdgeCount = fragileEdgesRaw.length;
  const fragileEdges: import("./types.js").FragileEdgeSummary[] = fragileEdgesRaw
    .map((e) => {
      const label = pickEdgeLabel(e) ?? 'unlabelled edge';
      const sp = pickFiniteNumber(e.switch_probability) ?? pickFiniteNumber(e.marginal_switch_probability);
      return sp != null ? { label, switch_probability: sp } : null;
    })
    .filter((x): x is import("./types.js").FragileEdgeSummary => x != null)
    .sort((a, b) => b.switch_probability - a.switch_probability)
    .slice(0, 5);

  // factor_sensitivity — forwarded by the UI as a top-level field on analysis_state.
  // Accept either canonical (importance_rank, elasticity) or UI-forwarded names
  // (influence_rank, influence_percent) and either confidence/confidence_band naming.
  const factorSensitivityRaw = extractAnalysisArray(analysis, 'factor_sensitivity');
  const factorSensitivity: import("./types.js").FactorSensitivitySummary[] = factorSensitivityRaw
    .map((f) => {
      const label = pickString(f.factor_label) ?? pickString(f.label);
      if (!label) return null;
      const rank = pickFiniteNumber(f.influence_rank) ?? pickFiniteNumber(f.importance_rank);
      const elasticity = pickFiniteNumber(f.elasticity);
      const influencePercent = pickFiniteNumber(f.influence_percent)
        ?? (elasticity != null ? Math.abs(elasticity) * 100 : null);
      const confidenceBand = pickString(f.confidence_band) ?? pickString(f.confidence);
      return { label, influence_percent: influencePercent, confidence_band: confidenceBand, influence_rank: rank };
    })
    .filter((x): x is import("./types.js").FactorSensitivitySummary => x != null)
    .sort((a, b) => {
      const ra = a.influence_rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.influence_rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    })
    .slice(0, 5);

  // edge_e_values — nested under analysis.robustness.edge_e_values
  const edgeEValuesRaw = extractAnalysisArray(analysis, 'edge_e_values');
  const edgeEValuesParsed = edgeEValuesRaw
    .map((e) => {
      const label = pickEdgeLabel(e);
      const eValue = pickFiniteNumber(e.e_value);
      return label != null && eValue != null ? { label, e_value: eValue } : null;
    })
    .filter((x): x is { label: string; e_value: number } => x != null);
  // Convention: lower e_value → more fragile, higher e_value → more robust.
  // Take top 2 most fragile + top 1 most robust. Avoid double-counting when
  // the most-robust pick overlaps the fragile slice (length === 3 boundary).
  const sortedAsc = [...edgeEValuesParsed].sort((a, b) => a.e_value - b.e_value);
  const edgeEValues: import("./types.js").EdgeEValueSummary[] = [];
  const fragileSliceCount = Math.min(2, sortedAsc.length);
  for (let i = 0; i < fragileSliceCount; i++) {
    edgeEValues.push({ ...sortedAsc[i], fragile: true });
  }
  if (sortedAsc.length > fragileSliceCount) {
    const mostRobust = sortedAsc[sortedAsc.length - 1];
    edgeEValues.push({ ...mostRobust, fragile: false });
  }

  // conditional_winners — nested under analysis.robustness.conditional_winners
  const conditionalWinnersRaw = extractAnalysisArray(analysis, 'conditional_winners');
  const conditionalWinners: import("./types.js").ConditionalWinnerSummary[] = conditionalWinnersRaw
    .map((c) => {
      const scenario = pickString(c.scenario) ?? pickString(c.factor_label) ?? pickString(c.label);
      const winnerLabel = pickString(c.winner_label) ?? pickString(c.alternative_winner_label);
      if (!scenario || !winnerLabel) return null;
      const probability = pickFiniteNumber(c.probability);
      return { scenario, winner_label: winnerLabel, probability };
    })
    .filter((x): x is import("./types.js").ConditionalWinnerSummary => x != null)
    .slice(0, 5);

  // inference_warnings — nested under analysis.robustness.inference_warnings
  const inferenceWarningsRaw = extractAnalysisArray(analysis, 'inference_warnings');
  const inferenceWarnings: string[] = inferenceWarningsRaw
    .map((w) => pickString(w.message) ?? pickString(w.code))
    .filter((x): x is string => x != null && x.length > 0)
    .slice(0, 5);

  // Constraints
  let constraintsMet: boolean | null = null;
  const constraintTensions: string[] = [];
  if (analysis.constraint_analysis) {
    const ca = analysis.constraint_analysis;
    if (Array.isArray(ca.per_constraint)) {
      const violated = (ca.per_constraint as Array<Record<string, unknown>>)
        .filter((c) => typeof c.probability === 'number' && (c.probability as number) < 0.5);
      constraintsMet = violated.length === 0;
      for (const v of violated) {
        constraintTensions.push(
          `${v.label ?? v.constraint_id ?? 'constraint'}: ${((v.probability as number) * 100).toFixed(0)}% met`,
        );
      }
    }
    // Joint probability tension check
    if (typeof ca.joint_probability === 'number' && Array.isArray(ca.per_constraint)) {
      const individualProbs = (ca.per_constraint as Array<Record<string, unknown>>)
        .filter((c) => typeof c.probability === 'number')
        .map((c) => c.probability as number);
      if (individualProbs.length > 0) {
        const minIndividual = Math.min(...individualProbs);
        if (ca.joint_probability < minIndividual * 0.7) {
          constraintTensions.push('Constraints are in tension (joint probability significantly below individual)');
        }
      }
    }
  }

  return {
    winner: winner ? (winner.option_label as string) ?? null : null,
    winner_probability: winner ? (winner.win_probability as number) ?? null : null,
    runner_up: runnerUp ? (runnerUp.option_label as string) ?? null : null,
    runner_up_probability: runnerUp ? (runnerUp.win_probability as number) ?? null : null,
    robustness_band: mapRobustnessBand(resolveRobustnessLevel(analysis)),
    top_drivers: topDrivers.slice(0, 5),
    fragile_edge_count: fragileEdgeCount,
    fragile_edges: fragileEdges,
    factor_sensitivity: factorSensitivity,
    edge_e_values: edgeEValues,
    conditional_winners: conditionalWinners,
    inference_warnings: inferenceWarnings,
    constraints_met: constraintsMet,
    constraint_tensions: constraintTensions,
  };
}

/**
 * Defensive narrowing helpers for analysis-payload field extraction.
 *
 * Upstream PLoT/ISL payloads are typed loosely (Record<string, unknown>) and
 * have to be parsed defensively. We accept finite numbers only (no NaN, no
 * Infinity, no string-numbers) and non-empty strings only. Anything else
 * returns null so the caller can fall back or skip the entry.
 */
function pickFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Build a human-readable edge label from the typical edge-shape fields PLoT
 * sends. Prefers `from_label → to_label`, falls back to `edge_id`, returns
 * null when neither is usable.
 */
function pickEdgeLabel(edge: Record<string, unknown>): string | null {
  const fromLabel = pickString(edge.from_label);
  const toLabel = pickString(edge.to_label);
  if (fromLabel && toLabel) return `${fromLabel} → ${toLabel}`;
  return pickString(edge.edge_id);
}

/**
 * Extract an array field from the analysis envelope, walking the common nested
 * shapes the UI / PLoT may use:
 *   1. analysis[field] (top-level)
 *   2. analysis.results[field] (single-result object)
 *   3. analysis.results[0][field] (results array)
 *   4. analysis.robustness[field] (nested under robustness — primary location for
 *      edge_e_values, conditional_winners, inference_warnings per the UI fix)
 *   5. analysis.robustness_synthesis[field]
 *
 * Mirrors the helper in phase1-enrichment/index.ts to keep the deterministic
 * pipeline self-contained.
 */
function extractAnalysisArray(analysis: V2RunResponseEnvelope, field: string): Array<Record<string, unknown>> {
  const a = analysis as Record<string, unknown>;
  if (Array.isArray(a[field])) return a[field] as Array<Record<string, unknown>>;
  const results = a.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    const nested = (results as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
  }
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as Record<string, unknown>;
    if (Array.isArray(first?.[field])) return first[field] as Array<Record<string, unknown>>;
  }
  const robustness = a.robustness;
  if (robustness && typeof robustness === 'object') {
    const nested = (robustness as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
  }
  const synth = a.robustness_synthesis;
  if (synth && typeof synth === 'object') {
    const nested = (synth as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
  }
  return [];
}

// ============================================================================
// Capabilities
// ============================================================================

function computeCapabilities(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
): TurnCapabilities {
  const hasGraph = graph != null && Array.isArray(graph.nodes) && graph.nodes.length > 0;
  const hasAnalysis = analysis != null && Array.isArray(analysis.results) && analysis.results.length > 0;
  const hasOptions = hasGraph && (graph!.nodes?.some((n: NodeV3T) => n.kind === 'option') ?? false);

  return {
    can_run_analysis: hasGraph && hasOptions,
    can_explain_results: hasAnalysis,
    can_edit_graph: hasGraph,
    can_compare_options: hasAnalysis && hasOptions,
    can_challenge: hasAnalysis,
    can_generate_artefact: hasGraph && hasAnalysis,
  };
}

// ============================================================================
// Blockers
// ============================================================================

function computeBlockers(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
  capabilities: TurnCapabilities,
): Blocker[] {
  const blockers: Blocker[] = [];

  if (!capabilities.can_run_analysis) {
    if (!graph) {
      blockers.push({
        action_type: 'run_analysis',
        reason: 'No decision model available. Draft a model first.',
        suggested_action_type: undefined,
      });
    } else {
      blockers.push({
        action_type: 'run_analysis',
        reason: 'Model needs at least one option before analysis can run.',
        suggested_action_type: 'add_option',
      });
    }
  }

  if (!capabilities.can_explain_results) {
    blockers.push({
      action_type: 'explain_result',
      reason: 'No analysis results available. Run analysis first.',
      suggested_action_type: 'run_analysis',
    });
  }

  if (!capabilities.can_compare_options) {
    if (!analysis) {
      blockers.push({
        action_type: 'compare_options',
        reason: 'No analysis results available. Run analysis first.',
        suggested_action_type: 'run_analysis',
      });
    }
  }

  // Check for goal node
  if (graph && !graph.nodes?.some((n: NodeV3T) => n.kind === 'goal')) {
    blockers.push({
      action_type: 'set_goal_target',
      reason: 'No goal node in the model.',
    });
  }

  return blockers;
}

// ============================================================================
// Signals
// ============================================================================

function computeSignals(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
  entities: EntityRegistry,
): TurnSignals {
  const highUncertaintyFactors: string[] = [];
  let defaultValueCount = 0;
  const weakEdges: string[] = [];

  if (graph) {
    // Scan nodes for uncertainty and defaults
    for (const node of graph.nodes ?? []) {
      if (node.kind !== 'factor') continue;
      const observed = (node as Record<string, unknown>).observed_state as Record<string, unknown> | undefined;
      if (!observed) continue;

      const extractionType = observed.extractionType as string | undefined;
      const uncertaintyDrivers = observed.uncertainty_drivers as string[] | undefined;

      if (extractionType === 'inferred' || (Array.isArray(uncertaintyDrivers) && uncertaintyDrivers.length >= 2)) {
        highUncertaintyFactors.push(node.id);
      }
      if (extractionType === 'inferred') {
        defaultValueCount++;
      }
    }

    // Scan edges for weak strength
    for (const edge of entities.edges) {
      if (Math.abs(edge.strength_mean) < WEAK_EDGE_THRESHOLD) {
        weakEdges.push(`${edge.from}→${edge.to}`);
      }
    }
  }

  // Dominant factor and close call from analysis
  let dominantFactor: string | null = null;
  let closeCall = false;

  if (analysis) {
    // Close call
    const results = Array.isArray(analysis.results)
      ? analysis.results as Array<Record<string, unknown>>
      : [];
    const sorted = [...results]
      .filter((r) => typeof r.win_probability === 'number')
      .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));
    if (sorted.length >= 2) {
      const margin = (sorted[0].win_probability as number) - (sorted[1].win_probability as number);
      closeCall = margin < CLOSE_CALL_THRESHOLD;
    }

    // Dominant factor — magnitude can come from elasticity (canonical PLoT
    // shape) or influence_percent (UI-forwarded shape). Whichever is present
    // and finite, we sort by absolute magnitude and flag the leader when it
    // dominates the runner-up by DOMINANT_FACTOR_RATIO. Entries without a
    // string factor_id (or label fallback) are skipped — we'd otherwise
    // produce dominant_factor='' which is silently swallowed downstream.
    if (Array.isArray(analysis.factor_sensitivity)) {
      const sensitivities = (analysis.factor_sensitivity as Array<Record<string, unknown>>)
        .map((fs) => {
          const elasticity = pickFiniteNumber(fs.elasticity);
          const influencePercent = pickFiniteNumber(fs.influence_percent);
          const magnitude = elasticity != null
            ? Math.abs(elasticity)
            : (influencePercent != null ? Math.abs(influencePercent) : null);
          if (magnitude == null) return null;
          const factorId = pickString(fs.factor_id) ?? pickString(fs.label);
          if (factorId == null) return null;
          return { factor_id: factorId, sensitivity: magnitude };
        })
        .filter((x): x is { factor_id: string; sensitivity: number } => x != null)
        .sort((a, b) => b.sensitivity - a.sensitivity);

      if (sensitivities.length >= 2 && sensitivities[0].sensitivity > sensitivities[1].sensitivity * DOMINANT_FACTOR_RATIO) {
        dominantFactor = sensitivities[0].factor_id;
      }
    }
  }

  return {
    high_uncertainty_factors: highUncertaintyFactors,
    dominant_factor: dominantFactor,
    close_call: closeCall,
    default_value_count: defaultValueCount,
    weak_edges: weakEdges,
  };
}

// ============================================================================
// Conversation Summary
// ============================================================================

function computeConversationSummary(turnRequest: OrchestratorTurnRequest): ConversationSummary {
  const messages = turnRequest.context.messages ?? [];
  const convState = turnRequest.context.conversational_state;

  // Recent actions from messages (last 5 assistant turns)
  const recentActions: string[] = [];
  const recentDeclined: string[] = [];
  const assistantMessages = messages.filter((m) => m.role === 'assistant').slice(-5);
  for (const msg of assistantMessages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        recentActions.push(tc.name);
      }
    }
  }

  // Last user intent
  const lastUserMessage = messages.filter((m) => m.role === 'user').pop();

  // Pending confirmation
  let pendingConfirmation: string | null = null;
  if (convState?.pending_proposal) {
    pendingConfirmation = convState.pending_proposal.tool;
  } else if (convState?.pending_clarification) {
    pendingConfirmation = convState.pending_clarification.tool;
  }

  return {
    turn_count: messages.length,
    last_user_intent: lastUserMessage?.content?.slice(0, 200) ?? null,
    recent_actions_taken: recentActions,
    recent_actions_declined: recentDeclined,
    pending_confirmation: pendingConfirmation,
  };
}

// ============================================================================
// Eligible Actions
// ============================================================================

function computeEligibleActions(
  stage: DecisionStage,
  capabilities: TurnCapabilities,
  blockers: Blocker[],
  _recentActions: string[],
): ActionName[] {
  const stageActions = STAGE_ACTION_POLICY[stage] ?? new Set<ActionName>();
  const blockedActions = new Set(blockers.map((b) => b.action_type));

  const eligible: ActionName[] = [];

  for (const action of ACTION_NAMES) {
    // Must be in stage policy
    if (!stageActions.has(action)) continue;

    // Must not be blocked
    if (blockedActions.has(action)) continue;

    // Capability checks
    if (action === 'run_analysis' && !capabilities.can_run_analysis) continue;
    if (action === 'explain_result' && !capabilities.can_explain_results) continue;
    if (action === 'compare_options' && !capabilities.can_compare_options) continue;
    if ((action === 'challenge_assumption' || action === 'run_premortem' || action === 'what_would_flip') && !capabilities.can_challenge) continue;
    if (action === 'generate_artefact' && !capabilities.can_generate_artefact) continue;
    if ((action === 'set_factor_value' || action === 'add_factor' || action === 'adjust_edge_strength' || action === 'add_option' || action === 'remove_factor' || action === 'set_goal_target' || action === 'add_constraint') && !capabilities.can_edit_graph) continue;

    eligible.push(action);
  }

  // [P3-DIAG] Stage action policy lookup
  log.info({
    event: '[P3-DIAG] stage_action_policy',
    stage,
    stage_policy_actions: [...stageActions],
    blocked_actions: [...blockedActions],
    eligible_result: eligible,
    can_run_analysis: capabilities.can_run_analysis,
    can_edit_graph: capabilities.can_edit_graph,
    can_explain_results: capabilities.can_explain_results,
    can_compare_options: capabilities.can_compare_options,
    can_challenge: capabilities.can_challenge,
  }, '[P3-DIAG] Stage action policy');

  return eligible;
}

// ============================================================================
// Helpers
// ============================================================================

function buildAliases(node: NodeV3T): string[] {
  const aliases: string[] = [];
  const label = node.label ?? '';

  // Common abbreviations
  if (label.toLowerCase().includes('revenue')) aliases.push('rev');
  if (label.toLowerCase().includes('customer')) aliases.push('cust');
  if (label.toLowerCase().includes('acquisition')) aliases.push('acq');
  if (label.toLowerCase().includes('probability')) aliases.push('prob');

  // Split multi-word labels into individual words (3+ chars)
  const words = label.split(/[\s_-]+/).filter((w) => w.length >= 3);
  if (words.length > 1) {
    for (const word of words) {
      aliases.push(word.toLowerCase());
    }
  }

  return aliases;
}

// ============================================================================
// Disambiguation
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'my', 'this', 'that', 'it', 'to', 'for',
  'of', 'in', 'and', 'or', 'but', 'with', 'on', 'at', 'by', 'from', 'i',
  'me', 'we', 'you', 'can', 'do', 'what', 'how', 'why', 'if', 'not', 'no',
  'yes', 'so', 'up', 'all', 'would', 'could', 'should', 'will', 'be', 'been',
  'has', 'have', 'had', 'was', 'were', 'about', 'more', 'set', 'add', 'run',
  'change', 'update', 'remove', 'get', 'let', 'make', 'try', 'use', 'new',
]);

const MAX_DISAMBIGUATION_HINTS = 2;

/**
 * Proactive disambiguation: detect tokens in the user message that match
 * 2+ actionable entities. Only emits hints for ambiguous matches, not exact
 * single-entity matches.
 */
export function computeDisambiguationHints(
  message: string,
  entities: EntityRegistry,
): DisambiguationHint[] {
  if (entities.nodes.size === 0) return [];

  // Collect actionable entity labels (is_action_target: true)
  const actionableEntries: Array<{ id: string; label: string; labelLower: string }> = [];
  for (const [id, entry] of entities.nodes) {
    if (!entry.is_action_target) continue;
    actionableEntries.push({ id, label: entry.label, labelLower: entry.label.toLowerCase() });
  }
  if (actionableEntries.length < 2) return [];

  // Build set of exact labels for exclusion
  const exactLabels = new Set(actionableEntries.map((e) => e.labelLower));

  // Tokenise message
  const tokens = message
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  // Dedupe tokens
  const uniqueTokens = [...new Set(tokens)];

  const hints: DisambiguationHint[] = [];

  for (const token of uniqueTokens) {
    // Skip if token exactly matches a single entity label (unambiguous)
    if (exactLabels.has(token)) continue;

    // Find actionable entities whose label contains this token
    const matches = actionableEntries.filter((e) => e.labelLower.includes(token));

    if (matches.length >= 2) {
      hints.push({
        term: token,
        candidates: matches.map((m) => ({ id: m.id, label: m.label })),
      });
    }
  }

  // Sort by number of candidates descending, then term ascending for deterministic ordering
  hints.sort((a, b) => b.candidates.length - a.candidates.length || a.term.localeCompare(b.term));
  return hints.slice(0, MAX_DISAMBIGUATION_HINTS);
}
