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
  AnalysisBlockerT,
  AnalysisFreshnessT,
  AnalysisReadyStatusT,
  ModelAdjustmentT,
} from '../../schemas/analysis-ready.js';
import {
  deriveAnalysisFreshness,
  selectDegradedRunAnalysisFact,
  selectRunAnalysisFact,
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

/**
 * Minimal structural view of the readiness payload the selector reads.
 * Both `computeStructuralReadiness` output and the full
 * `AnalysisReadyPayload` satisfy it — the selector only needs status,
 * blockers, model adjustments and the goal node id. Kept structural so
 * the selector does not couple to any one producer's concrete type.
 */
export interface ReadinessLike {
  readonly status?: AnalysisReadyStatusT | null;
  readonly blockers?: readonly AnalysisBlockerT[];
  readonly model_adjustments?: readonly ModelAdjustmentT[];
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
  readonly blockers: readonly AnalysisBlockerT[];
  readonly model_adjustments: readonly ModelAdjustmentT[];
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

  const status: AnalysisReadyStatusT | null = input.readiness?.status ?? null;
  const blockers: readonly AnalysisBlockerT[] = input.readiness?.blockers ?? [];
  const modelAdjustments: readonly ModelAdjustmentT[] =
    input.readiness?.model_adjustments ?? [];
  const goalNodeId: string | null = input.readiness?.goal_node_id ?? null;

  const hasFact = derivation.selected_fact_index !== null;

  // ── Contradictions (fail-loud, never silently reconciled) ──
  const contradictions: CanonicalContradiction[] = [];

  if (input.scenarioClaimsAnalysis === true && !hasFact) {
    contradictions.push('scenario_claims_analysis_no_fact');
  }

  // A real fact with a run hash, but the current graph could not be hashed
  // → the freshness comparison is impossible despite a genuine fact.
  if (
    hasFact &&
    input.currentGraphHash === null &&
    derivation.graph_hash_at_run !== null
  ) {
    contradictions.push('fact_present_graph_unparseable');
  }

  // Actionable blockers on a 'ready' payload are a should-never-happen
  // integrity violation. Advisory constraint_dropped blockers do NOT count.
  const actionableBlockerCount = blockers.filter((b) =>
    ACTIONABLE_BLOCKER_TYPES.has(b.blocker_type),
  ).length;
  if (status === 'ready' && actionableBlockerCount > 0) {
    contradictions.push('status_ready_with_actionable_blockers');
  }

  // A newer run failed/partial while an older success would be presented
  // as current. Only provable when both timestamps are present.
  const degradedComputedAt = degraded ? readComputedAt(degraded.fact) : null;
  if (
    degraded !== null &&
    selected !== null &&
    degradedComputedAt !== null &&
    selected.computed_at !== null &&
    degradedComputedAt > selected.computed_at
  ) {
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
    degraded_fact_status: degraded?.status ?? null,
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
  const actionableBlockerCount = state.blockers.filter((b) =>
    ACTIONABLE_BLOCKER_TYPES.has(b.blocker_type),
  ).length;
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
