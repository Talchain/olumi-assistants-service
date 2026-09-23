/**
 * ⛔⛔ THE RUN AFFORDANCE MUST NOT COST THE USER THEIR REPAIR CHIP.
 *
 * Widening this gate from `status === 'ready'` to the run ADMISSION first
 * shipped as an either/or: admitted → return the rerun chip ALONE. That
 * silently withdrew the ROADMAP 2.11 anti-stranding recovery chip — a
 * `needs_user_mapping` model lost `chip_prompt_map_option_to_factor` — and at
 * population scale EVERY model the widening admits (3,168 of 15,255) carries a
 * non-null recovery chip, so "nothing that rendered before stops rendering"
 * was false on this surface.
 *
 * Independent review caught it. A mutant on this function had survived,
 * because `gm-needs-encoding-receipts.test.ts` exercises the receipts and
 * never bound the either/or, which is why this spec exists separately rather
 * than as another case in there.
 *
 * ⭐ OFFERING BOTH IS THE PRODUCT ANSWER, not a compromise. The model is
 * runnable AND improvable; which the team does next is their judgement.
 * Withdrawing the repair to advertise the run would be Olumi deciding.
 */
import { describe, expect, it } from 'vitest';

import { buildGmHeldAppliedChips } from '../gm-held-execute.js';

/** An option that is mapped-but-unencoded, i.e. a real recovery case. */
const OPTIONS = [
  { option_id: 'opt_1', label: 'A', status: 'needs_user_mapping', interventions: {} },
] as never;

describe('buildGmHeldAppliedChips — admission ADDS the run, it never removes the repair', () => {
  it('⭐ admissible-but-not-ready offers BOTH the run and the repair', () => {
    const chips = buildGmHeldAppliedChips({ status: 'needs_user_mapping', may_run: true, options: OPTIONS });
    const ids = chips.map((c) => c.id);
    expect(ids).toContain('chip_action_rerun_analysis_gm_held_applied');
    expect(ids.length, 'the repair chip must survive the widening').toBeGreaterThan(1);
    expect(chips[0]?.action_type, 'the run leads — it is the newly available act').toBe('run_analysis');
  });

  it('CONTROL: fully ready still emits exactly the one rerun chip, as it always did', () => {
    const chips = buildGmHeldAppliedChips({ status: 'ready', may_run: true, options: OPTIONS });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.id).toBe('chip_action_rerun_analysis_gm_held_applied');
  });

  it('CONTROL: not admitted emits the repair alone — behaviour unchanged', () => {
    const chips = buildGmHeldAppliedChips({ status: 'needs_user_mapping', may_run: false, options: OPTIONS });
    expect(chips.map((c) => c.id)).not.toContain('chip_action_rerun_analysis_gm_held_applied');
    expect(chips.length, 'the anti-stranding chip must still be there').toBeGreaterThan(0);
  });
});
