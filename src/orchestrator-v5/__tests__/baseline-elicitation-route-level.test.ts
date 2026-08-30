/**
 * ROADMAP 2.918 — route-level pins for the baseline-elicitation loop, both
 * halves MOUNTED in the executor (trap 3b: a green unit suite is not evidence
 * the wiring exists):
 *
 *   EMIT — an add_constraint turn on the mintable-and-baseline-less cell must
 *   PERSIST the pending question in the same commit as the receipt that asks
 *   it. Driven through the typed-chip mutation route so the turn is fully
 *   deterministic (no LLM), which also proves the channel rides the ordinary
 *   handler-execute commit path, not a special one.
 *
 *   RESUME — with the pending question live and the graph unchanged, the
 *   bare answer "about 12%" must dispatch the add_constraint replay with ZERO
 *   LLM calls and commit the minted baseline on the named target.
 *   MUTATION-CHECK BY CONSTRUCTION (same doctrine as the typed-chip suite):
 *   the LLM adapter, if reached, returns a plain direct answer that commits
 *   nothing — so a green "baseline committed + adapter never called" pair
 *   flips RED if the pre-route wiring is reverted.
 *
 *   FAIL-CLOSED — a diverged graph hash must fall through SILENTLY to the
 *   normal flow (adapter called, nothing minted, no recovery copy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  type PendingAction,
} from '../session/pending-action.js';

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];

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
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * A NON-ROOT outcome 'Churn rate' with no baseline; the persisted level-framed
 * '%' row rides `goal_constraints` (the RESUME fixtures' state-class — the ask
 * turn persists the row and the pending in one commit, so every answer turn
 * replays against a graph that carries both).
 */
function graphWithFramedRow(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-quality', kind: 'factor', label: 'Product quality' },
      { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' },
    ],
    edges: [
      {
        from: 'f-quality',
        to: 'o-churn-rate',
        strength: { mean: -0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
    goal_constraints: [
      {
        constraint_id: 'gc-live-1',
        node_id: 'o-churn-rate',
        operator: '<=',
        value: 10,
        label: 'Churn rate',
        provenance: 'explicit',
        unit: '%',
        value_frame: 'level',
      },
    ],
  } as unknown as GraphV3T;
}

/** Same graph, no persisted row — the EMIT fixture (first registration). */
function graphWithoutRow(): GraphV3T {
  const g = graphWithFramedRow();
  (g as { goal_constraints?: unknown[] }).goal_constraints = [];
  return g;
}

function elicitPending(graphHash: string, overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'pa-elicit-route-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: 'Churn rate',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as PendingAction;
}

function payload(message: string, extra?: Partial<MessageTurnPayload>): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    ...extra,
  });
}

/** An adapter that, if reached, returns a mint-free direct answer. */
function directAnswerAdapter() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [{ type: 'text', text: 'Understood.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  mockedPendingActions = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('2.918 EMIT — the ask turn persists the pending question in the same commit', () => {
  it('typed add_constraint chip on the cell → question in the receipt, pending in the commit, zero LLM', async () => {
    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Keep churn rate under 10%.', {
        source: 'chip_click',
        chip: {
          action_type: 'add_constraint',
          parameters: { target_id: 'o-churn-rate', constraint_type: 'at_most', value: 10, unit: '%' },
        },
      } as Partial<MessageTurnPayload>),
      'req-2918-emit',
      { routingAdapter: adapter, graphState: graphWithoutRow() },
    );

    expect(telemetry.failure_type).toBeNull();
    expect(chatWithTools).not.toHaveBeenCalled();

    // The receipt asks the one question, naming the target.
    expect(response.assistant_text).toContain('Roughly what percentage is Churn rate at right now?');

    // The commit carries the pending question, hash-pinned to the committed graph.
    expect(appendCalls).toHaveLength(1);
    const pendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    const elicit = pendings.filter((p) => p.action.kind === 'elicit_target_baseline');
    expect(elicit).toHaveLength(1);
    expect(elicit[0]!.action).toMatchObject({
      kind: 'elicit_target_baseline',
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
    });
    const persistedHash = elicit[0]!.preconditions.graph_hash;
    expect(typeof persistedHash).toBe('string');
    expect((persistedHash as string).length).toBeGreaterThan(0);
    // Hash-pinned to the COMMITTED (post-mutation) graph, so the answer-turn
    // resume's divergence gate reads the right baseline.
    expect(persistedHash).toBe(
      computeAnalysisAffectingGraphHash(appendCalls[0]!.graph as never),
    );
  });

  it('CONTROL — a minting turn (level stated) persists NO pending question', async () => {
    const { adapter } = directAnswerAdapter();
    await runTurnExecutor(
      payload('Churn rate is 12% today. Keep churn rate under 10%.', {
        source: 'chip_click',
        chip: {
          action_type: 'add_constraint',
          parameters: { target_id: 'o-churn-rate', constraint_type: 'at_most', value: 10, unit: '%' },
        },
      } as Partial<MessageTurnPayload>),
      'req-2918-emit-control',
      { routingAdapter: adapter, graphState: graphWithoutRow() },
    );
    const pendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(pendings.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);
    // And the mint landed instead.
    const committed = appendCalls[0]!.graph as GraphV3T;
    expect(committed.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBe(
      0.12,
    );
  });
});

describe('2.918 RESUME — the bare answer dispatches the replay with zero LLM calls', () => {
  it('"about 12%" against the live question mints the baseline on the named target', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('about 12%'),
      'req-2918-resume',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(telemetry.failure_type).toBeNull();
    // ZERO LLM calls — the pre-route claimed the turn.
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    // The committed graph carries the minted baseline, on the named target only.
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const target = committed.nodes.find((n) => n.id === 'o-churn-rate');
    expect(target?.observed_state?.baseline).toBe(0.12);
    expect(target?.observed_state?.unit).toBe('fraction');
    expect(target?.observed_state?.cap).toBe(1);
    for (const n of committed.nodes) {
      if (n.id === 'o-churn-rate') continue;
      expect(n.observed_state?.baseline).toBeUndefined();
    }

    // The receipt confirms the noted level; no re-ask.
    expect(response.assistant_text).toContain('Noted Churn rate is currently at 12%.');
    expect(response.assistant_text).not.toContain('Roughly what percentage');

    // The answered question was CONSUMED — it does not carry forward.
    const persistedPendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(
      persistedPendings.filter((p) => p.action.kind === 'elicit_target_baseline'),
    ).toHaveLength(0);

    // Telemetry: the pending was matched.
    const matched = events.filter(
      (e) =>
        e.event === 'v5.pending_action.matched' &&
        e.data['kind'] === 'elicit_target_baseline',
    );
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  it('FAIL-CLOSED — a diverged graph hash falls through silently to the normal flow', async () => {
    const graph = graphWithFramedRow();
    mockedPendingActions = [elicitPending('sha256:something-else-entirely')];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response } = await runTurnExecutor(payload('about 12%'), 'req-2918-diverged', {
      routingAdapter: adapter,
      graphState: graph,
    });

    // The turn reached the ordinary LLM path; nothing was minted.
    expect(chatWithTools).toHaveBeenCalled();
    const committedGraphs = appendCalls
      .map((c) => c.graph as GraphV3T | undefined)
      .filter((g): g is GraphV3T => g != null);
    for (const g of committedGraphs) {
      expect(g.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBeUndefined();
    }
    // Silent lapse: no recovery copy about expiry or divergence.
    expect(response.assistant_text).not.toContain('lapsed');
    expect(response.assistant_text).not.toContain('has changed since');
  });

  it('FAIL-CLOSED — no live question means "about 12%" is just a message for the LLM', async () => {
    const graph = graphWithFramedRow();
    mockedPendingActions = [];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('about 12%'), 'req-2918-nopending', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    const committedGraphs = appendCalls
      .map((c) => c.graph as GraphV3T | undefined)
      .filter((g): g is GraphV3T => g != null);
    for (const g of committedGraphs) {
      expect(g.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBeUndefined();
    }
  });
});

describe('2.918 RESUME — the source gate is PINNED (it was not)', () => {
  /**
   * ⭐⭐ THIS GUARD PROTECTED NOTHING. `turn-executor.ts:5510-5514` refuses to
   * resume a baseline question on a chip turn — *"their copy is canned, not an
   * answer"* — and DELETING BOTH CONJUNCTS LEFT THIS SUITE GREEN: every resume
   * case above uses `makeMessagePayload`'s default `source: 'composer'`, and the
   * only two `chip_click` payloads in this file are EMIT-side.
   *
   * ⚠ BOTH SPELLINGS, and that is the point of the `it.each`. The contract union
   * is exactly four — `composer | chip | chip_click | retry`
   * (`schemas 0.48.0`, `dist/boundary/enums.d.ts:24`) — and the contract's own
   * reader holds the standard: `turn-payload.js:720`'s `isChipSource` names BOTH.
   * A pin that named only `chip_click` would leave half the gate unprotected and
   * would read as deliberate, which is worse than leaving it unpinned.
   *
   * Test-only. No behaviour change: the gate already reads both.
   */
  it.each(['chip', 'chip_click'] as const)(
    'a canned chip turn does NOT resume the live question (source: %s)',
    async (source) => {
      const graph = graphWithFramedRow();
      const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
      mockedPendingActions = [elicitPending(liveHash)];
      const { adapter, chatWithTools } = directAnswerAdapter();

      const { response } = await runTurnExecutor(
        payload('about 12%', { source }),
        `req-2918-chip-${source}`,
        { routingAdapter: adapter, graphState: graph },
      );

      // The pre-route did NOT claim the turn — it reached the ordinary path.
      expect(chatWithTools).toHaveBeenCalled();
      // Nothing was minted on the question's target, bound by IDENTITY.
      const committedGraphs = appendCalls
        .map((c) => c.graph as GraphV3T | undefined)
        .filter((g): g is GraphV3T => g != null);
      for (const g of committedGraphs) {
        expect(
          g.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline,
        ).toBeUndefined();
      }
      // …and no resume receipt was spoken.
      expect(response.assistant_text).not.toContain('Noted Churn rate is currently at 12%.');
    },
  );

  it('POSITIVE CONTROL — the SAME message and the SAME live question DO resume from the composer', async () => {
    // Trap 13: without this, both cases above could pass because the fixture
    // stopped being resumable at all, and the gate would be proving nothing.
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('about 12%'), 'req-2918-chip-control', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    expect(
      (appendCalls[0]!.graph as GraphV3T).nodes.find((n) => n.id === 'o-churn-rate')
        ?.observed_state?.baseline,
    ).toBe(0.12);
  });
});

/**
 * ROADMAP 2.1361 — THE PRODUCT MUST HEAR THE ANSWERS TO ITS OWN QUESTION.
 *
 * The ask is "Roughly what percentage is <target> at right now?" and, at the
 * deployed tip, a bare "30" — and "roughly 30" and "30 percent", which echo
 * the ask's own words — all REFUSED, silently. These are the end-to-end pins:
 * the answer a user actually types reaches `observed_state.baseline` on the
 * named target, with zero LLM calls, through the one existing writer.
 */
describe('2.1361 RESUME — a bare number answers the question', () => {
  it.each([
    ['30', 0.3],
    ['roughly 30', 0.3],
    ['about 30', 0.3],
    ['30 percent', 0.3],
  ])('"%s" mints the baseline on the named target', async (message, expectedFraction) => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload(message),
      `req-21361-bind-${message.replace(/\W+/g, '-')}`,
      { routingAdapter: adapter, graphState: graph },
    );

    expect(telemetry.failure_type).toBeNull();
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    // Bound BY IDENTITY to the target the question named, never by a value
    // predicate another node could satisfy (CLAUDE.md trap 19).
    const target = committed.nodes.find((n) => n.id === 'o-churn-rate');
    expect(target?.observed_state?.baseline).toBe(expectedFraction);
    for (const n of committed.nodes) {
      if (n.id === 'o-churn-rate') continue;
      expect(n.observed_state?.baseline).toBeUndefined();
    }

    // The user's own number, confirmed back — no invented substitute.
    expect(response.assistant_text).toContain('Noted Churn rate is currently at 30%.');
    // The question is answered, so it must not be asked again.
    expect(response.assistant_text).not.toContain('Roughly what percentage');
    const persisted = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(persisted.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);
  });
});

/**
 * ROADMAP 2.1361 — THE OTHER HALF OF THE ACCEPTANCE CONDITION. A binder that
 * accepts everything writes wrong values confidently, so an answer that is
 * genuinely ambiguous or out of range must still ASK. Before 2.1361 it fell
 * through in silence and the answer landed nowhere.
 */
describe('2.1361 RE-ASK — an unusable answer is answered, not ignored', () => {
  it.each([['maybe 30%'], ['10-15%'], ['30% or 40%'], ['120%'], ['about 30%, I think']])(
    '"%s" re-asks, mints nothing, and keeps the question alive',
    async (message) => {
      const graph = graphWithFramedRow();
      const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
      mockedPendingActions = [elicitPending(liveHash)];
      const { adapter, chatWithTools } = directAnswerAdapter();

      const { response, telemetry } = await runTurnExecutor(
        payload(message),
        `req-21361-reask-${message.replace(/\W+/g, '-')}`,
        { routingAdapter: adapter, graphState: graph },
      );

      expect(telemetry.failure_type).toBeNull();
      // Deterministic: the re-ask costs no LLM call.
      expect(chatWithTools).not.toHaveBeenCalled();
      expect(telemetry.llm_calls_used).toBe(0);

      // NOTHING was minted — the no-invention rule is intact.
      for (const call of appendCalls) {
        const g = call.graph as GraphV3T | undefined;
        if (g == null) continue;
        for (const n of g.nodes) expect(n.observed_state?.baseline).toBeUndefined();
      }

      // The product says what it needs, and names the target.
      expect(response.assistant_text).toContain('Churn rate');
      expect(response.assistant_text).toContain('one number between 0 and 100');

      // ⭐ THE RE-ASK IS NOT A DEAD END: the question is re-persisted, so the
      // next reply can still bind. A re-ask without this would ask forever.
      const persisted = (appendCalls.at(-1)!.pending_actions ?? []) as PendingAction[];
      const requestioned = persisted.filter((p) => p.action.kind === 'elicit_target_baseline');
      expect(requestioned).toHaveLength(1);
      expect(requestioned[0]!.action).toMatchObject({ target_id: 'o-churn-rate' });
      expect(requestioned[0]!.expires_at_turn_count).toBeGreaterThan(0);
    },
  );

  it('⭐ ANTI-HIJACK CONTROL — a user who changed the subject is NOT re-asked', async () => {
    // The load-bearing negative. `unusable_answer` is reachable only when the
    // whole message is digits plus CLOSED answer vocabulary; anything else
    // keeps the pre-2.1361 silent fall-through, so a stale question can never
    // capture a turn the user meant for something else.
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response } = await runTurnExecutor(
      payload('Actually, can we add 3 more factors about pricing instead?'),
      'req-21361-anti-hijack',
      { routingAdapter: adapter, graphState: graph },
    );

    // The ordinary LLM path owns the turn, exactly as before 2.1361.
    expect(chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain('one number between 0 and 100');
  });

  it('⭐ DISCRIMINATION CONTROL — bind and re-ask are different outcomes on the same fixture', async () => {
    // Trap 20: a route that returned the same thing for every message would
    // satisfy each battery above on its own. One fixture, two messages, two
    // observably different commits.
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;

    mockedPendingActions = [elicitPending(liveHash)];
    const bound = await runTurnExecutor(payload('30'), 'req-21361-disc-bind', {
      routingAdapter: directAnswerAdapter().adapter,
      graphState: graph,
    });
    const boundGraph = appendCalls.at(-1)!.graph as GraphV3T;
    const boundBaseline = boundGraph.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state
      ?.baseline;

    appendCalls.length = 0;
    mockedPendingActions = [elicitPending(liveHash)];
    const asked = await runTurnExecutor(payload('30% or 40%'), 'req-21361-disc-reask', {
      routingAdapter: directAnswerAdapter().adapter,
      graphState: graph,
    });
    const askedGraph = appendCalls.at(-1)!.graph as GraphV3T | undefined;
    const askedBaseline = askedGraph?.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state
      ?.baseline;

    expect(boundBaseline).toBe(0.3);
    expect(askedBaseline).toBeUndefined();
    expect(bound.response.assistant_text).not.toBe(asked.response.assistant_text);
  });
});

/**
 * ⭐⭐ ROADMAP 2.1361 — THE RE-ASK MUST SURVIVE BEING ANSWERED BADLY TWICE.
 *
 * This test exists because a mutant SURVIVED without it. Replacing the
 * executor's explicit `pending_actions: reAskPendingActions` with `[]` left
 * every other assertion in this file green — the commit's CARRY-FORWARD keeps
 * a non-consumed pending alive, so "the question is still there" held either
 * way and the re-persist looked equivalent.
 *
 * It is not equivalent. `computeSurvivingPriorPendingsDetailed` DECREMENTS
 * `expires_at_turn_count` on every carried turn (commit.ts: `nextTurnCount =
 * pa.expires_at_turn_count - 1`), and the default budget is 2. So under
 * carry-forward alone the product would ask, be fumbled twice, and then
 * SILENTLY STOP LISTENING — the exact defect 2.1361 exists to remove, moved
 * from the first answer to the third. Re-asking refreshes the budget, because
 * a question the product has just repeated is not a question that is running
 * out of patience.
 *
 * A single-turn assertion cannot see this. The journey can.
 */
describe('2.1361 — the question survives repeated fumbles', () => {
  it('unusable, unusable, then a good bare answer — and it still binds', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];

    // Turn 1 — a range. Re-ask.
    await runTurnExecutor(payload('10-15%'), 'req-21361-journey-1', {
      routingAdapter: directAnswerAdapter().adapter,
      graphState: graph,
    });
    const afterTurn1 = (appendCalls.at(-1)!.pending_actions ?? []) as PendingAction[];
    expect(afterTurn1.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(1);
    // The budget is REFRESHED, not spent: this is the assertion the surviving
    // mutant had no answer to.
    expect(
      afterTurn1.find((p) => p.action.kind === 'elicit_target_baseline')!.expires_at_turn_count,
    ).toBe(PENDING_ACTION_DEFAULT_TURN_TTL);

    // Turn 2 — a guess. Re-ask again, from the question the last turn persisted.
    appendCalls.length = 0;
    mockedPendingActions = afterTurn1;
    await runTurnExecutor(payload('maybe 30%'), 'req-21361-journey-2', {
      routingAdapter: directAnswerAdapter().adapter,
      graphState: graph,
    });
    const afterTurn2 = (appendCalls.at(-1)!.pending_actions ?? []) as PendingAction[];
    expect(
      afterTurn2.find((p) => p.action.kind === 'elicit_target_baseline')!.expires_at_turn_count,
    ).toBe(PENDING_ACTION_DEFAULT_TURN_TTL);

    // Turn 3 — the user gets it right. Under carry-forward alone the budget
    // would be exhausted by now and this would bind NOTHING.
    appendCalls.length = 0;
    mockedPendingActions = afterTurn2;
    const { response, telemetry } = await runTurnExecutor(payload('30'), 'req-21361-journey-3', {
      routingAdapter: directAnswerAdapter().adapter,
      graphState: graph,
    });

    expect(telemetry.llm_calls_used).toBe(0);
    const committed = appendCalls.at(-1)!.graph as GraphV3T;
    expect(committed.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBe(
      0.3,
    );
    expect(response.assistant_text).toContain('Noted Churn rate is currently at 30%.');
  });
});
