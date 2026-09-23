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

/**
 * ⛔⛔ CEE MUST NOT EMIT A RUN CHIP THE CLIENT WILL FILTER, NOR WITHHOLD ONE IT
 * WOULD HAVE RENDERED.
 *
 * `run_analysis` is in the client's `READINESS_GATED_ACTIONS`, so every chip
 * this module emits is re-judged by the UI against
 * `admitsRunAffordance(status, may_run) = status === 'ready' || may_run === true`
 * (`DecisionGuideAI` staging, `canvas/hooks/useAnalysisReady.ts:74-79`).
 *
 * Two gates on one question is this estate's signature defect, and here it
 * spans a repo boundary, where it is hardest to see. If CEE were the LOOSER of
 * the two it would emit a chip the UI silently drops — a fix that is green in
 * CI and invisible to the user. If CEE were STRICTER it would withhold a chip
 * the client would happily have shown.
 *
 * ⚠ THIS ALSO PINS HOW THIS PR COMPOSES WITH THE `may_run` PRODUCER FIX.
 * Without it the post-apply payload carries no `may_run`, so BOTH sides fall
 * back to `status` and agree; with it, both admit on `may_run` and agree. The
 * two changes are independent and correct in either order — which is a
 * property worth pinning rather than a coincidence worth trusting.
 */
describe('cross-repo parity: what CEE emits is what the client renders', () => {
  /** The deployed UI predicate, transcribed from DGAI staging. */
  const admitsRunAffordance = (status: string, mayRun: boolean | undefined): boolean =>
    status === 'ready' || mayRun === true;

  const OPT = [{ option_id: 'o1', label: 'A', status: 'needs_user_mapping', interventions: {} }];

  const CASES: ReadonlyArray<readonly [string, { status: string; may_run?: boolean; options: unknown[] }]> = [
    ['no may_run producer, ready', { status: 'ready', options: [] }],
    ['no may_run producer, not ready', { status: 'needs_user_mapping', options: OPT }],
    ['may_run present, admissible', { status: 'needs_user_mapping', may_run: true, options: OPT }],
    ['may_run present, refused', { status: 'needs_user_mapping', may_run: false, options: OPT }],
    ['may_run present, ready but refused', { status: 'ready', may_run: false, options: [] }],
  ];

  it.each(CASES)('%s — CEE emission and UI rendering agree', (_name, readiness) => {
    const chips = buildPostApplyChips(readiness as never);
    const ceeEmitsRun = chips.some((c) => c.action_type === 'run_analysis');
    const uiRendersRun = admitsRunAffordance(readiness.status, readiness.may_run);
    expect(
      ceeEmitsRun,
      ceeEmitsRun
        ? 'CEE emitted a run chip the client will filter — green here, invisible to the user'
        : 'CEE withheld a run chip the client would have rendered',
    ).toBe(uiRendersRun);
  });

  it('⛔ and whatever is emitted fits the window the client actually renders', () => {
    for (const [, readiness] of CASES) {
      // `SuggestedChips.tsx:335` — polished.filter(isChipRenderable).slice(0, 3)
      expect(buildPostApplyChips(readiness as never).length).toBeLessThanOrEqual(3);
    }
  });
});
