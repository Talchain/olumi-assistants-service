/**
 * C3 conversation regression at the HTTP routing boundary.
 * Native cases come from native-20260906-0215/TRANSCRIPT.md; all other cases
 * are synthetic contrasts. Route guards are real; downstream executor and
 * edit dispatch are mocked. This proves destination and context forwarding,
 * not LLM answer quality, canonical persistence, or mounted UX.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

// V5 fallthrough mock — when route-v2 chooses TurnExecutor (e.g. because
// the value-update gate suppressed edit_graph dispatch), this mock returns
// a deterministic minimal-valid TurnExecutorRunResult so the integration
// test can assert the 200 production-target envelope without depending on
// a real LLM adapter / Sonnet routing path. Tests that need to exercise
// the real TurnExecutor flow live elsewhere; this file is for routing.
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

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Hire a Tech Lead' },
    { id: 'fac-1', kind: 'factor', label: 'Technical Leadership Capacity' },
  ],
  edges: [{ from: 'fac-1', to: 'opt-1' }],
};

/**
 * Construct a minimal-valid TurnExecutorRunResult so the route-v2 path
 * after the gate / dispatch check can complete without needing a real
 * LLM adapter. The shape mirrors `TurnExecutorRunResult` in
 * `src/orchestrator-v5/turn-executor.ts`.
 *
 * Defaults:
 *   - commit_performed: true (route-v2 does not take the 5xx fail-closed
 *     path — see route-v2.ts:887 onward).
 *   - failure_type: null.
 *   - response: a friendly text-only OlumiResponse a chat renderer can
 *     surface as-is.
 */
function makeTurnExecutorMockResult(overrides: { assistantText?: string } = {}) {
  const assistantText =
    overrides.assistantText ??
    'Could you tell me which factor that update should affect, and what value it should take?';
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
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
      assistant_text: 'Edit dispatcher reached; no provider called.',
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
    turn_id: '11111111-1111-4111-8111-11111111aa00',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'Change factor cost weight',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}


const DISCUSSIONS = [
  ['native context and thoughts', "We just checked with the team, and they've explained that within our 6 developers, one of them is relatively senior and another one is a strong midweight, and therefore they've been self-managing, with the senior acting as the team lead. I guess that's an option we didn't realise we had. It doesn't increase our productivity, so I can't decide whether it simply strengthens by adding an additional 2 developers or creates too much work for the existing team. Maybe there's an option for hiring a temporary technical lead as a mentor or coach to help us hit our launch date. What are your thoughts?"],
  ['native affirmative follow-up', "I think it's light-touch, and I think we need a technical lead that's hands-on, so they can also increase productivity."],
  ['affirmative description', 'The senior developer can increase productivity; what do you think?'],
  ['negated description', 'The senior developer cannot increase productivity; what do you think?'],
  ['question before context', 'What do you think — the senior developer can increase productivity'],
  ['single sentence contextual question', 'What do you think of adding a temporary technical lead?'],
  ['meta-question', 'Did my edit affect the ranking?'],
  ['hypothetical', 'What if we increase the team size?'],
  ['ambiguous concern', "I'm worried about the increase in coordination overhead."],
  ['supplied facts in a follow-up', 'As I said, the codebase has technical debt and the lead would also increase productivity. Any thoughts?'],
  ['native follow-up question', 'How does this additional context change your view of the temporary lead option?'],
] as const;

const EDITS = [
  'Add a temporary technical lead as an option',
  'Can you add a temporary technical lead as an option?',
  'I want to add a temporary technical lead as an option',
  'Please remove the temporary technical lead option',
  "Don't just add a factor, add an option for a temporary technical lead",
  'Change the team coordination overhead to low',
] as const;

describe('conversation context reaches the intended application path', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    dispatchEditGraphMock.mockResolvedValue(makeEditGraphMockResult());
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult({
      assistantText: 'Router reached with supplied context.',
    }));
    appendMock.mockClear();
  });

  it.each(DISCUSSIONS)('%s goes to reasoning without an edit proposal', async (_label, message) => {
    const response = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn', payload: payload({ message }),
    });
    expect(response.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock.mock.calls[0]![0].message).toBe(message);
    expect(turnExecutorMock.mock.calls[0]![2].graphState).toMatchObject(GRAPH_STATE);
    expect(response.json().assistant_text).toBe('Router reached with supplied context.');
    expect(response.json().blocks).toEqual([]);
  });

  it.each(EDITS)('keeps the clear edit %j', async (message) => {
    const response = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn', payload: payload({ message }),
    });
    expect(response.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
  });

  it('keeps a clear option-effect value change on its existing edit path', async () => {
    const message = "Set the option's effect on Technical Leadership Capacity to 0.6";
    const response = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn', payload: payload({ message }),
    });
    expect(response.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
    expect(dispatchEditGraphMock.mock.calls[0]![0].payload.message).toBe(message);
  });
});
