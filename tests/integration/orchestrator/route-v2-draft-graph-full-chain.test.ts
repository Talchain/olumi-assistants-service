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
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../src/orchestrator/tools/analysis-ready-helper.js';

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
const appendMock = vi.fn(async (write: { graph?: unknown }) => ({
  id: 'mock-row-id',
  ...(write.graph != null
    ? { graph_write_disposition: 'accepted_insert' as const }
    : {}),
}));
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
// Real producer for the OPTIONS_IDENTICAL fail-fast envelope (NOT mocked —
// the vi.mock above only replaces unified-pipeline/index.js).
const { runOptionsIdenticalBypass } = await import(
  '../../../src/cee/unified-pipeline/stages/repair/options-identical-bypass.js'
);

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const LONG_BRIEF =
  'Should we expand the product into the German market next quarter or hold?';

// Deliberately PRE-projection: the canonical top-level options, goal pointer
// and constraints carriers are absent. The full route must persist and expose
// the one projected fixed point, never hash/readiness from these raw bytes.
const PROJECTION_MUTATING_DRAFT = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    { id: 'dec_expand', kind: 'decision', label: 'Expand into Germany?' },
    {
      id: 'opt_expand',
      kind: 'option',
      label: 'Expand now',
      interventions: {
        fac_reach: {
          value: 0.8,
          source: 'user_specified',
          target_match: {
            node_id: 'fac_reach',
            match_type: 'exact_id',
            confidence: 'high',
          },
        },
      },
    },
    {
      id: 'opt_hold',
      kind: 'option',
      label: 'Hold for now',
      interventions: {
        fac_reach: {
          value: 0.2,
          source: 'user_specified',
          target_match: {
            node_id: 'fac_reach',
            match_type: 'exact_id',
            confidence: 'high',
          },
        },
      },
    },
    {
      id: 'fac_reach',
      kind: 'factor',
      label: 'Market reach',
      category: 'controllable',
    },
  ],
  edges: [
    { from: 'dec_expand', to: 'opt_expand', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_expand', to: 'opt_hold', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_expand', to: 'fac_reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_hold', to: 'fac_reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_reach', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

// ──────────────────────────────────────────────────────────────────
// 2.733-B1: OPTIONS_IDENTICAL fixtures derived from the REAL producer.
//
// The previous fixtures were hand-written mirrors of a 2026-07 producer
// that has since moved twice (domain-neutral copy 2026-07-24; declared
// retryable:true the same day). They fed `retryable:false` + pricing-
// scripted copy into the chain, so the wire assertions proved nothing
// about what the deployed producer emits — a stale positive control
// (trap 18's fixture corollary). These helpers invoke the actual
// `runOptionsIdenticalBypass` at this tip and use ITS bytes as the
// pipeline mock, so fixture and producer cannot drift again.
// ──────────────────────────────────────────────────────────────────
function produceOptionsIdenticalEarlyReturn(
  violationContext?: Record<string, unknown>,
): { statusCode: number; body: Record<string, any> } {
  // Minimal StageContext for the producer. The duplicate options carry
  // DISTINCT labels (and one baseline-shaped label), so the graceful dedup
  // declines (Guards 2/3b) and the fail-fast producer runs — the same
  // shape as the live staging firings.
  const ctx = {
    requestId: 'pipeline-internal-id',
    graph: {
      nodes: [
        { id: 'dec_pricing', kind: 'decision', label: 'Choose price point' },
        { id: 'opt_49', kind: 'option', label: 'Charge $49', data: { interventions: { fac_price: 0.5 } } },
        { id: 'opt_99', kind: 'option', label: 'Charge $99', data: { interventions: { fac_price: 0.5 } } },
        { id: 'opt_status_quo', kind: 'option', label: 'Status quo', data: { interventions: { fac_price: 0.5 } } },
      ],
      edges: [],
      version: '1.2',
    },
    pipelineOutcome: { warnings: [] },
    remainingViolations: [
      {
        code: 'OPTIONS_IDENTICAL',
        ...(violationContext !== undefined ? { context: violationContext } : {}),
      },
    ],
  } as any;

  const fired = runOptionsIdenticalBypass(ctx);
  // Precondition pin (CLAUDE.md trap 13b, third face): the fixture is only
  // evidence if the producer actually fired. A silent non-fire here would
  // otherwise let every downstream assertion pass against nothing.
  if (!fired || !ctx.earlyReturn) {
    throw new Error('OPTIONS_IDENTICAL producer did not fire — fixture harness invalid');
  }
  return ctx.earlyReturn;
}

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

  it('projection-mutating success keeps storage, receipt, readiness and final wire on one committed hash', async () => {
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: structuredClone(PROJECTION_MUTATING_DRAFT),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010000',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledOnce();
    const persisted = appendMock.mock.calls[0]![0]!.graph;
    const projected = projectGraphForPersistence(PROJECTION_MUTATING_DRAFT);
    const rawHash = computeAnalysisAffectingGraphHash(PROJECTION_MUTATING_DRAFT as never);
    const committedHash = computeAnalysisAffectingGraphHash(persisted as never);
    const canonicalReadiness = buildCanonicalAnalysisReadyFromGraph(persisted);

    expect(persisted).toStrictEqual(projected);
    expect(projectGraphForPersistence(persisted)).toBe(persisted);
    expect(committedHash).not.toBeNull();
    expect(committedHash).not.toBe(rawHash);
    expect(canonicalReadiness).toBeDefined();

    const body = JSON.parse(res.body);
    expect(body.graph_hash).toBe(committedHash);
    expect(body.analysis_ready.current_graph_hash).toBe(committedHash);
    expect(body.analysis_ready.status).toBe(canonicalReadiness!.status);
    expect(body.analysis_ready.options).toStrictEqual(canonicalReadiness!.options);
    for (const carrier of [
      'nodes',
      'edges',
      'options',
      'goal_node_id',
      'goal_constraints',
    ] as const) {
      expect(body.draft_graph[carrier]).toStrictEqual(
        (persisted as Record<string, unknown>)[carrier],
      );
    }
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

  it('TRUNCATION on the PRODUCT path carries the honest recovery copy AND the pinned flat recovery_suggestion', async () => {
    // ⭐ 2026-07-25, skip-gate lane. The 2026-07-24 re-probe reported the product
    // path failing with "a bare 500 ... none of the honest recovery copy".
    // Verified at source: HALF of that is wrong — `handleDraftGraph` already
    // lifts `body.recovery` onto the throw and the route already writes it to
    // `details.recovery`. What was genuinely missing is the PINNED FLAT field
    // name `recovery_suggestion` (@talchain/schemas 0.19.0, DGAI #383), which
    // `/assist/v1/draft-graph` ships at the top level of its error body and this
    // route did not — so a consumer implemented against the assist contract
    // found nothing here. This test pins BOTH halves so neither can regress.
    //
    // ⚠ STILL OPEN, deliberately not asserted as fixed: this response has no
    // `assistant_text`, so the user sees nothing until DGAI renders the field.
    // That is a UI-side change, outside this lane's write slot.
    const recovery = {
      suggestion:
        'The draft grew past the time budget and was cut off before it finished, so nothing was saved.',
      hints: [
        'One retry is worth trying — but if it fails the same way again, more retries will not help',
        'Narrowing the scope reliably fixes it: one decision at a time, with fewer options',
      ],
    };
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        schema: 'cee.error.v1',
        code: 'CEE_LLM_VALIDATION_FAILED',
        message: 'The draft needed more output tokens than the request budget affords and was truncated',
        retryable: true,
        source: 'cee',
        request_id: 'pipeline-internal-id',
        reason: 'llm_truncated_max_tokens',
        recovery,
        recovery_suggestion: recovery.suggestion,
        details: { reason: 'llm_truncated_max_tokens' },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-3333fc010009',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);

    // A truncation is a service-side over-generation, not a client input error.
    expect(body.details.reason).toBe('draft_graph_cee_llm_validation_failed');
    expect(body.retryable).toBe(true);

    // The nested object (pre-existing behaviour — pinned so it cannot silently go).
    expect(body.details.recovery).toEqual(recovery);

    // ⭐ THE NEW FIELD — same sentence, same pinned name as `/assist`.
    expect(body.details.recovery_suggestion).toBe(recovery.suggestion);

    // The copy that was measured false (18 retries / 0 successes) must not be
    // reachable on this route either.
    const allCopy = [body.details.recovery.suggestion, ...body.details.recovery.hints]
      .join(' ')
      .toLowerCase();
    expect(allCopy).not.toMatch(/usually (succeeds|works)/);

    expect(() => BoundaryErrorSchema.parse(body)).not.toThrow();
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
  // OPTIONS_IDENTICAL fail-fast — full chain, REAL producer bytes.
  //
  // The pipeline mock is fed the envelope the actual
  // runOptionsIdenticalBypass builds at this tip (see harness above).
  // Asserts the full chain (pipeline → handleDraftGraph → dispatch →
  // route catch → wire) propagates everything: typed reason, the
  // producer's recovery copy, identical_option_ids in details, the
  // producer-declared retryable:true (2.733-B1 pin), no graph persisted.
  // ──────────────────────────────────────────────────────────────────

  it('REAL OPTIONS_IDENTICAL producer bytes → retry-first clarification copy AND retryable:true on wire (2.733-B1)', async () => {
    const produced = produceOptionsIdenticalEarlyReturn({
      optionIds: ['opt_49', 'opt_99', 'opt_status_quo'],
      signature: 'fac_price:0.5000',
    });

    // Producer-side pins BEFORE the chain runs: the envelope declares its own
    // retryability (2026-07-24 honesty fix) and retry-first copy. If the
    // producer regresses to a hard dead end, the fixture itself REDs here —
    // not silently downstream.
    expect(produced.statusCode).toBe(400);
    expect(produced.body.code).toBe('CEE_GRAPH_INVALID');
    expect(produced.body.retryable).toBe(true);
    expect(produced.body.recovery.suggestion).toMatch(/retry/i);
    expect(produced.body.details.identical_option_ids).toEqual(['opt_49', 'opt_99', 'opt_status_quo']);

    runUnifiedPipelineMock.mockResolvedValueOnce(produced);

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
    // ⭐ 2.733-B1 WIRE PIN: the producer's explicit retryable:true survives to
    // the wire at BOTH levels via #845's monotone promotion. The previous
    // fixtures pinned `false` here, i.e. they pinned the defect.
    expect(body.retryable).toBe(true);
    expect(body.details.retryable).toBe(true);
    expect(body.details.pipeline_error_code).toBe('CEE_GRAPH_INVALID');

    // The producer's recovery copy survives the boundary BYTE-IDENTICAL —
    // asserted against the produced bytes, not a hand-written mirror.
    expect(body.details.recovery).toEqual(produced.body.recovery);
    expect(body.details.recovery_suggestion).toBe(produced.body.recovery.suggestion);
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

  it('OPTIONS_IDENTICAL producer with empty/missing context → empty identical_option_ids on wire', async () => {
    // Defensive case, REAL producer bytes: the bypass handles a missing
    // validator `context` by emitting an empty identical_option_ids array
    // and omitting intervention_signature. The allowlist + propagation
    // chain must surface that intent intact — not drop the field, not
    // invent values.
    const produced = produceOptionsIdenticalEarlyReturn(undefined);
    expect(produced.body.details.identical_option_ids).toEqual([]);
    expect(produced.body.details.intervention_signature).toBeUndefined();
    expect(produced.body.retryable).toBe(true);

    runUnifiedPipelineMock.mockResolvedValueOnce(produced);

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
    // 2.733-B1 wire pin holds on the defensive path too.
    expect(body.details.retryable).toBe(true);

    expect(appendMock).not.toHaveBeenCalled();
  });

  it('non-allowlisted fields in pipeline body.details are NOT propagated to the wire', async () => {
    // Defence-in-depth: handleDraftGraph's PIPELINE_DETAILS_ALLOWLIST
    // filters out any field that isn't explicitly approved for the wire
    // (protects against future CEE error sites adding fields that
    // contain user input echoes, stack traces, or other unsafe content).
    // Base bytes come from the REAL producer; the unsafe fields are
    // injected on top to exercise the filter.
    const produced = produceOptionsIdenticalEarlyReturn({ optionIds: ['opt_a'] });
    runUnifiedPipelineMock.mockResolvedValueOnce({
      statusCode: produced.statusCode,
      body: {
        ...produced.body,
        details: {
          ...produced.body.details,
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
