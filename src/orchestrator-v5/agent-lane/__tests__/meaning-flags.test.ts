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

  it('the flag comes first, once, before the card’s own words', () => {
    const card = 'Replace the early draft with a revised one. Check the targets, limits and options on this card before choosing.';
    expect(cardWithMeaningFlags(card, [DROPPED, { ...DROPPED }])).toBe(`${meaningFlagWords(DROPPED)} ${card}`);
  });

  it('CONTRAST: no flag → the card is unchanged', () => {
    const card = 'Replace the early draft with a revised one.';
    expect(cardWithMeaningFlags(card, [])).toBe(card);
  });

  it('the AI note asks for the change first and never claims the earlier value was kept', () => {
    expect(MEANING_FLAG_NOTE.startsWith(' ')).toBe(true);
    expect(MEANING_FLAG_NOTE).toContain('Say that change first');
    expect(MEANING_FLAG_NOTE).toContain('Never say the earlier value was kept.');
  });
});
