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
  // A bound on a RISE caps it (<=) or floors it (>=); on a FALL the same comparator reads the other way round:
  // "change <= -15%" is a fall of AT LEAST 15%.
  const rising = fraction >= 0;
  const words = operator === '<=' ? (rising ? 'no more than' : 'at least')
    : operator === '<' ? (rising ? 'less than' : 'more than')
      : operator === '>=' ? (rising ? 'at least' : 'no more than')
        : (rising ? 'more than' : 'less than');
  return `${words} ${pct}% ${side} today`;
}
