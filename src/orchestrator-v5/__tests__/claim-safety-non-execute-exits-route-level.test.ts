/**
 * G-CEE-1 — THE PERMISSION BELONGS TO THE DISPLAYED FACT, NOT TO WHETHER THIS
 * TURN RAN AN ANALYSIS (ROADMAP 1.233 finish-line criterion 2 + 1.349 P1-2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, live-confirmed 28 Jul. After a withheld analysis
 * (`may_name_leading_option: false`), an EDIT turn came back `true`.
 *
 * Every non-execute exit in `route-v2.ts` handed `sendFinalised200` a LITERAL
 * `mayNameLeadingOption: true`, under a comment whose premise was:
 *
 *     "this path runs no analysis, so it withheld no leading-option claim.
 *      `true` is the honest statement of that, not a fail-open."
 *
 * The premise is wrong, and the reason is the whole point of this file:
 * **permission is a property of the FACT THE RESPONSE DISPLAYS, not of the
 * work THIS turn performed.** An edit turn is handed the prior analysis as
 * context (`edit-graph-dispatch.ts` takes request-supplied prior analysis and
 * its `assistantText` returns downstream of it), so an edit response can and
 * does talk about the withheld analysis. A `true` there means:
 *
 *   1. the Layer-3 egress alarm is armed with an explicit permission to
 *      ignore whatever the body says — a LICENSED no-op, not a silent one; and
 *   2. leader prose about the withheld analysis is not projected away.
 *
 * "It ran no analysis" and "it displays no analysis" are different claims. The
 * comment asserted the first and was relied on for the second.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE ASSERTS, AND ON WHAT.
 *
 * Assertions are on the SERIALISED HTTP BYTES — `_diagnostic_trace.claim_safety`
 * — which is the one wire surface that reports the permission the egress guard
 * was armed with, and is stamped at the single `sendFinalised200` chokepoint
 * every dispatch family passes through. Nothing here asserts on a value a
 * function under test returned to its own caller.
 *
 * ⚠ THE POSITIVE CONTROL IS NOT OPTIONAL, AND THE ESTATE LEARNED THAT THE
 * EXPENSIVE WAY. #737 shipped a conjunction whose over-suppression arm was
 * unpinned. A blanket `false` at these exits would satisfy every RED test in
 * this file and would be a WORSE defect than the one it replaces — it would
 * suppress leader prose on scenarios that legitimately permit it. So every
 * withheld arm below is paired with a PERMIT-WINS arm on the same exit, and
 * the mutation-check runs `blanket-false` explicitly.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
// The production intercept's OWN constant, so this test and the intercept
// cannot drift apart on the chip copy.
import { SIMPLIFY_CHANGE_CHIP_PROMPT } from '../routing/chip-simplify-intercept.js';
// The WIRE gate's OWN replacement constant, so this file and the gate cannot
// drift apart on the substituted copy (ROADMAP 2.149).
import { WIRE_WITHHELD_LEADER_REPLACEMENT } from '../compose/leading-option-wire-enforcement.js';
// The PRODUCER's own coaching copy, so the canary below cannot drift from the
// sentence it exists to protect (CLAUDE.md trap #12).
import { COACHING_TEXT } from '../signals/coaching-signals.js';

const SCENARIO_ID = 'a1b2c3d4-1349-4123-8123-a1b2c3d41349';
const LEADER_LABEL = 'Hire Marketing Manager';
const RUNNER_LABEL = 'Hold';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand' },
    { id: 'opt_hire', kind: 'option', label: LEADER_LABEL, interventions: { fac_capacity: 1 } },
    {
      id: 'opt_hold',
      kind: 'option',
      label: RUNNER_LABEL,
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
      from: 'opt_hold',
      to: 'fac_capacity',
      strength: { mean: 0.1, std: 0.05 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_growth',
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_market',
      to: 'goal_growth',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never);

/** The scenario's analysis fact, carrying a real leading option. */
function baseRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 9_000_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: LEADER_LABEL, win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_hold', option_label: RUNNER_LABEL, win_probability: 0.28, outcome_mean: 0.3 },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/** STAMPED WITHHELD — the live shape that produced the 28 Jul confirmation. */
function withheldRunAnalysisFact(): Record<string, unknown> {
  const fact = baseRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: false,
    constraint_verdict_state: 'unevaluated',
  };
  return fact;
}

/** STAMPED PERMITTED — the PERMIT-WINS control's input. */
function permittedRunAnalysisFact(): Record<string, unknown> {
  const fact = baseRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: true,
    constraint_verdict_state: 'evaluated_feasible',
  };
  return fact;
}

const ANALYSIS_TURN_ROW_ID = 'aaaaaaaa-1349-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The FK-parent turn row. Seeding the fact alone yields an EMPTY `prior_facts`
 * (`buildTurnContext` loads facts by FK from the turn ids), the verdict reads
 * as "no analysis ⇒ true", and every withheld assertion below would pass
 * VACUOUSLY on the wrong branch. The BRANCH DISCRIMINATOR tests exist because
 * of exactly this.
 */
const ANALYSIS_TURN = {
  id: ANALYSIS_TURN_ROW_ID,
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
  user_message: 'Run the analysis',
  assistant_message: 'Analysis complete.',
};

// ── Mutable fixture state, set per case ────────────────────────────────────
let factsByTurnRowId: Record<string, Array<Record<string, unknown>>> = {};
/** `null` ⇒ the scenario has no persisted graph (drives the recovery exit). */
let persistedGraph: unknown = READY_GRAPH;
/** Make the windowed turn read throw, to exercise the DEGRADED path. */
let turnReadFails = false;
/** Make EVERY claim-safety-relevant read throw — a fully degraded store. */
let allReadsFail = false;
/**
 * Make ONLY the SCENARIO-scoped read throw, leaving `countTurns` alive.
 * (ROADMAP 2.149.) That is the exact shape `fail_closed_truncated` requires:
 * `readOk === false` AND a `prior_turns_total` big enough to prove truncation
 * (`claim-safety-read.ts:517`, scope built at `:642-655`). `allReadsFail` cannot
 * produce it — killing `countTurns` too is what disarms the fail-closed guard
 * and lands on the KNOWN-GAP branch pinned below.
 */
let scenarioReadFails = false;
/** What `countTurns` reports. `> prior_turns.length` ⇒ `windowTruncated`. */
let priorTurnsTotal = 1;

function makeStore(): Record<string, unknown> {
  return {
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit: number = 20) => {
      if (turnReadFails) throw new Error('simulated session store failure');
      return [ANALYSIS_TURN].slice(0, limit);
    },
    countTurns: async () => { if (allReadsFail) throw new Error("degraded"); return priorTurnsTotal; },
    readFactsFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.flatMap((id) => factsByTurnRowId[id] ?? []),
    readFactsWithTurnFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.flatMap((id) =>
        (factsByTurnRowId[id] ?? []).map((fact) => ({
          fact,
          turn_id: id,
          fact_created_at: new Date(Date.now() - 9_000_000).toISOString(),
        })),
      ),
    // SCENARIO-SCOPED: newest non-noop run_analysis fact across ALL turns.
    readNewestAnalysisFactFor: async () => {
      if (allReadsFail || scenarioReadFails) throw new Error("degraded");
      const all = Object.values(factsByTurnRowId).flat();
      return all.find((f) => f.fact_type === 'run_analysis' && f.noop === false) ?? null;
    },
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => makeStore(),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * `importOriginal`-spread rather than a hand-listed factory (CLAUDE.md trap
 * #12): a `vi.mock` factory REPLACES the module, so listing only the export
 * this file stubs would silently blank every other one.
 */
vi.mock('../decision-records/index.js', async () => {
  const actual = await vi.importActual<typeof import('../decision-records/index.js')>(
    '../decision-records/index.js',
  );
  return {
    ...actual,
    getDecisionRecordStore: () => ({
      createRecord: async () => ({ record_id: 'unused', deduped: false }),
      retrieveRecords: async () => ({ records: [], totalCount: 0 }),
    }),
  };
});

/**
 * The MAIN edit exit needs `dispatchEditGraph` to return a committed result,
 * which in production means an edit-LLM round trip. Mocked so the arm measures
 * the ROUTE's claim-safety stamp rather than the edit pipeline — every case in
 * this file that is NOT the main-edit arm returns before dispatch, so the mock
 * is inert for them (asserted by the branch discriminators).
 */
const dispatchEditGraphMock = vi.fn();
vi.mock('../handlers/edit-graph-dispatch.js', async () => {
  const actual = await vi.importActual<typeof import('../handlers/edit-graph-dispatch.js')>(
    '../handlers/edit-graph-dispatch.js',
  );
  return { ...actual, dispatchEditGraph: dispatchEditGraphMock };
});

/**
 * The chip_click `ok` exit (`route-v2.ts:2411`) is the one exit whose verdict
 * comes from the DISPATCH rather than the turn-entry resolver
 * (`cc.mayNameLeadingOption`, REQUIRED on `ok`). Mocked so the arm measures the
 * WIRE gate on a model-text-capable exit the claim-safety estate has never
 * driven. `importOriginal`-spread, never a hand-listed factory: a `vi.mock`
 * factory REPLACES the module, so listing only the export this file stubs would
 * silently blank `isDeterministicChipClickActionType` and route every chip click
 * to the executor instead (CLAUDE.md trap #12).
 */
const dispatchDeterministicChipClickMock = vi.fn();
vi.mock('../handlers/chip-click-dispatch.js', async () => {
  const actual = await vi.importActual<typeof import('../handlers/chip-click-dispatch.js')>(
    '../handlers/chip-click-dispatch.js',
  );
  return { ...actual, dispatchDeterministicChipClick: dispatchDeterministicChipClickMock };
});

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

function converseTextOnly(text: string) {
  return {
    type: 'text_only' as const,
    text,
    inferredIntent: 'converse',
    llmCallCount: 1,
    droppedActions: [],
    orientationText: '',
    rawResult: {
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
  };
}

// Dynamic, NOT a static top-level import: `route-v2.js` pulls in
// `turn-executor.js`, which imports the module mocked above. A static import
// here evaluates that graph before the `vi.mock` factory's closure variable is
// initialised ("Cannot access 'routeWithToolUseMock' before initialization").
// The production recovery copy comes off the same import for the same reason.
const { ceeOrchestratorRouteV2, EDIT_GRAPH_RECOVERY_TEXT } = await import(
  '../../orchestrator/route-v2.js'
);

async function postTurn(
  app: FastifyInstance,
  message: string,
  opts: { withGraphState?: boolean } = {},
) {
  const withGraphState = opts.withGraphState ?? true;
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: 'clarify',
      source: 'composer',
      ...(withGraphState ? { graph_state: READY_GRAPH } : {}),
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

/** The permission the egress guard was armed with, off the WIRE. */
function permissionOnTheWire(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.claim_safety?.may_name_leading_option;
}

function provenanceOnTheWire(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.claim_safety?.verdict_provenance;
}

/**
 * `_diagnostic_trace` is flag-gated, and the trace IS the wire surface this
 * file measures the permission on — so the flag is SET for the file and
 * restored after, never assumed.
 */
let priorTraceFlag: string | undefined;

/** Telemetry captured per test — the Layer-3 alarm's only observable. */
let events: Array<{ name: string; data: Record<string, any> }> = [];

/**
 * ⭐ THE EXIT MANIFEST UNDER TEST. Each entry drives ONE `sendFinalised200`
 * call site in `route-v2.ts` that hardcoded `mayNameLeadingOption: true`.
 *
 * The `exitPath` is asserted off the wire per case (via the response shape
 * each exit uniquely produces), so a routing change that silently moves a case
 * to a DIFFERENT exit turns this file red instead of quietly re-testing the
 * same exit three times — the failure mode a hand-listed manifest always has.
 */
describe('G-CEE-1 — claim safety on the NON-EXECUTE / EDIT exits', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });

  beforeEach(() => {
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, any> });
    });
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('Noted.'));
    persistedGraph = READY_GRAPH;
    turnReadFails = false;
    allReadsFail = false;
    scenarioReadFails = false;
    priorTurnsTotal = 1;
    dispatchDeterministicChipClickMock.mockReset();
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [withheldRunAnalysisFact()] };
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENT CHECKS FIRST (TESTING-DISCIPLINE rule 2) ───────────────────

  it('INSTRUMENT: the trace surface really is on the wire, or every assertion is vacuous', async () => {
    const { status, body } = await postTurn(app, 'Where does this leave things?');
    expect(status).toBe(200);
    expect(
      body._diagnostic_trace?.claim_safety,
      'the flag-gated claim_safety block must be present, or `undefined === false` would never fail',
    ).toBeDefined();
  });

  it('INSTRUMENT: the CONVERSE exit already reads the fact — the fixture really is withheld', async () => {
    // The turn_executor exit is the one path that ALREADY inherits the verdict
    // (`run.mayNameLeadingOption`). If it does not say `false` on this fixture,
    // the fixture is wrong and every edit-exit RED below would be measuring a
    // broken fixture rather than the defect.
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(
      permissionOnTheWire(body),
      'the withheld fixture must reach the permission on the path that already reads it',
    ).toBe(false);
  });

  // ── ⭐ THE DEFECT, ONE ARM PER EXIT ───────────────────────────────────────

  describe('the VAGUE-EDIT intercept exit', () => {
    const MESSAGE = 'Make the model better';

    it('BRANCH DISCRIMINATOR: this turn really reaches the intercept, not the executor', async () => {
      await postTurn(app, MESSAGE);
      expect(
        routeWithToolUseMock,
        'the vague-edit intercept returns BEFORE the router — if the router ran, the case reached the wrong exit',
      ).not.toHaveBeenCalled();
    });

    it('RED-FIRST: a withheld scenario must WITHHOLD on the intercept exit', async () => {
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(
        permissionOnTheWire(body),
        'permission belongs to the DISPLAYED fact — this exit shows the withheld analysis',
      ).toBe(false);
    });

    it('the provenance is the REAL one, not a fabricated or absent one', async () => {
      const { body } = await postTurn(app, MESSAGE);
      expect(
        provenanceOnTheWire(body),
        'the exit consulted a fact, so it must say WHICH kind of answer that was',
      ).toBe('scenario_fact');
    });

    it('PERMIT-WINS CONTROL: a permitted scenario STAYS permitted', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const { body } = await postTurn(app, MESSAGE);
      expect(
        permissionOnTheWire(body),
        'a blanket `false` would be a WORSE defect than the hardcoded `true` — this arm is what catches it',
      ).toBe(true);
    });
  });

  describe('the CHIP-SIMPLIFY intercept exit', () => {
    const MESSAGE = SIMPLIFY_CHANGE_CHIP_PROMPT;

    it('BRANCH DISCRIMINATOR: this turn really reaches the intercept', async () => {
      await postTurn(app, MESSAGE);
      expect(routeWithToolUseMock).not.toHaveBeenCalled();
    });

    it('RED-FIRST: a withheld scenario must WITHHOLD on the chip-simplify exit', async () => {
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(permissionOnTheWire(body)).toBe(false);
    });

    it('PERMIT-WINS CONTROL: a permitted scenario STAYS permitted', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const { body } = await postTurn(app, MESSAGE);
      expect(permissionOnTheWire(body)).toBe(true);
    });
  });

  describe('the EDIT-GRAPH RECOVERY exit', () => {
    // Edit intent, NO graph_state on the request, and no persisted graph ⇒
    // `no_persisted_graph` recovery. "Add a risk …" is explicitly documented in
    // vague-edit-guard.ts as a shape the vague guard must NOT claim, so this
    // reaches the edit dispatch region rather than the intercept above.
    const MESSAGE = 'Add a risk for coordination overhead';

    beforeEach(() => {
      persistedGraph = null;
    });

    it('BRANCH DISCRIMINATOR: this turn really reaches the RECOVERY exit', async () => {
      const { body } = await postTurn(app, MESSAGE, { withGraphState: false });
      expect(
        body.assistant_text,
        'the recovery copy is what proves this case reached sendEditGraphRecovery and not another 200',
      ).toBe(EDIT_GRAPH_RECOVERY_TEXT);
    });

    it('RED-FIRST: a withheld scenario must WITHHOLD on the recovery exit', async () => {
      const { status, body } = await postTurn(app, MESSAGE, { withGraphState: false });
      expect(status).toBe(200);
      expect(permissionOnTheWire(body)).toBe(false);
    });

    it('PERMIT-WINS CONTROL: a permitted scenario STAYS permitted', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const { body } = await postTurn(app, MESSAGE, { withGraphState: false });
      expect(permissionOnTheWire(body)).toBe(true);
    });
  });

  describe('FAIL-CLOSED — the two situations where nothing can be read', () => {
    // "Fail closed" is a claim about a branch, and an unexercised branch is a
    // claim nobody has checked. Both arms below would have passed silently as
    // `true` under the pre-fix literal, and a fail-OPEN rewrite of the resolver
    // would pass every other test in this file.

    it('a degraded WINDOW read still withholds — the scenario read carries it', async () => {
      // ⚠ MY OWN PREMISE WAS WRONG HERE AND THE TEST CORRECTED IT, so it is
      // recorded as what it measures rather than what I expected.
      // `buildTurnContext` does NOT propagate read failures: every fetch is
      // individually guarded and degrades to an empty/null value. So a thrown
      // window read does not reach the resolver's catch at all — it produces a
      // context whose `prior_facts` are empty but whose SCENARIO-scoped read
      // still supplied the withheld fact. The permission is therefore still
      // `false`, and honestly provenanced `scenario_fact`, because a real fact
      // really was read. That is the union in `readMayNameLeadingOptionVerdict`
      // doing its job, and it is worth pinning: this is the common degraded
      // shape and it is SAFE.
      turnReadFails = true;
      const { status, body } = await postTurn(app, 'Make the model better');
      expect(status).toBe(200);
      expect(permissionOnTheWire(body)).toBe(false);
      expect(provenanceOnTheWire(body)).toBe('scenario_fact');
    });

    it('KNOWN GAP, PINNED: a FULLY degraded store still fails OPEN', async () => {
      // ⚠ THIS IS A RECORDED DEFECT, NOT A BLESSING — and it is pinned rather
      // than quietly left undiscovered, so it fails loud in BOTH directions:
      // closing it turns this test red and forces a deliberate edit here.
      //
      // With the window read, the COUNT read and the scenario read all failing,
      // `readMayNameLeadingOptionVerdict` cannot arm its fail-closed guard —
      // that guard requires `windowTruncated`, which requires a
      // `prior_turns_total` that a degraded `countTurns` cannot supply — so it
      // reaches the "honest true" branch on a scenario that DOES have a
      // withheld analysis.
      //
      // NOT INTRODUCED BY THE HOIST, and not fixable at this seam. It lives in
      // the canonical derivation, and the EXECUTE path has the identical
      // exposure because it calls the same function with the same scope.
      // Patching it here would fork the derivation — the exact
      // second-derivation defect (CLAUDE.md trap #12) the resolver exists to
      // avoid. It needs its own change, in `claim-safety-read.ts`, with the
      // over-suppression controls that a shared-path change requires.
      // BOTH flags: the gap needs the WINDOW read to fail as well. With only
      // the count and scenario reads down, the window still carries the
      // withheld fact and the permission is correctly `false` — which is why
      // the arm above is a separate, passing case rather than the same one.
      turnReadFails = true;
      allReadsFail = true;
      const { body } = await postTurn(app, 'Make the model better');
      expect(
        permissionOnTheWire(body),
        'if this is now `false`, the residual fail-open has been CLOSED — good. Update this pin ' +
          'and the note in turn-claim-safety.ts rather than deleting the test.',
      ).toBe(true);
      expect(provenanceOnTheWire(body)).toBe('no_analysis_exists');
    });

    it('a SYSTEM EVENT withholds — the one family that cannot build a turn context', async () => {
      // DERIVED, not assumed: `buildTurnContext` is typed `MessageTurnPayload`
      // and reads `payload.message`, which the system_event union member does
      // not have. `undo` is client-only, so it returns 200 without committing.
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'system_event',
          turn_id: randomUUID(),
          scenario_id: SCENARIO_ID,
          stage: 'analyse',
          event: { kind: 'undo' },
        },
      });
      const body = JSON.parse(res.body) as Record<string, any>;
      expect(res.statusCode).toBe(200);
      expect(permissionOnTheWire(body)).toBe(false);
      expect(provenanceOnTheWire(body)).toBe('fail_closed_no_turn_context');
    });
  });

  describe('the MAIN EDIT exit — the one the 28 Jul live confirmation caught', () => {
    // Edit intent WITH a graph on the request ⇒ past the intercepts, through
    // `dispatchEditGraph`, out of the main `edit_graph` 200.
    const MESSAGE = 'Add a risk for coordination overhead';
    const EDIT_RECEIPT = 'Added a risk for coordination overhead.';

    beforeEach(() => {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        // The gate reads this for the option ROSTER only. A `graph: null` mock
        // would silently disarm enforcement and every RED below would pass by
        // testing nothing — the exits under test all ship a real graph.
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: EDIT_RECEIPT,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    });

    it('BRANCH DISCRIMINATOR: this turn really reaches the MAIN edit exit', async () => {
      const { body } = await postTurn(app, MESSAGE);
      expect(
        dispatchEditGraphMock,
        'the main edit exit is downstream of dispatchEditGraph — if it never ran, this case reached an intercept instead',
      ).toHaveBeenCalled();
      expect(body.assistant_text).toBe(EDIT_RECEIPT);
    });

    it('RED-FIRST: a withheld scenario must WITHHOLD on the main edit exit', async () => {
      // ⭐ THIS IS THE LIVE DEFECT, at the exit that produced it: a withheld
      // analysis, then an edit turn that came back `true`.
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(
        permissionOnTheWire(body),
        'an edit turn DISPLAYS the prior analysis — a withheld one must not be named under an edit exit`s permission',
      ).toBe(false);
    });

    it('the provenance is the REAL one', async () => {
      const { body } = await postTurn(app, MESSAGE);
      expect(provenanceOnTheWire(body)).toBe('scenario_fact');
    });

    it('PERMIT-WINS CONTROL: a permitted scenario STAYS permitted', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const { body } = await postTurn(app, MESSAGE);
      expect(permissionOnTheWire(body)).toBe(true);
    });

    // ── THE EGRESS INTERACTION — the point of the whole exercise ───────────
    //
    // ⚠ WHAT THESE ARMS ASSERT CHANGED ON 2026-07-31 (ROADMAP 2.149), AND THE
    // OLD ASSERTION IS RECORDED HERE RATHER THAN DELETED (CLAUDE.md trap #14).
    //
    // The arm below used to be called "the Layer-3 alarm is ARMED by the
    // inherited verdict, and FIRES on leader prose", and it asserted EXACTLY
    // three things: `status === 200`, exactly one alarm event, `hit_count > 0`.
    // NOTHING touched the body. That is a faithful record of the state #737 left
    // behind — the alarm was armed and the leader claim SHIPPED ANYWAY, because
    // `enforce: false` is the alarm's only wired mode and the #755 enforcing
    // guard is a function nested inside `runTurnExecutor` that this exit returns
    // before ever reaching. The test pinned the harm; it did not fix it.
    //
    // The harm is now fixed at the wire, so the arm asserts the BODY. The alarm
    // arms survive one describe below, on a string the ALARM sees and the
    // ENFORCER deliberately spares — so "the alarm still works" is proven on a
    // case where it is the only thing that can fire, rather than by an assertion
    // that enforcement has quietly hollowed out (trap #12b).

    const RECEIPT_SENTENCE = 'Added the risk.';
    const LEADER_SENTENCE = `For context, ${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%.`;
    const LEADER_ANSWER = `${RECEIPT_SENTENCE} ${LEADER_SENTENCE}`;

    function mockEditAnswer(assistantText: string): void {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        // The gate reads this for the option ROSTER only. A `graph: null` mock
        // would silently disarm enforcement and every RED below would pass by
        // testing nothing — the exits under test all ship a real graph.
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: assistantText,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    }

    it('⭐ THE HARM, END TO END: the withheld leader claim NO LONGER SHIPS at the main edit exit', async () => {
      // ⭐ THE FLAGSHIP. This is the exact body the 28 Jul live confirmation
      // caught, at the exact exit that produced it, under the exact fixture.
      mockEditAnswer(LEADER_ANSWER);
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);

      const text = body.assistant_text as string;
      expect(
        text,
        'the withheld leader is still being NAMED on the wire — this is the live defect',
      ).not.toContain(LEADER_LABEL);
      expect(text, 'the designation phrasing still ships').not.toContain('leads at 72%');
    });

    it('⭐ SURGICAL: the receipt sentence survives BYTE-IDENTICAL, and only the claim goes', async () => {
      // ⭐ THE OTHER HALF, AND THE ONE THAT IS EASY TO LOSE. #755's first cut
      // replaced the WHOLE answer and destroyed a `run_analysis` receipt plus an
      // honest compound-edit disclosure in one string (turn-executor.ts:10017-
      // 10054). A gate that removes the claim by removing the answer has traded
      // one dishonest answer for no answer at all — the in-repo instruction at
      // `leading-option-egress-guard.ts`'s closing comment, verbatim.
      mockEditAnswer(LEADER_ANSWER);
      const { body } = await postTurn(app, MESSAGE);
      const text = body.assistant_text as string;

      expect(
        text.startsWith(RECEIPT_SENTENCE),
        'the user asked for an edit and it happened — the receipt must survive the claim-safety edit',
      ).toBe(true);
      expect(
        text,
        'the substituted copy must be the SHARED constant, never a route-level twin',
      ).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
      // Non-vacuity: the whole answer was not simply replaced by the constant.
      expect(text).not.toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);
      expect(text.length).toBeGreaterThan(WIRE_WITHHELD_LEADER_REPLACEMENT.length);
    });

    it('PERMIT-WINS: identical prose on a PERMITTED scenario ships BYTE-IDENTICAL', async () => {
      // ⭐ THE OVER-SUPPRESSION CONTROL, AND SIMULTANEOUSLY THE POSITIVE CONTROL
      // FOR THE TWO ARMS ABOVE (trap #13): it proves this drive really can carry
      // the designation to the wire, so "the designation is absent" upstairs is
      // measuring suppression rather than a fixture that never had one.
      //
      // A blanket `false` at these exits — the failure mode #737's own header
      // warns about — would turn this arm red, which is exactly its job.
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      mockEditAnswer(LEADER_ANSWER);
      const { body } = await postTurn(app, MESSAGE);
      expect(
        body.assistant_text,
        'a permitted scenario must reach the user with its prose untouched, to the byte',
      ).toBe(LEADER_ANSWER);
      expect(
        events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress),
        'a permitted scenario must not trip the alarm — identical prose, opposite verdict',
      ).toEqual([]);
      expect(
        events.filter(
          (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
        ),
        'the wire gate must not even run on a permitted turn',
      ).toEqual([]);
    });

    it('a withheld turn whose answer designates NOTHING ships BYTE-IDENTICAL', async () => {
      // The second over-suppression arm, and the one that catches a gate wired
      // to the VERDICT rather than to the CLAIM. `EDIT_RECEIPT` is the ordinary
      // edit confirmation; a withheld verdict must not cost the user their
      // receipt.
      mockEditAnswer(EDIT_RECEIPT);
      const { body } = await postTurn(app, MESSAGE);
      expect(body.assistant_text).toBe(EDIT_RECEIPT);
      expect(
        events.filter(
          (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
        ),
        'nothing was designated, so nothing may be edited — and the gate must be silent',
      ).toEqual([]);
    });

    it('the gate reports itself: one SURGICAL event, with lengths and no prose', async () => {
      mockEditAnswer(LEADER_ANSWER);
      await postTurn(app, MESSAGE);
      const emitted = events.filter(
        (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
      );
      expect(emitted.length, 'exactly one event per edited response').toBe(1);
      const data = emitted[0]!.data;
      expect(
        data['mode'],
        '`whole_field` here would mean the splitter and the reader disagree — see the mode union',
      ).toBe('surgical');
      expect(data['edited_fields']).toBe('assistant_text');
      expect(data['exit_path']).toBe('edit_graph');
      expect(typeof data['original_length']).toBe('number');
      expect(
        JSON.stringify(data),
        'the matched prose is the user\'s own decision content and must never ride telemetry',
      ).not.toContain(LEADER_LABEL);
    });

    it('IDEMPOTENT: re-running the gate over its own output changes nothing', async () => {
      // A gate whose replacement trips its own reader would eat the answer one
      // sentence at a time on any future second pass. Pinned at module load too
      // (`assertReplacementIsInertAndNonVacuous`), and driven here end to end.
      mockEditAnswer(`${RECEIPT_SENTENCE} ${WIRE_WITHHELD_LEADER_REPLACEMENT}`);
      const { body } = await postTurn(app, MESSAGE);
      expect(body.assistant_text).toBe(`${RECEIPT_SENTENCE} ${WIRE_WITHHELD_LEADER_REPLACEMENT}`);
    });
  });

  // ── THE ALARM IS NOT HOLLOWED — the residue rail still fires ──────────────

  describe('the Layer-3 ALARM after enforcement — still armed, on the bytes that ship', () => {
    const MESSAGE = 'Add a risk for coordination overhead';

    /**
     * ⭐ THE STRING THAT SEPARATES THE TWO RAILS, and it is not a contrivance —
     * it is the documented carve-out.
     *
     * `"leads to"` is CAUSAL. The ALARM reader (`textNamesLeadingOption`, wide,
     * observe-only, false positive costs one log line) SEES it. The ENFORCER
     * reader (`textAssertsLeadingOption`, narrow, false positive DELETES user
     * content) blanks the span first and does NOT. So this one turn proves three
     * things at once:
     *
     *   1. the alarm is still armed and still fires ON THE SHIPPED BYTES after
     *      enforcement runs — it has not been hollowed into a tautology by its
     *      own success (CLAUDE.md trap #12b);
     *   2. the enforcer is NARROWER than the alarm, which is the cost-function
     *      doctrine both readers are built around; and
     *   3. ordinary causal English survives a withheld turn untouched.
     */
    const CAUSAL_ANSWER = 'Added the risk. Higher capacity leads to faster delivery.';

    beforeEach(() => {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        // The gate reads this for the option ROSTER only. A `graph: null` mock
        // would silently disarm enforcement and every RED below would pass by
        // testing nothing — the exits under test all ship a real graph.
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: CAUSAL_ANSWER,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    });

    it('the alarm FIRES exactly once on a string the enforcer spares', async () => {
      const { status } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      const alarms = events.filter(
        (e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress,
      );
      expect(
        alarms.length,
        'ZERO means the alarm has been hollowed out by the enforcer running upstream of it — ' +
          'the observe rail must keep measuring the residue that still ships. More than one ' +
          'means the Layer-3 scan has been re-added to a re-entered chokepoint (E1).',
      ).toBe(1);
      expect(alarms[0]!.data['hit_count']).toBeGreaterThan(0);
    });

    it('and the enforcer leaves that same string BYTE-IDENTICAL', async () => {
      const { body } = await postTurn(app, MESSAGE);
      expect(
        body.assistant_text,
        'causal "leads to" is ordinary English; deleting it is the over-suppression the ' +
          'ENFORCEMENT_FALSE_POSITIVE_SPANS carve-out exists to prevent',
      ).toBe(CAUSAL_ANSWER);
    });
  });

  // ── THE OTHER MODEL-TEXT EXIT: chip_click `ok` ───────────────────────────

  describe('the CHIP-CLICK ok exit — the second model-text exit, and the _answer_shape pin', () => {
    const CHIP_RECEIPT = 'Analysis complete.';
    const CHIP_LEADER_SENTENCE = `${LEADER_LABEL} leads at 72% on this run.`;
    const CHIP_ANSWER = `${CHIP_RECEIPT} ${CHIP_LEADER_SENTENCE} The gap is not stable across the runs.`;

    function mockChipOk(opts: { mayName: boolean; text: string }): void {
      dispatchDeterministicChipClickMock.mockResolvedValue({
        outcome: 'ok',
        graph: READY_GRAPH,
        mayNameLeadingOption: opts.mayName,
        // SUBSTANTIVE, deliberately: it is what makes the egress answer-shape
        // synthesiser attach `_answer_shape`, which is the sidecar this
        // describe exists to pin. A `functional` chip answer never shapes.
        answerKind: 'substantive',
        response: {
          response_version: 2,
          assistant_text: opts.text,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    }

    async function postChip(app: FastifyInstance) {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: randomUUID(),
          scenario_id: SCENARIO_ID,
          stage: 'analyse',
          message: 'Run analysis',
          turn_class: 'decide',
          source: 'chip_click',
          chip: { action_type: 'run_analysis' },
          graph_state: READY_GRAPH,
        },
      });
      return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
    }

    it('BRANCH DISCRIMINATOR: this turn really reaches the deterministic chip dispatch', async () => {
      mockChipOk({ mayName: false, text: CHIP_ANSWER });
      await postChip(app);
      expect(
        dispatchDeterministicChipClickMock,
        'the chip_click ok exit is downstream of dispatchDeterministicChipClick — if it never ' +
          'ran, this case fell through to the TurnExecutor and is testing a different exit',
      ).toHaveBeenCalled();
      expect(routeWithToolUseMock).not.toHaveBeenCalled();
    });

    it('INSTRUMENT: the PERMITTED chip answer carries `_answer_shape` on the wire', async () => {
      // ⭐ THE POSITIVE CONTROL FOR THE PIN BELOW (trap #13). "the sidecar is
      // absent" proves nothing unless this drive can be shown to produce one.
      mockChipOk({ mayName: true, text: CHIP_ANSWER });
      const { body } = await postChip(app);
      expect(
        body._answer_shape,
        'if this is undefined the sidecar pin below is vacuous — the synthesiser did not run at all',
      ).toBeDefined();
      expect(body.assistant_text, 'permitted ⇒ the claim survives').toContain(LEADER_LABEL);
    });

    it('the withheld chip answer loses the designation and KEEPS the receipt', async () => {
      mockChipOk({ mayName: false, text: CHIP_ANSWER });
      const { status, body } = await postChip(app);
      expect(status).toBe(200);
      const text = body.assistant_text as string;
      expect(text).not.toContain(LEADER_LABEL);
      expect(text).not.toContain('leads at 72%');
      expect(text).toContain(CHIP_RECEIPT);
      expect(
        text,
        'the sentence AFTER the claim is not a claim and must survive too',
      ).toContain('not stable across the runs');
    });

    it('⭐ `_answer_shape` is ABSENT whenever the gate edited the answer', async () => {
      // ⭐ THE SIDECAR PIN (derivation §3(b)). `_answer_shape` RECONSTRUCTS the
      // answer verbatim — `deriveAnswerTextFromShape` rejoins headline, bullets
      // and detail. Left attached after a claim-safety edit it would ship a
      // structured copy of the very sentence just removed, and the suppression
      // would be undone by its own debug surface. Nothing pinned this coupling
      // before (zero hits for `_answer_shape` in any chokepoint suite).
      mockChipOk({ mayName: false, text: CHIP_ANSWER });
      const { body } = await postChip(app);
      expect(
        body._answer_shape,
        'the sidecar reconstructs the pre-edit prose verbatim; it must go with the edit',
      ).toBeUndefined();
      expect(
        JSON.stringify(body),
        'and no other surface may carry the removed designation either',
      ).not.toContain(LEADER_LABEL);
    });
  });

  // ── ⭐ THE WIRE-GATE CANARY — the blindness that let this slip ────────────

  describe('⭐ CANARY: honest receipts survive the WIRE gate on a withheld turn', () => {
    /**
     * ⚠ WHY THIS LIVES HERE AND NOT IN THE EXISTING CANARY SUITE, which is the
     * whole finding.
     *
     * `turn-executor-compound-edit-disclosure.test.ts` is the suite that caught
     * #755's first cut destroying an honest receipt. It drives `runTurnExecutor`
     * DIRECTLY — so it is STRUCTURALLY BLIND to anything `sendFinalised200` does.
     * The wire gate reopened the identical defect class at a new address and
     * every one of those canaries stayed green, because none of them can see the
     * route. A canary that cannot reach the new seam is not a canary for it.
     *
     * These arms drive the REAL ROUTE with the same class of copy.
     */
    const MESSAGE = 'Add a risk for coordination overhead';

    function driveEditWith(assistantText: string) {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: assistantText,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
      return postTurn(app, MESSAGE);
    }

    it("⭐ the #755 receipt — production copy, trips the vocabulary, designates NOTHING", async () => {
      // ⭐ THE EXACT SENTENCE #755's FIRST CUT DESTROYED, imported from the
      // producer so a reword cannot silently decouple this test from it.
      // "explore the leading option" trips the shared vocabulary and names no
      // option, so it must reach the user untouched.
      const receipt = COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({});
      const { status, body } = await driveEditWith(receipt);
      expect(status).toBe(200);
      expect(
        body.assistant_text,
        'the wire gate destroyed an honest receipt — this is #755 rebuilt at a new address',
      ).toBe(receipt);
    });

    it('INSTRUMENT: that receipt really does trip the deleting reader', async () => {
      // Without this, the arm above could be passing because the vocabulary
      // reader never fires — i.e. testing nothing (CLAUDE.md trap #13).
      const { textAssertsLeadingOption } = await import(
        '../compose/leading-option-egress-guard.js'
      );
      expect(textAssertsLeadingOption(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}))).toBe(true);
    });

    it.each([
      ['sales leads', 'Added the risk. Your sales leads improved this quarter.'],
      ['who leads', 'Added the risk. Who leads the coordination work?'],
      ['ahead of plan', 'Added the risk. The rollout is ahead of plan.'],
      ['causal leads-to', 'Added the risk. Higher capacity leads to faster delivery.'],
    ])('ordinary decision vocabulary survives — %s', async (_label, text) => {
      const { body } = await driveEditWith(text);
      expect(body.assistant_text).toBe(text);
    });

    it('and the gate stays SILENT on all of them', async () => {
      await driveEditWith('Added the risk. Your sales leads improved this quarter.');
      expect(
        events.filter(
          (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
        ),
        'an edit that neutralised nothing must not report a neutralisation',
      ).toEqual([]);
    });
  });

  // ── ⭐ THE DISTRIBUTED CLAIM, AT THE ROUTE ───────────────────────────────

  describe('⭐ the DISTRIBUTED claim does not ship at the main edit exit', () => {
    const MESSAGE = 'Add a risk for coordination overhead';
    // Name in one sentence, vocabulary in another. Sentence surgery alone
    // removes the vocabulary and ships the name — the leak the review reproduced.
    const DISTRIBUTED = `${LEADER_LABEL} is strong. It leads at 72%.`;

    beforeEach(() => {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: DISTRIBUTED,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    });

    it('the naming half is gone from the wire', async () => {
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(
        body.assistant_text,
        'the vocabulary was removed and the NAME shipped — the claim survives distributed',
      ).not.toContain(LEADER_LABEL);
    });

    it('and the escalation is visible on the dashboard', async () => {
      await postTurn(app, MESSAGE);
      const emitted = events.filter(
        (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
      );
      expect(emitted[0]!.data['mode']).toBe('surgical_escalated');
    });

    it('PERMIT-WINS: the permitted twin ships it BYTE-IDENTICAL', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const { body } = await postTurn(app, MESSAGE);
      expect(body.assistant_text).toBe(DISTRIBUTED);
    });

    it('⭐ SOFT-WRAPPED NAME: a newline inside the option name ENTERS and strips the claim', async () => {
      // ⭐ RED-FIRST at the ROUTE. Before the name matcher's `\s+` normalisation,
      // a name spanning a soft wrap failed the name check, the field fell to the
      // "asserts but names nobody ⇒ ship unchanged" row, and the withheld
      // designation shipped byte-identical at HTTP 200 — the exact leak this PR
      // exists to stop, defeated by the matcher rather than the criterion. Now
      // the field ENTERS and the CLAIM is removed. (A claimless short-form
      // fragment may remain — the stated ceiling, fixed by 2.198.)
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          // A wrap between the LAST two words, so the asserting unit removed by
          // surgery carries a real word of the name (not just "Hire").
          assistant_text: `${LEADER_LABEL.replace(/ (\S+)$/, '\n$1')} leads at 72%.`,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(body.assistant_text, 'the CLAIM must be gone from the wire').not.toContain('72%');
      expect(body.assistant_text).not.toContain('leads at');
      expect(body.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    });

    it('PERMIT-WINS on the wrapped name too', async () => {
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      const wrapped = `${LEADER_LABEL.replace(/ (\S+)$/, '\n$1')} leads at 72%.`;
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: wrapped,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
      const { body } = await postTurn(app, MESSAGE);
      expect(body.assistant_text).toBe(wrapped);
    });
  });

  // ── PROVENANCE VARIATION (the R3-M2 obligation) ──────────────────────────

  describe('PROVENANCE — the gate is not coupled to how the verdict was reached', () => {
    const MESSAGE = 'Add a risk for coordination overhead';
    const LEADER_ANSWER = `Added the risk. ${LEADER_LABEL} leads at 72%.`;

    /**
     * ⚠ WHY THIS DESCRIBE IS SHORTER THAN THE R3-M2 LESSON MIGHT SUGGEST, stated
     * so nobody reads the gap as an oversight.
     *
     * R3-M2 (`fix-finalize-gate.md:490,501-508`) was a WIRING mutant: #755's
     * round-3 hardcoded `analysisExistenceProven = true` inside the executor
     * guard and all 32 tests stayed green, because every route-level fixture
     * carried `scenario_fact` provenance — the one value on which the hardcode
     * is indistinguishable from the derivation. The closure was a fixture whose
     * provenance DIFFERS.
     *
     * At THIS seam the mutant has no target. The wire gate's substituted copy
     * takes NO provenance, existence or currency input — that is a design
     * decision (ROADMAP 2.149 §1: the fallback makes no currency claim, which
     * also sidesteps the F1 referent split for the whole route population), and
     * it is enforced as a SOURCE-DERIVED property by the drift guard at the
     * bottom of this file rather than inferred from these two arms. So there is
     * no input to hardcode and no copy to get wrong per provenance; what these
     * arms check is the weaker but still real claim that ENFORCEMENT ITSELF is
     * not accidentally coupled to the provenance value.
     *
     * `fail_closed_uninterpretable` is deliberately NOT driven: it is returned
     * only by `readMayNameLeadingOptionVerdictForFact` for a non-`run_analysis`
     * fact (`claim-safety-read.ts:393-397`), and the scenario selector returns
     * `run_analysis` facts only — the branch's own comment says "unreachable
     * from the scenario selector". Claiming coverage of it here would be the
     * theatre this estate hunts.
     */

    beforeEach(() => {
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        // The gate reads this for the option ROSTER only. A `graph: null` mock
        // would silently disarm enforcement and every RED below would pass by
        // testing nothing — the exits under test all ship a real graph.
        graph: READY_GRAPH,
        response: {
          response_version: 2,
          assistant_text: LEADER_ANSWER,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
    });

    it('scenario_fact — enforcement fires, and the provenance is the real one', async () => {
      const { body } = await postTurn(app, MESSAGE);
      expect(provenanceOnTheWire(body)).toBe('scenario_fact');
      expect(body.assistant_text).not.toContain(LEADER_LABEL);
    });

    it('fail_closed_truncated — a withhold with NO fact selected still enforces', async () => {
      // The degraded shape: the scenario-scoped read is down (`readOk === false`)
      // and the window is provably truncated (`countTurns` 999 > 1 turn read), so
      // `claim-safety-read.ts:517` withholds having selected nothing at all.
      // There is no fact, no verdict state and no proven existence here — and the
      // gate must still remove the designation, because its copy asserts none of
      // those things.
      scenarioReadFails = true;
      priorTurnsTotal = 999;
      factsByTurnRowId = {};
      const { status, body } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);
      expect(
        provenanceOnTheWire(body),
        'if this is not fail_closed_truncated the fixture missed its branch and the arm is vacuous',
      ).toBe('fail_closed_truncated');
      expect(permissionOnTheWire(body)).toBe(false);
      expect(body.assistant_text).not.toContain(LEADER_LABEL);
      expect(body.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    });

    it('no_analysis_exists — the honest PERMIT, and the answer ships untouched', async () => {
      // The permitted control on a DIFFERENT provenance from the one above: a
      // scenario with no analysis has nothing to withhold, and a gate that fired
      // here would suppress prose on every fresh scenario in the product.
      factsByTurnRowId = {};
      const { body } = await postTurn(app, MESSAGE);
      expect(provenanceOnTheWire(body)).toBe('no_analysis_exists');
      expect(permissionOnTheWire(body)).toBe(true);
      expect(body.assistant_text).toBe(LEADER_ANSWER);
    });
  });

  // ── OVER-SUPPRESSION CONTROLS ON THE DETERMINISTIC EXITS ─────────────────

  describe('BYTE-IDENTITY on the deterministic-copy exits', () => {
    // The fifteen exits whose copy is templated cannot carry a model's leader
    // claim, so under enforcement they are pure over-suppression controls: their
    // bytes must not move at all on a withheld turn. If the gate ever starts
    // editing them, one of these turns red and names the exit.

    it('the VAGUE-EDIT intercept copy is untouched', async () => {
      const { body } = await postTurn(app, 'Make the model better');
      expect(permissionOnTheWire(body)).toBe(false);
      expect(typeof body.assistant_text).toBe('string');
      expect((body.assistant_text as string).length).toBeGreaterThan(0);
      expect(body.assistant_text).not.toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    });

    it('the EDIT-GRAPH RECOVERY copy is untouched, to the byte', async () => {
      persistedGraph = null;
      const { body } = await postTurn(app, 'Add a risk for coordination overhead', {
        withGraphState: false,
      });
      expect(permissionOnTheWire(body)).toBe(false);
      expect(
        body.assistant_text,
        'the recovery constant is the production copy — the gate must not have rewritten it',
      ).toBe(EDIT_GRAPH_RECOVERY_TEXT);
    });

    it('a SYSTEM EVENT (fail_closed_no_turn_context) ships its own copy untouched', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'system_event',
          turn_id: randomUUID(),
          scenario_id: SCENARIO_ID,
          stage: 'analyse',
          event: { kind: 'undo' },
        },
      });
      const body = JSON.parse(res.body) as Record<string, any>;
      expect(res.statusCode).toBe(200);
      expect(provenanceOnTheWire(body)).toBe('fail_closed_no_turn_context');
      expect(
        events.filter(
          (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
        ),
        'the most fail-closed verdict in the union must still not edit deterministic copy',
      ).toEqual([]);
    });

    it('the turn_executor exit is BYTE-NEUTRAL — no double substitution', async () => {
      // ⭐ IDEMPOTENCE ACROSS THE TWO GATES. The converse exit is the ONE exit
      // downstream of `finalizeRun`, whose #755 guard already substitutes for
      // this population. The wire gate must therefore find nothing left to do:
      // two gates that both fire would append the refusal twice, and a user
      // being told the same thing twice is how a safety gate reads as a bug.
      routeWithToolUseMock.mockResolvedValue(
        converseTextOnly(`For context, ${LEADER_LABEL} leads at 72%.`),
      );
      const { status, body } = await postTurn(app, 'Where does this leave things?');
      expect(status).toBe(200);
      const text = body.assistant_text as string;
      expect(text).not.toContain(LEADER_LABEL);
      const occurrences = text.split(WIRE_WITHHELD_LEADER_REPLACEMENT).length - 1;
      expect(
        occurrences,
        'the refusal appears more than once — the executor chokepoint and the wire gate both fired',
      ).toBeLessThanOrEqual(1);
      expect(
        events.filter(
          (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
        ),
        'the executor already neutralised this answer; the wire gate must be a no-op here',
      ).toEqual([]);
    });
  });
});

/**
 * ⭐ THE DRIFT GUARD — the part that makes this a MECHANISM rather than
 * seventeen corrected literals (CLAUDE.md trap #12).
 *
 * The three behavioural arms above cover three exits. There are seventeen, and
 * a hand-listed test of each is exactly the mirror that drifts: the eighteenth
 * exit someone adds would copy the nearest neighbour's literal and no test
 * would notice. This scans the file at YOUR TIP and asserts the literal cannot
 * exist at all — so the guarantee is derived from the source, not from a list
 * a human must remember to extend.
 *
 * ⚠ IT SCANS CODE, NOT PROSE. `route-v2.ts` legitimately DISCUSSES the removed
 * literal in the comments that record why it was removed, and a scan that
 * counted those would have to be weakened until it counted nothing — the
 * vacuity trap. Comments are stripped first, and the stripper is itself
 * asserted to work.
 */
describe('T1 claim safety — no route exit may stamp a LITERAL permission', () => {
  const ROUTE_V2 = new URL('../../orchestrator/route-v2.ts', import.meta.url);

  function sourceWithoutComments(): string {
    const raw = readFileSync(ROUTE_V2, 'utf8');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it('INSTRUMENT: the comment stripper actually strips, and keeps code', () => {
    // Without this, a stripper that returned '' would make the pin below pass
    // by testing nothing — TESTING-DISCIPLINE rule 2 (an absence assertion must
    // first prove it can see a presence).
    const stripped = sourceWithoutComments();
    expect(stripped, 'the stripper must not blank the file').toContain(
      'export async function ceeOrchestratorRouteV2',
    );
    expect(
      stripped,
      'a known comment-only phrase must be GONE, or the stripper is a no-op and the pin is vacuous',
    ).not.toContain('EGRESS-DEFAULT INVERSION');
  });

  it('INSTRUMENT: the pin can SEE a literal when one exists', () => {
    // The mutation this pin exists to catch, executed against the scanner
    // itself rather than trusted. A regex that matched nothing would pass the
    // assertion below on ANY file.
    //
    // Asserted as a DELTA, not an absolute count: an absolute `toHaveLength(1)`
    // silently assumes the file currently has zero, so under a real regrowth
    // this instrument would fail too and report the scanner as broken when the
    // scanner is the only thing working. The delta isolates "can it see one
    // more?" from "how many are there?", which is the next test's job.
    const base = sourceWithoutComments();
    const count = (s: string) => (s.match(/mayNameLeadingOption:\s*(true|false)\b/g) ?? []).length;
    expect(count(`${base}\nconst x = { mayNameLeadingOption: true };`) - count(base)).toBe(1);
  });

  /**
   * ⭐ THE R3-M2 CLOSURE, IN ITS DERIVED FORM (ROADMAP 2.149).
   *
   * R3-M2 was #755's round-3 mutant: `analysisExistenceProven` hardcoded `true`
   * inside the guard, 32 tests green, because every route-level fixture carried
   * `scenario_fact` provenance — the one value on which the hardcode and the
   * derivation agree. The closure there was a provenance-varied fixture.
   *
   * The WIRE gate closes it differently and more strongly: it takes NO such
   * input at all. Its substituted copy asserts nothing about currency, nothing
   * about existence and nothing about the cause, so there is no derivation to
   * bypass and no wiring to mutate. That is a design decision (2.149 §1 — the
   * fallback makes no currency claim, which also sidesteps the F1 referent split
   * for the whole route population), and a design decision that is not enforced
   * is a comment. So it is enforced HERE, from the source.
   *
   * If a future change gives the wire copy a currency or existence claim, that
   * change must ALSO bring the provenance-varied fixtures R3-M2 demands — and
   * this test going red is what will say so.
   */
  describe('the WIRE gate takes no provenance / currency / existence input', () => {
    const WIRE_GATE = new URL(
      '../compose/leading-option-wire-enforcement.ts',
      import.meta.url,
    );

    function gateSourceWithoutComments(): string {
      const raw = readFileSync(WIRE_GATE, 'utf8');
      return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    }

    it('INSTRUMENT: the stripper strips and keeps code', () => {
      const stripped = gateSourceWithoutComments();
      expect(stripped).toContain('export function enforceLeadingOptionClaimsAtWire');
      expect(
        stripped,
        'a comment-only phrase must be GONE, or every absence below is vacuous',
      ).not.toContain('READ THIS BEFORE QUOTING THE HEADLINE');
    });

    it.each([
      'provenance',
      'analysisExistenceProven',
      'conditionsAreCurrent',
      'ConstraintVerdictState',
      'readRatifiedConstraints',
    ])('the gate does not read `%s`', (symbol) => {
      expect(
        gateSourceWithoutComments(),
        `the wire gate now consumes \`${symbol}\`. Its copy can therefore make a claim that is ` +
          'true on some populations and false on others — the exact defect ' +
          'WITHHELD_EXPLANATION_OPENING cost two review rounds. Add the provenance-varied ' +
          'fixtures (R3-M2) before landing that, and update this guard deliberately.',
      ).not.toContain(symbol);
    });

    it('POSITIVE CONTROL: the scan can SEE one of those symbols when present', () => {
      const planted = `${gateSourceWithoutComments()}\nconst x = analysisExistenceProven;`;
      expect(planted).toContain('analysisExistenceProven');
    });
  });

  it('every exit INHERITS: zero hardcoded true/false permissions remain', () => {
    const hits = sourceWithoutComments().match(/mayNameLeadingOption:\s*(true|false)\b/g) ?? [];
    expect(
      hits,
      'an exit stamped a literal permission. It must inherit the turn-entry read instead ' +
        '(`...(await claimSafety.forExit())`) — the permission belongs to the fact the ' +
        'response DISPLAYS, not to whether this turn ran an analysis.',
    ).toEqual([]);
  });
});
