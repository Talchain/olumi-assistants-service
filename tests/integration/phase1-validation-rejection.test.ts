/**
 * Phase 1 — Validation rejection (Suite B).
 *
 * Validation failures produce typed errors; the handler is never invoked;
 * BI-01 holds. Uses an injected graphLookup so validation runs (Phase 1a
 * production path skips validation when graph isn't threaded; this suite
 * proves validation DOES work when present).
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

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');
const { HandlerInvocationFailedError } = await import('../../src/orchestrator-v5/tools/handler-errors.js');

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: '33333333-3333-4333-8333-333333333333',
  scenario_id: '44444444-4444-4444-8444-444444444444',
  message: 'analyse something',
  turn_class: 'decide',
  stage: 'analyse',
};

function toolCall(input: unknown): ChatWithToolsResult {
  return {
    content: [
      { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
    ] as ToolResponseBlock[],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

function expectBI01(): void {
  const started = events.filter((e) => e.event === 'turn_executor.started');
  const completed = events.filter((e) => e.event === 'turn_executor.completed');
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  expect(completed[0]!.data.response_emitted).toBe(true);
}

describe('phase 1 validation rejection — no handler invocation, BI-01 preserved', () => {
  it('ENTITY_NOT_FOUND → typed failure response, handler never called', async () => {
    const handlerSpy = vi.fn();
    const registry = new Map([
      ['run_analysis', (async () => { handlerSpy(); throw new Error('should not run'); }) as never],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const routingAdapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolCall({
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt-missing',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: [],
          },
        }),
      ),
    };

    const graphLookup = {
      findEntityById: () => null, // nothing in graph
      listEntitiesByKind: () => [],
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-vr1', {
      routingAdapter,
      handlerRegistry: registry,
      graphLookup,
    });

    OlumiResponseSchema.parse(response);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
    expect(telemetry.validation_error_code).toBe('ENTITY_NOT_FOUND');
    expect(telemetry.commit_performed).toBe(false);
    expect(telemetry.stages_completed).not.toContain('execute');
    expect(telemetry.stages_completed).not.toContain('compose');
    expectBI01();
  });

  it('ENTITY_KIND_MISMATCH → typed failure response, handler never called', async () => {
    const handlerSpy = vi.fn();
    const registry = new Map([
      ['run_analysis', (async () => { handlerSpy(); throw new Error('should not run'); }) as never],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const routingAdapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolCall({
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'n-1',
              kind: 'node', // run_analysis only accepts option/goal
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: [],
          },
        }),
      ),
    };

    const graphLookup = {
      findEntityById: () => ({ id: 'n-1', kind: 'node' as never, label: 'Cost' }),
      listEntitiesByKind: () => [],
    };

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-vr2', {
      routingAdapter,
      handlerRegistry: registry,
      graphLookup,
    });

    expect(handlerSpy).not.toHaveBeenCalled();
    expect(telemetry.validation_error_code).toBe('ENTITY_KIND_MISMATCH');
    expectBI01();
  });

  it('unknown handler_id → HANDLER_NOT_FOUND typed failure response', async () => {
    const routingAdapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolCall({
          intent_class: 'execute',
          action: {
            handler_id: 'no_such_handler',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: [],
          },
        }),
      ),
    };

    const graphLookup = {
      findEntityById: () => ({ id: 'opt_a', kind: 'option' as never, label: 'A' }),
      listEntitiesByKind: () => [],
    };

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-vr3', {
      routingAdapter,
      graphLookup,
    });

    expect(telemetry.validation_error_code).toBe('HANDLER_NOT_FOUND');
    expectBI01();
  });

  it('handler invocation failure AFTER validation pass still emits typed response + BI-01', async () => {
    // Sanity: validation can pass and handler can still fail for other reasons.
    const registry = new Map([
      ['run_analysis', (async () => { throw new HandlerInvocationFailedError('plot_error', 'PLoT returned error: boom'); }) as never],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const routingAdapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolCall({
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
        }),
      ),
    };

    const graphLookup = {
      findEntityById: () => ({ id: 'opt_a', kind: 'option' as never, label: 'A' }),
      listEntitiesByKind: () => [{ id: 'opt_a', label: 'A' }],
    };

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-vr4', {
      routingAdapter,
      handlerRegistry: registry,
      graphLookup,
    });

    expect(telemetry.validation_error_code).toBeNull(); // validation passed
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
    expectBI01();
  });
});
