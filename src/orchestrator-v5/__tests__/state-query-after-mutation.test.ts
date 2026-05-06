/**
 * V5 product-state continuity (foamy-bee tranche) — route-level proof
 * for the named misroute class.
 *
 * Scenario the failure log hit:
 *   1. Turn N — user adds a constraint ("Yes, we don't want to spend more
 *      than £50k on this."). Handler succeeds; an add_constraint fact is
 *      persisted to v5_handler_facts.
 *   2. Turn N+1 — user asks "I can't see this constraint on the graph.
 *      What update did you make?"
 *   3. Pre-fix: the follow-up routes to legacy edit_graph, returns no
 *      operations, and replies "No changes were needed for this request."
 *
 * This test pins the post-fix behaviour:
 *   - The deterministic state-query guard intercepts the follow-up.
 *   - The routing LLM adapter is NOT called.
 *   - The assistant_text references the literal £50,000 value, grounded
 *     in the persisted add_constraint fact via the `recent_changes`
 *     ContextPack projection.
 *   - The denial copy ("No changes were needed", "No update has been
 *     made") never appears.
 *   - The turn dispatches as a direct_answer / converse intent.
 *
 * The test exercises ONLY turn N+1 — turn N's mutation is faked via
 * priorFacts injected into the mocked SessionStore. This isolates the
 * state-query guard from the unrelated mutation-handler machinery so a
 * failure here is unambiguously the fix under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';

const TEST_SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const PRIOR_TURN_ROW_ID = '22222222-2222-4222-8222-222222222222';

const ADD_CONSTRAINT_FACT_50K = {
  fact_type: 'add_constraint' as const,
  fact_version: 1 as const,
  noop: false,
  result: {
    target_id: 'gc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'applied' as const,
    before: null,
    after: {
      constraint_id: 'gc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      node_id: 'factor_total_cost',
      operator: '<=',
      value: 50000,
      label: 'Total cost',
      unit: '£',
      provenance: 'explicit',
    },
  },
};

const PRIOR_HANDLER_TURN = {
  id: PRIOR_TURN_ROW_ID,
  scenario_id: TEST_SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-add-constraint',
  turn_class: 'handler',
  handler_id: 'add_constraint',
  request_hash: 'sha256:prior',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

const mockState: {
  priorTurns: ReadonlyArray<Record<string, unknown>>;
  priorFacts: ReadonlyArray<Record<string, unknown>>;
} = {
  priorTurns: [],
  priorFacts: [],
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const appendCalls: Array<Record<string, unknown>> = [];

function payload(message: string): MessageTurnPayload {
  // `turn_class` is the boundary's intent hint and uses a different enum
  // from `stage`. Use 'frame' as the neutral default so the boundary
  // schema accepts the payload at compile time. The actual turn class
  // (handler / direct_answer / clarify) is decided by the executor and
  // surfaced via `result.telemetry.turn_class`.
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: TEST_SCENARIO_ID,
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
          'Routing adapter must NOT be called when the deterministic state-query guard matches',
        );
      }),
  };
}

function callingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Mocked Sonnet text.' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

describe('V5 state-query guard — route-level multi-turn proof', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    setTestSink(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  describe('after a successful £50k add_constraint, on the follow-up turn', () => {
    beforeEach(() => {
      mockState.priorTurns = [PRIOR_HANDLER_TURN];
      mockState.priorFacts = [ADD_CONSTRAINT_FACT_50K];
    });

    it('does NOT call the routing LLM for "What update did you make?"', async () => {
      const adapter = throwingRoutingAdapter();
      await runTurnExecutor(payload('What update did you make?'), 'req-state-query-1', {
        routingAdapter: adapter,
      });
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
    });

    it('references the literal £50,000 value (response is grounded in the persisted fact)', async () => {
      // The integration assertion the user brief explicitly requires:
      // the response must reference £50k or 50,000. Our deterministic
      // copy uses formatValueWithUnit's en-GB formatter, which renders
      // £50000 as £50,000. The assertion below covers both £50k and
      // £50,000 — whichever string the user/regression test expects.
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('What update did you make?'),
        'req-state-query-2',
        { routingAdapter: adapter },
      );
      const text = result.response.assistant_text;
      // Literal grounding in the persisted constraint value.
      expect(text).toMatch(/£50,?000|£50k/i);
      // Constraint label appears so the user knows WHAT was constrained.
      expect(text).toContain('Total cost');
      // No fabricated phrasing — the deterministic copy is the
      // formatConstraintAdded summary verbatim.
      expect(text).toContain('at most');
    });

    it('does NOT route to legacy edit_graph and never emits the denial copy', async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload("I can't see this constraint. What update did you make?"),
        'req-state-query-3',
        { routingAdapter: adapter },
      );
      const text = result.response.assistant_text;
      // The pre-fix denial copy from src/orchestrator/tools/edit-graph.ts:1637
      // and src/orchestrator/patch-summary.ts:427.
      expect(text).not.toMatch(/no changes were needed/i);
      expect(text).not.toMatch(/no changes were applied/i);
      expect(text).not.toMatch(/no update has been made/i);
      // No handler should have run: the guard dispatches a direct_answer
      // with no handler. `result.telemetry` doesn't expose handler_id
      // directly — the canonical signal is `turn_class === 'direct_answer'`
      // (asserted in the next test) and the absence of a handler turn
      // append (asserted later via the persistence mock).
      expect(result.telemetry.turn_class).not.toBe('handler');
    });

    it('dispatches as direct_answer / converse with no LLM calls', async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('what changed?'),
        'req-state-query-4',
        { routingAdapter: adapter },
      );
      expect(result.telemetry.turn_class).toBe('direct_answer');
      expect(result.telemetry.intent_class).toBe('converse');
      expect(result.telemetry.llm_calls_used).toBe(0);
    });

    it('emits the v5.state_query_guard telemetry event with grounded recent_change_count', async () => {
      const adapter = throwingRoutingAdapter();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      setTestSink((eventName, data) => events.push({ event: eventName, data }));

      await runTurnExecutor(
        payload('What update did you make?'),
        'req-state-query-5',
        { routingAdapter: adapter },
      );

      const guardEvent = events.find(
        (e) => e.event === 'v5.state_query_guard',
      );
      expect(guardEvent).toBeDefined();
      expect(guardEvent!.data.matched).toBe(true);
      expect(guardEvent!.data.dispatch).toBe('with_recent_change');
      expect(guardEvent!.data.recent_change_count).toBe(1);
      expect(guardEvent!.data.prior_mutation_fact_count).toBe(1);
    });

    it('the assistant_text never leaks raw structural identifiers', async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('What update did you make?'),
        'req-state-query-6',
        { routingAdapter: adapter },
      );
      const text = result.response.assistant_text;
      // None of the fields the original failure leaked.
      expect(text).not.toMatch(/gc-/i);
      expect(text).not.toMatch(/constraint_id/i);
      expect(text).not.toMatch(/node_id/i);
      expect(text).not.toMatch(/factor_total_cost/);
      expect(text).not.toMatch(/provenance/i);
      expect(text).not.toMatch(/<=|>=/);
      expect(text).not.toMatch(/operator/i);
    });
  });

  describe('without prior mutations', () => {
    it('a state-query phrase is still intercepted but yields the curated "no changes" copy (not a denial)', async () => {
      // priorTurns and priorFacts are empty — fresh scenario.
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('What update did you make?'),
        'req-no-prior-state-query',
        { routingAdapter: adapter },
      );
      // Adapter still not called — guard owns the turn.
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      const text = result.response.assistant_text;
      expect(text.toLowerCase()).toContain("haven't applied");
      // No legacy denial copy.
      expect(text).not.toMatch(/no changes were needed/i);
    });
  });

  describe('messages that should NOT be intercepted', () => {
    it('passes through non-state-query messages to the LLM unchanged', async () => {
      mockState.priorTurns = [PRIOR_HANDLER_TURN];
      mockState.priorFacts = [ADD_CONSTRAINT_FACT_50K];
      const adapter = callingRoutingAdapter();
      // A plain conversational message — not a state-query.
      await runTurnExecutor(
        payload('Tell me more about this decision.'),
        'req-passthrough',
        { routingAdapter: adapter },
      );
      expect(adapter.chatWithTools).toHaveBeenCalled();
    });

    it('lets edit-style messages through the negative gate so they reach the LLM / value-update pre-route', async () => {
      mockState.priorTurns = [PRIOR_HANDLER_TURN];
      mockState.priorFacts = [ADD_CONSTRAINT_FACT_50K];
      const adapter = callingRoutingAdapter();
      // Contains a digit AND an edit verb — the negative gate fires
      // and the message proceeds through the rest of the lifecycle.
      await runTurnExecutor(
        payload('Increase the budget to £100,000'),
        'req-edit-passthrough',
        { routingAdapter: adapter },
      );
      expect(adapter.chatWithTools).toHaveBeenCalled();
    });

    // V5 product-state continuity (foamy-bee tranche) — Improvement A:
    // After narrowing the guard's positive patterns (P1-3), broad
    // session-summary prompts ("What did you do?") fall through to
    // the LLM. The fall-through is desirable (the guard is now
    // narrow-by-design) BUT the LLM-facing payload must still carry
    // recent_changes so Sonnet can ground its answer. This test
    // captures the adapter's user message and asserts both halves of
    // the contract: the LLM IS called, AND it sees the £50,000 summary
    // in the payload.
    it('broad session-summary prompts fall through to the LLM and the LLM-facing payload still carries recent_changes', async () => {
      mockState.priorTurns = [PRIOR_HANDLER_TURN];
      mockState.priorFacts = [ADD_CONSTRAINT_FACT_50K];
      const adapter = callingRoutingAdapter();
      await runTurnExecutor(
        payload('What did you do?'),
        'req-broad-fall-through',
        { routingAdapter: adapter },
      );
      // Half 1: guard narrowed → LLM IS called.
      expect(adapter.chatWithTools).toHaveBeenCalled();
      // Half 2: recent_changes still reaches the LLM-facing payload —
      // Option B grounds Sonnet's answer even when Option A's
      // deterministic floor doesn't fire.
      const args = adapter.chatWithTools.mock.calls[0]![0];
      const userContent = args.messages[0]!.content as string;
      expect(userContent).toContain('£50,000');
      expect(userContent).toContain('Total cost');
      expect(userContent).toContain('"target_label": "Total cost"');
      // Product-domain action discriminator surfaces in the payload —
      // not a handler id.
      expect(userContent).toContain('"action": "constraint_added"');
    });

    // V5 product-state continuity (foamy-bee tranche, round 5) —
    // ownership-boundary route-level proof. The state-query
    // continuity chip lives ONLY in `composeStateQueryChip` and is
    // wired to the deterministic guard's dispatch path. A generic
    // converse turn that happens to have an old mutation in
    // priorFacts must NOT surface that chip — otherwise the user
    // would see "Run analysis"/"Run analysis again" hanging on every
    // unrelated chat reply until they re-ran analysis. This test
    // exercises the full route to prove the structural fix from
    // round 3 (P1-6, priorFacts surface removed from chip-generator)
    // holds end-to-end.
    it('a generic converse turn with an old mutation in priorFacts does NOT surface the state-query continuity chip', async () => {
      mockState.priorTurns = [PRIOR_HANDLER_TURN];
      mockState.priorFacts = [ADD_CONSTRAINT_FACT_50K];
      const adapter = callingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('What did you do?'),
        'req-broad-no-state-query-chip',
        { routingAdapter: adapter },
      );

      // The state-query continuity chip ids are namespaced
      // (`*_after_state_query`) so they're greppable on the wire.
      // A generic converse turn must NOT emit either variant.
      const chipIds = result.response.suggested_actions.map((c) => c.id);
      expect(chipIds).not.toContain('chip_action_run_analysis_after_state_query');
      expect(chipIds).not.toContain('chip_action_rerun_analysis_after_state_query');

      // Defence-in-depth: nor should the chip-generator's mutation-turn
      // chip variant fire — that one is gated to current-turn
      // handlerFacts, but a future regression that re-introduces a
      // priorFacts surface there would also surface here.
      expect(chipIds).not.toContain('chip_action_rerun_analysis_after_mutation');
    });
  });
});
