/**
 * Claim-safe prose card for the what-if (counterfactual) lens.
 *
 * Composed ONLY after ISL returns a validated 2xx counterfactual (the caller
 * gates on that), so its existence is itself honest evidence that the what-if
 * is well-posed and computable. The card is APPENDED to the base
 * `what_would_flip` answer and therefore inherits the route egress claim cage
 * (`response-finaliser.ts` scrubs `FORBIDDEN_USER_FACING_PHRASES` + IDs on the
 * final `assistant_text`). It additionally follows the same copy rules as the
 * explanation fallbacks: sentence case, British English, no tone words
 * (winner / recommended), no internal tokens.
 *
 * ## Why no computed outcome number (ROADMAP honesty rail, req 5)
 *
 * ISL's `prediction.point_estimate` is in the GOAL's model-unit space, whose
 * user-facing scale/units are doctrine-pending. Quoting a raw model number
 * would risk misrepresenting it, so — per "prefer omitting doctrine-pending
 * numbers from user copy entirely" — the card names the concrete INTERVENTION
 * (the factor + a graph-provided model-unit target, in the factor's own
 * display units when they format exactly) but NOT the outcome value. This is
 * still a genuine increment over the existing flip prose, which deliberately
 * never quotes any concrete target. When the goal-value presentation doctrine
 * settles (P1/P2), the outcome estimate + CI can be added here without changing
 * the surrounding architecture.
 */

/** Which way the intervention moves the factor from its current value. */
export type CounterfactualDirection = 'raise' | 'lower' | 'change';

export interface CounterfactualCardInput {
  /** Display label of the intervened factor. */
  readonly factorLabel: string;
  /** Display label of the goal / outcome. */
  readonly goalLabel: string;
  /** Intervention direction relative to the factor's current value. */
  readonly direction: CounterfactualDirection;
  /**
   * Display-safe formatted target (e.g. "£40,000", "20 engineers"), or `null`
   * when the target could not be formatted exactly — in which case the card
   * omits the numeric target rather than round it.
   */
  readonly targetDisplay: string | null;
}

/**
 * Compose the claim-safe counterfactual suggestion sentence. Pure.
 */
export function composeCounterfactualCard(input: CounterfactualCardInput): string {
  const verb = input.direction === 'raise' ? 'raised' : input.direction === 'lower' ? 'lowered' : 'changed';
  const targetClause = input.targetDisplay ? ` to ${input.targetDisplay}` : '';
  return (
    `One further what-if worth exploring: how ${input.goalLabel} would respond if ` +
    `${input.factorLabel} were ${verb}${targetClause}.`
  );
}
