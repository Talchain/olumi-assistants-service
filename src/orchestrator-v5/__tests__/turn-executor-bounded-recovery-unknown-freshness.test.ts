/**
 * Overnight-review F7 — `buildBoundedFallbackCopyAndChips` (turn-executor.ts)
 * must split freshness verdict `'unknown'` from `'stale'`, not lump them.
 *
 * PR #397 restructured this helper by PROJECTION-PRESENCE (has a prior
 * analysis projection, or not), leaving a middle branch —
 * `analysisStaleButPresent = hasAnalysisProjection && !isFresh` — that
 * fired identically whether the freshness verdict was a CONFIRMED `stale`
 * (graph hashes compared and differ — the model IS known to have changed)
 * or an `unknown` verdict (hash derivation genuinely FAILED this turn, e.g.
 * a persisted graph that fails `GraphStateIngressSchema` ingress parse
 * under schema drift — `freshness.ts`'s `current_graph_hash_unavailable`
 * path). On `unknown`, the shared "the model has changed … out of date"
 * copy is a FABRICATED change claim: CEE cannot actually tell whether the
 * model changed this turn.
 *
 * This suite exercises all four freshness verdicts through the SAME
 * production path (STEP 7 unconditional empty-answer backstop, which calls
 * `buildBoundedFallbackCopyAndChips` — see
 * `turn-executor-bounded-recovery-chip-suppression.test.ts` for the sibling
 * chip-sameness-guard coverage of the same call site) so the fix is proven
 * end-to-end, not just at the unit level.
 *
 * `unknown` reachability is traced (not assumed): `buildTurnContext` →
 * `context.persistedGraph` present but failing
 * `GraphStateIngressSchema.safeParse` → turn-executor's
 * `currentAnalysisGraphHashForTurn` resolver (turn-executor.ts, "V5
 * stale-aware explain recovery" block) returns `null` rather than falling
 * back to the request graph (to avoid a false-fresh verdict under client
 * lag) → `deriveAnalysisFreshness` selects the prior `run_analysis` fact
 * (whose `graph_hash_at_run` IS present), sees `currentGraphHash === null`,
 * and returns `freshness: 'unknown', reason:
 * 'current_graph_hash_unavailable'` (freshness.ts `deriveAnalysisFreshness`,
 * the `currentGraphHash === null` branch). This exact fixture shape
 * (`{ nodes: 'not-an-array', edges: [] }` persisted graph) is already
 * proven to hit that path by
 * `turn-executor-freshness-canonical-graph.test.ts`'s
 * "returns UNKNOWN (not fresh) when persisted graph exists but fails
 * ingress parse" case; reused here unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test.
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
  pendingActions: [],
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown }) => ({
      id: `row-${randomUUID()}`,
      ...(write.graph != null
        ? { graph_write_disposition: 'accepted_insert' as const }
        : {}),
    }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIOR_RA_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire',
      interventions: { fac_capacity: 1 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

// A second, hash-divergent graph (edge strength.mean changed) — used as the
// STALE fixture's persisted graph, so its hash provably differs from
// READY_GRAPH_HASH (the graph_hash_at_run stamped on the prior fact).
const EDITED_GRAPH = {
  ...READY_GRAPH,
  edges: [
    { ...READY_GRAPH.edges[0]!, strength: { mean: 0.6, std: 0.1 } },
    READY_GRAPH.edges[1]!,
    READY_GRAPH.edges[2]!,
  ],
};
const EDITED_GRAPH_HASH = computeAnalysisAffectingGraphHash(EDITED_GRAPH as never)!;

function makeRunAnalysisFact(graphHashAtRun: string): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: graphHashAtRun,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RA_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

/** Coach tool call whose answer_text is pure markup sanitising to '' —
 * non-blank at the RAW layer (satisfies the now-UNCONDITIONAL schema
 * requirement, O-7 wave 2: CEE_ANSWER_TEXT_REQUIRED deleted; a genuinely
 * ABSENT answer_text would REPAIR_ONCE instead of composing) — the
 * empty-answer recovery trigger, same as the sibling chip-sameness-guard
 * suite. */
function emptyAnswerCoachToolResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: {
        intent_class: 'coach',
        coaching_mode: 'reframe',
        // A schema-valid shape whose derived text is pure markup: non-blank
        // (so the shape requirement is satisfied and no REPAIR_ONCE fires)
        // but sanitises to '' → the empty-answer recovery trigger.
        answer_shape: {
          headline: '<internal></internal>',
          bullets: [],
          detail: '<internal></internal>',
        },
      },
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function findPreHandlerFreshnessEvent(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

describe('turn-executor — bounded-recovery copy honours the freshness VERDICT, not just projection presence (overnight review F7)', () => {
  beforeEach(() => {
    events = [];
    mockState.pendingActions = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('FRESH + projection present: reassures, offers Explain + Re-run', async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    mockState.persistedGraph = READY_GRAPH;
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-f7-fresh',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('fresh');
    expect(result.response.assistant_text).toBe(
      "I couldn't complete that turn cleanly, but your current analysis is still available."
    );
    const actionTypes = result.response.suggested_actions.map((a: { action_type?: string }) => a.action_type);
    expect(actionTypes).toContain('explain_results');
    expect(actionTypes).toContain('run_analysis');
  });

  it('STALE (confirmed hash divergence) + projection present: asserts the model changed, offers Re-run only', async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    mockState.persistedGraph = EDITED_GRAPH;
    // Fixture sanity: the two graphs must actually hash differently, or this
    // test would silently degrade to the fresh case.
    expect(EDITED_GRAPH_HASH).not.toBe(READY_GRAPH_HASH);
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-f7-stale',
      { routingAdapter: adapter, graphState: EDITED_GRAPH as never },
    );

    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('stale');
    expect(result.response.assistant_text).toContain('has changed');
    expect(result.response.assistant_text.toLowerCase()).toContain('out of date');
    const actionTypes = result.response.suggested_actions.map((a: { action_type?: string }) => a.action_type);
    expect(actionTypes).toEqual(['run_analysis']);
  });

  it("UNKNOWN (hash derivation failed — unparseable persisted graph) + projection present: does NOT assert the model changed, offers Re-run only (F7 fix)", async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    // Persisted graph exists but fails GraphStateIngressSchema ingress parse
    // (`nodes` must be an array) — proven by
    // turn-executor-freshness-canonical-graph.test.ts to route
    // deriveAnalysisFreshness to 'unknown' / 'current_graph_hash_unavailable'
    // rather than 'stale'.
    mockState.persistedGraph = { nodes: 'not-an-array', edges: [] };
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-f7-unknown',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    // Sanity-pin: the scenario genuinely reaches 'unknown', not 'stale'.
    const evt = findPreHandlerFreshnessEvent();
    expect(evt?.data.freshness).toBe('unknown');
    expect(evt?.data.reason).toBe('current_graph_hash_unavailable');

    // The F7 assertion: no fabricated change claim. CEE cannot tell whether
    // the model changed this turn, so it must not say so.
    const text = result.response.assistant_text;
    expect(text).not.toMatch(/has changed/i);
    expect(text.toLowerCase()).not.toContain('out of date');
    // Still honest and still invites a path forward.
    expect(text).not.toBe('');
    expect(text.toLowerCase()).toMatch(/re-?run analysis/);
    expect(text.toLowerCase()).toMatch(/can'?t confirm/);

    // Same conservative chip choice as stale: Re-run only, no Explain.
    const actionTypes = result.response.suggested_actions.map((a: { action_type?: string }) => a.action_type);
    expect(actionTypes).toEqual(['run_analysis']);
  });

  it(
    'NONE (no successful prior fact) + body analysis_state populates the projection: ' +
      'does NOT assert the model changed, gives honest can\'t-confirm copy + Re-run (F5 fix)',
    async () => {
      // The exact F5 defect cell: a request supplies analysis_state in the body
      // (populating contextPackForLog.analysis.leading_option — te:1498-1526), but
      // there is NO successful prior run_analysis fact, so deriveAnalysisFreshness
      // returns 'none' (freshness.ts:458). Before the fix, hasAnalysisProjection &&
      // !isFresh && !isUnknown lumped 'none' with 'stale' and emitted "The model has
      // changed since the last analysis" — a change assertion with zero evidence
      // (there was never a prior analysis to change FROM).
      mockState.priorTurns = [];
      mockState.priorFacts = [];
      mockState.persistedGraph = null;
      // A V2RunResponse-shaped analysis_state with a clear leading option — enough
      // for compactAnalysis to project a leading_option (hasAnalysisProjection).
      const bodyAnalysisState = {
        analysis_status: 'computed',
        option_comparison: [
          {
            option_id: 'opt_hire',
            option_label: 'Hire',
            outcome: { mean: 0.14, p10: -0.1, p90: 0.4 },
            status: 'computed',
            win_probability: 0.72,
          },
          {
            option_id: 'opt_status_quo',
            option_label: 'Hold',
            outcome: { mean: 0.0, p10: -0.04, p90: 0.05 },
            status: 'computed',
            win_probability: 0.28,
          },
        ],
        factor_sensitivity: [
          { label: 'Capacity', elasticity: 0.42, direction: 'positive', influence_score: 0.42 },
        ],
        robustness: {
          level: 'medium',
          is_robust: true,
          recommended_option_id: 'opt_hire',
          recommended_option_label: 'Hire',
          fragile_edges: [],
        },
      };
      const adapter = {
        chatWithTools: vi
          .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
          .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
      };

      const result = await runTurnExecutor(
        mkPayload('help me think this through'),
        'req-f5-none-with-projection',
        {
          routingAdapter: adapter,
          graphState: READY_GRAPH as never,
          analysisState: bodyAnalysisState as never,
        },
      );

      // Sanity-pin: the verdict genuinely is 'none', not 'stale'.
      expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('none');

      const text = result.response.assistant_text;
      // F5 assertion: no fabricated change claim — there was never a prior analysis.
      expect(text).not.toMatch(/has changed/i);
      expect(text.toLowerCase()).not.toContain('out of date');
      // Honest, and still offers a path forward.
      expect(text).not.toBe('');
      expect(text.toLowerCase()).toMatch(/can'?t confirm/);
      expect(text.toLowerCase()).toMatch(/re-?run analysis/);

      // Conservative chip choice: Re-run only (Explain would surface unconfirmed
      // results). A projection is present, so the retry copy's no-chip arm must
      // NOT swallow it.
      const actionTypes = result.response.suggested_actions.map(
        (a: { action_type?: string }) => a.action_type,
      );
      expect(actionTypes).toEqual(['run_analysis']);
    },
  );

  it('NONE (no prior analysis) + no projection: generic retry copy, no chips', async () => {
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    mockState.persistedGraph = null;
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-f7-none',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('none');
    expect(result.response.assistant_text).toBe(
      "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.",
    );
    expect(result.response.suggested_actions).toEqual([]);
  });
});
