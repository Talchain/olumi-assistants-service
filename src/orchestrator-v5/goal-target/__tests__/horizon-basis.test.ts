import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CanonicalAnalysisCell } from '../../../routes/canonical-analysis-view.js';
import { describe, expect, it } from 'vitest';
import { horizonSteadyAttested, steadyAttestationKey, stripSteadyAttestation } from '../horizon-basis.js';
import { applyGoalSteadyEdit } from '../goal-steady-write.js';
import { goalChanceLicenceOf, goalChanceLicenceForAgent, agentLicenceRecordOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { untestedHorizonLine, untestedHorizonLineForCells, withUntestedHorizonWarning } from '../../agent-lane/decision-input-ask.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { stripModelAuthoredGoalThreshold } from '../../../adapters/llm/normalisation.js';
import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations, checkFieldSafety } from '../../graph-management/field-safety.js';

type Rec = Record<string, any>;
const SCENARIO = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const FX = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as Rec;
export const seed = (): Rec => {
  const graph = structuredClone(FX.graph_with_target);
  graph.nodes.find((n: Rec) => n.id === 'monthly_cancellations').goal_horizon_months = 9;
  return projectGraphForPersistence(graph) as Rec;
};
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === 'monthly_cancellations');
const triple = { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: 9, horizon_basis_key: 'forged' };
const envelope = () => ({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.62 }, { option_id: 'b', probability_of_goal: 0.41 }], inference_warnings: [] as Rec[] });
const admitted = (): Rec => {
  const graph = seed();
  const edit = applyGoalSteadyEdit(graph, { goal_id: goalOf(graph).id, months: 9 }, SCENARIO);
  expect(edit.kind).toBe('mutated');
  if (edit.kind !== 'mutated') throw new Error('not written');
  return edit.mutatedGraph;
};

describe('Science §(ad)(3): the USER answer is bound to goal meaning, month and scenario', () => {
  it('not pressed: false; a offered label or bare yes is no attestation', () => {
    expect(horizonSteadyAttested(seed(), SCENARIO)).toBe(false);
    expect(horizonSteadyAttested('yes', SCENARIO)).toBe(false);
  });
  it('press writer stamps the admitted four fields; schema and persistence keep it', () => {
    const graph = admitted();
    expect(goalOf(graph)).toMatchObject({ ...triple, horizon_basis_key: steadyAttestationKey(goalOf(graph), SCENARIO) });
    expect(horizonSteadyAttested({ ...graph, nodes: graph.nodes.map((n: Rec) => NodeV3.parse(n)) }, SCENARIO)).toBe(true);
    expect(horizonSteadyAttested(projectGraphForPersistence(graph), SCENARIO)).toBe(true);
  });
  it('Olumi provenance and absent provenance both fail', () => {
    const graph = admitted();
    const goal = goalOf(graph);
    goal.horizon_basis_source = 'olumi_reading';
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    delete goal.horizon_basis_source;
    expect(horizonSteadyAttested({ nodes: [goal] }, SCENARIO)).toBe(false);
  });
  it('H edited 9→12: predicate false and untested line returns again', () => {
    const graph = admitted();
    goalOf(graph).goal_horizon_months = 12;
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    expect(untestedHorizonLine(graph, { besideChance: true, scenarioId: SCENARIO })).not.toBeNull();
    expect(goalChanceLicenceOf(envelope(), graph, goalOf(graph).id, undefined, undefined, SCENARIO)).not.toHaveProperty('horizon_basis');
    expect(applyGoalSteadyEdit(graph, { goal_id: goalOf(graph).id, months: 9 }, SCENARIO)).toMatchObject({ kind: 'refused', reason: 'goal_month_changed' });
  });
  it.each([null, [], {}, { kind: 'factor', goal_horizon_months: 9, ...triple },
    { kind: 'goal', goal_horizon_months: 0, ...triple }, { kind: 'goal', goal_horizon_months: 1.5, ...triple }])('malformed/non-goal fails: %j', goal => {
    expect(horizonSteadyAttested({ nodes: [goal] }, SCENARIO)).toBe(false);
  });
  it('licence carries Science’s exact Why through both Agent readers; both warning readers return null', () => {
    const graph = admitted();
    const goal = goalOf(graph);
    const why = `You said ‘${goal.label}’ stays about where it is over 9 months unless you act, so this is its chance once each option is in effect.`;
    const licence = goalChanceLicenceOf(envelope(), graph, goal.id, undefined, undefined, SCENARIO)!;
    expect(licence.horizon_basis).toEqual({ basis: 'steady_attested', source: 'user_stated', months: 9, why });
    const run = withGoalChanceLicence(envelope(), graph, goal.id, undefined, undefined, SCENARIO);
    expect(goalChanceLicenceForAgent(run)?.horizon_basis).toEqual(licence.horizon_basis);
    expect(agentLicenceRecordOf(run)?.horizon_basis).toEqual(licence.horizon_basis);
    expect(untestedHorizonLine(graph, { scenarioId: SCENARIO })).toBeNull();
    expect(untestedHorizonLineForCells(graph, [], SCENARIO)).toBeNull();
    const stale = { ...run, inference_warnings: [...run.inference_warnings,
      { code: 'GOAL_HORIZON_NOT_TESTED', message: 'old month' }] };
    expect(withUntestedHorizonWarning(stale, graph, [], true, SCENARIO).inference_warnings.some(w => w.code === 'GOAL_HORIZON_NOT_TESTED')).toBe(false);
  });
  it('drafter-forged four fields is stripped before admission', () => {
    const graph = seed();
    Object.assign(goalOf(graph), triple);
    const stripped = stripModelAuthoredGoalThreshold(graph);
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    expect(stripped.fields).toEqual(expect.arrayContaining(Object.keys(triple)));
    for (const key of Object.keys(triple)) expect(goalOf(graph)).not.toHaveProperty(key);
  });
  it('generic add-node strip and field deny protect all four keys', () => {
    for (const key of Object.keys(triple)) {
      expect(PIPELINE_OWNED_ROOTS.has(key)).toBe(true);
      expect(checkFieldSafety({ kind: 'update_node_field', payload: {
        node_id: goalOf(seed()).id, field: key, to: (triple as Rec)[key],
      } } as never)).toMatchObject({ ok: false, code: 'PIPELINE_OWNED_FIELD' });
    }
    const stripped = stripPipelineOwnedFromAddOperations([{ op: 'add_node', value: { ...goalOf(seed()), ...triple } }]);
    expect(horizonSteadyAttested({ nodes: [stripped.operations[0]!.value] }, SCENARIO)).toBe(false);
    for (const key of Object.keys(triple)) expect(stripped.operations[0]!.value).not.toHaveProperty(key);
  });
  it('freshness: valid press moves the hash; invalid/non-user triples do not', () => {
    const base = seed();
    const hash = computeAnalysisAffectingGraphHash(base as never);
    // Computed with HEAD 97f376fa's unchanged hash implementation on this same persisted fixture.
    expect(hash).toBe('e304f1c831ff6b9a');
    expect(computeAnalysisAffectingGraphHash(admitted() as never)).not.toBe(hash);
    const unkeyed = { horizon_basis: triple.horizon_basis, horizon_basis_source: triple.horizon_basis_source, horizon_basis_months: triple.horizon_basis_months };
    Object.assign(goalOf(base), unkeyed, { horizon_basis_source: 'olumi_reading' });
    expect(computeAnalysisAffectingGraphHash(base as never)).toBe(hash);
    Object.assign(goalOf(base), unkeyed, { horizon_basis_months: 12 });
    expect(computeAnalysisAffectingGraphHash(base as never)).toBe(hash);
  });
});

describe('P45 temporal binding and carrier precedence', () => {
  it.each(['label', 'goal_threshold_unit', 'id'])('press then goal %s edit at the same months voids the attestation', field => {
    const graph = admitted();
    const goal = goalOf(graph);
    const hash = computeAnalysisAffectingGraphHash(graph as never);
    goal[field] = field === 'label' ? 'Annual recurring revenue' : field === 'id' ? 'other_goal' : '£/year';
    expect(goal.goal_horizon_months).toBe(9);
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    const licence = goalChanceLicenceOf(envelope(), graph, goal.id, undefined, undefined, SCENARIO);
    expect(licence?.horizon_basis).toBeUndefined();
    expect(computeAnalysisAffectingGraphHash(graph as never)).not.toBe(hash);
  });
  it('same graph bytes copied to a different scenario void the attestation', () => {
    const graph = admitted();
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(true);
    expect(horizonSteadyAttested(graph, 'different-scenario')).toBe(false);
    expect(goalChanceLicenceOf(envelope(), graph, goalOf(graph).id, undefined, undefined, 'different-scenario')).not.toHaveProperty('horizon_basis');
  });
  it('absent scenario, missing key and a mismatched key fail closed', () => {
    const graph = admitted();
    expect(horizonSteadyAttested(graph, undefined)).toBe(false);
    expect(goalChanceLicenceOf(envelope(), graph, goalOf(graph).id)).not.toHaveProperty('horizon_basis');
    delete goalOf(graph).horizon_basis_key;
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    goalOf(graph).horizon_basis_key = 'wrong';
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
  });
  it('label normalisation preserves the same meaning and the key is the specified sha256 prefix', () => {
    const graph = admitted();
    const goal = goalOf(graph);
    goal.label = `  ${goal.label.toUpperCase().replace(/ /g, '   ')}  `;
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(true);
    expect(goal.horizon_basis_key).toBe(createHash('sha256').update(JSON.stringify([
      SCENARIO, goal.id, goal.label.trim().toLowerCase().replace(/\s+/g, ' '), goal.goal_threshold_unit ?? null, 9,
    ])).digest('hex').slice(0, 32));
  });
  it('attested + UNCONFIRMED accumulation carrier: predicate false and final warning returns', () => {
    const graph = admitted();
    const cells: readonly CanonicalAnalysisCell[] = [{ kind: 'figure', display: '60%' }];
    const before = withUntestedHorizonWarning(envelope(), graph, cells, false, SCENARIO);
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(true);
    expect(before.inference_warnings.some(w => w.code === 'GOAL_HORIZON_NOT_TESTED')).toBe(false);
    graph.nodes.push({ id: 'unconfirmed_stock', kind: 'outcome', label: 'Stock at month 9',
      nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'],
        horizon_months: 9, rate_scale: 0.01, stated_in_brief: false } });
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
    expect(untestedHorizonLine(graph, { besideChance: true, scenarioId: SCENARIO })).not.toBeNull();
    const warned = withUntestedHorizonWarning(envelope(), graph, cells, false, SCENARIO);
    expect(warned.inference_warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GOAL_HORIZON_NOT_TESTED', message: untestedHorizonLineForCells(graph, cells, SCENARIO) }),
    ]));
    expect(goalChanceLicenceOf(envelope(), graph, goalOf(graph).id, undefined, undefined, SCENARIO)).not.toHaveProperty('horizon_basis');
  });
  it('shared ingress strip removes all four fields from every node without changing other meaning', () => {
    const graph = admitted();
    const goal = goalOf(graph);
    const originalLabel = goal.label;
    const originalMonths = goal.goal_horizon_months;
    Object.assign(graph.nodes.find((n: Rec) => n.kind === 'factor'), triple);
    stripSteadyAttestation(graph);
    for (const node of graph.nodes) for (const field of Object.keys(triple)) expect(node).not.toHaveProperty(field);
    expect(goal).toMatchObject({ label: originalLabel, goal_horizon_months: originalMonths });
    expect(horizonSteadyAttested(graph, SCENARIO)).toBe(false);
  });
});

describe('Run attestation uses the stored graph before carrier projection', () => {
  it('a carrier omitted from the calculation graph still prevents the steady licence', () => {
    const calculation = admitted();
    const stored = structuredClone(calculation);
    stored.nodes.push({ id: 'excluded_stock', kind: 'outcome', label: 'Stock',
      nonlinear_identity: { operation: 'accumulation', stated_in_brief: false } });
    expect(goalChanceLicenceOf(envelope(), calculation, goalOf(calculation).id, undefined, undefined, SCENARIO)?.horizon_basis).toBeDefined();
    const licence = withGoalChanceLicence(envelope(), calculation, goalOf(calculation).id, undefined, undefined, SCENARIO, stored);
    expect(agentLicenceRecordOf(licence)?.horizon_basis).toBeUndefined();
  });
});
