/**
 * ROADMAP 2.388 + Core System B — empty-model edit-word intake.
 *
 * The original defect was an edit-word first turn returning a graph-unavailable
 * error. The first repair fell through to a deterministic "single decision +
 * options" prompt. Open-frame semantic intake now completes that repair:
 * grounded strategic goals start the existing draft producer, while a genuinely
 * referent-free edit request reaches ordinary conversation for clarification.
 *
 * This remains a hand-written corpus from the measured failure. It also keeps
 * the two operational carve-outs exact: a session-store failure and an invalid
 * persisted graph still return typed recovery once the semantic router chooses
 * conversation and the established edit lane performs its canonical read.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';

const runtimeMocks = vi.hoisted(() => ({
  understandOpenFrameIntake: vi.fn(),
  dispatchDraftGraph: vi.fn(),
  dispatchEditGraph: vi.fn(),
  runTurnExecutor: vi.fn(),
}));

vi.mock('../../orchestrator-v5/routing/open-frame-intake.js', () => ({
  understandOpenFrameIntake: runtimeMocks.understandOpenFrameIntake,
}));
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: runtimeMocks.dispatchDraftGraph,
}));
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: runtimeMocks.dispatchEditGraph,
}));
vi.mock('../../orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runtimeMocks.runTurnExecutor,
}));

// ── Session store: the ONE fact under test is what `loadGraph` does ────────
/** `null` ⇒ no persisted graph (the defect's precondition). */
let persistedGraphForRead: unknown = null;
/** `true` ⇒ `loadGraph` throws ⇒ `session_store_failed`. */
let loadGraphThrows = false;
let loadGraphCalls = 0;
let hasPriorTurnsForRead = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => {
      loadGraphCalls += 1;
      if (loadGraphThrows) throw new Error('simulated session store failure');
      return persistedGraphForRead;
    },
    loadGraphAndBriefText: async () => ({
      graph: loadGraphThrows ? null : persistedGraphForRead,
      briefText: null,
    }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => hasPriorTurnsForRead,
    countTurns: async () => 0,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

/** Any model call outside the explicitly mocked semantic/dispatch seams fails. */
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('unexpected unmocked LLM call');
});
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// The production constants themselves — this file and the guard cannot drift
// apart on the chip copy or the recovery copy (CLAUDE.md trap 12).
const {
  ceeOrchestratorRouteV2,
  EDIT_GRAPH_RECOVERY_TEXT,
} = await import('../route-v2.js');

const SCENARIO_ID = '23880000-2388-4388-8388-238823882388';

const FRAME_GUARD_COPY = 'I need a single decision question to start';

function modelRoute(route: 'start_model' | 'continue_conversation') {
  runtimeMocks.understandOpenFrameIntake.mockResolvedValueOnce({
    route,
    source: 'model' as const,
    model: 'test-frontier-model',
    latencyMs: 7,
    inputTokens: 18,
    outputTokens: 2,
  });
}

function mockDraftResult(): void {
  runtimeMocks.dispatchDraftGraph.mockResolvedValueOnce({
    response: {
      response_version: 2,
      assistant_text: 'I have started a provisional Living Model from your strategic goal.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    },
    commitPerformed: true,
    graph: null,
  });
}

function mockConversationResult(): void {
  runtimeMocks.runTurnExecutor.mockResolvedValueOnce({
    response: {
      response_version: 2,
      assistant_text: 'What does “it” refer to, and what outcome are you trying to improve?',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame',
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

function mockEditResult(): void {
  runtimeMocks.dispatchEditGraph.mockResolvedValueOnce({
    response: {
      response_version: 2,
      assistant_text: 'Applied the requested change to the existing model.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    },
    commitPerformed: true,
  });
}

/**
 * ⭐ L56'S MEASURED DEAD ENDS, VERBATIM. Each of these returned
 * `exit_path: edit_graph` + `EDIT_GRAPH_RECOVERY_TEXT` + zero chips on the
 * deployed build, as a FIRST message on a fresh scenario. Tags are L56's.
 *
 * Nine messages contain enough strategic subject to start a provisional model.
 * X2 is genuinely referent-free: "it" cannot be resolved on a fresh scenario,
 * so it should be answered with a material clarification rather than drafted.
 */
const MEASURED_DEAD_ENDS: ReadonlyArray<
  readonly [tag: string, message: string, expectedRoute: 'start_model' | 'continue_conversation']
> = [
  ['S1', 'Increase annual revenue from £4 million today to £6 million within 12 months.', 'start_model'],
  ['S2', 'We need to reduce churn to under 5% this year.', 'start_model'],
  ['S5', 'Add a second sales team in Berlin.', 'start_model'],
  ['S7', 'Raise the price from £49 to £59.', 'start_model'],
  [
    'X1',
    'Increase annual recurring revenue from £4 million today to £6 million within twelve months, while keeping the marketing budget flat and the engineering headcount exactly where it is right now.',
    'start_model',
  ],
  ['X2', 'Launch it and add a fee.', 'continue_conversation'],
  [
    'X7',
    'Our board wants us to increase annual recurring revenue to £6 million next year while reducing support costs by a fifth. Nothing else has been agreed yet.',
    'start_model',
  ],
  ['X9', 'Increase revenue to £6 million? That is the plan for the year ahead.', 'start_model'],
  [
    'Z3',
    'After weighing our options, we will increase annual revenue from £4 million to £6 million within 12 months.',
    'start_model',
  ],
  ['Z4', 'We could increase the price from £49 to £59 to improve margins.', 'start_model'],
];

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
let priorTraceFlag: string | undefined;

function post(app: FastifyInstance, message: string, stage: 'frame' | 'analyse' = 'frame') {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: '23881111-2388-4388-8388-238823881111',
      scenario_id: SCENARIO_ID,
      stage,
      turn_class: stage === 'frame' ? 'frame' : 'propose',
      message,
      source: 'composer',
    },
  });
}

async function turn(app: FastifyInstance, message: string, stage: 'frame' | 'analyse' = 'frame') {
  const res = await post(app, message, stage);
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function exitPath(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

describe('ROADMAP 2.388 / System B — semantic routing after a strict canonical read', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    _resetConfigCache();
    setTestSink(null);
  });

  beforeEach(() => {
    persistedGraphForRead = null;
    loadGraphThrows = false;
    loadGraphCalls = 0;
    hasPriorTurnsForRead = false;
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, unknown> });
    });
    runtimeMocks.understandOpenFrameIntake.mockReset();
    runtimeMocks.dispatchDraftGraph.mockReset();
    runtimeMocks.dispatchEditGraph.mockReset();
    runtimeMocks.runTurnExecutor.mockReset();
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  it('null canonical graph + grounded edit-word goal starts the existing draft with exact user text', async () => {
    const message = 'Increase annual revenue from £4 million today to £6 million within 12 months.';
    modelRoute('start_model');
    mockDraftResult();
    const { status, body } = await turn(
      app,
      message,
    );

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('draft_graph');
    expect(runtimeMocks.understandOpenFrameIntake).toHaveBeenCalledWith(
      expect.objectContaining({ currentMessage: message }),
    );
    expect(runtimeMocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    const dispatch = runtimeMocks.dispatchDraftGraph.mock.calls[0]![0] as {
      payload: { message: string };
      briefOverride?: string;
    };
    expect(dispatch.payload.message).toBe(message);
    if (dispatch.briefOverride !== undefined) expect(dispatch.briefOverride).toBe(message);
    expect(runtimeMocks.dispatchEditGraph).not.toHaveBeenCalled();
    expect(runtimeMocks.runTurnExecutor).not.toHaveBeenCalled();
    expect(loadGraphCalls).toBe(1);
    expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);
    expect(body.assistant_text).not.toContain(EDIT_GRAPH_RECOVERY_TEXT);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it.each(MEASURED_DEAD_ENDS)(
    '%s follows the semantic route without canned or graph-unavailable rejection',
    async (_tag, message, expectedRoute) => {
      modelRoute(expectedRoute);
      if (expectedRoute === 'start_model') mockDraftResult();
      else mockConversationResult();
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      expect(runtimeMocks.understandOpenFrameIntake).toHaveBeenCalledWith(
        expect.objectContaining({ currentMessage: message }),
      );
      expect(loadGraphCalls).toBe(1);
      expect(body.assistant_text).not.toContain(EDIT_GRAPH_RECOVERY_TEXT);
      expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);

      if (expectedRoute === 'start_model') {
        expect(exitPath(body)).toBe('draft_graph');
        expect(runtimeMocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
        expect(
          (runtimeMocks.dispatchDraftGraph.mock.calls[0]![0] as { payload: { message: string } })
            .payload.message,
        ).toBe(message);
        expect(runtimeMocks.runTurnExecutor).not.toHaveBeenCalled();
      } else {
        expect(exitPath(body)).toBe('turn_executor');
        expect(runtimeMocks.runTurnExecutor).toHaveBeenCalledTimes(1);
        expect(runtimeMocks.dispatchDraftGraph).not.toHaveBeenCalled();
      }
      expect(runtimeMocks.dispatchEditGraph).not.toHaveBeenCalled();
      expect(chatWithToolsMock).not.toHaveBeenCalled();
    },
  );

  it('null canonical graph + referent-free edit converses after one memoised route-level strict read', async () => {
    const message = 'Launch it and add a fee.';
    modelRoute('continue_conversation');
    mockConversationResult();

    const { status, body } = await turn(app, message);

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('turn_executor');
    expect(runtimeMocks.understandOpenFrameIntake).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.runTurnExecutor).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(runtimeMocks.dispatchEditGraph).not.toHaveBeenCalled();
    expect(loadGraphCalls).toBe(1);
    expect(
      events.filter((e) => e.name === TelemetryEvents.V5EditGraphNoPersistedGraphFallthrough),
    ).toHaveLength(1);
    expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);
    expect(body.assistant_text).not.toContain(EDIT_GRAPH_RECOVERY_TEXT);
  });

  it('continuation with no canonical model shares one route-level strict read across unstrand and intake', async () => {
    const message = 'How can we increase enterprise conversion?';
    hasPriorTurnsForRead = true;
    modelRoute('start_model');
    mockDraftResult();

    const { status, body } = await turn(app, message);

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('draft_graph');
    expect(runtimeMocks.understandOpenFrameIntake).toHaveBeenCalledWith(
      expect.objectContaining({ currentMessage: message }),
    );
    expect(runtimeMocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    expect(loadGraphCalls).toBe(1);
  });

  it('null canonical graph is never reported as unavailable', async () => {
    modelRoute('continue_conversation');
    mockConversationResult();
    await turn(app, 'Launch it and add a fee.');
    const unavailable = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
        e.data.reason === 'no_persisted_graph',
    );
    expect(
      unavailable,
      'a genuine empty model is not an infrastructure failure',
    ).toHaveLength(0);
  });

  it('SCOPE: at ANALYSE stage the typed recovery is UNCHANGED — the frame guard cannot catch it there', async () => {
    const { status, body } = await turn(
      app,
      'Add opportunity cost of founder time as a risk',
      'analyse',
    );

    expect(status).toBe(200);
    expect(body.assistant_text).toBe(EDIT_GRAPH_RECOVERY_TEXT);
    expect(exitPath(body)).toBe('edit_graph');
    expect(runtimeMocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(loadGraphCalls).toBe(1);
    expect(
      events.filter(
        (e) =>
          e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
          e.data.reason === 'no_persisted_graph',
      ),
      'the reason still exists — it is reachable off the frame stage, and only there',
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.name === TelemetryEvents.V5EditGraphNoPersistedGraphFallthrough),
    ).toHaveLength(0);
  });

  it('valid persisted graph bypasses advisory intake and reaches the canonical edit lane after one route-level strict read', async () => {
    const persistedGraph = {
      nodes: [{ id: 'opt-a', kind: 'option', label: 'Current approach' }],
      edges: [],
    };
    persistedGraphForRead = persistedGraph;
    mockEditResult();

    const { status, body } = await turn(app, 'Add a second sales team in Berlin.');

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('edit_graph');
    expect(runtimeMocks.understandOpenFrameIntake).not.toHaveBeenCalled();
    expect(runtimeMocks.dispatchDraftGraph).not.toHaveBeenCalled();
    expect(runtimeMocks.dispatchEditGraph).toHaveBeenCalledWith(
      expect.objectContaining({ graphState: persistedGraph }),
    );
    expect(loadGraphCalls).toBe(1);
    expect(body.assistant_text).toContain('Applied the requested change');
  });

  describe('PRESERVATION — the transient failures still say "try again in a moment"', () => {
    it('`session_store_failed`: the store throwing still returns the recovery copy at `edit_graph`', async () => {
      loadGraphThrows = true;
      const { status, body } = await turn(app, 'Add a second sales team in Berlin.');

      expect(status).toBe(200);
      expect(
        body.assistant_text,
        'a store outage IS transient — "try again in a moment" is honest advice here',
      ).toBe(EDIT_GRAPH_RECOVERY_TEXT);
      expect(exitPath(body)).toBe('edit_graph');
      expect(runtimeMocks.understandOpenFrameIntake).not.toHaveBeenCalled();
      expect(runtimeMocks.dispatchDraftGraph).not.toHaveBeenCalled();
      expect(loadGraphCalls).toBe(1);
      expect(
        events.filter(
          (e) =>
            e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
            e.data.reason === 'session_store_failed',
        ),
      ).toHaveLength(1);
    });

    it('`persisted_graph_invalid`: a stored graph that fails ingress validation still returns the recovery copy', async () => {
      // Present but unparseable — a DIFFERENT operational signal from absence,
      // which is exactly why the reason exists.
      persistedGraphForRead = { nodes: 'not-an-array', edges: 42 };
      const { status, body } = await turn(app, 'Add a second sales team in Berlin.');

      expect(status).toBe(200);
      expect(body.assistant_text).toBe(EDIT_GRAPH_RECOVERY_TEXT);
      expect(exitPath(body)).toBe('edit_graph');
      expect(runtimeMocks.understandOpenFrameIntake).not.toHaveBeenCalled();
      expect(runtimeMocks.dispatchDraftGraph).not.toHaveBeenCalled();
      expect(loadGraphCalls).toBe(1);
      expect(
        events.filter(
          (e) =>
            e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
            e.data.reason === 'persisted_graph_invalid',
        ),
      ).toHaveLength(1);
    });
  });
});
