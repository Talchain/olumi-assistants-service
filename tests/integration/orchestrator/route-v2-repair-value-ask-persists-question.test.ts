/**
 * THE PRODUCT ASKS A QUESTION AND DOES NOT REMEMBER ASKING IT — exit 4.
 *
 * ⭐ THE ASK, verbatim from `composeRepairValueAskResponse`:
 *
 *   "You gave 0.12, and more than one effect value is still missing, so I want
 *    to be sure where to apply it before I change the model. Still unset: … .
 *    Pick one below, or name the option and factor in your reply."
 *
 * *Name the option and factor in your reply* is an explicit solicitation. Until
 * ROADMAP 2.1353 this exit returned via `sendFinalised200` — an early return
 * that never reaches `commitDirectAnswer` — so no turn row was written and the
 * reply landed on a turn whose model had no record of the question and no
 * referent to bind it to. Same mechanism as ROADMAP 2.1352 (CEE #1213); one of
 * the five siblings that lane found by ENUMERATING all 23 `sendFinalised200`
 * exits rather than grepping for the one it was handed.
 *
 * ⚠ WHY THIS FILE ASSERTS THE **WRITE** AND NOT THE REPLY. The sibling
 * `route-v2-repair-bare-value-binding.test.ts` drives this exact arm and holds
 * an `appendMock` it clears and never asserts on; every assertion it makes is
 * about the response body. The reply is correct — it is the persistence that is
 * missing — so a reply-shaped assertion is structurally incapable of observing
 * this defect. That is why it shipped past a green suite.
 *
 * ⚠ AND THE MOCK ACCEPTS ANYTHING (`append` is a bare `vi.fn()`), so these
 * assertions bind to the SHAPE OF THE WRITE, and by IDENTITY — the option and
 * factor ids of the cells the ask actually offered — never by a value predicate
 * another write could satisfy.
 *
 * Graph fixture and trapped message are taken verbatim from the sibling, which
 * took them from the wire-witnessed A2 journey (req b90d62e0) and VALIDATED the
 * fixture against `buildCanonicalAnalysisReadyFromGraph`. A fixture the producer
 * disowns proves nothing (CLAUDE.md trap 16).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
const readPendingsMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: readPendingsMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'text-only response' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '55555555-5555-4555-8555-55555555555a';

/** The graph ids the ask offers — the referent this file binds to. */
const OPTION_ID_SUB = 'opt_sub';
const OPTION_ID_PASS = 'opt_pass';
const FACTOR_ID_SUB = 'fac_sub_cost';
const FACTOR_ID_PASS = 'fac_price_up';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

function buildGraph(configured: readonly string[] = []) {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Protect margin under new charges' },
      {
        id: FACTOR_ID_SUB,
        kind: 'factor',
        label: 'Subcontractor cost as share of affected revenue',
        category: 'controllable',
      },
      {
        id: FACTOR_ID_PASS,
        kind: 'factor',
        label: 'Customer price increase applied',
        category: 'controllable',
      },
      {
        id: OPTION_ID_SUB,
        kind: 'option',
        label: 'subcontracting inner-city deliveries to a green courier',
        ...(configured.includes(OPTION_ID_SUB)
          ? { data: { interventions: { [FACTOR_ID_SUB]: 0.4 } } }
          : {}),
      },
      {
        id: OPTION_ID_PASS,
        kind: 'option',
        label: 'paying the daily charges and passing costs to customers',
        ...(configured.includes(OPTION_ID_PASS)
          ? { data: { interventions: { [FACTOR_ID_PASS]: 0.3 } } }
          : {}),
      },
    ],
    edges: [
      edge(OPTION_ID_SUB, FACTOR_ID_SUB),
      edge(OPTION_ID_PASS, FACTOR_ID_PASS),
      edge(FACTOR_ID_SUB, 'goal_1'),
      edge(FACTOR_ID_PASS, 'goal_1'),
    ],
  };
}

/** The witnessed trapped message, byte-verbatim (a2-turn3-request.json). */
const TRAPPED_MESSAGE = 'Set it to 0.12.';

let turnCounter = 0;
function payload(message: string): Record<string, unknown> {
  turnCounter += 1;
  return {
    kind: 'message',
    turn_id: `11111111-1111-4111-8111-1111111114${String(turnCounter).padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

function writes(): Record<string, unknown>[] {
  return appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

function pendingsOf(write: Record<string, unknown> | undefined): ReadonlyArray<
  Record<string, unknown>
> {
  return (write?.pending_actions ?? []) as ReadonlyArray<Record<string, unknown>>;
}

function effectTargetPendings(
  write: Record<string, unknown> | undefined,
): ReadonlyArray<Record<string, unknown>> {
  return pendingsOf(write).filter(
    (p) => (p.action as Record<string, unknown> | undefined)?.kind === 'elicit_effect_target',
  );
}

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

describe('the repair-value ask must PERSIST the question it asked', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    loadGraphMock.mockReset();
    readPendingsMock.mockReset();
    readPendingsMock.mockResolvedValue([]);
  });

  // ─── THE PRECONDITION, PINNED IN-TEST ────────────────────────────────────
  // Binds every case below to THIS exit by its own signature: two pairs are
  // outstanding, the reply is the disambiguation naming both, no LLM was
  // called and the edit lane was not reached.
  async function driveTheAsk() {
    loadGraphMock.mockResolvedValue(buildGraph());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(TRAPPED_MESSAGE),
    });
    expect(res.statusCode).toBe(200);
    const text = JSON.parse(res.body).assistant_text as string;
    expect(text).toContain('0.12');
    expect(text).toContain('Subcontractor cost as share of affected revenue');
    expect(text).toContain('Customer price increase applied');
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    return res;
  }

  // ─── THE DEFECT ──────────────────────────────────────────────────────────
  it('writes a turn row for the turn on which it asked', async () => {
    await driveTheAsk();
    expect(
      writes().length,
      'the ask returned via sendFinalised200 without reaching commitDirectAnswer, so no row ' +
        'landed in v5_conversation_turns — the next turn cannot see that this question was asked',
    ).toBe(1);
  });

  it("the written row carries the user's message, so the next turn's ContextPack can project it", async () => {
    await driveTheAsk();
    const write = writes()[0];
    expect(write, 'no write at all — see the previous case').toBeDefined();
    expect(write!.scenario_id).toBe(SCENARIO_ID);
    // ⚠ `userMessage` is the WRITE OBJECT's field; `user_message` is the COLUMN
    // the store maps it to. Asserting the column name here manufactures a false
    // RED against correct code.
    expect(write!.userMessage).toBe(TRAPPED_MESSAGE);
  });

  // ─── THE REFERENT — the user's value plus the cells it might land in ─────
  it("the row carries the USER'S OWN VALUE and the OFFERED CELLS, bound by id", async () => {
    await driveTheAsk();
    const armed = effectTargetPendings(writes()[0]);
    expect(
      armed.length,
      'the ask quoted the user’s value back and listed the candidate cells; nothing persisted ' +
        'either, so a reply of "the first one" has nothing to bind to',
    ).toBe(1);

    const action = armed[0]!.action as Record<string, unknown>;
    expect(action.source).toBe('repair_value_ask');
    // The user's own bytes, as the copy quoted them — never a reformatted number.
    expect(action.value_text).toBe('0.12');

    const candidates = action.candidates as ReadonlyArray<Record<string, unknown>>;
    // BY IDENTITY, and in the order the user was offered them. A pending naming
    // some other cell must not satisfy this.
    expect(candidates.map((c) => c.option_id)).toEqual([OPTION_ID_SUB, OPTION_ID_PASS]);
    expect(candidates.map((c) => c.factor_id)).toEqual([FACTOR_ID_SUB, FACTOR_ID_PASS]);
    expect(candidates[0]!.factor_label).toBe(
      'Subcontractor cost as share of affected revenue',
    );
  });

  // ─── THE WIRE MUST CARRY WHAT WAS PERSISTED ──────────────────────────────
  // ⚠⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED — and it was THIS exit's.
  // Replacing `repairAskPersisted.response` with the composed `response` at the
  // emit site left all five spec files GREEN, because every other assertion in
  // this battery is about the WRITE and the write is identical either way. The
  // site ships the chokepoint's response because `commitDirectAnswer` may
  // APPEND to it (F-HELD fix 2b's lapse notice), and that claim lived only in a
  // comment.
  it('the SHIPPED body is the COMMITTED body — a lapse notice appended at the chokepoint reaches the user', async () => {
    // Every read on this path returns the lapsing hold. It is an
    // `apply_proposed_change`, which the route's own `repairClaimBlocked` gate
    // does not look at (that gate reads live `set_factor_value` pendings only),
    // so the ask still fires — and the PRECONDITION inside `driveTheAsk` proves
    // it did rather than leaving this case to pass on some other exit.
    readPendingsMock.mockResolvedValue([
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        scenario_id: SCENARIO_ID,
        chip_id: 'prop_lapsing_3',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_lapsing_3',
          inline_patch: {},
          public_label: 'Switch the courier contract',
          public_message: 'Switch the courier contract',
        },
        preconditions: { graph_hash: computeAnalysisAffectingGraphHash(buildGraph()) },
        // ONE turn left: it lapses at THIS commit.
        expires_at_turn_count: 1,
        expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        emitted_at_iso: new Date().toISOString(),
      },
    ]);

    const res = await driveTheAsk();
    const shipped = JSON.parse(res.body).assistant_text as string;
    expect(
      shipped,
      'the commit appended a lapse notice to the response it persisted; shipping the pre-commit ' +
        'object makes the wire and the turn row disagree about what the user was told',
    ).toContain('has lapsed');
    expect(shipped).toContain('Switch the courier contract');
    expect(writes()[0]!.assistantMessage).toContain('has lapsed');
  });

  // ─── CARRY-FORWARD: WHY THE FAIL-CLOSED CASE IS *NOT* HERE ──────────────
  //
  // ⚠ A DELIBERATE OMISSION, RECORDED RATHER THAN LEFT TO BE REDISCOVERED. The
  // helper's "an unreadable prior-pending state aborts the commit" branch is
  // pinned in the two sibling files
  // (`route-v2-edit-clarify-persists-question.test.ts`,
  // `route-v2-option-effect-ask-persists-question.test.ts`), where the route
  // reads pendings ONCE and a blanket rejection therefore reaches exactly the
  // branch under test — with the ask's own copy asserted first, so an upstream
  // degrade REDs the case instead of faking it.
  //
  // THIS path reads pendings THREE times before the ask (measured at
  // `f18d941b`: the proposal-confirm resolution, the `repairClaimBlocked` gate,
  // and one more), and reads #2 and #3 are UPSTREAM of the exit. A blanket
  // rejection never reaches the ask at all — the turn degrades to "I couldn't
  // check this workspace's saved analysis history right now", and
  // `writes().length === 0` is then TRIVIALLY true about a turn that had
  // nothing to write. The first draft of this file asserted exactly that and
  // would have passed for the rest of time whatever the helper did (CLAUDE.md
  // trap 13b — a guard agreeing with itself).
  //
  // The alternative — rejecting only on the Nth call — makes the case's
  // discrimination depend on an upstream call COUNT that nothing pins, so it
  // would rot silently the first time any read on this path is added or
  // removed. A third copy of a branch already covered twice is not worth a
  // guard that can quietly stop guarding. Stated here so the gap is visible.

  // ─── THE TWIN (mandatory) ────────────────────────────────────────────────
  // The opposite direction of the same predicate: when exactly ONE pair is
  // outstanding the resolver BINDS instead of asking, and a turn that asked no
  // question must arm no question-pending. Without this, the assertions above
  // would pass on a route that armed a referent on every bare value.
  it('TWIN: ONE outstanding pair BINDS through the edit lane and arms no ask pending', async () => {
    loadGraphMock.mockResolvedValue(buildGraph([OPTION_ID_PASS]));
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(TRAPPED_MESSAGE),
    });
    expect(res.statusCode).toBe(200);
    // It bound: the edit lane owns this turn, so no question was asked.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const armed = writes().some((w) => effectTargetPendings(w).length > 0);
    expect(armed, 'a turn that asked nothing must not arm an asked-question referent').toBe(false);
  });
});
