/**
 * ⭐ A SIZE THE USER STATED FOR A NEW FACTOR'S LINK — read from THEIR words, never from the Agent's.
 *
 * ⚠ SERVED (R&C `dloop3x-2`, CEE ecd379a, #70 5854144804): "launch a retention programme that we expect to cut monthly
 * churn by 3 percentage points". The Agent added a graded factor and recorded "3" as its LEVEL, while the link into churn
 * was Olumi's placeholder ("how strongly is not known yet: Olumi used a placeholder strength"). The verdict on the new
 * option rested on that placeholder, and the user's 3 points moved nothing.
 *
 * THE MEANING (AI Quality #70 5854410205, binding):
 *   1. POINTS ARE POINTS: "falls by 3 points" on a percentage level is 7% → 4%, never 7% × 0.97 and never 3% of the range.
 *      Read with the classifier's own `percentage_points` row (`isPercentagePointsWithPeriod`) or the same points tail on a
 *      quantity that is already a percentage level (`isPointsWithPeriod`); no new word list. A bare "3%" is NOT points:
 *      it is asked, never guessed.
 *   2. SIGN FROM THE VERB: the size is positive; `direction` (falls / rises) signs it.
 *   4. WHOSE SIZE: the figure must be the user's own, written about the quantity it changes (`figureTheUserWroteFor`).
 *
 * The UNIT the user meant is read from the user's own words beside the figure — never from the unit the Agent passes,
 * which could turn the user's "3%" into "3 percentage points" by itself.
 *
 * PURE. Scope, today: a stated size is taken only on a PERCENTAGE-LEVEL target (the served case). Any other target is
 * refused with what to do, so the user's size is said to be unrecorded rather than silently read in the wrong unit.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { isPercentageLevel, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { isPercentagePointsWithPeriod, isPointsWithPeriod } from './admit-constraint.js';
import { figureTheUserWroteFor, type EntityScope } from './stated-by-user.js';

/** What the Agent passes: the user's figure, and the unit words it heard (checked, never trusted). */
export interface StatedEffectAsked {
  readonly amount?: unknown;
  readonly unit?: unknown;
}

export type StatedEffectReading =
  | { readonly ok: true; readonly effect_amount: number }
  | {
      readonly ok: false;
      readonly refusal: 'stated_effect_invalid' | 'stated_effect_not_users' | 'stated_effect_target_not_a_percentage' | 'stated_effect_not_points';
      readonly detail: string;
      /** The one question for the user, in their terms, when the answer is theirs to give. */
      readonly say?: string;
    };

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const fmt = (x: number): string => String(Number(x.toPrecision(6)));

/** The first one and two words right after the figure (a written "%" leads, when the figure carried one). */
function unitPhrasesAfter(text: string, a: { index: number; matchedText: string; kind: string }): string[] {
  const after = text.slice(a.index + a.matchedText.length);
  const m = /^[ \t]*([\p{L}%]+)(?:[ \t]+([\p{L}]+))?/u.exec(after);
  const lead = a.kind === 'percent' ? '%' : '';
  const one = [lead, m?.[1] ?? ''].join(' ').trim();
  const two = m?.[2] !== undefined ? `${one} ${m[2]}` : one;
  return one === two ? [one] : [one, two];
}

/**
 * Read "falls by 3 percentage points" into the change in the TARGET's own unit per switching the new factor on: −3 on a
 * percentage level. Refuses, with what to say, whenever the figure is not the user's, the target is not a percentage
 * level, or the user's own words do not say points.
 */
export function readStatedEffect(
  asked: StatedEffectAsked,
  direction: 'positive' | 'negative',
  factorLabel: string,
  target: MagnitudeNode,
  userText: string | null | undefined,
  scope: EntityScope,
): StatedEffectReading {
  const amount = asked.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, refusal: 'stated_effect_invalid',
      detail: `The size for how "${factorLabel}" changes "${target.label}" must be the figure the user gave, as a positive number `
        + '(3 for "falls by 3 points"); which way it goes is `direction`. Nothing was prepared.' };
  }
  if (!figureTheUserWroteFor(amount, asked.unit, userText, scope)) {
    return { ok: false, refusal: 'stated_effect_not_users',
      detail: `The user did not write ${fmt(amount)} as how much "${factorLabel}" changes "${target.label}". Nothing was prepared. `
        + 'Call propose_new_option again without stated_effect (the link is then Olumi’s placeholder, and you say so), '
        + 'or ask the user how much it changes it.' };
  }
  if (!isPercentageLevel(target)) {
    return { ok: false, refusal: 'stated_effect_target_not_a_percentage',
      detail: `Olumi can take a stated size for "${target.label}" only as points of a percentage for now, and "${target.label}" `
        + 'is not measured as one. Nothing was prepared. Call propose_new_option again without stated_effect, and tell the user '
        + 'plainly that the size they gave is not recorded yet: the link is Olumi’s placeholder until it is.' };
  }
  const phrases = findStatedAmounts(userText ?? '')
    .filter((a) => a.kind !== 'currency' && same(a.magnitude, amount))
    .map((a) => ({ percent: a.kind === 'percent', phrases: unitPhrasesAfter(userText ?? '', a) }));
  const points = phrases.some((o) => o.phrases.some((p) => isPercentagePointsWithPeriod(p) || (!o.percent && isPointsWithPeriod(p))));
  if (!points) {
    const said = phrases.some((o) => o.percent) ? `${fmt(amount)}%` : fmt(amount);
    const say = `Do you mean "${target.label}" moves by ${fmt(amount)} percentage points, or by ${fmt(amount)}% of its level today?`;
    return { ok: false, refusal: 'stated_effect_not_points', say,
      detail: `The user wrote "${said}", which does not say percentage points, so it could be either a change of ${fmt(amount)} points `
        + `or ${fmt(amount)}% of today's "${target.label}". Nothing was prepared, and neither is picked for them. Ask exactly: "${say}"` };
  }
  return { ok: true, effect_amount: direction === 'negative' ? -amount : amount };
}
