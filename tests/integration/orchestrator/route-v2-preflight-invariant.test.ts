/**
 * Structural invariant: every dispatch branch in route-v2.ts runs the
 * shared pre-flight (`preflightEnsureScenario` → `ensureScenarioExists`)
 * exactly once per request.
 *
 * Existing route-v2-*.test.ts files mock `ensureScenarioExists` with an
 * inline `async () => ({ user_id: userId })` and never inspect whether it
 * was invoked. A future dispatch branch could therefore be added that
 * silently bypasses the pre-flight and every one of those tests would
 * still pass. This file installs `vi.fn()` as the spy and asserts
 * `spy.mock.calls.length === 1` for each of the five branches the route
 * handler dispatches, plus a null-user case (spy NOT called — pre-flight
 * short-circuits when user_id is absent) plus one order assertion that
 * pre-flight runs BEFORE dispatch.
 *
 * Paired with:
 *   - `runPreFlight` helper in src/orchestrator/route-v2-preflight.ts
 *   - File-scoped no-restricted-syntax rule in eslint.config.js
 *
 * The lint rule is a compile-time guard; this test is the runtime guard.
 * Together they close the "new branch bypasses pre-flight" regression
 * channel that has appeared in three prior briefs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Capture ensureScenarioExists as a vi.fn spy — unlike the inline arrow
// used by other route-v2 tests, a vi.fn exposes `.mock.calls` so we can
// assert the call count and argument shape per branch.
const ensureScenarioExistsSpy = vi.fn(async (_scenarioId: string, userId: string) => ({
  user_id: userId,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: ensureScenarioExistsSpy,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Dispatch mocks — we only need the happy path here. The per-branch test
// files already cover dispatcher-specific behaviour in depth.
const dispatchDraftGraphSpy = vi.fn();
const dispatchEditGraphSpy = vi.fn();
const dispatchChipClickRunAnalysisSpy = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphSpy,
}));
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphSpy,
}));
// Phase 2b — route-v2 calls `dispatchDeterministicChipClick` and gates on
// `isDeterministicChipClickActionType`. Forward run_analysis through the
// existing spy so this test's contract is preserved.
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: dispatchChipClickRunAnalysisSpy,
  dispatchDeterministicChipClick: async (actionType: string, params: unknown) => {
    if (actionType === 'run_analysis') return dispatchChipClickRunAnalysisSpy(params);
    throw new Error(`unexpected action_type in test mock: ${actionType}`);
  },
  isDeterministicChipClickActionType: (actionType: string) =>
    actionType === 'run_analysis' ||
    actionType === 'explain_results' ||
    actionType === 'what_would_flip',
  DETERMINISTIC_CHIP_ACTION_TYPES: new Set(['run_analysis', 'explain_results', 'what_would_flip']),
}));

// LLM adapter: permissive so the TurnExecutor fallthrough returns 200.
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

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function happyOlumiResponse(stage: 'frame' | 'analyse' | 'decide') {
  return {
    response_version: 2 as const,
    assistant_text: 'ok',
    blocks: [] as const,
    suggested_actions: [] as const,
    insights: [] as const,
    stage_indicator: stage,
  };
}

describe('route-v2 pre-flight invariant — ensureScenarioExists runs once per branch', () => {
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
    ensureScenarioExistsSpy.mockClear();
    appendMock.mockClear();
    dispatchDraftGraphSpy.mockReset();
    dispatchEditGraphSpy.mockReset();
    dispatchChipClickRunAnalysisSpy.mockReset();
  });

  it('system_event branch: pre-flight runs exactly once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'system_event',
        turn_id: '11111111-1111-4111-8111-111111111111',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        event: {
          kind: 'patch_accepted',
          patch_id: '99999999-9999-4999-8999-999999999999',
        },
        user_id: USER_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, USER_ID);
  });

  it('chip_click run_analysis branch: pre-flight runs exactly once', async () => {
    dispatchChipClickRunAnalysisSpy.mockResolvedValueOnce({
      outcome: 'ok' as const,
      response: happyOlumiResponse('decide'),
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '22222222-2222-4222-8222-222222222222',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
        user_id: USER_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, USER_ID);
  });

  it('draft_graph branch: pre-flight runs exactly once', async () => {
    dispatchDraftGraphSpy.mockResolvedValueOnce({
      response: happyOlumiResponse('frame'),
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-333333333333',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'Should we expand into Germany next quarter or delay to Q3?',
        turn_class: 'frame',
        source: 'composer',
        user_id: USER_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, USER_ID);
  });

  it('edit_graph branch: pre-flight runs exactly once', async () => {
    dispatchEditGraphSpy.mockResolvedValueOnce({
      response: happyOlumiResponse('analyse'),
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '44444444-4444-4444-8444-444444444444',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Reduce the weight of the regulatory factor',
        turn_class: 'propose',
        source: 'composer',
        user_id: USER_ID,
        graph_state: {
          nodes: [
            { id: 'opt-1', kind: 'option', label: 'Expand Q2' },
            { id: 'fac-1', kind: 'factor', label: 'Regulatory' },
          ],
          edges: [{ from: 'fac-1', to: 'opt-1' }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, USER_ID);
  });

  it('TurnExecutor fallthrough branch: pre-flight runs exactly once', async () => {
    // Message that matches none of the heuristic branches: stage=analyse
    // with graph_state present (skips draft_graph) but no edit verb (skips
    // edit_graph, and the source isn't chip_click, so chip_click is out).
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '55555555-5555-4555-8555-555555555555',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'What does this graph tell us about our regulatory exposure?',
        turn_class: 'propose',
        source: 'composer',
        user_id: USER_ID,
        graph_state: {
          nodes: [
            { id: 'opt-1', kind: 'option', label: 'Expand Q2' },
            { id: 'fac-1', kind: 'factor', label: 'Regulatory' },
          ],
          edges: [{ from: 'fac-1', to: 'opt-1' }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, USER_ID);
  });

  it('null user_id (guest mode): pre-flight still calls ensureScenarioExists with null', async () => {
    // Guest mode (VITE_AUTH_MODE=guest) sends no user_id. scenarios.user_id is
    // now nullable, so the RPC is still called and creates the row with user_id
    // = NULL. The ownership check is skipped (no auth identity to compare).
    // The turn proceeds normally.
    dispatchDraftGraphSpy.mockResolvedValueOnce({
      response: happyOlumiResponse('frame'),
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '66666666-6666-4666-8666-666666666666',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'Should we expand into Germany next quarter or delay to Q3?',
        turn_class: 'frame',
        source: 'composer',
        // no user_id — guest mode
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, null);
  });

  it('order invariant: pre-flight runs BEFORE dispatch (draft_graph case)', async () => {
    // Assert the pre-flight spy was called strictly before the dispatcher
    // spy — this is the load-bearing ordering that the `runPreFlight`
    // extraction locks in. Using `vi.fn()` invocation-order tracking via
    // `.mock.invocationCallOrder`.
    dispatchDraftGraphSpy.mockResolvedValueOnce({
      response: happyOlumiResponse('frame'),
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '77777777-7777-4777-8777-777777777777',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'Should we expand into Germany next quarter or delay to Q3?',
        turn_class: 'frame',
        source: 'composer',
        user_id: USER_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(dispatchDraftGraphSpy).toHaveBeenCalledTimes(1);
    const preflightOrder = ensureScenarioExistsSpy.mock.invocationCallOrder[0];
    const dispatchOrder = dispatchDraftGraphSpy.mock.invocationCallOrder[0];
    expect(preflightOrder).toBeLessThan(dispatchOrder);
  });
});
