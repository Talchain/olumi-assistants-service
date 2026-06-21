/**
 * V5 Canonical Analysis State — the single composed verdict on
 * "is there usable analysis, and is it current?".
 *
 * ## Why this module exists
 *
 * Today the same question is answered by independent code paths that can
 * disagree:
 *   - `deriveAnalysisFreshness(priorFacts, hash)` — graph-hash-aware
 *     verdict, but consumes prior-turn facts only.
 *   - the chip floor's `hasAnyRunAnalysisFact` — presence check that ORs
 *     current-turn handlerFacts AND priorFacts.
 *   - `computeStructuralReadiness(graph)` — status + blockers, graph-only.
 *
 * Concrete symptom: on the turn `run_analysis` just ran,
 * `hasAnyRunAnalysisFact === true` while `deriveAnalysisFreshness` returns
 * `'none'` — the new fact is in `handlerFacts`, which freshness never
 * sees. Chips, prose, reload and diagnostics can therefore contradict one
 * another ("no analysis yet" vs "analysis is stale").
 *
 * ## Composition, not duplication
 *
 * This module introduces NO new status/freshness vocabulary. The enums
 * come verbatim from `src/schemas/analysis-ready.ts`. The verdict is
 * COMPOSED from the existing canonical primitives:
 *   - `deriveAnalysisFreshness` / `selectRunAnalysisFact` /
 *     `selectDegradedRunAnalysisFact` (context/freshness.ts) for the
 *     fact-driven freshness verdict, the selected fact and degraded
 *     detection;
 *   - the readiness payload (`computeStructuralReadiness` output, which
 *     conforms to the shared `AnalysisReadyPayload` contract) for status +
 *     blockers.
 *
 * The unification fix for the documented split: current-turn handlerFacts
 * and prior-turn facts are merged into ONE ordered chain (current first =
 * newest) BEFORE deriving freshness, so the selector, the chip floor and
 * the freshness verdict all read one fact set and cannot disagree.
 *
 * ## Side-effect split
 *
 * `selectCanonicalAnalysisState` is a PURE function — no I/O, no
 * telemetry, no reads from disk or env. It mirrors `deriveAnalysisFreshness`
 * exactly: replacing it in tests is a function call, not a mock. The
 * CALLER decides when to emit the `v5.canonical_state.contradiction`
 * telemetry event (most call once per derivation; tests skip emitting).
 *
 * ## Usability is status-driven, contradictions fail loud
 *
 * Usability predicates derive from `status` + `freshness` + hashes, never
 * from raw blocker presence. `status === 'ready'` carrying advisory
 * `constraint_dropped` blockers is a BY-DESIGN combination on the shared
 * contract (the egress boundary injects informational constraint-drop
 * blockers onto an already-ready payload without recomputing status — see
 * src/cee/unified-pipeline/stages/boundary.ts and
 * src/cee/transforms/analysis-ready.ts). It must NOT downgrade usability.
 * Only ACTIONABLE blocker types co-occurring with `ready` (which a correct
 * producer would have already reflected as a non-ready status) are treated
 * as an integrity contradiction.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type {
  AnalysisFreshnessT,
  AnalysisReadyStatusT,
} from '../../schemas/analysis-ready.js';
import {
  deriveAnalysisFreshness,
  selectDegradedRunAnalysisFact,
  selectRunAnalysisFact,
  type FreshnessDerivation,
  type FreshnessReason,
} from './freshness.js';

/**
 * Contract version for the canonical analysis-state object. Bump on any
 * shape change. Internal/diagnostic only — NOT a UI-governed wire field.
 */
export const CANONICAL_ANALYSIS_STATE_VERSION = '1.0.0';

/**
 * Observable contradictions in the persisted analysis state. Carried in
 * `CanonicalAnalysisState.contradictions` and surfaced via the diagnostic
 * `_context_summary` + a caller-emitted telemetry event. Contradictions
 * are NEVER silently reconciled — predicates fail toward rerun/caveat.
 *
 *   scenario_claims_analysis_no_fact
 *     Persisted scenario state asserts an analysis exists, yet no
 *     successful run_analysis fact is selectable. Blocks (unusable).
 *
 *   fact_present_graph_unparseable
 *     A successful fact with a run-time graph hash exists, but the current
 *     graph could not be hashed on this turn — the freshness comparison is
 *     impossible despite a real fact. Blocks (unusable).
 *
 *   status_ready_with_actionable_blockers
 *     Readiness reports `ready`, yet an ACTIONABLE blocker
 *     (missing_value / ambiguous_value / missing_connection) is present.
 *     A correct producer forces a non-ready status for actionable
 *     blockers, so this is a should-never-happen integrity violation.
 *     Advisory `constraint_dropped` blockers do NOT trigger it.
 *     Downgrades chips + forces rerun; prose stays usable (caveated).
 *
 *   fact_status_success_but_degraded_newer
 *     A newer run_analysis fact arrived in a non-success state while an
 *     older success would otherwise be presented as current. Downgrades
 *     chips + forces rerun; prose stays usable (caveated).
 */
export type CanonicalContradiction =
  | 'scenario_claims_analysis_no_fact'
  | 'fact_present_graph_unparseable'
  | 'status_ready_with_actionable_blockers'
  | 'fact_status_success_but_degraded_newer';

/**
 * Blocker types that represent an ACTIONABLE gap the user must resolve
 * before analysis is trustworthy. `constraint_dropped` is intentionally
 * excluded — it is informational/advisory and rides along on otherwise
 * ready payloads by design.
 */
const ACTIONABLE_BLOCKER_TYPES: ReadonlySet<string> = new Set([
  'missing_value',
  'ambiguous_value',
  'missing_connection',
]);

/** The canonical analysis-ready status values (mirrors AnalysisReadyStatus). */
const ANALYSIS_READY_STATUSES: ReadonlySet<string> = new Set([
  'ready',
  'needs_user_mapping',
  'needs_encoding',
  'needs_user_input',
  'blocked',
]);

/**
 * Coerce a producer-supplied readiness status string to a known
 * AnalysisReadyStatus, or null for absent / unrecognised values. Different
 * producers type `status` differently (the structural readiness helper uses
 * the enum; the egress-emit payload widens it to `string`), so we validate
 * here rather than trusting the inbound type.
 */
function coerceReadyStatus(raw: string | null | undefined): AnalysisReadyStatusT | null {
  if (raw != null && ANALYSIS_READY_STATUSES.has(raw)) {
    return raw as AnalysisReadyStatusT;
  }
  return null;
}

/**
 * Minimal structural view of the readiness payload the selector reads.
 * Both `computeStructuralReadiness` output and the full
 * `AnalysisReadyPayload` satisfy it — the selector only needs status,
 * blockers, model adjustments and the goal node id. Kept structural so
 * the selector does not couple to any one producer's concrete type.
 */
/**
 * Read a blocker's `blocker_type` defensively. Blockers arrive either as
 * schema-typed `AnalysisBlocker[]` (from computeStructuralReadiness) or as
 * `unknown[]` (the egress-emit payload types them that way). This is the
 * single place that normalises both — returns null for any shape that does
 * not carry a string `blocker_type`.
 */
function readBlockerType(blocker: unknown): string | null {
  if (blocker !== null && typeof blocker === 'object' && 'blocker_type' in blocker) {
    const raw = (blocker as { blocker_type?: unknown }).blocker_type;
    return typeof raw === 'string' ? raw : null;
  }
  return null;
}

export interface ReadinessLike {
  /** Producer-supplied status; coerced to a known AnalysisReadyStatus (or
   *  null) internally, so a wider `string` from the egress payload is fine. */
  readonly status?: string | null;
  /** Blockers pass through verbatim; the selector only reads `blocker_type`
   *  (via readBlockerType), so any producer shape — schema `AnalysisBlocker`
   *  or the egress payload's `unknown[]` — is accepted without a cast. */
  readonly blockers?: readonly unknown[];
  /** Carried through verbatim; the selector never introspects adjustments. */
  readonly model_adjustments?: readonly unknown[];
  readonly goal_node_id?: string | null;
}

/**
 * The single composed canonical analysis state. Internal/full shape —
 * carries blocker + adjustment objects for consumers that need detail.
 * The redacted, leak-safe projection for diagnostics/harness is
 * {@link AnalysisStateSummary} (see {@link summariseCanonicalAnalysisState}).
 */
export interface CanonicalAnalysisState {
  readonly version: typeof CANONICAL_ANALYSIS_STATE_VERSION;

  // ── Vocabulary reused verbatim (no new enums) ──
  /** Structural readiness status, or null when no readiness was supplied. */
  readonly status: AnalysisReadyStatusT | null;
  /** Freshness verdict from `deriveAnalysisFreshness`. */
  readonly freshness: AnalysisFreshnessT;
  /** Stable reason code from `deriveAnalysisFreshness`. */
  readonly freshness_reason: FreshnessReason;

  // ── Selected-fact provenance (single source = the freshness derivation) ──
  readonly selected_fact_index: number | null;
  readonly computed_at: string | null;
  readonly graph_hash_at_run: string | null;
  readonly current_graph_hash: string | null;

  // ── Readiness detail where available ──
  readonly blockers: readonly unknown[];
  readonly model_adjustments: readonly unknown[];
  readonly goal_node_id: string | null;

  // ── Degraded/failed observability ──
  /** Non-null when the newest run_analysis fact was a non-success status. */
  readonly degraded_fact_status: string | null;

  // ── Contradictions (fail-loud, never silently reconciled) ──
  readonly contradictions: readonly CanonicalContradiction[];

  // ── Deterministic NAMED predicates (no vague single `usable`) ──
  /** Analysis exists and may be referenced in prose (stale → caveat). */
  readonly usableForProse: boolean;
  /** Analysis is fresh + trustworthy enough for result-exploration chips. */
  readonly usableForChips: boolean;
  /** Analysis exists to reference for follow-up handlers (fresh OR stale). */
  readonly usableForFollowupContext: boolean;
  /** A rerun affordance should be surfaced (stale or trust-downgraded). */
  readonly requiresRerun: boolean;
  /** Analysis is unusable — blocked status or a hard contradiction. */
  readonly blockedUnusable: boolean;
}

/**
 * Inputs to the canonical selector. All optional except the current graph
 * hash, which the caller computes via `computeAnalysisAffectingGraphHash`
 * on this turn's graph (null when no graph / unparseable).
 */
export interface SelectCanonicalAnalysisStateInput {
  /** Current-turn handler facts (may hold the run_analysis that JUST ran). */
  readonly handlerFacts?: readonly HandlerFact[];
  /** Prior-turn facts, newest-first per build-turn-context's loader. */
  readonly priorFacts?: readonly HandlerFact[];
  /** Structural readiness payload (status + blockers). */
  readonly readiness?: ReadinessLike;
  /** Hash of this turn's analysis-affecting graph fields, or null. */
  readonly currentGraphHash: string | null;
  /** True when persisted scenario state asserts an analysis exists. */
  readonly scenarioClaimsAnalysis?: boolean;
}

/** Defensive read of a fact's run-time `computed_at`. */
function readComputedAt(fact: HandlerFact): string | null {
  const result = (fact as { result?: { computed_at?: unknown } }).result;
  return result && typeof result.computed_at === 'string' ? result.computed_at : null;
}

/**
 * Compose the canonical analysis state. Pure — no I/O, no telemetry.
 *
 * The verdict is built entirely from the existing canonical primitives
 * over a UNIFIED fact chain (current-turn facts first, then prior facts),
 * so the freshness verdict, the selected fact and the chip floor all agree
 * on one fact set. See module header for the design rationale.
 */
export function selectCanonicalAnalysisState(
  input: SelectCanonicalAnalysisStateInput,
): CanonicalAnalysisState {
  // Unify current-turn + prior facts. Current first so the freshly-run
  // run_analysis fact is newest — this is the fix for the documented
  // chip-floor / freshness divergence.
  const unifiedFacts: readonly HandlerFact[] = [
    ...(input.handlerFacts ?? []),
    ...(input.priorFacts ?? []),
  ];

  // Freshness verdict (also yields selected_fact_index / hashes /
  // computed_at — the single source for those fields here).
  const derivation = deriveAnalysisFreshness(unifiedFacts, input.currentGraphHash);
  const selected = selectRunAnalysisFact(unifiedFacts);
  const degraded = selectDegradedRunAnalysisFact(unifiedFacts);

  // A newer run failed/partial while an older success would be presented
  // as current. Only provable when both timestamps are present. (Needs the
  // raw facts, so it is computed here, not in the shared assembler.)
  const degradedComputedAt = degraded ? readComputedAt(degraded.fact) : null;
  const degradedNewerThanSelectedSuccess =
    degraded !== null &&
    selected !== null &&
    degradedComputedAt !== null &&
    selected.computed_at !== null &&
    degradedComputedAt > selected.computed_at;

  return assembleCanonicalState({
    derivation,
    readiness: input.readiness,
    degradedStatus: degraded?.status ?? null,
    degradedNewerThanSelectedSuccess,
    scenarioClaimsAnalysis: input.scenarioClaimsAnalysis === true,
  });
}

/**
 * Build a canonical analysis state from an already-computed freshness
 * derivation + readiness, WITHOUT the raw fact chain. Used at the route
 * seam (`sendFinalised200`) where the turn's `FreshnessDerivation` and
 * readiness payload are available but the handler-fact array is not.
 *
 * Limitation vs `selectCanonicalAnalysisState`: degraded-fact detection
 * (`degraded_fact_status` + the `fact_status_success_but_degraded_newer`
 * contradiction) needs the fact chain, so this path reports
 * `degraded_fact_status = null` and never raises that contradiction. Every
 * freshness / readiness / predicate field is identical to the fact-based
 * selector. The full canonical state (with degraded detection) is threaded
 * from turn-executor in M5.
 */
export function canonicalStateFromFreshness(
  derivation: FreshnessDerivation,
  opts: { readonly readiness?: ReadinessLike; readonly scenarioClaimsAnalysis?: boolean } = {},
): CanonicalAnalysisState {
  return assembleCanonicalState({
    derivation,
    readiness: opts.readiness,
    degradedStatus: null,
    degradedNewerThanSelectedSuccess: false,
    scenarioClaimsAnalysis: opts.scenarioClaimsAnalysis === true,
  });
}

interface AssembleCanonicalStateParams {
  readonly derivation: FreshnessDerivation;
  readonly readiness?: ReadinessLike;
  readonly degradedStatus: string | null;
  readonly degradedNewerThanSelectedSuccess: boolean;
  readonly scenarioClaimsAnalysis: boolean;
}

/**
 * Shared predicate + contradiction core. Both `selectCanonicalAnalysisState`
 * (fact-based) and `canonicalStateFromFreshness` (derivation-based) funnel
 * through here so the usability rules have exactly ONE implementation.
 */
function assembleCanonicalState(params: AssembleCanonicalStateParams): CanonicalAnalysisState {
  const { derivation } = params;
  const status: AnalysisReadyStatusT | null = coerceReadyStatus(params.readiness?.status);
  const blockers: readonly unknown[] = params.readiness?.blockers ?? [];
  const modelAdjustments: readonly unknown[] = params.readiness?.model_adjustments ?? [];
  const goalNodeId: string | null = params.readiness?.goal_node_id ?? null;

  const hasFact = derivation.selected_fact_index !== null;

  // ── Contradictions (fail-loud, never silently reconciled) ──
  const contradictions: CanonicalContradiction[] = [];

  if (params.scenarioClaimsAnalysis && !hasFact) {
    contradictions.push('scenario_claims_analysis_no_fact');
  }

  // A real fact with a run hash, but the current graph could not be hashed
  // → the freshness comparison is impossible despite a genuine fact.
  if (
    hasFact &&
    derivation.current_graph_hash === null &&
    derivation.graph_hash_at_run !== null
  ) {
    contradictions.push('fact_present_graph_unparseable');
  }

  // Actionable blockers on a 'ready' payload are a should-never-happen
  // integrity violation. Advisory constraint_dropped blockers do NOT count.
  const actionableBlockerCount = blockers.filter((b) => {
    const type = readBlockerType(b);
    return type !== null && ACTIONABLE_BLOCKER_TYPES.has(type);
  }).length;
  if (status === 'ready' && actionableBlockerCount > 0) {
    contradictions.push('status_ready_with_actionable_blockers');
  }

  if (params.degradedNewerThanSelectedSuccess) {
    contradictions.push('fact_status_success_but_degraded_newer');
  }

  // ── Predicates ──
  // Hard block: nothing is usable.
  const blockedUnusable =
    status === 'blocked' ||
    contradictions.includes('fact_present_graph_unparseable') ||
    contradictions.includes('scenario_claims_analysis_no_fact');

  // Trust downgrade: a fact exists but is not chip-safe; surface a rerun.
  const trustDowngrade =
    contradictions.includes('status_ready_with_actionable_blockers') ||
    contradictions.includes('fact_status_success_but_degraded_newer');

  // Prose may reference fresh / stale / (legacy) unknown analysis with a
  // caveat. 'none' has no fact to reference.
  const usableForProse =
    hasFact &&
    !blockedUnusable &&
    (derivation.freshness === 'fresh' ||
      derivation.freshness === 'stale' ||
      derivation.freshness === 'unknown');

  // Result-exploration chips require fresh, trustworthy analysis. Stale or
  // trust-downgraded analysis offers only a rerun chip (via requiresRerun).
  const usableForChips =
    hasFact && derivation.freshness === 'fresh' && !blockedUnusable && !trustDowngrade;

  // Follow-up handlers (e.g. explain_results) treat fresh OR stale as
  // "analysis exists to reference".
  const usableForFollowupContext = hasFact && !blockedUnusable;

  const requiresRerun =
    hasFact && (derivation.freshness === 'stale' || trustDowngrade);

  return {
    version: CANONICAL_ANALYSIS_STATE_VERSION,
    status,
    freshness: derivation.freshness,
    freshness_reason: derivation.reason,
    selected_fact_index: derivation.selected_fact_index,
    computed_at: derivation.computed_at,
    graph_hash_at_run: derivation.graph_hash_at_run,
    current_graph_hash: derivation.current_graph_hash,
    blockers,
    model_adjustments: modelAdjustments,
    goal_node_id: goalNodeId,
    degraded_fact_status: params.degradedStatus,
    contradictions,
    usableForProse,
    usableForChips,
    usableForFollowupContext,
    requiresRerun,
    blockedUnusable,
  };
}

/**
 * Redacted, leak-safe projection of the canonical state for the
 * diagnostic `_context_summary` surface and Harness A1/A2. Carries only
 * statuses, predicates, counts and hashes — NEVER raw blocker messages,
 * option labels, prose or user text. This is the ONLY shape that should
 * cross the diagnostic boundary; the full {@link CanonicalAnalysisState}
 * (with blocker/adjustment objects) stays server-internal.
 */
export interface AnalysisStateSummary {
  readonly status: AnalysisReadyStatusT | null;
  readonly freshness: AnalysisFreshnessT;
  readonly freshness_reason: FreshnessReason;
  readonly usable_for_prose: boolean;
  readonly usable_for_chips: boolean;
  readonly usable_for_followup_context: boolean;
  readonly requires_rerun: boolean;
  readonly blocked_unusable: boolean;
  readonly blocker_count: number;
  readonly actionable_blocker_count: number;
  readonly selected_fact_index: number | null;
  readonly graph_hash_at_run: string | null;
  readonly current_graph_hash: string | null;
  readonly degraded_fact_status: string | null;
  readonly contradiction_codes: readonly CanonicalContradiction[];
}

/**
 * Project the full canonical state to its redacted summary. Counts only —
 * blocker objects (which carry user-facing messages and labels) are
 * reduced to `blocker_count` / `actionable_blocker_count`.
 */
export function summariseCanonicalAnalysisState(
  state: CanonicalAnalysisState,
): AnalysisStateSummary {
  const actionableBlockerCount = state.blockers.filter((b) => {
    const type = readBlockerType(b);
    return type !== null && ACTIONABLE_BLOCKER_TYPES.has(type);
  }).length;
  return {
    status: state.status,
    freshness: state.freshness,
    freshness_reason: state.freshness_reason,
    usable_for_prose: state.usableForProse,
    usable_for_chips: state.usableForChips,
    usable_for_followup_context: state.usableForFollowupContext,
    requires_rerun: state.requiresRerun,
    blocked_unusable: state.blockedUnusable,
    blocker_count: state.blockers.length,
    actionable_blocker_count: actionableBlockerCount,
    selected_fact_index: state.selected_fact_index,
    graph_hash_at_run: state.graph_hash_at_run,
    current_graph_hash: state.current_graph_hash,
    degraded_fact_status: state.degraded_fact_status,
    contradiction_codes: state.contradictions,
  };
}
