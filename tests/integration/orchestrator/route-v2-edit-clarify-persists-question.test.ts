/**
 * THE PRODUCT ASKS A QUESTION AND DOES NOT REMEMBER ASKING IT — exits 2 and 3.
 *
 * ⭐ THE DEFECT CLASS. ROADMAP 2.1352 (CEE #1213) fixed one instance, witnessed
 * on Paul's live session and root-caused at the database:
 *
 *   ASKED   "'Two Developers' has no effect value on Development throughput
 *            yet. Give me a number from 0 … to 1 — 0.6, say."
 *   REPLIED "0.6"
 *   ANSWERED "I need to know which factor and which option it belongs to
 *            before setting anything."
 *
 * That lane ENUMERATED all 23 `sendFinalised200` exits instead of grepping for
 * the one it was given, and found its instance was ONE OF SIX. This file covers
 * two of the other five: the `chip_simplify` and `vague_edit` Stage-4A
 * intercepts, both of which return via `sendFinalised200` — an early return
 * that never reaches `commitDirectAnswer` — so NO TURN ROW IS WRITTEN.
 *
 * ⚠ WHY THIS FILE ASSERTS THE **WRITE** AND NOT THE REPLY. The sibling
 * `route-v2-edit-lifecycle.test.ts` drives BOTH of these arms, holds an
 * `appendMock` which it clears in `beforeEach` — and then never asserts on it.
 * Every assertion it makes is about the RESPONSE BODY. The reply is correct; it
 * is the persistence that is missing, so a reply-shaped assertion is
 * structurally incapable of observing this class of defect. (Identical
 * observation to the 2.1352 spec's, about a different sibling — which is what
 * makes it a CLASS rather than an oversight.)
 *
 * ⚠ AND THE MOCK ACCEPTS ANYTHING. `getSessionStore().append` is a `vi.fn()`,
 * so it validates no argument shape whatsoever — Postgres is the only enforcer
 * of turn-row correctness and no unit test reaches it. So these assertions bind
 * to the SHAPE OF THE WRITE explicitly, and by IDENTITY (the node ids the ask
 * offered, and the `reason` that distinguishes the two intercepts), never by a
 * value predicate another write could satisfy.
 *
 * ⚠⚠ THE HONEST HALF, and it is why the last two cases exist. Unlike 2.1352's
 * site, THESE TWO ASKS NAME NO CELL. `composeEditClarifyResponse` says "tell me
 * the specific factor, edge, option, or value to change" and draws its chips
 * from `extensions.graphState?.nodes` — and the UI SENDS A TURN, NOT A GRAPH.
 * So on the live wire the offer is the cancel-only chip and there is no
 * structured referent to persist at all. The fix is therefore split: the TURN
 * ROW is written either way (it is what the model's conversation history reads,
 * and it is the larger half), and the pending referent is armed only when a
 * graph arrived. Both halves are pinned below, in both directions.
 *
 * Harness modelled on `route-v2-edit-lifecycle.test.ts` (same mocks, same
 * request shape), plus the `readMostRecentPendingActions` method that file
 * omits — see the note on the mock.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const readPendingsMock = vi.fn().mockResolvedValue([]);
const loadGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    // REQUIRED by these paths, and its absence is not a detail. The intercepts
    // read the prior turn's pendings BEFORE committing, because a commit
    // without carry-forward would wipe a live proposal. A mock missing this
    // method makes the route fail closed and write nothing — which looks
    // exactly like the defect under test. Kept as a mock so the carry-forward
    // argument can be asserted (see the CARRY-FORWARD case).
    readMostRecentPendingActions: readPendingsMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
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

const SCENARIO_ID = '44444444-4444-4444-8444-44444444444a';

/** The graph ids the ask offers — the referent this file binds to. */
const FACTOR_ID_1 = 'fac_hiring_cost';
const FACTOR_ID_2 = 'fac_revenue';
const OPTION_ID = 'opt_hire_now';

const GRAPH_STATE = {
  nodes: [
    { id: OPTION_ID, kind: 'option', label: 'Option A — Hire now' },
    { id: FACTOR_ID_1, kind: 'factor', label: 'Hiring and Salary Cost' },
    { id: FACTOR_ID_2, kind: 'factor', label: 'Revenue' },
  ],
  edges: [
    { from: FACTOR_ID_1, to: OPTION_ID },
    { from: FACTOR_ID_2, to: OPTION_ID },
  ],
};

/** The exact legacy chip prompt (`SIMPLIFY_CHANGE_CHIP_PROMPT`). */
const CHIP_SIMPLIFY_MESSAGE = 'Try a simpler version of this change.';
/** A vague-edit-shaped message carrying no graph label, number or verb-object. */
const VAGUE_EDIT_MESSAGE = 'Make the model better';

let turnCounter = 0;
function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  turnCounter += 1;
  return {
    kind: 'message',
    turn_id: `11111111-1111-4111-8111-1111111113${String(turnCounter).padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

/** Every object handed to `store.append` on this turn. */
function writes(): Record<string, unknown>[] {
  return appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

function pendingsOf(write: Record<string, unknown> | undefined): ReadonlyArray<
  Record<string, unknown>
> {
  return (write?.pending_actions ?? []) as ReadonlyArray<Record<string, unknown>>;
}

function editTargetPendings(
  write: Record<string, unknown> | undefined,
): ReadonlyArray<Record<string, unknown>> {
  return pendingsOf(write).filter(
    (p) => (p.action as Record<string, unknown> | undefined)?.kind === 'elicit_edit_target',
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
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

describe('the two edit-clarify intercepts must PERSIST the question they asked', () => {
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
    readPendingsMock.mockReset();
    readPendingsMock.mockResolvedValue([]);
    loadGraphMock.mockReset();
    loadGraphMock.mockResolvedValue(null);
  });

  // ─── THE PRECONDITIONS, PINNED IN-TEST ───────────────────────────────────
  // Without these, every assertion below could pass because some OTHER exit
  // handled the turn. Each binds its cases to its own intercept by that
  // intercept's own signature: the edit lane is not reached, and the reply is
  // the shared clarify copy.
  async function driveChipSimplify(overrides: Record<string, unknown> = {}) {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: CHIP_SIMPLIFY_MESSAGE, ...overrides }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text as string).toContain(
      "I haven't changed anything from that.",
    );
    return res;
  }

  async function driveVagueEdit(overrides: Record<string, unknown> = {}) {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: VAGUE_EDIT_MESSAGE, ...overrides }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).assistant_text as string).toContain(
      "I haven't changed anything from that.",
    );
    return res;
  }

  // ─── THE DEFECT — chip_simplify ──────────────────────────────────────────
  it('chip_simplify: writes a turn row for the turn on which it asked', async () => {
    await driveChipSimplify();
    expect(
      writes().length,
      'the intercept returned via sendFinalised200 without reaching commitDirectAnswer, so no ' +
        'row landed in v5_conversation_turns — the next turn cannot see that this question was asked',
    ).toBe(1);
  });

  it("chip_simplify: the written row carries the user's message", async () => {
    await driveChipSimplify();
    const write = writes()[0];
    expect(write, 'no write at all — see the previous case').toBeDefined();
    expect(write!.scenario_id).toBe(SCENARIO_ID);
    // ⚠ THE WRITE OBJECT'S FIELD IS `userMessage` (camelCase); the store maps it
    // to the `user_message` COLUMN. They are different names at different
    // layers, and asserting the COLUMN name here manufactures a false RED
    // against correct code — it cost the 2.1352 lane a cycle.
    expect(write!.userMessage).toBe(CHIP_SIMPLIFY_MESSAGE);
  });

  // ─── THE REFERENT, BOUND BY IDENTITY ─────────────────────────────────────
  it('chip_simplify: the row carries the OFFERED TARGETS as persisted state, by node id', async () => {
    await driveChipSimplify();
    const armed = editTargetPendings(writes()[0]);
    expect(
      armed.length,
      'the ask offered specific graph targets; nothing persisted them, so a reply naming one ' +
        'has nothing to bind to',
    ).toBe(1);

    const action = armed[0]!.action as Record<string, unknown>;
    expect(action.reason).toBe('chip_simplify');
    const offered = action.offered_targets as ReadonlyArray<Record<string, unknown>>;
    // BY IDENTITY: the node ids the composer's own selector chose, in its order
    // (factors before options, capped at three). A pending naming some other
    // node must not satisfy this.
    expect(offered.map((t) => t.node_id)).toEqual([FACTOR_ID_1, FACTOR_ID_2, OPTION_ID]);
    expect(offered.map((t) => t.label)).toEqual([
      'Hiring and Salary Cost',
      'Revenue',
      'Option A — Hire now',
    ]);
  });

  // ─── THE DEFECT — vague_edit ─────────────────────────────────────────────
  it('vague_edit: writes a turn row for the turn on which it asked', async () => {
    await driveVagueEdit();
    expect(
      writes().length,
      'the vague-edit intercept has the same sendFinalised200 shape and the same defect',
    ).toBe(1);
    expect(writes()[0]!.userMessage).toBe(VAGUE_EDIT_MESSAGE);
  });

  it('vague_edit: the row carries its OWN reason — the two intercepts are distinguishable', async () => {
    await driveVagueEdit();
    const armed = editTargetPendings(writes()[0]);
    expect(armed.length).toBe(1);
    const action = armed[0]!.action as Record<string, unknown>;
    // ⭐ THE DISCRIMINATION. A referent that said `chip_simplify` here would be
    // a pending describing a question the product did not ask. `reason` is what
    // lets a later reader tell "the simplify chip asked" from "the user was
    // vague", which are different questions with different honest resumes.
    expect(action.reason).toBe('vague_edit');
    expect(armed[0]!.chip_id).toBe('chip_edit_clarify_vague_edit');
  });

  // ─── THE LIVE-WIRE SHAPE — the honest half ───────────────────────────────
  // ⚠ On the deployed path the UI sends a turn and NO graph, so the composer
  // has no nodes, ships its cancel-only chip, and there is NOTHING to name.
  // The turn must still be committed: the conversation-history row is what the
  // model actually reads, and refusing to commit for want of a structured
  // referent would discard the whole repair on exactly the turns that carry the
  // defect. Both directions are asserted in one case so neither can drift.
  it('NO graph_state (the live-wire shape): the turn is STILL committed, and NO pending is armed', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      // Deleting the key, not blanking it: this is the platform invariant
      // shape, and the 2.1352 spec drives the same one.
      payload: (() => {
        const p = payload({ message: VAGUE_EDIT_MESSAGE });
        delete p.graph_state;
        return p;
      })(),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    expect(
      writes().length,
      'the memory of the question is the half that IS available here; losing it because no ' +
        'referent could be derived would discard the fix on the live path',
    ).toBe(1);
    expect(writes()[0]!.userMessage).toBe(VAGUE_EDIT_MESSAGE);
    expect(
      editTargetPendings(writes()[0]).length,
      'no graph arrived, so the ask named nothing — a pending listing no target could neither ' +
        'restate the question nor bind an answer, and must not be armed',
    ).toBe(0);
  });

  // ─── CARRY-FORWARD: LOSING THE MEMORY BEATS LOSING THE PROPOSAL ──────────
  it('a live prior pending SURVIVES this commit — the ask never wipes a live proposal', async () => {
    const livePriorPending = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_apply_proposal_1',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_live_1',
        inline_patch: {},
        public_label: 'Apply that change',
        public_message: 'Apply that change',
      },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      emitted_at_iso: new Date().toISOString(),
    };
    readPendingsMock.mockResolvedValue([livePriorPending]);

    await driveVagueEdit();

    const write = writes()[0];
    expect(write, 'no write at all — see the earlier cases').toBeDefined();
    const refs = pendingsOf(write).map(
      (p) => (p.action as Record<string, unknown>).proposal_ref,
    );
    expect(
      refs,
      'this is a NON-CONSUMING turn: committing without threading the prior pendings would ' +
        'silently delete the user’s live proposal, which is strictly worse than the defect ' +
        'this file exists to fix',
    ).toContain('prop_live_1');
  });

  // ─── THE WIRE MUST CARRY WHAT WAS PERSISTED ──────────────────────────────
  // ⚠⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. Every emit site here ships
  // the response the COMMIT CHOKEPOINT returned, not the one it was handed,
  // and each carries a comment saying so — because `commitDirectAnswer` may
  // APPEND to the response (F-HELD fix 2b's one-sentence lapse notice). A
  // mutant that shipped the pre-commit object instead left the whole battery
  // GREEN: every other assertion in this file is about the WRITE, and the write
  // is identical either way. The claim in the comment had no guard, which is
  // exactly the shape this estate keeps paying for.
  //
  // A prior consent hold with ONE turn left lapses at THIS commit, so the
  // chokepoint appends its notice. If a site ships the object it composed
  // rather than the object that was committed, the sentence never reaches the
  // user and the wire disagrees with the persisted row about what was said.
  it('the SHIPPED body is the COMMITTED body — a lapse notice appended at the chokepoint reaches the user', async () => {
    readPendingsMock.mockResolvedValue([
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        scenario_id: SCENARIO_ID,
        chip_id: 'prop_lapsing_1',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_lapsing_1',
          inline_patch: {},
          public_label: 'Raise the hiring cap',
          public_message: 'Raise the hiring cap',
        },
        preconditions: {},
        // ONE turn left: the carry-forward decrement takes it to zero at this
        // commit, which is the only place a consent lapse is observable.
        expires_at_turn_count: 1,
        expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        emitted_at_iso: new Date().toISOString(),
      },
    ]);

    const res = await driveVagueEdit();
    const shipped = JSON.parse(res.body).assistant_text as string;
    expect(
      shipped,
      'the commit appended a lapse notice to the response it persisted; shipping the pre-commit ' +
        'object instead makes the wire and the turn row disagree about what the user was told',
    ).toContain('has lapsed');
    // Bound by identity to the hold that actually lapsed, not to any notice.
    expect(shipped).toContain('Raise the hiring cap');
    // And the persisted row says the same thing, which is the whole point.
    expect(writes()[0]!.assistantMessage).toContain('has lapsed');
  });

  it('an UNREADABLE prior-pending state fails CLOSED — nothing is written at all', async () => {
    readPendingsMock.mockRejectedValue(new Error('session read failed'));
    await driveVagueEdit();
    expect(
      writes().length,
      'a commit without carry-forward would wipe live proposals, so an unreadable prior state ' +
        'must abort the commit rather than proceed without them',
    ).toBe(0);
  });

  // ─── THE OTHER HALF OF THE READ'S DOMAIN (round 2) ───────────────────────
  // ⚠ THE CASE ABOVE, AND ITS SIBLING IN THE REPAIR-VALUE SUITE, BOTH USE A
  // REJECTED PROMISE — so between them they covered only the THROW half of this
  // read's domain, and the fail-closed claim was true only over that half.
  //
  // The real store has a SECOND failure mode with no throw in it: on a
  // PARTIALLY-CORRUPT `pending_actions` column it drops the unparseable /
  // cross-scenario entries, emits `PendingActionsReadDegraded`, and returns
  // THE SURVIVORS (`supabase-store.ts` :2305-2347). Only
  // `{ validation: 'strict' }` turns that into a throw — which is exactly why
  // `loadMostRecentPendingActionsIntegrityStrict` exists and is documented for
  // "a caller that will become the newest turn". This caller IS that caller:
  // the truncated list would be written into the row that then supersedes the
  // one it was read from, so the dropped entries would be gone for good, with
  // no abort and no notice.
  //
  // The mock below models exactly that asymmetry — truncate for a tolerant
  // read, throw for a lossless one — so the test binds to WHICH READ the caller
  // makes, not to a shape the caller could satisfy either way.
  it('a PARTIALLY-CORRUPT prior row also fails CLOSED — a truncated carry-forward is a silent lossy write, not a read that succeeded', async () => {
    readPendingsMock.mockImplementation(
      async (_scenarioId: string, options?: { validation?: string }) => {
        if (options?.validation === 'strict') {
          throw new Error(
            'readMostRecentPendingActions: newest row pending_actions failed lossless validation',
          );
        }
        // The tolerant read's answer: one SURVIVOR, silently one entry short.
        return [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            scenario_id: SCENARIO_ID,
            chip_id: 'chip_apply_proposal_survivor',
            action: {
              kind: 'apply_proposed_change',
              proposal_ref: 'prop_survivor',
              inline_patch: {},
              public_label: 'The entry that happened to parse',
              public_message: 'The entry that happened to parse',
            },
            preconditions: {},
            expires_at_turn_count: 2,
            expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            emitted_at_iso: new Date().toISOString(),
          },
        ];
      },
    );

    await driveVagueEdit();

    // PRECONDITION PINNED IN-TEST: the tolerant read really would have returned
    // a committable list here, so a `writes().length === 0` below is the
    // caller's lossless read choosing to abort — not the fixture failing to
    // produce anything.
    const tolerant = await readPendingsMock(SCENARIO_ID);
    expect(tolerant.length, 'the tolerant read must return a non-empty truncated list').toBe(1);

    expect(
      writes().length,
      'the tolerant read hands back the SURVIVORS of a corrupt row; committing them would make ' +
        'the truncated list authoritative and delete the unreadable entries permanently',
    ).toBe(0);
  });

  // ─── THE TWIN (mandatory) ────────────────────────────────────────────────
  it('TWIN: an ordinary, specific edit is NOT intercepted and arms no clarify pending', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Change Hiring and Salary Cost to 0.4' }),
    });
    expect(res.statusCode).toBe(200);
    // The pre-existing route ran untouched — neither intercept claimed it.
    expect(dispatchEditGraphMock).toHaveBeenCalled();
    const armed = writes().some((w) => editTargetPendings(w).length > 0);
    expect(armed, 'a turn neither intercept claimed must not arm either intercept’s pending').toBe(
      false,
    );
  });
});
