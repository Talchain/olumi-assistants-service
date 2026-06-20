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
