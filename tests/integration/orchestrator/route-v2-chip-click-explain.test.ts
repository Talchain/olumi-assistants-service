/**
 * F2 CHANGE A — route-level integration test for the explain_results /
 * what_would_flip chip-click COACH routing (post-whitelist-removal).
 *
 * HISTORY: these two pills USED to dispatch deterministically (no Sonnet, no
 * conversation sight). F2 removed them from `DETERMINISTIC_CHIP_ACTION_TYPES`
 * so they now route through the conversation-aware coach with a FORCED
 * explanation intent. The former "no Sonnet routing" assertions were the RED
 * this change flips — they are inverted below.
 *
 * Scope:
 *   - source='chip_click' + chip.action_type='explain_results' routes through
 *     `routeWithToolUse` with `forcedExplanationHandlerId='explain_results'`,
 *     thinking disabled, tool_choice forced, and the PINNED explanation handler
 *     runs (the coach cannot re-route the typed pill).
 *   - Same for 'what_would_flip'.
 *   - F1 synergy: the coach explanation answer is SUBSTANTIVE, so the wire body
 *     auto-shapes under the #618 egress inversion (`_answer_shape` present).
 *   - set_factor_value (not whitelisted, not an explanation intent) is NOT
 *     forced and does NOT trigger the explanation handlers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

// A minimal analysable graph sent on the wire. Because no canonical graph is
// persisted (the store mock has no loadGraphAndBriefText), TurnExecutor hashes
// THIS ingress graph for the freshness verdict. Seeding the prior run_analysis
// fact's `graph_hash_at_run` to the SAME hash makes freshness 'fresh', so the
// deterministic stale-rerun / no-analysis guards pass the turn through to the
// coach — the F2 path under test.
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'opt-b', kind: 'option', label: 'Option B' },
    { id: 'fac-1', kind: 'factor', label: 'Delivery time' },
  ],
  edges: [
    { from: 'fac-1', to: 'opt-a' },
    { from: 'fac-1', to: 'opt-b' },
  ],
};
const FRESH_GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH_STATE as never);

const {
  routeWithToolUseSpy,
  llmAdapterChatSpy,
  llmAdapterChatWithToolsSpy,
  explainResultsHandlerMock,
  whatWouldFlipHandlerMock,
  runAnalysisHandlerMock,
  loadScenarioSnapshotForRunAnalysisMock,
  appendMock,
} = vi.hoisted(() => ({
  routeWithToolUseSpy: vi.fn(),
  llmAdapterChatSpy: vi.fn(),
  llmAdapterChatWithToolsSpy: vi.fn(),
  explainResultsHandlerMock: vi.fn(),
  whatWouldFlipHandlerMock: vi.fn(),
  runAnalysisHandlerMock: vi.fn(),
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  appendMock: vi.fn().mockResolvedValue({ id: 'mock-row-id' }),
}));

// Spy on the routing layer entry point — the canonical "no Sonnet
// classification" assertion. Tests that exercise the chip-click bypass
// MUST observe zero calls.
vi.mock('../../../src/orchestrator-v5/routing/route-with-tool-use.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/routing/route-with-tool-use.js')
  >();
  return {
    ...actual,
    routeWithToolUse: (...args: unknown[]) => {
      routeWithToolUseSpy(...args);
      return (actual.routeWithToolUse as unknown as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// F2 CHANGE A — the coach adapter now RETURNS an olumi_action tool_use so the
// forced explanation intent routes through the full coach → explanation-handler
// path. The tool_use deliberately proposes `explain_from_structure` (a DIFFERENT
// explanation handler) with a distinctive multi-sentence answer; a green test
// therefore proves (a) the coach was called on the pill path, and (b) the
// handler_id is PINNED to the forced intent regardless of what the model chose.
const COACH_ANSWER =
  'Your leading option is currently ahead on the analysis you just ran. ' +
  'That lead is driven mostly by the delivery-time factor you mentioned. ' +
  'It is a moderately robust result, so it is worth sanity-checking the key assumptions.';

function coachToolUseResponse() {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_coach',
        name: 'olumi_action',
        input: {
          intent_class: 'execute',
          action: {
            handler_id: 'explain_from_structure',
            entity: {
              id: 'opt-a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'context_inference',
            },
            parameters: [],
            cited_context_fields: [],
            explanation: { answer_text: COACH_ANSWER },
          },
        },
      },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
    model: 'test-model',
    latencyMs: 5,
  };
}

vi.mock('../../../src/adapters/llm/router.js', () => {
  const chatWithTools = (...args: unknown[]) => {
    llmAdapterChatWithToolsSpy(...args);
    return Promise.resolve(coachToolUseResponse());
  };
  const chat = (...args: unknown[]) => {
    llmAdapterChatSpy(...args);
    return Promise.resolve({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } });
  };
  const adapter = { name: 'test', model: 'test-model', chat, chatWithTools };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({
      adapter,
      resolution: {
        task: 'narrate',
        resolved_model: 'test-model',
        resolution_source: 'task_default' as const,
      },
    }),
    getMaxTokensFromConfig: () => undefined,
  };
});

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// Mock the session store so commit succeeds without a real DB. A prior
// successful run_analysis fact is seeded so the deterministic no-analysis guard
// (which honestly short-circuits an analytical question when NO analysis has
// ever run) does NOT claim the turn — that lets the forced explanation pill
// reach the coach, which is the F2 path under test.
const PRIOR_RUN_ANALYSIS_FACT = {
  fact_type: 'run_analysis' as const,
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: '33333333-3333-4333-8333-333333333333',
    leading_option_id: 'opt-a',
    summary: 'prior analysis',
    enrichment: { analysis_status: 'complete' },
    // Matches the ingress graph hash → freshness resolves 'fresh'.
    graph_hash_at_run: FRESH_GRAPH_HASH,
    computed_at: '2026-04-30T02:00:00.000Z',
  },
};
const PRIOR_TURN_ROW = {
  id: 'row-prior-1',
  scenario_id: '33333333-3333-4333-8333-333333333333',
  user_id: null,
  turn_id: 'prior-turn-1',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-1',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: '2026-04-30T01:00:00.000Z',
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete.',
};
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    // A prior turn is required so build-turn-context's fact loader does not
    // early-return empty (prior_facts is gated on prior_turns being non-empty).
    readRecent: async () => [PRIOR_TURN_ROW],
    readFactsFor: async () => [PRIOR_RUN_ANALYSIS_FACT],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Mock the persisted-graph load → no graph in this scenario. The
// projection-input builder in the dispatcher will see persistedGraph=null
// and the explanation handler will hit the precondition-fail branch (no
// prior analysis fact). That's the integration shape we're asserting
// against — the WIRE behaviour is what matters, not the internal data.
vi.mock('../../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/build-turn-context.js')
  >();
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
  };
});

// Mock the registry so handler invocations are observable and predictable.
vi.mock('../../../src/orchestrator-v5/tools/registry.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/tools/registry.js')
  >();
  const registry = new Map<string, unknown>([
    ['run_analysis', runAnalysisHandlerMock],
    ['explain_results', explainResultsHandlerMock],
    ['what_would_flip', whatWouldFlipHandlerMock],
  ]);
  return {
    ...actual,
    getDefaultRegistry: () => registry,
    createRegistry: () => registry,
    resolveHandler: (reg: Map<string, unknown>, id: string) => reg.get(id) ?? null,
  };
});

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

describe('POST /orchestrate/v2/turn — Phase 2b chip-click explanation dispatch', () => {
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
    routeWithToolUseSpy.mockClear();
    llmAdapterChatSpy.mockClear();
    llmAdapterChatWithToolsSpy.mockClear();
    explainResultsHandlerMock.mockReset();
    whatWouldFlipHandlerMock.mockReset();
    runAnalysisHandlerMock.mockReset();
    appendMock.mockClear();
    // Production path's persisted-graph load — return null (frame-stage
    // no graph) so the projection-input builder sets analysisReady to
    // undefined and the handler's no-graph branch runs.
    loadScenarioSnapshotForRunAnalysisMock.mockReset();
  });

  // Explanation handler mocks: on the ROUTED path the handler receives the
  // coach's validated `explanation.answer_text` and returns it as its
  // substantive assistant_text (this is what the real explain_results /
  // what_would_flip handlers do on the happy path). Multi-sentence so the F1
  // egress inversion shapes it.
  function explanationOutcome(factType: 'explain_results' | 'what_would_flip') {
    return {
      assistant_text: COACH_ANSWER,
      handler_facts: [
        {
          fact_type: factType,
          fact_version: 1,
          noop: false,
          result: { answer_source: 'sonnet_answer_text', answer_text_length: COACH_ANSWER.length },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    };
  }

  it("chip_click + action_type='explain_results' → routes through the coach with a FORCED intent (no deterministic bypass) and auto-shapes", async () => {
    explainResultsHandlerMock.mockResolvedValueOnce(explanationOutcome('explain_results'));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '44444444-4444-4444-8444-44444444cc01',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Please explain the analysis result in plain language.',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'explain_results' },
        graph_state: GRAPH_STATE,
      },
    });

    expect(res.statusCode).toBe(200);
    // F2 CHANGE A — the coach IS called now (the RED this change flips).
    expect(routeWithToolUseSpy).toHaveBeenCalledTimes(1);
    // Forced explanation intent threaded into routeWithToolUse.
    const routeOptions = routeWithToolUseSpy.mock.calls[0]![2] as {
      forcedExplanationHandlerId?: string;
    };
    expect(routeOptions.forcedExplanationHandlerId).toBe('explain_results');
    // The coach LLM ran (adapter tool call), with thinking disabled + tool forced.
    expect(llmAdapterChatWithToolsSpy).toHaveBeenCalled();
    const adapterArgs = llmAdapterChatWithToolsSpy.mock.calls[0]![0] as {
      thinking?: unknown;
      tool_choice?: unknown;
    };
    expect(adapterArgs.thinking).toEqual({ type: 'disabled' });
    expect(adapterArgs.tool_choice).toEqual({ type: 'tool', name: 'olumi_action' });
    // Handler PINNED to the pill's intent even though the model proposed
    // explain_from_structure — the pill answers the pill.
    expect(explainResultsHandlerMock).toHaveBeenCalledTimes(1);
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();

    const body = JSON.parse(res.body);
    expect(body.assistant_text.length).toBeGreaterThan(0);
    // F1 synergy (#618 egress inversion): the substantive coach answer auto-shapes.
    expect(body._answer_shape).toBeDefined();
    expect(body._answer_shape.headline).toBeTruthy();
    expect(body._answer_shape.detail).toBeTruthy();
  });

  it("chip_click + action_type='what_would_flip' → routes through the coach with a FORCED intent and auto-shapes", async () => {
    whatWouldFlipHandlerMock.mockResolvedValueOnce(explanationOutcome('what_would_flip'));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '44444444-4444-4444-8444-44444444cc02',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'What could change the outcome of this analysis?',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'what_would_flip' },
        graph_state: GRAPH_STATE,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(routeWithToolUseSpy).toHaveBeenCalledTimes(1);
    const routeOptions = routeWithToolUseSpy.mock.calls[0]![2] as {
      forcedExplanationHandlerId?: string;
    };
    expect(routeOptions.forcedExplanationHandlerId).toBe('what_would_flip');
    expect(llmAdapterChatWithToolsSpy).toHaveBeenCalled();
    // Handler PINNED to what_would_flip (model proposed explain_from_structure).
    expect(whatWouldFlipHandlerMock).toHaveBeenCalledTimes(1);
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();

    const body = JSON.parse(res.body);
    expect(body._answer_shape).toBeDefined();
  });

  it("chip_click + action_type='set_factor_value' (NOT whitelisted) → does NOT use the deterministic dispatcher", async () => {
    // Mutation handler is excluded from the whitelist because the routed
    // path provides validated proposal parameters that the chip-click path
    // cannot reconstruct. The route must NOT call the explanation handlers
    // on this path; whether it then routes via Sonnet or short-circuits
    // (depends on `detectChipClickResumeIntent`) is downstream of Phase 2b.

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '44444444-4444-4444-8444-44444444cc03',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Set marketing to 0.7',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'set_factor_value' },
      },
    });

    // 200 or 500 is acceptable here — the test's point is that the
    // explanation handlers are NOT triggered by an unwhitelisted action_type.
    expect([200, 500]).toContain(res.statusCode);
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();
  });
});
