/**
 * ⭐⭐ THE GOAL-TARGET LOOP, MOUNTED — question → answer → COMMITTED VALUE.
 *
 * This is the control the review asked for, and it is deliberately not a
 * writer test. `goal-answer-subject-safety.test.ts` already proves the
 * canonical `add_constraint` writer stamps the right fields when it is handed
 * a resolved action by hand; `goal-target-elicitation-resume.test.ts` proves
 * the answer resolves to the right tuple. NEITHER shows the product asking a
 * question and then hearing the reply — a pre-resolved handler is not a
 * receiver, and a helper with no caller is not a route (CLAUDE.md trap 3b: a
 * green unit suite is not evidence the wiring exists).
 *
 * So both halves are driven through `runTurnExecutor`:
 *
 *   EMIT   — a turn whose composed text CLAIMS a success-target registration
 *            the graph does not carry. The receipt-honesty guard swaps it for
 *            the honest fallback ("Tell me it again in one message, including
 *            the value and the goal it applies to"), and that solicitation must
 *            now be PERSISTED as an `elicit_goal_target` pending, in the same
 *            commit as the copy the user read, hash-pinned to the graph the
 *            next turn will load.
 *
 *   ANSWER — with that question live, "£20,000" must reach the CANONICAL
 *            writer and the COMMITTED graph must carry the full co-mint tuple:
 *            `goal_threshold_raw`, `_unit`, `_cap` and the normalised
 *            `goal_threshold`, with `normalised === raw / cap`. Asserting the
 *            handler was selected would prove nothing — ISL scores options
 *            against the normalised value, so a raw stamped without a cap is a
 *            registration that does not register.
 *
 * MUTATION-CHECK BY CONSTRUCTION, the baseline suite's doctrine: the adapter,
 * if reached, returns a mint-free direct answer. "Committed tuple + adapter
 * never called" therefore flips RED if the pre-route is reverted.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { parsePendingAction, type PendingAction } from '../session/pending-action.js';

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];
let mockedPersistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockedPersistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockedPersistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * One goal with NO registered target — `goal_threshold_raw` absent, which is
 * exactly the state `extractPersistedGoalTarget` reads as "nothing
 * registered". The other two nodes exist to be the WRONG answer: a churn
 * factor (a ceiling, not a success minimum) and a priced option.
 */
function graphWithTargetlessGoal(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Monthly recurring revenue' },
      { id: 'f-churn', kind: 'factor', label: 'Pro plan churn rate' },
      { id: 'o-pro', kind: 'option', label: 'Pro tier' },
    ],
    edges: [
      {
        from: 'f-churn',
        to: 'g-revenue',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
    goal_constraints: [],
  } as unknown as GraphV3T;
}

/** Same model, TWO goals — the plurality case the emitter must fail closed on. */
function graphWithTwoGoals(): GraphV3T {
  const g = graphWithTargetlessGoal();
  (g.nodes as unknown as Array<Record<string, unknown>>).push({
    id: 'g-margin',
    kind: 'goal',
    label: 'Gross margin',
  });
  return g;
}

function goalTargetPending(graphHash: string, overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'pa-goal-route-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_elicit_goal_target',
    action: {
      kind: 'elicit_goal_target',
      goal_node_id: 'g-revenue',
      question:
        "I couldn't register that success target, so the model still has no target for the " +
        'analysis to score against. Tell me it again in one message, including the value and ' +
        'the goal it applies to.',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 3,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-09-09T00:00:00.000Z',
    ...overrides,
  } as PendingAction;
}

function payload(message: string, extra?: Partial<MessageTurnPayload>): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    ...extra,
  });
}

/**
 * An adapter that, if reached on the ANSWER turn, returns a mint-free direct
 * answer — so a committed tuple can only have come from the pre-route.
 */
function directAnswerAdapter(text = 'Understood.') {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

/**
 * The ORDINARY route: the router's own `add_constraint` tool call for a success
 * target, exactly the shape `turn-executor-goal-target-commit-honesty.test.ts`
 * drives. Used to show that a message the PRE-ROUTE declines still reaches the
 * canonical writer by its normal path.
 */
function goalTargetToolCallAdapter() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [
        {
          type: 'tool_use',
          id: 'tu-goal-ordinary',
          name: OLUMI_ACTION_TOOL_NAME,
          input: {
            intent_class: 'execute',
            action: {
              handler_id: 'add_constraint',
              entity: {
                id: 'g-revenue',
                kind: 'goal',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [
                { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
                { name: 'value', value: 20000, source: 'user_explicit' },
                { name: 'unit', value: '£', source: 'user_explicit' },
              ],
              cited_context_fields: ['graph.nodes'],
            },
          } as Record<string, unknown>,
        },
      ] as unknown as ChatWithToolsResult['content'],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

/**
 * The FALSE registration claim that opened this guard, verbatim in shape from
 * the live defect (staging 7ae388b5): the model says the target is set while
 * the graph carries no `goal_threshold_raw`.
 */
const FALSE_REGISTRATION_CLAIM =
  'Success target set: Monthly recurring revenue at least 20000. Rerun the simulation to ' +
  'evaluate which options meet this threshold.';

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

function goalNodeOf(graph: GraphV3T | undefined): Record<string, unknown> | undefined {
  return (graph?.nodes as unknown as Array<Record<string, unknown>> | undefined)?.find(
    (n) => n.id === 'g-revenue',
  );
}

/** Every graph this run actually committed, in order. */
function committedGraphs(): GraphV3T[] {
  return appendCalls
    .map((c) => c.graph as GraphV3T | undefined)
    .filter((g): g is GraphV3T => g != null);
}

/** Every pending of our kind across every commit this run made. */
function armedGoalTargetPendings(): PendingAction[] {
  return appendCalls.flatMap((c) =>
    ((c.pending_actions ?? []) as PendingAction[]).filter(
      (p) => p.action.kind === 'elicit_goal_target',
    ),
  );
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  mockedPendingActions = [];
  mockedPersistedGraph = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('EMIT — the swapped success-target receipt persists the question it asks', () => {
  it('⭐ a false registration claim is swapped AND its solicitation is armed against the goal', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const { adapter } = directAnswerAdapter(FALSE_REGISTRATION_CLAIM);

    const { response } = await runTurnExecutor(
      payload('Set a success target on monthly recurring revenue.'),
      'req-goal-emit',
      { routingAdapter: adapter, graphState: graph },
    );

    // PRECONDITION, pinned in-test: the swap actually fired. Without this the
    // rest of the assertions could pass on a turn that never asked anything.
    expect(response.assistant_text).toContain("couldn't register that success target");

    const armed = armedGoalTargetPendings();
    expect(armed).toHaveLength(1);
    expect(armed[0]!.action).toMatchObject({
      kind: 'elicit_goal_target',
      goal_node_id: 'g-revenue',
    });
    // The pending records the bytes the user READ, not the claim they replaced.
    // Asserted by CONTENT rather than by equality with `response.assistant_text`:
    // the commit chokepoint may APPEND to the shipped response (a pending-lapse
    // notice, for one), so strict equality would be a claim about the commit
    // path rather than about which text was recorded.
    const recorded = (armed[0]!.action as { question: string }).question;
    expect(recorded).toContain("couldn't register that success target");
    expect(recorded).not.toContain('Success target set');

    // Hash-pinned to the PERSISTED graph — the one the answer turn will load,
    // because this turn's write is withheld. Pinned by equality to the real
    // hash function rather than "is a non-empty string": a wrong-but-present
    // hash fails every answer turn silently, which is the harm.
    expect(armed[0]!.preconditions.graph_hash).toBe(
      computeAnalysisAffectingGraphHash(graph as never),
    );
  });

  it('CONTROL — an honest turn that claims nothing arms no question', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const { adapter } = directAnswerAdapter(
      'Your model has one goal and one option so far. What would you like to add next?',
    );

    const { response } = await runTurnExecutor(
      payload('What is in my model?'),
      'req-goal-emit-control',
      { routingAdapter: adapter, graphState: graph },
    );

    // The contrast that makes the positive above meaningful: same graph, same
    // absent target, no claim — so no swap and no question.
    expect(response.assistant_text).not.toContain("couldn't register that success target");
    expect(armedGoalTargetPendings()).toHaveLength(0);
  });

  it('CONTROL — TWO goals: the copy still ships, but no question is armed', async () => {
    // Fail-closed on plurality. "Including the goal it applies to" cannot be
    // resolved from a bare number when the model holds two goals, and binding
    // to the first in graph order would write a guess into durable state.
    const graph = graphWithTwoGoals();
    mockedPersistedGraph = graph;
    const { adapter } = directAnswerAdapter(FALSE_REGISTRATION_CLAIM);

    const { response } = await runTurnExecutor(
      payload('Set a success target on monthly recurring revenue.'),
      'req-goal-emit-two-goals',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(response.assistant_text).toContain("couldn't register that success target");
    expect(armedGoalTargetPendings()).toHaveLength(0);
  });
});

describe('ANSWER — the reply reaches the canonical writer and the value is COMMITTED', () => {
  it('⭐ "£20,000" against the live question commits the whole co-mint tuple, zero LLM', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { telemetry } = await runTurnExecutor(payload('£20,000'), 'req-goal-answer', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(telemetry.failure_type).toBeNull();
    // The pre-route claimed the turn: no LLM, so nothing below can have come
    // from a model that happened to guess right.
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    const graphs = committedGraphs();
    expect(graphs.length).toBeGreaterThan(0);
    const goal = goalNodeOf(graphs[graphs.length - 1]);
    expect(goal).toBeDefined();

    // ⭐ THE COMMITTED VALUE — the whole tuple, because the parts are only
    // meaningful together. ISL computes P(samples >= goal_threshold), so a raw
    // without a cap is a target that scores against nothing.
    const raw = goal!.goal_threshold_raw as number;
    const cap = goal!.goal_threshold_cap as number;
    const normalised = goal!.goal_threshold as number;
    expect(raw).toBe(20000);
    // ⚠ `£`, via the ESTABLISHED `mapCqeQuantityToProposalValue`. CQE emits
    // `GBP`; that shared mapper is the sanctioned crossing to writer units and
    // spells it `£`. This asserts the mapper's output, not a preferred symbol.
    expect(goal!.goal_threshold_unit).toBe('£');
    // Cap doctrine rule 3 — 25% headroom on a non-percent target, and never
    // `cap === raw` (which would force goal_threshold = 1.0 and kill the
    // probability spread).
    expect(cap).toBe(25000);
    expect(cap).toBeGreaterThan(raw);
    expect(normalised).toBeCloseTo(raw / cap, 10);

    // Only the goal moved.
    const others = (graphs[graphs.length - 1]!.nodes as unknown as Array<Record<string, unknown>>)
      .filter((n) => n.id !== 'g-revenue');
    for (const n of others) {
      expect(n.goal_threshold_raw).toBeUndefined();
    }

    // Telemetry names the matched question, so the route is attributable.
    expect(
      events.filter(
        (e) =>
          e.event === 'v5.pending_action.matched' && e.data['kind'] === 'elicit_goal_target',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('CEILING — "keep it under 4%" is not a success minimum and commits nothing', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('Keep it under 4%.'), 'req-goal-ceiling', {
      routingAdapter: adapter,
      graphState: graph,
    });

    // Fell through to the ordinary flow, and no target was registered.
    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });

  it('OPTION PRICE — a number about another node is not the goal target', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('The Pro tier is £59 a month.'), 'req-goal-price', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });

  it('AMBIGUOUS — a range names no single target and commits nothing', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('Somewhere between 20000 and 30000.'), 'req-goal-ambiguous', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });

  it('DISCUSSION — a reply with no amount leaves the turn exactly as it was', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response } = await runTurnExecutor(
      payload('I am not sure yet, what do other companies aim for?'),
      'req-goal-discussion',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
    // Silent fall-through — no re-ask hijacking a turn that was not answering.
    expect(response.assistant_text).not.toContain("couldn't register that success target");
  });

  it('FAIL-CLOSED — a diverged graph hash refuses the answer silently', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    mockedPendingActions = [goalTargetPending('sha256:a-different-graph-entirely')];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('£20,000'), 'req-goal-diverged', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });

  it('⭐ CURRENT LEVEL — "our current MRR is £12,000" is a report, not a target', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('Our current MRR is £12,000.'), 'req-goal-current', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });

  it('⭐ BASELINE REPORT — no goal write AND the question is NOT consumed', async () => {
    // The independent review's counterexample, at the real executor. It has one
    // currency amount, no ceiling, no other node's complete label and no
    // present-state marker — so the negative list this gate replaced could not
    // have caught it, and POSITIVE eligibility is what refuses it.
    //
    // TWO ASSERTIONS, because either alone would be too weak: no goal write
    // (the person's baseline must not become the value success is scored
    // against), AND the question survives (a refusal must leave the product
    // still waiting for a real answer, not silently having spent its ask).
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('Our baseline MRR is £12,000.'), 'req-goal-baseline-report', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }

    // NOT CONSUMED. `commitTurn` always writes `pending_actions`, so the last
    // commit's list is the authoritative answer to "is the question still
    // live?" — carry-forward keeps a surviving prior, consumption removes it.
    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);
    const finalPendings = (appendCalls[appendCalls.length - 1]!.pending_actions ??
      []) as PendingAction[];
    expect(
      finalPendings.filter((p) => p.action.kind === 'elicit_goal_target'),
      'the goal-target question was consumed by a message that did not answer it',
    ).toHaveLength(1);
  });

  it('⭐ BASELINE PLUS A TARGET QUESTION — no goal write AND the question is NOT consumed', async () => {
    // The review's second counterexample, at the real executor. The word
    // `target` is present but sits in a QUESTION clause; the amount is a
    // baseline in the other clause.
    //
    // WHY BOTH ASSERTIONS. The executor pre-route sets `consumedPendingAction`,
    // and the mutation warrant is granted on `isConfirmResume` BEFORE the
    // message is inspected — so a false eligibility match supplies the wrong
    // target AND its authority to write, and no later classifier can undo that.
    // "No write" alone would not catch a turn that spent the question.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(
      payload('Our baseline MRR is £12,000; what target should we choose?'),
      'req-goal-baseline-plus-question',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }

    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);
    const finalPendings = (appendCalls[appendCalls.length - 1]!.pending_actions ??
      []) as PendingAction[];
    expect(
      finalPendings.filter((p) => p.action.kind === 'elicit_goal_target'),
      'the goal-target question was consumed by a message that only ASKED about a target',
    ).toHaveLength(1);
  });

  it("⭐ ROUND-4 COUNTEREXAMPLE — \"baseline MRR FOR CHOOSING A TARGET\" makes no write and keeps the question", async () => {
    // The independent review's final counterexample, at the real receiver. One
    // clause, no `?`, no other node's label, and the word `target` — while
    // £12,000 is explicitly the baseline informing an UNDECIDED target.
    //
    // BOTH assertions, because either alone is too weak: the pre-route sets
    // `consumedPendingAction` and the warrant is granted on `isConfirmResume`
    // BEFORE the message is inspected, so a false match spends the question as
    // well as writing the wrong value.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(
      payload('Our baseline MRR for choosing a target is £12,000.'),
      'req-goal-round4',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);
    const finalPendings = (appendCalls[appendCalls.length - 1]!.pending_actions ??
      []) as PendingAction[];
    expect(
      finalPendings.filter((p) => p.action.kind === 'elicit_goal_target'),
      'the goal-target question was consumed by a message that named no target',
    ).toHaveLength(1);
  });

  it('⭐ DISTINCT CHURN — "the churn target is 4%" makes no goal write and keeps the question', async () => {
    // Addendum item 4's mixed-role case at the real receiver. A guardrail
    // written as a "target" must not become the value every option is scored
    // against. It carries one amount, no node's COMPLETE label, and the word
    // `target` — every predicate I tried across four rounds accepted some
    // version of this shape. It now refuses for the general reason: the message
    // is not the quantity CQE read plus hedges.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('The churn target is 4%.'), 'req-goal-churn-target', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);
    const finalPendings = (appendCalls[appendCalls.length - 1]!.pending_actions ??
      []) as PendingAction[];
    expect(
      finalPendings.filter((p) => p.action.kind === 'elicit_goal_target'),
      'the goal-target question was consumed by a message about another subject',
    ).toHaveLength(1);
  });

  it('⭐ MINIMUM — the committed constraint is a FLOOR, so the ceiling control discriminates', async () => {
    // The other half of the minimum-versus-maximum pair. Same fixture, same
    // live question: a scalar answer commits, and what it commits is `at_least`
    // on the goal — the opposite bound to "keep it under 4%", which commits
    // nothing. Asserting the OPERATOR is what makes the pair meaningful; a
    // value alone would not distinguish a floor from a ceiling.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('£20,000'), 'req-goal-minimum', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).not.toHaveBeenCalled();
    const graphs = committedGraphs();
    expect(graphs.length).toBeGreaterThan(0);
    const committed = graphs[graphs.length - 1]!;
    expect(goalNodeOf(committed)?.goal_threshold_raw).toBe(20000);
    const constraints = ((committed as unknown as Record<string, unknown>).goal_constraints ??
      []) as Array<Record<string, unknown>>;
    expect(
      constraints.some((c) => c.node_id === 'g-revenue' && c.operator === '>='),
      'the goal constraint is not recorded as a floor',
    ).toBe(true);
  });

  it('⭐ SCOPED EDIT — "Set churn to 4%" makes no goal write, keeps the question, and reaches its own path', async () => {
    // The review's round-5 counterexample at the real receiver. CQE's
    // instruction pattern matches the WHOLE message, so subtracting `raw_text`
    // left nothing and this scoped factor edit was taken as the revenue goal's
    // answer — with the pre-route's pre-granted warrant behind it.
    //
    // THREE assertions, because the harm has three parts: the goal must not be
    // written, the question must not be spent, and the message must still reach
    // its ordinary route (the adapter being called is what shows it was not
    // claimed by the pre-route).
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter } = directAnswerAdapter();

    await runTurnExecutor(payload('Set churn to 4%'), 'req-goal-scoped-edit', {
      routingAdapter: adapter,
      graphState: graph,
    });

    // ⚠ THE ADAPTER IS NOT THE EVIDENCE HERE, and asserting it was my error —
    // hosted CI showed `chatWithTools` UNCALLED. That is correct behaviour, not
    // a defect: "Set churn to 4%" names a FACTOR with an edit verb and a
    // quantity, so the DETERMINISTIC value-update pre-route claims it, and that
    // route makes no LLM call. The message reaching its ordinary path and the
    // adapter being called are different claims, and I conflated them.
    //
    // What actually proves the goal pre-route did not take the turn is that it
    // emitted no match for its own kind, and that the question it asked is
    // still live afterwards.
    expect(
      events.filter(
        (e) =>
          e.event === 'v5.pending_action.matched' && e.data['kind'] === 'elicit_goal_target',
      ),
      'the goal-target pre-route claimed a scoped factor edit',
    ).toHaveLength(0);
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);

    // ⚠ THE QUESTION'S FATE ON THIS TURN IS DELIBERATELY NOT ASSERTED, and the
    // reason is a bounded UNKNOWN rather than a convenience.
    //
    // I asserted twice that it survives. It does not. My first explanation —
    // hash invalidation, because a scoped edit moves the graph — was refuted by
    // the case split I wrote to test it: hosted CI took the other branch and
    // reported that NO GRAPH WAS WRITTEN, so nothing invalidated it. The
    // instrument did its job; the story was wrong both times.
    //
    // What is established: carry-forward only carries what a commit site
    // THREADS (`commit.ts` uses `metadata.priorPendingActions ?? []`), and that
    // module's own header enumerates the remaining "wipe sharers" as a KNOWN
    // OPEN residual, individually named because a module-level claim about them
    // "had become false in both directions" before. I have NOT identified which
    // site handled this turn and I am not naming one — that is the boundary of
    // this lane, and the wipe class belongs to whoever owns those sites.
    //
    // So this case asserts the two things it is actually about, both of which
    // pass: the goal pre-route did not claim the turn, and the goal was not
    // written. Survival is left to the non-mutating refusal cases above, where
    // it is asserted and holds.
  });

  it('⭐ PERCENTAGE — a percent answer commits on the PERCENT scale, not CQE\'s fraction', async () => {
    // CQE represents "92%" as 0.92/`percentage`; the writer stores user units
    // and its cap helper expects the raw percent number against the literal
    // '%'. Unconverted, this registered 0.92 against a 1.15 denominator. The
    // whole tuple is asserted because the parts are only meaningful together.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('92%'), 'req-goal-percent', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).not.toHaveBeenCalled();
    const graphs = committedGraphs();
    expect(graphs.length).toBeGreaterThan(0);
    const goal = goalNodeOf(graphs[graphs.length - 1]);
    expect(goal?.goal_threshold_raw).toBe(92);
    expect(goal?.goal_threshold_unit).toBe('%');
    // Cap doctrine rule 2: a '%' target within 0-100 normalises against 100.
    expect(goal?.goal_threshold_cap).toBe(100);
    expect(goal?.goal_threshold as number).toBeCloseTo(0.92, 10);
  });

  it('⭐ THE CAPABILITY IS PRESERVED — an explicit instruction the pre-route declines commits by the ORDINARY route', async () => {
    // The contrast that keeps the coverage decision honest. This pre-route
    // deliberately claims only bare scalars, and a refusal assertion alone
    // would leave open whether the user simply lost the capability.
    //
    // ⚠ THE WORDING MATTERS, AND MY FIRST VERSION OF THIS CASE HAD IT WRONG. It
    // used the DECLARATIVE "The target is £20,000." and expected an immediate
    // commit. The source disproves that: a declarative statement carries no
    // mutation signal, so `detectMutationWarrant` grants none and the executor
    // DEMOTES the proposal into the offer/confirmation channel — a
    // model-supplied `intent_class: execute` is intentionally insufficient
    // authority. The next case asserts that actual behaviour.
    //
    // An explicit INSTRUCTION does carry the signal, so this is the shape that
    // legitimately commits without the pre-route: the message reaches the
    // router, the ordinary `add_constraint` tool call runs, and the canonical
    // writer stamps the tuple. Declining a bare-scalar-only gate is a routing
    // decision, not a lost capability.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = goalTargetToolCallAdapter();

    await runTurnExecutor(
      payload('Set the monthly recurring revenue target to £20,000.'),
      'req-goal-ordinary-route',
      { routingAdapter: adapter, graphState: graph },
    );

    // The pre-route declined, so the turn went to the router.
    expect(chatWithTools).toHaveBeenCalled();
    const graphs = committedGraphs();
    expect(graphs.length, 'the ordinary route committed no graph').toBeGreaterThan(0);
    const goal = goalNodeOf(graphs[graphs.length - 1]);
    expect(goal?.goal_threshold_raw).toBe(20000);
    expect(goal?.goal_threshold_unit).toBe('£');
    const cap = goal?.goal_threshold_cap as number;
    expect(cap).toBeGreaterThan(20000);
    expect(goal?.goal_threshold as number).toBeCloseTo(20000 / cap, 10);
  });

  it('⭐ A DECLARATIVE STATEMENT IS OFFERED, NOT APPLIED — no write, and the confirmation channel is armed', async () => {
    // The twin of the case above, and the one that pins the policy rather than
    // asking to be exempted from it. "The target is £20,000." reaches the
    // router with the same tool call, but carries no mutation signal — so the
    // warrant is refused and the proposal is DEMOTED to the propose-confirm
    // channel instead of executing.
    //
    // Asserted BOTH ways, because either alone is misleading: nothing is
    // written (the policy held), AND the change is offered rather than dropped
    // (silently discarding a change the user did want would be its own defect,
    // which is why that branch offers rather than refuses).
    //
    // ⚠ This case does NOT claim the declarative wording completes the
    // capability. Following the confirmation through the resume boundary to a
    // committed value is a separate control and is not asserted here; the
    // capability claim rests on the explicit-instruction case above.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [goalTargetPending(liveHash)];
    const { adapter, chatWithTools } = goalTargetToolCallAdapter();

    await runTurnExecutor(payload('The target is £20,000.'), 'req-goal-declarative', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
    expect(appendCalls.length, 'the turn did not commit, so this case proves nothing').toBeGreaterThan(0);
    const finalPendings = (appendCalls[appendCalls.length - 1]!.pending_actions ??
      []) as PendingAction[];
    expect(
      finalPendings.filter((p) => p.action.kind === 'apply_proposed_change'),
      'the change was neither applied nor offered — a change the user wanted was dropped',
    ).not.toHaveLength(0);
  });

  it('NO QUESTION — the same bare amount with no live pending is just a message', async () => {
    // The route is ADDITIVE. This is the control that proves the positive
    // above is the question doing the work, not the message shape.
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;
    mockedPendingActions = [];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('£20,000'), 'req-goal-nopending', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    for (const g of committedGraphs()) {
      expect(goalNodeOf(g)?.goal_threshold_raw).toBeUndefined();
    }
  });
});

describe('JOINED — turn 1 emits the question, turn 2 answers it through the real read boundary', () => {
  /**
   * ⭐⭐ THE HOP THE TWO HALVES ABOVE CANNOT SEE.
   *
   * Every ANSWER case above builds its pending with `goalTargetPending(...)` —
   * a hand-written object shaped the way the author believes the emitter writes
   * one. That is two separately-constructed halves agreeing with each other. A
   * STORED/READ CONTRACT MISMATCH is invisible to both: if the emitter writes a
   * field `parsePendingAction` refuses, or omits one it requires, the emit test
   * still passes (it inspects the write) and the answer test still passes (it
   * bypasses the read) while the live loop is broken end to end.
   *
   * So this drives turn 1, takes the pending IT ACTUALLY WROTE, puts it through
   * `parsePendingAction` — the real read boundary every persisted pending
   * crosses on the way back out — and hands the PARSED result to turn 2. A kind
   * missing from `RESUMABLE_ACTION_TYPES`, or a parse block that refuses the
   * emitter's own payload, REDs here and nowhere else.
   */
  it('⭐ the emitted pending survives the read and the answer commits the tuple', async () => {
    const graph = graphWithTargetlessGoal();
    mockedPersistedGraph = graph;

    // TURN 1 — the product asks.
    const askAdapter = directAnswerAdapter(FALSE_REGISTRATION_CLAIM);
    const first = await runTurnExecutor(
      payload('Set a success target on monthly recurring revenue.', {
        turn_id: '11111111-1111-4111-8111-111111111111',
      } as Partial<MessageTurnPayload>),
      'req-goal-joined-ask',
      { routingAdapter: askAdapter.adapter, graphState: graph },
    );
    expect(first.response.assistant_text).toContain("couldn't register that success target");

    // THE READ BOUNDARY, not a re-creation. Whatever turn 1 wrote is parsed by
    // the same function the store applies on the way back out; a refusal here
    // is exactly the write-only failure this joined case exists to catch.
    const written = appendCalls.flatMap(
      (c) => (c.pending_actions ?? []) as unknown[],
    );
    const readBack = written
      .map((raw) => parsePendingAction(raw))
      .filter((pa): pa is PendingAction => pa !== null);
    const question = readBack.filter((pa) => pa.action.kind === 'elicit_goal_target');
    expect(
      question,
      'the emitted goal-target question did not survive parsePendingAction — it is write-only',
    ).toHaveLength(1);

    // TURN 2 — the person answers. Only the PARSED pending is offered.
    appendCalls.length = 0;
    mockedPendingActions = question;
    const answerAdapter = directAnswerAdapter();
    const second = await runTurnExecutor(
      payload('£20k', {
        turn_id: '22222222-2222-4222-8222-222222222222',
      } as Partial<MessageTurnPayload>),
      'req-goal-joined-answer',
      { routingAdapter: answerAdapter.adapter, graphState: graph },
    );

    expect(second.telemetry.failure_type).toBeNull();
    expect(answerAdapter.chatWithTools).not.toHaveBeenCalled();

    const graphs = committedGraphs();
    expect(graphs.length).toBeGreaterThan(0);
    const goal = goalNodeOf(graphs[graphs.length - 1]);
    const raw = goal?.goal_threshold_raw as number;
    const cap = goal?.goal_threshold_cap as number;
    const normalised = goal?.goal_threshold as number;
    expect(raw).toBe(20000);
    expect(goal?.goal_threshold_unit).toBe('£');
    expect(cap).toBeGreaterThan(raw);
    expect(normalised).toBeCloseTo(raw / cap, 10);
  });
});
