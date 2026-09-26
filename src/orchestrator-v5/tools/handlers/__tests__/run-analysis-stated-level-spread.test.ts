/**
 * A LEVEL THE USER STATED REACHES PLoT AS STATED — carried at the minimum spread on the wire at run time, never
 * persisted (`stated-level-spread.ts`; DL #70 5848646560).
 *
 * ⚠ WHY (WIRE, engine-direct on served PLoT `1f6ad52` / ISL `8a5e973`): with no `observed_state.std`, PLoT samples
 * every factor at σ = max(0.1, 0.15·value) of its frame. "Headcount ≤ 45" on a STATED 40 that no option changes read
 * P(meets) 0.698, decision-grade; sent exactly, 1. On Paul's brief the stated £49 at the default σ put 6.05% of two
 * options' churn draws below 0%; sent exactly, 0 (`stated-fact-spread-20260926/RESULTS.md`, #70 5848641431).
 *
 * Every row goes through the real `run_analysis` handler with a mocked PLoT client and asserts, by node id, what PLoT
 * receives. Who STATED a level is the census's one authority (`earnsAuthorshipCredit(structureProvenance(node))`).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type WireNode = { id: string; observed_state?: Record<string, unknown> };

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-stated-level-spread-wire';

/** Paul's served price (brief_extraction £49, cap 200) + a support-headcount factor whose state each row sets. */
function persistedGraph(headcount: Record<string, unknown>) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'keep', kind: 'option', label: 'Keep £49', interventions: { pro_plan_price: 0.245 } },
      { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { pro_plan_price: 0.295 } },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month', source: 'brief_extraction' } },
      { id: 'support_headcount', label: 'Support headcount', ...headcount },
    ],
    edges: [
      { from: 'pro_plan_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'support_headcount', to: 'goal_mrr', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}

function makeInvocation(): HandlerInvocation {
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

/** The graph PLoT receives, through the real handler. */
async function wire(headcount: Record<string, unknown>): Promise<WireNode[]> {
  const graph = persistedGraph(headcount);
  const before = JSON.stringify(graph);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'keep', option_id: 'keep', label: 'Keep £49', interventions: { pro_plan_price: 0.245 } },
      { id: 'raise', option_id: 'raise', label: 'Raise to £59', interventions: { pro_plan_price: 0.295 } },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints: [],
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  await createRunAnalysisHandler({ plotClient, scenarioReader })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.stringify(graph), 'the persisted graph is never touched').toBe(before);
  return (captured!.graph as { nodes: WireNode[] }).nodes;
}
const osOf = (nodes: WireNode[], id: string): Record<string, unknown> => {
  const n = nodes.find((x) => x.id === id);
  expect(n?.observed_state, `${id} reaches PLoT with its level`).toBeDefined();
  return n!.observed_state!;
};

const STATED_40 = { kind: 'factor', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: 'people', source: 'brief_extraction' } };

describe('WIRE: a level the user stated reaches PLoT as stated, not at the default ±0.1 spread', () => {
  it('RED (served headcount row): the user\'s "40 support staff" is sent at the minimum spread 1e-4, level unchanged', async () => {
    const os = osOf(await wire(STATED_40), 'support_headcount');
    expect(os.std).toBe(1e-4);
    expect(os.value).toBe(0.4);
  });

  it('RED (Paul\'s brief): the user\'s £49 price is sent at the minimum spread too', async () => {
    expect(osOf(await wire(STATED_40), 'pro_plan_price').std).toBe(1e-4);
  });

  it('CONTRAST: Olumi\'s ESTIMATE of a level keeps PLoT\'s default spread (no std sent)', async () => {
    const os = osOf(await wire({ kind: 'factor', observed_state: { value: 0.4, raw_value: 40, unit: 'people', source: 'cee_inference', extractionType: 'inferred' }, scale_frame: 100 }), 'support_headcount');
    expect(os.std).toBeUndefined();
  });

  it('CONTRAST: a value the user marked as an ASSUMPTION (ratified, not stated) keeps the default spread', async () => {
    const os = osOf(await wire({ kind: 'factor', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: 'people', source: 'user_assumption' } }), 'support_headcount');
    expect(os.std).toBeUndefined();
  });

  it('CONTROL: a spread the level already carries is never overwritten', async () => {
    const os = osOf(await wire({ kind: 'factor', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: 'people', source: 'brief_extraction', std: 0.05 } }), 'support_headcount');
    expect(os.std).toBe(0.05);
  });

  it('CONTROL: a stated level on a NON-factor (an outcome) is untouched — PLoT emits parameter uncertainty for factors only', async () => {
    const os = osOf(await wire({ kind: 'outcome', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: 'people', source: 'brief_extraction' } }), 'support_headcount');
    expect(os.std).toBeUndefined();
  });
});
