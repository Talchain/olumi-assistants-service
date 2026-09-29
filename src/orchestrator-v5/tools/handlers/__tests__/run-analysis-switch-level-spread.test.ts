/**
 * A 0/1 SWITCH AN OPTION SETS REACHES PLoT HELD AT ITS STATE — carried at the minimum spread on the wire at run time,
 * never persisted (`stated-level-spread.ts` `carrySwitchLevelSpread`; served-claim audit P1-b, #70 5850076002).
 *
 * ⚠ WHY (SERVED `f-20260926T201724Z` step 12, CEE d6b09c0): at churn 12% (limit ≤10%) "Continue as now" read "meets it
 * in 8.22%" and "Keep £49 + add-on", with identical churn inputs, read 0. The AI release switch (the user's adopted 0)
 * carried PLoT's default binary level spread. Engine-direct on PLoT 1f6ad52 (`sq-spread-20260926/RESULTS.md`): sent at
 * the minimum spread, the status quo reads 0 and the release options 0.49 → 0.60.
 *
 * Every row goes through the real `run_analysis` handler with a mocked PLoT client, starts from the SERVED graph and
 * options (`tests/fixtures/magnitude/sq-switch-served-step12.json`, verbatim), and binds the wire node by id.
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
type Served = { graph: Record<string, unknown>; options: Array<{ option_id: string; label: string; interventions: Record<string, unknown>; is_baseline?: boolean }>; goal_node_id: string };

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SERVED = JSON.parse(readFileSync('tests/fixtures/magnitude/sq-switch-served-step12.json', 'utf-8')) as Served;
const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REQUEST_ID = 'req-switch-level-spread-wire';
const AI = 'ai_feature_availability';

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

/** The graph PLoT receives, through the real handler. `edit` changes the served shape for a contrast row. */
async function wire(edit: (s: Served) => void = () => {}): Promise<WireNode[]> {
  const served = structuredClone(SERVED);
  edit(served);
  const graph = GraphV3.parse(served.graph);
  const before = JSON.stringify(graph);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: served.options.map((o) => ({ id: o.option_id, option_id: o.option_id, label: o.label, interventions: o.interventions, ...(o.is_baseline ? { is_baseline: true } : {}) })),
    goal_node_id: served.goal_node_id,
    goal_constraints: (served.graph.goal_constraints as unknown[]) ?? [],
    rawPersistedGraph: graph,
  } as RunAnalysisScenarioSnapshot;
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
const nodeOf = (s: Served, id: string) => (s.graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === id)!;

describe('WIRE: a 0/1 switch an option sets is held at its state, not sampled as a partial state', () => {
  it('RED (served step 12): the AI release switch (the user\'s adopted 0; the release options set 1) is sent at the minimum spread', async () => {
    const os = osOf(await wire(), AI);
    expect(os.std).toBe(1e-4);
    expect(os.value).toBe(0);
  });

  it('CONTRAST: a lever that is NOT a switch (an option sets a level of 0.5) keeps PLoT\'s default spread', async () => {
    const os = osOf(await wire((s) => {
      s.options[0]!.interventions[AI] = 0.5;
      const node = (s.graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === s.options[0]!.option_id)!;
      (node.interventions as Record<string, unknown>)[AI] = { value: 0.5, source: 'cee_hypothesis' };
    }), AI);
    expect(os.std).toBeUndefined();
  });

  it('CONTRAST (MG condition 1): a CONTINUOUS lever the options set keeps its own rule — price as the user stated it stays at the stated spread, and the same price held at an Olumi ESTIMATE keeps PLoT\'s default spread', async () => {
    expect(osOf(await wire(), 'pro_plan_price').std, 'stated £49: #2027\'s stated spread, not this rule').toBe(1e-4);
    const os = osOf(await wire((s) => {
      const price = nodeOf(s, 'pro_plan_price').observed_state as Record<string, unknown>;
      price.source = 'cee_inference';
      price.extractionType = 'inferred';
    }), 'pro_plan_price');
    expect(os.std, 'uncertainty about today\'s level of a continuous lever is real').toBeUndefined();
  });

  it('CONTROL: a 0/1 factor that NO option sets or holds (a competitor launch the options never touch) keeps its default spread', async () => {
    const nodes = await wire((s) => {
      (s.graph.nodes as Array<Record<string, unknown>>).push({
        id: 'competitor_launch', kind: 'factor', label: 'Competitor launch',
        observed_state: { value: 0, raw_value: 0, unit: 'launched (0/1)', source: 'user_assumption' },
      });
      (s.graph.edges as Array<Record<string, unknown>>).push({
        from: 'competitor_launch', to: 'monthly_churn', strength: { mean: 0.5, std: 0.125 }, exists_probability: 0.8,
        effect_direction: 'positive', provenance: { source: 'cee_hypothesis' },
      });
    });
    expect(osOf(nodes, 'competitor_launch').std).toBeUndefined();
    // The positive control in the same run: the option-set switch IS held.
    expect(osOf(nodes, AI).std).toBe(1e-4);
  });

  it('CONTROL: a spread the switch already carries is never overwritten', async () => {
    const os = osOf(await wire((s) => { (nodeOf(s, AI).observed_state as Record<string, unknown>).std = 0.2; }), AI);
    expect(os.std).toBe(0.2);
  });

  it('CONTROL: an unstated, non-switch level (subscribers, the user\'s adopted 300) is untouched', async () => {
    expect(osOf(await wire(), 'pro_paying_subscribers').std).toBeUndefined();
  });
});
