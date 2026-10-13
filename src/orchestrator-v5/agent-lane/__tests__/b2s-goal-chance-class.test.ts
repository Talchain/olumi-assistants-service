import { describe, expect, it } from 'vitest';
import corpus from './fixtures/b2s-sentence-corpus.json';
import { isGoalChanceStatement, withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';

function apply(text: string, label = 'X', goal = 'Productivity', links = 0): string {
  const graph = { nodes: [
    { id: 'x', kind: 'option', label }, { id: 'g', kind: 'goal', label: goal },
    { id: 'input', kind: 'factor', label: 'Recorded input', observed_state: { raw_value: 12, unit: '%' } },
  ], edges: [] };
  const licence = { code: 'GOAL_CHANCE_LICENSED', form: 'each', goal_node_id: 'g', goal_label: goal,
    option_ids: ['x'], option_labels_by_option: { x: label }, pct_by_option: { x: 24 },
    target: { comparator: 'at_least', value: 10, unit: '%' }, olumi_estimate_link_count: links };
  return withEstimateGoalPointsAtEgress({ assistant_text: text }, {
    graph, analysisResult: { enrichment: { inference_warnings: [licence] } }, current: true,
    // Isolate numerical admission; old attribution tests separately require producer wording.
    preserveLicensedWords: true,
  }).assistant_text;
}

describe('B2s rule v2 corpus, licensed figures and occurrence-bound input', () => {
  for (const row of corpus) {
    it(`${row.id}: verbatim classification`, () => {
      expect(isGoalChanceStatement(row.sentence, row.label, row.goal)).toBe(row.goalChance);
    });
    for (const links of [0, 1]) {
      for (const figure of [24, 23, 25]) {
        it(`${row.id}: ${figure}% with ${links} links`, () => {
          const text = row.frame.replace('{f}', `${figure}%`);
          const output = apply(text, row.label, row.goal, links);
          if (row.goalChance && figure !== 24) {
            expect(output).not.toBe(text);
            expect(output).not.toContain(`${figure}%`);
          } else expect(output).toBe(text);
        });
      }
      it(`${row.id}: bound input with ${links} links`, () => {
        const text = row.frame.replace('{f}', '24%').replace(/([.!?])?$/, '; Recorded input is 12%$1');
        expect(apply(text, row.label, row.goal, links)).toBe(text);
      });
    }
  }
  it.each([0, 1])('F4 no likelihood term preserves every byte (%s links)', links => {
    const text = '  X raises output by 12%, which helps you reach your goal.\t\n';
    expect(apply(text, 'X', 'Productivity', links)).toBe(text);
  });
  it.each([
    'X: the chance of supplier failure is 10%.',
    'X: there is a 68% chance a competitor launches first.',
    'X is 70% likely to win the contract.',
    'X: the chance of supplier failure is 10%, which affects your goal.',
  ])('explicit other subject stays byte-identical: %s', text => {
    expect(isGoalChanceStatement(text, 'X', 'Productivity')).toBe(false);
    expect(apply(text)).toBe(text);
  });
  it.each(['chance', 'chances', 'likely', 'likelihood', 'probability', 'probable', 'odds'])('closed term %s', term => {
    const text = `X: ${term} 25%.`;
    expect(isGoalChanceStatement(text, 'X', 'Productivity')).toBe(true);
    expect(apply(text)).not.toBe(text);
  });
  it.each(['goal', 'goals', 'target', 'targets', 'objective', 'aim', 'Productivity'])('attached goal reference %s', goal => {
    const text = `X has a 25% chance that X meets your ${goal}.`;
    expect(isGoalChanceStatement(text, 'X', 'Productivity')).toBe(true);
    expect(apply(text)).not.toBe(text);
  });
  it.each(['time', 'cases', 'runs', 'scenarios', 'simulations', 'samples', 'draws'])('frequency %s', noun => {
    expect(apply(`X reaches your target 25% of the ${noun}.`)).not.toBe(`X reaches your target 25% of the ${noun}.`);
    expect(apply(`X wins a contract 25% of the ${noun}.`)).toBe(`X wins a contract 25% of the ${noun}.`);
  });
  it('PL served S4 straight quotes: wrong caught, licensed kept', () => {
    expect(apply('- "X": its recorded chance is 25%.')).not.toBe('- "X": its recorded chance is 25%.');
    expect(apply('- "X": its recorded chance is 24%.')).toBe('- "X": its recorded chance is 24%.');
  });
});
