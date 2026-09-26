/**
 * A LEVEL LIMIT ON A FACTOR IS SENT WITH THAT FACTOR'S OWN SCALE — carried on the wire at run time as
 * `goal_threshold_cap`, never persisted (`level-limit-baseline.ts` `limitTargetCaps`; DL #70 5848250258).
 *
 * ⚠ WHY (SERVED, R&C `w1983-price-10fbbdf`, #70 5847390325): "keep the Pro plan price under £60" with options £49 / £59 /
 * £55 read "could not check your limit" and asked for a rerun that could never help. PLoT read the RAW 60 on the identity
 * [0, 1] intervention scale of a factor every option sets (`threshold_normalisation_defaulted`). Engine-direct on served
 * PLoT `1f6ad52` (#70 5848242345): with `goal_threshold_cap: 100` on the price node the limit is decision-grade and each
 * option is compared at the level it sets ("≤ £55": keep £49 → 1, raise to £59 → 0).
 *
 * Every row goes through the real `run_analysis` handler with a mocked PLoT client, binds the target node by id, and
 * asserts what PLoT receives. The shape is the served one: `observed_state {cap: 100, unit: "£/month", value: 0.49,
 * raw_value: 49, declared_scale: "unit_interval"}`, the limit `{value: 60, unit: "£/month"}`.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type WireNode = { id: string; kind?: string; goal_threshold_cap?: unknown; observed_state?: Record<string, unknown> };

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-limit-target-cap-wire';

const SERVED_PRICE_STATE = { cap: 100, unit: '£/month', value: 0.49, source: 'brief_extraction', raw_value: 49, declared_scale: 'unit_interval' };

function persistedGraph(price: Record<string, unknown>) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'keep_pro_price_at_49', kind: 'option', label: 'Keep £49' },
      { id: 'raise_pro_price_to_59', kind: 'option', label: 'Raise to £59', interventions: { pro_plan_price: 0.59 } },
      { id: 'set_pro_price_at_55', kind: 'option', label: 'Set £55', interventions: { pro_plan_price: 0.55 } },
      { id: 'pro_plan_price', label: 'Pro plan price', ...price },
      { id: 'out_revenue', kind: 'outcome', label: 'Revenue', observed_state: { cap: 1000, unit: '£/month', value: 0.4, raw_value: 400 } },
    ],
    edges: [
      { from: 'pro_plan_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'pro_plan_price', to: 'out_revenue', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'out_revenue', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
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

/** What PLoT receives for `target` under `limit`, through the real handler. */
async function wireNode(price: Record<string, unknown>, limit: Record<string, unknown>, target = 'pro_plan_price'): Promise<WireNode> {
  const graph = persistedGraph(price);
  const before = JSON.stringify(graph);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'keep_pro_price_at_49', option_id: 'keep_pro_price_at_49', label: 'Keep £49', interventions: { pro_plan_price: 0.49 } },
      { id: 'raise_pro_price_to_59', option_id: 'raise_pro_price_to_59', label: 'Raise to £59', interventions: { pro_plan_price: 0.59 } },
      { id: 'set_pro_price_at_55', option_id: 'set_pro_price_at_55', label: 'Set £55', interventions: { pro_plan_price: 0.55 } },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints: [{ node_id: target, operator: '<=', constraint_id: `agent-lane:${target}:<=`, provenance: 'explicit', ...limit }],
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
  const node = (captured!.graph as { nodes: WireNode[] }).nodes.find((n) => n.id === target);
  expect(node, `${target} reaches PLoT`).toBeDefined();
  return node!;
}

const PRICE = { kind: 'factor', observed_state: SERVED_PRICE_STATE };
const FRAMED_60 = { value: 60, unit: '£/month', value_frame: 'level' };

describe('WIRE: a level limit on a factor reaches PLoT with that factor\'s own scale', () => {
  it('RED (served w1983): "Pro plan price ≤ £60/month" on the price every option sets → goal_threshold_cap = the price\'s own cap (100)', async () => {
    const node = await wireNode(PRICE, FRAMED_60);
    expect(node.goal_threshold_cap).toBe(100);
    // Only the scale is added: the level PLoT compares against is untouched.
    expect(node.observed_state?.value).toBe(0.49);
  });

  it('an agent-lane estimate framed by `scale_frame` (capless, as admission writes it) carries that frame', async () => {
    const node = await wireNode(
      { kind: 'factor', scale_frame: 200, observed_state: { unit: '£/month', value: 0.245, raw_value: 49, source: 'cee_inference', extractionType: 'inferred' } },
      FRAMED_60,
    );
    expect(node.goal_threshold_cap).toBe(200);
  });

  it('CONTROL: an UNFRAMED limit carries nothing (it keeps failing closed at the frame hop)', async () => {
    const node = await wireNode(PRICE, { value: 60, unit: '£/month' });
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a DELTA limit carries nothing', async () => {
    const node = await wireNode(PRICE, { value: 5, unit: '£/month', value_frame: 'delta' });
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a limit in ANOTHER unit ("£/year" on a "£/month" price) carries nothing — it would be scored against the wrong number', async () => {
    const node = await wireNode(PRICE, { value: 60, unit: '£/year', value_frame: 'level' });
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a percentage limit carries nothing (the percent rung owns it)', async () => {
    const node = await wireNode(
      { kind: 'factor', observed_state: { cap: 100, unit: '%', value: 0.04, raw_value: 4 } },
      { value: 10, unit: '%', value_frame: 'level' },
    );
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a factor that already carries its own goal_threshold_cap is left alone (fill-only)', async () => {
    const node = await wireNode({ ...PRICE, goal_threshold_cap: 150 }, FRAMED_60);
    expect(node.goal_threshold_cap).toBe(150);
  });

  it('CONTROL: an OUTCOME target carries nothing — only a factor\'s own scale is proven here', async () => {
    const node = await wireNode(PRICE, { value: 600, unit: '£/month', value_frame: 'level' }, 'out_revenue');
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a factor with no declared scale (no cap, no scale_frame) carries nothing', async () => {
    const node = await wireNode({ kind: 'factor', observed_state: { unit: '£/month', value: 0.49 } }, FRAMED_60);
    expect(node.goal_threshold_cap).toBeUndefined();
  });

  it('CONTROL: a limit ABOVE the factor\'s cap, or at 1 or below, carries nothing', async () => {
    expect((await wireNode(PRICE, { value: 150, unit: '£/month', value_frame: 'level' })).goal_threshold_cap).toBeUndefined();
    expect((await wireNode(PRICE, { value: 1, unit: '£/month', value_frame: 'level' })).goal_threshold_cap).toBeUndefined();
  });
});
