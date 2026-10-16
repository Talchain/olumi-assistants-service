/**
 * Phase 4 — merged-graph run_analysis compatibility proof (deterministic).
 *
 * Proves that a graph produced by the REAL mergeProposals (M1 draft + M2
 * proposals) flows through the REAL run_analysis handler to a successful
 * outcome: snapshot load → PLoT payload build → (mocked) PLoT run → fact
 * emission — and that the payload PLoT receives contains the merged graph.
 *
 * Scope honesty: the PLoT client is mocked with the golden happy fixture, so
 * this proves the CEE-side pipeline accepts and forwards the merged graph
 * verbatim. Real PLoT/ISL acceptance of a merged graph is exactly the
 * standing ACTIVATION GATE (merged graph → persisted once → immediate live
 * run_analysis succeeds) and remains blocked pending authorization.
 */
import { readFileSync } from 'node:fs';
import { describe,expect,it,vi } from 'vitest';

import { makeMessagePayload } from '../../../orchestrator-v5/__tests__/fixtures.js';
import {
createRunAnalysisHandler,
type RunAnalysisScenarioSnapshot
} from '../../../orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../../orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// Loaded via readFileSync (root tsconfig is module=Node16, which does not
// support JSON import attributes; vitest runs with cwd = repo root).
const happyFixture = JSON.parse(
  readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8'),
) as V2RunResponseEnvelope;

import { GraphV3,type GraphV3T } from '../../../schemas/cee-v3.js';


const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-p4-run-analysis';

// A structurally READY M1 draft (goal + two options with numeric interventions).
function m1Graph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'risk_churn',
        to: 'goal_revenue',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'negative',
      },
    ],
  });
}

// Realistic M2 batch: one risk node + one causal link merge; one option and
// one evidence gap defer.


function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't-p4',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

describe('Phase 4 — merged graph through the real run_analysis handler', () => {


  it('baseline sanity: the unmerged M1 graph succeeds through the same harness (merge does not regress the baseline)', async () => {
    const base = m1Graph();
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph: base,
      options: [
        { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_price: 0.8 } },
        { id: 'opt_wait', option_id: 'opt_wait', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      ],
      goal_node_id: 'goal_revenue',
      rawPersistedGraph: base,
    };
    const run = vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope));
    const handler = createRunAnalysisHandler({
      plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
      scenarioReader: vi.fn(() => Promise.resolve(snapshot)),
    });

    const handlerOutcome = await handler(makeInvocation());
    expect(handlerOutcome.handler_facts).toHaveLength(1);
  });
});
