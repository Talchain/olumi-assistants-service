/** #2762 r7: class boundaries and uncarried figures through real admission and build. */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withEventNumberLoss, withEventShareDate } from '../event-by-date-model.js';
import { applyTeamShareEdit } from '../team-share-write.js';

type Rec = Record<string, any>;
const eventCandidate = (metric = 'launch', deliverable = metric): CandidateModel => ({
  goal: { kind: 'event_by_date', metric, deliverable, value: null, operator: '>=',
    unit: `% of ${deliverable}`, horizon_months: null, provenance: 'inferred' },
  options: [{ label: 'Carry on', provenance: 'ai_proposed', is_status_quo: true }],
  factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
});
const budgetCandidate = (value = 200000): CandidateModel => ({ ...eventCandidate(), constraints: [
  { metric: 'Budget', operator: '<=', value, unit: 'GBP', provenance: 'explicit' },
] });
const eventGoal = (candidate: CandidateModel, brief: string) =>
  admitCandidateModel(candidate, {}, brief).nodes.find(n => n.kind === 'goal');
async function build(candidate: CandidateModel, brief: string): Promise<{ result: Rec; graph: Rec | undefined }> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', brief,
    async (path, body) => {
      if (path.endsWith('/graph/register')) {
        graph = (body as Rec).graph;
        return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    }, async () => ({ text: JSON.stringify(candidate) }));
  return { result, graph };
}

describe('R4 ordinary event briefs through real candidate checks', () => {
  it.each([
    'Launch by April on a budget of £200k',
    'Launch by April within £200k',
    'Launch by April with £200k to spend',
    'Launch by April; the budget is £200k',
    'Launch by April and the budget is £200k',
  ])('R4-3A-LIMIT candidate attests and carries its limit: %s', brief => {
    const admitted = admitCandidateModel(budgetCandidate(), {}, brief);
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({
      threshold_source: 'definitional', goal_threshold_unit: '% of launch', goal_threshold_raw: 100,
    });
    expect(admitted.goal_constraints).toContainEqual(expect.objectContaining({
      value: 200000, operator: '<=', unit: 'GBP', provenance: 'explicit',
    }));
    expect(admitted.nodes.some(n => n.id === admitted.goal_constraints[0]!.node_id)).toBe(true);
  });

  it('R4-3A-BUILD contextual budget passes production candidate gate and registers the limit', async () => {
    const { result, graph } = await build(budgetCandidate(), 'Launch by April on a budget of £200k');
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject({ threshold_source: 'definitional' });
    expect(graph?.goal_constraints).toContainEqual(expect.objectContaining({ value: 200000, operator: '<=', unit: 'GBP' }));
    expect(result.not_represented ?? []).not.toContain(numberLossSentence('£200k'));
  });

  it.each([
    ['launch', 'launch'], ['launching', 'launch'], ['launched', 'launch'], ['launches', 'launch'],
    ['ship', 'ship'], ['shipping', 'ship'], ['shipped', 'ship'],
    ['release', 'release'], ['releasing', 'release'], ['released', 'release'],
    ['deliver', 'deliver'], ['delivering', 'deliver'], ['delivered', 'deliver'],
    ['finish', 'finish'], ['finishing', 'finish'], ['finished', 'finish'],
  ])('R4-3B-VERB candidate matches %s to %s', (verb, root) => {
    const brief = `We are ${verb} the app by April`;
    expect(eventGoal(eventCandidate(`app ${root}`, 'the app'), brief)).toMatchObject({
      threshold_source: 'definitional', goal_threshold_unit: '% of the app',
    });
  });

  it('R4-3B-BUILD launching the app passes production candidate gate', async () => {
    const { result, graph } = await build(eventCandidate('app launch', 'the app'), 'We are launching the app by April');
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject({
      threshold_source: 'definitional', goal_threshold_unit: '% of the app',
    });
  });

  it('R4-3-CONTROL genuine money goal stays quantity through candidate admission', () => {
    const candidate: CandidateModel = { ...eventCandidate(),
      goal: { metric: 'MRR', value: 200000, operator: '>=', unit: 'GBP', horizon_months: 6, provenance: 'explicit' },
    };
    const goal = eventGoal(candidate, 'reach £200k MRR by April');
    expect(goal).not.toMatchObject({ threshold_source: 'definitional' });
    expect(goal).toMatchObject({ goal_threshold_raw: 200000, goal_threshold_unit: 'GBP' });
  });

  it('R4-3-CONTROL no date budget fails production candidate gate', async () => {
    const brief = 'the launch budget is £200k';
    expect(() => eventGoal(budgetCandidate(), brief)).toThrow('event_goal_needs_redraft');
    const { result, graph } = await build(budgetCandidate(), brief);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_redraft' });
    expect(graph).toBeUndefined();
  });

  it('R6-3-CONTROL a null noncurrency event candidate discloses a separate quantity objective', () => {
    const admitted = admitCandidateModel(eventCandidate(), {}, 'Launch and reach £200k MRR by April');
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({ id: 'event_goal' });
    expect(admitted.loss).toContainEqual(expect.objectContaining({ before: '£200k MRR', reason: numberLossSentence('£200k MRR') }));
  });

  it('R6-3-CONTROL contextual limit is kept and the separate quantity objective has words', () => {
    const admitted = admitCandidateModel(budgetCandidate(), {}, 'Launch by April on a budget of £200k and reach £300k MRR by April');
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({ id: 'event_goal' });
    expect(admitted.goal_constraints).toContainEqual(expect.objectContaining({ value: 200000, unit: 'GBP' }));
    expect(admitted.loss).toContainEqual(expect.objectContaining({ before: '£300k MRR', reason: numberLossSentence('£300k MRR') }));
  });
});

describe('R7 class boundaries: whole numbers, canonical currency, and uncarried figures', () => {
  it('R7-C-DECIMAL-BEFORE-DATE launch and deadline stay together around the decimal budget', async () => {
    const candidate = { ...budgetCandidate(200500), goal: eventCandidate('app launch', 'the app').goal };
    await expectNoNumberDisclosure(candidate, 'Launch the app on a budget of £200.5k by April');
  });

  it('R7-C-VERSION a digit-dot-digit inside the app name is never a sentence boundary', async () => {
    await expectNoNumberDisclosure(eventCandidate('v2.1 app launch', 'the v2.1 app'), 'Launch the v2.1 app by April');
  });

  it('R7-C-PLAIN-MRR a secondary quantity with no currency remains disclosed', async () => {
    await expectNumberDisclosure(eventCandidate(), 'Launch by April and reach 300k MRR by April', '300k MRR');
  });

  it('R7-C-UNCARRIED-TIME an unheld decimal team duration remains one disclosed amount', async () => {
    await expectNumberDisclosure(eventCandidate(), 'Launch by April. It takes 6.5 months.', '6.5 months');
  });

  it.each([
    ['Between 4 and 6 months.', 4, 6],
    ['6.5 months.', 6.5, 6.5],
  ] as const)('R7-C-HELD-TIME a canonical team-time write carries every matching duration endpoint: %s', async (words, low, high) => {
    const { admitted } = await expectEvent(eventCandidate(), 'Launch by April');
    const dated = withEventShareDate(admitted, '2027-04-30', '2026-10-01');
    const written = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team',
      low_months: low, high_months: high, deadline: '2027-04-30', reference_date: '2026-10-01' },
    computeAnalysisAffectingGraphHash(dated as never)!);
    expect(written.kind).toBe('mutated');
    if (written.kind !== 'mutated') throw new Error('Canonical team-time write failed');
    const held = withEventNumberLoss(written.mutatedGraph as ReturnType<typeof admitCandidateModel>, `Launch by April. ${words}`);
    expect(numberLosses(held)).toEqual([]);
  });

  it('R7-C-COMPUTED-SHARE a computed completion percentage cannot carry a stated headcount', async () => {
    const { admitted } = await expectEvent(eventCandidate(), 'Launch by April');
    const dated = withEventShareDate(admitted, '2027-04-30', '2026-10-01');
    const written = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team',
      low_months: 4, high_months: 6, deadline: '2027-04-30', reference_date: '2026-10-01' },
    computeAnalysisAffectingGraphHash(dated as never)!);
    expect(written.kind).toBe('mutated');
    if (written.kind !== 'mutated') throw new Error('Canonical team-time write failed');
    const computed = written.mutatedGraph.nodes.find((node: Rec) => node.id === 'event_team').observed_state.raw_value;
    expect(computed).toBeGreaterThan(0);
    const quote = `${computed} engineers`;
    const checked = withEventNumberLoss(written.mutatedGraph as ReturnType<typeof admitCandidateModel>, `Launch by April. We have ${quote}.`);
    expect(numberLosses(checked).map(loss => loss.reason)).toEqual([numberLossSentence(quote)]);
  });

  it('R7-C-LOSS-IDEMPOTENT recomputing amount loss replaces existing disclosures without duplicates', () => {
    const brief = 'Launch by April and reach 300k MRR by April';
    const first = admitCandidateModel(eventCandidate(), {}, brief);
    const second = withEventNumberLoss(first, brief);
    expect(second).toEqual(first);
    expect(withEventNumberLoss(second, brief)).toEqual(first);
    expect(numberLosses(second).map(loss => loss.reason)).toEqual([numberLossSentence('300k MRR')]);
  });

  it('R7-C-SAME-AMOUNT a carried budget cannot hide an equal secondary quantity', async () => {
    await expectNumberDisclosure(budgetCandidate(),
      'Launch by April on a budget of £200k and reach £200k MRR by April', '£200k MRR');
  });

  it.each(['MRR', 'ARR'])('R7-C-UNNAMED-RATE a total Budget limit cannot carry the only stated %s figure', async metric => {
    await expectNumberDisclosure(budgetCandidate(), `Launch by April and reach £200k ${metric} by April`, `£200k ${metric}`);
  });

  it('R7-C-MULTIPLE each uncarried figure has its own plain sentence in loss and not_represented', async () => {
    await expectNumberDisclosure(eventCandidate(),
      'Launch by April. We have 3 engineers and 2 designers. Reach 300k MRR by April.',
      '3 engineers', '2 designers', '300k MRR');
  });

  it('R7-C-CAPACITY-SWITCH a generated zero switch cannot carry a stated zero headcount', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), options: [
      ...eventCandidate().options,
      { label: 'Hire engineers', provenance: 'ai_proposed', added_capacity: {
        monthly_share_pct: 10, lead_months_low: 1, lead_months_high: 2,
      } },
    ] };
    await expectNumberDisclosure(candidate, 'Launch by April. We have 0 engineers.', '0 engineers');
  });

  it.each([
    'Launch by April.\n\n3 engineers.',
    'Launch by April \n3 engineers.',
  ])('R7-C-NEWLINE a stated figure span starts at the number after a newline: %s', async brief => {
    await expectNumberDisclosure(eventCandidate(), brief, '3 engineers');
  });

  it('R7-C-INTERVENTION a retained factor and its actual option level carry both stated amounts', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), options: [
      ...eventCandidate().options,
      { label: 'Increase hiring cost', provenance: 'explicit', interventions: [
        { factor_label: 'Hiring cost', value: 200000, unit: 'GBP', provenance: 'explicit' },
      ] },
    ], factors: [
      { label: 'Hiring cost', role: 'controllable', baseline_known: true, baseline_value: 100000,
        unit: 'GBP', provenance: 'explicit', plausible_max: 300000 },
    ] };
    const brief = 'Launch by April. Hiring cost is £100k; Increase hiring cost to £200k.';
    const { admitted, graph, result } = await expectEvent(candidate, brief);
    for (const model of [admitted, graph]) {
      const factor = model.nodes.find((node: Rec) => node.label === 'Hiring cost');
      expect(factor.observed_state).toMatchObject({ raw_value: 100000, unit: 'GBP' });
      expect(model.nodes.find((node: Rec) => node.id === 'event_option_2').interventions[factor.id])
        .toMatchObject({ raw_value: 200000, unit: 'GBP' });
    }
    expect(numberLosses(admitted)).toEqual([]);
    expect((result.not_represented ?? []).some((reason: string) => reason.startsWith('Your brief also says "'))).toBe(false);
  });

  it.each([
    'Launch by 30 April 2027. We have 3 engineers.',
    'Launch by 2027-04-30. We have 3 engineers.',
    'Launch within 6 months. We have 3 engineers.',
  ])('R7-C-DATE a numeric deadline is exempt while the uncarried team figure is disclosed: %s', async brief => {
    await expectNumberDisclosure(eventCandidate(), brief, '3 engineers');
  });

  it('R7-C-FACTOR-SCALE a model-held normalized monetary factor is carried at its unit scale', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), factors: [
      { label: 'Hiring cost', role: 'observable', baseline_known: true, baseline_value: 100,
        unit: '£k', provenance: 'explicit', plausible_max: 200 },
    ] };
    const { admitted, graph, result } = await expectEvent(candidate, 'Launch by April. Hiring cost is £100k.');
    for (const model of [admitted, graph]) {
      expect(model.nodes).toContainEqual(expect.objectContaining({ label: 'Hiring cost',
        observed_state: expect.objectContaining({ value: 0.5, raw_value: 100, unit: '£k' }) }));
    }
    expect(numberLosses(admitted)).toEqual([]);
    expect(result.not_represented ?? []).not.toContain(numberLossSentence('£100k'));
  });
});

async function expectEvent(candidate: CandidateModel, brief: string): Promise<{ admitted: ReturnType<typeof admitCandidateModel>; graph: Rec; result: Rec }> {
  const admitted = admitCandidateModel(candidate, {}, brief);
  const { result, graph } = await build(candidate, brief);
  expect(result).toMatchObject({ ok: true, mutated: true });
  const expected = { id: 'event_goal', threshold_source: 'definitional',
    goal_threshold_unit: `% of ${candidate.goal.deliverable}`, goal_threshold_raw: 100 };
  expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject(expected);
  expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject(expected);
  for (const constraint of candidate.constraints) {
    for (const model of [admitted, graph]) {
      expect(model?.goal_constraints).toContainEqual(expect.objectContaining({ value: constraint.value, unit: constraint.unit }));
      expect(model?.nodes.some((n: Rec) => n.id === model.goal_constraints[0]!.node_id)).toBe(true);
    }
  }
  return { admitted, graph: graph!, result };
}

const numberLossSentence = (quote: string): string =>
  `Your brief also says "${quote}"; this deadline forecast doesn't model it yet.`;
const numberLosses = (model: Rec): Rec[] => model.loss.filter((loss: Rec) =>
  loss.field_path.endsWith('event_forecast_not_modelled') && loss.reason.startsWith('Your brief also says "'));
async function expectNumberDisclosure(candidate: CandidateModel, brief: string, ...quotes: string[]): Promise<void> {
  const { admitted, result } = await expectEvent(candidate, brief);
  expect(numberLosses(admitted).map(loss => loss.reason)).toEqual(quotes.map(numberLossSentence));
  for (const quote of quotes) {
    expect(admitted.loss).toContainEqual(expect.objectContaining({
      field_path: expect.stringMatching(/event_forecast_not_modelled$/), before: quote, after: null,
      reason: numberLossSentence(quote),
    }));
    expect(result.not_represented).toContain(numberLossSentence(quote));
  }
  expect(numberLosses(admitted).some(loss => /\b(?:best|winner|recommend)\b/i.test(loss.reason))).toBe(false);
}
async function expectNoNumberDisclosure(candidate: CandidateModel, brief: string): Promise<void> {
  const { admitted, result } = await expectEvent(candidate, brief);
  expect(numberLosses(admitted)).toEqual([]);
  expect((result.not_represented ?? []).some((reason: string) => reason.startsWith('Your brief also says "'))).toBe(false);
}

describe('R6 class rule: event briefs retain context and uncarried figures have words', () => {
  it('R6-C-BUDGET Launch by April on a budget of £200k', async () => {
    await expectNoNumberDisclosure(budgetCandidate(), 'Launch by April on a budget of £200k');
  });

  it('R6-C-ENGINEERS Launch by April. We have 3 engineers.', async () => {
    await expectNumberDisclosure(eventCandidate(), 'Launch by April. We have 3 engineers.', '3 engineers');
  });

  it('R6-C-HIRING Launch by April. Hiring cost is £100k.', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), factors: [
      { label: 'Hiring cost', role: 'observable', baseline_known: true, baseline_value: 100000,
        unit: 'GBP', provenance: 'explicit', plausible_max: 200000 },
    ] };
    const { admitted, graph, result } = await expectEvent(candidate, 'Launch by April. Hiring cost is £100k.');
    for (const model of [admitted, graph]) {
      expect(model.nodes).toContainEqual(expect.objectContaining({ label: 'Hiring cost',
        observed_state: expect.objectContaining({ raw_value: 100000, unit: 'GBP' }) }));
    }
    expect(numberLosses(admitted)).toEqual([]);
    expect(result.not_represented ?? []).not.toContain(numberLossSentence('£100k'));
  });

  it.each(['sales', 'marketing'])('R6-C-CAMPAIGN Launch the %s campaign by April on a budget of £200k', async kind => {
    const candidate = { ...budgetCandidate(), goal: eventCandidate(`${kind} campaign launch`, `the ${kind} campaign`).goal };
    await expectNoNumberDisclosure(candidate, `Launch the ${kind} campaign by April on a budget of £200k`);
  });

  it('R6-C-APP We are launching the app by April', async () => {
    await expectEvent(eventCandidate('app launch', 'the app'), 'We are launching the app by April');
  });

  it('R6-C-NO-DRAFTED-LIMIT money absent from the candidate still has words', async () => {
    await expectNumberDisclosure(eventCandidate(), 'Launch by April on a budget of £200k', '£200k');
  });

  it.each([
    ['GBP', 'Ensure the launch budget is £200k by April'],
    ['GBP/month', 'Launch by April on a budget of £200k'],
    ['£', 'Launch by April on a budget of £200k'],
    ['pounds', 'Ensure the launch budget is £200k by April'],
    ['pounds a month', 'Ensure the launch budget is £200k by April'],
    ['GBP million', 'Ensure the launch budget is £200k by April'],
    ['EUR million', 'Ensure the launch budget is £200k by April'],
    ['£k', 'Ensure the launch budget is £200k by April'],
    ['USD', 'Ensure the launch budget is £200k by April'],
  ])('R6-C-CURRENCY null target with %s takes normal quantity admission: %s', async (unit, brief) => {
    const candidate = brief.startsWith('Launch by') ? eventCandidate() : eventCandidate('launch budget', 'the launch budget');
    candidate.goal.unit = unit;
    const normal = { ...candidate, goal: { ...candidate.goal, kind: null } };
    const admitted = admitCandidateModel(candidate, {}, brief);
    expect(admitted).toEqual(admitCandidateModel(normal, {}, brief));
    expect(admitted.nodes.find(n => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
    const actual = await build(candidate, brief), control = await build(normal, brief);
    expect(actual.result).toMatchObject({ ok: true, mutated: true });
    expect(actual.graph).toEqual(control.graph);
    expect(actual.graph?.nodes.find((n: Rec) => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
  });

  it.each([0, 100])('R6-C-VALUE stated noncurrency target %s takes normal quantity admission', async value => {
    const candidate = eventCandidate(); candidate.goal.value = value;
    const brief = 'Launch by April';
    const admitted = admitCandidateModel(candidate, {}, brief);
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({ goal_threshold_raw: value });
    expect(admitted.nodes.find(n => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
    const { result, graph } = await build(candidate, brief);
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject({ goal_threshold_raw: value });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
  });

  it('R6-C-MRR reach £200k MRR by April stays quantity through real build', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), goal: { kind: 'event_by_date', deliverable: 'MRR',
      metric: 'MRR', value: 200000, operator: '>=', unit: 'GBP', horizon_months: 6, provenance: 'explicit' } };
    const admitted = admitCandidateModel(candidate, {}, 'reach £200k MRR by April');
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({ goal_threshold_raw: 200000, goal_threshold_unit: 'GBP' });
    expect(admitted.nodes.find(n => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
    const { result, graph } = await build(candidate, 'reach £200k MRR by April');
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject({ goal_threshold_raw: 200000, goal_threshold_unit: 'GBP' });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).not.toMatchObject({ id: 'event_goal' });
  });

  it.each([
    ['Launch by April and reach 300k GBP MRR by April', '300k GBP MRR'],
    ['Launch by April and reach GBP 300k MRR by April', 'GBP 300k MRR'],
    ['Launch by April and reach 300k pounds MRR by April', '300k pounds MRR'],
    ['Launch by April and reach 300k dollars MRR by April', '300k dollars MRR'],
    ['Launch by April and reach 300k euros MRR by April', '300k euros MRR'],
  ])('R6-C-CURRENCY-WORDS money in any position has words: %s', async (brief, quote) => {
    await expectNumberDisclosure(eventCandidate(), brief, quote);
  });

  // These r5 noun guards are re-pinned: null target + noncurrency is an event when its words/date attest.
  it.each([
    ['revenue', 'revenue', '% of revenue', 'Deliver revenue within £200k of our target by April', '£200k of our target'],
    ['launch budget', 'the launch budget', '% of the launch budget', 'Ensure the launch budget is £200k by April', '£200k'],
    ['launch', 'the launch budget', '% of the launch budget', 'Ensure the launch budget is £200k by April', '£200k'],
    ['cost', 'the cost', '% of the cost', 'Deliver the cost within £200k by April', '£200k'],
    ['spend', 'the spend', '% of the spend', 'Deliver the spend within £200k by April', '£200k'],
    ['MRR', 'MRR', '% of MRR', 'Deliver MRR within £200k of our target by April', '£200k of our target'],
  ])('R6-C-NULL-NONCURRENCY %s / %s / %s admits event and discloses money', async (metric, deliverable, unit, brief, quote) => {
    const candidate = eventCandidate(metric, deliverable);
    candidate.goal.unit = unit;
    await expectNumberDisclosure(candidate, brief, quote);
  });

  it.each([
    ['£200k', 200000, ' and '],
    ['£200.5k', 200500, ' and '],
    ['£200k', 200000, '. '],
    ['£200.5k', 200500, '. '],
  ] as const)('R6-C-MIXED-MRR %s budget at %s with %s separator preserves objective in loss', async (amount, value, separator) => {
    const candidate = budgetCandidate(value);
    const brief = `Launch by April on a budget of ${amount}${separator}reach £300k MRR by April`;
    await expectNumberDisclosure(candidate, brief, '£300k MRR');
  });

  it('R5-C2-DECIMAL-LIMIT a decimal contextual budget remains one amount through admission and build', async () => {
    const candidate = budgetCandidate(200500);
    const brief = 'Launch by April on a budget of £200.5k';
    const admitted = admitCandidateModel(candidate, {}, brief);
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({
      threshold_source: 'definitional', goal_threshold_unit: '% of launch', goal_threshold_raw: 100,
    });
    expect(admitted.goal_constraints).toContainEqual(expect.objectContaining({ value: 200500, unit: 'GBP' }));
    expect(admitted.nodes.some(n => n.id === admitted.goal_constraints[0]!.node_id)).toBe(true);
    const { result, graph } = await build(candidate, brief);
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')).toMatchObject({ threshold_source: 'definitional' });
    expect(graph?.goal_constraints).toContainEqual(expect.objectContaining({ value: 200500, unit: 'GBP' }));
    expect(graph?.nodes.some((n: Rec) => n.id === graph.goal_constraints[0]!.node_id)).toBe(true);
    expect(numberLosses(admitted)).toEqual([]);
    expect(result.not_represented ?? []).not.toContain(numberLossSentence('£200.5k'));
  });

  it.each([
    ['£200k', 200000, 'our'],
    ['£200.5k', 200500, 'our'],
    ['£200k', 200000, 'the'],
    ['£200.5k', 200500, 'the'],
    ['£200k', 200000, 'my'],
    ['£200.5k', 200500, 'my'],
  ] as const)('R6-C-MIXED-TOLERANCE %s budget at %s discloses revenue against %s target', async (amount, value, targetOwner) => {
    const candidate = budgetCandidate(value);
    const brief = `Launch by April on a budget of ${amount} and deliver revenue within £300k of ${targetOwner} target by April`;
    await expectNumberDisclosure(candidate, brief, `£300k of ${targetOwner} target`);
  });
});
