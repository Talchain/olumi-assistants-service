/**
 * Task 3 — route-level tests for V5 edit_graph pre-Sonnet dispatch.
 *
 * Validates the route-v2 branch that delegates natural-language graph
 * edits (message-kind + graph_state + edit-intent keywords) to
 * dispatchEditGraph. Focus is on the trigger heuristic:
 *   - positive regex matches must dispatch.
 *   - negative regex matches must NOT dispatch even if edit verbs also
 *     appear (mutating the graph on a meta-question is the worst failure
 *     mode, so we err toward not dispatching).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
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
              if (featProp === 'orchestratorV5') return true;
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
    { id: 'opt-1', kind: 'option', label: 'Option A' },
    { id: 'fac-1', kind: 'factor', label: 'Cost' },
  ],
  edges: [{ from: 'fac-1', to: 'opt-1' }],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit — graph now has 2 nodes and 1 edges.',
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

describe('POST /orchestrate/v2/turn — edit_graph dispatch', () => {
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
  });

  it('positive edit keyword + graph_state + analyse stage → dispatches', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Reduce the weight of the cost factor' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Applied edit');
  });

  it('decide stage with edit keyword → dispatches', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        stage: 'decide',
        turn_class: 'decide',
        message: 'Add a constraint on time-to-launch',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE guard: "explain" + edit verb → NOT dispatched', async () => {
    // "explain how to remove the cost factor" contains `remove` (edit verb)
    // AND `explain` (non-edit phrasing). Non-edit wins — this is a
    // meta-question, not an edit command.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Explain how to remove the cost factor please',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // Fallthrough to TurnExecutor; may 200 or 500 in test env.
    expect([200, 500]).toContain(res.statusCode);
  });

  it('NEGATIVE guard: "what would" + edit verb → NOT dispatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'What would it change if I reduce cost by 20%?',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('no graph_state → NOT dispatched (nothing to edit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111aa05',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Change the cost factor',
        turn_class: 'propose',
        source: 'composer',
      },
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=frame with graph_state + edit verb → DISPATCHES (stage gate removed)', async () => {
    // The stage check was removed: presence of a graph is the load-bearing
    // precondition. Frame-stage edits are now dispatched if all other gates
    // pass (graph_state present, edit verb, no negative phrasing).
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        stage: 'frame',
        turn_class: 'frame',
        message: 'Change the factor weight',
      }),
    });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect([200, 500]).toContain(res.statusCode);
  });

  it('message without edit keyword → NOT dispatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Tell me about this graph structure',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('edit dispatch commit failure → 500 BoundaryError', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce({
      response: makeEditGraphMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Reduce cost factor' }),
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('edit_graph_commit_failed');
  });

  it('edit dispatcher throws → 500 BoundaryError', async () => {
    dispatchEditGraphMock.mockRejectedValueOnce(new Error('pipeline blew up'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Increase factor weight' }),
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('edit_graph_pipeline_threw');
  });

  // ------------------------------------------------------------------
  // Regression: phrasings that might trip edit_graph trigger
  // ------------------------------------------------------------------
  // Positive guard: EDIT_INTENT_REGEX (verbs like change/reduce/add).
  // Negative guard: NON_EDIT_INTENT_REGEX (explain/what would/why) — if
  // it matches, dispatch is SUPPRESSED even when an edit verb is
  // present. Mutating the graph on a meta-question is the worst failure
  // mode, so we err toward NOT dispatching. These regression cases
  // document the exact boundaries.
  describe('regression phrasings — current trigger behaviour', () => {
    const cases = [
      {
        label: 'positive: "raise" (synonym of increase)',
        message: 'Raise the strength of the market risk edge',
        expectDispatch: true,
      },
      {
        label: 'positive: "lower" (synonym of decrease)',
        message: 'Lower the cost factor by a notch',
        expectDispatch: true,
      },
      {
        label: 'positive: "tweak"',
        message: 'Tweak the probability on the regulatory edge slightly',
        expectDispatch: true,
      },
      {
        label: 'suppressed: "explain why" + edit verb',
        message: 'Explain why I should reduce the cost factor before acting',
        expectDispatch: false,
      },
      {
        label: 'suppressed: "tell me how" + edit verb',
        message: 'Tell me how to add a constraint on schedule',
        expectDispatch: false,
      },
      {
        label: 'suppressed: "compare options" alone',
        message: 'Compare options A and B for me',
        expectDispatch: false,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: passive mutation request',
        message: 'Regulatory factor should be weighted less heavily overall',
        expectDispatch: false,
      },
      // ──────────────────────────────────────────────────────────────
      // Frame-stage false-positive guard cases — added when the stage
      // gate was removed from isEditGraphShape. Without these, frame-
      // stage conversational/figurative use of edit verbs would falsely
      // dispatch and mutate the graph.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'suppressed: figurative "add" — "add some context"',
        message: 'Let me add some context about our constraints',
        expectDispatch: false,
      },
      {
        label: 'suppressed: phrasal "set up"',
        message: "I'd like to set up the decision properly first",
        expectDispatch: false,
      },
      {
        label: 'suppressed: figurative "remove doubt"',
        message: 'Let me remove any doubt about the timeline',
        expectDispatch: false,
      },
      {
        label: 'suppressed: phrasal "set aside"',
        message: 'Set aside the cost factor for now',
        expectDispatch: false,
      },
      {
        label: 'suppressed: meta "reduce complexity"',
        message: 'Reduce complexity by focusing on the main issue',
        expectDispatch: false,
      },
      {
        label: 'suppressed: idiomatic "change my mind"',
        message: "Change my mind — let's think about this differently",
        expectDispatch: false,
      },
      {
        label: 'suppressed: meta "update our approach"',
        message: 'Update our approach to include risk',
        expectDispatch: false,
      },
      {
        label: 'suppressed: UI command "delete this thread"',
        message: 'Delete this thread and start fresh',
        expectDispatch: false,
      },
      // Sanity: legitimate edits still dispatch despite expanded negative regex.
      {
        label: 'positive: "Add an option for contract hiring"',
        message: 'Add an option for contract hiring',
        expectDispatch: true,
      },
      {
        label: 'positive: "Increase the budget to 300k"',
        message: 'Increase the budget to 300k',
        expectDispatch: true,
      },
    ];

    let turnIdSuffix = 0;
    for (const c of cases) {
      it(`${c.label}`, async () => {
        if (c.expectDispatch) {
          dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
        }
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: payload({
            turn_id: `11111111-1111-4111-8111-11111eee11${String(turnIdSuffix++).padStart(2, '0')}`,
            message: c.message,
          }),
        });
        if (c.expectDispatch) {
          expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
        } else {
          expect(dispatchEditGraphMock).not.toHaveBeenCalled();
        }
        expect([200, 500]).toContain(res.statusCode);
      });
    }
  });
});
