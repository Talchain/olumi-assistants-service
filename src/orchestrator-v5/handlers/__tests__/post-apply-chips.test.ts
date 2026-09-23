/**
 * The payoff turn must offer the next act. See `post-apply-chips.ts` for the
 * measured dead end this closes.
 */
import { describe, expect, it } from 'vitest';

import { buildPostApplyChips } from '../post-apply-chips.js';

const OPTS = [{ option_id: 'o1', label: 'A', status: 'needs_user_mapping', interventions: {} }];

describe('buildPostApplyChips', () => {
  it('⭐ a model the apply made READY is offered the run — today it got nothing at all', () => {
    const chips = buildPostApplyChips({ status: 'ready', may_run: true, options: [] } as never);
    expect(chips.map((c) => c.id)).toContain('chip_action_run_analysis_post_apply');
    expect(chips[0]?.action_type).toBe('run_analysis');
  });

  it('⭐ admissible-but-not-ready is offered the run AND keeps its repair', () => {
    const chips = buildPostApplyChips({ status: 'needs_user_mapping', may_run: true, options: OPTS } as never);
    expect(chips[0]?.id).toBe('chip_action_run_analysis_post_apply');
    expect(chips.length, 'the repair must survive alongside the run').toBeGreaterThan(1);
    // ⚠ The client renders only the first three; two must stay under that.
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it('CONTROL: not admitted offers the repair alone — never a run that would refuse', () => {
    const chips = buildPostApplyChips({ status: 'needs_user_mapping', may_run: false, options: OPTS } as never);
    expect(chips.map((c) => c.id)).not.toContain('chip_action_run_analysis_post_apply');
    expect(chips.length).toBeGreaterThan(0);
  });

  /**
   * ⚠ MY FIRST VERSION OF THIS ASSERTED SILENCE, AND WAS WRONG ABOUT THE SPEC.
   * With readiness UNKNOWN the estate fails closed to review — the same
   * behaviour `draft-graph-dispatch` has for an absent `analysis_ready`
   * ("fails closed to model review"). That is a conversational prompt, not a
   * claim that something IS broken, so it is honest on a turn where we cannot
   * see the state. What must NEVER appear is the run: offering an act we
   * cannot say will be admitted is the dishonest half.
   */
  it('CONTROL: unknown readiness fails closed to REVIEW, and never to a run', () => {
    const chips = buildPostApplyChips(undefined);
    expect(chips.map((c) => c.id)).toEqual(['chip_prompt_review_model_gaps']);
    expect(chips.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });
});
