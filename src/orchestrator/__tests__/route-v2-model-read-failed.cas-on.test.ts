import { createHash } from 'node:crypto';
import { MODEL_READ_FAILED_MESSAGE, REVISION_CONFLICT_MESSAGE } from '../../orchestrator-v5/graph-revision-conflict.js';
import { GraphStaleWriteError } from '../../orchestrator-v5/session/store.js';
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
    // Shipping path uses the combined scenario snapshot.
    __setUseAppendV6ForTest(true);
    hasPriorTurnsForRead = false;
    runtimeMocks.understandOpenFrameIntake.mockReset();
    runtimeMocks.understandOpenFrameIntake.mockResolvedValue({ route: 'continue_conversation', source: 'model', model: 'test', latencyMs: 0, inputTokens: 1, outputTokens: 1 });
    runtimeMocks.dispatchDraftGraph.mockReset();
    runtimeMocks.dispatchEditGraph.mockReset();
    runtimeMocks.runTurnExecutor.mockReset();
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  afterEach(() => __setUseAppendV6ForTest(true));

  it('read throws: actual route returns retryable 503 with exact bytes, no revision notice', async () => {
    loadGraphThrows = true;
    const { status, body } = await turn(app, 'Add a second sales team in Berlin.');
    expect(status, JSON.stringify(body)).toBe(503);
    expect(body).toMatchObject({ code: 'model_read_failed', retryable: true, details: { code: 'model_read_failed', retryable: true } });
    expect(body.message).toBe(MODEL_READ_FAILED_MESSAGE);
    expect(createHash('sha256').update(body.message).digest('hex')).toBe('a30d669fc4f7f1f616124c4b1cc88d5def88a8ccef9039214593781c68f45f63');
    expect(JSON.stringify(body)).not.toContain(REVISION_CONFLICT_MESSAGE);
    expect(loadGraphCalls).toBe(0);
    expect(combinedReadCalls).toBeGreaterThan(0);
    expect(appendMock).not.toHaveBeenCalled();
    expect(runtimeMocks.dispatchEditGraph).not.toHaveBeenCalled();
  });

  it('invalid stored ingress graph returns the same 503', async () => {
    persistedGraphForRead = { nodes: [{ id: 'price', kind: 'factor' }], edges: 'corrupt' };
    const { status, body } = await turn(app, 'Add a second sales team in Berlin.');
    expect(status, JSON.stringify(body)).toBe(503);
    expect(body.code).toBe('model_read_failed');
    expect(body.message).toBe(MODEL_READ_FAILED_MESSAGE);
    expect(JSON.stringify(body)).not.toContain(REVISION_CONFLICT_MESSAGE);
    expect(loadGraphCalls).toBe(0);
    expect(combinedReadCalls).toBeGreaterThan(0);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('contrast: real dispatcher revision mismatch keeps exact 409 revision_conflict', async () => {
    persistedGraphForRead = { nodes: [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'goal', kind: 'goal', label: 'Revenue' }],
      edges: [{ from: 'price', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] };
    runtimeMocks.dispatchEditGraph.mockRejectedValueOnce(new GraphStaleWriteError('OLRV1', { conflict_category: 'revision_conflict' }));
    const { status, body } = await turn(app, 'Add a second sales team in Berlin.');
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('revision_conflict');
    expect(body.message).toBe(REVISION_CONFLICT_MESSAGE);
    expect(runtimeMocks.dispatchEditGraph).toHaveBeenCalledOnce();
  });
});
