/**
 * ⭐⭐ THE PAYOFF TURN OFFERS THE NEXT ACT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEAD END, MEASURED IN THE SOURCE.
 *
 * Both post-apply paths in `turn-executor.ts` built their response with a
 * literal `suggested_actions: []` and then `return finalizeRun()` — at
 * `:4073` (accepted repair) and `:4405` (accepted value batch). Every
 * `generateChips(...)` call site is at `:13215` or below, on the execute /
 * clarify / coach / converse paths, so those returns are unreachable from any
 * chip step and `[]` was FINAL.
 *
 * So the sequence a user actually experienced was:
 *
 *   1. Olumi names the values it needs.
 *   2. The user supplies them.
 *   3. Olumi says "Confirmed. I applied N … The model now passes the
 *      readiness check."
 *   4. Nothing. No chip, no offer to run.
 *
 * ⛔ AND IT DEAD-ENDED EVEN WHEN THE MODEL WAS FULLY READY. This is not only
 * the admissible-but-not-ready case: a model the repair made `status: 'ready'`
 * got no offer either. The turn that exists to close the readiness loop was
 * the one turn that closed nothing.
 *
 * `readiness-intake.ts` records why "they can just click Analyse" is not a
 * sufficient answer: the canvas's own Analyse control is rendered
 * conditionally and can be unmounted on the tab the user is looking at.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ IT OFFERS BOTH, AND THAT IS THE PRODUCT ANSWER.
 *
 * Where the model is admitted AND something is still unsettled, the user gets
 * the run AND the repair. The model is runnable and improvable at the same
 * time, and which of those the team does next is their judgement. Withdrawing
 * the repair to advertise the run — or the reverse — would be Olumi deciding
 * for them.
 *
 * ⚠ THE RUN LEADS, AND POSITION IS LOAD-BEARING. The client renders
 * `polished.filter(isChipRenderable).slice(0, 3)` (`SuggestedChips.tsx:335`),
 * so anything past the third entry is never displayed. This returns at most
 * two.
 */
import { isRunAffordanceAdmitted } from '../admission/run-affordance-gate.js';
import { buildReadinessRecoveryChip } from '../coaching/readiness-recovery.js';

/** The executable run chip for a turn that has just applied the user's input. */
export const POST_APPLY_RUN_CHIP = Object.freeze({
  id: 'chip_action_run_analysis_post_apply',
  label: 'Run analysis',
  message: 'Run the analysis.',
  action_type: 'run_analysis' as const,
});

export interface PostApplyChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type?: 'run_analysis';
}

/**
 * Chips for the turn immediately after an accepted repair or value batch.
 *
 * Empty only when there is genuinely nothing to offer — no admission and no
 * recovery — which is the one case where silence is honest.
 */
export function buildPostApplyChips(
  readiness: { readonly status?: unknown; readonly may_run?: unknown } | undefined,
  nodes: readonly { readonly id?: unknown; readonly label?: unknown }[] = [],
): PostApplyChip[] {
  const recovery = buildReadinessRecoveryChip(
    readiness as Parameters<typeof buildReadinessRecoveryChip>[0],
    nodes as Parameters<typeof buildReadinessRecoveryChip>[1],
  );
  const chips: PostApplyChip[] = [];
  if (isRunAffordanceAdmitted(readiness)) chips.push({ ...POST_APPLY_RUN_CHIP });
  if (recovery) chips.push(recovery);
  return chips;
}
