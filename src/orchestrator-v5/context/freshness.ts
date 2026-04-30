/**
 * V5 state-trust — analysis freshness derivation.
 *
 * Replaces the unconditional "loaded_from_prior_run_freshness_unknown"
 * fallback in turn-executor.ts with a deterministic decision based on
 * comparing the graph hash at the time `run_analysis` executed against
 * the current graph hash.
 *
 * Inputs (read-only):
 *   - priorFacts: the handler-fact chain loaded for this turn
 *   - currentGraphHash: hash of the analysis-affecting fields of the
 *     graph this turn is running against (from
 *     computeAnalysisAffectingGraphHash on the turn's graph_state)
 *
 * Output: FreshnessDerivation — the freshness verdict plus its reason
 * and the selected fact's metadata. The verdict drives:
 *   - analysis_ready.freshness on the wire
 *   - rerun-chip emission (only when 'stale')
 *   - analysis_ready.computed_at (uses the selected fact's computed_at,
 *     not Date.now)
 *   - the TurnOutcome internal contract
 *
 * No side effects. No reads from disk or env. All decisions derive from
 * the inputs alone — replacing them with mocks in tests is a function
 * call, not a mock injection.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * Four-valued freshness state. Reachable from new code paths only as
 * 'fresh' / 'stale' / 'none'; 'unknown' is the legacy/recovery escape
 * hatch for pre-0.10.0 facts and invariant-violation fallback.
 */
export type AnalysisFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

/**
 * Reasons emitted in `FreshnessDerivation.reason`. Stable string codes —
 * UI consumers may surface them via `analysis_ready.freshness_reason`,
 * telemetry filters by exact equality, contract tests assert by name.
 */
export type FreshnessReason =
  | 'graph_hash_match'
  | 'graph_hash_diverged'
  | 'legacy_fact_missing_hash'
  | 'current_graph_hash_unavailable'
  | 'no_successful_run_analysis_fact'
  | 'invariant_failed';

/**
 * Verdict + provenance. `computed_at` is the selected fact's run-time
 * timestamp, threaded into analysis_ready so explain/direct-answer turns
 * cannot restamp it.
 */
export interface FreshnessDerivation {
  readonly freshness: AnalysisFreshness;
  readonly reason: FreshnessReason;
  /**
   * Position of the selected fact within the prior-fact array (newest-
   * first per build-turn-context loader convention). Null when no
   * successful fact was selected. Used as a stable identifier in
   * telemetry; the schemas package does not surface fact row UUIDs
   * through `readFactsFor`, so position-in-array is the available
   * deterministic key.
   */
  readonly selected_fact_index: number | null;
  readonly graph_hash_at_run: string | null;
  readonly current_graph_hash: string | null;
  /** ISO timestamp from the selected fact's `computed_at`. Null when
   *  no fact was selected, or selected fact predates 0.10.0. */
  readonly computed_at: string | null;
}

/**
 * Status values that count as "successful" for freshness selection.
 * Excludes 'partial', 'blocked', 'degraded', 'failed' — partial / failed
 * runs must not drive the freshness verdict per the brief.
 *
 * The handler throws HandlerInvocationFailedError on fatal statuses
 * (blocked, failed) so those should never reach a persisted fact, but
 * we filter them anyway for defence-in-depth against future fact rows.
 */
const SUCCESSFUL_ANALYSIS_STATUSES = new Set([
  'computed',
  'completed',
  'ready',
]);

interface RunAnalysisFactView {
  readonly fact: HandlerFact;
  readonly index: number;
  readonly graph_hash_at_run: string | null;
  readonly computed_at: string | null;
  readonly status: string | null;
}

function readAnalysisStatus(enrichment: unknown): string | null {
  if (!enrichment || typeof enrichment !== 'object') return null;
  const raw = (enrichment as Record<string, unknown>).analysis_status;
  return typeof raw === 'string' ? raw : null;
}

function isRunAnalysisFact(
  fact: HandlerFact,
): fact is HandlerFact & { fact_type: 'run_analysis' } {
  return fact.fact_type === 'run_analysis';
}

function viewRunAnalysisFact(
  fact: HandlerFact,
  index: number,
): RunAnalysisFactView | null {
  if (!isRunAnalysisFact(fact)) return null;
  if (fact.noop !== false) return null;
  const result = fact.result;
  return {
    fact,
    index,
    graph_hash_at_run:
      typeof result.graph_hash_at_run === 'string' ? result.graph_hash_at_run : null,
    computed_at:
      typeof result.computed_at === 'string' ? result.computed_at : null,
    status: readAnalysisStatus(result.enrichment),
  };
}

/**
 * Select the most recent successful run_analysis fact. "Successful" =
 * known-success status OR status missing entirely (legacy fact). Sorted
 * by computed_at desc; ties + missing timestamps fall back to the
 * insertion order from prior_facts (which build-turn-context delivers
 * newest-first per its loader convention).
 *
 * Returns null when no eligible fact exists — the caller treats this as
 * freshness === 'none'.
 */
function selectFact(
  priorFacts: readonly HandlerFact[],
): RunAnalysisFactView | null {
  const candidates: RunAnalysisFactView[] = [];
  for (let i = 0; i < priorFacts.length; i += 1) {
    const view = viewRunAnalysisFact(priorFacts[i]!, i);
    if (!view) continue;
    // Successful filter: known-success OR status missing (legacy).
    if (view.status !== null && !SUCCESSFUL_ANALYSIS_STATUSES.has(view.status)) {
      continue;
    }
    candidates.push(view);
  }
  if (candidates.length === 0) return null;

  // Stable sort by computed_at desc, putting facts without computed_at
  // last. JavaScript Array.sort is stable in V8, so insertion order is
  // preserved among facts that compare equal (same timestamp or both
  // null) — and build-turn-context delivers newest-first, so the
  // first equal-keyed fact is the freshest by insertion.
  candidates.sort((a, b) => {
    if (a.computed_at !== null && b.computed_at !== null) {
      // Lexicographic ISO compare is correct for desc sort.
      if (a.computed_at < b.computed_at) return 1;
      if (a.computed_at > b.computed_at) return -1;
      return 0;
    }
    if (a.computed_at !== null) return -1; // a is fresher than untimestamped b
    if (b.computed_at !== null) return 1;
    return 0;
  });
  return candidates[0]!;
}

function assertExhaustive(value: never): never {
  throw new Error(`unreachable freshness state: ${String(value)}`);
}

/**
 * Validate post-derivation invariants. Returns null on pass, or an
 * invariant-violation reason on fail. Hard violations cause the caller
 * to fall back to 'unknown' and emit telemetry.
 *
 * Soft invariants (monotonicity, previous-fresh) are NOT enforced here
 * because the previous-turn outcome is not reliably persisted yet
 * — they are checked by the turn-executor as telemetry warnings only.
 */
function checkHardInvariants(
  derivation: FreshnessDerivation,
): FreshnessReason | null {
  // Invariant 1: enum exhaustiveness. TypeScript already enforces this at
  // compile time via the union type, but a runtime guard catches any
  // sneaky `as unknown` upstream.
  switch (derivation.freshness) {
    case 'fresh':
    case 'stale':
    case 'unknown':
    case 'none':
      break;
    default:
      assertExhaustive(derivation.freshness);
  }

  // Invariant 2: if both hashes are present, freshness must be 'fresh'
  // or 'stale' — never 'unknown'. Unknown should only fire when data is
  // genuinely missing.
  if (
    derivation.graph_hash_at_run !== null &&
    derivation.current_graph_hash !== null &&
    derivation.freshness === 'unknown'
  ) {
    return 'invariant_failed';
  }

  return null;
}

/**
 * Derive freshness for the current turn. Pure function, no side effects.
 *
 * Decision tree:
 *   - No successful run_analysis fact → none
 *   - Successful fact selected, missing graph_hash_at_run → unknown
 *     (legacy fact predating 0.10.0)
 *   - Successful fact selected, currentGraphHash null → unknown
 *     (graph absent on this turn)
 *   - Hashes match → fresh
 *   - Hashes differ → stale
 *
 * Caller is responsible for emitting the `analysis_freshness.derived`
 * telemetry event with the returned derivation. The function does not
 * import or call telemetry to keep the unit-test surface minimal and
 * the function side-effect-free.
 */
export function deriveAnalysisFreshness(
  priorFacts: readonly HandlerFact[],
  currentGraphHash: string | null,
): FreshnessDerivation {
  const selected = selectFact(priorFacts);

  if (selected === null) {
    const noFact: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: null,
    };
    return enforceInvariants(noFact);
  }

  if (selected.graph_hash_at_run === null) {
    return enforceInvariants({
      freshness: 'unknown',
      reason: 'legacy_fact_missing_hash',
      selected_fact_index: selected.index,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: selected.computed_at,
    });
  }

  if (currentGraphHash === null) {
    return enforceInvariants({
      freshness: 'unknown',
      reason: 'current_graph_hash_unavailable',
      selected_fact_index: selected.index,
      graph_hash_at_run: selected.graph_hash_at_run,
      current_graph_hash: null,
      computed_at: selected.computed_at,
    });
  }

  if (selected.graph_hash_at_run === currentGraphHash) {
    return enforceInvariants({
      freshness: 'fresh',
      reason: 'graph_hash_match',
      selected_fact_index: selected.index,
      graph_hash_at_run: selected.graph_hash_at_run,
      current_graph_hash: currentGraphHash,
      computed_at: selected.computed_at,
    });
  }

  return enforceInvariants({
    freshness: 'stale',
    reason: 'graph_hash_diverged',
    selected_fact_index: selected.index,
    graph_hash_at_run: selected.graph_hash_at_run,
    current_graph_hash: currentGraphHash,
    computed_at: selected.computed_at,
  });
}

function enforceInvariants(
  derivation: FreshnessDerivation,
): FreshnessDerivation {
  const violation = checkHardInvariants(derivation);
  if (violation === null) return derivation;
  // Hard invariant failed — fall back to 'unknown' (NEVER 'stale') and
  // overwrite the reason with the violation marker. Caller checks for
  // reason === 'invariant_failed' to emit the
  // analysis_freshness.invariant_failed telemetry event.
  return {
    ...derivation,
    freshness: 'unknown',
    reason: 'invariant_failed',
  };
}
