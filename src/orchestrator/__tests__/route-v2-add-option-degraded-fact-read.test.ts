/**
 * CONTEXT/MEMORY V5 defect 4 — ROUTE C: the typed `add_option` arm of route-v2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS
 *
 * `fetchPriorFacts` (build-turn-context.ts) returns `[]` in FOUR situations —
 * no store, no prior turns, no row ids, and `readFactsFor` THREW. Only the last
 * is a failure. Before the fix all four derived `'none'`, a POSITIVE claim that
 * the scenario has never been analysed, made on a turn where the store could
 * not be read.
 *
 * The add-option arm performs its OWN `buildTurnContext` read, independent of
 * the turn-executor's, and derives `addOptionFreshness` at route-v2.ts ~:2920.
 * Critically, a thrown fact read does NOT reject that promise — the catch inside
 * `fetchPriorFacts` swallows it and reports `readOk: false` — so the arm's own
 * surrounding try/catch never fires and `prior_facts` arrives as a plain `[]`.
 * The fix threads `turnContext.prior_facts_read_ok` as the 4th argument so that
 * empty is read as `'unknown'` rather than `'none'`.
 *
 * This file drives the REAL route via `app.inject`, through the REAL
 * `buildTurnContext` and the REAL `fetchPriorFacts`, against a session store
 * whose `readFactsFor` genuinely rejects. Nothing hand-authors
 * `prior_facts_read_ok`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE OBSERVABLE, AND WHY IT IS NOT THE TELEMETRY EVENT
 *
 * Files A and B assert on `v5.analysis_freshness.derived`. THAT EVENT DOES NOT
 * EXIST ON THIS ROUTE. `emitFreshnessTelemetry` is never called from the
 * add-option arm or from `add-option-dispatch.ts` — route-v2.ts imports only
 * `deriveAnalysisFreshness` from `context/freshness.js`. Verified by a scoped
 * sweep with a contrast control (the same sweep finds seven real
 * `emitFreshnessTelemetry` call sites elsewhere, none reachable from this arm).
 *
 * Worse, the route keeps only `.freshness` and DROPS `.reason`, so
 * `'derivation_failed'` versus `'no_successful_run_analysis_fact'` is not
 * observable here at all. The verdict survives only as a `FrameFreshness` enum
 * flowing into `dispatchAddOptionTransaction` → `evaluateEditGraphMutations` →
 * `evaluateFrameGate`, whose `TRUSTWORTHY_FRESHNESS` set is
 * `{fresh, none, stale}`. So the partition this route can actually see is:
 *
 *     TRUSTWORTHY {fresh, none, stale}   vs   UNRESOLVED {unknown}
 *
 * ⚠ AND MOST OF THE OBVIOUS OBSERVABLES ARE VACUOUS HERE. Measured: both
 * `'none'` and `'unknown'` produce `governing: 'held'`, a NON-EMPTY
 * `pendingActions`, `kind: 'held'` from the dispatch, telemetry
 * `outcome: 'held'`, HTTP 200, and BYTE-IDENTICAL `assistant_text` and
 * `suggested_actions` (same `gmh_…` chip id). A test asserting any of those
 * would pass no matter which verdict the route derived.
 *
 * Exactly two things differ, and this file asserts both:
 *   1. `response.blocks` — the `held_proposal` CARD. `buildHeldProposalBlock`
 *      fails closed on a reason code outside `SURFACEABLE_REASON_CODES`
 *      (compose/held-proposal.ts:44-53,120), and `FRESHNESS_UNRESOLVED` is
 *      deliberately absent from that set. So a trustworthy frame ships the card
 *      and an unresolved one ships `blocks: []`. This is the USER-VISIBLE
 *      difference: with a degraded read the user gets a bare confirm chip and no
 *      card.
 *   2. The committed pending's `inline_patch.blocker_code` —
 *      `STRUCTURAL_APPLY_HELD` versus `FRESHNESS_UNRESOLVED`.
 *
 * Telemetry `outcome: 'held'` IS asserted in every arm, but ONLY as a
 * precondition pin proving the add-option arm genuinely claimed the turn. It is
 * NOT a discriminator and is deliberately not used as one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WOULD HAVE TO BE TRUE FOR THESE TESTS TO PASS WHILE THE PROPERTY IS BROKEN
 *
 * The dominant vacuity is a degraded arm that never degrades. `fetchPriorFacts`
 * short-circuits BEFORE its try/catch on three guards (`!store`,
 * `priorTurns.length === 0`, `priorTurnRowIds.length === 0`), each returning
 * `readOk: TRUE`. If `readRecent` returned `[]` the rejecting `readFactsFor`
 * would never run and arm 1 would assert against the HEALTHY branch. Defences:
 *   1. `readRecent` returns a real prior-turn row WITH a string `id`.
 *   2. `readFactsWithTurnFor` is DELIBERATELY ABSENT — it is tried FIRST
 *      (build-turn-context.ts:1705); a non-empty result there means
 *      `readFactsFor` never runs.
 *   3. Every arm asserts `readFactsForMock` WAS CALLED.
 *   4. Every arm asserts the add-option telemetry `outcome: 'held'`, so a turn
 *      that silently fell through to the edit lane or exited at `gm_off` cannot
 *      be mistaken for a pass.
 *
 * A vacuity specific to THIS route: `'unknown'` is reachable by a second,
 * unrelated path — a legacy `run_analysis` fact with no `graph_hash_at_run`
 * derives `'unknown' / legacy_fact_missing_hash` with no read failure involved.
 * A test built on that fixture would stay GREEN even if the `priorFactsReadOk`
 * threading at route-v2.ts:2929-2933 were deleted, making it a test about the
 * frame gate rather than about this defect. Arms 1 and 2 therefore use the
 * THROWN read exclusively. Arm 3 uses the legacy-fact route deliberately and
 * only as a sensitivity control (see below), never as the defect claim.
 *
 * The second vacuity is a fix that downgraded EVERY empty read to `unknown`,
 * which would satisfy arm 1 while destroying the product's ability to treat a
 * genuinely un-analysed scenario as a trustworthy frame. Arm 2 is the
 * discriminating twin: identical stimulus except that `readFactsFor` RESOLVES
 * `[]`, and the card must be PRESENT.
 *
 * The third vacuity is an observable that is simply stuck. Arm 3 proves the
 * card's presence genuinely tracks the derivation by moving ONE field of ONE
 * fact: a real `run_analysis` fact WITH a matching `graph_hash_at_run` (→
 * `'fresh'`) must keep the card, and the SAME fact with that field removed (→
 * `'unknown' / legacy_fact_missing_hash`) must drop it. A stuck observable
 * cannot satisfy both halves, and the pair also shows a real analysis is never
 * blanked out by the read-state flag.
 *
 * ⚠ HONEST LIMIT OF ARM 3, STATED RATHER THAN PAPERED OVER: because `.reason`
 * is dropped and `{fresh, none, stale}` all map to TRUSTWORTHY, this route
 * CANNOT distinguish `fresh` from `stale` from `none`. Arm 3 therefore proves
 * "a real fact keeps the frame trustworthy, and the observable is
 * derivation-driven" — it does NOT, and cannot, pin a hash-derived REASON the
 * way files A and B do at their telemetry observable.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

// ── config: GM live (the arm returns early with `fell_through:gm_off` otherwise) ──
const gmHolder = { mode: 'live' as 'off' | 'shadow' | 'live' };
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: new Proxy(actual.config.features, {
        get: (t, p) =>
          p === 'graphManagementMode'
            ? gmHolder.mode
            : p === 'diagnosticTraceEnabled'
              ? true
              : Reflect.get(t, p),
      }),
    },
  };
});

const GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort', observed_state: { value: 0.4 } },
  ],
  edges: [
    {
      from: 'fac_effort',
      to: 'g_profit',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

/** A prior-turn row with a string `id` — clears the `fetchPriorFacts` guards. */
const PRIOR_TURN = {
  id: 'row-prior-1',
  turn_id: 'client-turn-prior',
  scenario_id: SCENARIO_ID,
  turn_class: 'handler',
  handler_id: 'run_analysis',
  created_at: '2026-07-22T10:00:00.000Z',
};

// ── session store: readFactsFor is the seam under test ───────────────────────
const readFactsForMock = vi.fn();
const storeHolder: { graph: unknown; priorPendings: PendingAction[]; turns: unknown[] } = {
  graph: GRAPH,
  priorPendings: [],
  turns: [],
};
// ⚠ `readFactsWithTurnFor` is DELIBERATELY OMITTED — see the docblock.
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => storeHolder.turns,
    readFactsFor: readFactsForMock,
    readMostRecentPendingActions: async () => storeHolder.priorPendings,
    readMostRecentCoachingState: async () => null,
    hasPriorTurns: async () => storeHolder.turns.length > 0,
    loadGraph: async () => storeHolder.graph,
    loadGraphAndBriefText: async () => ({ graph: storeHolder.graph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── commit captured so the persisted pending's blocker_code is observable ────
const commitCalls: Array<{ response: any; meta: any }> = [];
vi.mock('../../orchestrator-v5/commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator-v5/commit.js')>();
  return {
    ...actual,
    commitDirectAnswer: async (response: any, meta: any) => {
      commitCalls.push({ response, meta });
      return { response, persistedRowId: 'mock-row-id' };
    },
  };
});

// ── fallback sinks, so "the add-option arm claimed the turn" is assertable ───
const FALLTHROUGH_RESPONSE = {
  response_version: 2 as const,
  assistant_text: 'FALLTHROUGH_SENTINEL',
  blocks: [] as const,
  suggested_actions: [] as const,
  insights: [] as const,
  stage_indicator: 'decide' as const,
};
const runTurnExecutorMock = vi.fn(async () => ({
  response: FALLTHROUGH_RESPONSE,
  analysisReady: null,
  effectiveGraph: null,
  answerKind: 'functional' as const,
  telemetry: {
    stages_completed: ['orient'],
    response_emitted: true as const,
    llm_calls_used: 0,
    commit_performed: true,
    failure_type: null,
    wall_clock_ms: 1,
    turn_class: 'decide',
    intent_class: 'edit',
    coaching_mode: null,
    validation_error_code: null,
  },
}));
const dispatchEditGraphMock = vi.fn(async () => ({
  response: FALLTHROUGH_RESPONSE,
  commitPerformed: true,
}));
vi.mock('../../orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../orchestrator-v5/handlers/edit-graph-dispatch.js')>();
  return { ...actual, dispatchEditGraph: dispatchEditGraphMock };
});

const telemetry = await import('../../utils/telemetry.js');
const { computeAnalysisAffectingGraphHash } = await import(
  '../../orchestrator-v5/context/graph-hash.js'
);
const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');

// ── fixtures ────────────────────────────────────────────────────────────────

function addOptionPayload() {
  return {
    kind: 'message',
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    stage: 'decide',
    message: 'Add an option to outsource to a BPO vendor.',
    turn_class: 'decide',
    source: 'chip',
    chip: {
      intent: 'add_option',
      parameters: {
        parent_decision_id: 'dec_choice',
        label: 'Outsource to a BPO vendor',
        interventions: [{ factor_id: 'fac_effort', value: 0.55 }],
      },
    },
  };
}

/**
 * A run_analysis fact in the shape the PRODUCER actually reads.
 *
 * ⚠ `viewRunAnalysisFact` (context/freshness.ts:227) reads `graph_hash_at_run`
 * and `computed_at` from `fact.result` and requires `noop === false`. The same
 * fields at the TOP level make the fact silently UNSELECTABLE.
 *
 * `graphHashAtRun: null` omits the field entirely, producing the LEGACY fact
 * shape (`'unknown' / legacy_fact_missing_hash`) used as arm 3's control.
 */
function runAnalysisFact(graphHashAtRun: string | null) {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_x',
      summary: 'Ran analysis.',
      ...(graphHashAtRun === null ? {} : { graph_hash_at_run: graphHashAtRun }),
      computed_at: '2026-08-15T00:00:00.000Z',
      enrichment: { confidence_tier: 'fair' },
    },
  };
}

async function post(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: addOptionPayload(),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function addOptionOutcomes(emitSpy: ReturnType<typeof vi.spyOn>): string[] {
  return (emitSpy.mock.calls as unknown[][])
    .filter((c) => c[0] === 'v5.add_option_transaction')
    .map((c) => String((c[1] as Record<string, unknown>).outcome));
}

function heldProposalBlockPresent(body: Record<string, any>): boolean {
  const blocks = (body.blocks ?? []) as Array<{ type?: string }>;
  return blocks.some((b) => b.type === 'held_proposal');
}

/** The blocker code on the pending the route actually committed. */
function committedBlockerCode(): unknown {
  const pendings = commitCalls[0]?.meta?.pending_actions as
    | Array<Record<string, any>>
    | undefined;
  expect(Array.isArray(pendings)).toBe(true);
  expect(pendings!.length).toBeGreaterThan(0);
  return pendings![0]?.action?.inline_patch?.blocker_code;
}

/**
 * Precondition pin shared by every arm: the add-option arm genuinely claimed
 * this turn and held. NOT a discriminator — both verdicts emit `'held'` — but
 * it makes a silent fall-through to the edit lane or a `gm_off` exit fail loud
 * instead of being mistaken for a pass.
 */
function assertAddOptionArmHeld(emitSpy: ReturnType<typeof vi.spyOn>) {
  const outcomes = addOptionOutcomes(emitSpy);
  expect(outcomes).toContain('held');
  expect(outcomes.some((o) => o.startsWith('fell_through'))).toBe(false);
  expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  expect(runTurnExecutorMock).not.toHaveBeenCalled();
  expect(readFactsForMock).toHaveBeenCalled();
}

describe('route-v2 add_option — a degraded prior-fact read must not claim "never analysed" (defect 4, route C)', () => {
  let app: FastifyInstance;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    gmHolder.mode = 'live';
    storeHolder.graph = GRAPH;
    storeHolder.priorPendings = [];
    // Non-empty prior turns WITH row ids — clears the three `fetchPriorFacts`
    // short-circuits so the try/catch is genuinely reached.
    storeHolder.turns = [PRIOR_TURN];
    commitCalls.length = 0;
    readFactsForMock.mockReset();
    runTurnExecutorMock.mockClear();
    dispatchEditGraphMock.mockClear();
    emitSpy = vi.spyOn(telemetry, 'emit');
  });

  it('DEGRADED: readFactsFor THROWS → the frame is UNRESOLVED, not a trustworthy "never analysed"', async () => {
    readFactsForMock.mockRejectedValue(new Error('simulated prior-fact read failure'));

    const { status, body } = await post(app);
    expect(status).toBe(200);
    assertAddOptionArmHeld(emitSpy);

    // The degraded read is carried honestly: the freshness authority could not
    // be resolved, so the held_proposal CARD fails closed.
    expect(heldProposalBlockPresent(body)).toBe(false);
    expect(committedBlockerCode()).toBe('FRESHNESS_UNRESOLVED');
    // The defect, as its own assertion: a store failure must not be reported as
    // the trustworthy pre-analysis frame that a genuine `'none'` produces.
    expect(committedBlockerCode()).not.toBe('STRUCTURAL_APPLY_HELD');
  });

  it('OK-ARM CONTROL: readFactsFor RESOLVES [] → a trustworthy "no analysis yet" frame', async () => {
    // The discriminating twin: identical to the arm above except the read
    // SUCCEEDS and is genuinely empty. A fix that downgraded every empty read to
    // `unknown` would pass arm 1 and fail here.
    readFactsForMock.mockResolvedValue([]);

    const { status, body } = await post(app);
    expect(status).toBe(200);
    assertAddOptionArmHeld(emitSpy);

    expect(heldProposalBlockPresent(body)).toBe(true);
    expect(committedBlockerCode()).toBe('STRUCTURAL_APPLY_HELD');
    expect(committedBlockerCode()).not.toBe('FRESHNESS_UNRESOLVED');
  });

  it('FACT-AUTHORITATIVE: a real run_analysis fact is never blanked out, and the card tracks the derivation', async () => {
    const currentHash = computeAnalysisAffectingGraphHash(GRAPH as never);
    // Pins the fixture against the code's own hashing — a null here would make
    // the "matching hash" half meaningless.
    expect(typeof currentHash).toBe('string');

    // ── half 1: a real fact WITH a matching hash (→ 'fresh') keeps the card ──
    readFactsForMock.mockResolvedValue([runAnalysisFact(currentHash as string)]);

    const first = await post(app);
    expect(first.status).toBe(200);
    assertAddOptionArmHeld(emitSpy);

    expect(heldProposalBlockPresent(first.body)).toBe(true);
    expect(committedBlockerCode()).toBe('STRUCTURAL_APPLY_HELD');
    // A real analysis exists and was read successfully — the read-state flag
    // must not turn it into an unresolved frame.
    expect(committedBlockerCode()).not.toBe('FRESHNESS_UNRESOLVED');

    // ── half 2: the SAME fact with graph_hash_at_run REMOVED drops the card ──
    // A legacy fact derives 'unknown' / legacy_fact_missing_hash with no read
    // failure involved. This is a SENSITIVITY control only — it proves the card
    // genuinely tracks the derivation rather than being stuck present, and is
    // deliberately NOT the defect claim (it would stay green even if the
    // priorFactsReadOk threading were deleted; arms 1 and 2 are the defect claim).
    commitCalls.length = 0;
    runTurnExecutorMock.mockClear();
    dispatchEditGraphMock.mockClear();
    readFactsForMock.mockReset();
    readFactsForMock.mockResolvedValue([runAnalysisFact(null)]);

    const second = await post(app);
    expect(second.status).toBe(200);
    expect(readFactsForMock).toHaveBeenCalled();

    expect(heldProposalBlockPresent(second.body)).toBe(false);
    expect(committedBlockerCode()).toBe('FRESHNESS_UNRESOLVED');
  });
});
