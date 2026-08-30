import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { SessionStore } from '../../../session/store.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { createPLoTClient } from '../../../../orchestrator/plot-client.js';
import { _resetConfigCache } from '../../../../config/index.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { objectiveRankingFixture, withheldObjectiveRankingFixture } from '../../../../../tests/fixtures/plot/objective-ranking.js';

type Dict = Record<string, unknown>;
const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function persistedGraph(direction: 'minimise' | 'target' | undefined) {
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Outcome',
        ...(direction === undefined ? {} : { goal_direction: direction }),
        goal_threshold: 0.5, goal_threshold_frame: 'level' },
      { id: 'decision', kind: 'decision', label: 'Choose approach' },
      { id: 'factor', kind: 'factor', label: 'Input', category: 'controllable',
        observed_state: { value: 0.5, source: 'user_override' } },
      { id: 'expensive', kind: 'option', label: 'Expensive', interventions: { factor: { value: 0.8, source: 'user_specified' } } },
      { id: 'affordable', kind: 'option', label: 'Affordable', interventions: { factor: { value: 0.2, source: 'user_specified' } } },
    ],
    edges: [
      ['decision', 'expensive'], ['decision', 'affordable'],
      ['expensive', 'factor'], ['affordable', 'factor'], ['factor', 'goal'],
    ].map(([from, to]) => ({ from, to, strength: { mean: 1, std: 0.1 },
      exists_probability: 1, effect_direction: 'positive' })),
  };
}

function storeFor(graph: unknown): SessionStore {
  return { loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); _resetConfigCache(); });

describe('saved objective survives the actual snapshot loader and outgoing PLoT adapter', () => {
  it.each(['minimise', 'target', undefined] as const)('preserves %s without a default', async (direction) => {
    const graph = persistedGraph(direction);
    const store = storeFor(graph);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenarioId, 'snapshot-objective', store);
    const loadedGoal = ((snapshot.graph as Dict).nodes as Dict[]).find((node) => node.id === 'goal')!;
    expect(loadedGoal.goal_direction).toBe(direction);
    expect(Object.hasOwn(loadedGoal, 'goal_direction')).toBe(direction !== undefined);
    expect(loadedGoal.goal_threshold).toBe(0.5);
    expect(loadedGoal.goal_threshold_frame).toBe('level');
    expect(graph).toEqual(persistedGraph(direction)); // no persisted rewrite

    vi.stubEnv('PLOT_BASE_URL', 'http://snapshot-objective.test');
    _resetConfigCache();
    const response = direction === undefined ? withheldObjectiveRankingFixture() : objectiveRankingFixture();
    if (direction !== undefined) (response.objective_ranking as Dict).direction = direction;
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createPLoTClient();
    expect(client).not.toBeNull();
    const handler = createRunAnalysisHandler({ plotClient: client!, scenarioReader: (id) =>
      loadScenarioSnapshotForRunAnalysis(id, 'snapshot-objective', store) });
    await handler({
      payload: makeMessagePayload({ scenario_id: scenarioId, message: 'Run analysis', stage: 'analyse' }),
      requestId: 'snapshot-objective', signal: new AbortController().signal, orientationText: '',
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
        messages: [{ role: 'user', content: 'Run analysis' }], session_id: scenarioId,
        request_id: 'snapshot-objective', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    } as unknown as HandlerInvocation);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string) as { graph: { nodes: Dict[] } };
    const outgoingGoal = body.graph.nodes.find((node) => node.id === 'goal')!;
    expect(outgoingGoal.goal_direction).toBe(direction);
    expect(Object.hasOwn(outgoingGoal, 'goal_direction')).toBe(direction !== undefined);
    expect(outgoingGoal.goal_threshold).toBe(0.5);
    expect(outgoingGoal.goal_threshold_frame).toBe('level');
  });
});
