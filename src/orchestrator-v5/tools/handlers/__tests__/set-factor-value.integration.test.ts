/**
 * Golden-path integration test for set_factor_value.
 *
 * Proves: Sonnet's tool-use proposal → validator passes → handler executes →
 * graph mutates → response carries graph_patch block → fact emitted →
 * mutated graph reaches commit (NOT the ingress) → turn_class === 'handler',
 * NOT 'direct_answer'. This is the single most important test that A3
 * actually unblocked action turns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../../adapters/llm/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

// Capture session-store writes so we can assert the commit graph.
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
// V5 explain-stabilisation Task 4 ships a deterministic value-update
// pre-route that intercepts plain "Set X to N" phrasings before Sonnet
// (returning clarify chips). The intended D1 dispatch happens on the
// next turn, when the chip's message reaches Sonnet. We simulate that
// follow-up turn here: the user's message is a chip-click style prompt
// (no bare "set/increase" verb on a numeric to dodge the pre-route's
// CQE pattern), and Sonnet emits the structured set_factor_value
// proposal. This proves the proposal → handler → mutation → commit
// chain end-to-end.
const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'update the customer churn factor',
  turn_class: 'frame',
  stage: 'frame',
};

const SET_FACTOR_VALUE_TOOL_CALL = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
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
  return {
    chatWithTools: vi.fn(impl as never),
  };
}

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('set_factor_value end-to-end via runTurnExecutor', () => {
  it('Sonnet proposal → handler → graph mutated and committed, response carries graph_patch block', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(SET_FACTOR_VALUE_TOOL_CALL),
    );
    const ingressGraph = buildD1Fixture();

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-d1-int-1', {
      routingAdapter,
      graphState: ingressGraph,
    });

    // 1. Routed as a handler turn, NOT direct_answer.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);

    // 2. Stages include execute + commit.
    expect(telemetry.stages_completed).toContain('execute');
    expect(telemetry.stages_completed).toContain('commit');

    // 3. Response carries an `assistant_text` in decision language.
    expect(response.assistant_text).toContain('Customer churn');
    expect(response.assistant_text).toContain('5%');
    expect(response.assistant_text).not.toContain('0.05');

    // 4. Response carries a `graph_patch` block so UI can update canvas.
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeDefined();
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'f-churn',
      status: 'applied',
    });

    // 5. Commit received the MUTATED graph, not the ingress.
    expect(appendCalls).toHaveLength(1);
    const committedGraph = appendCalls[0].graph as GraphV3T;
    expect(committedGraph).toBeDefined();
    const committedChurn = committedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(committedChurn?.observed_state?.value).toBe(0.05);
    expect(committedChurn?.observed_state?.raw_value).toBe(5);
    // Ingress unchanged.
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);

    // 6. handler_id stamped on the commit.
    expect(appendCalls[0].handler_id).toBe('set_factor_value');
  });
});
