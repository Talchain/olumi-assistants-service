import sentenceFrames from './fixtures/b2q-percentage-sentence-frames.json';
import { describe, expect, it, vi } from 'vitest';
import * as screenLines from '../goal-chance-screen-lines.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';

const line: GoalChanceScreenLine = {
  option_id: 'raise', label: 'Raise to £59', figure: 'about 67%', depends: '',
  chance: '‘Raise to £59’: about 67% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 relationship (see Check estimates).',
  olumi_estimate_link_count: 1,
};
const graph = { nodes: [{ id: 'raise', kind: 'option', label: line.label }, { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' }], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['raise'], pct_by_option: { raise: 67 },
  target: { comparator: 'at_least', value: 20000, unit: '£/month' }, olumi_estimate_link_count: 1,
  goal_node_id: 'mrr', goal_label: 'Monthly recurring revenue', option_labels_by_option: { raise: line.label } };
const result = { enrichment: { inference_warnings: [licence] } };
const clean = (text: string): string => withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult: result, graph, current: true }).assistant_text;

describe('r16 option and goal bound estimate points', () => {
  it.each([
    'Raise to £59 has a 68% chance of reaching Monthly recurring revenue.',
    'Raise to £59 has a 68% chance of meeting your goal.',
    'raise has a 68% chance of meeting your goal.',
    'Raise to £59: more than 67% in this model.',
    'Raise to £59: >67% in this model.',
    'Raise to £59: at least 67% in this model.',
    'Raise to £59: at most 67% in this model.',
    'Raise to £59: more than about 67% in this model.',
    'Raise to £59: at least approximately 67% in this model.',
  ])('replaces the qualified point once: %s', bare => {
    const out = clean(bare);
    expect(out).not.toContain(bare);
    expect(out).toBe(line.chance);
  });
  it('removes a bare qualified point with added=0', () => {
    const bare = '‘Raise to £59’: about 68% in this model.';
    const owed = withScreenLinesOwed(`${bare}\n${line.chance}`, [line]);
    expect(owed.added).toBe(0);
    const out = clean(owed.text);
    expect(out).not.toContain(bare);
    expect(out.split(line.chance)).toHaveLength(2);
  });
  it('a canonical sentence cannot shield the following lowercase bare sentence', () => {
    const bare = 'the recorded chance for Raise to £59 is 68%.';
    const unrelated = 'the chance of supplier failure is 10%.';
    const out = clean(`${line.chance} ${unrelated} ${bare}`);
    expect(out).not.toContain(bare);
    expect(out.split(line.chance)).toHaveLength(2);
    expect(out).toContain(unrelated);
  });
  it('a lowercase bound sentence cannot consume the preceding unrelated sentence', () => {
    const unrelated = 'The chance of supplier failure is 10%.';
    const bare = 'the recorded chance for Raise to £59 is 68%.';
    expect(clean(`${unrelated}  ${bare}`)).toBe(`${unrelated}  ${line.chance}`);
  });
  it('punctuation inside the licence option label is not a sentence boundary', () => {
    const label = 'Raise. Price (UK)';
    const run = { enrichment: { inference_warnings: [{ ...licence, option_labels_by_option: { raise: label } }] } };
    const bare = `‘${label}’: about 68% in this model.`;
    const out = withEstimateGoalPointsAtEgress({ assistant_text: bare }, { analysisResult: run, graph, current: true });
    expect(out.assistant_text).not.toContain(bare);
    expect(out.assistant_text).toBe(line.chance.replace('Raise to £59', label));
  });
  it('uses licence snapshots after current graph labels change', () => {
    const renamed = { nodes: graph.nodes.map(n => ({ ...n, label: `Changed ${n.id}` })), edges: [] };
    const bare = 'Monthly recurring revenue reaches its target in 67% of model runs.';
    const out = withEstimateGoalPointsAtEgress({ assistant_text: bare }, { analysisResult: result, graph: renamed, current: true });
    expect(out.assistant_text).toBe('');
    expect(out.assistant_text).not.toContain(line.label);
  });
  it.each([false, true])('without a current estimate-backed licence preserves all bytes (current=%s)', current => {
    const unlabelled = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0 }] } };
    const body = { assistant_text: '‘Raise to £59’: about 67% in this model.' };
    const out = withEstimateGoalPointsAtEgress(body, { analysisResult: current ? unlabelled : result, graph, current });
    if (!current) expect(out).toBe(body);
    else expect(out).toBe(body);
  });
  it.each([
    'The chance of supplier failure is 10%.',
    'The chance of supplier failure is 67%.',
    'Raise to £59: the chance of supplier failure is 10%.',
    'Raise to £59: about 33% market share.',
    'Raise to £59: about 67% market share.',
    'Raise to £59: there is a 68% chance a competitor launches first.',
    'Raise to £59: .67% market share.',
    'Raise to £59: -67% change.',
    'Raise to £59: 1,067% change.',
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
    // An explicit competitor outcome is not this Run's scored goal, even in assistant-authored narration.
    expect(apply(userSentence)).toBe(userSentence);
    const originalReviewRisk = 'You told me there is a 30% chance a competitor launches first, and that stays in the model.';
    expect(apply(originalReviewRisk)).toBe(originalReviewRisk);
  });

  it('uses the scored second goal from analysis_result, never graph order or selection', () => {
    expect(apply('Monthly recurring revenue reaches its target in 67% of model runs.')).toBe('');
    const other = 'Supplier reliability reaches its target in 67% of model runs.';
    expect(apply(other)).toBe(other);
  });
  it.each([
    'Raise to £59 reaches Supplier reliability in 67% of model runs.',
    'The chance of supplier failure is 10%.',
  ])('preserves a sentence without its licensed tuple: %s', text => {
    expect(apply(text)).toBe(text);
  });
  it('R16: a named licensed option binds the scored goal even when the figure names another option’s value', () => {
    const text = 'Keep at £49 reaches Monthly recurring revenue in 67% of model runs.';
    const wanted = goalChanceScreenLinesForAgent(run(), multiGraph, true).find(l => l.option_id === 'keep')!.chance;
    expect(apply(text)).toBe(wanted);
  });
  it('a tied goal percentage cannot invent an option identity', () => {
    const tied = run({ pct_by_option: { raise: 67, keep: 67 } });
    const text = 'Monthly recurring revenue reaches its target in 67% of model runs.';
    expect(apply(text, tied)).toBe('');
    expect(apply('Raise to £59: 67%.', tied)).toBe(line.chance);
  });
  it('duplicate option labels cannot invent an option identity', () => {
    const text = 'Raise to £59: 67%.';
    expect(apply(text, run({ option_labels_by_option: { raise: line.label, keep: line.label } }))).toBe(text);
  });
  it.each(['enrichment', 'stored'])('a legacy %s licence binds its named option’s goal shorthand without a scored-goal snapshot', source => {
    const { goal_node_id: _id, goal_label: _label, ...historical } = licence;
    const noIdentity = source === 'enrichment'
      ? { enrichment: { inference_warnings: [historical] } } : { inference_warnings: [historical] };
    const text = 'Raise to £59: 67%.';
    expect(apply(text, noIdentity, { ...graph, goal_node_id: 'mrr' })).toBe(line.chance);
    const risk = 'The chance of supplier failure is 67%.';
    expect(apply(`${text}\n${risk}\n${line.chance}`, noIdentity)).toBe(`\n${risk}\n${line.chance}`);
    expect(apply('Raise to £59: 65%.', noIdentity)).toBe(line.chance);
    for (const unrelated of [risk, 'Monthly recurring revenue reaches its target in 67% of model runs.']) {
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
    // Narrator figures are replaced by the recorded rounded licence, never admitted because they differ from it.
    for (const text of ['Raise to £59: about 67%.', 'Raise to £59: about 66.7%.']) expect(apply(text, rounded)).toBe(expected);
  });
});

describe('B4 final numerical check without a prose composer', () => {
  it.each([0, 1])('rejects 68 when the licence says 67, with %i Olumi relationships', count => {
    const analysisResult = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: count }] } };
    const text = 'Raise to £59 has a 68% chance of meeting your goal.';
    const out = withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult, graph, current: true });
    expect(out.assistant_text).not.toContain('68%');
    expect(out.assistant_text).toContain('67%');
  });
  it.each(['Raise to £59 has a 67% chance of meeting your goal in this model.',
    'The recorded chance for Raise to £59 is 67 per cent.'])('keeps correct AI words: %s', assistant_text => {
    expect(clean(assistant_text)).toBe(line.chance);
  });
});

it('withheld and excluded options cannot borrow another licensed percentage', () => {
  const assistant_text = 'Raise to £59 has a 67% chance of meeting your goal.';
  const none = { enrichment: { inference_warnings: [{ ...licence, form: 'withheld', pct_by_option: {} }] } };
  expect(withEstimateGoalPointsAtEgress({ assistant_text }, { analysisResult: none, graph, current: true }).assistant_text).not.toContain('67%');
});

it.each(['Raise to £59 has a 67% chance of meeting your goal.', 'This gives a 67% chance.'])(
  'zero estimate links preserves the correct AI sentence: %s', assistant_text => {
    const analysisResult = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0 }] } };
    const body = { assistant_text };
    expect(withEstimateGoalPointsAtEgress(body, { analysisResult, graph, current: true })).toBe(body);
  });

it.each(['Raise to £59 has a 67% chance of meeting your goal.', 'This gives a 67% chance.'])(
  'an explicit zero in the projected line is not estimate provenance: %s', assistant_text => {
    // The current producer often omits zero; exercise the consumer's valid explicit-zero boundary as well.
    const projected = vi.spyOn(screenLines, 'licensedGoalChanceLinesForAgent').mockReturnValue([
      { ...line, olumi_estimate_link_count: 0, chance: 'Raise to £59: about 67% chance of meeting your goal, in this model.' },
    ]);
    try {
      const body = { assistant_text };
      expect(withEstimateGoalPointsAtEgress(body, { analysisResult: result, graph, current: true })).toBe(body);
    } finally { projected.mockRestore(); }
  });

// A zero relationship count does not erase other positively recorded estimate kinds.
it.each([
  { counts: { olumi_estimate_value_count: 1 }, words: '1 starting value' },
  { counts: { olumi_estimate_settings_by_option: { raise: 1 } }, words: '1 option setting' },
])('zero links retains attribution for $words', ({ counts, words }) => {
  const analysisResult = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0, ...counts }] } };
  const expected = `‘Raise to £59’: about 67% chance of meeting your goal, in this model, using Olumi's estimates for ${words} (see Check estimates).`;
  for (const assistant_text of ['Raise to £59 has a 67% chance of meeting your goal.', 'This gives a 67% chance.']) {
    expect(withEstimateGoalPointsAtEgress({ assistant_text }, { analysisResult, graph, current: true }).assistant_text).toBe(expected);
  }
});

it('K-a: an unbound bare chance is withheld without inventing an option alias or a licensed figure', () => {
  const unbound = 'Price rise has about 46% chance.';
  const unrelated = 'Price rise has about 46% chance of supplier failure.';
  const assistant_text = `${unbound} ${unrelated}`;
  expect(clean(assistant_text)).toBe(` ${unrelated}`);
  expect(withEstimateGoalPointsAtEgress({ assistant_text }, {
    analysisResult: result, graph, current: true, userAuthoredTexts: [unbound],
  }).assistant_text).toBe(assistant_text);
});


describe('B2j horizon prose and numerical licence', () => {
  it('withholds a win share called a chance and an unlicensed percentage at an untested horizon', () => {
    const held = { ...graph, nodes: graph.nodes.map(n => n.kind === 'goal' ? { ...n, goal_horizon_months: 6 } : n) };
    for (const text of ['Raise to £59 has a 71% chance of meeting your goal.', 'Raise to £59 has a 46% chance.']) {
      const run = { enrichment: { inference_warnings: [], win_share: { raise: 0.71 } } };
      expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult: run, graph: held, current: true }).assistant_text).toBe('');
    }
  });
  it('preserves a conditional on-track question while the horizon is untested', () => {
    const text = 'If hiring starts earlier, could the option be on track by month six?';
    const held = { ...graph, nodes: graph.nodes.map(n => n.kind === 'goal' ? { ...n, goal_horizon_months: 6 } : n) };
    expect(goalHorizonVerdict(held, result.enrichment)).toBe('withhold');
    expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, { analysisResult: result, graph: held, current: true }).assistant_text).toBe(text);
  });
});

describe('B2k fact-bound timed attainment', () => {
  const timedGraph = { ...graph, nodes: graph.nodes.map(n => n.kind === 'goal' ? { ...n,
    goal_horizon_months: 6, goal_threshold_raw: 20000, goal_threshold_unit: '£/month',
    goal_direction: '>=', goal_threshold_frame: 'level', quantity_frame: 'level',
    goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 20000,
      reference: 'today', period_months: 6, period_kind: 'at_end', effect_unit: '£/month',
      effects_at_period_end: true, source: 'olumi_reading' },
  } : n) };
  const timed = (text: string, run: unknown = result) => withEstimateGoalPointsAtEgress({ assistant_text: text }, {
    analysisResult: run, graph: timedGraph, current: true,
  }).assistant_text;
  const fallback = 'The recorded comparison does not support that explanation.';
  it('keeps attainment only for the licensed target and period', () => {
    expect(goalHorizonVerdict(timedGraph, result.enrichment)).toBe('basis_at_h');
    const text = 'The goal will be met by month 6.';
    expect(timed(text)).toBe(text);
    expect(timed('The goal will be met by month 9.')).toBe(fallback);
    expect(timed(text, { enrichment: { inference_warnings: [{ ...licence,
      target: { ...licence.target, value: 30000 } }] } })).toBe(fallback);
    expect(timed(text, { enrichment: { inference_warnings: [] } })).toBe(fallback);
  });
  it('removes only the unlicensed sentence and preserves a numerical limitation exactly', () => {
    expect(timed('The goal is on track by month 9. The model has 2 options.')).toBe(' The model has 2 options.');
    const limitation = 'The goal is not on track by month 9; this model cannot establish that.';
    expect(timed(limitation)).toBe(limitation);
  });
});


describe('B2q sentence-class sweep: 15 verbatim served sources and 28 review-probe frames', () => {
  for (const frame of sentenceFrames) {
    const model = { nodes: [
      { id: 'choice', kind: 'option', label: frame.label },
      { id: 'goal', kind: 'goal', label: 'Productivity' },
      { id: 'input', kind: 'factor', label: 'User capacity', observed_state: { raw_value: 25, unit: '%', source: 'user' } },
    ], edges: [] };
    const analysisResult = { enrichment: { inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', form: 'each',
      option_ids: ['choice'], option_labels_by_option: { choice: frame.label }, pct_by_option: { choice: 67 },
      goal_node_id: 'goal', goal_label: 'Productivity', target: { comparator: 'at_least', value: 10, unit: '%' },
      olumi_estimate_link_count: 0,
    }] } };
    const apply = (text: string) => withEstimateGoalPointsAtEgress({ assistant_text: text }, {
      graph: model, analysisResult, current: true,
    }).assistant_text;
    const licensed = screenLines.licensedGoalChanceLinesForAgent(analysisResult, model, true)[0]!;
    // Parameterise only the displayed figure; the full original served sentence remains in the fixture.
    const render = (figure: string) => frame.frame.replace('{figure}', figure);
    it.each([
      ['licensed', () => render(licensed.figure), true],
      ['licensed-1', () => render('about 66%'), false],
      ['licensed+1', () => render('about 68%'), false],
      ['target 10%', () => render(licensed.figure).replace(/\.$/, '; the goal target is 10%.'), true],
      ['user input 25%', () => render(licensed.figure).replace(/\.$/, '; User capacity is 25%.'), true],
    ] as const)(`${frame.id}: %s`, (_variant, text, unchanged) => {
      const input = text();
      expect(apply(input), `${frame.source}\n${frame.sentence}`).toBe(unchanged ? input : licensed.chance);
      expect(apply(apply(input))).toBe(apply(input));
    });
  }
});

it('B2q every percentage is checked, including an otherwise licensed sentence and unknown input claims', () => {
  const correct = 'Raise to £59 is 67% likely to meet your goal';
  expect(clean(`${correct}, with a further 68% figure.`)).toBe(line.chance);
  expect(clean('Raise to £59: the chance of supplier failure is 10%.')).toBe(line.chance);
  const inputGraph = { ...graph, nodes: [...graph.nodes, { id: 'capacity', kind: 'factor', label: 'Capacity',
    observed_state: { raw_value: 25, value: 0.25, unit: '% of monthly time' } }] };
  const apply = (assistant_text: string) => withEstimateGoalPointsAtEgress({ assistant_text }, {
    graph: inputGraph, analysisResult: result, current: true,
  }).assistant_text;
  const input = `${correct}; Capacity is 25% of monthly time.`;
  expect(apply(input)).toBe(input);
  expect(apply(`${correct}; Capacity is 26% of monthly time.`)).toBe(line.chance);
  expect(apply(`${correct}; Capacity is 25%.`)).toBe(line.chance);
  expect(apply(`${correct}; Capacity is 0.25% of monthly time.`)).toBe(line.chance);
});

it('B2q input evidence binds the occurrence, not another use of the same number', () => {
  const analysisResult = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0,
    target: { comparator: 'at_least', value: 10, unit: '%' } }] } };
  const apply = (assistant_text: string) => withEstimateGoalPointsAtEgress({ assistant_text }, {
    graph, analysisResult, current: true,
  }).assistant_text;
  const expected = screenLines.licensedGoalChanceLinesForAgent(analysisResult, graph, true)[0]!.chance;
  expect(apply('There is a 10% chance that Raise to £59 meets your goal.')).toBe(expected);
  expect(apply('Raise to £59 reaches the target 10% of the time.')).toBe(expected);
  expect(apply('Raise to £59 has a 10% chance; the goal target is 10%.')).toBe(expected);
  const allowed = 'Raise to £59 has a 67% chance; the goal target is 10%.';
  expect(apply(allowed)).toBe(allowed);
  const repeated = 'Raise to £59 has a 67% chance; its recorded chance is 67%.';
  expect(apply(repeated)).toBe(repeated);
});

it('B2q separate option clauses bind their own figures, including with the figure first', () => {
  const analysisResult = { enrichment: { inference_warnings: [{ ...licence, olumi_estimate_link_count: 0,
    option_ids: ['raise', 'keep'], option_labels_by_option: { raise: line.label, keep: 'Keep at £49' },
    pct_by_option: { raise: 67, keep: 40 } }] } };
  const apply = (assistant_text: string) => withEstimateGoalPointsAtEgress({ assistant_text }, {
    graph, analysisResult, current: true,
  }).assistant_text;
  for (const text of ['Raise to £59 is 67% likely to meet your goal and Keep at £49 is 40% likely.',
    'There is a 67% chance for Raise to £59; there is a 40% chance for Keep at £49.']) expect(apply(text)).toBe(text);
  expect(apply('Raise to £59 is 40% likely to meet your goal and Keep at £49 is 67% likely.')).toBe('');
});

it.each(sentenceFrames.filter(frame => frame.id.startsWith('served-')))(
  'B2q verbatim served sentence: $id', frame => {
    const percentages = [...frame.sentence.matchAll(/(\d+)%/g)].map(match => Number(match[1]));
    const range = frame.sentence.includes('between about');
    const model = { nodes: [
      { id: 'choice', kind: 'option', label: frame.label },
      { id: 'goal', kind: 'goal', label: 'Productivity' },
      { id: 'from', kind: 'factor', label: 'Additional specialist capacity' },
      { id: 'to', kind: 'factor', label: 'Specialist onboarding delay' },
    ], edges: [] };
    const record = range ? {
      code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'A link is not sized yet.', option_ids: ['choice'],
      range_by_option: { choice: { from: 'from', to: 'to', kind: 'link_existence', among: 'unsized_links',
        low_pct: percentages[0], high_pct: percentages[1], low_rounding: 'whole', high_rounding: 'whole' } },
    } : {
      code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['choice'],
      option_labels_by_option: { choice: frame.label }, goal_node_id: 'goal', goal_label: 'Productivity',
      pct_by_option: { choice: frame.sentence.includes('less than 1%') ? 0 : percentages[0] },
      target: { comparator: 'at_least', value: 10, unit: '%' },
      olumi_estimate_link_count: Number(frame.sentence.match(/(\d+) relationships?/)?.[1] ?? 0),
      olumi_estimate_value_count: Number(frame.sentence.match(/(\d+) starting values?/)?.[1] ?? 0),
      olumi_estimate_settings_by_option: { choice: Number(frame.sentence.match(/(\d+) option settings?/)?.[1] ?? 0) },
    };
    const analysisResult = { enrichment: { inference_warnings: [record] } };
    expect(screenLines.licensedGoalChanceLinesForAgent(analysisResult, model, true)).toHaveLength(1);
    const body = { assistant_text: frame.sentence };
    expect(withEstimateGoalPointsAtEgress(body, { graph: model, analysisResult, current: true })).toBe(body);
  },
);

it('B2q range endpoints and edge precision come from the actual licence formatter', () => {
  const model = { nodes: [{ id: 'choice', kind: 'option', label: 'Add one specialist' },
    { id: 'from', kind: 'factor', label: 'Capacity' }, { id: 'to', kind: 'factor', label: 'Delay' }], edges: [] };
  const analysisResult = { enrichment: { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'A link is not sized yet.', option_ids: ['choice'],
    range_by_option: { choice: { from: 'from', to: 'to', kind: 'link_existence', among: 'unsized_links',
      low_pct: 21, high_pct: 36, low_rounding: 'whole', high_rounding: 'whole' } } }] } };
  const licensed = screenLines.licensedGoalChanceLinesForAgent(analysisResult, model, true)[0]!;
  const apply = (assistant_text: string) => withEstimateGoalPointsAtEgress({ assistant_text }, { graph: model, analysisResult, current: true }).assistant_text;
  const correct = `Add one specialist is ${licensed.figure} likely to meet your goal.`;
  expect(apply(correct)).toBe(correct);
  expect(apply(correct.replace('21%', '22%'))).toBe(licensed.chance);
  expect(apply(correct.replace('36%', '35%'))).toBe(licensed.chance);
  expect(apply('Add one specialist is 21% likely to meet your goal.')).toBe(licensed.chance);
  for (const pct of [0, 100]) {
    const analysisResult = { enrichment: { inference_warnings: [{ ...licence, pct_by_option: { raise: pct } }] } };
    const face = screenLines.licensedGoalChanceLinesForAgent(analysisResult, graph, true)[0]!;
    const text = `Raise to £59 is ${face.figure} likely to meet your goal.`;
    expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, { graph, analysisResult, current: true }).assistant_text).toBe(text);
    expect(withEstimateGoalPointsAtEgress({ assistant_text: text.replace(face.figure, `${pct}%`) }, {
      graph, analysisResult, current: true,
    }).assistant_text).toBe(face.chance);
  }
});


it('B2q an exact goal name is checked even when the Run has no usable goal identity', () => {
  const text = 'Monthly recurring revenue is reached in 68% of cases.';
  expect(withEstimateGoalPointsAtEgress({ assistant_text: text }, { graph, analysisResult: {}, current: true }).assistant_text).toBe('');
  const conflict = { input_snapshot: { goal_node_id: 'another' }, ...result };
  expect(withEstimateGoalPointsAtEgress({ assistant_text: 'Raise to £59 is 68% likely.' }, {
    graph, analysisResult: conflict, current: true,
  }).assistant_text).toBe('');
});


it('B2q a protected user quote cannot hide the adjacent AI percentage in the same sentence', () => {
  const quote = 'Raise to £59';
  const apply = (assistant_text: string) => withEstimateGoalPointsAtEgress({ assistant_text }, {
    graph, analysisResult: result, current: true, userAuthoredTexts: [quote],
  }).assistant_text;
  const licensed = `You named “${quote}”, with a 67% chance in this model.`;
  expect(apply(licensed)).toBe(licensed);
  expect(apply(`You named “${quote}”, with a 68% chance in this model.`)).toBe(`You named “${quote}” ${line.chance}`);
  const separate = `You named “${quote}”. The chance of supplier failure is 68%.`;
  expect(apply(separate)).toBe(separate);
});
