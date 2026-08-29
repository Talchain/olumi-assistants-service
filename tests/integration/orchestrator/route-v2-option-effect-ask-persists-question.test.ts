/**
 * THE PRODUCT ASKS A QUESTION AND DOES NOT REMEMBER ASKING IT — exit 5.
 *
 * ⭐ THE ASK, from `composeOptionEffectAskResponse`: the sentence is
 * unmistakably an option-effect request carrying a value, the ENTITY is
 * ambiguous, and rather than guess the product says so and offers a chip per
 * candidate. Until ROADMAP 2.1353 it returned via `sendFinalised200` — an early
 * return that never reaches `commitDirectAnswer` — so no turn row was written
 * and the answer arrived at a model with no record of the question. Same
 * mechanism as ROADMAP 2.1352 (CEE #1213); one of the five siblings that lane
 * found by ENUMERATING all 23 `sendFinalised200` exits.
 *
 * ⚠ WHY THIS FILE ASSERTS THE **WRITE** AND NOT THE REPLY. The sibling
 * `route-v2-option-effect-ask.test.ts` drives this exact arm, holds an
 * `appendMock` it clears and never asserts on, and makes every assertion about
 * the response body. The reply is correct; the persistence is what is missing.
 * A reply-shaped assertion cannot see this defect — which is why it shipped.
 *
 * ⚠ AND THE MOCK ACCEPTS ANYTHING, so these assertions bind to the SHAPE OF THE
 * WRITE by IDENTITY (the option and factor ids of the candidates), never by a
 * value predicate another write could satisfy.
 *
 * Fixtures taken verbatim from the sibling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const turnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: turnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const readPendingsMock = vi.fn().mockResolvedValue([]);
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    // REQUIRED by this path: the ask reads the prior turn's pendings before
    // committing, because a commit without carry-forward would wipe a live
    // proposal. A mock missing this makes the route fail closed and write
    // nothing — which looks exactly like the defect under test.
    readMostRecentPendingActions: readPendingsMock,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
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

const SCENARIO_ID = '22222222-2222-4222-8222-22222222222a';

const OPTION_A = 'Leeds depot expansion';
const OPTION_B = 'Manchester depot expansion';
const FACTOR = 'Capital expenditure';

/** The graph ids the ask offers — the referent this file binds to. */
const OPTION_ID_A = 'opt_leeds';
const OPTION_ID_B = 'opt_manchester';
const FACTOR_ID = 'fac_capex';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

const GRAPH_STATE = {
  nodes: [
    { id: 'dec_depot', kind: 'decision', label: 'Depot capacity' },
    { id: OPTION_ID_A, kind: 'option', label: OPTION_A, interventions: {} },
    { id: OPTION_ID_B, kind: 'option', label: OPTION_B, interventions: {} },
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR,
      observed_state: { value: 0.5, source: 'cee_inference', extractionType: 'inferred' },
    },
    { id: 'goal_margin', kind: 'goal', label: 'Margin preservation' },
  ],
  edges: [
    edge('dec_depot', OPTION_ID_A),
    edge('dec_depot', OPTION_ID_B),
    edge(OPTION_ID_A, FACTOR_ID),
    edge(OPTION_ID_B, FACTOR_ID),
    edge(FACTOR_ID, 'goal_margin'),
  ],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'edit lane engaged',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function makeTurnExecutorMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'turn-executor path',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    telemetry: {
      stages_completed: ['build_turn_context', 'route', 'execute', 'commit'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 12,
      turn_class: null,
      intent_class: null,
      coaching_mode: null,
      validation_error_code: null,
    },
  };
}

let turnCounter = 0;
function payload(message: string): Record<string, unknown> {
  turnCounter += 1;
  return {
    kind: 'message',
    turn_id: `22222222-2222-4222-8222-2222222215${String(turnCounter).padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
  };
}

function writes(): Record<string, unknown>[] {
  return appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

function effectTargetPendings(
  write: Record<string, unknown> | undefined,
): ReadonlyArray<Record<string, unknown>> {
  return ((write?.pending_actions ?? []) as ReadonlyArray<Record<string, unknown>>).filter(
    (p) => (p.action as Record<string, unknown> | undefined)?.kind === 'elicit_effect_target',
  );
}

const AMBIGUOUS_MESSAGE =
  `Set the ${OPTION_A} option's effect and the ${OPTION_B} option's effect on ${FACTOR} to 0.4.`;

describe('the option-effect ask must PERSIST the question it asked', () => {
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
    dispatchEditGraphMock.mockResolvedValue(makeEditGraphMockResult());
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
    appendMock.mockClear();
    readPendingsMock.mockReset();
    readPendingsMock.mockResolvedValue([]);
  });

  // ─── THE PRECONDITION, PINNED IN-TEST ────────────────────────────────────
  // Binds every case below to THIS exit: the guess is only avoidable before
  // dispatch, so neither the edit lane nor the executor may run, and the reply
  // must name both options.
  async function driveTheAsk() {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(AMBIGUOUS_MESSAGE),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).not.toHaveBeenCalled();
    const text = (res.json() as { assistant_text: string }).assistant_text;
    expect(text).toContain(OPTION_A);
    expect(text).toContain(OPTION_B);
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

  it("the written row carries the user's message", async () => {
    await driveTheAsk();
    const write = writes()[0];
    expect(write, 'no write at all — see the previous case').toBeDefined();
    expect(write!.scenario_id).toBe(SCENARIO_ID);
    // ⚠ `userMessage` is the WRITE field; `user_message` is the COLUMN.
    expect(write!.userMessage).toBe(AMBIGUOUS_MESSAGE);
  });

  // ─── THE REFERENT, BOUND BY IDENTITY ─────────────────────────────────────
  it("the row carries the USER'S OWN VALUE and the CANDIDATES, bound by id", async () => {
    await driveTheAsk();
    const armed = effectTargetPendings(writes()[0]);
    expect(
      armed.length,
      'the ask offered a chip per candidate; nothing persisted them, so a reply naming one has ' +
        'nothing to bind to',
    ).toBe(1);

    const action = armed[0]!.action as Record<string, unknown>;
    // ⭐ THE DISCRIMINATION FROM ITS SIBLING. The repair-value ask persists the
    // same KIND with `source: 'repair_value_ask'`; this exit's candidates come
    // from the user's own sentence rather than from outstanding blockers, and a
    // referent that misreported which question was asked would let a resume
    // make a false claim about the user's own words.
    expect(action.source).toBe('option_effect_ask');
    expect(action.value_text).toBe('0.4');

    const candidates = action.candidates as ReadonlyArray<Record<string, unknown>>;
    expect(candidates.map((c) => c.option_id)).toEqual([OPTION_ID_A, OPTION_ID_B]);
    for (const c of candidates) {
      expect(c.factor_id).toBe(FACTOR_ID);
      expect(c.factor_label).toBe(FACTOR);
    }
    expect(armed[0]!.chip_id).toBe('chip_option_effect_ask');
  });

  // ─── THE WIRE MUST CARRY WHAT WAS PERSISTED ──────────────────────────────
  // ⚠⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. This site ships the response
  // the COMMIT CHOKEPOINT returned rather than the one it composed, because
  // `commitDirectAnswer` may APPEND to it (F-HELD fix 2b's lapse notice). A
  // mutant that shipped the composed object instead left every spec GREEN —
  // every other assertion here is about the WRITE, which is identical either
  // way. The claim was in a comment with no guard behind it.
  it('the SHIPPED body is the COMMITTED body — a lapse notice appended at the chokepoint reaches the user', async () => {
    readPendingsMock.mockResolvedValue([
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        scenario_id: SCENARIO_ID,
        chip_id: 'prop_lapsing_2',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_lapsing_2',
          inline_patch: {},
          public_label: 'Widen the depot budget',
          public_message: 'Widen the depot budget',
        },
        preconditions: {},
        // ONE turn left: the carry-forward decrement takes it to zero at THIS
        // commit, which is the only place a consent lapse is observable.
        expires_at_turn_count: 1,
        expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        emitted_at_iso: new Date().toISOString(),
      },
    ]);

    const res = await driveTheAsk();
    const shipped = (res.json() as { assistant_text: string }).assistant_text;
    expect(
      shipped,
      'the commit appended a lapse notice to the response it persisted; shipping the pre-commit ' +
        'object makes the wire and the turn row disagree about what the user was told',
    ).toContain('has lapsed');
    expect(shipped).toContain('Widen the depot budget');
    expect(writes()[0]!.assistantMessage).toContain('has lapsed');
  });

  // ─── CARRY-FORWARD: LOSING THE MEMORY BEATS LOSING THE PROPOSAL ──────────
  it('an UNREADABLE prior-pending state fails CLOSED — nothing is written at all', async () => {
    readPendingsMock.mockRejectedValue(new Error('session read failed'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(AMBIGUOUS_MESSAGE),
    });
    expect(res.statusCode).toBe(200);
    // The user still gets the answer — the degrade is the pre-2.1353 behaviour.
    expect((res.json() as { assistant_text: string }).assistant_text).toContain(OPTION_A);
    expect(
      writes().length,
      'a commit without carry-forward would wipe live proposals, so an unreadable prior state ' +
        'must abort the commit rather than proceed without them',
    ).toBe(0);
  });

  // ─── THE TWIN (mandatory) ────────────────────────────────────────────────
  it('TWIN: an UNAMBIGUOUS request is dispatched, not asked, and arms no ask pending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Set the ${OPTION_A} option's effect on ${FACTOR} to 0.4.`),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const armed = writes().some((w) => effectTargetPendings(w).length > 0);
    expect(armed, 'a turn that asked nothing must not arm an asked-question referent').toBe(false);
  });
});
