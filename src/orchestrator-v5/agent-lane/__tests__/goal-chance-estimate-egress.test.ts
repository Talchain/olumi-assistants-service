import { describe, expect, it } from 'vitest';
import { withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';

const line: GoalChanceScreenLine = {
  option_id: 'raise', label: 'Raise to £59', figure: 'about 67%', depends: '',
  chance: '‘Raise to £59’: about 67% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 link (see Check estimates).',
  olumi_estimate_link_count: 1,
};
const graph = { nodes: [{ id: 'raise', kind: 'option', label: line.label }, { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' }], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['raise'], pct_by_option: { raise: 67 },
  target: { comparator: 'at_least', value: 20000, unit: '£/month' }, olumi_estimate_link_count: 1,
  goal_node_id: 'mrr', goal_label: 'Monthly recurring revenue', option_labels_by_option: { raise: line.label } };
const result = { enrichment: { inference_warnings: [licence] } };
const clean = (text: string): string => withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult: result, graph, current: true }).assistant_text;

describe('r10 licence value and subject bound estimate points', () => {
  it.each([
    '‘Raise to £59’: about 67% in this model.',
    'The recorded chance for Raise to £59 is 67%.',
    'The recorded figure for Raise to £59 is 67 per cent.',
    'Monthly recurring revenue reaches its target in 67% of model runs.',
  ])('replaces the qualified point once: %s', bare => {
    const out = clean(bare);
    expect(out).not.toContain(bare);
    expect(out).toBe(line.chance);
  });
  it('removes a bare qualified point with added=0', () => {
    const bare = '‘Raise to £59’: about 67% in this model.';
    const owed = withScreenLinesOwed(`${bare}\n${line.chance}`, [line]);
    expect(owed.added).toBe(0);
    const out = clean(owed.text);
    expect(out).not.toContain(bare);
    expect(out.split(line.chance)).toHaveLength(2);
  });
  it('a canonical sentence cannot shield the following lowercase bare sentence', () => {
    const bare = 'the recorded chance for Raise to £59 is 67%.';
    const unrelated = 'the chance of supplier failure is 10%.';
    const out = clean(`${line.chance} ${unrelated} ${bare}`);
    expect(out).not.toContain(bare);
    expect(out.split(line.chance)).toHaveLength(2);
    expect(out).toContain(unrelated);
  });
  it('a lowercase bound sentence cannot consume the preceding unrelated sentence', () => {
    const unrelated = 'The chance of supplier failure is 10%.';
    const bare = 'the recorded chance for Raise to £59 is 67%.';
    expect(clean(`${unrelated}  ${bare}`)).toBe(`${unrelated}  ${line.chance}`);
  });
  it('punctuation inside the licence option label is not a sentence boundary', () => {
    const label = 'Raise. Price (UK)';
    const run = { enrichment: { inference_warnings: [{ ...licence, option_labels_by_option: { raise: label } }] } };
    const bare = `‘${label}’: about 67% in this model.`;
    const out = withEstimateGoalPointsAtEgress({ assistant_text: bare }, { analysisResult: run, graph, current: true });
    expect(out.assistant_text).not.toContain(bare);
    expect(out.assistant_text).toBe(line.chance.replace('Raise to £59', label));
  });
  it('uses licence snapshots after current graph labels change', () => {
    const renamed = { nodes: graph.nodes.map(n => ({ ...n, label: `Changed ${n.id}` })), edges: [] };
    const bare = 'Monthly recurring revenue reaches its target in 67% of model runs.';
    const out = withEstimateGoalPointsAtEgress({ assistant_text: bare }, { analysisResult: result, graph: renamed, current: true });
    expect(out.assistant_text).toBe(line.chance);
    expect(out.assistant_text).not.toContain(bare);
  });
  it.each([false, true])('without a current estimate-backed licence preserves all bytes (current=%s)', current => {
    const unlabelled = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0 }] } };
    const body = { assistant_text: '‘Raise to £59’: about 67% in this model.' };
    expect(withEstimateGoalPointsAtEgress(body, { analysisResult: current ? unlabelled : result, graph, current })).toBe(body);
  });
  it.each([
    'The chance of supplier failure is 10%.',
    'The chance of supplier failure is 67%.',
    'Raise to £59: the chance of supplier failure is 10%.',
    'Raise to £59: about 33% market share.',
    'Raise to £59: .67% market share.',
    'Raise to £59: -67% change.',
    'Raise to £59: 1,067% change.',
    'Raise to £59: more than 67% in this model.',
    'Raise to £59: >67% in this model.',
    'Raise to £59: at least 67% in this model.',
    'Raise to £59: at most 67% in this model.',
    'Raise to £59: more than about 67% in this model.',
    'Raise to £59: at least approximately 67% in this model.',
  ])('preserves a non-goal sentence byte for byte: %s', unrelated => {
    const text = `Keep this spacing.  ${unrelated}\t\n${line.chance}`;
    expect(clean(text)).toBe(text);
  });
});
