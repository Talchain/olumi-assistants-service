/**
 * The frame a limit (or a goal target) is stated in — a LEAF module: no imports, so the ask builders and admission can
 * share ONE predicate without an import cycle (`limit-operator-words.ts` precedent, #72 5863059333).
 *
 * `@talchain/schemas` 0.61.0 (R1, design MG #72 5871257542; meaning AIQ 5871459631):
 *   · `level`      — the value itself ("total cost under £250k").
 *   · `change_abs` — a change from TODAY in the quantity's own unit ("churn no more than 2 points higher than now").
 *   · `change_rel` — a change from today as a fraction of today's level ("cost no more than 10% above today" = 0.10).
 *   · `delta`      — LEGACY: a change from the MODEL'S ORIGIN. It gets no new writers; a drafter `delta` (whose prompt
 *                    defined it as a change from today) is written as `change_abs`.
 */

/** A frame that states a CHANGE rather than a level (legacy `delta` included). */
export function isChangeFrame(frame: unknown): frame is 'change_abs' | 'change_rel' | 'delta' {
  return frame === 'change_abs' || frame === 'change_rel' || frame === 'delta';
}

/**
 * Whether checking a limit in this frame needs the quantity's level TODAY. A level does (it is compared with the
 * quantity), and so does a relative change (it is relative TO today's level: ISL refuses one with no base,
 * GOAL_BASE_MISSING). An absolute change does not: ISL reads it against the status quo on the same draw. An absent
 * frame is treated as a level, as before.
 */
export function limitNeedsTodaysLevel(frame: unknown): boolean {
  return frame !== 'change_abs' && frame !== 'delta';
}

/** "no more than 10% above today" — a relative change said in words, never as the stored fraction. */
export function sayRelativeChange(operator: '>=' | '<=' | '>' | '<', fraction: number): string {
  const pct = Math.round(Math.abs(fraction) * 100 * 1e6) / 1e6;
  const side = fraction < 0 ? 'below' : 'above';
  return `${changeWords(operator, fraction >= 0)} ${pct}% ${side} today`;
}

/**
 * The comparator of a CHANGE, in words. A bound on a RISE caps it (<=) or floors it (>=); on a FALL the same comparator
 * reads the other way round: "change <= -15%" is a fall of AT LEAST 15%.
 */
function changeWords(operator: '>=' | '<=' | '>' | '<', rising: boolean): string {
  return operator === '<=' ? (rising ? 'no more than' : 'at least')
    : operator === '<' ? (rising ? 'less than' : 'more than')
      : operator === '>=' ? (rising ? 'at least' : 'no more than')
        : (rising ? 'more than' : 'less than');
}

/**
 * ⭐ THE ONE WAY A STORED LIMIT IS SAID (R1 S4-core; consumer map 28 Sep: 9 CEE sites printed "operator value unit").
 * A LEVEL (or no frame, or legacy `delta`) is said exactly as before: `${words} ${figure(value, unit)}`, byte-identical.
 * A CHANGE is said as the change it is, from today: `change_rel` 0.1 → "no more than 10% above today" (never "at most
 * 0.1"); `change_abs` 5000 GBP → "no more than £5,000 above today". `words` is the level vocabulary
 * (`LIMIT_OPERATOR_WORDS`) and `figure` the caller's own number formatter, passed in so this leaf stays import-free.
 */
export function sayLimitInFrame(args: {
  readonly operator: '>=' | '<=' | '>' | '<';
  readonly value: number;
  readonly unit?: string;
  readonly frame?: unknown;
  readonly words: Readonly<Record<'>=' | '<=' | '>' | '<', string>>;
  readonly figure: (value: number, unit: string | undefined) => string;
}): string {
  const { operator, value, unit, frame, words, figure } = args;
  if (frame === 'change_rel') return sayRelativeChange(operator, value);
  if (frame === 'change_abs') {
    const rising = value >= 0;
    return `${changeWords(operator, rising)} ${figure(Math.abs(value), unit)} ${rising ? 'above' : 'below'} today`;
  }
  return `${words[operator]} ${figure(value, unit)}`;
}
