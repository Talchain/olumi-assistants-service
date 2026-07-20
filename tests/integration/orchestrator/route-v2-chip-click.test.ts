/**
 * Task 4 — route-level tests for V5 chip-click run_analysis dispatch.
 *
 * Scope:
 *   - source='chip_click' + chip.action_type='run_analysis' dispatches
 *     deterministically via dispatchChipClickRunAnalysis.
 *   - source='chip' (inline chip metadata on a normal message) does NOT
 *     dispatch — falls through to TurnExecutor.
 *   - source='chip_click' with unregistered action_type (e.g.
 *     set_factor_value) falls through and TurnExecutor returns the
 *     existing UNSUPPORTED_ACTION → FEATURE_NOT_ENABLED path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchChipClickRunAnalysisMock = vi.fn();

// Phase 2b — route-v2 now calls the generalised `dispatchDeterministicChipClick`
// entry point and gates on `isDeterministicChipClickActionType`. The integration
// suite still asserts the run_analysis dispatch contract end-to-end, so we wire
// the mock to forward run_analysis chip-clicks to the legacy mock and keep the
// gate predicate exposed for the whitelist check.
const dispatchDeterministicChipClickMock = vi.fn(
  async (actionType: string, params: unknown) => {
    if (actionType === 'run_analysis') {
      return dispatchChipClickRunAnalysisMock(params);
    }
    throw new Error(`unexpected action_type in test mock: ${actionType}`);
  },
);

vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: dispatchChipClickRunAnalysisMock,
  dispatchDeterministicChipClick: dispatchDeterministicChipClickMock,
  isDeterministicChipClickActionType: (actionType: string) =>
    actionType === 'run_analysis' ||
    actionType === 'explain_results' ||
    actionType === 'what_would_flip',
  DETERMINISTIC_CHIP_ACTION_TYPES: new Set(['run_analysis', 'explain_results', 'what_would_flip']),
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

// Spy on routeWithToolUse — the precise "no Sonnet classification" assertion
// per brief review comment (decision_review still may fire; don't block on
// total LLM count).
const routeWithToolUseSpy = vi.fn();
vi.mock('../../../src/orchestrator-v5/routing/route-with-tool-use.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/routing/route-with-tool-use.js')
  >();
  return {
    ...actual,
    routeWithToolUse: (...args: unknown[]) => {
      routeWithToolUseSpy(...args);
      // Delegate to real impl so fallthrough tests (plain 'chip' source)
      // still exercise routing. Tests that assert no-classification only
      // care that the spy wasn't invoked.
      return (actual.routeWithToolUse as unknown as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// Minimal LLM adapter for fallthrough paths.
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

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';

function makeMockResult() {
  return {
    outcome: 'ok' as const,
    response: {
      response_version: 2 as const,
      assistant_text: 'Ran analysis on your current scenario.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

describe('POST /orchestrate/v2/turn — chip_click run_analysis dispatch', () => {
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
    dispatchChipClickRunAnalysisMock.mockReset();
    routeWithToolUseSpy.mockClear();
    appendMock.mockClear();
  });

  it('chip_click + action_type=run_analysis → dispatches without Sonnet classification', async () => {
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce(makeMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc01',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchChipClickRunAnalysisMock).toHaveBeenCalledTimes(1);
    // Precise assertion: Sonnet routing was NOT called. Total LLM count is
    // not asserted (decision_review may still fire inside the handler).
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('analysis');
  });

  it('chip_click run_analysis with analysisReady → wire response carries analysis_ready (full path: dispatch → finaliser → wire)', async () => {
    // V5 golden-path Step 4 → Step 5 wire fix. Proves the entire chain:
    // chip-click dispatch surfaces analysisReady on its result → route-v2.ts
    // sendFinalised200 forwards it to finaliseV5Response → the finaliser
    // stamps it on the wire body → it survives egress validation.
    const dispatchAnalysisReady = {
      status: 'ready' as const,
      goal_node_id: 'goal_revenue',
      options: [
        { option_id: 'opt_a', label: 'Option A', status: 'ready', interventions: { fac_x: 0.6 } },
        { option_id: 'opt_b', label: 'Option B', status: 'ready', interventions: { fac_x: 0.3 } },
      ],
    };
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      ...makeMockResult(),
      analysisReady: dispatchAnalysisReady,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc02',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.analysis_ready).toBeDefined();
    expect(body.analysis_ready.status).toBe('ready');
    expect(body.analysis_ready.goal_node_id).toBe('goal_revenue');
    // Finaliser stamps a fresh ISO-8601 computed_at — proves the field was
    // routed THROUGH the finaliser, not stamped upstream.
    const ts = body.analysis_ready.computed_at as string;
    expect(typeof ts).toBe('string');
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('chip_click run_analysis with freshness → wire response carries analysis_ready.freshness fields and selected-fact computed_at', async () => {
    // V5 state-trust route-level wire-shape test. Proves the entire chain:
    // chip-click dispatch surfaces freshness on its result → route-v2.ts
    // sendFinalised200 forwards it to finaliseV5Response → attachComputedAt
    // stamps both freshness fields AND uses the selected-fact computed_at
    // (NOT Date.now). Catches regressions where the dispatcher forgets to
    // thread cc.freshness through, or where the schema rejects the new
    // optional fields.
    const FACT_COMPUTED_AT = '2026-04-30T12:34:56.789Z';
    const dispatchAnalysisReady = {
      status: 'ready' as const,
      goal_node_id: 'goal_revenue',
      options: [
        { option_id: 'opt_a', label: 'Option A', status: 'ready', interventions: { fac_x: 0.6 } },
      ],
    };
    const dispatchFreshness = {
      freshness: 'fresh' as const,
      reason: 'graph_hash_match' as const,
      selected_fact_index: 0,
      graph_hash_at_run: 'aaaa1111bbbb2222',
      current_graph_hash: 'aaaa1111bbbb2222',
      computed_at: FACT_COMPUTED_AT,
    };
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      ...makeMockResult(),
      analysisReady: dispatchAnalysisReady,
      freshness: dispatchFreshness,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111ccf1',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.analysis_ready).toBeDefined();
    // Freshness wire fields
    expect(body.analysis_ready.freshness).toBe('fresh');
    expect(body.analysis_ready.freshness_reason).toBe('graph_hash_match');
    expect(body.analysis_ready.graph_hash_at_run).toBe('aaaa1111bbbb2222');
    expect(body.analysis_ready.current_graph_hash).toBe('aaaa1111bbbb2222');
    // Selected-fact computed_at — NOT Date.now. Proves attachComputedAt
    // is using the derivation's timestamp instead of restamping.
    expect(body.analysis_ready.computed_at).toBe(FACT_COMPUTED_AT);
  });

  it('chip_click run_analysis with stale freshness → wire response shows divergent hashes', async () => {
    // Wire-side inspection of the stale verdict. UI uses analysis_ready.
    // freshness === 'stale' to render the staleness pill (separate UI brief).
    const FACT_COMPUTED_AT = '2026-04-29T08:00:00.000Z';
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      ...makeMockResult(),
      analysisReady: {
        status: 'ready' as const,
        goal_node_id: 'goal_revenue',
        options: [{ option_id: 'opt_a', label: 'A', status: 'ready', interventions: {} }],
      },
      freshness: {
        freshness: 'stale' as const,
        reason: 'graph_hash_diverged' as const,
        selected_fact_index: 0,
        graph_hash_at_run: 'old_hash________',
        current_graph_hash: 'new_hash________',
        computed_at: FACT_COMPUTED_AT,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111ccf2',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.analysis_ready.freshness).toBe('stale');
    expect(body.analysis_ready.graph_hash_at_run).toBe('old_hash________');
    expect(body.analysis_ready.current_graph_hash).toBe('new_hash________');
    expect(body.analysis_ready.graph_hash_at_run).not.toBe(body.analysis_ready.current_graph_hash);
    expect(body.analysis_ready.computed_at).toBe(FACT_COMPUTED_AT);
  });

  it('chip_click run_analysis without freshness → wire response stamps Date.now ISO (legacy path)', async () => {
    // Backwards-compat: a dispatcher that doesn't surface freshness still
    // produces a valid analysis_ready with a wire-emit-time computed_at.
    // Catches regressions where the legacy code path stops working.
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      ...makeMockResult(),
      analysisReady: {
        status: 'ready' as const,
        goal_node_id: 'g',
        options: [{ option_id: 'opt_a', label: 'A', status: 'ready', interventions: {} }],
      },
      // No `freshness` field — exercises the no-derivation branch.
    });
    const before = new Date().toISOString();
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111ccf3',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    const after = new Date().toISOString();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.analysis_ready.freshness).toBeUndefined();
    expect(body.analysis_ready.computed_at >= before).toBe(true);
    expect(body.analysis_ready.computed_at <= after).toBe(true);
  });

  it('chip_click run_analysis without analysisReady → wire response omits analysis_ready (finaliser tolerates absence)', async () => {
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce(makeMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc03',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect('analysis_ready' in body).toBe(false);
  });

  it('source=chip (inline chip metadata on a normal message) → NOT dispatched, falls through to TurnExecutor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc02',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'User typed this with a chip',
        turn_class: 'propose',
        source: 'chip',
        chip: { action_type: 'run_analysis' },
      },
    });
    // Chip-click shortcut not invoked — Sonnet routing WAS invoked.
    expect(dispatchChipClickRunAnalysisMock).not.toHaveBeenCalled();
    // Either 200 (Sonnet text_only) or 500 (session env gap). What matters
    // is the branch decision.
    expect([200, 500]).toContain(res.statusCode);
  });

  it('chip_click + unregistered action_type (set_factor_value) → NOT dispatched, falls through', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc03',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: 'set factor X to 0.5',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'set_factor_value' },
      },
    });
    expect(dispatchChipClickRunAnalysisMock).not.toHaveBeenCalled();
    // Falls through to TurnExecutor. The wire path for unsupported
    // action_type is covered by the existing tests/integration/
    // orchestrate-v2-unsupported-action.test.ts — we only assert here
    // that our chip-click shortcut did NOT intercept.
  });

  it('chip_click without chip object → NOT dispatched (no action_type to shortcut on)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc04',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
      },
    });
    // v0.7.0 schema allows chip to be absent. Without chip.action_type, the
    // chip-click shortcut cannot fire and falls through to TurnExecutor.
    expect(dispatchChipClickRunAnalysisMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('chip_click run_analysis commit failure → 500 BoundaryError', async () => {
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'commit_failed',
      response: makeMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc05',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('chip_click_run_analysis_commit_failed');
  });

  it('chip_click run_analysis handler throws → 500 BoundaryError', async () => {
    dispatchChipClickRunAnalysisMock.mockRejectedValueOnce(new Error('handler blew up'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc06',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('chip_click_run_analysis_handler_threw');
  });

  it('typed handler_failure outcome → 500 with cause_kind preserved', async () => {
    // Dispatcher caught HandlerInvocationFailedError and returned a
    // discriminated outcome. The route must surface cause_kind + retryable
    // on the BoundaryError wire shape so observability and clients can
    // distinguish PLoT-timeout from scenario-read-failure.
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'handler_failure',
      response: makeMockResult().response,
      commitPerformed: false,
      causeKind: 'plot_timeout',
      retryable: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc07',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('chip_click_run_analysis_handler_failed');
    expect(body.details.cause_kind).toBe('plot_timeout');
    expect(body.details.retryable).toBe(true);
    expect(body.retryable).toBe(true);
  });

  it('typed handler_result_invalid outcome → 500 retryable:false', async () => {
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'handler_result_invalid',
      response: makeMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc08',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('chip_click_run_analysis_handler_result_invalid');
    expect(body.details.retryable).toBe(false);
    expect(body.retryable).toBe(false);
  });

  it('chip_click at stage=frame with decision-keyword message → chip wins over draft_graph', async () => {
    // Regression for the reordering fix: if both triggers would match
    // (chip_click + decision-brief shape), the chip branch must fire first.
    // Without this, a user who clicked the "Run analysis" chip early in the
    // flow would accidentally invoke the unified pipeline.
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce(makeMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111cc09',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        // Message is both long enough AND contains decision keywords —
        // would match DRAFT_GRAPH_DECISION_BRIEF_REGEX if the ordering
        // were wrong.
        message: 'Should we launch the new product this quarter or delay?',
        turn_class: 'frame',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchChipClickRunAnalysisMock).toHaveBeenCalledTimes(1);
  });
});
