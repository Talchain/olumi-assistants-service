import { __setUseAppendV6ForTest } from '../append-v6-flag.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
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
      scenario_id: SCENARIO_ID,
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
/**
 * What `loadGraph` returns.
 *
 * ⚠ AMENDED BY ROADMAP 2.388. This used to be set to `null` to drive the
 * edit-graph RECOVERY exit, because `no_persisted_graph` returned the typed
 * recovery. It no longer does: absence is an empty canvas, not a failure, and
 * that branch now falls through to the frame-no-brief guard. A `null` here
 * would silently re-point the recovery arms at the CONVERSE exit — they would
 * have kept passing while measuring a different exit, which is exactly what
 * the BRANCH DISCRIMINATOR in that describe block exists to catch (and did).
 *
 * The recovery exit is now driven by `UNPARSEABLE_GRAPH`
 * (`persisted_graph_invalid`), one of the two reasons that legitimately keep
 * the "try again in a moment" copy.
 */
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
        (factsByTurnRowId[id] ?? []).map((fact, index) => ({
          fact,
          turn_id: id,
          fact_row_id: `${id}-analysis-fact-${index}`,
          fact_created_at: '2026-08-27T10:00:00.000Z',
        })),
      ),
    // Retired carrier canary: one-source convergence must not call this.
    readNewestAnalysisFactFor: async () => {
      throw new Error('retired newest-analysis query was called');
    },
    // ONE exact-count scenario snapshot supplies both claim-safety and
    // reasoning consumers. The payload object and persisted identity match the
    // hot-window view when that parent turn is loaded.
    readScenarioRunAnalysisFactsFor: async (
      _scenarioId: string,
      limit: number,
    ) => {
      if (allReadsFail || scenarioReadFails) throw new Error("degraded");
      const facts = Object.entries(factsByTurnRowId).flatMap(
        ([turnRowId, candidates]) =>
          candidates
            .filter(
              (fact) =>
                fact.fact_type === 'run_analysis' && fact.noop === false,
            )
            .map((fact, index) => ({
              fact,
              fact_row_id: `${turnRowId}-analysis-fact-${index}`,
              fact_created_at: '2026-08-27T10:00:00.000Z',
            })),
      );
      return { facts: facts.slice(0, limit), total_count: facts.length };
    },
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ revision: 7, graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => withScenarioRevision(makeStore()),
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
const { ceeOrchestratorRouteV2 } = await import(
  '../../orchestrator/route-v2.js'
);
const { synthesiseAnswerShapeFromText } = await import('../routing/answer-shape.js');

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

function unavailableEvents(): Array<{ name: string; data: Record<string, any> }> {
  return events.filter(
    (event) => event.name === TelemetryEvents.V5ClaimSafetyFailClosedUnavailable,
  );
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
  });

  describe('the CHIP-SIMPLIFY intercept exit', () => {
    const MESSAGE = SIMPLIFY_CHANGE_CHIP_PROMPT;

    it('BRANCH DISCRIMINATOR: this turn really reaches the intercept', async () => {
      await postTurn(app, MESSAGE);
      expect(routeWithToolUseMock).not.toHaveBeenCalled();
    });
  });

  describe('FAIL-CLOSED — the two situations where nothing can be read', () => {

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

  // ── THE OTHER MODEL-TEXT EXIT: chip_click `ok` ───────────────────────────

  describe('the CHIP-CLICK ok exit — the second model-text exit, and the _answer_shape pin', () => {
    const CHIP_RECEIPT = 'Analysis complete.';
    const CHIP_LEADER_SENTENCE = `${LEADER_LABEL} leads at 72% on this run.`;
    /**
     * ⚠ LONG ON PURPOSE (THE COLLAPSE FLOOR, 18 Sep 2026), AND THE REASON IS
     * THIS DESCRIBE'S OWN INSTRUMENT.
     *
     * `_answer_shape` is a WIRE DIRECTIVE to collapse the answer, and CEE now
     * issues it only above `ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS` (3,000 — the
     * deployed UI's own `CLAMP_CHAR_THRESHOLD`). The pin below asserts the
     * sidecar is ABSENT whenever the claim-safety gate edited the answer, and
     * the INSTRUMENT case above it exists to prove that absence is not vacuous.
     *
     * At the original length BOTH would have read "absent" for the floor's
     * reason rather than the gate's — the positive control would have gone
     * quietly dead and the pin with it (trap 13). Padding past the floor keeps
     * the two causes separable: permitted ⇒ long ⇒ sidecar present; edited ⇒
     * still long ⇒ sidecar absent, and absent BECAUSE THE GATE DROPPED IT.
     *
     * The pad is additive prose on one line; every content assertion in this
     * describe is `toContain` and is unaffected.
     */
    const CHIP_FLOOR_PAD = ` ${'Every figure here is read straight from the run you just completed. '.repeat(46).trim()}`;
    const CHIP_ANSWER = `${CHIP_RECEIPT} ${CHIP_LEADER_SENTENCE} The gap is not stable across the runs.${CHIP_FLOOR_PAD}`;

    function mockChipOk(opts: { mayName: boolean; text: string; analysisReady?: unknown }): void {
      dispatchDeterministicChipClickMock.mockResolvedValue({
        outcome: 'ok',
        graph: READY_GRAPH,
        mayNameLeadingOption: opts.mayName,
        analysisReady: opts.analysisReady,
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

    it.each([false, true])(
      'native C2 prose: admission licensed=%s keeps answer-shape coherence at the real wire seam',
      async (licensed) => {
        const capture = JSON.parse(
          readFileSync(
            new URL(
              './../compose/__tests__/fixtures/c2-context-response-20260907T203538Z.json',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        if (licensed)
          capture.analysis_ready.analysis_admission.permitted_analysis_mode = 'comparative_leader';
        mockChipOk({
          mayName: true,
          text: capture.assistant_text,
          analysisReady: capture.analysis_ready,
        });
        const { status, body } = await postChip(app);
        expect(status).toBe(200);
        expect(dispatchDeterministicChipClickMock).toHaveBeenCalled();
        expect(routeWithToolUseMock).not.toHaveBeenCalled();
        expect(body.assistant_text).toContain(
          "Your model doesn't yet capture technical debt or a launch deadline",
        );
        // ⚠ THE CAPTURE IS NOT PADDED, AND THAT IS DELIBERATE. This fixture is
        // a REAL RESPONSE recorded on 2026-09-07 — evidence, not a fixture to
        // keep current (CLAUDE.md trap 14b). It is ~1,200 characters, i.e.
        // below the collapse floor, so NEITHER arm ships `_answer_shape` any
        // more and the presence/absence pair can no longer discriminate.
        //
        // The coherence claim is preserved by asserting it on the shape that
        // WOULD have shipped, built with the same function the egress uses:
        // licensed ⇒ the designation survives into it; withheld ⇒ it does not
        // appear on ANY surface, the sidecar included. That is the property
        // this case was written to protect, and it is now checked at a length
        // where the sidecar is legitimately withheld.
        const wouldShip = synthesiseAnswerShapeFromText(body.assistant_text as string);
        expect(body).not.toHaveProperty('_answer_shape');
        expect(
          wouldShip,
          'the captured answer must be shapeable, or the assertions below are vacuous',
        ).not.toBeNull();
        if (licensed) {
          expect(body.assistant_text).toContain("The lead's current advantage");
          expect(JSON.stringify(wouldShip)).toContain("The lead's current advantage");
        } else {
          expect(body.assistant_text).not.toContain("The lead's current advantage");
          expect(body.assistant_text).not.toContain('The analysis shows which option leads');
          expect(body.assistant_text).not.toContain("the leading option's edge");
          expect(JSON.stringify(wouldShip)).not.toContain("The lead's current advantage");
        }
      },
    );
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

    it('INSTRUMENT: that receipt really does trip the deleting reader', async () => {
      // Without this, the arm above could be passing because the vocabulary
      // reader never fires — i.e. testing nothing (CLAUDE.md trap #13).
      const { textAssertsLeadingOption } = await import(
        '../compose/leading-option-egress-guard.js'
      );
      expect(textAssertsLeadingOption(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}))).toBe(true);
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

  // ── OVER-SUPPRESSION CONTROLS ON THE DETERMINISTIC EXITS ─────────────────

  describe('BYTE-IDENTITY on the deterministic-copy exits', () => {

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
      expect(unavailableEvents()).toEqual([]);
      expect(
        events.filter((e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire),
        'the most fail-closed verdict in the union must still not edit deterministic copy',
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

afterEach(() => __setUseAppendV6ForTest(true));
