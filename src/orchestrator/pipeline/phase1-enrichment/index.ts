/**
 * Phase 1: Enrichment
 *
 * Deterministic context enrichment — no LLM calls. Target: <50ms.
 *
 * Calls all sub-modules and assembles EnrichedContext:
 * - Stage inference
 * - Intent classification
 * - Archetype detection
 * - Progress tracking
 * - Stuck detection
 * - DSK loading (stub)
 * - User profile loading (stub)
 */

import { randomUUID } from "node:crypto";
import type { ConversationContext, SystemEvent } from "../types.js";
import type { EnrichedContext } from "../types.js";
import { inferStage } from "./stage-inference.js";
import { classifyUserIntent } from "./intent-classifier.js";
import { detectArchetype } from "./archetype-detector.js";
import { trackProgress } from "./progress-tracker.js";
import { detectStuck } from "./stuck-detector.js";
import { loadDSK } from "./dsk-loader.js";
import { getDskVersionHash } from "../../dsk-loader.js";
import { loadUserProfile } from "./user-profile-loader.js";
import { buildConversationalState } from "./conversational-state.js";
import { compactGraph } from "../../context/graph-compact.js";
import { compactAnalysis } from "../../context/analysis-compact.js";
import { buildEventLogSummary } from "../../context/event-log-summary.js";
import { enforceContextBudget } from "../../context/budget.js";
import type { BudgetEnforcementContext } from "../../context/budget.js";
import { computeContextHash, toHashableContext } from "../../context/context-hash.js";
import { buildDecisionContinuity } from "../../context/decision-continuity.js";
import { matchReferencedEntities } from "../../context/entity-matcher.js";
import { trackEntityStates } from "../../context/entity-state-tracker.js";
import type { GraphV3T } from "../../types.js";
import type { GapSummary, VoiRankingEntry, EdgeEValue, ConditionalWinner, InferenceWarning, PlotCritique } from "../types.js";
import { log } from "../../../utils/telemetry.js";
import { config } from "../../../config/index.js";

/** Maximum conversation turns to keep in the enriched context */
const MAX_CONVERSATION_TURNS = 5;

/**
 * Phase 1 entry point: enrich the request context.
 *
 * Deterministic. No LLM calls. No I/O (except context management utilities).
 *
 * Context management steps (added in A.4):
 * 1. compactGraph → graph_compact
 * 2. compactAnalysis → analysis_response (compact summary)
 * 3. Trim messages to last 5 turns
 * 4. buildEventLogSummary → event_log_summary
 *    (TODO: events will be populated when UI sends events or CEE reads from Supabase)
 * 5. enforceContextBudget → trim within token allocation
 * 6. computeContextHash → context_hash
 */
export function phase1Enrich(
  message: string,
  context: ConversationContext,
  scenarioId: string,
  systemEvent?: SystemEvent,
): EnrichedContext {
  const turnId = randomUUID();

  // Stage inference
  const stageIndicator = inferStage(context, systemEvent);

  // Intent classification (from user message)
  const intentClassification = classifyUserIntent(message);

  // Archetype detection (from message + framing)
  const decisionArchetype = detectArchetype(message, context.framing);

  // Progress tracking (last 5 turns)
  const progressMarkers = trackProgress(context.messages);

  // Stuck detection
  const stuck = detectStuck(context.messages, progressMarkers);

  // Conversational state
  const conversationalState = buildConversationalState(message, context, intentClassification);

  // DSK — use stub structure but overlay production hash when available
  const dsk = loadDSK();
  const productionHash = getDskVersionHash();
  if (productionHash) {
    dsk.version_hash = productionHash;
  }

  // User profile (stub)
  const userProfile = loadUserProfile();

  // ─── Context Management (A.4) ───────────────────────────────────────────

  // 1. Compact graph
  const graphCompact = context.graph
    ? compactGraph(context.graph as GraphV3T)
    : undefined;

  // 2. Compact analysis (build node label map from compact graph for driver labels)
  const nodeLabels = graphCompact
    ? new Map(graphCompact.nodes.map((n) => [n.id, n.label]))
    : undefined;
  const analysisResponseCompact = context.analysis_response
    ? compactAnalysis(context.analysis_response, nodeLabels)
    : undefined;

  // 2b. Extract ISL/PLoT enrichment fields from graph and analysis (V2)
  const islFields = extractIslFields(context.graph as GraphV3T | null, context.analysis_response, graphCompact);

  // 3. Trim messages to last 5 turns
  const trimmedMessages = context.messages.slice(-MAX_CONVERSATION_TURNS);

  // 4. Event log summary
  // events are not yet in ConversationContext — pass empty array until CEE reads from Supabase.
  // buildEventLogSummary returns "" for empty input, so event_log_summary stays undefined when empty.
  const eventLogSummaryRaw = buildEventLogSummary([]);
  const eventLogSummary: string | undefined = eventLogSummaryRaw || undefined;

  // 5. Normalise selected_elements → selected_node_ids / selected_edge_ids
  // selected_elements is a flat string[] of opaque IDs. Without separate node/edge ID
  // namespaces we treat all IDs as node IDs (matching normaliseSelectedElements convention).
  const rawSelected = context.selected_elements ?? [];
  const selectedNodeIds = [...rawSelected].sort();
  const selectedEdgeIds: string[] = [];

  // Assemble pre-budget context for enforcement
  const preBudgetContext: EnrichedContext = {
    // Scenario state
    graph: context.graph,
    analysis: context.analysis_response,
    framing: context.framing,
    conversation_history: context.messages,
    selected_elements: rawSelected,

    // Context management fields
    graph_compact: graphCompact,
    analysis_response: analysisResponseCompact ?? undefined,
    messages: trimmedMessages,
    event_log_summary: eventLogSummary,
    selected_node_ids: selectedNodeIds,
    selected_edge_ids: selectedEdgeIds,
    analysis_inputs: context.analysis_inputs,

    // ISL/PLoT enrichment fields (V2 — optional, populated when data exists)
    ...islFields,

    // Inferred state
    stage_indicator: stageIndicator,
    intent_classification: intentClassification,
    decision_archetype: decisionArchetype,
    progress_markers: progressMarkers,
    stuck,
    conversational_state: conversationalState,

    // DSK (stub)
    dsk,

    // User profile (stub)
    user_profile: userProfile,

    // System
    scenario_id: scenarioId,
    turn_id: turnId,
    system_event: systemEvent,
    user_message: message,
  };

  // 5. Enforce context budget (operates on graph_compact, analysis_response, messages)
  const budgetedContext = enforceContextBudget(
    preBudgetContext as unknown as BudgetEnforcementContext & EnrichedContext,
  ) as EnrichedContext;

  // 6. Build decision continuity (after budget enforcement — uses budgeted compact graph/analysis)
  const decisionContinuity = buildDecisionContinuity({
    framing: context.framing,
    graph_compact: budgetedContext.graph_compact,
    analysis_response: budgetedContext.analysis_response,
    graph: context.graph as Record<string, unknown> | null,
    analysis: context.analysis_response as Record<string, unknown> | null,
    conversational_state: context.conversational_state,
    conversation_history: context.messages as Array<{
      role?: string;
      content?: string;
      blocks?: Array<{ type?: string; data?: { summary?: string; patch_type?: string } }>;
    }>,
  });

  // 7. Entity-aware enrichment — match user message against compact graph nodes
  const referencedEntities = matchReferencedEntities(message, budgetedContext.graph_compact);

  // 7b. Cross-turn entity memory (feature-flagged: CEE_ENTITY_MEMORY_ENABLED)
  const entityStateMap = config.cee?.entityMemoryEnabled
    ? trackEntityStates(trimmedMessages, budgetedContext.graph_compact)
    : undefined;

  // 8. Compute context hash (after budget enforcement so hash reflects actual sent context)
  const budgetedMessages = budgetedContext.messages ?? trimmedMessages;
  const contextHash = computeContextHash(toHashableContext({
    ...budgetedContext,
    messages: budgetedMessages,
  }));

  log.debug(
    { turn_id: turnId, scenario_id: scenarioId, context_hash: contextHash },
    'phase1Enrich: context management complete',
  );

  return {
    ...budgetedContext,
    context_hash: contextHash,
    decision_continuity: decisionContinuity,
    ...(referencedEntities.length > 0 ? { referenced_entities: referencedEntities } : {}),
    ...(entityStateMap ? { entity_state_map: entityStateMap } : {}),
  } as EnrichedContext;
}

// ============================================================================
// ISL/PLoT Field Extraction (V2)
// ============================================================================

type AnalysisResponse = Record<string, unknown>;

/**
 * Extract ISL/PLoT enrichment fields from graph and analysis data.
 * All fields are optional — returns only those that can be computed from available data.
 */
function extractIslFields(
  graph: GraphV3T | null,
  analysis: AnalysisResponse | null | undefined,
  graphCompact: import("../../context/graph-compact.js").GraphV3Compact | undefined,
): Partial<Pick<EnrichedContext, 'gap_summary' | 'voi_ranking' | 'edge_e_values' | 'conditional_winners' | 'inference_warnings' | 'plot_critiques'>> {
  const result: Partial<Pick<EnrichedContext, 'gap_summary' | 'voi_ranking' | 'edge_e_values' | 'conditional_winners' | 'inference_warnings' | 'plot_critiques'>> = {};

  // gap_summary: computed from graph node data
  if (graph && graphCompact) {
    const nodes = (graph as Record<string, unknown>).nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
      const factors = nodes.filter((n: Record<string, unknown>) => n.kind === 'factor' || n.kind === 'lever' || n.kind === 'driver');
      const missingBaseline = factors.filter((n: Record<string, unknown>) => n.value === undefined || n.value === null);
      const unconfirmed = factors.filter((n: Record<string, unknown>) => n.source === 'assumption' || n.source === 'system');
      const goalNodes = nodes.filter((n: Record<string, unknown>) => n.kind === 'goal');
      const missingGoalTarget = goalNodes.length > 0 && goalNodes.every((n: Record<string, unknown>) => n.value === undefined || n.value === null);

      if (factors.length > 0 && (missingBaseline.length > 0 || unconfirmed.length > 0 || missingGoalTarget)) {
        result.gap_summary = {
          missing_baseline_count: missingBaseline.length,
          missing_baseline_factors: missingBaseline.map((n: Record<string, unknown>) => String(n.label ?? n.id ?? '')).slice(0, 10),
          missing_goal_target: missingGoalTarget,
          unconfirmed_count: unconfirmed.length,
          total_factor_count: factors.length,
        };
      }
    }
  }

  // Fields from analysis response (all optional — skip when not present)
  if (analysis) {
    // voi_ranking: from analysis.voi_ranking or results[].voi_ranking
    const voiRanking = extractArray(analysis, 'voi_ranking');
    if (voiRanking.length > 0) {
      result.voi_ranking = voiRanking
        .filter((v: Record<string, unknown>) => typeof v.factor_id === 'string')
        .slice(0, 5)
        .map((v: Record<string, unknown>) => ({
          factor_id: String(v.factor_id),
          factor_label: String(v.factor_label ?? v.label ?? v.factor_id),
          voi_score: Number(v.voi_score ?? v.voi ?? 0),
          evpi: Number(v.evpi ?? 0),
          evpi_percentage_points: Number(v.evpi_percentage_points ?? v.evpi_pp ?? 0),
        }));
    }

    // edge_e_values: from analysis.edge_e_values or robustness.edge_e_values
    const eValues = extractArray(analysis, 'edge_e_values');
    if (eValues.length > 0) {
      result.edge_e_values = eValues
        .filter((e: Record<string, unknown>) => typeof e.edge_id === 'string' && typeof e.e_value === 'number')
        .slice(0, 10)
        .map((e: Record<string, unknown>) => ({
          edge_id: String(e.edge_id),
          e_value: Number(e.e_value),
          flip_direction: String(e.flip_direction ?? 'unknown'),
          current_mean: Number(e.current_mean ?? 0),
          flip_mean: Number(e.flip_mean ?? 0),
        }));
    }

    // conditional_winners: from analysis.conditional_winners
    const condWinners = extractArray(analysis, 'conditional_winners');
    if (condWinners.length > 0) {
      result.conditional_winners = condWinners
        .filter((c: Record<string, unknown>) => typeof c.factor_id === 'string')
        .slice(0, 5)
        .map((c: Record<string, unknown>) => ({
          factor_id: String(c.factor_id),
          factor_label: String(c.factor_label ?? c.label ?? c.factor_id),
          split_value: Number(c.split_value ?? 0),
          split_unit: String(c.split_unit ?? ''),
          low_bucket: String(c.low_bucket ?? ''),
          high_bucket: String(c.high_bucket ?? ''),
          winner_flips: Boolean(c.winner_flips),
        }));
    }

    // inference_warnings: from analysis.inference_warnings
    const warnings = extractArray(analysis, 'inference_warnings');
    if (warnings.length > 0) {
      result.inference_warnings = warnings
        .filter((w: Record<string, unknown>) => typeof w.node_id === 'string')
        .slice(0, 10)
        .map((w: Record<string, unknown>) => ({
          node_id: String(w.node_id),
          code: String(w.code ?? 'UNKNOWN'),
          message: String(w.message ?? ''),
        }));
    }

    // plot_critiques: from analysis.critiques or analysis.plot_critiques
    const critiques = extractArray(analysis, 'critiques') ?? extractArray(analysis, 'plot_critiques');
    if (critiques.length > 0) {
      result.plot_critiques = critiques
        .filter((c: Record<string, unknown>) => typeof c.code === 'string' || typeof c.message === 'string')
        .slice(0, 5)
        .map((c: Record<string, unknown>) => ({
          code: String(c.code ?? 'UNKNOWN'),
          message: String(c.message ?? ''),
        }));
    }
  }

  return result;
}

/**
 * Extract an array field from analysis response, checking top-level and nested shapes.
 * Checks: top-level → results object → results[0] → robustness object → robustness_synthesis.
 */
function extractArray(analysis: AnalysisResponse, field: string): Record<string, unknown>[] {
  // Top-level
  if (Array.isArray(analysis[field])) return analysis[field] as Record<string, unknown>[];
  // Nested under results object (some PLoT shapes)
  const results = analysis.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    const nested = (results as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }
  // Per-result (first result)
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as Record<string, unknown>;
    if (Array.isArray(first?.[field])) return first[field] as Record<string, unknown>[];
  }
  // Nested under robustness (e.g. analysis.robustness.edge_e_values)
  const robustness = analysis.robustness;
  if (robustness && typeof robustness === 'object') {
    const nested = (robustness as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }
  // Nested under robustness_synthesis
  const synthObj = analysis.robustness_synthesis;
  if (synthObj && typeof synthObj === 'object') {
    const nested = (synthObj as Record<string, unknown>)[field];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }
  return [];
}
