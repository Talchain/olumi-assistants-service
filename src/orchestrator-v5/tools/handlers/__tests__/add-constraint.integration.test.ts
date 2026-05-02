/**
 * Golden-path integration test for add_constraint via runTurnExecutor.
 * Mirrors set-factor-value.integration.test.ts; proves the proposal →
 * handler → mutation → response → commit chain end-to-end for the
 * second D1 handler.
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
const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'add a constraint to the customer churn factor',
  turn_class: 'frame',
  stage: 'frame',
};

const ADD_CONSTRAINT_TOOL_CALL = {
  intent_class: 'execute',
  action: {
    handler_id: 'add_constraint',
    entity: {
      id: 'f-churn',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
      { name: 'value', value: 5, source: 'user_explicit' },
      { name: 'unit', value: '%', source: 'user_explicit' },
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
  return { chatWithTools: vi.fn(impl as never) };
}

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('add_constraint end-to-end via runTurnExecutor', () => {
  it('Sonnet proposal → handler → goal_constraints persisted, response carries graph_patch block', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(ADD_CONSTRAINT_TOOL_CALL),
    );
    const ingressGraph = buildD1Fixture();

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-d1-c-1', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.stages_completed).toContain('execute');
    expect(telemetry.stages_completed).toContain('commit');

    expect(response.assistant_text).toContain('at most 5%');
    expect(response.assistant_text).not.toMatch(/0\.05/);

    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'add_constraint',
      status: 'applied',
    });

    const committedGraph = appendCalls[0].graph as GraphV3T;
    expect(committedGraph.goal_constraints).toHaveLength(1);
    expect(committedGraph.goal_constraints![0]).toMatchObject({
      node_id: 'f-churn',
      operator: '<=',
      value: 5,
      unit: '%',
    });
    expect(appendCalls[0].handler_id).toBe('add_constraint');
  });
});
