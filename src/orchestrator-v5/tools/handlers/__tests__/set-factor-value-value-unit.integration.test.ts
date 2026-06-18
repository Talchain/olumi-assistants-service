/**
 * P0-A value/unit fail-closed containment — integration test via
 * `runTurnExecutor`.
 *
 * Proves end-to-end that "Set <£ factor> to 5 agents" (the live Gate-6
 * failure, where a £200k factor silently became £5) is now REFUSED at the
 * execute chokepoint: no handler runs, the graph is byte-unchanged, and the
 * turn recovers as a clarify direct_answer (200). The same machinery the #279
 * misroute guard uses (recoverable-validator path, commit with no graph).
 *
 * Controls:
 *   - A compatible currency edit ("to £50,000") still applies — the guard does
 *     not regress legitimate factor-value edits.
 *   - An option-intervention message still routes to OPTION_INTERVENTION_MISROUTE
 *     (its copy), proving #279 precedence is preserved (it is checked first).
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

// A routing adapter that throws — proves the deterministic pre-route handles
// the value-update without ever consulting the LLM (the production path that
// produced the live coercion).
const throwingRoutingAdapter = {
  chatWithTools: vi.fn(async () => {
    throw new Error('routing LLM must not be called on the deterministic path');
  }),
};

// An option-intervention misroute proposal, mocked because "revise … option"
// is not a deterministic edit verb (mirrors the #279 integration test).
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
  throwingRoutingAdapter.chatWithTools.mockClear();
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('value/unit fail-closed containment via runTurnExecutor', () => {
  it('REFUSES "Set Marketing budget to 5 agents" — graph byte-unchanged, no handler, clarify direct_answer', async () => {
    const ingressGraph = buildD1Fixture();
    const budgetBefore = JSON.stringify(ingressGraph.nodes.find((n) => n.id === 'f-budget'));

    const payload = makeMessagePayload({
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: TEST_SCENARIO_ID,
      // Deterministic value-update phrasing; "agents" (a headcount unit) is
      // dropped by CQE and would otherwise coerce the £ factor to £5.
      message: 'set Marketing budget to 5 agents',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-vu-1', {
      routingAdapter: throwingRoutingAdapter,
      graphState: ingressGraph,
    });

    // Deterministic path — the LLM was never called.
    expect(telemetry.llm_calls_used).toBe(0);
    expect(throwingRoutingAdapter.chatWithTools).not.toHaveBeenCalled();

    // Recovered as a clarify direct_answer; the handler never ran.
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).not.toContain('execute');

    // No applied graph_patch surfaced to the UI.
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toBeUndefined();

    // Clarify copy, with no coerced "£5"/"5" value leaking.
    expect(response.assistant_text.toLowerCase()).toContain("haven't changed anything");
    expect(response.assistant_text).not.toContain('£5');

    // The £ factor is byte-unchanged (NOT coerced to raw_value 5 / value ~0).
    expect(JSON.stringify(ingressGraph.nodes.find((n) => n.id === 'f-budget'))).toBe(budgetBefore);
    expect(ingressGraph.nodes.find((n) => n.id === 'f-budget')?.observed_state?.raw_value).toBe(40000);

    // Nothing committed as a set_factor_value mutation.
    for (const call of appendCalls) {
      expect(call.handler_id).not.toBe('set_factor_value');
    }
  });

  it('CONTROL: a compatible currency edit "to £50,000" still applies (no regression)', async () => {
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      scenario_id: TEST_SCENARIO_ID,
      message: 'set Marketing budget to £50,000',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-vu-2', {
      routingAdapter: throwingRoutingAdapter,
      graphState: ingressGraph,
    });

    // Applies as a handler turn and mutates the factor (50,000 / 100,000 = 0.5).
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('execute');
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({ operation: 'set_factor_value', target_id: 'f-budget', status: 'applied' });
    const committedGraph = appendCalls[0]?.graph as GraphV3T;
    expect(committedGraph.nodes.find((n) => n.id === 'f-budget')?.observed_state?.value).toBe(0.5);
  });

  it('CONTROL: a bare ratio edit on an untyped factor still applies (guard inert without a factor unit)', async () => {
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      scenario_id: TEST_SCENARIO_ID,
      // f-quality has no stored unit; "0.8" is a clean ratio.
      message: 'set Product quality to 0.8',
    });

    const { telemetry } = await runTurnExecutor(payload, 'req-vu-3', {
      routingAdapter: throwingRoutingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('execute');
    const committedGraph = appendCalls[0]?.graph as GraphV3T;
    expect(committedGraph.nodes.find((n) => n.id === 'f-quality')?.observed_state?.value).toBe(0.8);
  });

  it('#279 PRECEDENCE: an option-intervention message still routes to the misroute guard, not value/unit', async () => {
    // The misroute guard is checked FIRST; an option-intervention edit must
    // stay classified as misroute (its copy), proving the new guard does not
    // shadow #279.
    const SET_FACTOR_VALUE_TOOL_CALL = {
      intent_class: 'execute',
      action: {
        handler_id: 'set_factor_value',
        entity: { id: 'f-churn', kind: 'node', label: 'Customer churn', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [{ name: 'value', value: { value: 5, unit: '%', cap: 100 }, operator: 'set', source: 'user_explicit', unit: '%' }],
        cited_context_fields: ['graph.nodes'],
      },
    };
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(SET_FACTOR_VALUE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddee',
      scenario_id: TEST_SCENARIO_ID,
      message: "revise the Launch now option so its churn intervention is lower",
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-vu-279', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).not.toContain('execute');
    // Misroute copy, not the value/unit copy.
    expect(response.assistant_text).toContain("option's intervention");
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);
  });
});
