/**
 * ⭐ THE PERMISSION MUST DESCRIBE THE SCENARIO, NOT THE LAST 20 TURNS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, AND WHY NO EXISTING TEST COULD SEE IT.
 *
 * `may_name_leading_option` was hoisted from `context.prior_facts`. That array
 * is NOT the scenario: `buildTurnContext` loads it by an `IN` over the turn row
 * ids `readRecent` returned, and `readRecent` is `LIMIT SESSION_READ_WINDOW_TURNS`
 * (default 20). A `run_analysis` fact whose parent turn had aged out of that
 * window was therefore never LOADED, `selectRunAnalysisFact` returned `null`,
 * and the reader took its "no analysis ⇒ nothing to withhold ⇒ true" branch —
 * on a scenario that HAS an analysis whose verdict withheld.
 *
 * The channels that permission gates are not windowed:
 *
 *   permission : readRecent(scenarioId)                  → LIMIT   20
 *   summary    : readRecent(scenarioId, 1000)            → LIMIT 1000
 *   records    : retrieveRecords(scenarioId, {limit: 8}) → SCENARIO-WIDE
 *
 * ⚠ AND THE TWO CONDITIONS ARE POSITIVELY CORRELATED, provably from the two
 * constants: the rolling summary is injected iff the window holds MORE than 8
 * turns (`rolling-summary/inject.ts`, `windowDepth = CONTEXT_PACK_RECENT_TURNS_CAP`),
 * while eviction of the analysis fact needs MORE than 20. Every turn on which
 * the permission went blind was necessarily a turn on which the richest
 * leader-bearing channel was switched on.
 *
 * ⚠ WHY THE WHOLE EXISTING SUITE WAS GREEN. Every route-level fixture in this
 * directory seeds a handful of prior turns, so the analysis fact is always
 * INSIDE the window and the defect is unreachable. The bug lives entirely in
 * the relationship between the window size and the scenario length — a
 * relationship no fixture expressed. That is why the STORE MOCK below is the
 * load-bearing part of this file: it WINDOWS like the real store
 * (`readRecent` slices to the limit) and RESOLVES FACTS BY FK like the real
 * store (`readFactsFor` filters on parent turn id). A mock that returned all
 * facts regardless would make every assertion here vacuous — TESTING-DISCIPLINE
 * rule 1, and the exact trap the sibling file's `PRIOR_RUN_ANALYSIS_TURN`
 * comment records.
 *
 * ⚠ CONFIRMED LIVE, not inferred. Read-only Supabase, scenario
 * `f63ccb45-8f90-4b93-bea2-5f03452e71da`: 31 conversation turns; its historic
 * `run_analysis` turn (unstamped — no `constraint_verdict`, no
 * `__cee_claim_safety`) ranks 25 newest-first today, and ranked 20 at 12:57:02
 * and 21 at 12:58:26. The wire flipped `false → true` across those two reads
 * with ZERO store change. The fixture below is that scenario's shape.
 *
 * ASSERTIONS ARE ON THE SERIALISED MODEL BYTES (`buildUserMessage`, the real
 * one) or on the wire body. Nothing here asserts on a value a function under
 * test returned to its own caller.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  WITHHELD_HISTORY_REDACTION_MARKER,
  historyAssertsLeaderClaim,
} from '../context/withheld-history-redaction.js';

const SCENARIO_ID = 'f63ccb45-1233-4123-8123-a1b2c3d41240';
const LEADER_LABEL = 'Hire Marketing Manager';
const RUNNER_LABEL = 'Hold';

/** The window the real store applies (`SESSION_READ_WINDOW_DEFAULT`). */
const WINDOW = 20;
/** Long enough that the analysis turn is provably outside the window. */
const TOTAL_TURNS = 25;

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
      strength: { mean: 0.1, std: 0.1 },
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
      strength: { mean: 0.9, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never);

/**
 * The leader claim sitting in CONVERSATION HISTORY — the channel this file
 * measures, chosen because it is gated by `projectConversationForWithheldClaim`
 * and it survives into the real serialiser's output, so the assertion can be on
 * MODEL BYTES rather than on a pack field.
 *
 * ⚠ It must be within the newest `CONTEXT_PACK_RECENT_TURNS_CAP` (8) turns or
 * the pack never carries it and the whole file passes vacuously. Asserted by
 * the INSTRUMENT test below rather than assumed.
 */
/**
 * ⚠ THE ASSERTIONS BELOW USE THIS FRAGMENT, NOT THE OPTION LABEL — and the
 * distinction is load-bearing. `LEADER_LABEL` also appears in the pack's
 * `graph_summary` node list, legitimately and on every turn including withheld
 * ones (the gate redacts CLAIMS about a leader, it does not erase the option
 * from the user's own graph). A `not.toContain(LEADER_LABEL)` assertion is
 * therefore false-by-construction, and the version of this file that had one
 * failed for a reason unrelated to the defect. The claim — "leads at 72%
 * against" — appears ONLY in the conversation history, so it discriminates
 * exactly what the gate is supposed to remove.
 */
const HISTORY_LEADER_CLAIM = 'leads at 72% against';

const HISTORY_LEADER_TEXT =
  `${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%. ` +
  'That is a 44 point margin, and the result is fragile and sensitive to ' +
  'sales win rate assumptions.';

/**
 * The scenario's analysis fact, in the shape that made the live flip: a
 * PRE-#710 row with no `constraint_verdict` and no
 * `enrichment.__cee_claim_safety`. There is no data migration, so this shape is
 * live in the store; `readMayNameLeadingOptionFromResult` fails CLOSED on it.
 */
function unstampedRunAnalysisFact(): Record<string, unknown> {
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

/** Same fact, but STAMPED PERMITTED — the positive control's input. */
function permittedRunAnalysisFact(): Record<string, unknown> {
  const fact = unstampedRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: true,
    constraint_verdict_state: 'evaluated_feasible',
  };
  return fact;
}

/** Same fact, STAMPED WITHHELD. */
function withheldRunAnalysisFact(): Record<string, unknown> {
  const fact = unstampedRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: false,
    constraint_verdict_state: 'unevaluated',
  };
  return fact;
}

const ANALYSIS_TURN_ROW_ID = 'aaaaaaaa-1233-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * `TOTAL_TURNS` conversation turns, NEWEST FIRST (the order the real store
 * returns). Index 0 is the newest.
 *
 * The `run_analysis` turn is the OLDEST, so it is at rank `TOTAL_TURNS` and
 * provably outside a `LIMIT 20` window. `analysisTurnAtIndex` lets the positive
 * controls slide it INSIDE without changing anything else.
 */
function buildTurns(analysisTurnAtIndex: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < TOTAL_TURNS; i += 1) {
    const isAnalysis = i === analysisTurnAtIndex;
    out.push({
      id: isAnalysis ? ANALYSIS_TURN_ROW_ID : `dddddddd-1233-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      scenario_id: SCENARIO_ID,
      user_id: null,
      turn_id: `turn-${i}`,
      turn_class: isAnalysis ? 'handler' : 'direct_answer',
      handler_id: isAnalysis ? 'run_analysis' : null,
      request_hash: `sha256:turn-${i}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 100,
      created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      user_message: `user message ${i}`,
      // The leader claim rides on turn index 1 — inside the 8-turn pack cap.
      assistant_message: i === 1 ? HISTORY_LEADER_TEXT : `assistant message ${i}`,
    });
  }
  return out;
}

// ── Mutable fixture state, set per case ────────────────────────────────────
let turnsNewestFirst: Array<Record<string, unknown>> = [];
/** The scenario's facts, keyed by their PARENT TURN ROW ID (the real FK). */
let factsByTurnRowId: Record<string, Array<Record<string, unknown>>> = {};
/** Make the scenario-scoped read throw, to exercise the degraded path. */
let scenarioFactReadFails = false;
/** Drop the method entirely, as a pre-fix store or an old mock would. */
let scenarioFactReadAbsent = false;

/**
 * ⭐ THE HONEST STORE MOCK. It must WINDOW and it must resolve facts BY FK, or
 * this file proves nothing (see the header).
 */
function makeStore(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    append: async () => ({ id: `row-${randomUUID()}` }),
    // The real `readRecent` signature: LIMIT defaults to the read window.
    readRecent: async (_id: string, limit: number = WINDOW) => turnsNewestFirst.slice(0, limit),
    // The real `countTurns`: the PRE-CAP total, which is how the fail-closed
    // guard learns the window was truncated.
    countTurns: async () => turnsNewestFirst.length,
    // The real FK semantics: facts are reachable ONLY via their parent turn id.
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
    loadGraph: async () => READY_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: READY_GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
  if (!scenarioFactReadAbsent) {
    // SCENARIO-SCOPED: newest non-noop run_analysis fact across ALL turns,
    // regardless of the window — exactly what the SQL does.
    base.readNewestAnalysisFactFor = async () => {
      if (scenarioFactReadFails) throw new Error('simulated scenario fact read failure');
      const all = Object.values(factsByTurnRowId).flat();
      const analyses = all.filter((f) => f.fact_type === 'run_analysis' && f.noop === false);
      return analyses[0] ?? null;
    };
  }
  return base;
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => makeStore(),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

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

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

/** The REAL serialiser, off the same module production calls. */
const { buildUserMessage } = await import('../routing/route-with-tool-use.js');

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

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

async function postTurn(app: FastifyInstance, message: string) {
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
      graph_state: READY_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function packHandedToTheModel(): Record<string, any> {
  expect(
    routeWithToolUseMock,
    'the router was never called — the fixture reached the wrong branch and every assertion below would be vacuous',
  ).toHaveBeenCalled();
  return routeWithToolUseMock.mock.calls[0]![0] as Record<string, any>;
}

/** The EXACT prompt bytes the model was handed. */
function modelBytes(message: string): string {
  return buildUserMessage(packHandedToTheModel() as never, message);
}

/**
 * `_diagnostic_trace` is flag-gated (`CEE_DIAGNOSTIC_TRACE_ENABLED`), and the
 * trace IS the wire surface this file measures the permission on — so the flag
 * is set for the file and restored after, rather than assumed.
 */
let priorTraceFlag: string | undefined;

describe('claim safety — the permission is SCENARIO-scoped, not window-scoped', () => {
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
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('Noted.'));
    scenarioFactReadFails = false;
    scenarioFactReadAbsent = false;
    // DEFAULT FIXTURE: 25 turns, analysis turn OLDEST ⇒ outside the 20-window.
    turnsNewestFirst = buildTurns(TOTAL_TURNS - 1);
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [unstampedRunAnalysisFact()] };
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENT CHECKS FIRST (TESTING-DISCIPLINE rule 2) ───────────────────

  it('INSTRUMENT: the fixture history really does assert a leader claim', () => {
    // Every "the bytes are redacted" assertion below is worthless if the
    // fixture prose was never redactable in the first place.
    expect(
      historyAssertsLeaderClaim(HISTORY_LEADER_TEXT),
      'the fixture history must be visible to the production history gate',
    ).toBe(true);
  });

  it('INSTRUMENT: the analysis fact really is OUTSIDE the loaded window', async () => {
    // The premise of the whole file, proven against the mock rather than
    // assumed: the windowed read cannot reach the analysis turn.
    const store = makeStore() as {
      readRecent: (id: string) => Promise<Array<Record<string, unknown>>>;
      readFactsFor: (ids: readonly string[]) => Promise<Array<Record<string, unknown>>>;
      countTurns: () => Promise<number>;
    };
    const windowTurns = await store.readRecent(SCENARIO_ID);
    expect(windowTurns).toHaveLength(WINDOW);
    expect(await store.countTurns()).toBe(TOTAL_TURNS);
    expect(windowTurns.map((t) => t.id)).not.toContain(ANALYSIS_TURN_ROW_ID);
    const windowFacts = await store.readFactsFor(windowTurns.map((t) => t.id as string));
    expect(
      windowFacts,
      'the window must contain NO run_analysis fact — that absence IS the defect',
    ).toHaveLength(0);
  });

  it('INSTRUMENT: the model bytes really do carry the history channel', async () => {
    // If the leader turn fell outside CONTEXT_PACK_RECENT_TURNS_CAP the pack
    // would never carry it and the RED test below would pass for the wrong
    // reason. Proven on a PERMITTED scenario, where nothing is redacted.
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
    await postTurn(app, 'Where does this leave things?');
    expect(modelBytes('Where does this leave things?')).toContain(HISTORY_LEADER_CLAIM);
  });

  // ── ⭐ THE DEFECT ─────────────────────────────────────────────────────────

  it('RED-FIRST: an UNSTAMPED analysis outside the window must WITHHOLD, and the history must be redacted', async () => {
    // PRE-FIX this test fails on both assertions: the permission read the
    // 20-turn window, found no analysis, and returned the "honest true" — so
    // the wire said `true` and the model received the leader claim verbatim.
    const { status, body } = await postTurn(app, 'Where does this leave things?');
    expect(status).toBe(200);

    // ⚠ THE HARM ASSERTS FIRST, THE MECHANISM SECOND — deliberately. The
    // permission flag is the cause; the bytes the model was handed are the
    // damage. Asserting the flag first would make the pre-fix RED read
    // "expected true to be false", which names a boolean and not a leak. This
    // order makes the failure name the leaked sentence.
    const bytes = modelBytes('Where does this leave things?');
    expect(
      bytes,
      'the model must not receive the leading-option CLAIM on a withheld scenario',
    ).not.toContain(HISTORY_LEADER_CLAIM);
    expect(bytes).toContain(WITHHELD_HISTORY_REDACTION_MARKER);

    expect(
      body._diagnostic_trace?.claim_safety?.may_name_leading_option,
      'a scenario whose newest analysis is unstamped must WITHHOLD, however many turns have passed since',
    ).toBe(false);
  });

  it('a STAMPED-WITHHELD analysis outside the window withholds too — the stamp has no turn-count expiry', async () => {
    // #710→#721 stamping fixed "the fact is loaded but unstamped". It did
    // NOTHING about "the fact is not loaded", so every scenario protected by a
    // stamped-withheld verdict acquired the ungated behaviour automatically
    // after 20 more turns — silently, with no store change and no deploy.
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [withheldRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(false);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('scenario_fact');
    expect(modelBytes('Where does this leave things?')).not.toContain(HISTORY_LEADER_CLAIM);
  });

  // ── POSITIVE CONTROLS — the fix must not over-suppress ────────────────────

  it('POSITIVE CONTROL: a PERMITTED analysis outside the window still permits, pack verbatim', async () => {
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(true);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('scenario_fact');
    const bytes = modelBytes('Where does this leave things?');
    expect(bytes, 'a permitted verdict must not be over-suppressed').toContain(HISTORY_LEADER_CLAIM);
    expect(bytes).not.toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('POSITIVE CONTROL: a PERMITTED analysis INSIDE the window is unchanged', async () => {
    turnsNewestFirst = buildTurns(2);
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(true);
    expect(modelBytes('Where does this leave things?')).toContain(HISTORY_LEADER_CLAIM);
  });

  it('POSITIVE CONTROL: NO analysis fact at all ⇒ the HONEST true, provenance no_analysis_exists', async () => {
    // ⚠ THIS MUST NOT BECOME FALSE. A scenario that never ran an analysis has
    // no leading option and therefore nothing to withhold; withholding here
    // would convert the fail-closed default's cost from CONTENT into
    // CORRECTNESS. The long conversation is deliberate — 25 turns, so the
    // window IS truncated and only the working scenario read distinguishes
    // this case from the RED one above.
    factsByTurnRowId = {};
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(true);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('no_analysis_exists');
    expect(modelBytes('Where does this leave things?')).toContain(HISTORY_LEADER_CLAIM);
  });

  it('POSITIVE CONTROL: an in-window WITHHELD fact behaves exactly as before', async () => {
    turnsNewestFirst = buildTurns(2);
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [withheldRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(false);
    expect(modelBytes('Where does this leave things?')).not.toContain(HISTORY_LEADER_CLAIM);
  });

  // ── BELT AND BRACES — a FALLBACK, and provably not the mechanism ──────────

  it('BELT AND BRACES: when the scenario read FAILS on a truncated window, the turn fails CLOSED', async () => {
    // The degraded path. `prior_turns_total (25) > prior_turns.length (20)`
    // proves the window is truncated, so "no analysis in the array" is an
    // UNPROVEN premise and the honest answer is to withhold.
    scenarioFactReadFails = true;
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [unstampedRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(false);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('fail_closed_truncated');
  });

  it('BELT AND BRACES: it is the FALLBACK, not the mechanism — a working read never reaches it', async () => {
    // ⚠ THE DISCRIMINATOR. Identical fixture to the test above except that the
    // scenario read WORKS. If the guard were doing the work, the provenance
    // would still read `fail_closed_truncated`. It reads `scenario_fact`, so
    // the primary read is what produced the verdict and the guard is
    // unreachable whenever it succeeds.
    scenarioFactReadFails = false;
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [unstampedRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(false);
    expect(
      body._diagnostic_trace?.claim_safety?.verdict_provenance,
      'a WORKING scenario read must produce scenario_fact — if this says fail_closed_truncated, the guard is masking a broken primary read',
    ).toBe('scenario_fact');
  });

  it('BELT AND BRACES: a failed read on an UNtruncated window does NOT fail closed', async () => {
    // Scope pin, both directions. The guard's whole justification is that
    // truncation was PROVEN; a short conversation proves the opposite, so a
    // degraded read there must degrade to today's honest `true`, not withhold.
    turnsNewestFirst = buildTurns(2).slice(0, 5);
    factsByTurnRowId = {};
    scenarioFactReadFails = true;
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(true);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('no_analysis_exists');
  });

  it('a store WITHOUT the scenario read is treated as degraded, never as assume-good', async () => {
    // Absence of evidence is not evidence of absence. An old mock (or a store
    // that predates the method) must not be able to buy back the pre-fix
    // behaviour by simply not implementing the read.
    scenarioFactReadAbsent = true;
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [unstampedRunAnalysisFact()] };
    const { body } = await postTurn(app, 'Where does this leave things?');
    expect(body._diagnostic_trace?.claim_safety?.may_name_leading_option).toBe(false);
    expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe('fail_closed_truncated');
  });
});
