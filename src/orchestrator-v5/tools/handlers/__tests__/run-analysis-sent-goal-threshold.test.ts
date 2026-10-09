import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/waveB-pilot-t1b-86ccaf3-turn003.json', import.meta.url), 'utf8')) as Json;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Json;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Run handler records the sent goal threshold on its stored licence', () => {
  it('real handler, constructed sized graph and served T1b figures: raw candidate and delta frame recorded', async () => {
    // Constructed, fully sized graph: the served graph has paths the current handler withholds before licensing.
    const optionIds = ['raise_prices_by_10', 'launch_starter_tier'];
    const graph = { nodes: [structuredClone(capture.draft_graph.nodes.find((n: Json) => n.kind === 'goal')),
      ...optionIds.map((id, i) => ({ id, kind: 'option', label: `Option ${i + 1}`, interventions: { lever: 0.2 + i * 0.6 } })),
      { id: 'decision', kind: 'decision', label: 'Pricing strategy' },
      { id: 'lever', kind: 'factor', label: 'Lever', observed_state: { value: 0.5, source: 'user_override' } }],
      edges: [...optionIds.flatMap(id => [
        { from: 'decision', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } },
        { from: id, to: 'lever', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified',
          natural_effect: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'count',
            strength_mean: 0.6, strength_mean_frame: 'edge_strength' } } }]),
        { from: 'lever', to: 'monthly_recurring_revenue', strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified',
          natural_effect: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'count',
            strength_mean: 0.6, strength_mean_frame: 'edge_strength' } } }] };
    // §(ad) S4: horizon removed — this row's claim is not about time (a held month without a carrier withholds the chance).
    for (const goal of graph.nodes.filter((n: Json) => n.kind === 'goal')) {
      delete goal.goal_horizon_months;
      delete goal.goal_deadline_as_stated;
    }
    graph.nodes[0].goal_threshold = 0.8;
    const store = { readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null }),
      loadGraph: async () => structuredClone(graph) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'threshold-load', store as never);
    const body = structuredClone(happy);
    body.option_comparison = structuredClone(capture.blocks.find((b: Json) => b.type === 'analysis_result').enrichment.option_comparison)
      .filter((r: Json) => optionIds.includes(r.option_id));
    body.option_comparison_status = 'computed';
    const run = vi.fn(async () => body as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
      scenarioReader: async () => snapshot,
    });
    const outcome = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'threshold-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ turn_id: 'threshold-turn', scenario_id: SCENARIO, message: 'Run the analysis.',
        turn_class: 'decide', stage: 'analyse' } as never),
      requestId: 'threshold-run', signal: new AbortController().signal, orientationText: '',
    } as unknown as HandlerInvocation);
    expect(run).toHaveBeenCalledOnce();
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis') as Json;
    expect(fact).toBeDefined();
    expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
    const licence = fact.result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    expect(licence).toBeDefined();
    expect(licence.sent_threshold).toEqual({ value: 126000, field: 'goal_threshold_raw', frame: 'delta' });
    expect(licence).not.toHaveProperty('spread_note_by_option');
    const wire = (run.mock.calls as unknown as [Json][])[0][0].graph;
    expect(wire.nodes.find((n: Json) => n.kind === 'goal')).toMatchObject({ goal_threshold: 0.8, goal_threshold_raw: 126000 });
  });
});
