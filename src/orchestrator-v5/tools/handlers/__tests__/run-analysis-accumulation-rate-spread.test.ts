import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

// Same captured PLoT-request fixture style as run-analysis-stated-level-spread.test.ts.
const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-accumulation-rate-spread-wire';

function persistedGraph() {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR', nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs_m12'], stated_in_brief: true } },
      { id: 'keep', kind: 'option', label: 'Keep £49', interventions: { price: 0.245 } },
      { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { price: 0.295 } },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month', source: 'user_override' } },
      { id: 's0', kind: 'factor', label: 'Subscribers today', observed_state: { value: 0.5, raw_value: 250, cap: 500, unit: 'subscribers', source: 'user_override' } },
      { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, cap: 100, unit: '%', source: 'user_override' } },
      { id: 'inflow', kind: 'factor', label: 'New subscribers per month', observed_state: { value: 0.5, raw_value: 25, cap: 50, unit: 'subscribers per month', source: 'user_override' } },
      { id: 'subs_m12', kind: 'factor', label: 'Subscribers at month 12', scale_frame: 2200,
        nonlinear_identity: { operation: 'accumulation', factor_ids: ['s0', 'churn', 'inflow'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
    ],
    edges: [
      ...['s0', 'churn', 'inflow'].map((from) => ({ from, to: 'subs_m12', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: from === 'churn' ? 'negative' : 'positive' })),
      ...['price', 'subs_m12'].map((from) => ({ from, to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    ],
  });
}

function makeInvocation(graph: ReturnType<typeof persistedGraph>): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: graph,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID, signal: new AbortController().signal, orientationText: '',
  } as HandlerInvocation;
}

describe('WIRE: Run-only accumulation rate spread', () => {
  it('sends user rate spreads on subs_m12 through the real request builder without changing the stored graph', async () => {
    const graph = persistedGraph();
    const before = structuredClone(graph);
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph, rawPersistedGraph: graph, goal_node_id: 'goal_mrr', goal_constraints: [],
      options: [
        { id: 'keep', option_id: 'keep', label: 'Keep £49', interventions: { price: 0.245 } },
        { id: 'raise', option_id: 'raise', label: 'Raise to £59', interventions: { price: 0.295 } },
      ],
    };
    const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
    let captured: Record<string, unknown> | undefined;
    const run = vi.fn((payload: Record<string, unknown>) => {
      captured = structuredClone(payload);
      return Promise.resolve(structuredClone(happyFixture));
    });
    const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
    const invocation = makeInvocation(graph);
    await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation);
    expect(run).toHaveBeenCalledOnce();
    const wireNodes = (captured!.graph as { nodes: Array<{ id: string; nonlinear_identity?: Record<string, unknown> }> }).nodes;
    expect(wireNodes.find((node) => node.id === 'subs_m12')!.nonlinear_identity!.rate_sigma_log).toEqual([0.136, 0.136]);
    expect(wireNodes.find((node) => node.id === 'goal_mrr')!.nonlinear_identity!.rate_sigma_log).toBeUndefined();
    expect(snapshot.graph).toBe(graph);
    expect(snapshot.rawPersistedGraph).toBe(graph);
    expect(invocation.context.persistedGraph).toBe(graph);
    expect(graph).toEqual(before);
    expect(graph.nodes.find((node) => node.id === 'subs_m12')!.nonlinear_identity).not.toHaveProperty('rate_sigma_log');
  });
});
