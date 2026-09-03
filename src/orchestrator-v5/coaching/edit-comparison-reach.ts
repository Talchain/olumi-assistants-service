/**
 * CAN THIS EDIT MOVE THE OPTION COMPARISON? — the one derivation both
 * edit-time surfaces read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE SCOPE IS NARROWER THAN "IS THIS FACTOR AT ZERO", AND THE DIFFERENCE
 * IS LOAD-BEARING (CLAUDE.md trap #21 — write down the question each authority
 * answers before combining them).
 *
 *   `zeroEffectReasonFor` (`coaching/zero-effect-factors.ts`) answers
 *     "did the last analysis SCORE this factor at zero?"
 *   That licenses refusing a CAUSAL sentence about a movement already
 *   observed: a factor scored at zero in the run being described cannot be why
 *   the run moved.
 *
 *   THIS MODULE answers
 *     "will editing this factor's value move the comparison?"
 *   which is a claim about the FUTURE, and a measured zero does not support
 *   it. `sensitivity_score: 0` is a LOCAL derivative at the old operating
 *   point; a genuinely non-linear factor can be flat there and steep at the
 *   new value. Telling such a user "changing this will not move the
 *   comparison" would be a fabrication in the opposite direction.
 *
 * So only the two STRUCTURAL grounds count as inert here:
 *   - every option supplies its own value (derived from the graph), or
 *   - the producer named `intervention_override` as the zero's cause (derived
 *     from the analysis).
 * Both say the baseline is never read AT ANY VALUE. A bare measured zero does
 * NOT, and is deliberately excluded.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ TWO INDEPENDENT WITNESSES, UNIONED — and that is the completeness check
 * each of them needs from outside itself. The graph read fires before any
 * analysis exists and when the last one is stale; the producer read fires when
 * the graph shape is one this repo's enumeration does not reach. A guard
 * derived only from the graph proves the graph agrees with itself.
 *
 * PURE AND TOTAL.
 */

import { baselineOverrideReach } from '../context/baseline-override-reach.js';

import { collectZeroEffectFactors, zeroEffectReasonFor } from './zero-effect-factors.js';

/**
 * On what evidence the verdict rests. Typed rather than commented so a test —
 * or triage — can tell the two witnesses apart, and so a future reader can see
 * at a glance which one is firing on the live path.
 */
export type EditComparisonReachBasis =
  | 'every_option_overrides'
  | 'producer_intervention_override'
  | 'both';

export type EditComparisonReach =
  /** The factor's value is a baseline every option replaces. An edit cannot move the comparison. */
  | { readonly kind: 'inert'; readonly basis: EditComparisonReachBasis }
  /** At least one option consumes this factor's own value. An edit can move the comparison. */
  | { readonly kind: 'reaches' }
  /** Not derivable. Claim nothing in either direction. */
  | { readonly kind: 'unknown' };

/**
 * @param graph                     the RAW turn graph, or null/undefined when
 *                                  unavailable on this path.
 * @param priorAnalysisEnrichment   `result.enrichment` of the newest analysis
 *                                  the user has been shown, or null.
 * @param factorId                  the STRUCTURAL id of the edited factor.
 */
export function deriveEditComparisonReach(input: {
  readonly graph: unknown;
  readonly priorAnalysisEnrichment: unknown;
  readonly factorId: string;
}): EditComparisonReach {
  const structural = baselineOverrideReach(input.graph, input.factorId);
  const producerReason = zeroEffectReasonFor(
    collectZeroEffectFactors(input.priorAnalysisEnrichment),
    input.factorId,
  );
  const producerSaysOverridden = producerReason === 'intervention_override';

  if (structural.kind === 'replaced_by_every_option') {
    return {
      kind: 'inert',
      basis: producerSaysOverridden ? 'both' : 'every_option_overrides',
    };
  }
  if (producerSaysOverridden) {
    return { kind: 'inert', basis: 'producer_intervention_override' };
  }
  // ⭐ THE STRUCTURAL VERDICT WINS THE NEGATIVE, AND ONLY THE STRUCTURAL ONE
  // CAN. `reaches_comparison` means an option was enumerated that does NOT
  // override this factor — a positive observation. The producer read has no
  // equivalent: the absence of a `zero_reason` is not a statement that the
  // factor is live (the entry may be missing, the analysis stale, the envelope
  // thin), so it can never contribute a `reaches`.
  if (structural.kind === 'reaches_comparison') return { kind: 'reaches' };
  return { kind: 'unknown' };
}
