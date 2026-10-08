import { describe, expect, it } from 'vitest';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
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

describe('r11 option, scored goal and displayed value identity', () => {
  const multiGraph = { ...graph, goal_node_id: 'other', nodes: [
    { id: 'other', kind: 'goal', label: 'Supplier reliability' }, ...graph.nodes,
    { id: 'keep', kind: 'option', label: 'Keep at £49' },
    { id: 'excluded', kind: 'option', label: 'Excluded option' },
  ] };
  const run = (patch: Record<string, unknown> = {}) => ({ input_snapshot: { goal_node_id: 'mrr' },
    enrichment: { inference_warnings: [{ ...licence, option_ids: ['raise', 'keep'],
      option_labels_by_option: { raise: line.label, keep: 'Keep at £49' }, pct_by_option: { raise: 67, keep: 30 }, ...patch }] } });
  const apply = (text: string, analysisResult: unknown = run(), model: unknown = multiGraph) =>
    withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult, graph: model, current: true }).assistant_text;

  it('r13 P2(c): the user owns an echoed competitor-risk sentence even beside the same licensed option and percentage', () => {
    const userSentence = 'Keep at £49: there is a 30% chance a competitor launches first.';
    const text = `You said: “${userSentence}”  That stays in your model.\n${line.chance}`;
    const context = { analysisResult: run(), graph: multiGraph, current: true, userAuthoredTexts: [userSentence] };
    expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, context).assistant_text).toBe(text);
    // Turn storage carries whole paragraphs; echoing one of those sentences must retain its original authorship.
    const paragraph = `Keep the current offer. ${userSentence} We should revisit it next quarter.`;
    expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, {
      ...context, userAuthoredTexts: [paragraph],
    }).assistant_text).toBe(text);
    // The ownership carrier is material: the same assistant-authored percentage remains subject to the gate.
    expect(apply(userSentence)).not.toContain(userSentence);
    const originalReviewRisk = 'You told me there is a 30% chance a competitor launches first, and that stays in the model.';
    expect(apply(originalReviewRisk)).toBe(originalReviewRisk);
  });

  it('uses the scored second goal from analysis_result, never graph order or selection', () => {
    expect(apply('Monthly recurring revenue reaches its target in 67% of model runs.')).toBe(line.chance);
    const other = 'Supplier reliability reaches its target in 67% of model runs.';
    expect(apply(other)).toBe(other);
  });
  it.each([
    'Raise to £59 reaches Supplier reliability in 67% of model runs.',
    'Keep at £49 reaches Monthly recurring revenue in 67% of model runs.',
    'Excluded option reaches Monthly recurring revenue in 67% of model runs.',
    'The chance of supplier failure is 10%.',
  ])('preserves a sentence without its licensed tuple: %s', text => {
    expect(apply(text)).toBe(text);
  });
  it('a tied goal percentage cannot invent an option identity', () => {
    const tied = run({ pct_by_option: { raise: 67, keep: 67 } });
    const text = 'Monthly recurring revenue reaches its target in 67% of model runs.';
    expect(apply(text, tied)).toBe(text);
    expect(apply('Raise to £59: 67%.', tied)).toBe(line.chance);
  });
  it('duplicate option labels cannot invent an option identity', () => {
    const text = 'Raise to £59: 67%.';
    expect(apply(text, run({ option_labels_by_option: { raise: line.label, keep: line.label } }))).toBe(text);
  });
  it.each(['enrichment', 'stored'])('a legacy %s licence binds its named option and exact value without a scored-goal snapshot', source => {
    const { goal_node_id: _id, goal_label: _label, ...historical } = licence;
    const noIdentity = source === 'enrichment'
      ? { enrichment: { inference_warnings: [historical] } } : { inference_warnings: [historical] };
    const text = 'Raise to £59: 67%.';
    expect(apply(text, noIdentity, { ...graph, goal_node_id: 'mrr' })).toBe(line.chance);
    const risk = 'The chance of supplier failure is 67%.';
    expect(apply(`${text}\n${risk}\n${line.chance}`, noIdentity)).toBe(`\n${risk}\n${line.chance}`);
    for (const unrelated of ['Raise to £59: 65%.', risk, 'Monthly recurring revenue reaches its target in 67% of model runs.']) {
      expect(apply(unrelated, noIdentity)).toBe(unrelated);
    }
  });
  it('a legacy licence can bind a graph label when no label snapshot was stored', () => {
    const { goal_node_id: _id, goal_label: _label, option_labels_by_option: _labels, ...historical } = licence;
    const noIdentity = { enrichment: { inference_warnings: [historical] } };
    expect(apply('Raise to £59: 67%.', noIdentity)).toBe(line.chance);
  });
  it('rejects conflicting scored goal identities on the same analysis_result', () => {
    const text = 'Raise to £59: 67%.';
    expect(apply(text, run({ goal_node_id: 'other' }))).toBe(text);
  });
  it('uses the exact licensed value at nearest-five rounding, never the raw probability', () => {
    const rounded = run({ pct_by_option: { raise: 65, keep: 30 }, display_rounding_by_option: { raise: 'nearest_5' } });
    const expected = goalChanceScreenLinesForAgent(rounded, multiGraph, true).find(l => l.option_id === 'raise')!.chance;
    expect(apply('Raise to £59: about 65%.', rounded)).toBe(expected);
    for (const text of ['Raise to £59: about 67%.', 'Raise to £59: about 66.7%.']) expect(apply(text, rounded)).toBe(text);
  });
});
