/**
 * Containment integration test for the option-intervention misroute guard
 * (task_99f83f0d).
 *
 * Proves end-to-end that when the model proposes a structurally-valid
 * set_factor_value on a SHARED factor but the user's message implies an
 * OPTION-specific intervention edit, the turn-executor refuses the mutation:
 * no handler runs, the graph is unchanged, and the turn recovers as a clarify
 * direct_answer (200) with no "0.05"/value leak.
 *
 * Control: the SAME mocked proposal with a plain factor-edit message (no
 * option reference) still applies — proving the guard does not regress the
 * legitimate LLM-proposed set_factor_value path
 * (see set-factor-value.integration.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from '../../../__tests__/fixtures.js';

import { setTestSink } from '../../../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../../adapters/llm/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

const appendCalls: Array<{ graph?: unknown; handler_id?: unknown }> = [];
vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown; handler_id?: unknown }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
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

const { runTurnExecutor } = await import('../../../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// buildD1Fixture() includes an option node `o-launch` labelled "Launch now"
// and a factor `f-churn` (0.04). The mocked proposal targets the FACTOR;
// the message frames it as an OPTION's intervention.
const SET_FACTOR_VALUE_TOOL_CALL = {
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
        value: { value: 5, unit: '%', cap: 100 },
        operator: 'set',
        source: 'user_explicit',
        unit: '%',
      },
    ],
    cited_context_fields: ['graph.nodes'],
  },
};

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
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

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('option-intervention misroute guard via runTurnExecutor', () => {
  it('refuses set_factor_value when the message implies an option intervention — graph unchanged, clarify direct_answer', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(SET_FACTOR_VALUE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      scenario_id: TEST_SCENARIO_ID,
      // "revise" is not a deterministic edit verb and there is no bare
      // numeric, so the pre-route skips and the mocked LLM proposal is what
      // reaches the execute chokepoint. "option" + "intervention" + the
      // option label all trip the guard.
      message: "revise the Launch now option so its churn intervention is lower",
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-misroute-1', {
      routingAdapter,
      graphState: ingressGraph,
    });

    // 1. Recovered as a clarify direct_answer — NOT a handler turn.
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();

    // 2. The handler NEVER executed (no mutation could have occurred).
    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).toContain('validator_recovery');
    expect(telemetry.stages_completed).not.toContain('execute');

    // 3. No applied graph_patch surfaced to the UI.
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toBeUndefined();

    // 4. Clarify copy, with no value leak.
    expect(response.assistant_text).toContain("option's intervention");
    expect(response.assistant_text.toLowerCase()).toContain("haven't changed anything");
    expect(response.assistant_text).not.toContain('0.05');
    expect(response.assistant_text).not.toContain('5%');

    // 5. The shared factor is unchanged on the ingress graph.
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);

    // 6. Nothing committed as a set_factor_value mutation.
    for (const call of appendCalls) {
      expect(call.handler_id).not.toBe('set_factor_value');
    }
  });

  it('covers the DETERMINISTIC pre-route producer too: a synthesized set_factor_value with an option-referencing message is refused without calling the LLM', async () => {
    // "set <factor> to 5%" is a deterministic value-update phrasing, so the
    // pre-route synthesizes the set_factor_value proposal itself and the LLM
    // must NOT be consulted. The same execute chokepoint guards it. A
    // throwing adapter proves the LLM path is never taken.
    const throwingRoutingAdapter = {
      chatWithTools: vi.fn(async () => {
        throw new Error('routing LLM must not be called on the deterministic path');
      }),
    };
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      scenario_id: TEST_SCENARIO_ID,
      message: 'set Customer churn to 5% for the Launch now option',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-misroute-det', {
      routingAdapter: throwingRoutingAdapter,
      graphState: ingressGraph,
    });

    // Deterministic path — the LLM was never called.
    expect(telemetry.llm_calls_used).toBe(0);
    expect(throwingRoutingAdapter.chatWithTools).not.toHaveBeenCalled();

    // Still refused: no handler ran, graph unchanged, clarify direct_answer.
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).not.toContain('execute');
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toBeUndefined();
    expect(response.assistant_text).toContain("option's intervention");
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);
  });

  it('CONTROL: identical proposal with a plain factor-edit message still applies (no regression to the legitimate LLM path)', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(SET_FACTOR_VALUE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      scenario_id: TEST_SCENARIO_ID,
      // No "option"/"intervention" vocabulary and the option label "Launch
      // now" is absent → guard stays out of the way.
      message: 'update the customer churn factor',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-misroute-control', {
      routingAdapter,
      graphState: ingressGraph,
    });

    // Applies as a handler turn and mutates the factor.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('execute');
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({ operation: 'set_factor_value', target_id: 'f-churn', status: 'applied' });
    const committedGraph = appendCalls[0]?.graph as GraphV3T;
    expect(committedGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.05);
    expect(appendCalls[0]?.handler_id).toBe('set_factor_value');
  });
});
