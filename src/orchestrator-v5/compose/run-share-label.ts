/**
 * ⭐ THE AIE'S SUPPORTING LABEL FOR A SHARE OF RUNS ON A REASONING SURFACE (#94 6132054663; the label CORRECTED in
 * 6133633297). Same-Run comparative support is kept as supporting reasoning, never the headline and never the chance of
 * meeting the goal. Only the what_would_flip standing lines say it (`explanation-fallback.ts`, opt-in at that one caller):
 * "‘X’: Share of model runs credited to this option: 62%." for each option it names, then the qualifier once. "Credited",
 * not "ranks first": ISL splits a tied run's win between the tied options (robustness_analyzer_v2.py:6096–6103), so the
 * share is a credit, not a strict first-place frequency, and the qualifier says so. The number is unchanged: that option's
 * own-Run `win_probability` (the context pack's validated, finite [0, 1] share), formatted by `formatProbability` ("<1%"
 * and ">99%" at the rounding edges); never a tipping-point input, a goal probability, an interval or a confidence. The
 * withheld gate sees the label (`runs_credited`, `leading-option-egress-guard.ts`).
 */

/** The AIE's exact fixed qualifier (#94 6133633297). */
export const RUN_SHARE_QUALIFIER =
  'This compares the analysed options; it is not the chance of meeting your goal. Tied runs split their credit.';

/** The AIE's exact supporting label (#94 6133633297); `share` is the formatted percentage, with its sign ("62%"). */
export function runShareSupportingLabel(share: string): string {
  return `Share of model runs credited to this option: ${share}.`;
}
