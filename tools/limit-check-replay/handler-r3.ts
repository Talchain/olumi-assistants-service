import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScenarioSnapshotForRunAnalysis } from '../../src/orchestrator-v5/build-turn-context.js';
import { createNoopSessionStore } from '../../src/orchestrator-v5/session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import { createRunAnalysisHandler, type ScenarioReader } from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import { optionsOf, j3WithLimits } from './r3-cases.js';
import type { Rec } from './r2-cases.js';

async function handlerResult(graph: Rec, identityEvaluations: Rec[] = [], starterOnly = false): Promise<Rec> {
  const store = createNoopSessionStore({ loadGraphResult: structuredClone(graph) });
  const scenario = 'e4a09e31-a6e5-4113-b8ff-03ba985a63e6';
  const reader: ScenarioReader = id => loadScenarioSnapshotForRunAnalysis(id, 'lim1-r3-handler', store);
  let calls = 0;
  const client = { validatePatch: async () => ({}), run: async (payload: Rec) => {
    calls++;
    const scoredOptions = starterOnly ? payload.options.filter((o: Rec) => o.id === 'launch_starter_tier') : payload.options;
    return {
      request_schema_version: 'v3', endpoint_version: 'v2/run', analysis_status: 'computed',
      option_comparison_status: 'computed', constraints_status: 'computed', robustness_status: 'computed', drivers_status: 'computed',
      identity_evaluations: identityEvaluations,
      option_comparison: scoredOptions.map((o: Rec) => ({ option_id: o.id, option_label: o.label,
        outcome: { mean: 0.5, std: 0.1, p10: 0.3, p50: 0.5, p90: 0.7 }, win_probability: 0.5, probability_of_goal: 0.5,
        constraint_probabilities: Object.fromEntries(graph.goal_constraints.map((c: Rec) => [c.constraint_id, 0.8])), constraints_decision_grade: true })),
      constraint_results: scoredOptions.flatMap((o: Rec) => graph.goal_constraints.map((c: Rec) => ({ constraint_id: c.constraint_id,
        option_id: o.id, node_id: c.node_id, operator: c.operator, value: c.value, probability: 0.8,
        scale_provenance: { source: 'user', range_unified: true, decision_grade: true }, frame_verdict: 'scored' }))),
      robustness: { level: 'high', is_robust: true }, critiques: [], inference_warnings: [],
    };
  } } as unknown as PLoTClient;
  const invocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: scenario, request_id: 'lim1-r3-handler',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ scenario_id: scenario, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'lim1-r3-handler', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  const result = await createRunAnalysisHandler({ plotClient: client, scenarioReader: reader })(invocation);
  assert.equal(calls, 1, 'real handler reaches the local engine double');
  const fact = result.handler_facts[0]!;
  assert.equal(fact.fact_type, 'run_analysis');
  return fact.result as Rec;
}
export async function verifyHandler(): Promise<void> {
  const j3 = j3WithLimits();
  const actualJ3 = await handlerResult(j3.graph);
  const row = actualJ3.constraint_verdict.per_limit.find((r: Rec) => r.constraint_id === 'j3-customers');
  assert.equal(row.state, 'scored', 'J3 second synthetic limit remains scored through actual Run handler');
  // Reviewer's stated-only graph and its product operand: one option moves this limit through that identity.
  const graph = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/admission/__tests__/fixtures/t1b-126k-c7878208-graph.json', import.meta.url), 'utf8'));
  graph.goal_constraints = [{ constraint_id: 'quality', node_id: 'service_quality_deterioration', value: 1, operator: '<=', value_frame: 'level' }];
  graph.nodes.find((n: Rec) => n.id === 'service_quality_deterioration').observed_state = { value: 0, source: 'user_override' };
  const present = await handlerResult(graph, [{ node_id: 'starter_support_cost', evaluated: true }]);
  const absent = await handlerResult(graph);
  const p = (result: Rec) => result.enrichment.option_comparison.find((o: Rec) => o.option_id === 'launch_starter_tier')?.constraint_probabilities?.quality;
  assert.equal(p(present), 0.8, 'Run handler passes evaluations into the score-withhold fold');
  assert.equal(p(absent), undefined, 'declaration-only Run withholds the option score');
  const statedRow = present.constraint_verdict.per_limit.find((r: Rec) => r.constraint_id === 'quality');
  assert.equal(statedRow.state, 'scored', 'Run verdict fold passes the SAME response evaluations');
  const single = await handlerResult(graph, [{ node_id: 'starter_support_cost', evaluated: true }], true);
  assert.equal(single.constraint_verdict.per_limit.find((r: Rec) => r.constraint_id === 'quality').state, 'scored',
    'single returned option pins the verdict fold evaluation carrier independently of score withholding');
  assert.ok(optionsOf(graph).some(o => o.id === 'launch_starter_tier'));
}
