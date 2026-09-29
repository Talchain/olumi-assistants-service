/**
 * ⛔ THE CUT MARKER REACHES PLoT (AIQ 5893355501 (3); R3-B contract 5893779548; PLoT #422 served `cdf3422`). PLoT #422
 * withholds goal figures when a user-stated link was cut to the contract bound, and it reads that cut from the edge's own
 * `strength.clamped_from` (its `clampedEffects`). Construction now stores the bound WITH that marker, so the Run is only
 * honest if CEE's path from the persisted model to `/v2/run` carries it. This drives the REAL run_analysis handler on a
 * snapshot through the strict `GraphV3` parse and reads the graph it hands the PLoT client. Bound by identity (from/to).
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
const REQUEST = 'req-clamp-marker';

const edge = (from: string, to: string, strength: Record<string, number>) => ({
  from, to, strength, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'brief_extraction', magnitude: 'user_stated' }, // as construction writes a user-stated size
});

function markedGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'opt_raise', kind: 'option', label: 'Raise price', interventions: { price: 0.8 } },
      { id: 'opt_hold', kind: 'option', label: 'Hold price', interventions: { price: 0.5 } },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
      { id: 'subs', kind: 'factor', label: 'Paying subscribers', observed_state: { value: 0.5 } },
    ],
    edges: [
      edge('subs', 'mrr', { mean: 1, std: 0.1, clamped_from: 4.6117647 }), // the user's cut link (served c96fc4bb's size)
      edge('price', 'mrr', { mean: 0.4, std: 0.1 }), // an in-range link: no marker
      edge('price', 'subs', { mean: -0.3, std: 0.1 }),
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
    payload: makeMessagePayload({ turn_id: 't-clamp', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

describe('the cut marker reaches PLoT from the Run', () => {
  it('strength.clamped_from on the user\'s cut link is in the graph CEE sends to /v2/run; the in-range link carries none', async () => {
    const graph = markedGraph();
    expect(graph.edges.find((e) => e.from === 'subs')!.strength, 'PRECONDITION: the strict parse keeps the marker').toMatchObject({ mean: 1, clamped_from: 4.6117647 });
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      options: [
        { id: 'opt_raise', option_id: 'opt_raise', label: 'Raise price', interventions: { price: 0.8 } },
        { id: 'opt_hold', option_id: 'opt_hold', label: 'Hold price', interventions: { price: 0.5 } },
      ],
      goal_node_id: 'mrr',
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
    const find = (from: string, to: string) => sent!.graph.edges.find((e) => e.from === from && e.to === to);
    expect(find('subs', 'mrr')!.strength).toMatchObject({ mean: 1, clamped_from: 4.6117647 });
    expect(find('price', 'mrr')!.strength, 'CONTROL: an in-range link carries no marker').not.toHaveProperty('clamped_from');
  });
});
