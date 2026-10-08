import { describe, expect, it } from 'vitest';
import { deliverableIsALaunch, shareGoalChanceWords } from '../share-goal-chance-words.js';

const DEADLINE = '2027-04-07';

describe('r4 L1-LAUNCHING-WORDS', () => {
  it.each([
    'the launch',
    'the feature launch',
    'launch',
    'the app launch',
    'launching the app',
  ])('L1-LAUNCHING-WORDS positive: %s names the launch', deliverable => {
    expect(shareGoalChanceWords(deliverable, DEADLINE)).toBe('chance of launching by 7 April 2027');
    expect(deliverableIsALaunch(deliverable)).toBe(true);
  });

  it.each([
    'the pre-launch security review',
    'launch checklist',
    'launch marketing plan',
    'launching checklist',
    'the migration',
  ])('L1-LAUNCHING-WORDS control: %s retains the deliverable', deliverable => {
    expect(shareGoalChanceWords(deliverable, DEADLINE)).toBe(`chance of finishing ${deliverable} by 7 April 2027`);
    expect(deliverableIsALaunch(deliverable)).toBe(false);
  });

  it('L1-LAUNCHING-WORDS whitespace scaling: 5k to 20k remains below 8x', () => {
    const inputs = [5000, 20000].map(n => `the${' '.repeat(n)}launch checklist`);
    for (const input of inputs) expect(deliverableIsALaunch(input)).toBe(false);
    for (const input of inputs) for (let i = 0; i < 1000; i++) shareGoalChanceWords(input, DEADLINE);
    const elapsed = inputs.map(input => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) shareGoalChanceWords(input, DEADLINE);
      return performance.now() - start;
    });
    const growth = elapsed[1]! / elapsed[0]!;
    process.stdout.write(`r4 launch words whitespace scaling ${JSON.stringify({ small: elapsed[0], large: elapsed[1], growth })}\n`);
    expect(growth).toBeLessThan(8);
  });
});
