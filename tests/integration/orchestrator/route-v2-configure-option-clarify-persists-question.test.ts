/**
 * THE PRODUCT ASKS A QUESTION AND DOES NOT REMEMBER ASKING IT.
 *
 * ⭐ THE WITNESSED DEFECT (Paul's own live session, root-caused at the database
 * and the logs):
 *
 *   ASKED   "'Two Developers' has no effect value on Development throughput
 *            yet. Give me a number from 0 … to 1 — 0.6, say."
 *   REPLIED "0.6"
 *   ANSWERED "I need to know which factor and which option it belongs to
 *            before setting anything."
 *
 * It had named the cell in its own question, one turn earlier.
 *
 * THE MECHANISM. The configure-option clarify intercept returns via
 * `route-v2.ts` `sendFinalised200(...)` — an early return that never reaches
 * `commitDirectAnswer`. So NO TURN ROW IS WRITTEN. Confirmed at the database,
 * not merely inferred: the scenario held 8 rows in `v5_conversation_turns` with
 * no row between 16:40:34 and 16:53:23, and `pending_actions = []` on every one.
 * On the `0.6` turn the model received `conversation_history_turns: 2`, both
 * from 16:40, and `v5.context_readiness` reported `pending_action_count: 0`.
 *
 * ⭐ THE PROMPT IS NOT AT FAULT. It said it did not know which cell was meant,
 * which was TRUE of what it was given. It cannot use what it never received.
 *
 * ⚠ WHY THIS FILE ASSERTS THE **WRITE** AND NOT THE REPLY. Its sibling
 * `route-v2-configure-option-clarify.test.ts` drives THIS VERY ARM, and holds an
 * `appendMock` which it clears in `beforeEach` — and then never asserts on. So
 * an existing route-level spec exercised the defective path and could not see the
 * defect, because every assertion it makes is about the RESPONSE BODY. The reply
 * is correct; it is the persistence that is missing. A reply-shaped assertion is
 * structurally incapable of observing this class of defect.
 *
 * ⚠ AND THE MOCK ACCEPTS ANYTHING. `getSessionStore().append` is a `vi.fn()`,
 * so it validates no argument shape whatsoever — the only enforcer of turn-row
 * correctness is Postgres, which no unit test reaches. Therefore these
 * assertions bind to the SHAPE OF THE WRITE explicitly, by identity (the option
 * id and the factor id the question named), never by a value predicate another
 * write could satisfy.
 *
 * PREMISE, READ FROM THE MIGRATION rather than assumed. `pending_actions` is
 * capped at 3 elements by a DB CHECK constraint
 * (`supabase/migrations/20260505120000_v5_pending_actions.sql`). The final case
 * reads that migration so a schema change REDs this guard instead of silently
 * invalidating its premise.
 *
 * ⭐ THAT MIGRATION'S OWN "Why" DESCRIBES THIS EXACT DEFECT, IN MAY:
 *   "those offers are computed ephemerally and never persisted. On the next
 *    turn the LLM has no way to know what was offered, so a user reply of
 *    'yes' routes to direct_answer with a generic 'no pending action queued'
 *    response."
 * It was fixed for the CHIP path. The Stage-4A ask intercepts, added later,
 * reintroduced it by never committing a turn at all.
 *
 * Harness modelled verbatim on the sibling file (same mocks, same live-wire
 * request shape: NO `graph_state` on the request — the platform invariant).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    // REQUIRED by this path, and its absence is not a detail: the intercept
    // reads the prior turn's pendings before committing, because a commit
    // without carry-forward would wipe a live proposal. A mock missing this
    // method makes the route fail closed and write nothing — which looks
    // exactly like the defect under test. Kept as a mock so the carry-forward
    // argument can be asserted.
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

const SCENARIO_ID = '55555555-5555-4555-8555-555555555556';

const OPTION_LABEL = 'Launch Customer Retention Programme';
const FACTOR_LABEL = 'Customer Retention Investment';
/** The graph ids the question names — the referent this file is about. */
const OPTION_ID = 'opt_retention';
const FACTOR_ID = 'fac_retention_investment';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

/**
 * `opt_retention` is linked to its factor but carries NO interventions, which
 * is what makes the bare-configure intercept matchable. Shapes taken from the
 * sibling file, which took them from the walk's own persisted graph.
 */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_arr', kind: 'goal', label: 'Reach £1,000,000 ARR' },
    { id: FACTOR_ID, kind: 'factor', label: FACTOR_LABEL },
    { id: 'fac_content_spend', kind: 'factor', label: 'Content Spend' },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    {
      id: 'opt_content',
      kind: 'option',
      label: 'Invest in Content Marketing',
      interventions: {
        fac_content_spend: { value: 1, source: 'brief_extraction', value_confidence: 'high' },
      },
    },
  ],
  edges: [
    edge(OPTION_ID, FACTOR_ID),
    edge('opt_content', 'fac_content_spend'),
    edge(FACTOR_ID, 'goal_arr'),
    edge('fac_content_spend', 'goal_arr'),
  ],
};

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

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111301',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** Every object handed to `store.append` on this turn. */
function writes(): Record<string, unknown>[] {
  return appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

describe('the configure-option clarify intercept must PERSIST the question it asked', () => {
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
    loadGraphMock.mockResolvedValue(PERSISTED_GRAPH);
  });

  // ─── THE PRECONDITION, PINNED IN-TEST ────────────────────────────────────
  // Without this, every assertion below could pass because some OTHER exit
  // handled the turn. This binds the cases to the intercept by its own
  // signature: the edit lane is not reached, and the copy names the real cell.
  async function driveTheAsk() {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Configure ${OPTION_LABEL}`),
    });
    expect(res.statusCode).toBe(200);
    // The intercept, not the edit lane, owns this turn.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const text = body(res).assistant_text as string;
    expect(text).toContain(OPTION_LABEL);
    expect(text).toContain(FACTOR_LABEL);
    return res;
  }

  it('the intercept fires and the reply names the cell (precondition — this already passes today)', async () => {
    const res = await driveTheAsk();
    const text = body(res).assistant_text as string;
    expect(text).toContain(`Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to`);
  });

  // ─── THE DEFECT ──────────────────────────────────────────────────────────
  it('writes a turn row for the turn on which it asked', async () => {
    await driveTheAsk();
    expect(
      writes().length,
      'the intercept returned via sendFinalised200 without reaching commitDirectAnswer, so no ' +
        'row landed in v5_conversation_turns — the next turn cannot see that this question was asked',
    ).toBe(1);
  });

  it("the written row carries the user's message, so the next turn's ContextPack can project it", async () => {
    await driveTheAsk();
    const write = writes()[0];
    expect(write, 'no write at all — see the previous case').toBeDefined();
    expect(write!.scenario_id).toBe(SCENARIO_ID);
    // ⚠ THE WRITE OBJECT'S FIELD IS `userMessage` (camelCase), which the store
    // maps to the `user_message` COLUMN — they are different names at
    // different layers. This assertion was first written against the column
    // name and read `undefined` against a write that was in fact correct: a
    // guard that names the wrong layer manufactures a false RED.
    expect(write!.userMessage).toBe(`Configure ${OPTION_LABEL}`);
  });

  // ─── THE REFERENT — the durable shape ────────────────────────────────────
  // Bound BY IDENTITY to the ids the question named, never by a value
  // predicate: a pending action naming some other cell must not satisfy this.
  it('the written row carries the asked cell as PERSISTED STATE (option id + factor id)', async () => {
    await driveTheAsk();
    const write = writes()[0];
    expect(write, 'no write at all — see the first failing case').toBeDefined();

    const pendings = (write!.pending_actions ?? []) as ReadonlyArray<Record<string, unknown>>;
    expect(
      pendings.length,
      'the question named a specific cell; nothing persisted it, so a bare "0.6" on the next ' +
        'turn has nothing to bind to',
    ).toBeGreaterThan(0);

    const serialised = JSON.stringify(pendings);
    expect(serialised, 'the persisted referent must name the OPTION the question was about').toContain(
      OPTION_ID,
    );
    expect(serialised, 'the persisted referent must name the FACTOR the question was about').toContain(
      FACTOR_ID,
    );
  });

  // ─── THE TWIN (mandatory) ────────────────────────────────────────────────
  // A turn that legitimately should NOT arm a pending question must still not
  // arm one. A configure message that ALREADY carries a factor and a value is
  // declined by the intercept (`value_payload_present`) and goes to the edit
  // lane exactly as before — this file must not have widened that.
  it('TWIN: a configure that already carries a value is NOT intercepted and arms no pending question', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to 0.6`),
    });
    expect(res.statusCode).toBe(200);
    // The intercept declined; the pre-existing route ran untouched.
    expect(dispatchEditGraphMock).toHaveBeenCalled();
    // And this turn armed no configure-clarify pending of its own.
    const armed = writes().some((w) =>
      JSON.stringify(w.pending_actions ?? []).includes('elicit_option_effect'),
    );
    expect(armed, 'a turn that was never intercepted must not arm the intercept’s pending').toBe(
      false,
    );
  });

  // ─── PREMISE GUARD ───────────────────────────────────────────────────────
  it('PREMISE: the pending_actions DB cap is still 3, so a persisted referent fits', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260505120000_v5_pending_actions.sql',
      ),
      'utf8',
    );
    // Positive control: the file we read is the one we think it is.
    expect(migration).toContain('pending_actions');
    // The premise itself.
    expect(
      /jsonb_array_length\([^)]*\)\s*<=\s*3/.test(migration) || migration.includes('at most 3'),
      'the pending_actions cap changed — this guard’s premise (a referent fits in the column) ' +
        'must be re-derived against the new schema',
    ).toBe(true);
  });
});
