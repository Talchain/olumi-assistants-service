/**
 * Full-chain integration test for the V5 draft_graph typed-error envelope.
 *
 * Other tests in this directory mock at the `dispatchDraftGraph` boundary
 * and inject the throw metadata directly. That proves the catch-block
 * mapping but leaves a drift window: a future change to handleDraftGraph's
 * metadata extraction (e.g. reading the wrong field on body) would not be
 * caught because dispatchDraftGraph is replaced by a stub.
 *
 * This file mocks one layer deeper — at `runUnifiedPipeline` — and lets
 * the real `handleDraftGraph` → `dispatchDraftGraph` → route catch run.
 * That way the wire response we assert against is produced by the exact
 * code path a real pipeline error would take.
 *
 * Codex review round-2 asked for "one route-level test where mocked
 * runUnifiedPipeline returns { code: 'CEE_LLM_VALIDATION_FAILED' } and the
 * response proves the full metadata chain works." This file is that test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

// -------- Mocks --------
// IMPORTANT: only `runUnifiedPipeline` is mocked here. `dispatchDraftGraph`
// and `handleDraftGraph` use the real implementations so the full metadata
// extraction → throw → catch → envelope chain runs end-to-end.
const runUnifiedPipelineMock = vi.fn();
vi.mock('../../../src/cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: runUnifiedPipelineMock,
  isKnownSafeNormaliseError: () => false,
}));

// Minimal session-store + LLM-adapter mocks copied from the sibling route
// test file. We need them because TurnExecutor fallthrough paths import
// these modules at startup; route-v2 won't compile without them.
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

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const LONG_BRIEF =
  'Should we expand the product into the German market next quarter or hold?';

describe('POST /orchestrate/v2/turn — draft_graph FULL CHAIN integration', () => {
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
    runUnifiedPipelineMock.mockReset();
    appendMock.mockClear();
  });

  it('mocked runUnifiedPipeline returns { code: "CEE_LLM_VALIDATION_FAILED" } → real chain produces typed envelope', async () => {
    // Production CEE body shape — `code` is the category field per
    // src/cee/validation/pipeline.ts:366 buildCeeErrorResponse.
    const recovery = {
      suggestion: 'Provide a clearer, more specific decision brief.',
      hints: [
        'State the specific decision you are trying to make',
        'List 2-3 concrete options you are considering',
        'Describe what success looks like',
      ],
    };
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_LLM_VALIDATION_FAILED',
        message: 'LLM produced a response that does not match the expected graph schema',
        retryable: false,
        source: 'cee',
        request_id: 'pipeline-internal-id',
        recovery,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010001',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    // 1) HTTP 500 preserved end-to-end.
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);

    // 2) Real handleDraftGraph extracted body.code and attached it to the
    //    throw; real route catch read the metadata and produced the typed
    //    reason. Proves the body.code → pipelineErrorCode → details.reason
    //    chain through real code paths.
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_cee_llm_validation_failed');
    expect(body.details.retryable).toBe(false);
    expect(body.retryable).toBe(false);

    // 3) recovery hints survive intact.
    expect(body.details.recovery).toEqual(recovery);

    // 4) pipeline_error_code diagnostic field present.
    expect(body.details.pipeline_error_code).toBe('CEE_LLM_VALIDATION_FAILED');

    // 5) Wire body validates against the BoundaryError contract.
    expect(() => BoundaryErrorSchema.parse(body)).not.toThrow();

    // 6) runUnifiedPipeline was actually called (confirms we exercised the
    //    real handleDraftGraph rather than short-circuiting somewhere).
    expect(runUnifiedPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('mocked runUnifiedPipeline returns { code: "CEE_TIMEOUT" } → 504-shaped reason, retryable=true', async () => {
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 504,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_TIMEOUT',
        message: 'LLM provider did not respond within timeout',
        retryable: true,
        source: 'cee',
        request_id: 'pipeline-internal-id',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010002',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_timeout');
    expect(body.details.retryable).toBe(true);
    expect(body.details.pipeline_error_code).toBe('CEE_TIMEOUT');
    expect(() => BoundaryErrorSchema.parse(body)).not.toThrow();
  });
});
