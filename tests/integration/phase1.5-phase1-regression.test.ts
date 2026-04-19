/**
 * Phase 1.5 — Phase 1 regression suite (D6 Suite 4).
 *
 * Re-runs the core Phase 1 scenarios through the Phase 1.5 threaded path to
 * assert no regressions on the validator + seven-step executor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: {}, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

function toolUseResult(input: unknown, orientationText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (orientationText) content.push({ type: 'text', text: orientationText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi.fn<
      (a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>
    >().mockResolvedValue(result),
  };
}

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'do something',
  turn_class: 'frame',
  stage: 'frame',
};

function mkConfiguredGraph(): GraphStateIngress {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'Expand' },
      { id: 'fac_1', kind: 'factor', label: 'Demand' },
    ],
    edges: [{ from: 'fac_1', to: 'goal_1', strength: { mean: 0.5, std: 0.1 } }],
    options: [{ id: 'opt_a', status: 'ready', interventions: { fac_1: { value: 1 } } }],
  } as unknown as GraphStateIngress;
}

describe('Phase 1.5 — Phase 1 regression', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => setTestSink(null));

  it('text_only converse still works with graph threaded', async () => {
    const routingAdapter = mockAdapter(textResult('Here is what I see in your model.'));
    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-reg-conv', {
      routingAdapter,
      graphState: mkConfiguredGraph(),
    });
    OlumiResponseSchema.parse(response);
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.intent_class).toBe('converse');
    expect(telemetry.commit_performed).toBe(true);
    // Validate did not run — text_only doesn't go through VALIDATE.
    expect(telemetry.stages_completed).not.toContain('validate');
    // Old stage name must stay absent.
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
  });

  it('clarify intent still works (graph threaded)', async () => {
    const routingAdapter = mockAdapter(
      toolUseResult({
        intent_class: 'clarify',
        clarification: { ambiguity_type: 'entity', question: 'Which option?' },
      }),
    );
    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-reg-clar', {
      routingAdapter,
      graphState: mkConfiguredGraph(),
    });
    OlumiResponseSchema.parse(response);
    expect(telemetry.turn_class).toBe('clarify');
    expect(telemetry.intent_class).toBe('clarify');
  });

  it('execute success path with full graph + precondition passes', async () => {
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'Expand',
            },
            parameters: [],
            cited_context_fields: ['graph.options'],
          },
        },
        'Running analysis',
      ),
    );
    const registry = new Map([
      [
        'run_analysis',
        async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 }),
      ],
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-reg-exec', {
      routingAdapter,
      handlerRegistry: registry,
      graphState: mkConfiguredGraph(),
    });
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.validation_error_code).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).toContain('execute');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_no_graph');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
  });

  it('frame-stage turn without a graph still emits validate_skipped_no_graph (Phase 1 frame path preserved)', async () => {
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running',
      ),
    );
    const registry = new Map([
      [
        'run_analysis',
        async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 }),
      ],
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];
    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-reg-frame', {
      routingAdapter,
      handlerRegistry: registry,
      // no graphState
    });

    expect(telemetry.stages_completed).toContain('validate_skipped_no_graph');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
  });
});
