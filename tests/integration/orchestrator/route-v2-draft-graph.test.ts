/**
 * Task 2 — route-level tests for V5 draft_graph pre-Sonnet dispatch.
 *
 * Validates the route-v2 branch that delegates first-time brief
 * submissions (stage=frame, no graph_state, message length meets
 * DRAFT_GRAPH_MIN_BRIEF_LENGTH) to the unified pipeline via
 * dispatchDraftGraph.
 *
 * We mock dispatchDraftGraph itself — the adapter's contract with the route
 * is what this test locks in. The unified pipeline's internal behaviour is
 * covered by existing pipeline tests; doubling that surface here would
 * produce a fragile fixture that needs LLM + PLoT mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../../src/schemas/assist.js';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Session store mock for TurnExecutor fallthrough cases.
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

// Text-only LLM mock for TurnExecutor fallthrough on short messages.
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
const TURN_ID = '11111111-1111-4111-8111-111111111111';

const LONG_BRIEF = 'Should we expand the product into the German market next quarter or hold?';
const _SHORT_BRIEF = 'What now?';

function makeDraftGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph with 3 nodes and 2 edges.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

describe('POST /orchestrate/v2/turn — draft_graph dispatch', () => {
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

  it('stage=frame + no graph + message >= MIN_BRIEF_LENGTH → dispatches draft_graph, returns 200', async () => {
    // Sanity: the test brief is actually above threshold.
    expect(LONG_BRIEF.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: TURN_ID,
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toContain('Drafted a decision graph');
    expect(body.stage_indicator).toBe('frame');
  });

  it('boundary test: message length exactly MIN_BRIEF_LENGTH with decision keyword → dispatch fires', async () => {
    // Pad with a decision keyword + filler so length is exactly the threshold.
    const base = 'Should we launch?';
    const padding = 'a'.repeat(DRAFT_GRAPH_MIN_BRIEF_LENGTH - base.length);
    const exactlyMin = base + padding;
    expect(exactlyMin.length).toBe(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111112',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: exactlyMin,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('boundary test: message length MIN_BRIEF_LENGTH - 1 → fall through (422 ingress, not dispatch)', async () => {
    const base = 'Should we launch?';
    const padding = 'a'.repeat(DRAFT_GRAPH_MIN_BRIEF_LENGTH - 1 - base.length);
    const belowMin = base + padding;
    expect(belowMin.length).toBe(DRAFT_GRAPH_MIN_BRIEF_LENGTH - 1);
    // The v0.7.0 schema allows any message >= 1 char, so this passes ingress
    // validation but falls through to the TurnExecutor path (text-only LLM
    // response), NOT the draft_graph dispatcher.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111113',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: belowMin,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    // Dispatch must NOT have been called — the trigger guard rejects
    // messages below the draft threshold. The fallthrough path exercises
    // TurnExecutor, which may succeed (200) or fail (500) depending on
    // session state in this test environment. What matters for the
    // trigger contract is that dispatchDraftGraph stayed untouched.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=frame + graph_state present → fall through (not a new draft)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111114',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
        graph_state: { nodes: [{ id: 'n1', kind: 'option', label: 'Option A' }], edges: [] },
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('conversational message without decision keywords → fall through (not a brief)', async () => {
    const conversational = 'Give me a short framing for this whole thing please';
    expect(conversational.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111111a',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: conversational,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=decide → fall through (draft is frame-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111115',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: LONG_BRIEF,
        turn_class: 'decide',
        source: 'composer',
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('draft dispatch commit failure → 500 BoundaryError', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: makeDraftGraphMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111116',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_commit_failed');
  });

  it('draft dispatcher throws → 500 BoundaryError', async () => {
    dispatchDraftGraphMock.mockRejectedValueOnce(new Error('pipeline exploded'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111117',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_pipeline_threw');
  });

  // ──────────────────────────────────────────────────────────────────
  // Edit 2: route-v2-typed-envelope workstream — when handleDraftGraph
  // attaches pipeline metadata to the thrown Error, the route maps
  // pipelineErrorCode → typed `details.reason` and category-appropriate
  // `details.retryable`. HTTP status stays at 500 to honour the
  // "no DGAI status-code contract change" constraint. Strategy B.
  // The legacy plain-Error fallback above (Test 7) must continue to
  // produce the exact existing wire shape — that's pinned bit-for-bit.
  // ──────────────────────────────────────────────────────────────────

  it('typed mapping: 400 CEE_LLM_VALIDATION_FAILED → typed reason + recovery hints (Test 4)', async () => {
    const recovery = {
      suggestion: 'Provide a clearer, more specific decision brief.',
      hints: ['List 2-3 concrete options', 'Describe what success looks like'],
    };
    const err = Object.assign(new Error('CEE_LLM_VALIDATION_FAILED'), {
      pipelineStatusCode: 400,
      pipelineErrorCode: 'CEE_LLM_VALIDATION_FAILED',
      pipelineRecovery: recovery,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e04',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    // HTTP 500 preserved (Strategy B): no DGAI status-code change.
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_cee_llm_validation_failed');
    // Validation failures are NOT retryable — the input must change.
    expect(body.details.retryable).toBe(false);
    expect(body.retryable).toBe(false);
    // Recovery hints survive the boundary so the UI can render a useful prompt.
    expect(body.details.recovery).toEqual(recovery);
    // Raw CEE code surfaced in details for dashboard splitting (post-review-fix R2).
    expect(body.details.pipeline_error_code).toBe('CEE_LLM_VALIDATION_FAILED');
  });

  it('typed mapping: 504 CEE_TIMEOUT → timeout reason + retryable=true (Test 5)', async () => {
    const err = Object.assign(new Error('CEE_TIMEOUT'), {
      pipelineStatusCode: 504,
      pipelineErrorCode: 'CEE_TIMEOUT',
      pipelineRecovery: null,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e05',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_cee_timeout');
    expect(body.details.retryable).toBe(true);
    expect(body.retryable).toBe(true);
    // No recovery hints → field absent rather than null.
    expect(body.details.recovery).toBeUndefined();
    // Raw CEE code in details (post-review-fix R2).
    expect(body.details.pipeline_error_code).toBe('CEE_TIMEOUT');
  });

  it('typed mapping: 502 CEE_LLM_UPSTREAM_ERROR → upstream reason + retryable=true (Test 6)', async () => {
    const err = Object.assign(new Error('CEE_LLM_UPSTREAM_ERROR'), {
      pipelineStatusCode: 502,
      pipelineErrorCode: 'CEE_LLM_UPSTREAM_ERROR',
      pipelineRecovery: null,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e06',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_cee_llm_upstream_error');
    expect(body.details.retryable).toBe(true);
    expect(body.retryable).toBe(true);
    // Raw CEE code in details (post-review-fix R2).
    expect(body.details.pipeline_error_code).toBe('CEE_LLM_UPSTREAM_ERROR');
  });

  it('typed mapping: 400 CEE_GRAPH_INVALID → graph-invalid reason + retryable=false (Test 6c)', async () => {
    const err = Object.assign(new Error('CEE_GRAPH_INVALID'), {
      pipelineStatusCode: 400,
      pipelineErrorCode: 'CEE_GRAPH_INVALID',
      pipelineRecovery: {
        suggestion: 'Add more detail to your decision brief before drafting a model.',
        hints: ['State the specific decision', 'List 2-3 options', 'Describe success'],
      },
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e6c',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_graph_invalid');
    expect(body.details.retryable).toBe(false);
    expect(body.details.pipeline_error_code).toBe('CEE_GRAPH_INVALID');
    expect(body.details.recovery).toBeDefined();
  });

  it('typed mapping: 400 CEE_VALIDATION_FAILED → generic validation reason + retryable=false (Test 6d)', async () => {
    const err = Object.assign(new Error('CEE_VALIDATION_FAILED'), {
      pipelineStatusCode: 400,
      pipelineErrorCode: 'CEE_VALIDATION_FAILED',
      pipelineRecovery: null,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e6d',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_validation_failed');
    expect(body.details.retryable).toBe(false);
    expect(body.details.pipeline_error_code).toBe('CEE_VALIDATION_FAILED');
  });

  it('typed mapping: 503 CEE_SERVICE_UNAVAILABLE → service-unavailable reason + retryable=true (Test 6e)', async () => {
    const err = Object.assign(new Error('CEE_SERVICE_UNAVAILABLE'), {
      pipelineStatusCode: 503,
      pipelineErrorCode: 'CEE_SERVICE_UNAVAILABLE',
      pipelineRecovery: null,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e6e',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_service_unavailable');
    expect(body.details.retryable).toBe(true);
    expect(body.details.pipeline_error_code).toBe('CEE_SERVICE_UNAVAILABLE');
  });

  it('typed mapping: unknown pipelineErrorCode falls back to status-family reason (Test 6b)', async () => {
    // Use a non-conflicting status (503 conflicts with CEE_SERVICE_UNAVAILABLE
    // mapping above). 599 is reserved/non-standard and safe for "unknown".
    const err = Object.assign(new Error('CEE_UNKNOWN_FUTURE_CODE'), {
      pipelineStatusCode: 599,
      pipelineErrorCode: 'CEE_UNKNOWN_FUTURE_CODE',
      pipelineRecovery: null,
    });
    dispatchDraftGraphMock.mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111e6b',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Unknown code: surface status family in reason, retryable=true for 5xx.
    expect(body.details.reason).toBe('draft_graph_pipeline_status_599');
    expect(body.details.retryable).toBe(true);
    // Raw unknown code preserved in details so dashboards can still split
    // by code even when the reason falls back to status family
    // (post-review-fix R2 — addresses reviewer note about diagnostics).
    expect(body.details.pipeline_error_code).toBe('CEE_UNKNOWN_FUTURE_CODE');
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 8b — load-bearing regression: the user-reported failing
  // pricing brief no longer produces opaque draft_graph_pipeline_threw.
  //
  // This test simulates the V4 pipeline rejecting the LLM output with
  // anthropic_response_invalid_schema (the hypothesised throw class for
  // the $/factor-add brief shape). Without the Edit 1+2 fix, the wire
  // envelope was INTERNAL_ERROR / draft_graph_pipeline_threw with no
  // recovery hints — opaque, not user-actionable. After the fix, the
  // wire envelope carries a typed CEE category code in details.reason
  // and recovery hints in details.recovery so the UI can prompt the
  // user to refine the brief.
  //
  // It is acceptable for the test scenario to be either (a) successful
  // graph generation OR (b) a typed recoverable failure. The
  // unacceptable outcome is opaque draft_graph_pipeline_threw with
  // the default fallback reason.
  // ──────────────────────────────────────────────────────────────────

  describe('Regression: failing $49/$99 + Add Pricing as numeric factor brief (Test 8b)', () => {
    const FAILING_BRIEF =
      'Should we charge $49 or $99 per month for our B2B SaaS product to maximise revenue? Add Pricing as a numeric factor.';

    it('LLM schema reject → typed CEE category + recovery, NOT opaque draft_graph_pipeline_threw', async () => {
      // Simulates the post-Edit-1 path: handleDraftGraph throws with metadata
      // when the V4 pipeline returns 400 CEE_LLM_VALIDATION_FAILED.
      const typedErr = Object.assign(new Error('CEE_LLM_VALIDATION_FAILED'), {
        pipelineStatusCode: 400,
        pipelineErrorCode: 'CEE_LLM_VALIDATION_FAILED',
        pipelineRecovery: {
          suggestion: 'Provide a clearer, more specific decision brief.',
          hints: [
            'State the specific decision you are trying to make',
            'List 2-3 concrete options you are considering',
            'Describe what success looks like',
          ],
        },
      });
      dispatchDraftGraphMock.mockRejectedValueOnce(typedErr);
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: '11111111-1111-4111-8111-1111111108b1',
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message: FAILING_BRIEF,
          turn_class: 'frame',
          source: 'composer',
        },
      });
      const body = JSON.parse(res.body);
      // Load-bearing assertion: the opaque envelope is gone.
      expect(body.details.reason).not.toBe('draft_graph_pipeline_threw');
      // Replaced with a typed CEE category code + recovery hints.
      expect(body.details.reason).toBe('draft_graph_cee_llm_validation_failed');
      expect(body.details.recovery).toBeDefined();
      expect((body.details.recovery as { hints?: unknown[] }).hints).toBeInstanceOf(Array);
      expect(body.details.retryable).toBe(false);
    });

    it('successful generation path also valid (acceptable outcome): brief still routes to dispatch', async () => {
      dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: '11111111-1111-4111-8111-1111111108b2',
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message: FAILING_BRIEF,
          turn_class: 'frame',
          source: 'composer',
        },
      });
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
      // Brief regex matches "Should" and trailing "?" — must dispatch.
      expect(res.statusCode).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Tests 9 + 10 — passing brief regression locks. The hiring brief and
  // pricing-without-$ brief were both verified-passing in the diagnosis
  // and must continue to dispatch successfully after the Edit 1+2+3
  // changes. Mocked dispatch confirms the regex still triggers; the
  // actual LLM/pipeline behaviour is covered by upstream tests.
  // ──────────────────────────────────────────────────────────────────

  describe('Regression: verified-passing briefs still dispatch (Tests 9 + 10)', () => {
    it('hiring brief "Should we hire a tech lead or two developers..." → dispatch + 200 (Test 9)', async () => {
      dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: '11111111-1111-4111-8111-111111111909',
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message:
            'Should we hire a tech lead or two developers to improve delivery speed?',
          turn_class: 'frame',
          source: 'composer',
        },
      });
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    });

    it('pricing brief without $ "Should we set pricing at 49 or 99..." → dispatch + 200 (Test 10)', async () => {
      dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: '11111111-1111-4111-8111-111111111a10',
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message:
            'Should we set pricing at 49 per month or 99 per month for our B2B SaaS product to maximise revenue?',
          turn_class: 'frame',
          source: 'composer',
        },
      });
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    });
  });

  // ------------------------------------------------------------------
  // Regression: phrasings that might trip the heuristic trigger
  // ------------------------------------------------------------------
  // The heuristic regex is known to produce false negatives on valid
  // decision briefs that don't use the tracked verbs. These cases
  // document current behaviour so a future trigger change can see
  // exactly which phrasings it's affecting. False negatives fall
  // through to TurnExecutor text_only (already WORKING in the matrix),
  // so the user still gets a response — just not a graph.

  describe('regression phrasings — current trigger behaviour', () => {
    const cases = [
      {
        label: 'positive: "should we" + decide',
        message: 'Should we launch the new SKU in Q3 or hold?',
        expectDispatch: true,
      },
      {
        label: 'positive: "whether to"',
        message: 'Whether to acquire the smaller competitor this year or next',
        expectDispatch: true,
      },
      {
        label: 'positive: ends with ?',
        message: 'Is this a reasonable plan for the next six months of growth?',
        expectDispatch: true,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: declarative "I am thinking about"',
        message: 'I am thinking about moving the team to Austin next spring',
        expectDispatch: false,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: "considering options"',
        message: 'Considering our options for hiring senior engineers this year',
        expectDispatch: false,
      },
      {
        label: 'positive: "pivot"',
        message: 'Pivot from enterprise to SMB — is this the right move now?',
        expectDispatch: true,
      },
    ];

    let turnIdSuffix = 0;
    for (const c of cases) {
      it(`${c.label}`, async () => {
        if (c.expectDispatch) {
          dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
        }
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: {
            kind: 'message',
            turn_id: `11111111-1111-4111-8111-1111111dd1${String(turnIdSuffix++).padStart(2, '0')}`,
            scenario_id: SCENARIO_ID,
            stage: 'frame',
            message: c.message,
            turn_class: 'frame',
            source: 'composer',
          },
        });
        if (c.expectDispatch) {
          expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
        } else {
          expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
        }
        expect([200, 500]).toContain(res.statusCode);
      });
    }
  });
});
