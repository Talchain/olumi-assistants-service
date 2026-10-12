/** G: the AI reads effect timing; code retains the held-target licence and Olumi's static-model assumption. */
import { periodEndWords, type GoalTargetBasis } from './goal-target-basis.js';

/** The AIE's note, verbatim, with {period} as the period-end words E's withhold uses ("month three"). Said once per result. */
export const PERIOD_END_ASSUMPTION_NOTE_TEMPLATE = 'Provisional: this calculation assumes the estimated effects are in place by {period}. It does not model when they arrive.';

export function periodEndAssumptionNote(basis: Pick<GoalTargetBasis, 'reference' | 'period_months'>): string {
  return PERIOD_END_ASSUMPTION_NOTE_TEMPLATE.replace('{period}', periodEndWords(basis));
}

/** Olumi's reading of the conversation, never a human attestation of effects_at_period_end. */
export type EffectsTiming = 'in_place_by_period' | 'later_or_partial' | 'not_stated';

export function effectsTimingOf(value: unknown): EffectsTiming | undefined {
  return value === 'in_place_by_period' || value === 'later_or_partial' || value === 'not_stated' ? value : undefined;
}
