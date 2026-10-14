/**
 * The control arm of the compact-first-model live benchmark (`construction-compact-benchmark.live.test.ts`): today's
 * construction instructions with the compact clause swapped back for the clause that was served before it.
 *
 * Lives outside the `.live.test.ts` file so an OFFLINE row can pin it (`construction-user-named-risk.test.ts`): the
 * swap once stopped at "refused before it reaches the canvas.", which left the budget's user-material exception
 * ("...cannot fit this budget...") in a control that no longer states a budget (Codex CR on #2539 @83d6bed3).
 */
export const SERVED_WIDEN_CLAUSE =
  'Then widen: add the options, factors, risks, outcomes and causal mechanisms that materially improve strategic reasoning, including alternatives beyond the user’s initial frame.';

/** The compact clause this lane installed, as it appears in BUILD_INSTRUCTIONS. */
export const COMPACT_MARKER = 'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE';

/** The compact clause runs from its marker to the END of the budget instruction, exception included. */
const COMPACT_CLAUSE = new RegExp(`${COMPACT_MARKER}[\\s\\S]*?that model is admitted, not refused\\.`);

export function servedControlInstructions(instructions: string): string {
  return instructions.replace(COMPACT_CLAUSE, SERVED_WIDEN_CLAUSE);
}
