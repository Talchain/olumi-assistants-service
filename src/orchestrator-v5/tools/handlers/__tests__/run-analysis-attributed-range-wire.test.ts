/**
 * Row5, option settings (DL 12 Oct): a third party's range beside a setting (`attributed_range`) is display only. Through
 * the REAL Run handler, the request PLoT receives is byte-identical with or without it, and never names it. Harness from
 * run-analysis-sent-goal-threshold.test.ts (real handler, captured PLoT client, no provider contacted).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { _resetConfigCache } from '../../../../config/index.js';

afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

type Json = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/waveB-pilot-t1b-86ccaf3-turn003.json', import.meta.url), 'utf8')) as Json;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Json;
const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPTIONS = ['raise_prices_by_10', 'launch_starter_tier'];
const SUPPLIER = 'A supplier says a specialist can contribute 10–30 features per week; I have not verified that claim.';

function graphWith(attributed: boolean): Json {
  const goal = structuredClone(capture.draft_graph.nodes.find((n: Json) => n.kind === 'goal'));
  delete goal.goal_horizon_months;
  delete goal.goal_deadline_as_stated;
  goal.goal_threshold = 0.8;
  const effect = { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'count', strength_mean: 0.6, strength_mean_frame: 'edge_strength' };
  return {
    nodes: [goal,
      ...OPTIONS.map((id, i) => ({ id, kind: 'option', label: `Option ${i + 1}`, interventions: { lever: {
        value: 0.2 + i * 0.6, raw_value: 20 + i * 60, source: 'cee_hypothesis',
        ...(attributed && i === 0 ? { attributed_range: { low: 10, high: 30, meaning: 'min_max', source: 'brief_extraction', source_quote: SUPPLIER } } : {}),
      } } })),
      { id: 'decision', kind: 'decision', label: 'Pricing strategy' },
      { id: 'lever', kind: 'factor', label: 'Lever', observed_state: { value: 0.5, source: 'user_override' } }],
    edges: [...OPTIONS.flatMap((id) => [
      { from: 'decision', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } },
      { from: id, to: 'lever', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified', natural_effect: effect } }]),
    { from: 'lever', to: 'monthly_recurring_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'user_specified', natural_effect: effect } }],
  };
}

/** The graph the real handler sends PLoT for a stored graph. */
async function sentGraph(graph: Json): Promise<Json> {
  vi.stubEnv('CEE_HMAC_SECRET', 'row5-wire-test-only'); _resetConfigCache();
  const store = { readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null }), loadGraph: async () => structuredClone(graph) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'row5-load', store as never);
  const body = structuredClone(happy);
  body.option_comparison = structuredClone(capture.blocks.find((b: Json) => b.type === 'analysis_result').enrichment.option_comparison)
    .filter((r: Json) => OPTIONS.includes(r.option_id));
  body.option_comparison_status = 'computed';
  const run = vi.fn(async () => body as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'row5-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'row5-turn', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'row5-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  return (run.mock.calls as unknown as [Json][])[0][0].graph;
}

describe('display only: the real Run handler never sends a third party\'s range', () => {
  it('the stored graph carries it; the request PLoT receives does not, and is byte-identical to the request without it', async () => {
    const withRange = graphWith(true);
    expect(JSON.stringify(withRange)).toContain('attributed_range');
    const sentWith = await sentGraph(withRange);
    const sentWithout = await sentGraph(graphWith(false));
    expect(JSON.stringify(sentWith)).not.toContain('attributed_range');
    expect(JSON.stringify(sentWith)).toBe(JSON.stringify(sentWithout));
    expect(sentWith.nodes.find((n: Json) => n.id === OPTIONS[0]).interventions.lever).toBeDefined();
  });
});
