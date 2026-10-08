import { describe, expect, it } from 'vitest';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';

const graph = { nodes: [{ id: 'raise', kind: 'option', label: 'Raise to £59' }, { id: 'goal', kind: 'goal', label: 'MRR' }], edges: [] };
const result = (pct = 67) => ({ enrichment: { inference_warnings: [{
  code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['raise'], pct_by_option: { raise: pct },
  target: { comparator: 'at_least', value: 20000, unit: '£/month' }, olumi_estimate_link_count: 1,
  goal_node_id: 'goal', goal_label: 'MRR', option_labels_by_option: { raise: 'Raise to £59' },
}] } });
const line = (pct = 67) => goalChanceScreenLinesForAgent(result(pct), graph, true)[0]!;
const clean = (text: string, pct = 67): string => withEstimateGoalPointsAtEgress({ assistant_text: text }, {
  analysisResult: result(pct), graph, current: true,
}).assistant_text;

describe('r10: estimate points require the licence value and its subject', () => {
  const bare = [
    'Raise to £59: about 67%.',
    '‘Raise to £59’: about 67%.',
    '- **Raise to £59**: about 67%.',
    'Raise to £59: roughly 67%.',
    'Raise to £59: approximately 67%.',
    'Raise to £59: around 67%.',
    'Raise to £59: 67%.',
    'Raise to £59 has about 67% chance of meeting your goal.',
    'MRR meets the target in 67% of runs.',
    'Raise to £59: approximately 67% market share.',
  ];
  it.each(bare)('replaces the bound point: %s', sentence => {
    expect(clean(sentence)).toBe(line().chance);
    expect(clean(sentence)).not.toContain(sentence);
  });
  it.each(bare)('removes the bare copy beside an already complete point: %s', sentence => {
    const out = clean(`${sentence}\n${line().chance}`);
    expect(out).toContain(line().chance);
    expect(out.split(line().chance)).toHaveLength(2);
    expect(out).not.toContain(sentence);
  });
  it.each(['About 67%.', 'The chance is about 67%.', 'The chance of meeting your goal is about 67%.',
    'Raise to £59: less than 1%.', 'Raise to £59: more than 99%.', 'Raise to £59: about 33% market share.',
    'Costs are about 67% of revenue.'])('preserves the unbound sentence byte for byte: %s', sentence => {
    const text = `  ${sentence}\t\n${line().chance}`;
    expect(clean(text)).toBe(text);
  });
  it.each(['Raise to £59: <1%.', 'Raise to £59: less than 1%.', 'Raise to £59: 0%.'])('binds the licensed zero figure: %s', sentence => {
    expect(clean(sentence, 0)).toBe(line(0).chance);
    expect(clean(sentence, 0)).not.toContain(sentence);
  });
  it.each(['Raise to £59: >99%.', 'Raise to £59: more than 99%.', 'Raise to £59: 100%.'])('binds the licensed upper display: %s', sentence => {
    expect(clean(sentence, 100)).toBe(line(100).chance);
  });
  it('keeps owing separate from the final value-bound egress, with added=0', () => {
    const bare = '‘Raise to £59’: about 67% in this model.';
    const owed = withScreenLinesOwed(`${bare}\n${line().chance}`, [line()]);
    expect(owed.added).toBe(0);
    expect(clean(owed.text)).not.toContain(bare);
  });
  it('keeps established shorthand when no estimate licence is owed', () => {
    const { olumi_estimate_link_count: _count, ...plain } = line();
    plain.chance = '‘Raise to £59’: about 67% chance of meeting your goal, in this model.';
    const text = 'Raise to £59: about 67%.';
    expect(withScreenLinesOwed(text, [plain])).toEqual({ text, added: 0 });
  });
});
