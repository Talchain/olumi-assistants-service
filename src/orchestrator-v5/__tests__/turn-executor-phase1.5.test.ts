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

import { makeMessagePayload } from './fixtures.js';

import { log, setTestSink } from '../../utils/telemetry.js';
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

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'analyse options',
});

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
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];

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
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];

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
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];

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
    ]) as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['handlerRegistry'];

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

    // V5 alpha hardening Phase 2.2: validator outcomes are recoverable —
    // PRECONDITION_UNMET routes through commitDirectAnswer to HTTP 200
    // with a clean coaching body. The validator still fires the typed
    // code (tracked below) but the turn recovers.
    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('direct_answer');

    const r = response as {
      assistant_text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(r.assistant_text).not.toContain('no_options_defined');
    // Clean body: no error block — this is the recoverable shape.
    expect(r.blocks.find((b) => b.type === 'error')).toBeUndefined();
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

  it('BI-01 preserved when graph_lookup telemetry emit throws (exactly-one-response)', async () => {
    // Regression guard: the graph-lookup derivation was previously outside
    // the try block — a throw from emit() could have orphaned the started
    // event without a completed. Now it's inside try/finally so every
    // started has a matching completed.
    let startedCount = 0;
    let completedCount = 0;
    let throwOnce = true;
    setTestSink((eventName) => {
      if (eventName === 'turn_executor.graph_lookup' && throwOnce) {
        throwOnce = false;
        throw new Error('synthetic emit failure');
      }
      if (eventName === 'turn_executor.started') startedCount += 1;
      if (eventName === 'turn_executor.completed') completedCount += 1;
    });

    const routingAdapter = mockRoutingAdapter(mkTextResult('hi'));
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-bi01', { routingAdapter }).catch(
      () => {
        /* swallow: turn may fail, but BI-01 is about event pairing */
      },
    );

    // Started may or may not have fired (depends on event ordering), but
    // if it did, completed MUST have matched. BI-01 is: started count ≤
    // completed count. Zero emits is fine (emit itself failed); orphaned
    // started is not.
    expect(completedCount).toBeGreaterThanOrEqual(startedCount);
  });

  it('P1-3 (round 3): test_override path emits graph_lookup telemetry with zero stats', async () => {
    // When a test injects options.graphLookup directly, the adapter is
    // bypassed — but the event must still fire so per-turn observability
    // is complete. Stats are zero because there's no adapter-level payload.
    const mockLookup = {
      findEntityById: () => null,
      listEntitiesByKind: () => [],
    };
    const routingAdapter = mockRoutingAdapter(mkTextResult('hi'));
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-test-override-tel', {
      routingAdapter,
      graphLookup: mockLookup,
    });
    const glEvent = events.find((e) => e.event === 'turn_executor.graph_lookup');
    expect(glEvent).toBeDefined();
    expect(glEvent!.data.outcome).toBe('test_override');
    expect(glEvent!.data.total_nodes).toBe(0);
    expect(glEvent!.data.mapped_nodes).toBe(0);
  });

  it('Imp-1 (round 3): routing log carries graph_lookup_outcome + zero-default counts', async () => {
    // no_graph path: all count fields should be 0 (not null) so analytics
    // don't need COALESCE wrappers; graph_lookup_outcome categorises the turn.
    const routingAdapter = mockRoutingAdapter(mkTextResult('frame hello'));
    const logs: RoutingLog[] = [];
    await runTurnExecutor(BASE_PAYLOAD, 'req-p15-log-outcome', {
      routingAdapter,
      routingLogWriter: async (r) => {
        logs.push(r);
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(logs[0]!.graph_lookup_outcome).toBe('no_graph');
    expect(logs[0]!.graph_mapped_nodes).toBe(0);
    expect(logs[0]!.graph_dropped_by_unknown_kind).toBe(0);
    expect(logs[0]!.graph_dropped_by_missing_id).toBe(0);
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
    const logs: RoutingLog[] = [];
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

  it('P1-2 (round 3): normaliseResults converts object-shaped results to real array (no as-cast)', async () => {
    // A compatibility payload where `results` is a keyed map. Previously we
    // defaulted to [] (data loss) or cast to unknown[] (type lie). Now
    // Object.values() yields a proper array that compactAnalysis can iterate.
    const analysisWithObjectResults = {
      analysis_status: 'complete',
      meta: { seed_used: 1, n_samples: 100, response_hash: 'abc' },
      results: {
        opt_1: { option_id: 'opt_1', label: 'A', win_probability: 0.6 },
        opt_2: { option_id: 'opt_2', label: 'B', win_probability: 0.4 },
      },
    } as unknown as AnalysisStateIngress;
    const routingAdapter = mockRoutingAdapter(mkTextResult('analysis summary'));
    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p12-obj-norm', {
      routingAdapter,
      analysisState: analysisWithObjectResults,
    });
    // Must not throw; compactAnalysis sees both option records.
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
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

  // AMENDED 2026-07-27 (entity-kind repair). The guard is unchanged in
  // purpose — a hallucinated kind must never aim a handler at a node class it
  // cannot serve — but the graph's kind is now ADOPTED rather than treated as
  // a fatal disagreement. So the end-to-end rejection case is stated against a
  // target run_analysis genuinely cannot serve (a factor, which resolves to
  // wire kind 'node'), and the "same id, wrong label" case is asserted
  // separately to land. See routing/__tests__/entity-kind-repair.test.ts.
  const KIND_GUARD_GRAPH: GraphStateIngress = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'A' },
      { id: 'fac_x', kind: 'factor', label: 'Factor X' },
    ],
    edges: [],
    options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
  } as GraphStateIngress;

  it('P0-1: validator rejects kind mismatch with ENTITY_KIND_MISMATCH (LLM hallucination guard)', async () => {
    // Sonnet claims kind='option' on an id that resolves to a factor.
    // run_analysis accepts ['option','goal'] and the graph says 'node', so the
    // proposal is refused — on what the entity ACTUALLY is, not on the
    // disagreement. Without the graph being consulted at all this would pass
    // structural checks and reach the handler pointing at the wrong node class.
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'fac_x', // the id resolves to a factor → wire kind 'node'
              kind: 'option', // but LLM claims option
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'Factor X',
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
      graphState: KIND_GUARD_GRAPH,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_KIND_MISMATCH');
    // V5 alpha hardening Phase 2.2: validator outcomes are recoverable —
    // the turn now commits as a direct_answer and returns 200.
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('direct_answer');
  });

  it('P0-1 (repair): a mislabelled kind on a servable target lands end-to-end', async () => {
    // The other half of the amendment: id resolves to an option, Sonnet calls
    // it a goal, run_analysis accepts 'option'. This used to be the refusal
    // case above; it must now reach the handler with the graph's kind.
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'goal', // mislabelled; the graph says option
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

    const infoSpy = vi.spyOn(log, 'info');
    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p15-kind-repair', {
      routingAdapter,
      graphState: KIND_GUARD_GRAPH,
    });

    // Scoped deliberately to the VALIDATOR verdict: the proposal is no longer
    // rejected on its kind. What run_analysis then does with it (it dispatches
    // for real and depends on analysis infrastructure this harness does not
    // stand up) is a different contract, covered elsewhere.
    expect(telemetry.validation_error_code).toBeNull();

    // The repair must be OBSERVABLE, not silent — it converts a user-visible
    // refusal into a success, so a rising repair rate has to be readable in
    // the logs (this is the channel the staging diagnosis was read from).
    const repairCall = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string } | undefined)?.event === 'v5.entity_kind_repaired',
    );
    expect(repairCall).toBeDefined();
    const repairPayload = repairCall![0] as Record<string, unknown>;
    expect(repairPayload.entity_id).toBe('opt_a');
    expect(repairPayload.proposed_kind).toBe('goal');
    expect(repairPayload.resolved_kind).toBe('option');
    expect(repairPayload.handler_id).toBe('run_analysis');
    // Privacy: enum kinds + ids only, never the user-authored label.
    expect(JSON.stringify(repairPayload)).not.toContain('"A"');
    infoSpy.mockRestore();
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
    // V5 alpha hardening Phase 2.2: validator outcomes are recoverable.
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('direct_answer');
  });
});
