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
import type {
  GraphStateIngress,
  AnalysisStateIngress,
} from '../boundary/request-extensions.js';
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

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }] as ToolResponseBlock[],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

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
function mkGraphWithConfiguredOptions(): GraphStateIngress {
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
        status: 'ready',
        interventions: {
          fac_1: { value: 0.7, source: 'user_specified' },
        },
      },
    ],
  } as GraphStateIngress;
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

  it('P0-1: precondition fires only when graph has NO option nodes (no_options_defined)', async () => {
    // Graph has a goal node but NO option nodes. Proposal targets the goal
    // (which exists) so we reach the precondition; the precondition must
    // then reject because no options are defined.
    const graphNoOptions: GraphStateIngress = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'fac_1', kind: 'factor', label: 'Demand' },
      ],
      edges: [],
    } as GraphStateIngress;

    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'goal_1',
              kind: 'goal',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'Profit',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running analysis...',
      ),
    );
    const { telemetry, response } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-5', {
      routingAdapter,
      graphState: graphNoOptions,
    });

    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    expect(telemetry.commit_performed).toBe(false);
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');

    const r = response as {
      assistant_text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(r.assistant_text).not.toContain('no_options_defined');
    const errBlock = r.blocks.find((b) => b.type === 'error') as
      | { details?: { reason?: string } }
      | undefined;
    expect(errBlock?.details?.reason).toBe('no_options_defined');
  });

  it('P0-2 all_dropped: graph with only unknown kinds fails the turn BEFORE routing', async () => {
    // Payload drift regression guard: a graph whose nodes have unknown kinds
    // must fail the turn (graph_payload_drift) rather than silently proceed
    // as "no graph" and bypass validator graph-dependent checks.
    const drifted: GraphStateIngress = {
      nodes: [
        { id: 'n1', kind: 'unseen_new_kind', label: 'N1' },
        { id: 'n2', kind: 'another_unseen', label: 'N2' },
      ],
      edges: [],
    } as GraphStateIngress;

    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A, 'should never be reached'),
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-drift', {
      routingAdapter,
      graphState: drifted,
    });

    // Routing adapter must NOT have been called — turn failed fast.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
    const r = response as {
      blocks: Array<{ type: string; details?: { reason?: string; total_nodes?: number } }>;
    };
    const errBlock = r.blocks.find((b) => b.type === 'error');
    expect(errBlock?.details?.reason).toBe('graph_payload_drift');
    expect(errBlock?.details?.total_nodes).toBe(2);
  });

  it('P1-1: no_graph outcome is emitted on frame-stage turns so skips are observable', async () => {
    const routingAdapter = mockRoutingAdapter(mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A));
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-no-graph-tel', {
      routingAdapter,
      // no graphState
    });
    const glEvent = events.find((e) => e.event === 'turn_executor.graph_lookup');
    expect(glEvent).toBeDefined();
    expect(glEvent!.data.outcome).toBe('no_graph');
    expect(glEvent!.data.total_nodes).toBe(0);
    expect(glEvent!.data.mapped_nodes).toBe(0);
  });

  it('P1-2: routing log preserves graph counts on all_dropped fail-fast', async () => {
    const drifted: GraphStateIngress = {
      nodes: [
        { id: 'n1', kind: 'nope_a', label: 'N1' },
        { id: 'n2', kind: 'nope_b', label: 'N2' },
        { id: 'n3', kind: 'nope_c', label: 'N3' },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    } as GraphStateIngress;
    const routingAdapter = mockRoutingAdapter(mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A));
    const logs: Array<Record<string, unknown>> = [];
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-fail-fast-counts', {
      routingAdapter,
      graphState: drifted,
      routingLogWriter: async (r) => {
        logs.push(r);
      },
    });
    await new Promise((r) => setImmediate(r));
    // Dashboards querying "turns with a graph payload" must see the real
    // ingress counts even when the turn failed before ContextPack assembly.
    expect(logs[0]!.graph_node_count).toBe(3);
    expect(logs[0]!.graph_edge_count).toBe(2);
    // Imp-2: adapter stats also surface in the log for triage.
    expect(logs[0]!.graph_mapped_nodes).toBe(0);
    expect(logs[0]!.graph_dropped_by_unknown_kind).toBe(3);
  });

  it('P1-3: coerceIngressAnalysis preserves object-shaped results instead of discarding', async () => {
    // A compatibility payload where `results` is an object rather than an
    // array. Prior coercion silently forced it to [] — hiding the LLM
    // from real analysis context. Current behaviour: pass through; compact
    // analysis handles it defensively.
    const analysisWithObjectResults = {
      analysis_status: 'complete',
      meta: { seed_used: 1, n_samples: 100, response_hash: 'abc' },
      // Object-shaped — non-canonical but should not be silently erased.
      results: { keyed: { option_id: 'x', label: 'X', win_probability: 0.7 } },
    } as unknown as AnalysisStateIngress;
    const routingAdapter = mockRoutingAdapter(mkTextResult('looking at analysis'));

    // Turn should complete without throwing — compactAnalysis is defensive
    // on non-array results. Key assertion: no uncaught TypeError / crash.
    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-obj-results', {
      routingAdapter,
      analysisState: analysisWithObjectResults,
    });
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
  });

  it('P0-2 all_dropped: telemetry event fires with drop stats (Imp-2)', async () => {
    const drifted: GraphStateIngress = {
      nodes: [{ id: 'n1', kind: 'nope', label: 'N' }],
      edges: [],
    } as GraphStateIngress;
    const routingAdapter = mockRoutingAdapter(mkToolUseResult(RUN_ANALYSIS_PROPOSAL_OPT_A));

    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-drift-tel', {
      routingAdapter,
      graphState: drifted,
    });

    const glEvent = events.find((e) => e.event === 'turn_executor.graph_lookup');
    expect(glEvent).toBeDefined();
    expect(glEvent!.data.outcome).toBe('all_dropped');
    expect(glEvent!.data.total_nodes).toBe(1);
    expect(glEvent!.data.mapped_nodes).toBe(0);
    expect(glEvent!.data.dropped_by_unknown_kind).toBe(1);
  });

  it('P0-1: validator rejects kind mismatch with ENTITY_KIND_MISMATCH (LLM hallucination guard)', async () => {
    // Graph has opt_a as kind='option'; Sonnet proposes kind='goal' on the
    // same id. Without the kind cross-check, this would pass structural
    // checks (run_analysis accepts both option and goal) and reach the
    // handler pointing at the wrong node class.
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'A' },
      ],
      edges: [],
      options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
    } as GraphStateIngress;

    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a', // the id resolves to an option
              kind: 'goal', // but LLM claims goal
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'A',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running',
      ),
    );

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-kind', {
      routingAdapter,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_KIND_MISMATCH');
    expect(telemetry.commit_performed).toBe(false);
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
