/**
 * Phase 1 — C2 regression through new seven-step flow (Suite D).
 *
 * Proves the Phase 1 refactor preserves the C2 run_analysis integration:
 *   - HandlerOutcome shape unchanged (fact persists end-to-end)
 *   - append_turn_atomic contract unchanged
 *   - Handler contract (HandlerInvocation → HandlerOutcome) unchanged
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

const appendCalls: Array<unknown> = [];
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { createRegistry } = await import('../../src/orchestrator-v5/tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: '77777777-7777-4777-8777-777777777777',
  scenario_id: '88888888-8888-4888-8888-888888888888',
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
};

function toolResult(input: unknown): ChatWithToolsResult {
  return {
    content: [
      { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
    ] as ToolResponseBlock[],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 30,
  };
}

function goldenPlotResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.6 },
      { option_id: 'opt_b', option_label: 'B', win_probability: 0.4 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
}

function scenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

function mockPlot(): PLoTClient {
  return {
    run: vi.fn(async () => goldenPlotResponse()),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
});

describe('phase 1 C2 regression — run_analysis via tool-use produces same HandlerOutcome shape', () => {
  it('produces the same handler_facts shape as the pre-refactor C2 path', async () => {
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          toolResult({
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
              cited_context_fields: ['graph.options'],
            },
          }),
        ),
    };

    const registry = createRegistry({
      plotClient: mockPlot(),
      scenarioReader: async () => scenarioSnapshot(),
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-c2r', {
      routingAdapter,
      handlerRegistry: registry,
    });

    OlumiResponseSchema.parse(response);

    // Fact persists with the same pre-refactor shape: single run_analysis
    // fact, handler_id='run_analysis', turn_class='handler'.
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0] as {
      handler_id: string;
      turn_class: string;
      handler_facts: Array<{ fact_type: string; result: { enrichment: V2RunResponseEnvelope } }>;
    };
    expect(write.handler_id).toBe('run_analysis');
    expect(write.turn_class).toBe('handler');
    expect(write.handler_facts).toHaveLength(1);
    expect(write.handler_facts[0]!.fact_type).toBe('run_analysis');
  });

  it('enrichment is preserved byte-for-byte through tool-use → handler → fact', async () => {
    const plotResponse = goldenPlotResponse();
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          toolResult({
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

    const registry = createRegistry({
      plotClient: {
        run: vi.fn(async () => plotResponse),
        validatePatch: vi.fn().mockResolvedValue({}),
      } as unknown as PLoTClient,
      scenarioReader: async () => scenarioSnapshot(),
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-c2r2', {
      routingAdapter,
      handlerRegistry: registry,
    });

    const write = appendCalls[0] as {
      handler_facts: Array<{ result: { enrichment: V2RunResponseEnvelope & Record<string, unknown> } }>;
    };
    // v5-maintenance: TurnExecutor's V5 Group 1 Task C adds
    // coaching_signal_{id,turn_id,produced_at} to enrichment for
    // run_analysis. Strip those coaching fields before the byte-for-byte
    // equality check so this regression guard (PLoT → enrichment
    // passthrough) still holds without mis-firing on coaching-signal noise.
    const { coaching_signal_id, coaching_signal_turn_id, coaching_signal_produced_at, ...enrichmentWithoutCoaching } =
      write.handler_facts[0]!.result.enrichment as Record<string, unknown>;
    void coaching_signal_id; // eslint-disable-line @typescript-eslint/no-unused-vars
    void coaching_signal_turn_id;
    void coaching_signal_produced_at;
    expect(enrichmentWithoutCoaching).toEqual(plotResponse);
  });
});
