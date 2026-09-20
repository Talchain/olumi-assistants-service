import { describe, expect, it } from 'vitest';

import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { OptionV3, type EdgeV3T, type GraphV3T, type InterventionV3T, type OptionV3T } from '../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { EditPatchOperationLike } from '../../graph-management/adapters/edit-graph-producer.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { describeHeldOperationsSubject } from '../describe-changeset.js';
import { evaluateEditGraphMutations, GM_HELD_HANDLER_ID } from '../edit-graph-referee-gate.js';
import { buildGmHeldAppliedReceipt, executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';

const GOAL = '151fbab4';
const DECISION = '71720830';
const CAPACITY = 'founder_capacity';
const TIME = 'time_fundraising';
const CAPITAL = 'caf9ad5c';
const SYNDICATE = 'b1d7d19a';
const HYBRID = '0e4043a0';
const ANGELS = '41f060df';
const STATUS_QUO = '74d766f2';
const FUNDS = 'cbd5efa9';

interface FixtureGraph extends GraphV3T {
  schema_version: string;
  goal_node_id: string;
  options: OptionV3T[];
}

function edge(from: string, to: string, mean = 1, std = 0.01): EdgeV3T {
  return { from, to, strength: { mean, std }, exists_probability: 0.9, effect_direction: 'positive' };
}

function estimate(factorId: string, value: number, rawValue: number, unit: string): InterventionV3T {
  return {
    value, raw_value: rawValue, unit,
    source: 'cee_hypothesis',
    target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
    value_confidence: 'low',
    reasoning: 'Working estimate, not a user measurement.',
  };
}

// Captured 12928b8c factor chain, option identities and effect values, reduced
// to this lifecycle's relevant topology. Provenance and qualitative descriptions
// are explicit preservation controls; this fixture is not a full replay export.
function graph(): FixtureGraph {
  const options: OptionV3T[] = [
    { id: HYBRID, label: 'Hybrid Syndicate (Angels + Lead Fund)', description: 'Expected to take the most founder time; not quantified.', status: 'ready', is_baseline: false,
      interventions: { [SYNDICATE]: estimate(SYNDICATE, 0.4, 4, 'investors'), [CAPITAL]: estimate(CAPITAL, 0.575, 1_150_000, '£') } },
    { id: ANGELS, label: 'Target Angel Investors', description: 'Expected to take more founder time than funds; not quantified.', status: 'ready', is_baseline: false,
      interventions: { [SYNDICATE]: estimate(SYNDICATE, 0.8, 8, 'investors'), [CAPITAL]: estimate(CAPITAL, 0.45, 900_000, '£') } },
    { id: STATUS_QUO, label: 'Status Quo (Bootstrap / Defer Round)', description: 'Expected to take the least founder time; not quantified.', status: 'ready', is_baseline: true,
      interventions: { [SYNDICATE]: estimate(SYNDICATE, 0, 0, 'investors'), [CAPITAL]: estimate(CAPITAL, 0, 0, '£') } },
    { id: FUNDS, label: 'Focus Only on Funds', description: 'Expected to take less founder time than angels; not quantified.', status: 'ready', is_baseline: false,
      interventions: { [SYNDICATE]: estimate(SYNDICATE, 0.1, 1, 'investors'), [CAPITAL]: estimate(CAPITAL, 0.65, 1_300_000, '£') } },
  ];
  return {
    schema_version: 'v3', goal_node_id: GOAL,
    nodes: [
      { id: GOAL, kind: 'goal', label: 'Total Capital Secured' },
      { id: DECISION, kind: 'decision', label: 'Fundraising approach' },
      { id: CAPACITY, kind: 'factor', label: 'Founder Capacity', category: 'external',
        description: 'The amount of time and energy you personally have available, beyond running the business day-to-day.' },
      { id: TIME, kind: 'factor', label: 'Time Spent on Fundraising', category: 'controllable',
        description: 'The actual amount of time and effort actively dedicated to fundraising activities.' },
      { id: CAPITAL, kind: 'factor', label: 'Capital Raised', category: 'controllable',
        observed_state: { value: 0.01, raw_value: 20_000, unit: '£', source: 'user' } },
      { id: SYNDICATE, kind: 'factor', label: 'Investor Syndicate Size', category: 'controllable',
        observed_state: { value: 0.1, raw_value: 1, unit: 'investors', source: 'cee_inference' } },
      ...options.map(option => ({ id: option.id, kind: 'option' as const, label: option.label,
        description: option.description, is_baseline: option.is_baseline,
        interventions: structuredClone(option.interventions) })),
    ],
    edges: [
      edge(CAPACITY, TIME, 0.6, 0.2), edge(TIME, CAPITAL, 0.5, 0.2),
      edge(CAPITAL, GOAL, 0.67, 0.16), edge(SYNDICATE, GOAL, 0.3, 0.2),
      ...options.flatMap(option => [edge(DECISION, option.id), edge(option.id, SYNDICATE), edge(option.id, CAPITAL), edge(option.id, TIME)]),
    ],
    options,
  };
}

function hashOf(value: FixtureGraph): string {
  const hash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(value));
  if (hash === null) throw new Error('Fixture must have an analysis-affecting graph hash.');
  return hash;
}

function remainingEffects(value: FixtureGraph, optionId: string, factorId: string) {
  const option = value.options.find(candidate => candidate.id === optionId);
  if (!option) throw new Error('Fixture option is missing.');
  return Object.fromEntries(Object.entries(option.interventions).filter(([id]) => id !== factorId));
}

function removal(value: FixtureGraph, optionId = HYBRID, factorId = CAPITAL): EditPatchOperationLike[] {
  return [
    { op: 'update_node', path: optionId, value: { interventions: remainingEffects(value, optionId, factorId) } },
    { op: 'remove_edge', path: `${optionId}::${factorId}` },
  ];
}

function heldLifecycle(value: FixtureGraph, operations: EditPatchOperationLike[]) {
  const hash = hashOf(value);
  const decision = evaluateEditGraphMutations({
    mode: 'live', operations, currentGraph: value, currentGraphHash: hash, baseGraphHash: hash,
    freshness: 'none', scenarioId: 'capacity-held', turnId: 'offer', requestId: 'offer-request', dispatchPath: 'edit_graph',
  });
  expect(decision.governing).toBe('held');
  expect(decision.blockApply).toBe(true);
  expect(decision.pendingActions).toHaveLength(1);
  const pending = decision.pendingActions?.[0];
  if (!pending) throw new Error('Real gate did not emit an executable pending.');
  expect(pending.action).toMatchObject({ kind: 'apply_proposed_change', inline_patch: { handler_id: GM_HELD_HANDLER_ID } });
  const read = readGmHeldResume(pending);
  expect(read.kind).toBe('ok');
  if (read.kind !== 'ok') throw new Error('Real pending could not be read.');
  expect(read.operations).toEqual(operations);
  const outcome = executeGmHeldResume({
    operations: read.operations, currentGraph: value, currentGraphHash: hash,
    freshness: 'none', hasExistingAnalysis: true,
    scenarioId: 'capacity-held', turnId: 'confirm', requestId: 'confirm-request',
  });
  expect(outcome.status).toBe('executed');
  if (outcome.status !== 'executed') throw new Error(`Confirmed batch did not execute: ${JSON.stringify(outcome)}`);
  return { decision, pending, operations: read.operations, outcome };
}

function readiness(value: unknown) {
  const payload = buildCanonicalAnalysisReadyFromGraph(value);
  expect(payload).toBeDefined();
  if (!payload) throw new Error('Canonical readiness did not produce a payload.');
  return payload;
}

describe('capacity intervention removal through held confirmation and canonical readiness', () => {
  it.each([
    [HYBRID, CAPITAL, 'Capital Raised', 'Hybrid Syndicate (Angels + Lead Fund)'],
    [ANGELS, CAPITAL, 'Capital Raised', 'Target Angel Investors'],
    [ANGELS, SYNDICATE, 'Investor Syndicate Size', 'Target Angel Investors'],
  ])('removes only the confirmed %s→%s pair from both saved carriers and consumed inputs', (optionId, factorId, factorLabel, optionLabel) => {
    const before = graph();
    const untouched = structuredClone(before);
    const beforeReady = readiness(before);
    const { decision, pending, operations, outcome } = heldLifecycle(before, removal(before, optionId, factorId));
    const subject = describeHeldOperationsSubject(operations, before);
    const removalSubject = `stop fixing '${factorLabel}' under '${optionLabel}'`;
    expect(subject).toContain(removalSubject);
    expect(decision.assistantText).toContain(removalSubject);
    expect(pending.action).toMatchObject({ public_message: expect.stringContaining(removalSubject) });
    expect(buildGmHeldAppliedReceipt(subject === null ? [] : [subject])).toContain(`Confirmed: ${removalSubject}`);
    expect(outcome.fact.result).toMatchObject({ status: 'applied' });
    expect(before).toEqual(untouched);

    const persisted = projectGraphForPersistence(outcome.mutatedGraph);
    const savedOptions = OptionV3.array().parse(persisted.options);
    const savedOption = savedOptions.find(option => option.id === optionId);
    const savedNode = persisted.nodes.find(node => node.id === optionId);
    expect(savedOption?.interventions).toEqual(remainingEffects(before, optionId, factorId));
    expect(savedNode?.interventions).toEqual(remainingEffects(before, optionId, factorId));
    expect(savedOption?.raw_interventions ?? {}).not.toHaveProperty(factorId);
    expect(persisted.edges.some(candidate => candidate.from === optionId && candidate.to === factorId)).toBe(false);
    expect(persisted.edges).toEqual(before.edges.filter(candidate => candidate.from !== optionId || candidate.to !== factorId));

    for (const other of before.options.filter(option => option.id !== optionId)) {
      expect(savedOptions.find(option => option.id === other.id)).toEqual(other);
      expect(persisted.nodes.find(node => node.id === other.id)).toEqual(before.nodes.find(node => node.id === other.id));
    }
    expect(savedOption?.description).toBe(before.options.find(option => option.id === optionId)?.description);
    for (const factor of before.nodes.filter(node => node.kind === 'factor')) {
      expect(persisted.nodes.find(node => node.id === factor.id)).toEqual(factor);
    }

    const afterReady = readiness(persisted);
    const beforeConsumed = beforeReady.options.find(option => option.option_id === optionId);
    const afterConsumed = afterReady.options.find(option => option.option_id === optionId);
    expect(afterConsumed).toBeDefined();
    expect(beforeConsumed?.interventions).toHaveProperty(factorId);
    expect(afterConsumed?.interventions).not.toHaveProperty(factorId);
    expect(afterConsumed?.raw_interventions ?? {}).not.toHaveProperty(factorId);
    expect(afterConsumed?.intervention_details ?? {}).not.toHaveProperty(factorId);
    expect(afterConsumed?.interventions).not.toEqual(beforeConsumed?.interventions);
    for (const other of beforeReady.options.filter(option => option.option_id !== optionId)) {
      expect(afterReady.options.find(option => option.option_id === other.option_id)?.interventions).toEqual(other.interventions);
    }
    // A serialization/persistence projection check, not a UI reopen or inference claim.
    const reread: unknown = JSON.parse(JSON.stringify(persisted));
    expect(readiness(projectGraphForPersistence(reread)).options).toEqual(afterReady.options);
  });

  it('retains unknown capacity and time, current observations, uncertainty and qualitative assumptions', () => {
    const before = graph();
    const { outcome } = heldLifecycle(before, removal(before));
    const persisted = projectGraphForPersistence(outcome.mutatedGraph);
    for (const id of [CAPACITY, TIME]) {
      const node = persisted.nodes.find(candidate => candidate.id === id);
      expect(node?.observed_state).toBeUndefined();
      expect(node?.description).toBe(before.nodes.find(candidate => candidate.id === id)?.description);
    }
    expect(persisted.nodes.find(node => node.id === CAPITAL)?.observed_state).toEqual({
      value: 0.01, raw_value: 20_000, unit: '£', source: 'user',
    });
    expect(persisted.nodes.find(node => node.id === CAPITAL)?.observed_state).not.toHaveProperty('baseline');
    const options = OptionV3.array().parse(persisted.options);
    expect(options.find(option => option.id === HYBRID)?.interventions[SYNDICATE]).toEqual(before.options[0]?.interventions[SYNDICATE]);
    expect(options.find(option => option.id === STATUS_QUO)).toEqual(before.options.find(option => option.id === STATUS_QUO));
    for (const option of readiness(persisted).options) expect(option.interventions).not.toHaveProperty(TIME);
  });

  it('does not infer deletion from a thin node mirror that omits the capital effect', () => {
    const thin = graph();
    const hybrid = thin.nodes.find(node => node.id === HYBRID);
    if (!hybrid) throw new Error('Fixture option is missing.');
    hybrid.interventions = remainingEffects(thin, HYBRID, CAPITAL);
    const persisted = projectGraphForPersistence(thin);
    expect(persisted.options.find(option => option.id === HYBRID)?.interventions[CAPITAL]).toEqual(thin.options[0]?.interventions[CAPITAL]);
    expect(readiness(persisted).options.find(option => option.option_id === HYBRID)?.interventions).toHaveProperty(CAPITAL);
  });

  it('does not delete the saved calculation effect when a held map omission has only an unrelated edge removal', () => {
    const before = graph();
    const operations = removal(before).filter(operation => operation.op !== 'remove_edge');
    operations.push({ op: 'remove_edge', path: `${ANGELS}::${TIME}` });
    const { decision, outcome } = heldLifecycle(before, operations);
    expect(decision.assistantText).not.toContain('stop fixing');
    expect(describeHeldOperationsSubject(operations, before)).not.toContain('stop fixing');
    const persisted = projectGraphForPersistence(outcome.mutatedGraph);
    const savedOptions = OptionV3.array().parse(persisted.options);
    expect(savedOptions.find(option => option.id === HYBRID)?.interventions[CAPITAL]).toEqual(before.options[0]?.interventions[CAPITAL]);
    expect(persisted.edges.some(candidate => candidate.from === HYBRID && candidate.to === CAPITAL)).toBe(true);
    expect(readiness(persisted).options.find(option => option.option_id === HYBRID)?.interventions).toHaveProperty(CAPITAL);
  });
});
