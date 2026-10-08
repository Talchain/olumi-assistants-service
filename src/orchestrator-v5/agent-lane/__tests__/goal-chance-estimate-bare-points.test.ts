import { describe, expect, it } from 'vitest';
import { withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';

const line: GoalChanceScreenLine = {
  option_id: 'raise', label: 'Raise to £59', figure: 'about 67%', depends: '',
  chance: '‘Raise to £59’: about 67% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 link (see Check estimates).',
  olumi_estimate_link_count: 1,
};

describe('r9: every unlabelled goal point is absent beside an owed estimate-labelled point', () => {
  const bare = [
    'Raise to £59: about 67%.',
    '‘Raise to £59’: about 67%.',
    '- **Raise to £59**: about 67%.',
    'Raise to £59: less than 1%.',
    'Raise to £59: more than 99%.',
    'Raise to £59: roughly 67%.',
    'Raise to £59: approximately 67%.',
    'Raise to £59: around 67%.',
    'Raise to £59: at least 67%.',
    'Raise to £59: at most 67%.',
    'Raise to £59: 67%.',
    'About 67%.',
    'The chance is about 67%.',
    'The probability is about 67%.',
    'The chance of meeting your goal is about 67%.',
    'The probability of reaching your target is about 67%.',
    'Raise to £59 has about 67% chance of meeting your goal.',
  ];
  it.each(bare)('removes %s before adding the complete point', sentence => {
    const out = withScreenLinesOwed(sentence, [line]);
    expect(out).toEqual({ text: line.chance, added: 1 });
    expect(out.text).not.toContain(sentence);
  });
  it.each(bare)('removes %s even when the complete point is already present (added=0)', sentence => {
    const out = withScreenLinesOwed(`${sentence}\n${line.chance}`, [line]);
    expect(out.added).toBe(0);
    expect(out.text).toContain(line.chance);
    expect(out.text).not.toContain(sentence);
  });
  it('preserves the complete producer-bound sentence and unrelated percentages', () => {
    const facts = 'Costs are about 67% of revenue. Raise to £59: about 33% market share. Raise to £59: approximately 67% market share.';
    const text = `${facts}\n${line.chance}`;
    expect(withScreenLinesOwed(text, [line])).toEqual({ text, added: 0 });
  });
  it('preserves the producer-bound conditional driver figure', () => {
    const withDriver = { ...line, depends: 'It rests most on your link: in the runs where it does not hold, the chance is less than 1%.' };
    const text = `${withDriver.chance} ${withDriver.depends}`;
    expect(withScreenLinesOwed(text, [withDriver])).toEqual({ text, added: 0 });
  });
  it('keeps the established shorthand behaviour when no estimate label is owed', () => {
    const { olumi_estimate_link_count: _count, ...plain } = line;
    plain.chance = '‘Raise to £59’: about 67% chance of meeting your goal, in this model.';
    const text = 'Raise to £59: about 67%.';
    expect(withScreenLinesOwed(text, [plain])).toEqual({ text, added: 0 });
  });
});
