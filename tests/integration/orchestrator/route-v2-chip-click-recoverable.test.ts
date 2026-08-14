/**
 * V5 C5 — route-v2 wire mapping for the chip-click `run_analysis`
 * recoverable-cause escape repair.
 *
 * Unit coverage (chip-click-dispatch-recoverable.test.ts) proves the dispatcher
 * produces the `handler_recovered` outcome for recoverable causes. THIS file
 * pins the route-v2 side: `handler_recovered` → HTTP 200 (graceful, no
 * BoundaryError), while `handler_failure` (fatal) → HTTP 500 unchanged. The
 * dispatcher is mocked so the test isolates the outcome→wire mapping.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

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

const dispatchChipClickRunAnalysisSpy = vi.fn();

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

function recoveredOlumiResponse() {
  return {
    response_version: 2 as const,
    assistant_text:
      "Options exist but don't have effects configured yet. Add intervention values to at least one option to proceed.",
    blocks: [] as const,
    suggested_actions: [
      {
        id: 'chip_prompt_configure_option_generic',
        label: 'Configure an option',
        message: 'Help me configure one of my options.',
      },
    ],
    insights: [] as const,
    stage_indicator: 'analyse' as const,
  };
}

/**
 * ROADMAP 2.1091 / golden-journey EXT-2 — the typed refusal the dispatcher
 * now returns on `handler_recovered`. Shaped exactly as
 * `buildAnalysisRefusalReadiness` builds it.
 */
function blockedReadiness(blockedReason: string) {
  return {
    // PRESENT-but-empty: both keys are REQUIRED at the boundary, and carrying
    // real option rows on a refusal was measured flipping the deployed
    // DecisionOverviewCard into a false "needs_input" state. See
    // `buildAnalysisRefusalReadiness`.
    options: [] as unknown[],
    goal_node_id: '',
    status: 'blocked' as const,
    blocked_reason: blockedReason,
  };
}

/** ROADMAP 2.1091 D2 — the derivation the dispatcher now returns alongside it. */
function staleFreshness() {
  return {
    freshness: 'stale' as const,
    reason: 'graph_hash_mismatch',
    selected_fact_index: 0,
    graph_hash_at_run: 'aaaa111122223333',
    current_graph_hash: 'bbbb444455556666',
    computed_at: '2026-08-13T19:07:44.000Z',
  };
}

function chipPayload(turnId: string) {
  return {
    kind: 'message' as const,
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'analyse' as const,
    message: 'Run analysis',
    turn_class: 'decide',
    source: 'chip_click' as const,
    chip: { action_type: 'run_analysis' },
    user_id: USER_ID,
  };
}

describe('route-v2 chip-click run_analysis — recoverable outcome → wire status', () => {
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
    dispatchChipClickRunAnalysisSpy.mockReset();
  });

  it('handler_recovered → HTTP 200 graceful (NOT 500), no BoundaryError wording', async () => {
    dispatchChipClickRunAnalysisSpy.mockResolvedValueOnce({
      outcome: 'handler_recovered' as const,
      response: recoveredOlumiResponse(),
      commitPerformed: false,
      causeKind: 'options_not_configured',
      analysisReady: blockedReadiness('options_not_configured'),
      freshness: staleFreshness(),
      graph: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: chipPayload('22222222-2222-4222-8222-222222222222'),
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).not.toContain('BoundaryError');
    expect(body).not.toContain('INTERNAL_ERROR');
    const parsed = JSON.parse(body) as { assistant_text?: string; suggested_actions?: unknown[] };
    expect(parsed.assistant_text && parsed.assistant_text.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.suggested_actions) && parsed.suggested_actions!.length).toBeGreaterThan(0);
  });

  /**
   * ROADMAP 2.1091 / golden-journey EXT-2 — THE WIRE-LEVEL PIN.
   *
   * The witnessed defect was a MISSING TOP-LEVEL KEY on the HTTP body, not a
   * missing field on a dispatch result. The dispatcher-level suite
   * (`chip-click-dispatch-blocked-readiness.test.ts`) proves the payload is
   * produced; only this test proves it survives route-v2's outcome mapping
   * and the finaliser and reaches the bytes a consumer parses.
   *
   * ⚠ `analysis_ready` is a TOP-LEVEL RESPONSE KEY. `analysis_result` is a
   * BLOCK TYPE. They are different levels and this test asserts the former.
   */
  it('handler_recovered → the wire body carries a TYPED analysis_ready with a specific blocked_reason (EXT-2)', async () => {
    dispatchChipClickRunAnalysisSpy.mockResolvedValueOnce({
      outcome: 'handler_recovered' as const,
      response: recoveredOlumiResponse(),
      commitPerformed: false,
      causeKind: 'analysis_not_ready',
      analysisReady: blockedReadiness('mixed_scale_unresolved'),
      freshness: staleFreshness(),
      graph: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: chipPayload('44444444-4444-4444-8444-444444444444'),
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as Record<string, unknown>;

    // The witnessed failure was the absence of this key entirely.
    expect(Object.keys(parsed)).toContain('analysis_ready');
    const ar = parsed.analysis_ready as {
      status?: string;
      blocked_reason?: string;
      options?: unknown[];
      goal_node_id?: string;
      computed_at?: string;
      freshness?: string;
      freshness_reason?: string;
      graph_hash_at_run?: string;
      current_graph_hash?: string;
    };
    expect(ar.status).toBe('blocked');
    // Bound by IDENTITY to the reason the producer declared — not to "some
    // non-empty string", which a generic fallback would also satisfy.
    expect(ar.blocked_reason).toBe('mixed_scale_unresolved');
    // PRESENT-but-empty carrier. Both keys must survive to the wire: they are
    // REQUIRED at the boundary and dropping either destroys the turn.
    expect(Object.keys(ar)).toContain('options');
    expect(Object.keys(ar)).toContain('goal_node_id');
    expect(ar.options).toEqual([]);
    expect(ar.goal_node_id).toBe('');
    // The finaliser — and only the finaliser — stamps computed_at.
    expect(typeof ar.computed_at).toBe('string');

    // ROADMAP 2.1091 D2 — the freshness fields must reach the wire. Without
    // them the deployed UI replaces a correct verdict with "cannot confirm
    // whether this analysis is current", so a refusal turn would degrade the
    // freshness strip as a side effect of reporting readiness honestly.
    expect(ar.freshness).toBe('stale');
    expect(ar.freshness_reason).toBe('graph_hash_mismatch');
    expect(ar.graph_hash_at_run).toBe('aaaa111122223333');
    expect(ar.current_graph_hash).toBe('bbbb444455556666');
    // computed_at comes from the SELECTED FACT, not wire-emit time.
    expect(ar.computed_at).toBe('2026-08-13T19:07:44.000Z');
  });

  it('handler_failure (fatal) → HTTP 500 unchanged (mapping stays outcome-gated)', async () => {
    dispatchChipClickRunAnalysisSpy.mockResolvedValueOnce({
      outcome: 'handler_failure' as const,
      response: recoveredOlumiResponse(),
      commitPerformed: false,
      causeKind: 'plot_error',
      retryable: true,
      graph: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: chipPayload('33333333-3333-4333-8333-333333333333'),
    });

    expect(res.statusCode).toBe(500);
  });
});
