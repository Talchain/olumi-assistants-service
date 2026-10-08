/** #2762 r6: the candidate decides event vs quantity through real admission and build. */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';

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
    expect(admitted.loss).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('reach £200k MRR') }));
  });

  it('R6-3-CONTROL contextual limit is kept and the separate quantity objective has words', () => {
    const admitted = admitCandidateModel(budgetCandidate(), {}, 'Launch by April on a budget of £200k and reach £300k MRR by April');
    expect(admitted.nodes.find(n => n.kind === 'goal')).toMatchObject({ id: 'event_goal' });
    expect(admitted.goal_constraints).toContainEqual(expect.objectContaining({ value: 200000, unit: 'GBP' }));
    expect(admitted.loss).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('reach £300k MRR') }));
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

async function expectMoneyDisclosure(candidate: CandidateModel, brief: string): Promise<void> {
  const { admitted, result } = await expectEvent(candidate, brief);
  expect(admitted.loss).toContainEqual(expect.objectContaining({
    field_path: 'brief.event_forecast_not_modelled', before: brief, after: null,
    reason: expect.stringContaining(brief),
  }));
  expect(result.not_represented).toContainEqual(expect.stringContaining(brief));
  expect(result.not_represented).toContainEqual(expect.stringContaining('not modelled by this forecast'));
}

describe('R6 class rule: event briefs retain context and monetary objectives have words', () => {
  it('R6-C-BUDGET Launch by April on a budget of £200k', async () => {
    await expectMoneyDisclosure(budgetCandidate(), 'Launch by April on a budget of £200k');
  });

  it('R6-C-ENGINEERS Launch by April. We have 3 engineers.', async () => {
    await expectEvent(eventCandidate(), 'Launch by April. We have 3 engineers.');
  });

  it('R6-C-HIRING Launch by April. Hiring cost is £100k.', async () => {
    const candidate: CandidateModel = { ...eventCandidate(), factors: [
      { label: 'Hiring cost', role: 'observable', baseline_known: true, baseline_value: 100000,
        unit: 'GBP', provenance: 'explicit', plausible_max: 200000 },
    ] };
    const { admitted, graph } = await expectEvent(candidate, 'Launch by April. Hiring cost is £100k.');
    for (const model of [admitted, graph]) {
      expect(model.nodes).toContainEqual(expect.objectContaining({ label: 'Hiring cost',
        observed_state: expect.objectContaining({ raw_value: 100000, unit: 'GBP' }) }));
    }
  });

  it.each(['sales', 'marketing'])('R6-C-CAMPAIGN Launch the %s campaign by April on a budget of £200k', async kind => {
    const candidate = { ...budgetCandidate(), goal: eventCandidate(`${kind} campaign launch`, `the ${kind} campaign`).goal };
    await expectMoneyDisclosure(candidate, `Launch the ${kind} campaign by April on a budget of £200k`);
  });

  it('R6-C-APP We are launching the app by April', async () => {
    await expectEvent(eventCandidate('app launch', 'the app'), 'We are launching the app by April');
  });

  it('R6-C-NO-DRAFTED-LIMIT money absent from the candidate still has words', async () => {
    await expectMoneyDisclosure(eventCandidate(), 'Launch by April on a budget of £200k');
  });

  it.each([
    ['GBP', 'Ensure the launch budget is £200k by April'],
    ['GBP/month', 'Launch by April on a budget of £200k'],
    ['£', 'Launch by April on a budget of £200k'],
    ['pounds', 'Ensure the launch budget is £200k by April'],
    ['pounds a month', 'Ensure the launch budget is £200k by April'],
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
    'Launch by April and reach 300k GBP MRR by April',
    'Launch by April and reach GBP 300k MRR by April',
    'Launch by April and reach 300k pounds MRR by April',
    'Launch by April and reach 300k dollars MRR by April',
    'Launch by April and reach 300k euros MRR by April',
  ])('R6-C-CURRENCY-WORDS money in any position has words: %s', async brief => {
    await expectMoneyDisclosure(eventCandidate(), brief);
  });

  // These r5 noun guards are re-pinned: null target + noncurrency is an event when its words/date attest.
  it.each([
    ['revenue', 'revenue', '% of revenue', 'Deliver revenue within £200k of our target by April'],
    ['launch budget', 'the launch budget', '% of the launch budget', 'Ensure the launch budget is £200k by April'],
    ['launch', 'the launch budget', '% of the launch budget', 'Ensure the launch budget is £200k by April'],
    ['cost', 'the cost', '% of the cost', 'Deliver the cost within £200k by April'],
    ['spend', 'the spend', '% of the spend', 'Deliver the spend within £200k by April'],
    ['MRR', 'MRR', '% of MRR', 'Deliver MRR within £200k of our target by April'],
  ])('R6-C-NULL-NONCURRENCY %s / %s / %s admits event and discloses money', async (metric, deliverable, unit, brief) => {
    const candidate = eventCandidate(metric, deliverable);
    candidate.goal.unit = unit;
    await expectMoneyDisclosure(candidate, brief);
  });

  it.each([
    ['£200k', 200000, ' and '],
    ['£200.5k', 200500, ' and '],
    ['£200k', 200000, '. '],
    ['£200.5k', 200500, '. '],
  ] as const)('R6-C-MIXED-MRR %s budget at %s with %s separator preserves objective in loss', async (amount, value, separator) => {
    const candidate = budgetCandidate(value);
    const brief = `Launch by April on a budget of ${amount}${separator}reach £300k MRR by April`;
    await expectMoneyDisclosure(candidate, brief);
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
    await expectMoneyDisclosure(candidate, brief);
  });
});
