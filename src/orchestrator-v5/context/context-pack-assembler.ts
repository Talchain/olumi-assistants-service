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
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import type { QuantityExtractionResult } from './cqe/schema-types.js';

import type {
  DriverSummary,
  FlipThreshold,
  OptionSummary,
} from '../../orchestrator/context/analysis-compact.js';
import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import { toSignedInfluenceValue } from '../../orchestrator/context/influence-direction.js';
import { log } from '../../utils/telemetry.js';
import { partitionInterventionControlledDrivers } from './intervention-controlled-drivers.js';
import { EMPTY_COACHING_CACHE, type CoachingCache } from '../coaching/types.js';
import {
  formatAnalysisForContext,
  type DisplaySafeAnalysis,
} from '../format/format-analysis-for-context.js';
import type {
  AnalysisResponseSummaryWithSignals,
  OptionGoalFitSignal,
  TippingPointSignal,
} from './analysis-signals.js';
import {
  formatGraphForContext,
  type DisplaySafeGraph,
} from '../format/format-graph-for-context.js';
import { detectCompound } from '../routing/compound-detector.js';
import {
  runExtraction,
  type CqeExtractionSummary,
} from './cqe/extract-quantities.js';
import { config, isProduction, isTest } from '../../config/index.js';
import {
  CONTEXT_PACK_BRIEF_CHAR_CAP,
  ContextPackSchema,
} from './context-pack-schema.js';
import { projectRecentChanges, type RecentMutation } from './recent-changes.js';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';
import { extractGraphOptionIds } from './option-identity.js';
import {
  selectCanonicalAnalysisState,
  summariseCanonicalAnalysisState,
  type AnalysisStateSummary,
  type CanonicalAnalysisState,
  type CoachingStatePack,
} from './canonical-analysis-state.js';

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
  /**
   * Lane 30 — this option's goal-fit value: the modelled probability the
   * option meets the user's target(s), sourced from the per-option
   * `enrichment.option_comparison[].probability_of_joint_goal` (PLoT #204)
   * via the `option_goal_fits` signal. RAW [0,1] float — handler-facing
   * only; the display formatter renders it as an integer-percent
   * `target_fit` string, clearly distinguished from `win_probability`.
   * Absent when the producer scored no goal fit for this option.
   */
  readonly goal_fit_probability?: number;
}

export interface ContextPackAnalysisDriver {
  readonly factor_label: string;
  readonly sensitivity_value: number;
}

export interface ContextPackAnalysisFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

/**
 * Lane 21 (P0-A) — raw tipping-point projection entry. Values are raw
 * floats (handler-facing); the display formatter bands them into
 * decision-language phrases and never surfaces the numbers.
 * `no_flip_within_bounds` carries the producer-attested "no flip point
 * exists in the tested range" fact (staging `flip_reason:
 * 'no_effect_within_bounds'`).
 */
export interface ContextPackAnalysisFlipThreshold {
  readonly factor_label: string;
  readonly current_value: number | null;
  readonly flip_value: number | null;
  readonly unit: string | null;
  readonly no_flip_within_bounds: boolean;
}

/** Lane 21 — raw evidence-gap (VOI) projection entry. `voi_score` ∈ [0,1]. */
export interface ContextPackAnalysisEvidenceGap {
  readonly factor_label: string;
  readonly voi_score: number;
}

/** Lane 21 — goal-fit scoring provenance (PLoT #204). Fact + basis only. */
export interface ContextPackAnalysisGoalFit {
  readonly scored: boolean;
  readonly basis: string | null;
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
  /**
   * Lane 21 (P0-A) breadth widening. The four fields below are OPTIONAL on
   * the interface (one legacy call site — chip-click-dispatch — hand-builds
   * a narrow projection for `buildAnalysisProjectionSummary` and does not
   * carry them) but the routed `projectAnalysis` path ALWAYS populates them
   * so the LLM-facing display projection can represent the whole analysis:
   *
   *  - `options`: EVERY scale-guard-valid option (label + raw probability),
   *    sorted by win probability descending — not just the leading pair.
   *    Bounded by {@link MAX_PROJECTED_OPTIONS}.
   *  - `flip_thresholds`: tipping-point entries (top-level staging signals
   *    when attached, else the per-option `summary.flip_thresholds`).
   *  - `fragile_edge_count`: the UNCAPPED count behind the capped
   *    `fragile_edges` label list. Fail-closed under lever suppression:
   *    when any edge is suppressed the count collapses to the filtered
   *    list length rather than repeating the producer count.
   *  - `evidence_gaps` / `goal_fit`: VOI + goal-fit provenance signals
   *    (see `./analysis-signals.ts`), raw here, banded by the formatter.
   */
  readonly options?: readonly ContextPackAnalysisOption[];
  readonly flip_thresholds?: readonly ContextPackAnalysisFlipThreshold[];
  readonly fragile_edge_count?: number;
  readonly evidence_gaps?: readonly ContextPackAnalysisEvidenceGap[];
  readonly goal_fit?: ContextPackAnalysisGoalFit | null;
  // V5 state-trust: `staleness_reason` removed from the prompt-visible
  // analysis section — freshness is now a deterministic verdict on the
  // wire (`analysis_ready.freshness`) and a telemetry signal
  // (`v5.analysis_freshness.derived`). The legacy fallback string fired
  // even on freshly-completed analysis turns and contaminated Sonnet's
  // context with a misleading caveat. Telemetry retains the legacy
  // `analysis_state_source` / `analysis_staleness_reason` fields for
  // operator continuity in turn-executor's log payloads.
  //
  // This is a deliberate divergence from spec §10:436 of
  // `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`. See
  // `Docs/v5-state-trust-phase0.md` for the design record.
}

/**
 * Lane 28 — brief pipeline: the user's decision brief as projected into the
 * ContextPack. `text` is the persisted `scenarios.brief_text` (the user's own
 * words — no display-safety banding applies, unlike model-derived analysis
 * prose) bounded at {@link CONTEXT_PACK_BRIEF_CHAR_CAP}. Truncation is
 * DISCLOSED, never silent: `truncated` flags it and `original_chars` carries
 * the pre-truncation length so no consumer can mistake the bounded text for
 * the whole brief.
 */
export interface ContextPackBrief {
  readonly text: string;
  readonly truncated: boolean;
  readonly original_chars: number;
}

export interface ContextPackConversationTurn {
  readonly turn_id: string;
  readonly turn_class: string;
  readonly handler_id: string | null;
  readonly created_at: string;
  /**
   * V5 Conversation Context Reliability: the user's verbatim message for this
   * prior turn. Null when none was persisted (system-event turns, pre-migration
   * rows). The LLM reads this (and `assistant_message`) to resolve ordinary
   * follow-ups like "Why?", "do that", "the second one".
   */
  readonly user_message: string | null;
  /** The final public assistant answer for this prior turn; null when none. */
  readonly assistant_message: string | null;
}

export interface ContextPackConversation {
  readonly recent_turns: readonly ContextPackConversationTurn[];
  readonly turn_count: number;
  readonly last_tool_used: string | null;
  /**
   * Boolean flag indicating that the next user turn is expected to confirm
   * or dismiss a pending change. Diverges from spec §10:444, which defines
   * the field as `{ patch_id, description } | null`. The structured
   * carriage now lives off-pack on the wire as `pending_actions[]` /
   * `proposed_actions[]` (see `src/orchestrator-v5/session/pending-action.ts`),
   * which carry `proposal_ref`, `inline_patch`, `public_label`, and
   * `public_message`. The boolean here remains for routing/log signal
   * only. No state-trust decision record could be located for this
   * specific simplification — flagged as an undocumented spec divergence;
   * consider a Decision Log entry that supersedes §10:444.
   */
  readonly pending_confirmation: boolean;
}

export interface ContextPack {
  readonly version: typeof CONTEXT_PACK_VERSION;
  /**
   * Scenario identifier from the boundary turn payload. Surfaced on the
   * pack itself (not just buried in `payload`) so downstream consumers —
   * replay/journey harnesses, debug logs, future audit trails — have a
   * single canonical key for the assembled context. Spec §10:414 lists
   * this as a required ContextPack field; this projection closes that
   * compliance gap. Additive: existing consumers do not need to change.
   */
  readonly scenario_id: string;
  readonly stage: string;
  /**
   * Lane 28 — brief pipeline (dossier gap G2): the user's persisted decision
   * brief, projected via {@link projectBrief} (size-bounded, disclosed
   * truncation). Serialised into the routing prompt automatically by
   * `buildUserMessage` (route-with-tool-use.ts) — the LLM finally knows what
   * the decision is about on every turn after the draft, not just via graph
   * labels.
   *
   * OMITTED (key absent) when no brief has been persisted for this scenario
   * — the assembler never emits `brief: null`, so a no-brief pack serialises
   * no `brief` field into the prompt. The type keeps `| null` only for
   * tolerant reading of hand-built packs.
   */
  readonly brief?: ContextPackBrief | null;
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
  /**
   * LLM-facing graph projection. Edges carry decision-language `relationship`
   * phrases ("moderate positive link") instead of raw `strength` floats; raw
   * `exists` probabilities and `plain_interpretation` strings are stripped;
   * nodes carry only display-safe fields (id/label/kind plus optional
   * category/unit/intervention_summary). Substituted in for `graph` by
   * `buildUserMessage` (route-with-tool-use.ts) when serialising the
   * ContextPack into the routing prompt. Raw `graph` remains for handlers,
   * freshness hashing, telemetry; edit_graph dispatch reads from a wholly
   * separate path (`editCompactGraph()` over raw boundary state).
   */
  readonly display_graph: DisplaySafeGraph;
  readonly conversation: ContextPackConversation;
  /**
   * Curated summary of the most recent successful mutations from
   * `prior_facts`, in newest-first order. Capped at three entries with
   * each summary truncated to 80 chars. Non-mutation facts and noop
   * facts are filtered out. Empty array when no prior mutations exist.
   *
   * Fixes the Phase 0 information-starvation finding for state-query
   * follow-ups ("what update did you make?", "what changed?"): without
   * a human-readable receipt of recent actions in the prompt, Sonnet
   * has no payload to reference and falls to the legacy `edit_graph`
   * catch-all. The deterministic state-query guard in the routing
   * pre-route layer also reads this field — both surfaces share the
   * same projection so their answers stay coherent.
   *
   * Hard contract — no raw structural identifiers ever appear here.
   * See {@link projectRecentChanges} for the cap and shape rules.
   */
  readonly recent_changes: readonly RecentMutation[];
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
  /**
   * Redacted canonical analysis state (additive observability). Derived from
   * the single canonical selector so prose / chips / context / diagnostics
   * all read one verdict. Statuses / predicates / counts / hashes only — no
   * raw blocker messages, labels, or user text.
   *
   * Null when the assembler had no canonical source on this turn. Pre-M5 the
   * production compacted-graph path passes `graph: undefined`, so the
   * assembler cannot recompute a freshness-comparable hash and emits null
   * rather than a misleadingly-stale verdict — the AUTHORITATIVE verdict
   * ships on the wire via the route's redacted context-summary surface
   * (turn-executor's raw-graph freshness). M5 threads `canonicalState` in so
   * this populates on every turn.
   */
  readonly analysis_state: AnalysisStateSummary | null;
  /**
   * Coaching Context Pack v1 — the hash-free, prompt-safe projection of the
   * canonical analysis state the LLM may RECEIVE for coaching (never author).
   * Present ONLY when `CEE_COACHING_CONTEXT_PROMPT_ENABLED` is on (the
   * turn-executor supplies it via `AssembleContextPackInput.coachingContext`);
   * absent otherwise, so flag-off `buildUserMessage` output is byte-identical.
   * Unlike `analysis_state` (stripped from the prompt for its graph-hash
   * digests) this projection carries no hashes/indices/values/units/labels/text,
   * so it is the ONLY canonical-state surface allowed to reach the prompt.
   */
  readonly coaching_context?: CoachingStatePack;
}

export interface AssembleContextPackInput {
  // v0.7.0: assembler only operates on message-kind turns (system events
  // take a deterministic pre-TurnExecutor path in route-v2.ts).
  readonly payload: MessageTurnPayload;
  // V5 Conversation Context Reliability: the content-bearing superset so
  // projectConversation can surface user_message / assistant_message to the
  // LLM. SessionTurnWithContent ⊇ SessionTurn.
  readonly priorTurns: readonly SessionTurnWithContent[];
  /**
   * Prior handler facts (newest-first), used to project the
   * `recent_changes` summary into the LLM-facing ContextPack. Optional
   * for backwards-compat with callers (and tests) that don't yet wire
   * facts through; when absent the projection collapses to an empty
   * array. Production callers — turn-executor.ts — MUST pass facts so
   * follow-up state-queries can be grounded.
   */
  readonly priorFacts?: readonly HandlerFact[];
  /**
   * Lane 28 — brief pipeline: the persisted `scenarios.brief_text` for this
   * scenario, threaded by the turn-executor from
   * `EnrichedTurnContext.scenarioBriefText` (loaded once per turn by
   * `buildTurnContext` via `loadGraphAndBriefText`). Optional for
   * backwards-compat with callers/tests that don't wire it; absent/null/
   * whitespace-only means the pack carries NO `brief` key at all (the
   * assembler omits it — a null is never serialised into the prompt).
   */
  readonly brief?: string | null;
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
  /**
   * The compact analysis summary, optionally carrying the Lane 21 signal
   * extensions (tipping points / evidence-gap VOI / goal-fit provenance —
   * see `./analysis-signals.ts`). Plain `AnalysisResponseSummary` values
   * remain assignable; the extensions are additive and optional.
   */
  readonly analysis?: AnalysisResponseSummaryWithSignals | null;
  /**
   * V5 Task 1.4: when the analysis came from a server-side fallback
   * (prior handler facts, not this request's body), the caller supplies a
   * string describing the reason. It is passed through to
   * `ContextPackAnalysis.staleness_reason` so Sonnet can treat the results
   * as potentially-stale reference material rather than fresh output.
   * Absent/null means analysis is fresh (or absent).
   */
  readonly analysisStalenessReason?: string | null;
  /**
   * Spine A (V5-owned claim-safety BACKSTOP): the set of `factor_id`s that an
   * option intervenes on, computed by the dispatch path from the RAW turn graph
   * (the compacted projection strips intervention bundles, so this must be
   * supplied here, NOT derived from `compactedGraph`). When present,
   * `projectTopDrivers` suppresses any top driver whose factor is in the set so
   * deterministic prose / LLM context never name an option-controlled lever as a
   * tunable sensitivity driver. Producer values are untouched — this is a
   * presentation suppression, NOT the Lane A1 producer fix. Omitted / empty ⇒ no
   * suppression (fail-safe).
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  readonly systemEvent?: unknown | null;
  readonly pendingConfirmation?: boolean;
  /** Pre-resolved coaching state. Caller reads sidecar / prior facts before
   *  calling the assembler; keeps the assembler synchronous. Defaults to
   *  EMPTY_COACHING_CACHE when not supplied. */
  readonly coaching?: CoachingCache;
  /**
   * V5 canonical analysis state, pre-computed by the dispatch path (M5,
   * turn-executor — which has the raw graph + freshness). When provided it
   * is authoritative for the ContextPack `analysis_state`. When absent, the
   * assembler best-effort derives it from `priorFacts` + the turn graph, and
   * emits null when no freshness-comparable hash is available here. Additive;
   * existing callers omit it (call site unchanged until M5).
   */
  readonly canonicalState?: CanonicalAnalysisState;
  /**
   * Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED). The
   * hash-free, prompt-safe `CoachingStatePack` the turn-executor projects from
   * the live `deriveAnalysisFreshness` verdict for coaching turns. When
   * present, it is surfaced verbatim as `ContextPack.coaching_context` (and
   * thereby into the LLM routing prompt). Omitted when the flag is off / no
   * freshness was derived → the field is absent → flag-off byte-identity.
   */
  readonly coachingContext?: CoachingStatePack;
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

/**
 * Lane 28 — brief pipeline: project the persisted decision brief into the
 * ContextPack shape.
 *
 * Rules (mirrors the write-side `normaliseBriefText` discipline — trim first,
 * bound second, disclose always):
 *   - null / undefined / whitespace-only → null (no brief persisted; the
 *     assembler then OMITS the `brief` key from the pack entirely — a null
 *     is never serialised into the routing prompt).
 *   - trimmed length ≤ {@link CONTEXT_PACK_BRIEF_CHAR_CAP} → verbatim
 *     (trimmed) text, `truncated: false`.
 *   - trimmed length >  cap → hard slice at the cap, `truncated: true`,
 *     with `original_chars` carrying the full trimmed length — DISCLOSED
 *     truncation, never a silent slice (contrast `CONVERSATION_TEXT_CAP`'s
 *     documented hard-slice in commit.ts, which this deliberately does not
 *     repeat).
 *
 * Pure and total; exported for direct unit coverage.
 */
export function projectBrief(
  briefText: string | null | undefined,
): ContextPackBrief | null {
  if (briefText == null) return null;
  const trimmed = briefText.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= CONTEXT_PACK_BRIEF_CHAR_CAP) {
    return { text: trimmed, truncated: false, original_chars: trimmed.length };
  }
  return {
    text: trimmed.slice(0, CONTEXT_PACK_BRIEF_CHAR_CAP),
    truncated: true,
    original_chars: trimmed.length,
  };
}

/**
 * Derive the redacted canonical analysis-state summary for the ContextPack.
 *
 * Source order:
 *   1. `input.canonicalState` (M5 — authoritative, threaded by the dispatch
 *      path which has the raw graph + freshness).
 *   2. Best-effort from `input.priorFacts` + a freshness hash of the turn
 *      graph — ONLY when a raw graph is available here. The production
 *      compacted-graph path passes `graph: undefined`; hashing a compacted
 *      projection would not match `graph_hash_at_run`, so we return null
 *      rather than emit a misleadingly-stale verdict. The authoritative
 *      verdict ships on the wire via the route's redacted context-summary
 *      surface.
 *
 * Critical-omission diagnostic: when `priorFacts` is absent entirely, emit a
 * structured warning rather than silently returning an authoritative-looking
 * 'none' — production callers (turn-executor) always thread facts.
 */
function deriveContextPackAnalysisState(
  input: AssembleContextPackInput,
): AnalysisStateSummary | null {
  if (input.canonicalState) {
    return summariseCanonicalAnalysisState(input.canonicalState);
  }
  if (input.priorFacts === undefined) {
    log.warn(
      {
        event: 'context_pack.canonical_state_facts_absent',
        scenario_id: input.payload.scenario_id,
      },
      'ContextPack assembled without prior_facts — canonical analysis_state omitted',
    );
    return null;
  }
  // Only the RAW (non-compacted) graph yields a freshness-comparable hash.
  const rawGraph = input.graph ?? null;
  if (rawGraph === null) return null;
  const currentGraphHash = computeAnalysisAffectingGraphHash(
    rawGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  const canonical = selectCanonicalAnalysisState({
    priorFacts: input.priorFacts,
    currentGraphHash,
    // Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): keep the
    // diagnostic / coaching-pack canonical state consistent with the wire
    // verdict. Same raw graph the hash is derived from. undefined when off.
    currentGraphOptionIds: config.cee.optionIdentityFreshnessGuard
      ? extractGraphOptionIds(rawGraph)
      : undefined,
    scenarioClaimsAnalysis: input.analysis != null,
  });
  return summariseCanonicalAnalysisState(canonical);
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
    input.interventionControlledFactorIds,
  );
  const projectedGraph: ContextPackGraph = input.compactedGraph
    ? projectCompactGraph(input.compactedGraph, input.compactedConstraints ?? null)
    : projectGraph(input.graph ?? null);
  const analysisStateSummary = deriveContextPackAnalysisState(input);
  // Lane 28 — the persisted decision brief (size-bounded, disclosed
  // truncation). Projected once; when no brief exists the key is OMITTED
  // entirely (never `brief: null`) so no-brief packs serialise no `brief`
  // field into the routing prompt — prompt hygiene: don't make the LLM read
  // a null. When present it is placed early in the literal so the serialised
  // prompt surfaces "what this decision is about" before the graph/analysis
  // detail.
  const projectedBrief = projectBrief(input.brief);
  const base: ContextPack = {
    version: CONTEXT_PACK_VERSION,
    scenario_id: input.payload.scenario_id,
    stage: input.payload.stage,
    ...(projectedBrief !== null ? { brief: projectedBrief } : {}),
    graph: projectedGraph,
    analysis: rawAnalysis,
    // Display-safe analysis projection — what Sonnet actually sees.
    // Sources structured fragile-edge labels off the raw projection
    // (no longer needs the upstream summary as a second argument).
    display_analysis: formatAnalysisForContext(rawAnalysis),
    // Display-safe graph projection — what Sonnet actually sees in
    // place of the raw graph. Edge `strength` floats become decision-
    // language `relationship` phrases; `exists` and `plain_interpretation`
    // are dropped; node numeric fields stripped. Raw `graph` above is
    // unchanged for handlers, freshness hashing, telemetry.
    display_graph: formatGraphForContext(projectedGraph),
    conversation: projectConversation(input.priorTurns, input.pendingConfirmation ?? false),
    recent_changes: projectRecentChanges(input.priorFacts),
    coaching: input.coaching ?? EMPTY_COACHING_CACHE,
    compound_detected: compound.detected,
    compound_pattern_matched: compound.telemetry.pattern_matched,
    parsed_quantities: extraction.results,
    system_event: input.systemEvent ?? null,
    analysis_state: analysisStateSummary,
  };
  const withSegments =
    compound.detected && compound.segments
      ? { ...base, compound_segments: compound.segments }
      : base;
  // Coaching Context Pack v1: additive, flag-gated. When the caller supplies
  // the pack (flag on), surface it verbatim; otherwise the field is absent so
  // the assembled pack is byte-identical to today (flag-off byte-identity).
  const contextPack: ContextPack = input.coachingContext
    ? { ...withSegments, coaching_context: input.coachingContext }
    : withSegments;
  // Non-production contract gate. Production assembly path stays cost-free
  // — `safeParse` is only invoked when `isProduction()` is false, so live
  // traffic pays the price of a single config read and nothing more. See
  // `context-pack-schema.ts` header for the schema's role and constraints.
  //
  // Behaviour ladder:
  //   - test       → throw (CI catches drift loudly, no risk of silent ship)
  //   - everything else non-prod → log.warn (developer-visible, non-fatal)
  //   - production → no parse, no log (dead code under prod)
  //
  // Error format (developer-safe — structural-only):
  //   `[ContextPack validation] <field path>: <zod message>`
  // Capped at five issues; carries no field values, no graph/analysis
  // payload, no conversation/user text.
  //
  // Env predicates come from `src/config/index.ts` (the centralised, Zod-
  // validated config) rather than direct `process.env` reads — keeps
  // dispatch consistent with the rest of the service and matches the
  // `no-restricted-syntax` lint policy.
  if (!isProduction()) {
    const parsed = ContextPackSchema.safeParse(contextPack);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map(
          (i) =>
            `[ContextPack validation] ${i.path.join('.') || '<root>'}: ${i.message}`,
        );
      if (isTest()) {
        throw new Error(issues.join('\n'));
      }
      log.warn(
        { event: 'context_pack_schema_drift', issues },
        'ContextPack failed schema validation',
      );
    }
  }
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

/**
 * Lane 21 (P0-A): the ROUTED ContextPack projection carries up to five
 * drivers — parity with the top-5 derivation in `compactAnalysis` and the
 * five factors the UI renders. The chip-click dispatch keeps the legacy
 * default cap of {@link TOP_DRIVER_CAP}; ordering/sign logic is shared via
 * `projectTopDrivers` so only the breadth differs.
 */
export const CONTEXT_PACK_TOP_DRIVER_CAP = 5;

/**
 * Lane 21 (P0-A): bound on the widened all-options projection so a
 * degenerate many-option graph cannot blow the prompt budget. Realistic
 * graphs carry ≤ 8 options; options beyond the cap are truncated at the
 * slice below (no overflow disclosure reaches the formatter today).
 */
export const MAX_PROJECTED_OPTIONS = 12;

/**
 * P0b-1 — source-only fragile-edge lever suppression, shared by `projectAnalysis`
 * (routed path) and the chip-click dispatch so the two re-projection sites cannot
 * drift (mirrors how `projectTopDrivers` is shared).
 *
 * An option-controlled lever as an edge SOURCE ("lever → X") would imply the user
 * can validate / test / act on a tunable driver — the unsafe claim — so it is
 * suppressed. A lever as edge TARGET ("X → lever") describes something acting ON
 * the lever, not tuning it, so it is preserved (mirrors PLoT Lane A1c
 * `isLeverSourcedEdge`).
 *
 * Authority is STRUCTURAL `from_id` membership ONLY — never the label (labels
 * collide; #308). FAIL-CLOSED: an edge with no resolvable `from_id` cannot be
 * proven non-lever, so when any lever exists it is dropped rather than risk a
 * silent bypass on the fallback path this guard protects. `from_id` is populated
 * fresh at derivation time on every path (per-option and top-level/fallback), so
 * the fail-closed branch only fires for malformed/label-only raw input. Producer
 * values are never mutated — a suppressed edge is simply not surfaced. Empty
 * controlled set ⇒ no-op.
 */
export function filterLeverSourcedFragileEdges<E extends { from_id?: string; from_label: string }>(
  edges: readonly E[],
  controlledFactorIds?: ReadonlySet<string>,
): E[] {
  if (controlledFactorIds === undefined || controlledFactorIds.size === 0) {
    return edges.slice();
  }
  return edges.filter((e) => {
    const fromId = typeof e.from_id === 'string' ? e.from_id.trim() : '';
    if (fromId.length === 0) return false; // fail-closed — see doc
    return !controlledFactorIds.has(fromId);
  });
}

/**
 * Lane 30 (#369 audit P1) — factor-keyed lever suppression for the tipping
 * (`flip_thresholds`, section 5) and evidence-gap (`evidence_gaps`, section
 * 7) projections. Before this lane, `projectAnalysis` filtered top_drivers
 * and fragile_edges by the intervention-controlled set but NOT these two
 * sections — an option-controlled lever excluded from the driver list could
 * still surface as a tipping point ("a small decrease in X could flip the
 * result") or an evidence gap ("gather data on X"), both of which imply the
 * user can independently tune / validate the lever. Same doctrine as
 * {@link filterLeverSourcedFragileEdges}:
 *
 *   - authority is STRUCTURAL `factor_id` membership ONLY — never the label
 *     (labels collide; #308);
 *   - FAIL-CLOSED: when any lever exists, an entry with no resolvable
 *     `factor_id` cannot be proven non-lever and is dropped;
 *   - empty / absent controlled set ⇒ no-op (fail-safe);
 *   - producer values are never mutated — a suppressed entry is simply not
 *     surfaced.
 *
 * A fired suppression is logged under the EXISTING
 * `v5.intervention_controlled_driver_suppressed` event (frozen telemetry
 * registry — no new event names) with a section-specific `source`.
 */
export function filterLeverControlledFactorEntries<
  E extends { factor_id?: string | null; factor_label: string },
>(
  entries: readonly E[],
  controlledFactorIds: ReadonlySet<string> | undefined,
  source: string,
): E[] {
  if (controlledFactorIds === undefined || controlledFactorIds.size === 0) {
    return entries.slice();
  }
  const kept: E[] = [];
  const suppressedIds: string[] = [];
  for (const entry of entries) {
    const id = typeof entry.factor_id === 'string' ? entry.factor_id.trim() : '';
    if (id.length === 0) {
      // Fail-closed: unattributable entry while levers exist.
      suppressedIds.push('<no_factor_id>');
      continue;
    }
    if (controlledFactorIds.has(id)) {
      suppressedIds.push(id);
      continue;
    }
    kept.push(entry);
  }
  if (suppressedIds.length > 0) {
    // EVIDENCE THE PRODUCER FIX (Science/PLoT Lane A1) IS STILL REQUIRED —
    // never a sign it is closed. factor_ids are internal identifiers (not
    // user-facing prose), safe to log.
    log.warn(
      {
        event: 'v5.intervention_controlled_driver_suppressed',
        source,
        suppressed_count: suppressedIds.length,
        suppressed_factor_ids: suppressedIds,
        producer_fix_required: true,
      },
      'V5 Lane 30: suppressed option-controlled lever from analysis projection (producer fix still required)',
    );
  }
  return kept;
}

/**
 * Project `DriverSummary[]` into the display-safe ContextPack driver shape —
 * the single rule shared by `projectAnalysis` (routed path) and the chip-click
 * dispatch so the two sign-reattachment sites cannot drift:
 *   1. drop non-finite magnitudes;
 *   2. re-attach the sign via `toSignedInfluenceValue` (`neutral` → 0);
 *   3. sort by absolute signed value, descending;
 *   4. cap at `cap` (default `TOP_DRIVER_CAP`; the routed ContextPack path
 *      passes `CONTEXT_PACK_TOP_DRIVER_CAP` — Lane 21 breadth widening).
 * Because the sort runs AFTER `neutral` is zeroed, a no-effect driver is always
 * demoted (and usually capped out) in both paths — it can never lead a "would
 * shift the most" claim on one path while being demoted on the other.
 */
export function projectTopDrivers(
  drivers: readonly DriverSummary[],
  controlledFactorIds?: ReadonlySet<string>,
  cap: number = TOP_DRIVER_CAP,
): ContextPackAnalysisDriver[] {
  // Spine A backstop: drop any driver whose factor is option-controlled BEFORE
  // the projection strips `factor_id` (the structural match key). Authority is
  // structural `factor_id` membership only — never the label. Producer values
  // are not touched; the driver is simply not surfaced as tunable.
  let source: readonly DriverSummary[] = drivers;
  if (controlledFactorIds !== undefined && controlledFactorIds.size > 0) {
    const { kept, suppressed } = partitionInterventionControlledDrivers(
      drivers,
      controlledFactorIds,
    );
    if (suppressed.length > 0) {
      // The backstop fired: an option-controlled lever was about to be surfaced
      // as a tunable driver. This is EVIDENCE THE PRODUCER FIX (Science/PLoT
      // Lane A1) IS STILL REQUIRED — never a sign it is closed. `factor_id`s are
      // internal identifiers (not user-facing prose), so they are safe to log.
      log.warn(
        {
          event: 'v5.intervention_controlled_driver_suppressed',
          source: 'projectTopDrivers',
          suppressed_count: suppressed.length,
          suppressed_factor_ids: suppressed.map((d) => d.factor_id),
          producer_fix_required: true,
        },
        'V5 Spine A: suppressed option-controlled lever from tunable-driver projection (producer fix still required)',
      );
    }
    source = kept;
  }
  return source
    .filter((d) => isFiniteSensitivity(d.sensitivity))
    .map((d) => ({
      factor_label: d.factor_label,
      sensitivity_value: toSignedInfluenceValue(d.direction, d.sensitivity),
    }))
    .sort((a, b) => Math.abs(b.sensitivity_value) - Math.abs(a.sensitivity_value))
    .slice(0, cap);
}

/**
 * Map a per-option `FlipThreshold` (compactAnalysis derivation — always a
 * complete numeric pair) into the widened tipping-point projection shape.
 */
function tippingFromFlipThreshold(entry: FlipThreshold): ContextPackAnalysisFlipThreshold {
  return {
    factor_label: entry.factor_label,
    current_value: entry.current_value,
    flip_value: entry.flip_value,
    unit: entry.unit,
    no_flip_within_bounds: false,
  };
}

function tippingFromSignal(entry: TippingPointSignal): ContextPackAnalysisFlipThreshold {
  return {
    factor_label: entry.factor_label,
    current_value: entry.current_value,
    flip_value: entry.flip_value,
    unit: entry.unit,
    no_flip_within_bounds: entry.no_flip_within_bounds,
  };
}

/** Finite [0,1] check for goal-fit values (no telemetry — the derivation
 *  already guards; this is defence for hand-built signal inputs). */
function isValidGoalFitProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Lane 30 — build the per-option goal-fit resolver from the attached
 * `option_goal_fits` signals plus the per-option summary field.
 *
 * Match authority order for a projected option:
 *   1. the option's own `probability_of_goal` (per-option summary data wins
 *      when a producer path populates it);
 *   2. signal matched by STRUCTURAL `option_id` (labels are not identity —
 *      the fallback path relabels options from the current graph);
 *   3. signal matched by label, ONLY for signals that carried no id at all.
 *
 * Returns undefined when no valid value resolves — the projected option then
 * simply omits `goal_fit_probability` and the display formatter renders the
 * explicit "target-fit not scored" disclosure instead.
 */
function buildGoalFitResolver(
  signals: readonly OptionGoalFitSignal[] | undefined,
): (option: OptionSummary) => number | undefined {
  const byId = new Map<string, number>();
  const byLabelIdless = new Map<string, number>();
  for (const s of signals ?? []) {
    if (!isValidGoalFitProbability(s.probability_of_joint_goal)) continue;
    if (typeof s.option_id === 'string' && s.option_id.trim().length > 0) {
      if (!byId.has(s.option_id)) byId.set(s.option_id, s.probability_of_joint_goal);
    } else if (typeof s.option_label === 'string' && s.option_label.trim().length > 0) {
      if (!byLabelIdless.has(s.option_label)) {
        byLabelIdless.set(s.option_label, s.probability_of_joint_goal);
      }
    }
  }
  return (option: OptionSummary): number | undefined => {
    if (isValidGoalFitProbability(option.probability_of_goal)) {
      return option.probability_of_goal;
    }
    const viaId = byId.get(option.option_id);
    if (viaId !== undefined) return viaId;
    return byLabelIdless.get(option.option_label);
  };
}

function projectAnalysis(
  analysis: AnalysisResponseSummaryWithSignals | null,
  stalenessReason: string | null,
  controlledFactorIds?: ReadonlySet<string>,
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

  // Lane 30 — per-option goal-fit carriage. One resolver shared by the
  // leading pair and the full option list so the same option can never show
  // a goal-fit value in one slot and not the other.
  const goalFitFor = buildGoalFitResolver(analysis.option_goal_fits);
  const projectOption = (o: OptionSummary): ContextPackAnalysisOption => {
    const goalFit = goalFitFor(o);
    return {
      label: o.option_label,
      probability: o.win_probability,
      ...(goalFit !== undefined ? { goal_fit_probability: goalFit } : {}),
    };
  };

  const leading: ContextPackAnalysisOption | null = leadingSrc
    ? projectOption(leadingSrc)
    : null;
  const runnerUp: ContextPackAnalysisOption | null = runnerUpSrc
    ? projectOption(runnerUpSrc)
    : null;

  // margin_pp is pre-computed upstream in compactAnalysis — passthrough.
  // When the upstream margin_pp is missing (legacy callers) or scale-guard
  // dropped one of the leading two options, fall through to null rather
  // than recompute here (F.6).
  const marginPp =
    leading && runnerUp ? analysis.margin_pp ?? null : null;

  // 2. Top drivers — shared with the chip-click dispatch via projectTopDrivers:
  //    filter non-finite, re-attach sign (neutral → 0), sort by |signed value|,
  //    cap. Keeping both reattachment sites on one helper prevents drift.
  //    Lane 21: the routed path carries up to five drivers (UI parity); the
  //    chip path keeps the legacy default cap.
  const topDrivers: ContextPackAnalysisDriver[] = projectTopDrivers(
    analysis.top_drivers,
    controlledFactorIds,
    CONTEXT_PACK_TOP_DRIVER_CAP,
  );

  // 3. Robustness band: null when source is unknown / empty; do not fabricate.
  const rawBand = analysis.robustness_level;
  const robustnessBand =
    typeof rawBand === 'string' && rawBand.trim().length > 0 && rawBand !== 'unknown'
      ? rawBand
      : null;

  // 4. Lane 21 breadth: every valid option (F.6 passthrough — filter + sort
  //    only, values untouched), bounded by MAX_PROJECTED_OPTIONS. Lane 30:
  //    each entry additionally carries its goal-fit value when one resolves.
  const allOptions: ContextPackAnalysisOption[] = validOptions
    .slice(0, MAX_PROJECTED_OPTIONS)
    .map(projectOption);

  // 5. Lane 21 tipping points: prefer the attached top-level staging signals
  //    (see analysis-signals.ts — the per-option derivation is structurally
  //    empty on staging); fall back to the per-option summary.flip_thresholds.
  //    Lane 30 (#369 audit P1): BOTH sources are filtered by the
  //    intervention-controlled set BEFORE factor_id is stripped — an
  //    option-controlled lever must not surface as a tipping point.
  const tippingSignals = analysis.tipping_points ?? [];
  const flipThresholds: ContextPackAnalysisFlipThreshold[] =
    tippingSignals.length > 0
      ? filterLeverControlledFactorEntries(
          tippingSignals,
          controlledFactorIds,
          'projectAnalysis.flip_thresholds',
        ).map(tippingFromSignal)
      : filterLeverControlledFactorEntries(
          analysis.flip_thresholds ?? [],
          controlledFactorIds,
          'projectAnalysis.flip_thresholds',
        ).map(tippingFromFlipThreshold);

  // 6. P0b-1: drop lever-SOURCED fragile edges before they reach the prose /
  //    validation surfaces (explain_results, explanation-fallback, advice gate —
  //    all read this same projection). Source-only; the output shape is unchanged
  //    ({from_label,to_label}), so the strict ContextPack schema is unaffected.
  const sourceFragile = analysis.top_fragile_edges ?? [];
  const filteredFragile = filterLeverSourcedFragileEdges(sourceFragile, controlledFactorIds);
  // Lane 21: uncapped count behind the capped list. FAIL-CLOSED under lever
  // suppression: once any edge is suppressed the producer's uncapped count can
  // no longer be attested (it may include other lever-sourced edges beyond the
  // capped list), so collapse to the filtered list length.
  const suppressionFired = filteredFragile.length < sourceFragile.length;
  const fragileEdgeCount = suppressionFired
    ? filteredFragile.length
    : Math.max(
        typeof analysis.fragile_edge_count === 'number' &&
          Number.isFinite(analysis.fragile_edge_count) &&
          analysis.fragile_edge_count >= 0
          ? analysis.fragile_edge_count
          : 0,
        filteredFragile.length,
      );

  // 7. Lane 21 signal passthrough — raw values; banding is the formatter's
  //    job. Lane 30 (#369 audit P1): filtered by the intervention-controlled
  //    set BEFORE factor_id is stripped — a lever must not surface as an
  //    evidence gap the user is invited to gather data on.
  const evidenceGaps: ContextPackAnalysisEvidenceGap[] =
    filterLeverControlledFactorEntries(
      analysis.evidence_gaps ?? [],
      controlledFactorIds,
      'projectAnalysis.evidence_gaps',
    )
      .filter((g) => Number.isFinite(g.voi_score) && g.voi_score >= 0)
      .map((g) => ({ factor_label: g.factor_label, voi_score: g.voi_score }));
  const goalFit: ContextPackAnalysisGoalFit | null = analysis.goal_fit
    ? { scored: analysis.goal_fit.scored, basis: analysis.goal_fit.basis }
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
    fragile_edges: filteredFragile.map((e) => ({
      from_label: e.from_label,
      to_label: e.to_label,
    })),
    options: allOptions,
    flip_thresholds: flipThresholds,
    fragile_edge_count: fragileEdgeCount,
    evidence_gaps: evidenceGaps,
    goal_fit: goalFit,
  };
}

function isFiniteSensitivity(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value !== Infinity && value !== -Infinity;
}

function projectConversation(
  priorTurns: readonly SessionTurnWithContent[],
  pendingConfirmation: boolean,
): ContextPackConversation {
  // priorTurns arrives ordered by created_at DESC (most recent first) from
  // SessionStore.readRecent. We cap at five. `last_tool_used` is the most
  // recent handler invocation — scan the full prior_turns to find it even
  // when it falls outside the five-turn window.
  //
  // V5 Conversation Context Reliability: project the per-turn conversation
  // content (user_message / assistant_message) so the LLM sees the actual
  // words of recent turns, not content-free stubs. This flows into the prompt
  // automatically via route-with-tool-use's `JSON.stringify(contextPack)` —
  // no prompt-template change needed. Null stays null.
  const recent = priorTurns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP).map((turn) => ({
    turn_id: turn.turn_id,
    turn_class: turn.turn_class,
    handler_id: turn.handler_id,
    created_at: turn.created_at,
    // `?? null`: content is optional on SessionTurnWithContent for fixture
    // assignability; the DB read path always sets a string|null, so this only
    // normalises legacy/test turns that omit the fields.
    user_message: turn.user_message ?? null,
    assistant_message: turn.assistant_message ?? null,
  }));

  const lastTool = priorTurns.find((t) => t.turn_class === 'handler' && t.handler_id !== null);

  return {
    recent_turns: recent,
    turn_count: priorTurns.length,
    last_tool_used: lastTool?.handler_id ?? null,
    pending_confirmation: pendingConfirmation,
  };
}
