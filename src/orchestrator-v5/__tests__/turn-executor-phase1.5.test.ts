/**
 * TurnExecutor unit tests — Phase 1.5 graph threading.
 *
 * Verifies the executor correctly:
 *   - threads graphState into the ContextPack
 *   - threads analysisState via compactAnalysis
 *   - derives GraphLookup via buildGraphLookup when a graph is present
 *   - emits validate_skipped_no_graph telemetry ONLY when no graph is threaded
 *   - populates routing log with graph counts + hash
 *   - never emits the old `validate_skipped_graph_checks` stage
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { RoutingLog } from '../routing/routing-log.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: {}, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

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

function mockRoutingAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi.fn<
      (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
    >().mockResolvedValue(result),
  };
}

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'analyse options',
  turn_class: 'frame',
  stage: 'frame',
};

const RUN_ANALYSIS_PROPOSAL_OPT_A = {
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

/**
 * Real-ish graph with options + interventions — passes run_analysis precondition.
 */
function mkGraphWithConfiguredOptions(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximize Profit' },
      { id: 'opt_a', kind: 'option', label: 'Expand EU' },
      { id: 'fac_1', kind: 'factor', label: 'Market Size' },
    ],
    edges: [
      { from: 'fac_1', to: 'goal_1', strength: { mean: 0.8, std: 0.1 } },
    ],
    options: [
      {
        id: 'opt_a',
        interventions: {
          fac_1: { value: 0.7, source: 'user_specified' },
        },
      },
    ],
  } as unknown as GraphV3T;
}

type TelemetryEvent = { event: string; data: Record<string, unknown> };

describe('TurnExecutor — Phase 1.5 graph threading', () => {
  let events: TelemetryEvent[];
  beforeEach(() => {
    events = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
    delete process.env.TURN_BUDGET_MS;
  });
  afterEach(() => setTestSink(null));

  it('does NOT emit validate_skipped_no_graph when graphState is threaded', async () => {
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'Running analysis...'),
    );
    const handlerRegistry = new Map([
      [
        'run_analysis',
        (async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 })) as never,
      ],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-1', {
      routingAdapter,
      handlerRegistry,
      graphState: mkGraphWithConfiguredOptions(),
    });

    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_no_graph');
    // Regression guard: old leaky stage name must not re-appear
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
    expect(telemetry.commit_performed).toBe(true);
  });

  it('emits validate_skipped_no_graph when no graphState is threaded (frame stage)', async () => {
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'Running analysis...'),
    );
    const handlerRegistry = new Map([
      [
        'run_analysis',
        (async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 })) as never,
      ],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-2', {
      routingAdapter,
      handlerRegistry,
      // no graphState
    });

    expect(telemetry.stages_completed).toContain('validate_skipped_no_graph');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
  });

  it('routing log carries graph_node_count, graph_edge_count, graph_hash when graph threaded', async () => {
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'Running analysis...'),
    );
    const handlerRegistry = new Map([
      [
        'run_analysis',
        (async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 })) as never,
      ],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const logs: RoutingLog[] = [];
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-3', {
      routingAdapter,
      handlerRegistry,
      graphState: mkGraphWithConfiguredOptions(),
      routingLogWriter: async (r) => {
        logs.push(r);
      },
    });

    // Fire-and-forget — wait a microtask for the async writer.
    await new Promise((r) => setImmediate(r));

    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.graph_node_count).toBe(3);
    expect(log.graph_edge_count).toBe(1);
    expect(log.graph_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('routing log carries zero counts + null hash on frame-stage turn', async () => {
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'Running analysis...'),
    );
    const handlerRegistry = new Map([
      [
        'run_analysis',
        (async () => ({ assistant_text: 'done', handler_facts: [], llm_calls_used: 1 })) as never,
      ],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const logs: RoutingLog[] = [];
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-4', {
      routingAdapter,
      handlerRegistry,
      routingLogWriter: async (r) => {
        logs.push(r);
      },
    });
    await new Promise((r) => setImmediate(r));

    expect(logs[0]!.graph_node_count).toBe(0);
    expect(logs[0]!.graph_edge_count).toBe(0);
    expect(logs[0]!.graph_hash).toBeNull();
  });

  it('precondition fires on a real graph with no intervention data — PRECONDITION_UNMET', async () => {
    // Graph has an option node but no configured interventions in options[].
    const graphMissingInterventions: GraphV3T = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Expand' },
      ],
      edges: [],
    } as unknown as GraphV3T;

    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'Running analysis...'),
    );
    const { telemetry, response } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-5', {
      routingAdapter,
      graphState: graphMissingInterventions,
    });

    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    expect(telemetry.commit_performed).toBe(false);
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');

    // User-facing text stays generic — the specific reason surfaces only in
    // structured block details so the UI can render it per handler.
    const r = response as {
      assistant_text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(r.assistant_text).not.toContain('options_lack_intervention_data');
    expect(r.assistant_text).not.toContain('no_options_defined');
    // Structured block carries the machine-readable reason for UI routing.
    const errBlock = r.blocks.find((b) => b.type === 'error') as
      | { details?: { reason?: string } }
      | undefined;
    expect(errBlock?.details?.reason).toBe('options_lack_intervention_data');
  });

  it('ENTITY_NOT_FOUND fires when Sonnet proposes an id absent from the graph', async () => {
    const graph = mkGraphWithConfiguredOptions();
    const bogusProposal = {
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'does_not_exist',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: [],
      },
    };
    const routingAdapter = mockRoutingAdapter(mkToolUseResult(bogusProposal, 'Running...'));

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-6', {
      routingAdapter,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_NOT_FOUND');
    expect(telemetry.commit_performed).toBe(false);
  });
});
