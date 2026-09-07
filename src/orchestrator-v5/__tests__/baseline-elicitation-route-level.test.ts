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
import type { PendingAction } from '../session/pending-action.js';
import {
  PENDING_ACTION_ASK_TURN_TTL,
  PENDING_ACTION_DEFAULT_TURN_TTL,
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

describe('R2918B ROUTE — the bare number the ask invites reaches the mint', () => {
  it('"30" against the live question mints the baseline, zero LLM calls', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('30'),
      'req-r2918b-bare',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(telemetry.failure_type).toBeNull();
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    expect(
      committed.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline,
    ).toBe(0.3);
    expect(response.assistant_text).toContain('Noted Churn rate is currently at 30%.');
  });
});

describe('R2918B ROUTE — an unreadable ANSWER is re-asked; a non-answer is not', () => {
  it('"10-15%" re-asks, names the target and the shape, and RE-PERSISTS the question', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('10-15%'),
      'req-r2918b-reask',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(telemetry.failure_type).toBeNull();
    // The pre-route claimed the turn: no LLM, and no invented value.
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    // NOTHING was minted. A binder that accepts everything writes wrong values
    // confidently; this is the case where it must refuse and say so.
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T | undefined;
    if (committed) {
      for (const n of committed.nodes) {
        expect(n.observed_state?.baseline).toBeUndefined();
      }
    }

    // The user is TOLD, by name and with the shape needed.
    expect(response.assistant_text).toContain('Churn rate');
    expect(response.assistant_text).toContain('One number is enough');
    expect(response.assistant_text).toContain('What percentage is Churn rate at right now?');

    // The question SURVIVES the re-ask, so the next attempt still has a
    // referent to bind through — and it survives by an EXPLICIT RE-PERSIST
    // whose turn-TTL is refreshed, not by bare carry-forward.
    //
    // ⚠ This comment previously said the opposite ("it survives by
    // carry-forward ... NOT by an explicit re-persist: an explicit list
    // REPLACES the carried-forward set"). That was false about `commit.ts`
    // — see the corrected note at the re-ask commit site — and bare
    // carry-forward is not survival: it DECREMENTS, so the question reached
    // zero on the second re-ask and the next valid answer fell into silence.
    // The TTL assertion below is what discriminates the two mechanisms;
    // without it this test passes under either.
    const persisted = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    const reAsked = persisted.filter((p) => p.action.kind === 'elicit_target_baseline');
    expect(reAsked).toHaveLength(1);
    expect(
      (reAsked[0]!.action as { target_id: string }).target_id,
    ).toBe('o-churn-rate');
    // REFRESHED, not decremented. Carry-forward alone would persist 1 here.
    // The "full TTL" for a recorded ASK is PENDING_ACTION_ASK_TURN_TTL, not the
    // offer default — see the two-dial note in session/pending-action.ts. The
    // mechanism this line discriminates (refresh vs re-persist) is unchanged;
    // only the constant naming "full" moved.
    expect(reAsked[0]!.expires_at_turn_count).toBe(PENDING_ACTION_ASK_TURN_TTL);
    // ...and the wall clock is NOT refreshed with it — the bound the re-ask
    // may never extend (identity preserved too, so telemetry tracks one
    // question across re-asks).
    expect(reAsked[0]!.expires_at_iso).toBe('2099-12-31T23:59:59.000Z');
    expect(reAsked[0]!.emitted_at_iso).toBe('2026-08-08T00:00:00.000Z');
    expect(reAsked[0]!.id).toBe('pa-elicit-route-1');
  });

  it('a SIBLING pending survives the re-ask alongside the re-persisted question', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    const sibling = {
      id: 'pa-run-1',
      scenario_id: 'scn-1',
      chip_id: 'chip_run_analysis',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-08-08T00:00:00.000Z',
    } as unknown as PendingAction;
    // The ask turn routinely ships a "Run the analysis" chip in the same
    // commit as the question, so this is the ordinary state, not an exotic one.
    mockedPendingActions = [elicitPending(liveHash), sibling];
    const { adapter } = directAnswerAdapter();

    await runTurnExecutor(payload('10-15%'), 'req-r2918b-sibling', {
      routingAdapter: adapter,
      graphState: graph,
    });

    // ⚠ RENAMED. This test used to be called "(an explicit list would have
    // dropped it)" — a name asserting a mechanism that is FALSE (`commit.ts`
    // combines `[...chipDerivedPending, ...survivingPrior]`, so an explicit
    // list adds, it does not replace) and that the body never tested. It
    // passed identically with and without the re-persist, so its name was the
    // only thing claiming a property, and the claim was wrong.
    //
    // What it pins now is real and discriminating in BOTH directions: the
    // sibling carries forward (decremented, as carry-forward does) while the
    // question is re-persisted FRESH by the explicit list beside it. Drop the
    // explicit list and the question reads 1; drop the carry-forward and the
    // sibling disappears. One assertion cannot be satisfied by the other.
    const persisted = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(persisted.map((p) => p.action.kind).sort()).toEqual([
      'elicit_target_baseline',
      'run_analysis',
    ]);
    const question = persisted.find((p) => p.action.kind === 'elicit_target_baseline')!;
    const carried = persisted.find((p) => p.action.kind === 'run_analysis')!;
    // The re-asked QUESTION is a recorded ask (ask window); the carried
    // run_analysis OFFER keeps the default and is one turn down. Asserting both
    // in one place is deliberate: it is the twin, and it fails if the widening
    // ever leaks onto the offer.
    expect(question.expires_at_turn_count).toBe(PENDING_ACTION_ASK_TURN_TTL);
    expect(carried.expires_at_turn_count).toBe(PENDING_ACTION_DEFAULT_TURN_TTL - 1);
    // Exactly one copy of the question: the explicit list SUPERSEDES the
    // carried copy by `chip_id` rather than sitting alongside it as a second
    // live referent (two would make the next bare number ambiguous and bind
    // neither — `findSoleLiveElicitBaselinePending` requires exactly one).
    expect(persisted.filter((p) => p.chip_id === 'chip_elicit_target_baseline')).toHaveLength(1);
  });

  it('"120%" re-asks about the RANGE (the reason reaches the copy, not just the branch)', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter } = directAnswerAdapter();

    const { response } = await runTurnExecutor(payload('120%'), 'req-r2918b-range', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(response.assistant_text).toContain('between 0 and 100 percent');
  });

  it('THE PAIR — a message that is NOT answering falls through silently, exactly as before', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response } = await runTurnExecutor(
      payload('run the analysis please'),
      'req-r2918b-silent',
      { routingAdapter: adapter, graphState: graph },
    );

    // The ordinary flow owns the turn. No re-ask copy anywhere.
    expect(chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain('One number is enough');
    expect(response.assistant_text).not.toContain('What percentage is Churn rate at right now?');
  });
});

/**
 * R2918C — THE THREE-TURN JOURNEY, and the two opposite harms that bound it.
 *
 * These are TURN-CHAINED, not single-shot: each turn's persisted
 * `pending_actions` becomes the next turn's `most_recent_pending_actions`,
 * which is what production does. A single-turn assertion cannot see this
 * defect class at all — the question looked healthy on turn 1 (it persisted,
 * at 1) and was gone on turn 2, so every existing single-shot pin was green
 * while the journey was broken.
 */
describe('R2918C — the re-asked question is still there on the third turn', () => {
  /** One chained turn. Returns the reply and the pendings it persisted. */
  async function turn(
    graph: GraphV3T,
    message: string,
    requestId: string,
  ): Promise<{
    readonly text: string;
    readonly persisted: readonly PendingAction[];
    readonly llmCalled: boolean;
    readonly minted: unknown;
  }> {
    appendCalls.length = 0;
    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response } = await runTurnExecutor(payload(message), requestId, {
      routingAdapter: adapter,
      graphState: graph,
    });
    const last = appendCalls[appendCalls.length - 1];
    const persisted = (last?.pending_actions ?? []) as PendingAction[];
    // Chain: this turn's committed pendings are the next turn's prior state.
    mockedPendingActions = persisted;
    return {
      text: response.assistant_text,
      persisted,
      llmCalled: chatWithTools.mock.calls.length > 0,
      minted: (last?.graph as GraphV3T | undefined)?.nodes.find((n) => n.id === 'o-churn-rate')
        ?.observed_state?.baseline,
    };
  }

  it('THE DEFECT — fumble, fumble, then a perfect "30" still binds', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];

    // Fumble 1 — an unreadable range. The product re-asks.
    const t1 = await turn(graph, '10-15%', 'req-r2918c-t1');
    expect(t1.text).toContain('What percentage is Churn rate at right now?');
    expect(t1.persisted.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(1);

    // Fumble 2 — a second unreadable answer. The product re-asks AGAIN, and
    // this is the turn the defect lived on: before the fix it re-asked while
    // persisting ZERO pendings, so the question below had no referent.
    const t2 = await turn(graph, 'maybe 12%', 'req-r2918c-t2');
    expect(t2.text).toContain('What percentage is Churn rate at right now?');
    expect(
      t2.persisted.filter((p) => p.action.kind === 'elicit_target_baseline'),
      'the product re-asked while persisting no question — the next answer falls into silence',
    ).toHaveLength(1);

    // THE PAYOFF. A bare, perfectly good answer to the question just asked.
    const t3 = await turn(graph, '30', 'req-r2918c-t3');
    // It BOUND: zero LLM calls (the pre-route claimed the turn) and the
    // baseline landed on the named target.
    expect(t3.llmCalled).toBe(false);
    expect(t3.minted).toBe(0.3);
    expect(t3.text).toContain('Noted Churn rate is currently at 30%.');
    // ...and the answered question was consumed, so it cannot zombie.
    expect(t3.persisted.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);
  });

  it('THE OPPOSITE HARM — the question still genuinely EXPIRES on the wall clock', async () => {
    // The re-ask refreshes the TURN-TTL only. `expires_at_iso` is carried
    // through from the original ask, so no amount of fumbling can extend the
    // window the ask opened. Here the question is already past it.
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [
      elicitPending(liveHash, {
        expires_at_iso: new Date(Date.now() - 60_000).toISOString(),
      } as Partial<PendingAction>),
    ];

    // Exactly the message that re-asks when the question is live.
    const t = await turn(graph, '10-15%', 'req-r2918c-expired');

    // No re-ask copy, and NOTHING re-persisted: an expired question is dead,
    // and the re-persist cannot resurrect it. The flow is untouched.
    expect(t.text).not.toContain('What percentage is Churn rate at right now?');
    expect(t.text).not.toContain('One number is enough');
    expect(t.persisted.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);
    expect(t.llmCalled).toBe(true);
    expect(t.minted).toBeUndefined();
  });

  it('THE OPPOSITE HARM — an ABANDONED question decays in two turns, and a later bare number does NOT bind to it', async () => {
    // The bound on the other side. A message that IGNORES the question
    // classifies `not_an_answer`, never reaches the re-ask branch, and so is
    // never re-persisted: ordinary carry-forward decrements it to nothing.
    // This is why refreshing on re-ask cannot make a stale question immortal
    // — the refresh happens only on evidence the user is still answering.
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];

    const a1 = await turn(graph, 'let us talk about something else', 'req-r2918c-ab1');
    expect(a1.text).not.toContain('What percentage is Churn rate at right now?');
    // Carried, decremented — not refreshed.
    const carried = a1.persisted.filter((p) => p.action.kind === 'elicit_target_baseline');
    expect(carried).toHaveLength(1);
    expect(carried[0]!.expires_at_turn_count).toBe(PENDING_ACTION_DEFAULT_TURN_TTL - 1);

    const a2 = await turn(graph, 'what were we doing again', 'req-r2918c-ab2');
    expect(a2.persisted.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);

    // A bare number two turns after abandonment binds NOTHING — it does not
    // land on a question the user walked away from.
    const a3 = await turn(graph, '30', 'req-r2918c-ab3');
    expect(a3.minted).toBeUndefined();
    expect(a3.llmCalled).toBe(true);
  });
});

/**
 * R2918C — THE REFRESH IS PINNED AGAINST A DECREMENTED VALUE.
 *
 * ⚠ Trap 13b, caught in this lane's own first draft. Every other pin here
 * feeds a question at `PENDING_ACTION_DEFAULT_TURN_TTL`, so "refreshed to 2"
 * and "re-persisted unchanged" produce the SAME number and the assertion
 * cannot tell them apart. A mutant that re-persists
 * `pending.expires_at_turn_count` verbatim survives all of them. The fixture
 * below arrives ALREADY DECREMENTED — the one state where the two mechanisms
 * disagree — so the assertion has to do real work.
 */
describe('R2918C — the re-ask REFRESHES the turn-TTL, it does not merely re-persist it', () => {
  it('a question carried down to 1 comes back out of the re-ask at the full TTL', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    // The ordinary state after one turn that ignored the question.
    mockedPendingActions = [
      elicitPending(liveHash, {
        expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL - 1,
      } as Partial<PendingAction>),
    ];
    const { adapter } = directAnswerAdapter();

    await runTurnExecutor(payload('10-15%'), 'req-r2918c-refresh', {
      routingAdapter: adapter,
      graphState: graph,
    });

    const persisted = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    const question = persisted.filter((p) => p.action.kind === 'elicit_target_baseline');
    expect(question).toHaveLength(1);
    // PRECONDITION PINNED IN-TEST: the input really was below the full TTL, so
    // a green result here cannot be the fixture failing to set up the case.
    expect(mockedPendingActions[0]!.expires_at_turn_count).toBeLessThan(
      PENDING_ACTION_ASK_TURN_TTL,
    );
    expect(question[0]!.expires_at_turn_count).toBe(PENDING_ACTION_ASK_TURN_TTL);
  });
});
