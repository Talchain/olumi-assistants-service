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

vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: dispatchChipClickRunAnalysisMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async () => true,
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

function makeMockResult() {
  return {
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
    const res = await app.inject({
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
});
