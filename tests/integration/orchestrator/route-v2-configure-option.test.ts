/**
 * ROADMAP 2.11 / P0-2 (deterministic half) — route-level pin: configure-
 * option intent dispatches to the EDIT LANE (dispatchEditGraph), never to
 * the TurnExecutor tool-use path that live-routed it to
 * `adjust_edge_strength` (diagnosis brief add-option-2.11.md §2, scenario A,
 * staging 57959b2, 2026-07-16: A5/A7 both landed on adjust_edge_strength,
 * which writes a field PLoT preflight ignores — the infinite recovery-chip
 * loop).
 *
 * Harness mirrors route-v2-edit-graph.test.ts: dispatchEditGraph and
 * runTurnExecutor are mocked, so the assertion is purely WHICH lane the
 * route chose.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const turnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: turnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

// Mirrors the diagnosis brief's scenario-A applied graph: 5 options, the
// added one ("Acquire Small German Competitor") intervention-less.
const GRAPH_STATE = {
  nodes: [
    { id: 'dec_eu', kind: 'decision', label: 'EU Expansion' },
    { id: 'opt_berlin', kind: 'option', label: 'Open Berlin Office' },
    { id: 'opt_acquire', kind: 'option', label: 'Acquire Small German Competitor' },
    { id: 'fac_setup_cost', kind: 'factor', label: 'Setup Cost' },
    { id: 'fac_hiring', kind: 'factor', label: 'Hiring Speed' },
    { id: 'goal_growth', kind: 'goal', label: 'EU Revenue Growth' },
  ],
  edges: [
    { from: 'opt_acquire', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 } },
    { from: 'opt_acquire', to: 'fac_hiring', strength: { mean: 1, std: 0.01 } },
    { from: 'fac_setup_cost', to: 'goal_growth', strength: { mean: -0.4, std: 0.1 } },
  ],
};

function makeTurnExecutorMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'turn-executor path',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    telemetry: {
      stages_completed: ['build_turn_context', 'route', 'execute', 'commit'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 12,
      turn_class: null,
      intent_class: null,
      coaching_mode: null,
      validation_error_code: null,
    },
  };
}

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'edit lane engaged',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-11111111bb00',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — configure-option intent routes to the edit lane', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
  });

  it('A7 recovery-chip message (chip_click) → dispatchEditGraph, never TurnExecutor', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Help me configure Acquire Small German Competitor.',
        source: 'chip_click',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
  });

  it('generic recovery-chip message → dispatchEditGraph', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Help me configure one of my options.',
        source: 'chip_click',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
  });

  it('A5 free-text configure phrasing → dispatchEditGraph', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message:
          'Configure the effects of the Acquire Small German Competitor option: ' +
          'it strongly increases hiring speed and setup cost.',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
  });

  it('option-intervention "set" phrasing (value-update shaped) → dispatchEditGraph, not the D1 set_factor_value path', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message:
          "Set the Acquire Small German Competitor option's Setup Cost intervention to 0.8",
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
  });

  it('CONTROL: a plain factor value edit still takes the TurnExecutor path (value-update gate preserved)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Set Setup Cost to £40,000' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: an analytical question mentioning options never dispatches the edit lane', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'What would configuring my options change about the result?' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('CONTROL: a state query with configure vocabulary never dispatches the edit lane', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'What did you just configure on my options?' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });
});
