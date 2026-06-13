/**
 * V5 fresh-analysis follow-up guard — turn-executor integration acceptance.
 *
 * Proves the path-level claim that the guard prevents the LLM routing
 * call (and therefore `edit_graph` misroute) on fresh-analysis analytical
 * follow-ups. The pure guard unit tests assert the matched-vs-unmatched
 * contract on the predicate; this test wires `runTurnExecutor` end-to-end
 * with a routing adapter that THROWS if invoked, so any code path reaching
 * the LLM fails the test loudly.
 *
 * Setup mirrors `turn-executor-edit-graph-then-state-query.integration.test.ts`:
 * a mocked `getSessionStore` returns the prior facts + persisted graph the
 * turn-executor needs, the routing adapter is the only seam where Sonnet
 * would be called, and telemetry is captured via `setTestSink`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
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
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures
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

// Successful run_analysis fact with graph_hash_at_run matching the
// currently-persisted graph — `deriveAnalysisFreshness` returns 'fresh'.
function makeFreshRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error(
          'Routing adapter must NOT be called when fresh-analysis-followup guard matches',
        );
      }),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V5 fresh-analysis follow-up guard — turn-executor integration', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  // V5-WAVE-2 PR-C: a fresh freshness-status question ("Is this analysis still
  // up to date?") is owned by the stale-rerun / freshness-status guard, which
  // runs BEFORE this fresh-followup guard. So it gets a crisp "still current"
  // answer — NOT the fresh-followup recap, and NOT the egress generic fallback
  // the LLM path produced when "up to date" classified as null intent and
  // Sonnet wrote "previous/prior analysis".
  it('"Is this analysis still up to date?" (fresh) → crisp still-current answer, no LLM, no recap, no egress fallback', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('Is this analysis still up to date?'),
      'req-fresh-j3-up-to-date',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    // No LLM → the "previous/prior analysis" egress trip is impossible.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(result.telemetry.llm_calls_used).toBe(0);

    // The freshness-status guard owned it (fired before the fresh-followup guard).
    const staleEvent = events.find((e) => e.event === 'v5.stale_rerun_guard');
    expect(staleEvent, 'stale_rerun_guard telemetry should fire').toBeDefined();
    expect(staleEvent!.data.matched).toBe(true);
    expect(staleEvent!.data.intent_class).toBe('rerun_question');
    expect(staleEvent!.data.freshness).toBe('fresh');

    // Crisp determination, and NEITHER the recap stub NOR the generic egress fallback.
    expect(result.response.assistant_text).toContain('still current');
    expect(result.response.assistant_text).not.toContain(
      "Here's the latest analysis recap.",
    );
    expect(result.response.assistant_text).not.toContain(
      "Let me know what you'd like me to do next",
    );
  });

  it('"What drove this result?" with fresh analysis → guard matches, routing LLM NOT called', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What drove this result?'),
      'req-fresh-followup-what-drove',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    // Path proof: routing adapter never invoked → no LLM call, so no
    // possibility of an edit_graph misroute.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();

    // Telemetry: the new guard fired with matched=true and the documented
    // selected_path / selected_action_type fields.
    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    expect(guardEvent, 'guard telemetry should fire').toBeDefined();
    expect(guardEvent!.data.matched).toBe(true);
    expect(guardEvent!.data.intent_class).toBe('what_drove');
    expect(guardEvent!.data.analysis_freshness).toBe('fresh');
    expect(guardEvent!.data.selected_path).toBe('fresh_analysis_followup');
    expect(guardEvent!.data.selected_action_type).toBe('explain_results');

    // Response: direct_answer with zero LLM calls.
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(result.telemetry.llm_calls_used).toBe(0);

    // Chip: the existing explain_results chip is attached.
    const explainChip = result.response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'explain_results',
    );
    expect(explainChip, 'explain_results chip should be present').toBeDefined();
    expect(explainChip).toMatchObject({
      id: 'chip_action_explain_results',
      action_type: 'explain_results',
      label: 'Explain the result',
    });

    // Anti-regression: NO chip points at edit_graph (the prior misroute).
    const editGraphChip = result.response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'edit_graph',
    );
    expect(editGraphChip).toBeUndefined();

    // The brief's recap copy ships verbatim.
    expect(result.response.assistant_text).toContain(
      "Here's the latest analysis recap.",
    );
  });

  it('"Walk me through the analysis" with fresh analysis → guard matches with intent=explain', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('Walk me through the analysis.'),
      'req-fresh-followup-explain',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    expect(guardEvent!.data.matched).toBe(true);
    expect(guardEvent!.data.intent_class).toBe('explain');
    expect(guardEvent!.data.selected_action_type).toBe('explain_results');
    const chip = result.response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'explain_results',
    );
    expect(chip).toBeDefined();
  });

  it('"What would need to change for another option to look better?" with fresh → what_would_flip chip', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What would need to change for another option to look better?'),
      'req-fresh-followup-flip',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    expect(guardEvent!.data.matched).toBe(true);
    expect(guardEvent!.data.intent_class).toBe('what_would_flip');
    expect(guardEvent!.data.selected_action_type).toBe('what_would_flip');
    const chip = result.response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'what_would_flip',
    );
    expect(chip).toBeDefined();
    expect(chip).toMatchObject({
      id: 'chip_action_what_would_flip',
      action_type: 'what_would_flip',
      label: 'What could change the outcome?',
    });
  });

  it('"Why is this option ahead?" with fresh analysis → guard matches with intent=what_drove', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('Why is this option ahead?'),
      'req-fresh-followup-ahead',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    expect(guardEvent!.data.matched).toBe(true);
    expect(guardEvent!.data.intent_class).toBe('what_drove');
    const chip = result.response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'explain_results',
    );
    expect(chip).toBeDefined();
  });

  it('"Set Pricing to 0.7" with fresh analysis → guard does NOT match, mutation path open', async () => {
    // Mutation messages must still route normally. Use a calling adapter so
    // the value-update flow can resolve without throwing — the explicit
    // assertion is just that the new guard did not intercept.
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 5, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(
      mkPayload('Set Pricing to 0.7.'),
      'req-fresh-followup-mutation',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    // Either no event (the deterministic value-update guard already
    // short-circuited above the new guard) or the new guard emitted
    // matched: false. Both prove the new guard did not capture the edit.
    if (guardEvent !== undefined) {
      expect(guardEvent.data.matched).toBe(false);
    }
  });

  it('"Set Pricing to 0.7 then explain the results" with fresh analysis → guard rejects with mutation_signal; mutation route reachable', async () => {
    // Round-2 review regression case. The concrete edit clause
    // ("Set Pricing to 0.7") and the analytical phrase ("explain the
    // results") both fire — analytical was incorrectly winning under the
    // earlier broad analytical-first ordering, swallowing the edit.
    // Fix: only `what_would_flip` gets the analytical exception;
    // `explain` / `what_drove` / `rerun_question` defer to mutation.
    //
    // A calling adapter is wired so the downstream routing path can
    // resolve — what's being proved at the path level is:
    //   (a) the new guard emits matched: false reason: 'mutation_signal'
    //   (b) routing/edit dispatch remains reachable (adapter or earlier
    //       deterministic value-update guard handles the turn)
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 5, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    const result = await runTurnExecutor(
      mkPayload('Set Pricing to 0.7 then explain the results.'),
      'req-fresh-followup-overlap-edit-explain',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    // Two acceptable paths: the deterministic value-update guard upstream
    // captured the turn (guard never emitted), OR the new guard emitted
    // matched:false with mutation_signal. Both prove the new guard does
    // not swallow concrete edits paired with analytical phrasing.
    if (guardEvent !== undefined) {
      expect(guardEvent.data.matched).toBe(false);
      expect(guardEvent.data.unmatched_reason).toBe('mutation_signal');
      expect(guardEvent.data.selected_path).toBeNull();
      expect(guardEvent.data.selected_action_type).toBeNull();
    }

    // Anti-regression: the response must NOT carry the new guard's
    // recap copy, because the guard did not match. (When the upstream
    // deterministic value-update guard catches the turn, the response is
    // its own deterministic value-update copy.) We don't pin the exact
    // downstream copy — only that the new guard's recap line did NOT ship.
    expect(result.response.assistant_text ?? '').not.toContain(
      "Here's the latest analysis recap.",
    );
  });

  it('"Set Pricing to 0.7 then what would need to change..." (round-3 case) → mutation wins, no recap', async () => {
    // Round-3 review regression case. The earlier `what_would_flip`
    // exception was too broad — it accepted any what_would_flip
    // classification regardless of whether the message also carried an
    // independent concrete edit clause. Fix:
    // `hasConcreteMutationSignal` disqualifies the exception when an
    // unambiguous edit (verb+number / add-a-new / remove-the / bare
    // imperative) is also present.
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 5, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    const result = await runTurnExecutor(
      mkPayload(
        'Set Pricing to 0.7 then what would need to change for another option to look better?',
      ),
      'req-fresh-followup-overlap-flip',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    if (guardEvent !== undefined) {
      // The new guard reached and explicitly rejected with mutation_signal,
      // OR an upstream deterministic value-update guard captured the
      // turn first. Either way the new guard must NOT report matched:true.
      expect(guardEvent.data.matched).toBe(false);
      expect(guardEvent.data.unmatched_reason).toBe('mutation_signal');
      expect(guardEvent.data.selected_path).toBeNull();
      expect(guardEvent.data.selected_action_type).toBeNull();
    }
    expect(result.response.assistant_text ?? '').not.toContain(
      "Here's the latest analysis recap.",
    );
  });

  it('"Change marketing channel to TikTok then what would need to change..." (round-4 textual-edit case) → mutation wins, no recap', async () => {
    // Round-4 review regression case. The round-3 helper only flagged
    // concrete edits via numeric value, add-a-new, remove-the, or bare
    // imperative — it missed independent textual verb-to-X edits like
    // "Change marketing channel to TikTok". The round-4 fix replaces
    // that helper with `hasIndependentMutationSignal`, which strips
    // what_would_flip pattern spans and re-checks verb-to-X on the
    // remainder. The leading edit clause survives the strip and proves
    // an independent edit exists.
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 5, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    const result = await runTurnExecutor(
      mkPayload(
        'Change marketing channel to TikTok then what would need to change for another option to look better?',
      ),
      'req-fresh-followup-overlap-textual-edit',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const guardEvent = events.find(
      (e) => e.event === 'v5.fresh_analysis_followup_guard',
    );
    if (guardEvent !== undefined) {
      expect(guardEvent.data.matched).toBe(false);
      expect(guardEvent.data.unmatched_reason).toBe('mutation_signal');
      expect(guardEvent.data.selected_path).toBeNull();
      expect(guardEvent.data.selected_action_type).toBeNull();
    }
    expect(result.response.assistant_text ?? '').not.toContain(
      "Here's the latest analysis recap.",
    );
  });
});
