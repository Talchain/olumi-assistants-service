/**
 * ⭐ ROADMAP 2.1266 / ACCEPTANCE 4 — route-level pin: an option-effect request
 * whose ENTITY is ambiguous is ANSWERED WITH A QUESTION and never dispatched.
 *
 * The write half of 2.1266 binds inside `dispatchEditGraph`. This is the other
 * half, and it has to sit HERE rather than in the dispatcher: once the edit
 * lane has run, the 2.427 recovery copy resolves an option by first-match and
 * speaks about it BY NAME — i.e. the guess is only avoidable before dispatch.
 *
 * Harness mirrors `route-v2-configure-option.test.ts`: `dispatchEditGraph` and
 * `runTurnExecutor` are mocked, so every assertion is purely about WHICH lane
 * the route chose and what it said.
 *
 * ⚠ THIS FILE IMPORTS NO 2.1266 MODULE. That is deliberate: it is
 * pristine-runnable, so the RED it produces at `293da078` is a statement about
 * the PRODUCT's behaviour (the ambiguous sentence is dispatched, and the reply
 * comes from the edit lane) rather than about a missing import.
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
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
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

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';

const OPTION_A = 'Open the Leeds depot next quarter';
const OPTION_B = 'Expand the Manchester depot instead';
const FACTOR = 'Capital expenditure';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 1, std: 0.01 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

/**
 * A STRICT-PARSEABLE graph: two options, both wired to the same factor, both
 * unconfigured. Strictness matters — the resolver declines on a graph that
 * does not strict-parse, so a sloppy fixture would make this suite green for
 * the wrong reason.
 */
const GRAPH_STATE = {
  nodes: [
    { id: 'dec_depot', kind: 'decision', label: 'Depot capacity' },
    { id: 'opt_leeds', kind: 'option', label: OPTION_A, interventions: {} },
    { id: 'opt_manchester', kind: 'option', label: OPTION_B, interventions: {} },
    {
      id: 'fac_capex',
      kind: 'factor',
      label: FACTOR,
      observed_state: { value: 0.5, source: 'cee_inference', extractionType: 'inferred' },
    },
    { id: 'goal_margin', kind: 'goal', label: 'Margin preservation' },
  ],
  edges: [
    edge('dec_depot', 'opt_leeds'),
    edge('dec_depot', 'opt_manchester'),
    edge('opt_leeds', 'fac_capex'),
    edge('opt_manchester', 'fac_capex'),
    edge('fac_capex', 'goal_margin'),
  ],
};

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

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '22222222-2222-4222-8222-22222222bb00',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
  };
}

describe('POST /orchestrate/v2/turn — an ambiguous option-effect request asks', () => {
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
    dispatchEditGraphMock.mockResolvedValue(makeEditGraphMockResult());
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
    appendMock.mockClear();
  });

  it('names both options, writes nothing, and never dispatches the edit lane', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        `Set the ${OPTION_A} option's effect and the ${OPTION_B} option's effect on ${FACTOR} to 0.4.`,
      ),
    });

    expect(res.statusCode).toBe(200);
    // The guess is only avoidable before dispatch — so the dispatch must not
    // happen at all.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).not.toHaveBeenCalled();

    const body = res.json() as {
      assistant_text: string;
      suggested_actions: Array<{ label: string; message?: string }>;
    };
    expect(body.assistant_text).toContain(OPTION_A);
    expect(body.assistant_text).toContain(OPTION_B);
    expect(body.assistant_text).toContain('not changed the model');
    // P8: a direct answer is one click away, in the phrasing the product
    // itself advises.
    expect(body.suggested_actions.length).toBeGreaterThan(0);
    for (const action of body.suggested_actions) {
      expect(action.message).toContain("option's effect on");
      expect(action.message).toContain('0.4');
    }
  });

  it('OPPOSITE-DIRECTION TWIN — an UNAMBIGUOUS request is dispatched, not asked', async () => {
    // Without this twin the assertions above would pass on a route that
    // answered every option-effect turn with a question.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Set the ${OPTION_A} option's effect on ${FACTOR} to 0.4.`),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect((res.json() as { assistant_text: string }).assistant_text).toBe('edit lane engaged');
  });

  it('OPPOSITE-DIRECTION TWIN — an ordinary edit is dispatched, not asked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload('Add a factor for driver retention.'),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });
});
