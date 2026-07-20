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

  // ──────────────────────────────────────────────────────────────────
  // OPTIONS_IDENTICAL pre-LLM-repair bypass — full chain.
  //
  // Simulates the bypass setting ctx.earlyReturn with the new
  // CEE_GRAPH_INVALID + options-specific recovery payload.
  // Asserts the full chain (pipeline → handleDraftGraph → dispatch →
  // route catch → wire) propagates everything: typed reason, the new
  // recovery copy, identical_option_ids in details, no graph persisted.
  // ──────────────────────────────────────────────────────────────────

  it('mocked runUnifiedPipeline returns OPTIONS_IDENTICAL bypass shape → user-actionable clarification copy on wire', async () => {
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_GRAPH_INVALID',
        message: 'Options need at least one distinct value to compare',
        retryable: false,
        source: 'cee',
        request_id: 'pipeline-internal-id',
        reason: 'options_identical_unrepairable_by_llm',
        recovery: {
          suggestion:
            'Your options need at least one distinct value to compare. ' +
            'For a pricing decision, give a price for each option ' +
            '(e.g. Low = £49/month, Mid = £99/month, High = £199/month).',
          hints: [
            'Give each option at least one unique value (price, headcount, timeline, scope).',
            'Use specific numbers rather than vague descriptions.',
            'Or describe how each option differs from the others in plain language.',
          ],
        },
        details: {
          violation_code: 'OPTIONS_IDENTICAL',
          identical_option_ids: ['opt_49', 'opt_99', 'opt_status_quo'],
          intervention_signature: 'fac_price:0.5000',
          repair_skip_reason: 'options_identical_unrepairable_by_llm',
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010003',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message:
          'Should we charge $49 or $99 per month for our B2B SaaS product to maximise revenue? Add Pricing as a numeric factor.',
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);

    // Typed reason from PR #201 mapping
    expect(body.details.reason).toBe('draft_graph_cee_graph_invalid');
    expect(body.details.retryable).toBe(false);
    expect(body.details.pipeline_error_code).toBe('CEE_GRAPH_INVALID');

    // The new user-actionable recovery copy from the bypass survives the
    // boundary intact. This is the load-bearing assertion for the user's
    // "fast, user-actionable clarification" requirement.
    expect(body.details.recovery).toBeDefined();
    expect(body.details.recovery.suggestion).toContain('distinct value');
    expect(body.details.recovery.suggestion).toMatch(/£49|£99|£199/);
    expect(Array.isArray(body.details.recovery.hints)).toBe(true);
    expect(body.details.recovery.hints.length).toBeGreaterThan(0);

    // OPTIONS_IDENTICAL bypass diagnostics survive end-to-end (PR #202
    // round-2 review fix — these fields were previously dropped by
    // handleDraftGraph because it didn't read body.details). Each is a
    // member of the PIPELINE_DETAILS_ALLOWLIST in
    // src/orchestrator/tools/draft-graph.ts.
    expect(body.details.violation_code).toBe('OPTIONS_IDENTICAL');
    expect(body.details.identical_option_ids).toEqual(['opt_49', 'opt_99', 'opt_status_quo']);
    expect(body.details.intervention_signature).toBe('fac_price:0.5000');
    expect(body.details.repair_skip_reason).toBe('options_identical_unrepairable_by_llm');

    // No partial graph commit — dispatchDraftGraph's outer catch re-throws
    // BEFORE the commit/append step. This is the persistence-safety
    // invariant for the OPTIONS_IDENTICAL bypass path.
    expect(appendMock).not.toHaveBeenCalled();

    // Wire body validates against the BoundaryError contract.
    expect(() => BoundaryErrorSchema.parse(body)).not.toThrow();

    // The pipeline was actually called (confirms we did NOT short-circuit
    // somewhere before the unified-pipeline boundary).
    expect(runUnifiedPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('OPTIONS_IDENTICAL bypass with empty/missing context → empty identical_option_ids on wire', async () => {
    // Defensive case: the bypass helper handles missing validator
    // `context` (validator omitted it) by emitting an empty
    // identical_option_ids array. The allowlist + propagation chain must
    // surface that intent intact — not drop the field, not invent values.
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_GRAPH_INVALID',
        message: 'Options need at least one distinct value to compare',
        retryable: false,
        source: 'cee',
        request_id: 'pipeline-internal-id',
        reason: 'options_identical_unrepairable_by_llm',
        recovery: {
          suggestion: 'Your options need at least one distinct value to compare.',
          hints: ['Give each option a unique value.'],
        },
        details: {
          violation_code: 'OPTIONS_IDENTICAL',
          identical_option_ids: [],
          repair_skip_reason: 'options_identical_unrepairable_by_llm',
          // intervention_signature deliberately omitted (validator
          // didn't supply it).
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010004',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);

    expect(body.details.violation_code).toBe('OPTIONS_IDENTICAL');
    // Empty array is preserved — does NOT get coerced to undefined or
    // dropped from the wire.
    expect(body.details.identical_option_ids).toEqual([]);
    // Field absent from upstream stays absent on wire (not invented).
    expect(body.details.intervention_signature).toBeUndefined();
    expect(body.details.repair_skip_reason).toBe('options_identical_unrepairable_by_llm');

    expect(appendMock).not.toHaveBeenCalled();
  });

  it('non-allowlisted fields in pipeline body.details are NOT propagated to the wire', async () => {
    // Defence-in-depth: handleDraftGraph's PIPELINE_DETAILS_ALLOWLIST
    // filters out any field that isn't explicitly approved for the wire
    // (protects against future CEE error sites adding fields that
    // contain user input echoes, stack traces, or other unsafe content).
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_GRAPH_INVALID',
        message: 'Test',
        retryable: false,
        source: 'cee',
        request_id: 'pipeline-internal-id',
        details: {
          violation_code: 'OPTIONS_IDENTICAL', // allowlisted
          identical_option_ids: ['opt_a'],     // allowlisted
          // The following are NOT in the allowlist and must be dropped:
          stack_trace: 'Error at ... (sensitive internal path)',
          internal_factor_ids: ['fac_internal_x'],
          user_input_echo: 'something the user typed',
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010005',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    const body = JSON.parse(res.body);
    expect(body.details.violation_code).toBe('OPTIONS_IDENTICAL');
    expect(body.details.identical_option_ids).toEqual(['opt_a']);
    // Non-allowlisted fields must be absent from the wire.
    expect(body.details.stack_trace).toBeUndefined();
    expect(body.details.internal_factor_ids).toBeUndefined();
    expect(body.details.user_input_echo).toBeUndefined();
  });
});
