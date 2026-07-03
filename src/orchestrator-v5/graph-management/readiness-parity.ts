/**
 * Track 3 — R6 EP2 readiness parity.
 *
 * NEVER invents a readiness rule — delegates to EP2 `assessAnalysisReadiness`
 * (analysis-ready-core.ts), so a candidate's readiness is parity-true with the
 * live read boundary by construction (PR #300 invariant). The canonical
 * analysis-state selector does not wrap EP2 on this path (verified — Agent 3), so
 * EP2 is the correct parity target; the freshness axis is the frame's job.
 *
 * R6 = NON-DOWNGRADE (T4.0 contract): a candidate must not make the graph LESS
 * analysis-ready than the base it was built from. A downgrade → held
 * (READINESS_DOWNGRADE). Option-value defers that require user action → clarify.
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

/** ready(2) > repaired_for_analysis(1) > blocked(0). */
export function ep2Rank(state: Ep2State): number {
  switch (state) {
    case 'ready':
      return 2;
    case 'repaired_for_analysis':
      return 1;
    case 'blocked':
      return 0;
    default: {
      const _never: never = state;
      return _never;
    }
  }
}

export function readinessDowngraded(base: Ep2Assessment, candidate: Ep2Assessment): boolean {
  return ep2Rank(candidate.state) < ep2Rank(base.state);
}

export type RepresentableVerdict =
  | { readonly verdict: 'would_apply' }
  | { readonly verdict: 'held'; readonly downgrade: true }
  | { readonly verdict: 'clarify_required' };

/**
 * Map base+candidate EP2 assessments to a verdict for a REPRESENTABLE candidate
 * (rename_node). Non-downgrade first (held), then option-value defer (clarify),
 * else would_apply — a neutral edit that does not reduce readiness is safe to
 * apply even if the graph was already structurally incomplete.
 */
export function representableVerdict(
  base: Ep2Assessment,
  candidate: Ep2Assessment,
): RepresentableVerdict {
  if (readinessDowngraded(base, candidate)) {
    return { verdict: 'held', downgrade: true };
  }
  if (
    candidate.result.reasonCategory === 'option_values' &&
    candidate.result.userActionRequired &&
    !(base.result.reasonCategory === 'option_values' && base.result.userActionRequired)
  ) {
    return { verdict: 'clarify_required' };
  }
  return { verdict: 'would_apply' };
}
