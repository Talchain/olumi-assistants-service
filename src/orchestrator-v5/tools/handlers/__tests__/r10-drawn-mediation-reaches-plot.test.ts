/**
 * R10 (DL verdict on PLoT #397, watch row): A DRAWN outcome→outcome, outcome→risk OR risk→outcome LINK SURVIVES CEE TO
 * THE RUN. PLoT now forwards these links as drawn (#397, served 6762221; AIQ wire witness 5873121157), so the Run is
 * only honest if CEE's own path from the persisted model to `/v2/run` does not drop them either. This drives the REAL
 * run_analysis handler on a persisted snapshot carrying all three, and reads the graph it hands the PLoT client.
 * Bound by identity: each link is located by its from/to ids.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST = 'req-r10-mediation';

const link = (from: string, to: string, mean: number) => ({
  from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9, effect_direction: mean < 0 ? 'negative' : 'positive',
});

function drawnGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point', observed_state: { value: 0.5 } },
      { id: 'out_units', kind: 'outcome', label: 'Units sold' },
      { id: 'out_sales', kind: 'outcome', label: 'Sales' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
    ],
    edges: [
      link('fac_price', 'out_units', -0.5),
      link('out_units', 'out_sales', 0.7), // outcome → outcome (mediation)
      link('out_units', 'risk_churn', -0.3), // outcome → risk
      link('risk_churn', 'out_sales', -0.4), // risk → outcome (a risk's impact)
      link('out_sales', 'goal_revenue', 0.8),
    ],
  });
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO,
      request_id: REQUEST,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't-r10', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

describe('R10 — a drawn mediation link reaches PLoT from the Run', () => {
  it('outcome→outcome, outcome→risk and risk→outcome are in the graph CEE sends to /v2/run, unchanged', async () => {
    const graph = drawnGraph();
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      options: [
        { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_price: 0.8 } },
        { id: 'opt_wait', option_id: 'opt_wait', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      ],
      goal_node_id: 'goal_revenue',
      rawPersistedGraph: graph,
    };
    const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
    let sent: { graph: GraphV3T } | undefined;
    const run = vi.fn((payload: Record<string, unknown>) => {
      sent = payload as unknown as { graph: GraphV3T };
      return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
    });
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader });

    await handler(invocation());

    expect(run, 'PRECONDITION: the Run reached PLoT').toHaveBeenCalledOnce();
    const edges = sent!.graph.edges;
    const find = (from: string, to: string) => edges.find((e) => e.from === from && e.to === to);
    // Positive control: an ordinary factor→outcome link is there.
    expect(find('fac_price', 'out_units')).toBeDefined();
    for (const [from, to, mean] of [['out_units', 'out_sales', 0.7], ['out_units', 'risk_churn', -0.3], ['risk_churn', 'out_sales', -0.4]] as const) {
      const e = find(from, to);
      expect(e, `${from}→${to} reaches PLoT`).toBeDefined();
      expect(e!.strength.mean).toBe(mean);
    }
  });
});
