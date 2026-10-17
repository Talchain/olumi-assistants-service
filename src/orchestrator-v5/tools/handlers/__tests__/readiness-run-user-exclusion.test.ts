import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { AnalysisNotReadyError } from '../analysis-ready-core.js';
import { createRunAnalysisHandler, HandlerInvocationFailedError } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';

const captured = JSON.parse(readFileSync(new URL('./fixtures/founder-excluded-option-8d9ef02e.json', import.meta.url), 'utf8'));
const happy = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url), 'utf8'));
const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function invoke(graph: typeof captured, useRealLoader = false) {
  const run = vi.fn(async (payload: Record<string, unknown>) => {
    const options = payload.options as Array<{ option_id: string; label: string }>;
    // The served PLoT 58b3e3c4 /v2/run schema requires two options. No engine call.
    if (options.length < 2) throw new Error('engine contract: fewer than two options');
    return { ...structuredClone(happy), results: options.map((o, i) => ({ option_id: o.option_id,
      option_label: o.label, win_probability: i === 0 ? 0.6 : 0.4, percentile_p10: 0.3, percentile_p90: 0.7 })) };
  });
  const ready = buildCanonicalAnalysisReadyFromGraph(graph)!;
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn() } as unknown as PLoTClient,
    // Exercise the handler's own admission as well as the real loader below.
    scenarioReader: useRealLoader
      ? () => loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-handler-loader', createNoopSessionStore({ loadGraphResult: graph }))
      : async () => ({ graph, rawPersistedGraph: graph, goal_node_id: ready.goal_node_id,
        options: ready.options.map(o => ({ ...o, id: o.option_id })) }),
  });
  const invocation: HandlerInvocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }], session_id: scenarioId, request_id: 'req-exclusion',
      budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 'exclusion-turn', scenario_id: scenarioId, message: 'Run analysis',
      turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-exclusion', signal: new AbortController().signal, orientationText: '',
  };
  return { run, result: () => handler(invocation), ready };
}

async function refusalAgrees(graph: typeof captured) {
  const before = structuredClone(graph);
  const { run, result, ready } = invoke(graph);
  const failure = await result().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(HandlerInvocationFailedError);
  if (!(failure instanceof HandlerInvocationFailedError)) throw failure;
  expect(failure.cause_kind).toBe('analysis_not_ready');
  expect(failure.details.reason_code).toBe('insufficient_analysable_options');
  expect(run).not.toHaveBeenCalled();
  expect(ready.status).toBe('blocked');
  expect(ready.may_run).toBe(false);
  expect(ready.analysis_admission?.structurally_analysable).toBe(false);
  expect(ready.analysis_admission?.reasons.find(r => r.field === 'structurally_analysable')?.message)
    .toBe(failure.details.next_step);
  expect(ready.readiness_issues?.find(i => i.code === 'FEWER_THAN_TWO_OPTIONS')?.message).toBe(failure.details.next_step);
  const route = assessRouteAdmission(graph);
  expect(route.may_run).toBe(false);
  const store = createNoopSessionStore({ loadGraphResult: graph });
  const load = await loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-load-exclusion', store).catch(e => e);
  expect(load).toBeInstanceOf(AnalysisNotReadyError);
  expect(load.verdict.nextStep).toBe(failure.details.next_step);
  expect(load.structuralReadiness).toEqual(ready);
  const production = invoke(graph, true);
  const loadedFailure = await production.result().catch((error: unknown) => error);
  expect(loadedFailure).toBeInstanceOf(HandlerInvocationFailedError);
  if (!(loadedFailure instanceof HandlerInvocationFailedError)) throw loadedFailure;
  expect(loadedFailure.cause_kind).toBe('analysis_not_ready');
  expect(loadedFailure.details.next_step).toBe(failure.details.next_step);
  expect(production.run).not.toHaveBeenCalled();
  expect(graph, 'assessment and refusal never restore an excluded option or alter its authorship').toEqual(before);
}

function synthetic(topic: string, excluded: number) {
  const options = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'option', label: `${topic} ${id}`,
    interventions: { factor: { value: [0.2, 0.4, 0.6][i], source: 'user_specified' } },
    ...(i < excluded ? { option_status: 'removed', analysis_participation: 'retained_excluded' } : {}) }));
  return { nodes: [{ id: 'goal', kind: 'goal', label: topic }, { id: 'decision', kind: 'decision', label: 'Approaches' },
    { id: 'factor', kind: 'factor', label: 'Capacity', category: 'controllable',
      observed_state: { value: 0.5, source: 'brief_extraction' } }, ...options],
    edges: [{ from: 'factor', to: 'goal' }, ...options.flatMap(o => [{ from: 'decision', to: o.id }, { from: o.id, to: 'factor' }])]
      .map(e => ({ ...e, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })) };
}

describe('one comparison admission after user exclusions', () => {
  it('captured revision 5: the excluded baseline cannot count toward READY_TO_COMPARE', async () => {
    await refusalAgrees(structuredClone(captured));
  });
  it.each(['Delivery capacity', 'Service throughput'])('%s: one and zero remaining options refuse before any computation', async topic => {
    for (const excluded of [2, 3]) await refusalAgrees(synthetic(topic, excluded));
  });
  it.each(['Delivery capacity', 'Service throughput'])('%s: two eligible options keep their Run and exact settings', async topic => {
    const graph = synthetic(topic, 1);
    const { ready, run, result } = invoke(graph);
    expect(ready.may_run).toBe(true);
    const store = createNoopSessionStore({ loadGraphResult: graph });
    await expect(loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-two-options', store)).resolves.toBeDefined();
    await result();
    expect(run).toHaveBeenCalledTimes(1);
    const sent = run.mock.calls[0]![0].options as Array<{ option_id: string; interventions: Record<string, number> }>;
    expect(sent.map(o => o.option_id)).toEqual(['b', 'c']);
    expect(sent.map(o => o.interventions.factor)).toEqual([0.4, 0.6]);
  });
  it('a matching label or an unknown option status cannot exclude another entity', async () => {
    const graph = synthetic('Retention', 0);
    graph.nodes[2] = { ...graph.nodes[2], option_status: 'removed', label: 'Retention a' };
    graph.nodes[3] = { ...graph.nodes[3], option_status: 'unknown' };
    const { ready, run, result } = invoke(graph);
    expect(ready.may_run).toBe(true);
    await result();
    expect((run.mock.calls[0]![0].options as Array<{ option_id: string }>).map(o => o.option_id)).toEqual(['a', 'b', 'c']);
  });
});
