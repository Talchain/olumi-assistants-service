/**
 * Synthetic variants of the recorded-ask/selection failure captured on 6 Sep.
 * Real Fastify route, edit dispatcher, edit handler, applier and commit composer.
 * Storage is an in-memory boundary; executor fall-through is observed separately.
 * No provider, browser, database durability or engine execution is exercised.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { parsePendingAction, type PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { _resetConfigCache } from '../../../src/config/index.js';

const writes: Array<Record<string, unknown>> = [];
let savedGraph: ReturnType<typeof fixture>;
let pendings: readonly PendingAction[] = [];
const executor = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({ runTurnExecutor: executor }));
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      writes.push(structuredClone(write));
      if (write.graph) savedGraph = structuredClone(write.graph) as typeof savedGraph;
      if (write.pending_actions) pendings = structuredClone(write.pending_actions) as PendingAction[];
      return { id: `row-${writes.length}` };
    },
    readRecent: async () => [], readFactsFor: async () => [], readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    invalidateScoped: async (_id: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    ensureScenarioExists: async () => ({ user_id: null }), storeDraftGraph: async () => undefined,
    loadGraph: async () => structuredClone(savedGraph),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(savedGraph), briefText: null }),
    readMostRecentPendingActions: async () => pendings,
    hasPriorTurns: async () => true, countTurns: async () => 2,
  }),
  resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
const provider = vi.fn(async () => { throw new Error('Unexpected provider call in deterministic percentage replay'); });
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'fixture', model: 'fixture', chat: provider, chatWithTools: provider }),
  getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'Unused deterministic replay prompt',
  getSystemPromptMeta: () => undefined,
  getSystemPromptSnapshot: async () => ({ content: 'Unused deterministic replay prompt', meta: undefined }),
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const SCENARIO = '73219066-60a1-4f04-8d71-c11ee7801898';
const CONCERN = 'Mina worries the mentoring plan could hide delivery risk; the trial evidence is incomplete.';
function fixture(optionLabel = 'Fractional engineering coach', factorLabel = 'Mentoring coverage') {
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Sustainable delivery', description: CONCERN },
      { id: 'coverage', kind: 'factor', label: factorLabel, category: 'controllable',
        observed_state: { value: 0.2, unit: 'proportion' } },
      { id: 'coach', kind: 'option', label: optionLabel },
      { id: 'pair', kind: 'option', label: 'Peer learning', interventions: { coverage: { value: 0.3 } } },
      { id: 'quality', kind: 'outcome', label: 'Maintainability', description: 'Reviewers disagree about the evidence.' },
    ],
    edges: [['coach', 'coverage'], ['pair', 'coverage'], ['coverage', 'goal'], ['coverage', 'quality']]
      .map(([from, to]) => ({ from, to, strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
  };
}
function armQuestion(): PendingAction {
  const hash = computeAnalysisAffectingGraphHash(savedGraph);
  if (!hash) throw new Error('Fixture must hash');
  const question: PendingAction = {
    id: randomUUID(), scenario_id: SCENARIO, chip_id: 'coverage-question',
    action: { kind: 'elicit_option_effect', option_id: 'coach', option_label: savedGraph.nodes[2]!.label,
      factor_id: 'coverage', factor_label: savedGraph.nodes[1]!.label },
    preconditions: { graph_hash: hash }, expires_at_turn_count: 4,
    emitted_at_iso: new Date().toISOString(), expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
  };
  expect(parsePendingAction(question)).not.toBeNull();
  pendings = [question];
  return question;
}

describe('generalisation: an ordinary percentage reaches the intended effect cell', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready(); });
  afterAll(async () => { await app.close(); vi.unstubAllEnvs(); _resetConfigCache(); });
  beforeEach(() => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live'); _resetConfigCache();
    writes.length = 0; provider.mockClear(); executor.mockReset(); savedGraph = fixture();
    GraphV3.parse(savedGraph); armQuestion();
    executor.mockResolvedValue({ response: { response_version: 2, assistant_text: 'Continue reasoning.',
      blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame' }, analysisReady: undefined, effectiveGraph: null, answerKind: 'substantive',
      mayNameLeadingOption: false, mayNameLeadingOptionProvenance: { kind: 'no_analysis' },
      telemetry: { stages_completed: ['orient', 'compose', 'commit'], response_emitted: true, llm_calls_used: 0,
        commit_performed: true, failure_type: null, wall_clock_ms: 1, turn_class: 'explore',
        intent_class: 'converse', coaching_mode: null, validation_error_code: null } });
  });
  const send = (message: string, selected = true) => app.inject({ method: 'POST', url: '/orchestrate/v2/turn',
    payload: { kind: 'message', source: 'composer', turn_id: randomUUID(), scenario_id: SCENARIO,
      stage: 'frame', turn_class: 'frame', message,
      ...(selected ? { selected_elements: { node_ids: ['quality'] } } : {}) } });

  it.each([
    ["Let's go for 65%", 0.65, 'Fractional engineering coach', 'Mentoring coverage'],
    ['Set it to 35%.', 0.35, 'Founder coaching circle', 'Customer discovery coverage'],
    ['80%', 0.8, 'Rotating technical steward', 'Architecture support'],
  ])('applies %s to the asked option, retaining other reasoning', async (message, value, option, factor) => {
    savedGraph = fixture(option, factor); armQuestion();
    const before = structuredClone(savedGraph);
    const response = await send(message);
    expect(response.statusCode, response.body).toBe(200);
    expect(executor).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(writes.filter(w => w.graph)).toHaveLength(1);
    const parsed = GraphV3.parse(savedGraph);
    expect(parsed.nodes.find(n => n.id === 'coach')?.interventions?.coverage).toMatchObject({ value });
    for (const id of ['coverage', 'pair', 'goal', 'quality']) {
      expect(savedGraph.nodes.find(n => n.id === id)).toEqual(before.nodes.find(n => n.id === id));
    }
    expect(savedGraph.edges).toEqual(before.edges);
    expect(pendings.some(p => p.chip_id === 'coverage-question')).toBe(false);
    expect(response.json().assistant_text).toContain(option);
  });

  it('positive control: 65% also applies when nothing is selected', async () => {
    await send("Let's go for 65%", false);
    expect(provider).not.toHaveBeenCalled();
    expect(writes.filter(w => w.graph)).toHaveLength(1);
    expect(GraphV3.parse(savedGraph).nodes.find(n => n.id === 'coach')?.interventions?.coverage).toMatchObject({ value: 0.65 });
  });

  it('65 without a unit asks about the same pair and keeps the question', async () => {
    const before = structuredClone(savedGraph);
    const response = await send('65');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().assistant_text).toContain('Fractional engineering coach');
    expect(response.json().assistant_text).toContain('Mentoring coverage');
    expect(savedGraph).toEqual(before);
    expect(writes.filter(w => w.graph)).toHaveLength(0);
    expect(pendings.some(p => p.chip_id === 'coverage-question')).toBe(true);
    expect(executor).not.toHaveBeenCalled();
  });

  it('a selected-object instruction is not applied to the outstanding question', async () => {
    const before = structuredClone(savedGraph);
    await send('Set this one to 35%');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(writes.filter(w => w.graph)).toHaveLength(0);
    expect(savedGraph).toEqual(before);
  });

  it('a supplied range is not silently collapsed to a scalar effect', async () => {
    const before = structuredClone(savedGraph);
    await send('Somewhere between 30% and 45%');
    expect(writes.filter(w => w.graph)).toHaveLength(0);
    expect(savedGraph).toEqual(before);
  });
});
