/**
 * F-DG (W1 overnight 2026-07-11, wire-proven) — applied D1 receipts on the
 * routed STEP 7 commit path must carry the applied graph via `draft_graph`.
 *
 * Defect under test (verified twice on the live v2 wire): PR #414 attached
 * the applied post-mutation graph as `draft_graph` on the edit_graph apply
 * family (normal apply + GM held-consent apply), but the ROUTED D1 typed-
 * handler commit path — the STEP 7 chokepoint that #414's F3 re-projection
 * already re-derives `analysisReadyForTurn` / `effectiveTurnGraph` from the
 * committed graph — shipped its applied receipt WITHOUT `draft_graph`. Both
 * wire-proven absent classes funnel through this one seam:
 *
 *   1. TYPED-HANDLER applied receipt — Sonnet tool_call → validate → D1
 *      execute (set_factor_value) → STEP 7 commit.
 *   2. CHIP-REPLAY applied receipt — the pending-action deterministic resume
 *      (the £250k consented cap-extension replay: set_factor_value value
 *      250000 WITH cap change), which synthesises an execute proposal and
 *      falls through to the SAME routed STEP 7 commit. The deterministic
 *      chip-click dispatcher (chip-click-dispatch.ts) is NOT this path — its
 *      whitelist (run_analysis / explain_results / what_would_flip) never
 *      mutates, so it must keep attaching nothing.
 *
 * Consequence live: the UI's only inline-graph ingestion path is the
 * top-level `draft_graph` wire field (adaptDraftResponse / applyDraftResult),
 * so applied typed/chip-replay mutations were invisible on the canvas — the
 * exact class the £250k chip journey uses.
 *
 * Fix under test: the STEP 7 post-commit block attaches
 * `draft_graph: buildAppliedGraphWireField(committedGraphParse.data)` after
 * (and only after) a successful graph-bearing commit — the SAME typed parse
 * of the SAME committed graph that F3 already re-projects readiness and the
 * egress label graph from, and the SAME gating discipline as #414: committed
 * success only, never on failed / swap / non-mutating turns.
 *
 * Negative pins: a failed commit attaches nothing (the catch replaces the
 * response wholesale); a goal-target swap turn withholds the graph write and
 * therefore attaches nothing (see also
 * turn-executor-goal-target-commit-honesty.test.ts); a non-mutating turn
 * attaches nothing; the run_analysis chip-click dispatcher attaches nothing
 * (pinned in handlers/__tests__/chip-click-dispatch.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = randomUUID();

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];
let appendError: Error | null = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      // Armed by the commit-failure negative: a graph-bearing write throws,
      // exercising the STEP 7 catch (STATE_COMMIT_FAILED).
      if (appendError && write.graph !== undefined && write.graph !== null) {
        throw appendError;
      }
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    // STEP 7 strict read: null = genuinely-empty scenario → the mutated
    // graph commits as the first valid write (no persisted-base merge),
    // keeping the committed shape equal to the handler's applied view.
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { RESCALE_EXTEND_CAP_CHIP_ID } = await import(
  '../compose/validation-failure-responses.js'
);

function payload(message: string, turnClass: 'decide' | 'clarify' = 'decide'): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: turnClass,
    stage: 'analyse',
  });
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-applied-graph-wire',
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

function mockRoutingAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkToolUseResult(input)),
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on the deterministic resume');
      }),
  };
}

// ---------------------------------------------------------------------------
// Typed-handler fixture — £ factor with a resolved current value (same
// convention as turn-executor-relative-delta.test.ts).
// ---------------------------------------------------------------------------

function buildBudgetGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

function setFactorValueToolCall() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        label: 'Budget',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [
        { name: 'value', value: { value: 45000, unit: '£' }, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Chip-replay fixture — the £250k consented cap-extension replay (same
// fixture family as turn-executor-response-projection.test.ts, which is
// shaped like the live wire capture: set_factor_value value 250000 WITH a
// cap change on the deterministic-resume path).
// ---------------------------------------------------------------------------

const TARGET_MATCH = { node_id: 'fac_migration', match_type: 'exact_id', confidence: 'high' };

const MIGRATION_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    {
      id: 'opt_a',
      kind: 'option',
      label: 'Option A',
      interventions: {
        fac_migration: { value: 1, source: 'user_specified', target_match: TARGET_MATCH },
      },
    },
    {
      id: 'opt_b',
      kind: 'option',
      label: 'Option B',
      interventions: {
        fac_migration: {
          value: 0.5,
          raw_value: 100000,
          source: 'user_specified',
          target_match: TARGET_MATCH,
        },
      },
    },
    {
      id: 'fac_migration',
      kind: 'factor',
      label: 'Migration Cost',
      observed_state: { value: 0.75, raw_value: 150000, unit: '£', cap: 200000 },
    },
  ],
  edges: [
    {
      from: 'dec_d',
      to: 'opt_a',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_a',
      to: 'fac_migration',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_b',
      to: 'fac_migration',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_migration',
      to: 'goal_g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

const PRE_MUTATION_HASH = computeAnalysisAffectingGraphHash(MIGRATION_GRAPH as never);

/** The consented cap-extension pending (as persisted by turn 1 of the loop). */
function rescalePending(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: RESCALE_EXTEND_CAP_CHIP_ID,
    action: {
      kind: 'set_factor_value',
      factor_id: 'fac_migration',
      value: 250000,
      unit: '£',
      operator: 'set',
      cap: 320000,
    },
    preconditions: {
      target_entity_ids: ['fac_migration'],
      ...(PRE_MUTATION_HASH != null ? { graph_hash: PRE_MUTATION_HASH } : {}),
    },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-10T00:00:00.000Z',
  };
}

beforeEach(() => {
  appendCalls.length = 0;
  mockedPendingActions = [];
  appendError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('F-DG — applied D1 receipts on the routed STEP 7 path carry draft_graph', () => {
  it('TYPED-HANDLER applied receipt (wire-proven absence 1): a routed set_factor_value apply carries draft_graph mirroring the committed graph', async () => {
    const result = await runTurnExecutor(
      payload('Set the budget to £45,000'),
      'req-applied-graph-typed',
      {
        routingAdapter: mockRoutingAdapter(setFactorValueToolCall()),
        graphState: buildBudgetGraph() as never,
      },
    );
    expect(result.telemetry.commit_performed).toBe(true);

    // The commit persisted the mutation.
    const graphWrite = appendCalls.find((w) => w.graph != null);
    expect(graphWrite).toBeDefined();
    const committed = graphWrite!.graph as GraphV3T;
    expect(
      committed.nodes.find((n) => n.id === 'f-budget')!.observed_state!.raw_value,
    ).toBe(45000);

    // THE FIX — the wire response carries the applied graph via the existing
    // `draft_graph` field (the UI's only inline-graph ingestion path), in
    // exactly the draft-dispatch shape: nodes, edges, and counts derived
    // from the SAME graph.
    const dg = result.response.draft_graph;
    expect(dg).toBeDefined();
    const wireBudget = (dg!.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'f-budget',
    );
    expect(wireBudget).toBeDefined();
    expect((wireBudget!.observed_state as Record<string, unknown>).raw_value).toBe(45000);
    expect(dg!.node_count).toBe(dg!.nodes.length);
    expect(dg!.edge_count).toBe(dg!.edges.length);
    expect(dg!.node_count).toBe(committed.nodes.length);
    expect(dg!.edge_count).toBe(committed.edges.length);

    // Mirror discipline: the attached graph IS the committed graph — its
    // analysis-affecting hash equals the committed hash, and it is the SAME
    // typed view the egress label graph re-projection uses.
    const committedHash = computeAnalysisAffectingGraphHash(committed as never);
    expect(committedHash).not.toBeNull();
    expect(
      computeAnalysisAffectingGraphHash({ nodes: dg!.nodes, edges: dg!.edges } as never),
    ).toBe(committedHash);
    expect(dg!.nodes).toEqual((result.effectiveGraph as GraphV3T).nodes);
    expect(dg!.edges).toEqual((result.effectiveGraph as GraphV3T).edges);
  });

  it('CHIP-REPLAY applied receipt (wire-proven absence 2, £250k shape): the consented cap-extension resume carries draft_graph with the renormalised post-mutation graph', async () => {
    mockedPendingActions = [rescalePending()];
    const result = await runTurnExecutor(
      payload('Extend the scale for Migration Cost and use the new value.', 'clarify'),
      'req-applied-graph-chip-replay',
      {
        routingAdapter: throwingRoutingAdapter(),
        graphState: MIGRATION_GRAPH as never,
      },
    );
    expect(result.telemetry.commit_performed).toBe(true);

    const graphWrite = appendCalls.find((w) => w.graph != null);
    expect(graphWrite).toBeDefined();
    const committed = graphWrite!.graph as GraphV3T;

    // The wire carries the applied graph: cap extended to 320000, factor at
    // £250,000, and the options' interventions renormalised against the new
    // cap — the exact values the canvas failed to show live.
    const dg = result.response.draft_graph;
    expect(dg).toBeDefined();
    const nodes = dg!.nodes as Array<{
      id: string;
      observed_state?: { raw_value?: number; cap?: number };
      interventions?: Record<string, { value: number }>;
    }>;
    const factor = nodes.find((n) => n.id === 'fac_migration');
    expect(factor?.observed_state?.raw_value).toBe(250000);
    expect(factor?.observed_state?.cap).toBe(320000);
    expect(nodes.find((n) => n.id === 'opt_a')!.interventions!.fac_migration!.value).toBeCloseTo(
      200000 / 320000,
      10,
    );
    expect(dg!.node_count).toBe(dg!.nodes.length);
    expect(dg!.edge_count).toBe(dg!.edges.length);

    // Hash parity with the committed graph, moved off the pre-mutation anchor.
    const committedHash = computeAnalysisAffectingGraphHash(committed as never);
    expect(
      computeAnalysisAffectingGraphHash({ nodes: dg!.nodes, edges: dg!.edges } as never),
    ).toBe(committedHash);
    expect(committedHash).not.toBe(PRE_MUTATION_HASH);
  });

  it('negative: a non-mutating turn attaches NO draft_graph', async () => {
    const result = await runTurnExecutor(
      payload('What does the analysis say?'),
      'req-applied-graph-non-mutating',
      {
        routingAdapter: {
          chatWithTools: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'The analysis has not run yet.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 20 },
            model: 'claude-sonnet-4-6',
            latencyMs: 50,
          } as unknown as ChatWithToolsResult),
        },
        graphState: buildBudgetGraph() as never,
      },
    );
    expect(appendCalls.find((w) => w.graph != null)).toBeUndefined();
    expect('draft_graph' in result.response).toBe(false);
  });

  it('negative: a FAILED commit attaches NO draft_graph — the catch never advertises unpersisted state', async () => {
    appendError = new Error('session store unreachable');
    const result = await runTurnExecutor(
      payload('Set the budget to £45,000'),
      'req-applied-graph-commit-failed',
      {
        routingAdapter: mockRoutingAdapter(setFactorValueToolCall()),
        graphState: buildBudgetGraph() as never,
      },
    );
    // Commit failed → STATE_COMMIT_FAILED envelope, nothing persisted,
    // and no applied-graph advertisement on the wire.
    expect(result.telemetry.commit_performed).toBe(false);
    expect(appendCalls.find((w) => w.graph != null)).toBeUndefined();
    expect('draft_graph' in result.response).toBe(false);
    const errorBlock = (
      result.response.blocks as Array<{ type: string; error_code?: string }>
    ).find((b) => b.type === 'error');
    expect(errorBlock?.error_code).toBe('INTERNAL_ERROR');
  });
});
