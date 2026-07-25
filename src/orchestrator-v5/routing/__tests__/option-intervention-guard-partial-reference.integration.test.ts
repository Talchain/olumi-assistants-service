/**
 * DEFECT 1, at the execute chokepoint — the USER-VISIBLE failure.
 *
 * Live on deployed staging `a833276` (scenario 908dabc0-…, 2026-07-25):
 * "Running the pop-up pilot reduces Capital Investment in Leeds Site to
 * £20,000" was answered with "Updated Capital Investment in Leeds Site from
 * 0 to 20,000 GBP." and the SHARED factor every option reads was mutated
 * 0 → 20000, while the named option's own intervention was left untouched.
 *
 * The producer was the LLM router (the deterministic pre-route exits earlier
 * on `no_edit_verb` for that phrasing), so the guard that had to catch it is
 * the one at the turn-executor execute chokepoint — the single point both
 * the LLM and deterministic producers converge on. This test drives that
 * exact path: a mocked router proposes `set_factor_value` on the shared
 * factor while the user's message references an option only PARTIALLY.
 *
 * Asserted here is the user-visible contract, not an internal predicate:
 *   • no handler executes,
 *   • the factor is byte-unchanged,
 *   • the turn recovers as a clarify direct_answer.
 *
 * Mirrors the #279 integration case in
 * `tools/handlers/__tests__/set-factor-value-value-unit.integration.test.ts`,
 * which pins the same contract for the FULL-vocabulary phrasing that already
 * worked. This file pins the partial-reference phrasing that did not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

/**
 * The misroute the LLM router produced live: the option framing is dropped
 * and the SHARED factor is named as the target. It validates — the factor is
 * a real, correctly-kinded entity — so only the guard can stop it.
 */
const SET_FACTOR_VALUE_ON_SHARED_FACTOR = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
      label: 'Customer churn',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 2, unit: '%', cap: 100 },
        operator: 'set',
        source: 'user_explicit',
        unit: '%',
      },
    ],
    cited_context_fields: ['graph.nodes'],
  },
};

beforeEach(() => {
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('DEFECT 1 — partial option reference at the execute chokepoint', () => {
  /**
   * The fixture's only option is labelled "Launch now". "Launching" is a
   * morphological variant of its distinctive token and the message contains
   * NO "option"/"intervention" vocabulary and NOT the full label — precisely
   * the shape that fell through live.
   */
  it('REFUSES a partial option reference — no handler, factor byte-unchanged, clarify', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(SET_FACTOR_VALUE_ON_SHARED_FACTOR),
    );
    const ingressGraph = buildD1Fixture();
    const churnBefore = JSON.stringify(ingressGraph.nodes.find((n) => n.id === 'f-churn'));

    const payload = makeMessagePayload({
      turn_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
      scenario_id: TEST_SCENARIO_ID,
      message: 'Launching reduces Customer churn to 2%',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-partial-ref-1', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.stages_completed).not.toContain('execute');
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(response.assistant_text).toContain("option's intervention");
    // The shared factor every option reads is untouched.
    expect(JSON.stringify(ingressGraph.nodes.find((n) => n.id === 'f-churn'))).toBe(churnBefore);
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);
  });

  /**
   * NEGATIVE CONTROL — the discriminating half. Same graph, same proposal,
   * same target factor; the ONLY change is that the message no longer
   * references the option. This must still APPLY, or the guard has stopped
   * containing a misroute and started blocking all factor editing.
   */
  it('a genuine factor edit with no option reference still EXECUTES', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(SET_FACTOR_VALUE_ON_SHARED_FACTOR),
    );
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
      scenario_id: TEST_SCENARIO_ID,
      message: 'Customer churn is now 2%',
    });

    const { telemetry } = await runTurnExecutor(payload, 'req-partial-ref-2', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.stages_completed).toContain('execute');
  });
});
