/**
 * WIRE through the real `run_analysis` handler: a limit the LEADING option "meets" only because it sets the limit's
 * target at Olumi's own estimate is persisted as NOT checked (AI Quality, #70 5844226031). The PLoT body is the VERBATIM
 * C50 U2 capture (`gc_u2` certified `decision_grade: true`, `opt_raise` leads at 0.9985), so the only difference between
 * the rows is WHOSE level the leader sets on churn — read off the graph the run analysed.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const U2 = readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8');
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-limit-on-olumi-estimate';
const LIMIT = {
  constraint_id: 'gc_u2', node_id: 'fac_churn', operator: '<=', value: 10, unit: '%', value_frame: 'level',
  label: 'Monthly churn', provenance: 'explicit',
};

function graphWith(leaderChurn: Rec | undefined): Rec {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%' } },
      { id: 'opt_hold', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.49, source: 'user_specified' } } },
      {
        id: 'opt_raise',
        kind: 'option',
        label: '£59 with win-back',
        interventions: { fac_price: { value: 0.59, source: 'user_specified' }, ...(leaderChurn === undefined ? {} : { fac_churn: leaderChurn }) },
      },
    ],
    edges: [
      { from: 'fac_price', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_churn', to: 'goal', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
    goal_constraints: [LIMIT],
  };
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

async function persistedVerdict(leaderChurn: Rec | undefined): Promise<{ state: unknown; mayName: unknown }> {
  const graph = graphWith(leaderChurn);
  const snapshot = {
    graph,
    options: [
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_raise', option_id: 'opt_raise', label: '£59 with win-back', interventions: { fac_price: 0.59 } },
    ],
    goal_node_id: 'goal',
    goal_constraints: [LIMIT],
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  const run = vi.fn(() => Promise.resolve(JSON.parse(U2) as V2RunResponseEnvelope));
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation());
  expect(run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const v = fact.result.constraint_verdict as { constraint_verdict_state?: unknown; may_name_leading_option?: unknown } | undefined;
  if (v === undefined) throw new Error('no constraint_verdict on the fact');
  return { state: v.constraint_verdict_state, mayName: v.may_name_leading_option };
}

describe('WIRE: the persisted verdict when the leader sets the limited quantity', () => {
  it('CONTROL: the leader does not set churn → the certified score is a check (evaluated_feasible)', async () => {
    expect(await persistedVerdict(undefined)).toEqual({ state: 'evaluated_feasible', mayName: true });
  });

  it("RED: the leader sets churn at Olumi's estimate → NOT checked (unevaluated), the leader is withheld", async () => {
    expect(await persistedVerdict({ value: 0.03, raw_value: 3, source: 'cee_hypothesis' })).toEqual({
      state: 'unevaluated',
      mayName: false,
    });
  });

  it("CONTROL: the leader sets churn at the USER's own figure → still a check", async () => {
    expect(await persistedVerdict({ value: 0.03, raw_value: 3, source: 'user_specified' })).toEqual({
      state: 'evaluated_feasible',
      mayName: true,
    });
  });
});
