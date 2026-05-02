/**
 * V5 Phase 1 — Context Pack Assembler.
 *
 * Projects the LLM-facing ContextPack (spec §10, version "2.0") from:
 *   - the boundary turn payload (stage, message, scenario_id)
 *   - prior conversation turns (from SessionStore.readRecent, already loaded
 *     into EnrichedTurnContext)
 *   - optional graph state (projected passthrough; F.6 — no semantic transforms)
 *   - optional analysis summary (uses existing V4 AnalysisResponseSummary shape
 *     so we do not duplicate the compacting logic)
 *   - optional system event (passthrough)
 *
 * Deliberately separate from `build-turn-context.ts`: TurnContext is the
 * wire-level internal state shape; ContextPack is the LLM-facing projection.
 * Two different concerns, two different files.
 *
 * This module does NOT:
 *   - call any LLM (routing lives in route-with-tool-use.ts)
 *   - mutate graph or session state
 *   - reach into handler internals
 *   - import from UI
 *   - run coaching logic (null for Phase 1a)
 *   - perform compound-intent detection (false for Phase 1a; detector lands
 *     in Phase 1b D9 if time permits)
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { SessionTurn } from '@talchain/schemas/orchestrator';
import type { QuantityExtractionResult } from './cqe/schema-types.js';

import type {
  AnalysisResponseSummary,
  OptionSummary,
} from '../../orchestrator/context/analysis-compact.js';
import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import { log } from '../../utils/telemetry.js';
import { EMPTY_COACHING_CACHE, type CoachingCache } from '../coaching/types.js';
import {
  formatAnalysisForContext,
  type DisplaySafeAnalysis,
} from '../format/format-analysis-for-context.js';
import { detectCompound } from '../routing/compound-detector.js';
import {
  runExtraction,
  type CqeExtractionSummary,
} from './cqe/extract-quantities.js';

// Recent turns cap for the conversation projection. Spec §10 bounds this at
// five for token budget. Any trim beyond is caller's concern.
export const CONTEXT_PACK_RECENT_TURNS_CAP = 5;

export const CONTEXT_PACK_VERSION = '2.0' as const;

/**
 * Graph passthrough projection. Passes through the underlying node/edge
 * arrays verbatim and derives counts. Options / goals / constraints are
 * surfaced as kind-partitioned lists for LLM ergonomics — F.6 compliant
 * because we only re-index what is already there; we never compute new
 * semantic fields.
 */
export interface ContextPackGraph {
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly options: readonly unknown[];
  readonly goals: readonly unknown[];
  readonly constraints: readonly unknown[];
  readonly counts: {
    readonly nodes: number;
    readonly edges: number;
    readonly options: number;
    readonly goals: number;
    readonly constraints: number;
  };
}

export interface ContextPackAnalysisOption {
  readonly label: string;
  readonly probability: number;
}

export interface ContextPackAnalysisDriver {
  readonly factor_label: string;
  readonly sensitivity_value: number;
}

export interface ContextPackAnalysisFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

export interface ContextPackAnalysis {
  readonly status: string;
  readonly leading_option: ContextPackAnalysisOption | null;
  readonly runner_up: ContextPackAnalysisOption | null;
  readonly margin_pp: number | null;
  readonly robustness_band: string | null;
  readonly top_drivers: readonly ContextPackAnalysisDriver[];
  /**
   * Structured fragile-edge labels. Brief brief-display-safe-analysis A2:
   * carry the upstream `{from_label, to_label}` pair through directly so
   * the LLM-facing display projection never has to split the legacy
   * `"A → B"` string. Handler-side consumers also benefit — they get
   * structured access without parsing.
   */
  readonly fragile_edges: readonly ContextPackAnalysisFragileEdge[];
  // V5 state-trust: `staleness_reason` removed from the prompt-visible
  // analysis section — freshness is now a deterministic verdict on the
  // wire (`analysis_ready.freshness`) and a telemetry signal
  // (`v5.analysis_freshness.derived`). The legacy fallback string fired
  // even on freshly-completed analysis turns and contaminated Sonnet's
  // context with a misleading caveat. Telemetry retains the legacy
  // `analysis_state_source` / `analysis_staleness_reason` fields for
  // operator continuity in turn-executor's log payloads.
}

export interface ContextPackConversationTurn {
  readonly turn_id: string;
  readonly turn_class: string;
  readonly handler_id: string | null;
  readonly created_at: string;
}

export interface ContextPackConversation {
  readonly recent_turns: readonly ContextPackConversationTurn[];
  readonly turn_count: number;
  readonly last_tool_used: string | null;
  readonly pending_confirmation: boolean;
}

export interface ContextPack {
  readonly version: typeof CONTEXT_PACK_VERSION;
  readonly stage: string;
  readonly graph: ContextPackGraph;
  /**
   * Raw, handler-facing analysis projection. Carries float probabilities
   * and signed sensitivities so coaching signals, chip generation,
   * projection summaries, and the explain-fallback path can do
   * deterministic logic. Never serialised to the LLM directly — see
   * `display_analysis` and `buildUserMessage` for the LLM-facing view.
   */
  readonly analysis: ContextPackAnalysis | null;
  /**
   * LLM-facing analysis projection. Decision-language strings only — no
   * raw floats, no internal coefficients. Substituted in for `analysis`
   * by `buildUserMessage` (route-with-tool-use.ts) when serialising the
   * ContextPack into the routing prompt. Design principle: raw model
   * values stay in structured state; LLM-facing context uses
   * decision-language projections only.
   */
  readonly display_analysis: DisplaySafeAnalysis | null;
  readonly conversation: ContextPackConversation;
  /**
   * Coaching state assembled from prior turns. draft_coaching is populated
   * from the draft-graph sidecar (logs/v5-draft-graph-coaching.jsonl) keyed
   * by scenario_id. decision_review is populated from the most recent
   * run_analysis handler fact's enrichment.decision_review (Task B). Null
   * sub-fields when no prior data exists.
   */
  readonly coaching: CoachingCache;
  readonly compound_detected: boolean;
  /** Populated only when compound_detected is true. Ordered as they appear in the message. */
  readonly compound_segments?: readonly string[];
  /**
   * Conjunction the compound detector matched on (and / then / also / plus),
   * null when no compound was detected. Surfaced into the routing log for
   * Phase 2 evaluation of detector quality.
   */
  readonly compound_pattern_matched: string | null;
  /**
   * Pre-parsed numeric quantities extracted from the user message by the
   * Layer 0 CQE module. Empty when no quantities were found. Consumed by
   * Sonnet via the routing prompt's PARAMETERS section — F.6: the LLM
   * never does arithmetic. See CQE Design v1.1 §3 for field semantics.
   */
  readonly parsed_quantities: readonly QuantityExtractionResult[];
  readonly system_event: unknown | null;
}

export interface AssembleContextPackInput {
  // v0.7.0: assembler only operates on message-kind turns (system events
  // take a deterministic pre-TurnExecutor path in route-v2.ts).
  readonly payload: MessageTurnPayload;
  readonly priorTurns: readonly SessionTurn[];
  readonly graph?: GraphWithOptions | null;
  /**
   * V5 Task 1.2: pre-compacted graph projection. When present, the assembler
   * uses this to populate ContextPack.graph (nodes/edges/derived lists and
   * counts) instead of the raw `graph` passthrough. Options/goals are
   * derived from the compact nodes by kind; constraints come through via
   * `compactedConstraints` below when the caller has them (compactGraph
   * itself drops `goal_constraints`). The full graph remains available to
   * the validator via `graphLookupForValidate` in turn-executor.
   *
   * Absent / null falls back to the raw passthrough projection, preserving
   * the pre-1.2 behaviour for callers that haven't adopted compaction.
   */
  readonly compactedGraph?: GraphV3Compact | null;
  /**
   * V5 review: raw `goal_constraints` from the ingress carried alongside
   * the compact graph so Sonnet does not lose decision constraints in the
   * compact path. Passthrough only — assembler does not introspect.
   */
  readonly compactedConstraints?: readonly unknown[] | null;
  readonly analysis?: AnalysisResponseSummary | null;
  /**
   * V5 Task 1.4: when the analysis came from a server-side fallback
   * (prior handler facts, not this request's body), the caller supplies a
   * string describing the reason. It is passed through to
   * `ContextPackAnalysis.staleness_reason` so Sonnet can treat the results
   * as potentially-stale reference material rather than fresh output.
   * Absent/null means analysis is fresh (or absent).
   */
  readonly analysisStalenessReason?: string | null;
  readonly systemEvent?: unknown | null;
  readonly pendingConfirmation?: boolean;
  /** Pre-resolved coaching state. Caller reads sidecar / prior facts before
   *  calling the assembler; keeps the assembler synchronous. Defaults to
   *  EMPTY_COACHING_CACHE when not supplied. */
  readonly coaching?: CoachingCache;
}

/**
 * Graph input shape accepted by the assembler. The assembler treats graph
 * content as opaque passthrough (F.6): it only reads `kind` on nodes to
 * derive goals, and never introspects edges/options beyond forwarding them
 * into the ContextPack. Accept any shape that carries the minimal wire
 * fields — both `GraphV3T` (full Zod-validated shape) and `GraphStateIngress`
 * (permissive Phase 1.5 boundary shape) are structurally compatible.
 */
export interface GraphWithOptions {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly [k: string]: unknown }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly [k: string]: unknown }>;
  readonly options?: readonly unknown[];
  readonly goal_node_id?: string;
  readonly goal_constraints?: readonly unknown[];
}

const EMPTY_GRAPH: ContextPackGraph = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  options: Object.freeze([]),
  goals: Object.freeze([]),
  constraints: Object.freeze([]),
  counts: Object.freeze({ nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 }),
}) as ContextPackGraph;

export interface AssembleContextPackResult {
  readonly contextPack: ContextPack;
  readonly cqeSummary: CqeExtractionSummary;
}

export function assembleContextPack(input: AssembleContextPackInput): ContextPack {
  return assembleContextPackWithSummary(input).contextPack;
}

export function assembleContextPackWithSummary(
  input: AssembleContextPackInput,
): AssembleContextPackResult {
  const compound = detectCompound(input.payload.message);
  const extraction = runExtraction(input.payload.message);
  // Compute the raw analysis projection ONCE — it is shared between the
  // handler-facing `analysis` slot and the LLM-facing `display_analysis`
  // wrapper. Calling projectAnalysis twice would double-emit
  // analysis_projection_invalid_probability telemetry on bad inputs.
  const rawAnalysis = projectAnalysis(
    input.analysis ?? null,
    input.analysisStalenessReason ?? null,
  );
  const base: ContextPack = {
    version: CONTEXT_PACK_VERSION,
    stage: input.payload.stage,
    graph: input.compactedGraph
      ? projectCompactGraph(input.compactedGraph, input.compactedConstraints ?? null)
      : projectGraph(input.graph ?? null),
    analysis: rawAnalysis,
    // Display-safe analysis projection — what Sonnet actually sees.
    // Sources structured fragile-edge labels off the raw projection
    // (no longer needs the upstream summary as a second argument).
    display_analysis: formatAnalysisForContext(rawAnalysis),
    conversation: projectConversation(input.priorTurns, input.pendingConfirmation ?? false),
    coaching: input.coaching ?? EMPTY_COACHING_CACHE,
    compound_detected: compound.detected,
    compound_pattern_matched: compound.telemetry.pattern_matched,
    parsed_quantities: extraction.results,
    system_event: input.systemEvent ?? null,
  };
  const contextPack =
    compound.detected && compound.segments
      ? { ...base, compound_segments: compound.segments }
      : base;
  return { contextPack, cqeSummary: extraction.summary };
}

/**
 * Project a compacted graph (output of `compactGraphForContextPack`) into
 * the ContextPackGraph shape. Options / goals are derived from the compact
 * nodes by kind; constraints are passed through from the caller (the
 * compactor itself drops `goal_constraints`, so they must be threaded here
 * explicitly or Sonnet loses them on every turn).
 *
 * The returned object uses the compact shapes for nodes and edges — callers
 * that typed these as `readonly unknown[]` consume them unchanged. Downstream
 * uses (turn-executor routing-log counts, JSON serialisation to Sonnet) are
 * both shape-agnostic.
 */
function projectCompactGraph(
  compact: GraphV3Compact,
  constraints: readonly unknown[] | null,
): ContextPackGraph {
  const options = compact.nodes
    .filter((n) => n.kind === 'option')
    .map((n) => ({ id: n.id, label: n.label }));
  const goals = compact.nodes.filter((n) => n.kind === 'goal');
  const safeConstraints = constraints ?? [];
  return {
    nodes: compact.nodes,
    edges: compact.edges,
    options,
    goals,
    constraints: safeConstraints,
    counts: {
      nodes: compact.nodes.length,
      edges: compact.edges.length,
      options: options.length,
      goals: goals.length,
      constraints: safeConstraints.length,
    },
  };
}

function projectGraph(graph: GraphWithOptions | null): ContextPackGraph {
  if (graph === null) return EMPTY_GRAPH;

  const nodes = graph.nodes;
  const edges = graph.edges;
  const options = graph.options ?? nodes
    .filter((node) => node.kind === 'option')
    .map((node) => ({ id: node.id, label: typeof node.label === 'string' ? node.label : null }));
  const goals = nodes.filter((n) => (n as { kind?: string }).kind === 'goal');
  const constraints = graph.goal_constraints ?? [];

  return {
    nodes,
    edges,
    options,
    goals,
    constraints,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: options.length,
      goals: goals.length,
      constraints: constraints.length,
    },
  };
}

/**
 * Probability scale guard. Returns true when `value` is a finite number in
 * [0, 1]. On violation, emits a telemetry event the caller can correlate
 * with the offending option/scenario; the caller is expected to *exclude*
 * the offending option from the projection (do not throw — Sonnet should
 * still see the rest of the analysis).
 */
function isProbabilityValid(
  value: unknown,
  context: { call_site: string; option_label?: string | null; option_id?: string | null },
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    log.warn(
      {
        event: 'analysis_projection_invalid_probability',
        call_site: context.call_site,
        option_label: context.option_label ?? null,
        option_id: context.option_id ?? null,
        value: typeof value === 'number' ? value : String(value),
      },
      'context-pack-assembler: dropping option with invalid win_probability',
    );
    return false;
  }
  return true;
}

const TOP_DRIVER_CAP = 3;

function projectAnalysis(
  analysis: AnalysisResponseSummary | null,
  stalenessReason: string | null,
): ContextPackAnalysis | null {
  if (analysis === null) return null;

  // 1. Filter options by probability scale guard, then sort desc.
  //    F.6 passthrough: we only filter+sort; we do not transform values.
  const validOptions: OptionSummary[] = analysis.options
    .filter((o) =>
      isProbabilityValid(o.win_probability, {
        call_site: 'projectAnalysis.options',
        option_label: o.option_label,
        option_id: o.option_id,
      }),
    )
    .slice()
    .sort((a, b) => b.win_probability - a.win_probability);

  const leadingSrc = validOptions[0];
  const runnerUpSrc = validOptions[1];

  const leading: ContextPackAnalysisOption | null = leadingSrc
    ? { label: leadingSrc.option_label, probability: leadingSrc.win_probability }
    : null;
  const runnerUp: ContextPackAnalysisOption | null = runnerUpSrc
    ? { label: runnerUpSrc.option_label, probability: runnerUpSrc.win_probability }
    : null;

  // margin_pp is pre-computed upstream in compactAnalysis — passthrough.
  // When the upstream margin_pp is missing (legacy callers) or scale-guard
  // dropped one of the leading two options, fall through to null rather
  // than recompute here (F.6).
  const marginPp =
    leading && runnerUp ? analysis.margin_pp ?? null : null;

  // 2. Top drivers: filter non-finite, sort by |sensitivity| desc, cap at 3.
  //    Upstream `DriverSummary.sensitivity` is already the absolute value
  //    (Math.abs in deriveTopDrivers); sign is in `direction`. Re-attach
  //    sign so consumers see a signed magnitude.
  const topDrivers: ContextPackAnalysisDriver[] = analysis.top_drivers
    .filter((d) => isFiniteSensitivity(d.sensitivity))
    .map((d) => ({
      factor_label: d.factor_label,
      sensitivity_value: d.direction === 'negative' ? -d.sensitivity : d.sensitivity,
    }))
    .sort((a, b) => Math.abs(b.sensitivity_value) - Math.abs(a.sensitivity_value))
    .slice(0, TOP_DRIVER_CAP);

  // 3. Robustness band: null when source is unknown / empty; do not fabricate.
  const rawBand = analysis.robustness_level;
  const robustnessBand =
    typeof rawBand === 'string' && rawBand.trim().length > 0 && rawBand !== 'unknown'
      ? rawBand
      : null;

  // stalenessReason is intentionally not threaded into the projection —
  // V5 state-trust removed it from the prompt-visible shape. Reading the
  // parameter here keeps the assembler's signature stable for callers
  // that still pass it (turn-executor's telemetry log fields), but the
  // value is dropped on the floor.
  void stalenessReason;
  return {
    status: analysis.analysis_status,
    leading_option: leading,
    runner_up: runnerUp,
    margin_pp: marginPp,
    robustness_band: robustnessBand,
    top_drivers: topDrivers,
    fragile_edges: (analysis.top_fragile_edges ?? []).map((e) => ({
      from_label: e.from_label,
      to_label: e.to_label,
    })),
  };
}

function isFiniteSensitivity(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value !== Infinity && value !== -Infinity;
}

function projectConversation(
  priorTurns: readonly SessionTurn[],
  pendingConfirmation: boolean,
): ContextPackConversation {
  // priorTurns arrives ordered by created_at DESC (most recent first) from
  // SessionStore.readRecent. We cap at five. `last_tool_used` is the most
  // recent handler invocation — scan the full prior_turns to find it even
  // when it falls outside the five-turn window.
  const recent = priorTurns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP).map((turn) => ({
    turn_id: turn.turn_id,
    turn_class: turn.turn_class,
    handler_id: turn.handler_id,
    created_at: turn.created_at,
  }));

  const lastTool = priorTurns.find((t) => t.turn_class === 'handler' && t.handler_id !== null);

  return {
    recent_turns: recent,
    turn_count: priorTurns.length,
    last_tool_used: lastTool?.handler_id ?? null,
    pending_confirmation: pendingConfirmation,
  };
}
