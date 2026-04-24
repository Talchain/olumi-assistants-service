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

import type { AnalysisResponseSummary } from '../../orchestrator/context/analysis-compact.js';
import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import { EMPTY_COACHING_CACHE, type CoachingCache } from '../coaching/types.js';
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

export interface ContextPackAnalysis {
  readonly status: string;
  readonly leading_option: string | null;
  readonly runner_up: string | null;
  readonly robustness_band: string;
  readonly top_drivers: readonly string[];
  readonly fragile_edges: readonly string[];
  readonly staleness_reason: string | null;
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
  readonly analysis: ContextPackAnalysis | null;
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
  const base: ContextPack = {
    version: CONTEXT_PACK_VERSION,
    stage: input.payload.stage,
    graph: input.compactedGraph
      ? projectCompactGraph(input.compactedGraph, input.compactedConstraints ?? null)
      : projectGraph(input.graph ?? null),
    analysis: projectAnalysis(
      input.analysis ?? null,
      input.analysisStalenessReason ?? null,
    ),
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

function projectAnalysis(
  analysis: AnalysisResponseSummary | null,
  stalenessReason: string | null,
): ContextPackAnalysis | null {
  if (analysis === null) return null;

  const sortedOptions = [...analysis.options].sort((a, b) => b.win_probability - a.win_probability);
  const leading = sortedOptions[0]?.option_label ?? null;
  const runnerUp = sortedOptions[1]?.option_label ?? null;

  return {
    status: analysis.analysis_status,
    leading_option: leading,
    runner_up: runnerUp,
    robustness_band: analysis.robustness_level,
    top_drivers: analysis.top_drivers.map((d) => d.factor_label),
    fragile_edges: (analysis.top_fragile_edges ?? []).map((e) => `${e.from_label} → ${e.to_label}`),
    staleness_reason: stalenessReason,
  };
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
