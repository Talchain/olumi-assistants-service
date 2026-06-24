/**
 * INV-3 EP2 readiness parity.
 *
 * The spike NEVER invents a readiness rule — it delegates to EP2
 * `assessAnalysisReadiness` (analysis-ready-core.ts), so a candidate's verdict
 * is parity-true with the live read-boundary by construction. The canonical
 * analysis-state selector does not wrap EP2 on this path (pinned fact), so EP2
 * is the correct parity target; the canonical-state freshness axis is already
 * covered by the base_graph_hash stale gate.
 */
import { assessAnalysisReadiness, ep2State } from '../tools/handlers/analysis-ready-core.js';
import type { ReadinessResult, Ep2State } from '../tools/handlers/analysis-ready-core.js';

export interface Ep2Assessment {
  readonly result: ReadinessResult;
  readonly state: Ep2State;
}

export function assessCandidate(candidate: unknown): Ep2Assessment {
  const result = assessAnalysisReadiness(candidate);
  return { result, state: ep2State(result) };
}

/**
 * Map an EP2 verdict to a spike verdict for a REPRESENTABLE candidate (e.g.
 * rename). `would_apply` iff EP2 is ready/repaired; a user-actionable
 * option-value defer is `clarify_required`; any other block is a hard `held`.
 */
export function ep2VerdictForRepresentable(
  a: Ep2Assessment,
): 'would_apply' | 'held' | 'clarify_required' {
  if (a.state === 'ready' || a.state === 'repaired_for_analysis') return 'would_apply';
  if (a.result.reasonCategory === 'option_values' && a.result.userActionRequired) {
    return 'clarify_required';
  }
  return 'held';
}
