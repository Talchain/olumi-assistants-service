/** #2762 r4: ordinary event briefs pass the production candidate checks with their goal. */
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
const budgetCandidate = (): CandidateModel => ({ ...eventCandidate(), constraints: [
  { metric: 'Budget', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
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

  it('R4-3-CONTROL quantity remains quantity beside an event word', () => {
    expect(() => eventGoal(eventCandidate(), 'Launch and reach £200k MRR by April')).toThrow('event_goal_needs_redraft');
  });

  it('R4-3-CONTROL contextual limit does not mask a separate goal quantity', () => {
    expect(() => eventGoal(budgetCandidate(), 'Launch by April on a budget of £200k and reach £300k MRR by April')).toThrow('event_goal_needs_redraft');
  });
});
