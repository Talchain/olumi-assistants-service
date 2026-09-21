/**
 * Lane 20 — goal-target commit honesty on the TurnExecutor path.
 *
 * Two halves, both at the integration altitude lane 15's unit tests missed
 * (real merge/commit seam, store fake capturing the persisted graph — NOT a
 * unit mock of applyAndValidateMutation):
 *
 *  1. REACHABILITY / PERSISTENCE PIN — when a goal-target turn actually
 *     reaches the sanctioned writer (routing proposes `add_constraint`
 *     `at_least` on the goal), the REAL handler + STEP 7
 *     `mergeMutatedGraphForPersistence` + commit persist the full canonical
 *     contract: `goal_threshold_raw`/`_unit`/`_cap`/`goal_threshold` on the
 *     goal node AND the goal_constraints entry, with server-authoritative
 *     top-level fields intact — and the formatGoalTargetSet receipt ships
 *     UNTOUCHED (the honesty guard must not false-positive on a backed
 *     claim).
 *
 *  2. RECEIPT HONESTY GUARD (RED→GREEN) — a goal-target receipt whose
 *     committed graph does NOT register the target (goal node without
 *     `goal_threshold_raw` — the "merge seam stripped it / handler
 *     regressed" class) must be swapped for GOAL_TARGET_NOT_SAVED_TEXT
 *     before commit. Driven through a registry-injected handler emitting
 *     the receipt with a threshold-less mutated_graph, so the guard is
 *     proven at the STEP 7 chokepoint, not inside any one handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock (same pattern as
// turn-executor-d1-mutation-commit-graph.test.ts): append captures graph
// writes, loadGraph serves the persisted base for the STEP 7 strict read.
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { getDefaultRegistry } = await import('../tools/registry.js');
const { GOAL_TARGET_NOT_SAVED_TEXT, graphRegistersGoalTarget } = await import(
  '../compose/goal-target-receipt-guard.js'
);
const { formatGoalTargetSet } = await import(
  '../tools/handlers/d1-shared/format-confirmation.js'
);

// ---------------------------------------------------------------------------
// Fixtures — captured EXP-01 graphs (goal node: goal_q3_delivery).
// ---------------------------------------------------------------------------

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const SCENARIO_ID = '55df6984-7e5e-4207-a1d9-9ba14e6e7d2a';
const GOAL_NODE_ID = 'goal_q3_delivery';
const GOAL_LABEL = 'Meet Q3 Roadmap Commitments at Scale';

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

/**
 * Routing adapter returning the canonical goal-target `add_constraint`
 * tool call — `at_least 15 %` on the GOAL node (the shape the router
 * tool-schema teaches for "set a success target of 15%").
 */
function goalTargetToolCallAdapter() {
  const toolCall = {
    intent_class: 'execute',
    action: {
      handler_id: 'add_constraint',
      entity: {
        id: GOAL_NODE_ID,
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 15, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  };
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-lane20',
      name: OLUMI_ACTION_TOOL_NAME,
      input: toolCall as Record<string, unknown>,
    },
  ];
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content,
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'mock',
        latencyMs: 5,
      })),
  };
}

beforeEach(() => {
  setTestSink(() => undefined);
  appendCalls.length = 0;
  currentPersistedGraph = null;
});

afterEach(() => {
  vi.clearAllMocks();
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// 1. Reachability / persistence pin — the sanctioned path persists the
//    full contract and the receipt survives the guard.
// ---------------------------------------------------------------------------

describe('goal-target set via REAL add_constraint through the REAL STEP 7 merge/commit seam', () => {
  it('persists goal_threshold_raw/_unit/_cap/goal_threshold + goal_constraints, keeps server-authoritative top-level fields, and ships the formatGoalTargetSet receipt untouched', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    const result = await runTurnExecutor(
      payload(
        'Set a success target of a 15% improvement on the goal',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa2001',
      ),
      'req-lane20-real-handler',
      {
        routingAdapter: goalTargetToolCallAdapter(),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // The turn committed a graph.
    const write = appendCalls.at(-1)!;
    expect(write.handler_id).toBe('add_constraint');
    expect(write.graph).toBeDefined();
    const committed = write.graph as Record<string, unknown>;

    // Canonical contract quad on the goal node (user units raw, % → cap
    // 100, model-units threshold = raw/cap).
    const goal = (committed.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === GOAL_NODE_ID,
    )!;
    expect(goal.goal_threshold_raw).toBe(15);
    expect(goal.goal_threshold_unit).toBe('%');
    expect(goal.goal_threshold_cap).toBe(100);
    expect(goal.goal_threshold).toBeCloseTo(0.15, 10);
    expect(graphRegistersGoalTarget(committed)).toBe(true);

    // The constraint fact channel landed too.
    const constraints = committed.goal_constraints as Array<Record<string, unknown>>;
    expect(Array.isArray(constraints)).toBe(true);
    expect(constraints.some((c) => c.node_id === GOAL_NODE_ID && c.operator === '>=')).toBe(
      true,
    );

    // V5-D1-SHAPE-01 regression: server-authoritative fields survive.
    expect(committed.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(committed.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );

    // Receipt intact — a BACKED claim must never be swapped.
    expect(result.response.assistant_text).toContain('Success target set:');
    expect(result.response.assistant_text).toContain(GOAL_LABEL);
    expect(result.response.assistant_text).not.toBe(GOAL_TARGET_NOT_SAVED_TEXT);
  });
});

// ---------------------------------------------------------------------------
// 2. RED→GREEN — receipt-without-registration is swapped at STEP 7.
// ---------------------------------------------------------------------------

describe('goal-target receipt honesty guard at the STEP 7 commit chokepoint', () => {
  it('RED→GREEN: a formatGoalTargetSet receipt whose committed graph lacks goal_threshold_raw is swapped for the honest fallback AND the unbacked graph write is withheld (ROADMAP 1.19(b))', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    // Registry-injected add_constraint double: emits the REAL receipt copy
    // but a mutated_graph WITHOUT any threshold fields — the exact
    // receipt-without-registration class the live turn shipped. The
    // mutated graph is the echo shape unchanged (valid GraphV3, no stamp).
    const receipt = formatGoalTargetSet({
      goalLabel: GOAL_LABEL,
      value: 15,
      unit: '%',
    });
    const registry = new Map(getDefaultRegistry());
    registry.set('add_constraint', async () => ({
      assistant_text: receipt,
      handler_facts: [
        {
          fact_type: 'add_constraint',
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'gc-lane20-red',
            status: 'applied',
            before: null,
            after: { node_id: GOAL_NODE_ID, operator: '>=', value: 15 },
          },
        },
      ] as never,
      llm_calls_used: 0,
      mutated_graph: clone(ECHO_GRAPH_STATE),
    }));

    const result = await runTurnExecutor(
      payload(
        'Set a success target of a 15% improvement on the goal',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa2002',
      ),
      'req-lane20-guard-swap',
      {
        routingAdapter: goalTargetToolCallAdapter(),
        graphState: clone(ECHO_GRAPH_STATE) as never,
        handlerRegistry: registry,
      },
    );

    // ROADMAP 1.19(b) swap-vs-commit: the unbacked graph the handler
    // produced this turn must NOT be persisted alongside the swapped
    // honest text — a swap turn commits no graph at all, same as any
    // other non-mutating turn. (Previously this asserted the OPPOSITE —
    // `write.graph` was defined and genuinely lacked the contract, i.e.
    // junk WAS committed; that was the bug, not a passing invariant.)
    const write = appendCalls.at(-1)!;
    expect(write.graph).toBeUndefined();

    // Overnight review F5 — the "applied" edit receipt FACT must be
    // withheld too, not just the graph. Previously `write.handler_facts`
    // still carried the phantom `{status:'applied', noop:false}` fact
    // built from the unbacked mutation, grounding the NEXT turn's LLM on
    // an edit that never persisted (DL-7 violation) — the existing test
    // asserted only on `write.graph` and text, never this field.
    expect(write.handler_facts).toEqual([]);

    // …so the receipt must NOT ship; the honest fallback replaces it on
    // BOTH the wire and the stored assistant_message (pre-commit swap).
    expect(result.response.assistant_text).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(result.response.assistant_text).not.toContain('Success target set:');

    // F-DG negative pin (W1 overnight 2026-07-11): the swap withheld the
    // graph write, so the STEP 7 applied-graph attach must not fire — a
    // swapped turn never advertises its unpersisted mutation via the
    // `draft_graph` wire field either (same predicate as the withheld
    // commit: the attach reads the graph the commit persisted, and this
    // turn persisted none). See applied-graph-emit.ts.
    expect('draft_graph' in result.response).toBe(false);
  });
});
