/**
 * The shared card-flag mechanism (PLAN-CONFIRM-NOT-REFUSE step 2): a meaning check's flag OPENS the card, in the words of its
 * kind, said once; a card with no flag is unchanged. Each gate's rows bind its own flag (restated-goal-revised-draft,
 * founder-targetless-revision); these rows pin the words and the placement every gate shares.
 */
import { describe, expect, it } from 'vitest';
import { cardWithMeaningFlags, MEANING_FLAG_NOTE, meaningFlagWords, type MeaningFlag } from '../runtime/meaning-flags.js';

const DROPPED: MeaningFlag = { kind: 'goal_target_change', from: '‘Funding secured’ at least £250,000',
  to: '‘Funding secured’ with no numeric target' };

describe('meaning flags open the card, said once', () => {
  it('goal_target_change: the saved and revised goal targets, then what the user does instead of approving', () => {
    expect(meaningFlagWords(DROPPED)).toBe('Check this change first: the goal’s target would change from ‘Funding secured’ at least '
      + '£250,000 to ‘Funding secured’ with no numeric target. Approve only if that is what you meant; otherwise say what the target should be.');
  });

  it('goal_target_reading: the user’s figure, the goal Olumi read it for, then what the user does instead of approving', () => {
    expect(meaningFlagWords({ kind: 'goal_target_reading', figure: 'at least \u00a3250,000', goal: '\u2018Angel funding secured\u2019' }))
      .toBe('Check this change first: Olumi read at least \u00a3250,000 as the target for \u2018Angel funding secured\u2019, the goal of the '
        + 'revised model. Approve only if that is what you meant; otherwise say which goal it is for.');
  });

  it('draft_history: states the earlier-work warning and an explicit keep/use choice', () => {
    expect(meaningFlagWords({ kind: 'draft_history', findings: ['Your model has saved changes after the draft.'] }))
      .toBe('Your model has saved changes after the draft. Keep your current model by leaving this card unapproved, or use Olumi’s revision by approving it.');
  });

  it('the flag comes first, once, before the card’s own words', () => {
    const card = 'Replace the early draft with a revised one. Check the targets, limits and options on this card before choosing.';
    expect(cardWithMeaningFlags(card, [DROPPED, { ...DROPPED }])).toBe(`${meaningFlagWords(DROPPED)} ${card}`);
  });

  it('CONTRAST: no flag → the card is unchanged', () => {
    const card = 'Replace the early draft with a revised one.';
    expect(cardWithMeaningFlags(card, [])).toBe(card);
  });

  it('the AI note asks for the change first and follows the card’s kept/changed distinction', () => {
    expect(MEANING_FLAG_NOTE.startsWith(' ')).toBe(true);
    expect(MEANING_FLAG_NOTE).toContain('Say that change first');
    expect(MEANING_FLAG_NOTE).toContain('Say an earlier value was kept only where the card explicitly says so; describe changed or removed values as changes.');
  });
});
