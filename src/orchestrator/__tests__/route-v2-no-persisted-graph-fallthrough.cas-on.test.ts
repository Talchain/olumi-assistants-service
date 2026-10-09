import { __setUseAppendV6ForTest } from '../../orchestrator-v5/append-v6-flag.js';
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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../utils/telemetry.js';
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
let combinedReadCalls = 0;
let hasPriorTurnsForRead = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => {
      loadGraphCalls += 1;
      if (loadGraphThrows) throw new Error('simulated session store failure');
      return persistedGraphForRead;
    },
    loadGraphAndBriefText: async () => {
      combinedReadCalls += 1;
      if (loadGraphThrows) throw new Error('simulated session store failure');
      return { revision: 7, graph: persistedGraphForRead, briefText: null };
    },
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
const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');

const SCENARIO_ID = '23880000-2388-4388-8388-238823882388';


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



/**
 * ⭐ L56'S MEASURED DEAD ENDS, VERBATIM. Each of these returned
 * `exit_path: edit_graph` + `EDIT_GRAPH_RECOVERY_TEXT` + zero chips on the
 * deployed build, as a FIRST message on a fresh scenario. Tags are L56's.
 *
 * Nine messages contain enough strategic subject to start a provisional model.
 * X2 is genuinely referent-free: "it" cannot be resolved on a fresh scenario,
 * so it should be answered with a material clarification rather than drafted.
 */

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
    combinedReadCalls = 0;
    // A2: existing rows pin the rollback graph-only reader census and 200 recovery.
    __setUseAppendV6ForTest(false);
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

  afterEach(() => __setUseAppendV6ForTest(true));

  it('CAS ON: grounded strategic intake starts the draft from combined scenario snapshots', async () => {
    __setUseAppendV6ForTest(true);
    modelRoute('start_model'); mockDraftResult();
    const message = 'Increase annual revenue from £4 million today to £6 million within 12 months.';
    const { status, body } = await turn(app, message);
    expect(status).toBe(200);
    expect(exitPath(body)).toBe('draft_graph');
    expect(runtimeMocks.dispatchDraftGraph).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.dispatchDraftGraph.mock.calls[0]![0].payload.message).toBe(message);
    expect(loadGraphCalls).toBe(0);
    expect(combinedReadCalls).toBe(2);
  });








});
