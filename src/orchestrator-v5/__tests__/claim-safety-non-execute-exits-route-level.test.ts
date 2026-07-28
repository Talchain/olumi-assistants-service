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

function makeStore(): Record<string, unknown> {
  return {
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit: number = 20) => {
      if (turnReadFails) throw new Error('simulated session store failure');
      return [ANALYSIS_TURN].slice(0, limit);
    },
    countTurns: async () => { if (allReadsFail) throw new Error("degraded"); return 1; },
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
      if (allReadsFail) throw new Error("degraded");
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
        graph: null,
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

    it('the Layer-3 alarm is ARMED by the inherited verdict, and FIRES on leader prose', async () => {
      // ⭐ THE HARM, END TO END. The permission is not an end in itself: it is
      // what the alarm is armed with. `guardLeadingOptionClaimsAtEgress` opens
      // with `if (opts.mayNameLeadingOption) return response` — so the
      // hardcoded `true` did not merely fail to help, it was an explicit
      // instruction not to scan. This drives an edit response that DOES name
      // the withheld leader and proves the alarm now sees it.
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: null,
        response: {
          response_version: 2,
          assistant_text:
            `Added the risk. For context, ${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%.`,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
      const { status } = await postTurn(app, MESSAGE);
      expect(status).toBe(200);

      const alarms = events.filter(
        (e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress,
      );
      expect(
        alarms.length,
        'ZERO means the alarm was never armed — the pre-fix state, where an edit turn could ' +
          'name a withheld leader and produce no telemetry at all. More than one means the ' +
          'Layer-3 scan has been re-added to a re-entered chokepoint.',
      ).toBe(1);
      expect(alarms[0]!.data['hit_count']).toBeGreaterThan(0);
    });

    it('POSITIVE CONTROL: the alarm stays SILENT when the scenario PERMITS', async () => {
      // The over-suppression twin of the arm above. If the fix had blanket-
      // falsed the exits, this would fire and the product would be reporting
      // invariant violations on legitimate prose.
      factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
      dispatchEditGraphMock.mockResolvedValue({
        commitPerformed: true,
        graph: null,
        response: {
          response_version: 2,
          assistant_text:
            `Added the risk. For context, ${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%.`,
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
      });
      await postTurn(app, MESSAGE);
      expect(
        events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress),
        'a permitted scenario must not trip the alarm — identical prose, opposite verdict',
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
