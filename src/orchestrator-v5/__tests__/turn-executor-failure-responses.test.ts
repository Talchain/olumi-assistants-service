/**
 * TurnExecutor × per-code failure responses — end-to-end wiring through the
 * seven-step flow.
 *
 * Asserts that:
 *   - Validation failures reach the per-code composer and emit specific text
 *   - Handler failures reach the per-cause composer with retryable → chip
 *   - `turn_executor.failure_response` telemetry is emitted with correct shape
 *   - No known error code / cause_kind hits the `fallback` template
 *   - BI-01 holds across every failure path
 *   - Success path response shape is unchanged (regression guard)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

const appendCalls: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import { PLoTTimeoutError } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
};

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
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

function ambiguousToolCallInput() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'run_analysis',
      entity: {
        id: 'opt_a',
        kind: 'option',
        resolution_status: 'ambiguous',
        resolution_method: 'label_match',
        candidates: [
          { id: 'opt_a', label: 'Plan A' },
          { id: 'opt_b', label: 'Plan B' },
        ],
      },
      parameters: [],
      cited_context_fields: ['graph.options'],
    },
  };
}

function resolvedRunAnalysisToolCall() {
  return {
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
  };
}

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Plan A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Plan B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

function makeGoldenResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [{ option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 }],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
}

function makeMockPlotClient(overrides?: Partial<{ run: PLoTClient['run'] }>): PLoTClient {
  const run = overrides?.run ?? vi.fn(async () => makeGoldenResponse());
  return {
    run,
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}
function expectBI01(): void {
  const started = events.filter((e) => e.event === 'turn_executor.started');
  const completed = events.filter((e) => e.event === 'turn_executor.completed');
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  expect(completed[0]!.data.response_emitted).toBe(true);
}
function failureResponseEvent(): Event | undefined {
  return events.find((e) => e.event === 'turn_executor.failure_response');
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  installSink();
});
afterEach(() => {
  uninstallSink();
  vi.restoreAllMocks();
});

describe('TurnExecutor — validation failure path', () => {
  it('ENTITY_RESOLUTION_AMBIGUOUS produces candidate chips and specific text', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(ambiguousToolCallInput(), 'Sorting your request.'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-amb', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    expect(result.response.assistant_text.toLowerCase()).toMatch(/which.*do you mean/i);
    expect(result.response.suggested_actions.length).toBeGreaterThan(0);
    expect(result.response.suggested_actions[0]?.label).toMatch(/Plan (A|B)/);

    const ev = failureResponseEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.failure_origin).toBe('validator');
    expect(ev!.data.error_code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
    expect(ev!.data.template_used).not.toBe('fallback');
    expect(ev!.data.chip_attached).toBe(true);
    expect(ev!.data.chip_type).toBe('entity_suggestion');

    expectBI01();
    expect(appendCalls.length).toBe(0);
  });

  it('emits INTERNAL_ERROR block with failure_origin=validator details', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(ambiguousToolCallInput(), ''),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-amb-2', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    const block = result.response.blocks[0];
    expect(block?.type).toBe('error');
    if (block?.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.details?.failure_origin).toBe('validator');
    }
  });
});

describe('TurnExecutor — handler failure path', () => {
  it('plot_timeout yields retry chip + retryable=true telemetry', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(resolvedRunAnalysisToolCall(), ''),
    );

    const plotClient = makeMockPlotClient({
      run: vi.fn(async () => {
        throw new PLoTTimeoutError('PLoT timed out', 30_000);
      }),
    });

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-timeout', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient,
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    expect(result.response.assistant_text).toMatch(/taking longer/i);
    expect(result.response.suggested_actions[0]?.label).toBe('Retry');
    expect(result.response.suggested_actions[0]?.action_type).toBe('run_analysis');

    const ev = failureResponseEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.failure_origin).toBe('handler');
    expect(ev!.data.error_code).toBe('plot_timeout');
    expect(ev!.data.retryable).toBe(true);
    expect(ev!.data.template_used).toBe('plot_timeout');
    expect(ev!.data.chip_type).toBe('action');

    expectBI01();
    expect(appendCalls.length).toBe(0);
  });

  it('options_not_configured (all interventions empty) yields specific chip', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(resolvedRunAnalysisToolCall(), ''),
    );

    const snapshot: RunAnalysisScenarioSnapshot = {
      graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Plan A', interventions: {} },
        { id: 'opt_b', option_id: 'opt_b', label: 'Plan B', interventions: {} },
      ],
      goal_node_id: 'g',
    };

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-opts', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => snapshot,
      }),
    });

    expect(result.response.assistant_text).toContain('Plan A');
    expect(result.response.suggested_actions[0]?.label).toContain('Plan A');

    const ev = failureResponseEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.error_code).toBe('options_not_configured');
    expect(ev!.data.template_used).toBe('options_not_configured_with_label');
    expect(ev!.data.retryable).toBe(false);
    expect(ev!.data.chip_type).toBe('text_prompt');
  });
});

describe('TurnExecutor — failure_response telemetry contract', () => {
  // Regression guard (I3): observability contract must not drift silently.
  // If these keys are renamed in turn-executor.ts, this test fails and the
  // author has to update the documented contract here deliberately.
  it('emits the canonical failure_response event keys on every failure path', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(ambiguousToolCallInput(), ''),
    );

    await runTurnExecutor(BASE_PAYLOAD, 'req-telemetry', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    const ev = failureResponseEvent();
    expect(ev).toBeDefined();
    const data = ev!.data;
    for (const key of [
      'failure_origin',
      'error_code',
      'template_used',
      'chip_attached',
      'chip_type',
    ]) {
      expect(data).toHaveProperty(key);
    }
    expect(typeof data.failure_origin).toBe('string');
    expect(typeof data.error_code).toBe('string');
    expect(typeof data.template_used).toBe('string');
    expect(typeof data.chip_attached).toBe('boolean');
    expect(['action', 'text_prompt', 'entity_suggestion', null]).toContain(
      data.chip_type,
    );
  });
});

describe('TurnExecutor — success path is unchanged', () => {
  it('happy-path tool-call still emits orientation + confirmation, no chips', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(resolvedRunAnalysisToolCall(), 'Running the analysis.'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ok', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    expect(result.response.suggested_actions).toEqual([]);
    // V5 Group 1 Task B: successful run_analysis now emits an analysis_result
    // block carrying the PLoT enrichment (and, when the auto-fire completed,
    // enrichment.decision_review). The assistant_text invariant is unchanged.
    expect(result.response.blocks).toHaveLength(1);
    expect(result.response.blocks[0]).toMatchObject({ type: 'analysis_result' });
    expect(result.response.assistant_text).toContain('Running the analysis.');
    expect(result.response.assistant_text).toContain('Ran analysis');

    expect(failureResponseEvent()).toBeUndefined();
    expectBI01();
  });
});
