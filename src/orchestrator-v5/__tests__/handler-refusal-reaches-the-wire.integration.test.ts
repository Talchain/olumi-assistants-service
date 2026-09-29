/**
 * ⭐⭐ THE ACCEPTANCE TEST FOR #1652 — DOES THE REFUSAL'S CODE REACH THE
 * SERIALISED BYTES?
 *
 * Written by the COACHING lane for the OBSERVABILITY lane's change, at that
 * lane's own request, and the reason is worth keeping: an acceptance test the
 * author writes for their own change agrees with the author's model of their
 * own change. An independent lane writing it is strictly better evidence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT LIVES HERE AND NOT AGAINST STAGING.
 *
 * At the staging tip `d1_code` has EXACTLY ONE production site — its own
 * producer, `d1-shared/error-boundary.ts:44` — measured independently by two
 * lanes, with `cause_kind` (19 production files) as the contrast control in
 * the same sweep. The field is SET and never READ. So a route-level assertion
 * against staging would prove an absence that is already proven by
 * construction and would say nothing whatever about this change.
 *
 * ⛔ THIS IS AN ACCEPTANCE TEST FOR #1652, NOT A MEASUREMENT OF STAGING. The
 * wrong place produces a confident green that means nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT ASSERTS, AND ON WHAT.
 *
 * On the SERIALISED HTTP BYTES — `JSON.parse(res.body)._diagnostic_trace` —
 * after `app.inject`, never on a value a function returned to its own caller.
 * The producer lane's own suite already proves `handler → error boundary → run
 * result`; the segment it disclosed as argued-from-construction-not-measured
 * is `run result → route-v2 → wire`. That segment is what this file measures,
 * so the two compose into the whole chain and neither duplicates the other.
 *
 * ⚠ THE POSITIVE CONTROL IS NOT OPTIONAL. A route harness that cannot see a
 * field which IS there proves nothing about one that is not, so the absence
 * arm below is paired with a field demonstrably arriving in the SAME response.
 * (CLAUDE.md trap 13.)
 *
 * ⚠ WHAT THIS FILE DELIBERATELY DOES NOT CLAIM. `d1_code` resolves four of the
 * five D1 codes to a unique throw line and leaves `PARAMETER_INVALID` a
 * 17-way bucket. Nothing here implies the bucket is resolved — it pins what
 * ARRIVES, which is a different and smaller claim.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';

const runtimeMocks = vi.hoisted(() => ({
  understandOpenFrameIntake: vi.fn(),
  runTurnExecutor: vi.fn(),
}));

vi.mock('../../orchestrator-v5/routing/open-frame-intake.js', () => ({
  understandOpenFrameIntake: runtimeMocks.understandOpenFrameIntake,
}));
vi.mock('../../orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runtimeMocks.runTurnExecutor,
}));

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
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
    countTurns: async () => 0,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

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

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '16520000-1652-4652-8652-165216521652';

/**
 * THE MEMBER SET, written out rather than derived from the type — a type
 * cannot be read at runtime, and the whole point of the assertion is that the
 * WIRE shape is what it claims. Growth is the danger this guards: the
 * retention contract is codes only, so a fifth member arriving (a message, an
 * operation value, anything carrying user content) must RED here.
 */
const EXPECTED_REFUSAL_MEMBERS = ['cause_kind', 'd1_code', 'handler_id', 'reason_code'] as const;

function baseRunResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    response: {
      response_version: 2,
      assistant_text: 'I could not apply that constraint.',
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
    ...overrides,
  };
}

function post(app: FastifyInstance, message: string) {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: '16521111-1652-4652-8652-165216521111',
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      turn_class: 'frame',
      message,
      source: 'composer',
    },
  });
}

function traceFrom(res: { body: string }): Record<string, unknown> {
  const body = JSON.parse(res.body) as Record<string, unknown>;
  const trace = body._diagnostic_trace as Record<string, unknown> | undefined;
  expect(trace, 'the diagnostic trace must be on the wire at all — flag or harness problem').toBeDefined();
  return trace!;
}

describe("#1652 acceptance — the refusal's codes reach the SERIALISED bytes", () => {
  let app: FastifyInstance;
  let priorTraceFlag: string | undefined;

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
  });
  beforeEach(() => {
    runtimeMocks.runTurnExecutor.mockReset();
    runtimeMocks.understandOpenFrameIntake.mockReset();
    runtimeMocks.understandOpenFrameIntake.mockResolvedValue({
      route: 'continue_conversation',
      source: 'model' as const,
      model: 'test-frontier-model',
      latencyMs: 7,
      inputTokens: 18,
      outputTokens: 2,
    });
    appendMock.mockClear();
  });

  it('a refusing turn puts handler_refusal on the wire with EXACTLY its four code members', async () => {
    runtimeMocks.runTurnExecutor.mockResolvedValue(
      baseRunResult({
        handlerRefusal: {
          handler_id: 'add_constraint',
          cause_kind: 'parameter_invalid_at_execute',
          d1_code: 'PARAMETER_INVALID',
          reason_code: null,
        },
      }),
    );

    const res = await post(app, 'keep churn under 10%');
    expect(res.statusCode).toBe(200);
    const trace = traceFrom(res);

    const refusal = trace.handler_refusal as Record<string, unknown> | undefined;
    expect(refusal, 'handler_refusal did not survive the hop to the serialised body').toBeDefined();

    // The values arrive intact — threaded, never re-derived at the route.
    expect(refusal!.handler_id).toBe('add_constraint');
    expect(refusal!.cause_kind).toBe('parameter_invalid_at_execute');
    expect(refusal!.d1_code).toBe('PARAMETER_INVALID');
    expect(refusal!.reason_code).toBeNull();

    // ⭐ THE RETENTION CONTRACT, as an EXACT set. REDs if a member is dropped
    // AND if one is added — a fifth field is how prose or an operation value
    // would arrive in a record that is supposed to carry codes only.
    expect(Object.keys(refusal!).sort()).toEqual([...EXPECTED_REFUSAL_MEMBERS]);
  });

  it('reports d1_code NULL on the wire — never omitted, never guessed — for a non-D1 throw', async () => {
    runtimeMocks.runTurnExecutor.mockResolvedValue(
      baseRunResult({
        handlerRefusal: {
          handler_id: 'add_constraint',
          cause_kind: 'parameter_invalid_at_execute',
          d1_code: null,
          reason_code: null,
        },
      }),
    );

    const refusal = traceFrom(await post(app, 'keep churn under 10%')).handler_refusal as
      | Record<string, unknown>
      | undefined;

    expect(refusal).toBeDefined();
    // "There was no D1 code" and "the code was X" are different claims, and the
    // null must survive serialisation as a null rather than vanishing — a
    // dropped key would read as "not measured".
    expect(Object.keys(refusal!)).toContain('d1_code');
    expect(refusal!.d1_code).toBeNull();
  });

  it('a turn that did NOT refuse omits the key entirely — and the trace is demonstrably present anyway', async () => {
    runtimeMocks.runTurnExecutor.mockResolvedValue(baseRunResult());

    const res = await post(app, 'what should I be thinking about here?');
    expect(res.statusCode).toBe(200);
    const trace = traceFrom(res);

    // ⚠ POSITIVE CONTROL. Without this the assertion below is vacuous: a
    // harness that serialises no trace fields at all would pass it. Something
    // this lane does NOT control must be visibly arriving in the same bytes.
    expect(
      Object.keys(trace).length,
      'the trace arrived empty — the absence assertion below would be vacuous',
    ).toBeGreaterThan(0);

    // OMITTED, not nulled. An absent key honestly means "no handler declined";
    // a null would be a claim that one did and the code was unknown.
    expect(Object.prototype.hasOwnProperty.call(trace, 'handler_refusal')).toBe(false);
  });
});
