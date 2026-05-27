/**
 * Workstream v5-#57 — route-level tests for the V5 deterministic
 * draft_graph pre-route triggered by explicit request-body flags
 * (`generate_model` / `explicit_generate`).
 *
 * Contract under test:
 *
 *   - When `kind === 'message'` AND (`generate_model === true` OR
 *     `explicit_generate === true`) AND the scenario has no graph
 *     (or zero nodes), CEE dispatches the V5 draft_graph handler
 *     deterministically — bypassing `routeWithToolUse`.
 *   - The flag is advisory. If a non-empty graph already exists, the
 *     flag is ignored; the request falls through to the existing
 *     branches.
 *   - When the flag is absent or false, behaviour is bit-for-bit
 *     unchanged from PR #205 (the heuristic `isDraftGraphShape`
 *     branch and downstream TurnExecutor path remain authoritative).
 *   - The flag works in any stage (frame / analyse / decide / review),
 *     not only frame — the heuristic is frame-only; the explicit
 *     signal is intentionally broader.
 *   - The flag works for any non-empty message — no min-length or
 *     decision-brief regex check is applied; the user explicitly asked.
 *
 * Mocking strategy mirrors `route-v2-draft-graph.test.ts`:
 *   - `dispatchDraftGraph` is stubbed — what we lock in is the route's
 *     contract with the dispatcher, not the dispatcher's internals.
 *   - Session store, LLM adapter, prompt loader, and config are stubbed
 *     to the minimum needed to boot Fastify.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
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
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'short text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'short text-only response' }],
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
const TURN_ID_BASE = '11111111-1111-4111-8111-1111111110';

function makeTurnId(suffix: string): string {
  return TURN_ID_BASE + suffix;
}

function makeDraftGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph (explicit-generate trigger).',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

describe('POST /orchestrate/v2/turn — explicit-generate draft_graph pre-route (v5-#57)', () => {
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
    dispatchDraftGraphMock.mockReset();
    appendMock.mockClear();
  });

  // ───────────────────────────────────────────────────────────────────
  // Positive trigger tests — the new pre-route fires
  // ───────────────────────────────────────────────────────────────────

  it('generate_model: true + no graph → dispatches draft_graph (stage=frame)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('01'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',  // intentionally short — heuristic would NOT trigger
        turn_class: 'frame',
        source: 'composer',
        generate_model: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Drafted a decision graph');
  });

  it('explicit_generate: true + no graph → dispatches draft_graph (alias semantics)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('02'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'do it',
        turn_class: 'frame',
        source: 'composer',
        explicit_generate: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('generate_model: true + zero-node graph_state → dispatches (advisory: empty graph is "no graph")', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('03'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'generate',
        turn_class: 'frame',
        source: 'composer',
        generate_model: true,
        graph_state: { nodes: [], edges: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('generate_model: true + stage=analyse → dispatches (no stage constraint on explicit signal)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('04'),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'generate now',
        turn_class: 'propose',
        source: 'composer',
        generate_model: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('both flags true → dispatch fires once (idempotent — alias collapse)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('05'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
        generate_model: true,
        explicit_generate: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────
  // Negative trigger tests — the pre-route does NOT fire
  // ───────────────────────────────────────────────────────────────────

  it('generate_model: false → does NOT dispatch (explicit-off respected)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('06'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',  // also too short for heuristic
        turn_class: 'frame',
        source: 'composer',
        generate_model: false,
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('flag absent → does NOT dispatch (regression — pre-#57 behaviour preserved)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('07'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('generate_model: true BUT non-empty graph → flag ignored (advisory contract)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('08'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
        generate_model: true,
        graph_state: {
          nodes: [{ id: 'n1', kind: 'option', label: 'Existing Option' }],
          edges: [],
        },
      },
    });
    // The advisory contract: a graph already exists, so the explicit
    // flag is ignored. Falls through to TurnExecutor (no draft dispatch).
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('non-boolean generate_model (truthy string) → 422 INGRESS_CONTRACT_VIOLATION (schema rejects)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('09'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
        generate_model: 'true',  // schema requires boolean
      },
    });
    expect(res.statusCode).toBe(422);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');
  });

  // ───────────────────────────────────────────────────────────────────
  // Failure-mode tests — explicit-trigger errors surface honestly
  // ───────────────────────────────────────────────────────────────────

  it('explicit-trigger commit failure → 500 BoundaryError (not silently masked)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: makeDraftGraphMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('0a'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
        generate_model: true,
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details?.reason).toBe('draft_graph_commit_failed');
  });

  it('explicit-trigger pipeline throw → 500 with typed reason (PR #202 envelope preserved)', async () => {
    dispatchDraftGraphMock.mockRejectedValueOnce(
      Object.assign(new Error('pipeline boom'), {
        pipelineStatusCode: 400,
        pipelineErrorCode: 'CEE_LLM_VALIDATION_FAILED',
        pipelineRecovery: { suggestion: 'try a clearer brief' },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: makeTurnId('0b'),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'go',
        turn_class: 'frame',
        source: 'composer',
        explicit_generate: true,
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Typed reason mapped from pipeline metadata — proves unknown
    // infra/contract failures are NOT disguised as user-fixable.
    expect(body.details?.reason).toContain('cee_llm_validation_failed');
    expect(body.details?.recovery).toBeDefined();
  });
});
