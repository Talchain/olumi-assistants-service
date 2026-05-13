/**
 * Route-level integration test for the central egress entity-ID leak guard.
 *
 * Confirms — through real Fastify inject — that a leaked entity ID in a
 * dispatcher's response is sanitised at `sendFinalised200` before reaching
 * the wire body. Uses the chip-click dispatch path because it has the
 * lightest mock surface (single dispatcher mock; no LLM round-trip needed).
 *
 * This is the route-level companion to the unit-level coverage in
 * `src/orchestrator-v5/compose/__tests__/output-safety.test.ts` and the
 * envelope-level integration in
 * `src/orchestrator-v5/__tests__/route-v2-output-safety.test.ts`. It
 * specifically guards against a future refactor that drops the
 * `sanitiseOlumiResponseForEgress` call from `sendFinalised200` — the unit
 * tests would still pass, but this test would not.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { GraphV3T } from '../../../src/orchestrator/types.js';

const dispatchChipClickRunAnalysisMock = vi.fn();

// Phase 2b — route-v2 calls `dispatchDeterministicChipClick`. Forward
// run_analysis through the existing mock so this suite's contract is preserved.
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: dispatchChipClickRunAnalysisMock,
  dispatchDeterministicChipClick: async (actionType: string, params: unknown) => {
    if (actionType === 'run_analysis') return dispatchChipClickRunAnalysisMock(params);
    throw new Error(`unexpected action_type in test mock: ${actionType}`);
  },
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

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_delivery_cost', kind: 'factor', label: 'Delivery Cost' },
      { id: 'opt_offshore_partner', kind: 'option', label: 'Offshore Partner' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

describe('POST /orchestrate/v2/turn — central egress entity-ID leak guard', () => {
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
    appendMock.mockClear();
  });

  it('wire body strips raw entity IDs from assistant_text and chips before egress', async () => {
    // Dispatcher returns a polluted response: assistant_text + a chip both
    // carry raw `fac_delivery_cost` and `opt_offshore_partner`. The graph
    // is in scope on the dispatch result, so the central sanitiser should
    // resolve both to their human labels.
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'ok' as const,
      commitPerformed: true,
      response: {
        response_version: 2 as const,
        assistant_text:
          'Ran analysis. fac_delivery_cost dominates and opt_offshore_partner is the runner-up.',
        blocks: [],
        suggested_actions: [
          {
            id: 'chip_explain',
            label: 'Explain why fac_delivery_cost matters',
            message: 'Explain how fac_delivery_cost shapes the result.',
            action_type: 'explain_result',
          },
        ],
        insights: [],
        stage_indicator: 'analyse',
      },
      graph: makeGraph(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111ee01',
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

    // Wire-level invariant: no raw fac_*/opt_*/etc. IDs in user-visible text.
    expect(body.assistant_text).not.toContain('fac_delivery_cost');
    expect(body.assistant_text).not.toContain('opt_offshore_partner');
    expect(body.assistant_text).toContain('Delivery Cost');
    expect(body.assistant_text).toContain('Offshore Partner');

    // Chip label/message scrubbed; id/action_type machine-protected.
    expect(body.suggested_actions[0].id).toBe('chip_explain');
    expect(body.suggested_actions[0].action_type).toBe('explain_result');
    expect(body.suggested_actions[0].label).not.toContain('fac_delivery_cost');
    expect(body.suggested_actions[0].label).toContain('Delivery Cost');
    expect(body.suggested_actions[0].message).not.toContain('fac_delivery_cost');
    expect(body.suggested_actions[0].message).toContain('Delivery Cost');
  });

  it('wire body falls back to prefix-aware generic when graph=null on the dispatch result', async () => {
    // Confirms that even when the dispatcher cannot supply a graph (e.g.
    // scenario snapshot load failure on chip-click), the central guard
    // still strips the raw ID via the slug-shape heuristic.
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'ok' as const,
      commitPerformed: true,
      response: {
        response_version: 2 as const,
        assistant_text: 'Ran analysis. fac_unknown_node is the lever.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse',
      },
      graph: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111ee02',
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
    expect(body.assistant_text).not.toContain('fac_unknown_node');
    expect(body.assistant_text).toContain('the relevant factor');
  });
});
