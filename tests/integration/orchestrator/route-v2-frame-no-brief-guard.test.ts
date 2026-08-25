/**
 * Core System B route witness for open-ended strategic intake.
 *
 * This replaces the former assertion that legitimate empty-canvas
 * conversation is intercepted by the deterministic "single decision question
 * + options" rejection. Grounded strategic challenges now start the existing
 * draft producer; conversational/meta/referent-free turns reach TurnExecutor.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  dispatchDraftGraph: vi.fn(),
  runTurnExecutor: vi.fn(),
  understandOpenFrameIntake: vi.fn(),
  append: vi.fn(),
  hasPriorTurns: false,
  recentTurns: [] as Array<Record<string, unknown>>,
  pendingActions: [] as Array<Record<string, unknown>>,
  persistedGraph: null as unknown,
}));

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: mocks.dispatchDraftGraph,
}));
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: mocks.runTurnExecutor,
}));
vi.mock('../../../src/orchestrator-v5/routing/open-frame-intake.js', () => ({
  understandOpenFrameIntake: mocks.understandOpenFrameIntake,
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: mocks.append,
        hasPriorTurns: async () => mocks.hasPriorTurns,
        readRecent: async () => mocks.recentTurns as never,
        readMostRecentPendingActions: async () => mocks.pendingActions as never,
        loadGraph: async () => mocks.persistedGraph,
        loadGraphAndBriefText: async () => ({ graph: mocks.persistedGraph, briefText: null }),
      }),
    resetSessionStoreForTests: () => {},
  };
});

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test', model: 'test-model',
    chat: async () => ({ content: 'unused', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test', model: 'test-model',
      chat: async () => ({ content: 'unused', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    },
    resolution: { task: 'orchestrator', resolved_model: 'test-model', resolution_source: 'task_default' as const },
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
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const CANNED_REJECTION = 'I need a single decision question to start.';

function turnPayload(message: string, turnId: string): Record<string, unknown> {
  return {
    kind: 'message', turn_id: turnId, scenario_id: SCENARIO_ID, stage: 'frame',
    message, turn_class: 'frame', source: 'composer',
  };
}

function mockDraftResult(): void {
  mocks.dispatchDraftGraph.mockResolvedValueOnce({
    response: {
      response_version: 2,
      assistant_text: 'I have started a provisional Living Model from your challenge.',
      blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse',
    },
    commitPerformed: true,
    graph: null,
  });
}

function mockConversationResult(
  assistantText = 'I understood your question and will answer it in the current context.',
): void {
  mocks.runTurnExecutor.mockResolvedValueOnce({
    response: {
      response_version: 2, assistant_text: assistantText, blocks: [],
      suggested_actions: [], insights: [], stage_indicator: 'frame',
    },
    analysisReady: undefined,
    effectiveGraph: null,
    answerKind: 'substantive',
    mayNameLeadingOption: true,
    mayNameLeadingOptionProvenance: { kind: 'no_analysis' },
    telemetry: {
      stages_completed: ['orient', 'compose', 'commit'],
      response_emitted: true,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'converse',
      coaching_mode: null,
      validation_error_code: null,
    },
  });
}

function modelRoute(route: 'start_model' | 'continue_conversation') {
  return {
    route, source: 'model' as const, model: 'test-frontier-model', latencyMs: 9,
    inputTokens: 20, outputTokens: 2,
  };
}

describe('POST /orchestrate/v2/turn — semantic open-frame intake', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    mocks.dispatchDraftGraph.mockReset();
    mocks.runTurnExecutor.mockReset();
    mocks.understandOpenFrameIntake.mockReset();
    mocks.append.mockReset();
    mocks.append.mockResolvedValue({ id: 'mock-row-id' });
    mocks.hasPriorTurns = false;
    mocks.recentTurns = [];
    mocks.pendingActions = [];
    mocks.persistedGraph = null;
  });

  const SEMANTIC_START_PROMPTS = [
    'How can I accelerate securing pre-seed investment for my startup?',
    'Why are enterprise customers not converting?',
    'Help me pressure-test our go-to-market strategy.',
    'How can we increase enterprise conversion?',
    'How should we change our go-to-market strategy?',
    'Help me add resilience to our supply chain strategy.',
  ] as const;

  for (const [index, message] of SEMANTIC_START_PROMPTS.entries()) {
    it(`starts the existing draft producer for broad strategic input ${index + 1}`, async () => {
      mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('start_model'));
      mockDraftResult();
      const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
        message, `55555555-5555-4555-8555-55555500${String(index + 1).padStart(4, '0')}`,
      ) });

      expect(res.statusCode).toBe(200);
      expect(mocks.understandOpenFrameIntake).toHaveBeenCalledWith(
        expect.objectContaining({ currentMessage: message }),
      );
      expect(mocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
      const dispatch = mocks.dispatchDraftGraph.mock.calls[0]![0] as {
        payload: { message: string }; briefOverride?: string;
      };
      expect(dispatch.payload.message).toBe(message);
      if (dispatch.briefOverride !== undefined) expect(dispatch.briefOverride).toBe(message);
      expect(mocks.runTurnExecutor).not.toHaveBeenCalled();
      expect(JSON.parse(res.body).assistant_text).not.toContain(CANNED_REJECTION);
    });
  }

  it('starts from a structurally empty canvas without appending decision-only clarify questions', async () => {
    const message = 'How can I accelerate securing pre-seed investment for my startup?';
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('start_model'));
    mocks.dispatchDraftGraph.mockResolvedValueOnce({
      response: {
        response_version: 2,
        assistant_text: 'I have started a provisional Living Model from your challenge.',
        blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse',
      },
      commitPerformed: true,
      graph: { nodes: [{ id: 'goal-1', kind: 'goal', label: 'Secure pre-seed investment' }], edges: [] },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        ...turnPayload(message, '55555555-5555-4555-8555-555555000030'),
        graph_state: { nodes: [], edges: [] },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    expect(
      (mocks.dispatchDraftGraph.mock.calls[0]![0] as { payload: { message: string } }).payload
        .message,
    ).toBe(message);
    const body = JSON.parse(res.body) as { assistant_text: string };
    expect(body.assistant_text).toBe(
      'I have started a provisional Living Model from your challenge.',
    );
    expect(body.assistant_text).not.toContain("I've assumed");
    expect(body.assistant_text).not.toMatch(/alternatives|timeframe/i);
  });

  it('keeps a broad explicit decision on the established draft fast path', async () => {
    const message = 'Should we expand into the US this year?';
    mockDraftResult();
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000004',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(mocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    expect((mocks.dispatchDraftGraph.mock.calls[0]![0] as { payload: { message: string } }).payload.message).toBe(message);
  });

  it('routes a genuinely referent-free challenge question to grounded conversation', async () => {
    const message = 'What are we not thinking about?';
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('continue_conversation'));
    mockConversationResult('What topic or strategic challenge would you like me to examine?');
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000005',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body).assistant_text).not.toContain(CANNED_REJECTION);
  });

  it('routes a greeting to ordinary conversation without drafting or canned rejection', async () => {
    const message = 'Hello, Olumi.';
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('continue_conversation'));
    mockConversationResult('Hello — what strategic challenge would you like to work through?');

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000032',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).toHaveBeenCalledWith(
      expect.objectContaining({ currentMessage: message }),
    );
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text).not.toContain(CANNED_REJECTION);
  });

  it('routes genuinely ambiguous input to ordinary conversation without inventing a model', async () => {
    const message = 'Can you help me with this?';
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('continue_conversation'));
    mockConversationResult('What strategic issue does “this” refer to?');

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000033',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).toHaveBeenCalledWith(
      expect.objectContaining({ currentMessage: message }),
    );
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text).not.toContain(CANNED_REJECTION);
  });

  it('starts from a grounded no-model follow-up and dispatches only the exact current ingress', async () => {
    const message = 'Why are enterprise customers still not converting?';
    mocks.hasPriorTurns = true;
    mocks.recentTurns = [{
      id: '99999999-9999-4999-8999-999999999990', scenario_id: SCENARIO_ID,
      user_id: null, turn_id: '99999999-9999-4999-8999-999999999991',
      turn_class: 'explore', handler_id: null, request_hash: 'sha256:prior-context',
      response_emitted: true, llm_calls_used: 1, duration_ms: 4,
      created_at: '2026-08-25T20:00:00.000Z',
      user_message: 'I want to improve our enterprise sales motion.',
      assistant_message:
        'Tell me where the sales process is breaking down, including any procurement friction.',
    }];
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('start_model'));
    mockDraftResult();

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000034',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).toHaveBeenCalledWith(expect.objectContaining({
      currentMessage: message,
      recentTurns: expect.arrayContaining([
        expect.objectContaining({ user_message: 'I want to improve our enterprise sales motion.' }),
      ]),
    }));
    expect(mocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    const dispatch = mocks.dispatchDraftGraph.mock.calls[0]![0] as {
      payload: { message: string };
      briefOverride?: string;
    };
    expect(dispatch.payload.message).toBe(message);
    expect(dispatch.briefOverride).toBeUndefined();
    expect(mocks.runTurnExecutor).not.toHaveBeenCalled();
  });

  it('recognises an explicit options problem without paying the advisory call', async () => {
    const message = 'Should we hire a technical co-founder or two senior engineers?';
    mockDraftResult();
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000006',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(mocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    expect((mocks.dispatchDraftGraph.mock.calls[0]![0] as { payload: { message: string } }).payload.message).toBe(message);
  });

  it('answers a meta follow-up after a legacy draft-offer turn instead of re-firing the rejection', async () => {
    const message = "What's wrong with what I entered?";
    mocks.hasPriorTurns = true;
    mocks.recentTurns = [{
      id: '66666666-6666-4666-8666-666666666666', scenario_id: SCENARIO_ID,
      user_id: null, turn_id: '66666666-6666-4666-8666-666666666667',
      turn_class: 'clarify', handler_id: null, request_hash: 'sha256:prior',
      response_emitted: true, llm_calls_used: 0, duration_ms: 3,
      created_at: '2026-08-25T20:00:00.000Z',
      user_message: 'How can I accelerate securing pre-seed investment for my startup?',
      assistant_message: `${CANNED_REJECTION} Include the options you're comparing.`,
    }];
    mocks.pendingActions = [{
      id: '77777777-7777-4777-8777-777777777777', scenario_id: SCENARIO_ID,
      chip_id: 'draft-offer-legacy',
      action: {
        kind: 'draft_graph',
        brief_seed: 'How can I accelerate securing pre-seed investment for my startup?',
        public_label: 'Build the model',
        public_message: 'Yes, build the model from what I have shared.',
      },
      preconditions: {}, expires_at_turn_count: 3,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: '2026-08-25T20:00:00.000Z',
    }];
    mocks.understandOpenFrameIntake.mockResolvedValueOnce(modelRoute('continue_conversation'));
    mockConversationResult('Nothing was wrong with your challenge. It was useful enough to begin.');
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000007',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).toHaveBeenCalledWith(expect.objectContaining({
      currentMessage: message,
      recentTurns: expect.arrayContaining([
        expect.objectContaining({ assistant_message: expect.stringContaining(CANNED_REJECTION) }),
      ]),
    }));
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text).toContain('Nothing was wrong');
  });

  it('does not let a draft-offer marker override a non-null canonical graph', async () => {
    const message = 'Why are enterprise customers not converting?';
    mocks.hasPriorTurns = true;
    mocks.persistedGraph = {
      nodes: [{ id: 'opt-existing', kind: 'option', label: 'Existing strategy' }],
      edges: [],
    };
    mocks.pendingActions = [{
      id: '88888888-8888-4888-8888-888888888888', scenario_id: SCENARIO_ID,
      chip_id: 'draft-offer-stale-context',
      action: {
        kind: 'draft_graph',
        brief_seed: 'Should we pursue the existing strategy?',
        public_label: 'Build the model',
        public_message: 'Yes, build the model from what I have shared.',
      },
      preconditions: {}, expires_at_turn_count: 3,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: '2026-08-25T20:00:00.000Z',
    }];
    mockConversationResult('I will reason from the current persisted model.');

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      message, '55555555-5555-4555-8555-555555000031',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body).assistant_text).toContain('current persisted model');
  });

  it.each([
    ['malformed advisory output', 'invalid_output'],
    ['advisory provider failure', 'call_failed'],
  ])('fails %s to ordinary conversation, never canned rejection', async (_name, fallbackReason) => {
    mocks.understandOpenFrameIntake.mockResolvedValueOnce({
      route: 'continue_conversation', source: 'fallback', fallbackReason,
    });
    mockConversationResult();
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: turnPayload(
      'How can I make our strategic planning work better?',
      fallbackReason === 'invalid_output'
        ? '55555555-5555-4555-8555-555555000010'
        : '55555555-5555-4555-8555-555555000011',
    ) });

    expect(res.statusCode).toBe(200);
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text).not.toContain(CANNED_REJECTION);
  });

  it('does not run semantic intake outside the empty frame-stage seam', async () => {
    mockConversationResult();
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      ...turnPayload('Help me think through our current strategic model.', '55555555-5555-4555-8555-555555000020'),
      stage: 'decide', turn_class: 'decide',
    } });

    expect(res.statusCode).toBe(200);
    expect(mocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(mocks.runTurnExecutor).toHaveBeenCalledTimes(1);
  });
});
