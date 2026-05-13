/**
 * Phase 2b — route-level integration test for the explain_results /
 * what_would_flip chip-click deterministic dispatch.
 *
 * Scope:
 *   - source='chip_click' + chip.action_type='explain_results' dispatches
 *     deterministically — bypasses Sonnet ORIENT.
 *   - Same for 'what_would_flip'.
 *   - Anthropic adapter is NEVER invoked on the deterministic path
 *     (assert via spy on `getAdapter` + zero LLM-tool calls).
 *
 * What this complements `route-v2-chip-click.test.ts`:
 *   That suite mocks `dispatchChipClickRunAnalysis` directly and asserts
 *   end-to-end finalisation for the run_analysis branch. THIS suite
 *   exercises the FULL real-code path (no dispatcher mock) for the new
 *   Phase 2b whitelist entries, with the handlers stubbed at the registry
 *   seam so we can pin the wire response shape without spinning up PLoT.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

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

// Spy on the LLM adapter so we can assert zero Anthropic-adapter calls
// on the deterministic chip-click path. The adapter is the lowest-level
// boundary; spying here covers any future code path that adds a Sonnet
// call without going through `routeWithToolUse`.
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: (...args: unknown[]) => {
      llmAdapterChatSpy(...args);
      return Promise.resolve({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } });
    },
    chatWithTools: (...args: unknown[]) => {
      llmAdapterChatWithToolsSpy(...args);
      return Promise.resolve({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: (...args: unknown[]) => {
        llmAdapterChatSpy(...args);
        return Promise.resolve({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } });
      },
      chatWithTools: (...args: unknown[]) => {
        llmAdapterChatWithToolsSpy(...args);
        return Promise.resolve({
          content: [{ type: 'text', text: 'text-only response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
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

// Mock the session store so commit succeeds without a real DB.
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

  it("chip_click + action_type='explain_results' → handler dispatches with NO Sonnet routing, NO Anthropic-adapter calls", async () => {
    explainResultsHandlerMock.mockResolvedValueOnce({
      assistant_text:
        'No analysis has been run on your model yet. Your model has 0 options set up and is ready to analyse. Would you like me to run the analysis?',
      handler_facts: [
        {
          fact_type: 'explain_results' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: true,
            option_count: 0,
            answer_source: 'precondition_template',
            fallback_reason: null,
            answer_text_length: 168,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });

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
      },
    });

    expect(res.statusCode).toBe(200);
    expect(explainResultsHandlerMock).toHaveBeenCalledTimes(1);
    // Canonical Phase 2b assertion — no Sonnet routing call.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    // Belt-and-braces — no LLM adapter calls at all (the dispatcher does
    // not enrich explanation handlers, so the adapter must stay quiet).
    expect(llmAdapterChatSpy).not.toHaveBeenCalled();
    expect(llmAdapterChatWithToolsSpy).not.toHaveBeenCalled();
    // Other registered handlers are not consulted.
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();

    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('No analysis has been run');
  });

  it("chip_click + action_type='what_would_flip' → handler dispatches with NO Sonnet routing, NO Anthropic-adapter calls", async () => {
    whatWouldFlipHandlerMock.mockResolvedValueOnce({
      assistant_text:
        'No analysis has been run on your model yet. Your model has 0 options set up and is ready to analyse. Would you like me to run the analysis?',
      handler_facts: [
        {
          fact_type: 'what_would_flip' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: true,
            option_count: 0,
            answer_source: 'precondition_template',
            fallback_reason: null,
            answer_text_length: 168,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });

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
      },
    });

    expect(res.statusCode).toBe(200);
    expect(whatWouldFlipHandlerMock).toHaveBeenCalledTimes(1);
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    expect(llmAdapterChatSpy).not.toHaveBeenCalled();
    expect(llmAdapterChatWithToolsSpy).not.toHaveBeenCalled();
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();
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
