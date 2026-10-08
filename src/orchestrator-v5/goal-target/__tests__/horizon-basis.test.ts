import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { horizonSteadyAttested } from '../horizon-basis.js';
import { applyGoalSteadyEdit } from '../goal-steady-write.js';
import { goalChanceLicenceOf, goalChanceLicenceForAgent, agentLicenceRecordOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { untestedHorizonLine, untestedHorizonLineForCells, withUntestedHorizonWarning } from '../../agent-lane/decision-input-ask.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { stripModelAuthoredGoalThreshold } from '../../../adapters/llm/normalisation.js';
import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations } from '../../graph-management/field-safety.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as Rec;
export const seed = (): Rec => {
  const graph = structuredClone(FX.graph_with_target);
  graph.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 9;
  return projectGraphForPersistence(graph) as Rec;
};
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const triple = { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: 9 };
const envelope = () => ({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.62 }, { option_id: 'b', probability_of_goal: 0.41 }], inference_warnings: [] });
const admitted = (): Rec => {
  const graph = seed();
  const edit = applyGoalSteadyEdit(graph, { goal_id: goalOf(graph).id, months: 9 });
  expect(edit.kind).toBe('mutated');
  if (edit.kind !== 'mutated') throw new Error('not written');
  return edit.mutatedGraph;
};

describe('Science §(ad)(3): the USER answer is bound to its month', () => {
  it('not pressed: false; a offered label or bare yes is no attestation', () => {
    expect(horizonSteadyAttested(goalOf(seed()))).toBe(false);
    expect(horizonSteadyAttested('yes')).toBe(false);
  });
  it('press writer stamps the admitted triple; schema and persistence keep it', () => {
    const graph = admitted();
    expect(goalOf(graph)).toMatchObject(triple);
    expect(horizonSteadyAttested(NodeV3.parse(goalOf(graph)))).toBe(true);
    expect(horizonSteadyAttested(goalOf(projectGraphForPersistence(graph) as Rec))).toBe(true);
  });
  it('Olumi provenance and absent provenance both fail', () => {
    const goal: Rec = { ...goalOf(seed()), ...triple };
    expect(horizonSteadyAttested({ ...goal, horizon_basis_source: 'olumi_reading' })).toBe(false);
    delete goal.horizon_basis_source;
    expect(horizonSteadyAttested(goal)).toBe(false);
  });
  it('H edited 9→12: predicate false and untested line returns again', () => {
    const graph = admitted();
    goalOf(graph).goal_horizon_months = 12;
    expect(horizonSteadyAttested(goalOf(graph))).toBe(false);
    expect(untestedHorizonLine(graph, { besideChance: true })).not.toBeNull();
    expect(goalChanceLicenceOf(envelope(), graph, goalOf(graph).id)).not.toHaveProperty('horizon_basis');
    expect(applyGoalSteadyEdit(graph, { goal_id: goalOf(graph).id, months: 9 })).toMatchObject({ kind: 'refused', reason: 'goal_month_changed' });
  });
  it.each([null, [], {}, { kind: 'factor', goal_horizon_months: 9, ...triple },
    { kind: 'goal', goal_horizon_months: 0, ...triple }, { kind: 'goal', goal_horizon_months: 1.5, ...triple }])('malformed/non-goal fails: %j', goal => {
    expect(horizonSteadyAttested(goal)).toBe(false);
  });
  it('licence carries Science’s exact Why through both Agent readers; both warning readers return null', () => {
    const graph = admitted();
    const goal = goalOf(graph);
    const why = `You said ‘${goal.label}’ stays about where it is over 9 months unless you act, so this is its chance once each option is in effect.`;
    const licence = goalChanceLicenceOf(envelope(), graph, goal.id)!;
    expect(licence.horizon_basis).toEqual({ basis: 'steady_attested', source: 'user_stated', months: 9, why });
    const run = withGoalChanceLicence(envelope(), graph, goal.id);
    expect(goalChanceLicenceForAgent(run)?.horizon_basis).toEqual(licence.horizon_basis);
    expect(agentLicenceRecordOf(run)?.horizon_basis).toEqual(licence.horizon_basis);
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(untestedHorizonLineForCells(graph, [])).toBeNull();
    const stale = { ...run, inference_warnings: [...run.inference_warnings,
      { code: 'GOAL_HORIZON_NOT_TESTED', message: 'old month' }] };
    expect(withUntestedHorizonWarning(stale, graph, [], true).inference_warnings.some(w => w.code === 'GOAL_HORIZON_NOT_TESTED')).toBe(false);
  });
  it('drafter-forged triple is stripped before admission', () => {
    const graph = seed();
    Object.assign(goalOf(graph), triple);
    const stripped = stripModelAuthoredGoalThreshold(graph);
    expect(horizonSteadyAttested(goalOf(graph))).toBe(false);
    expect(stripped.fields).toEqual(expect.arrayContaining(Object.keys(triple)));
    for (const key of Object.keys(triple)) expect(goalOf(graph)).not.toHaveProperty(key);
  });
  it('generic add-node strip and field deny protect all three keys', () => {
    for (const key of Object.keys(triple)) expect(PIPELINE_OWNED_ROOTS.has(key)).toBe(true);
    const stripped = stripPipelineOwnedFromAddOperations([{ op: 'add_node', value: { ...goalOf(seed()), ...triple } }]);
    expect(horizonSteadyAttested(stripped.operations[0]!.value)).toBe(false);
    for (const key of Object.keys(triple)) expect(stripped.operations[0]!.value).not.toHaveProperty(key);
  });
  it('freshness: valid press moves the hash; invalid/non-user triples do not', () => {
    const base = seed();
    const hash = computeAnalysisAffectingGraphHash(base as never);
    // Computed with HEAD 97f376fa's unchanged hash implementation on this same persisted fixture.
    expect(hash).toBe('e304f1c831ff6b9a');
    expect(computeAnalysisAffectingGraphHash(admitted() as never)).not.toBe(hash);
    Object.assign(goalOf(base), triple, { horizon_basis_source: 'olumi_reading' });
    expect(computeAnalysisAffectingGraphHash(base as never)).toBe(hash);
    Object.assign(goalOf(base), triple, { horizon_basis_months: 12 });
    expect(computeAnalysisAffectingGraphHash(base as never)).toBe(hash);
  });
});
