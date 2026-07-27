/**
 * G-CEE-1 — THE HOIST (ROADMAP 1.233) and THE INPUT GATE (ROADMAP 1.231),
 * at the real boundary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE LIVE EVIDENCE SAID, AND THEREFORE WHAT THIS FILE HAS TO PROVE.
 *
 * The POST-#713 walk (staging `5bdc0d8`,
 * `acceptance-evidence/g-cee-1-constraint-verdict/WALK-2026-07-27-POST-713.md`)
 * established two things #713 did not close:
 *
 *   §4 — five serial reruns on ONE unevaluated scenario produced four no-op
 *        bodies. ONE reached #713's gate (byte-proven REPLACE). THREE did not,
 *        and put "MacBook Pro leads at 56% against Dell XPS at 26%" in
 *        `assistant_text` with ZERO disclosure. Same scenario, same graph_hash,
 *        same click.
 *   §7 — 3/3 non-execute turns (clarify / review / propose) named the leading
 *        option on the same withheld scenario; `case5.clarify` did it with a
 *        probability and no disclosure at all.
 *
 * And it recorded WHY its own instruments could not settle §7: on non-execute
 * turns "the egress alarm is a licensed no-op … so alarm logs prove nothing
 * here", because `mayNameLeadingOptionForRun` was assigned only post-handler
 * and every other exit shipped the `= true` default.
 *
 * ⚠ THE TWO CLAIMS THIS FILE MAKES ARE DIFFERENT IN KIND. Stating that
 * plainly, because collapsing them is how a partial fix reads as a whole one:
 *
 *   1. THE HOIST is a claim about a MECHANISM, and it is fully provable here:
 *      the alarm now RECEIVES `false` on a non-execute exit, so it FIRES. The
 *      assertion is the telemetry event, i.e. the mechanism executing — not a
 *      restatement of the code.
 *   2. THE INPUT GATE is a claim about what the MODEL WAS GIVEN. In this file
 *      the model is a mock, so it cannot be a claim about what the model then
 *      wrote. The assertion is therefore on the ContextPack the router
 *      received — which is the whole content of "gate the input, not the
 *      output" — and NOT on the prose coming back.
 *
 * ⚠ SO THIS FILE CANNOT PROVE the coach/converse OUTPUT is leader-free on a
 * withheld turn. Nothing in-repo can: that is a property of a real model given
 * a gated pack. It is delegated, explicitly, to the next live walk — read the
 * BODIES on case-5-style turns, and now also read
 * `_diagnostic_trace.claim_safety`, which this train adds precisely so the walk
 * no longer has to infer the mechanism from prose. TESTING-DISCIPLINE rule 6: a
 * stated limit is a to-do, not a hedge.
 *
 * ASSERTIONS ARE ON THE SERIALISED HTTP BYTES, or on the ARGUMENT the next
 * consumer actually received (rule 3). Nothing here asserts on a value a
 * function under test returned to its own caller.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  WITHHELD_LEADER_INPUT_NOTE,
  WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE,
} from '../context/withheld-leader-projection.js';
// The production alarm's OWN scanner, so this acceptance test and the alarm
// cannot drift apart.
import {
  findLeaderClaims,
  textNamesLeadingOption,
} from '../compose/leading-option-egress-guard.js';
// The substituted copy the wire gate (#721) ships, reused here so the pack-input
// arm and the wire arm cannot assert different constants for one doctrine.
import { WITHHELD_ANALYSIS_SUMMARY } from '../compose/withheld-claim-projection.js';
// The conversation-history gate's own reader and marker, taken off the
// production module so this acceptance arm and the gate cannot drift apart.
import {
  WITHHELD_HISTORY_REDACTION_MARKER,
  historyAssertsLeaderClaim,
} from '../context/withheld-history-redaction.js';

const SCENARIO_ID = 'a1b2c3d4-1233-4123-8123-a1b2c3d41233';
const LEADER_LABEL = 'Hire Marketing Manager';
const RUNNER_LABEL = 'Hold';

const RATIFIED_CONSTRAINT = {
  constraint_id: 'constraint_out_total_cost_max',
  node_id: 'out_total_cost',
  operator: '<=',
  threshold: 2500,
  label: 'Three-Year Total Cost of Ownership',
};

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    // A factor NO option intervenes on. Load-bearing: `fac_capacity` is
    // option-controlled, so the Spine A lever suppression strips it from the
    // pack's `top_drivers` — with only that factor the advice gate declines
    // for `missing_inputs: ['top_driver']` and BOTH arms below would measure a
    // decline that has nothing to do with the constraint verdict. Caught by the
    // positive control going red, which is what positive controls are for.
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
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_growth',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_market',
      to: 'goal_growth',
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_growth',
  goal_constraints: [RATIFIED_CONSTRAINT],
};

/** Derived with the production function, so `fresh` is derived not asserted. */
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

/**
 * The persisted analysis. The two arms flip EXACTLY ONE member
 * (`may_name_leading_option`) and nothing else, so every behavioural difference
 * between them is attributable to the verdict and to nothing in the fixture.
 */
function priorRunAnalysisFact(mayName: boolean): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      constraint_verdict: {
        may_name_leading_option: mayName,
        constraint_verdict_state: mayName ? 'evaluated_feasible' : 'unevaluated',
      },
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          {
            option_id: 'opt_hire',
            option_label: LEADER_LABEL,
            win_probability: 0.72,
            outcome_mean: 0.5,
          },
          {
            option_id: 'opt_hold',
            option_label: RUNNER_LABEL,
            win_probability: 0.28,
            outcome_mean: 0.3,
          },
        ],
        factor_sensitivity: [
          {
            factor_id: 'fac_market',
            factor_label: 'Market demand',
            sensitivity: 0.6,
            influence_score: 0.6,
            direction: 'positive',
          },
          {
            factor_id: 'fac_capacity',
            factor_label: 'Capacity',
            sensitivity: 0.5,
            influence_score: 0.5,
            direction: 'positive',
          },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/**
 * The SAME fact as a PRE-#710 row: no `constraint_verdict`, no
 * `enrichment.__cee_claim_safety`. There is no data migration (A1 ruling), so
 * this shape is live in the store and it is the largest class the fail-closed
 * default fires on — and the one class no acceptance walk has ever induced,
 * because every walk runs a fresh analysis and gets a stamped fact.
 *
 * Built by SUBTRACTION from the withheld fixture so the two differ in exactly
 * one field: the fail-closed default is what makes this turn withheld, and the
 * absent state is what the note has to cope with.
 */
function priorUnstampedRunAnalysisFact(): Record<string, unknown> {
  const fact = priorRunAnalysisFact(false);
  const result = fact.result as Record<string, unknown>;
  delete result.constraint_verdict;
  return fact;
}

/**
 * The FK-parent turn row. Seeding the fact alone yields an EMPTY `prior_facts`
 * (`buildTurnContext` loads by FK from the turn ids), the verdict reads as "no
 * analysis" ⇒ `true`, and EVERY assertion below passes vacuously on the wrong
 * branch. This is TESTING-DISCIPLINE rule 1's founding instance; the positive
 * controls are what catch it if it recurs.
 */
const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'bbbbbbbb-1233-4bbb-8bbb-bbbbbbbbbbbb',
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
};

let priorTurns: Array<Record<string, unknown>> = [];
let priorFacts: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    loadGraph: async () => READY_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: READY_GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * The P6 decision-records READ (`older_relevant_facts`). Default EMPTY, so the
 * pack key is absent and every pre-existing case in this file is byte-identical
 * to before this mock existed; the arms below set it per-case.
 *
 * `importOriginal`-spread rather than a hand-listed factory (CLAUDE.md trap
 * #12): a `vi.mock` factory REPLACES the module, so listing only the one export
 * this file stubs would silently blank `resetDecisionRecordStoreForTests` and
 * every future export.
 */
let decisionRecordPage: {
  records: ReadonlyArray<Record<string, unknown>>;
  totalCount: number;
} = { records: [], totalCount: 0 };

vi.mock('../decision-records/index.js', async () => {
  const actual = await vi.importActual<typeof import('../decision-records/index.js')>(
    '../decision-records/index.js',
  );
  return {
    ...actual,
    getDecisionRecordStore: () => ({
      createRecord: async () => ({ record_id: 'unused-in-this-file', deduped: false }),
      retrieveRecords: async () => decisionRecordPage,
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

/**
 * The REAL prompt serialiser, taken off the same module the production path
 * calls (the mock above spreads `actual`, so this is not a second copy).
 *
 * ⚠ LOAD-BEARING, AND THE REASON THIS FILE'S OTHER ARMS ARE NOT ENOUGH.
 * `buildUserMessage` destructures the raw `analysis` OUT of the pack and
 * re-keys `display_analysis` under that name before serialising, so a pack
 * field and a model-facing field are NOT the same claim. A previous lane had a
 * gating locus refuted on exactly that distinction. Every assertion in the
 * decision-records arm below is therefore made on THIS function's output — the
 * bytes the model receives — not on the pack object.
 */
const { buildUserMessage } = await import('../routing/route-with-tool-use.js');

/**
 * A live §7 leak, transcribed from `case5.review` with the option labels
 * remapped onto this file's graph. A CONVERSE (`text_only`) turn — the
 * non-execute shape §7 caught and that #713's register listed as
 * `coachGuarded` / `converseGuarded`.
 *
 * ⚠ WHY `case5.review` AND NOT `case5.clarify`, which is the sharper leak.
 * Because the production alarm CANNOT SEE `case5.clarify`. Its phrasing
 * ("favours …", "sits ahead of …") matches nothing in
 * `LEADER_CLAIM_PATTERNS` — measured, not assumed, and pinned in the
 * vocabulary register below. Building the alarm-honesty assertion on prose the
 * alarm is blind to would have produced a test that fails for a reason
 * unrelated to the hoist, and — far worse — a green one later would have
 * "proved" the hoist using an alarm that never fired.
 *
 * It is therefore load-bearing that THIS string trips the scanner, and that
 * premise is asserted rather than assumed (TESTING-DISCIPLINE rule 2: an
 * absence assertion must first prove it can see a presence).
 */
const CONVERSE_LEADER_TEXT =
  `Looking at where things stand, ${LEADER_LABEL} leads at 72% against ` +
  `${RUNNER_LABEL} at 28%. That is a 44 point margin. ` +
  'Market demand is the driver doing most of the work here.';

/**
 * WHAT THE PRODUCTION ALARM CAN AND CANNOT SEE, pinned against the live
 * corpus — because my own alarm assertion depends on it, and because
 * discovering the gap and not recording it is how the next lane rediscovers it.
 *
 * Every entry is a leader claim transcribed from a body the POST-#713 walk
 * captured on staging `5bdc0d8`, labels remapped onto this file's graph.
 *
 * ⚠ THE `blind` ENTRIES ARE AN OPEN GAP, NOT A BLESSING. Two of the five live
 * leaking sentences are invisible to `LEADER_CLAIM_PATTERNS`, so on those turns
 * the alarm is armed with the right permission (this train's fix) and STILL
 * reports nothing. The walk found the same hole in its own matcher and said the
 * two shared it: "the live leaking sentence matched NONE of the egress guard's
 * patterns — the bodies tripped it only incidentally."
 *
 * Deliberately NOT fixed here. Widening the shared pattern set also widens
 * `textAssertsLeadingOption`, which is what #713's projection gate uses to
 * choose REPLACE over APPEND — so it changes that PR's mechanism and needs that
 * PR's over-suppression controls. It belongs with ROADMAP 1.227, which owns the
 * guard. What this register buys is that the gap FAILS LOUD in both directions:
 * closing it (an entry moves to `seen`) and regressing it (an entry leaves
 * `seen`) both turn this test red and force a deliberate edit here.
 */
const LIVE_LEAK_CORPUS: ReadonlyArray<{
  readonly body: string;
  readonly text: string;
  readonly alarm: 'seen' | 'blind';
}> = [
  {
    body: 'case5.review',
    text: `${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%.`,
    alarm: 'seen',
  },
  {
    body: 'case5.propose',
    text: `${LEADER_LABEL} comes out ahead, leading in 72% of simulations.`,
    alarm: 'seen',
  },
  {
    body: 'case1c (the §4 no-op)',
    text: `${LEADER_LABEL} leads at 72% against ${RUNNER_LABEL} at 28%. That is a 44 point margin.`,
    alarm: 'seen',
  },
  {
    // "favours" / "sits ahead of" — neither is in CORE or BAND.
    body: 'case5.clarify',
    text: `the analysis currently favours ${LEADER_LABEL}, with a probability of 72%. It sits ahead of ${RUNNER_LABEL} by 44 percentage points.`,
    alarm: 'blind',
  },
  {
    // The PARTICIPLE. The pattern is `\bleads\b`, which "leading" does not match.
    body: 'caseINFf (the §6.1 pre-run advisory)',
    text: `your model currently shows ${LEADER_LABEL} leading, but it does not clear the hard constraint you set.`,
    alarm: 'blind',
  },
];

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

async function postTurn(
  app: FastifyInstance,
  message: string,
  turnClass: 'clarify' | 'frame' = 'clarify',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: turnClass,
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

/** The ContextPack the router actually received — the input gate's consumer. */
function packHandedToTheModel(): Record<string, any> {
  expect(
    routeWithToolUseMock,
    'the router was never called, so there is no pack to inspect — the fixture reached the wrong branch',
  ).toHaveBeenCalled();
  return routeWithToolUseMock.mock.calls[0]![0] as Record<string, any>;
}

/** The analysis section AS THE MODEL SEES IT (buildUserMessage re-keys this). */
function modelFacingAnalysis(): Record<string, any> | null {
  return packHandedToTheModel().display_analysis ?? null;
}

/**
 * The EXACT prompt bytes the model was handed for this turn — the pack the
 * router received, run through the real serialiser.
 */
function modelBytes(message: string): string {
  return buildUserMessage(packHandedToTheModel() as never, message);
}

/** The `older_relevant_facts` section as it sits on the pack, or `undefined`. */
function olderRelevantFactsSection(): string | undefined {
  return packHandedToTheModel().older_relevant_facts as string | undefined;
}

let events: Array<{ name: string; data: Record<string, any> }> = [];

describe('G-CEE-1 — claim safety on NON-EXECUTE exits (ROADMAP 1.233 + 1.231)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data });
    });
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly(CONVERSE_LEADER_TEXT));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENT CHECK, FIRST (TESTING-DISCIPLINE rule 2) ────────────────────
  it('INSTRUMENT: the fixture prose really is residue the production scanner SEES', () => {
    // Every alarm assertion below is worthless if the alarm has nothing to
    // find. The archived leak that motivated #713 matched NOTHING in the
    // guard's vocabulary — "the bodies tripped it only incidentally" — so this
    // premise is checked against the guard's own scanner rather than assumed.
    const hits = findLeaderClaims({ assistant_text: CONVERSE_LEADER_TEXT } as never);
    expect(hits.length, 'fixture prose must be visible to the production alarm').toBeGreaterThan(0);
  });

  it('REGISTER: what the production alarm can and cannot see on the LIVE corpus', () => {
    // See LIVE_LEAK_CORPUS for why this is a fail-loud register and not a
    // blessing. Both directions are pinned: a `blind` entry that starts being
    // seen (someone extended the vocabulary — good) and a `seen` entry that
    // stops being seen (a regression — bad) each turn this red.
    const observed = LIVE_LEAK_CORPUS.map((c) => ({
      body: c.body,
      alarm: findLeaderClaims({ assistant_text: c.text } as never).length > 0
        ? ('seen' as const)
        : ('blind' as const),
    }));
    expect(observed).toEqual(LIVE_LEAK_CORPUS.map((c) => ({ body: c.body, alarm: c.alarm })));

    // Non-vacuity: the register must contain BOTH verdicts, or it is not
    // discriminating and would pass with a scanner that always returns the
    // same answer (rule 2 — a control that returns the test case's value means
    // the instrument is blind).
    const kinds = new Set(observed.map((o) => o.alarm));
    expect(kinds).toEqual(new Set(['seen', 'blind']));
  });

  describe('WITHHELD (unevaluated) — the §7 shape', () => {
    beforeEach(() => {
      priorFacts = [priorRunAnalysisFact(false)];
    });

    // ── 1.233, THE HOIST — the mechanism, not the claim ────────────────────
    it('the Layer-3 alarm RECEIVES false on a converse exit, and therefore FIRES', async () => {
      const { status } = await postTurn(app, 'So where does this leave things?');
      expect(status).toBe(200);

      // THE PIN. `guardLeadingOptionClaimsAtEgress` returns its input
      // unchanged and emits NOTHING whenever the permission is `true`
      // (`if (opts.mayNameLeadingOption) return response;`). Before the hoist
      // this exit shipped the hardcoded `true`, so this event count was ZERO
      // on exactly this fixture — which is what "a coach-turn leak produces
      // ZERO telemetry" meant, and why the walk could not use the alarm log
      // on non-execute turns at all.
      //
      // The event firing is proof the alarm was ARMED WITH THE REAL VERDICT.
      // It is deliberately NOT proof the prose was scrubbed: the guard is
      // observe-only by design (ROADMAP 1.227 owns the enforce flip).
      const alarms = events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress);
      // ⭐ EXACTLY ONE — tightened from `toBeGreaterThan(0)` by ROADMAP 1.272
      // E1, and the tightening IS the multiplicity proof.
      //
      // The guard used to run inside `sanitiseOlumiResponseForEgress`, which
      // `sendFinalised200` re-enters 2–8 times per response (one validate pass,
      // one of {validated, fallback}, and up to six CONDITIONAL debug re-attach
      // passes). The alarm fired on EVERY pass that found hits, so `hit_count`
      // on the dashboard carried a multiplier that varied with which debug
      // surfaces the environment had enabled — the guard's own comment told
      // readers to divide by 4, and 4 was never the number.
      //
      // A loose `> 0` cannot see that regression, which is why it is being
      // replaced rather than kept alongside: an assertion that passes for 1 and
      // for 8 is not measuring the property this PR changed.
      expect(
        alarms.length,
        'the withheld converse exit must arm the egress alarm with the REAL permission, and ' +
          'exactly ONCE. More than one means the Layer-3 scan has been re-added to a re-entered ' +
          'chokepoint (it belongs on the final `wireBody` in `sendFinalised200`, immediately ' +
          'before `reply.send`); zero means the alarm is not armed at all.',
      ).toBe(1);
      expect(alarms[0]!.data['hit_count']).toBeGreaterThan(0);
    });

    // ── 1.231, THE INPUT GATE — what the model was GIVEN ───────────────────
    it('the model-facing analysis carries NO leader: the explicit slots are gone', () => {
      // Synchronous read of the pack captured by the awaited turn above is not
      // possible across `it`s, so each assertion drives its own turn.
      return postTurn(app, 'So where does this leave things?').then(() => {
        const analysis = modelFacingAnalysis();
        expect(analysis, 'the pack must still carry an analysis section').not.toBeNull();
        expect(analysis!['leading_option']).toBeUndefined();
        expect(analysis!['runner_up']).toBeUndefined();
        expect(analysis!['margin']).toBeUndefined();
      });
    });

    it('the model-facing analysis carries NO leader: the RANKED OPTIONS TABLE is gone', async () => {
      // The load-bearing half. `options` is sorted by win probability and
      // carries the probabilities, so `options[0]` IS the leader and the live
      // leaking sentence ("X leads at 56% against Y at 26%") is reconstructible
      // from this field alone. A gate that dropped the two named slots and left
      // this table would read as a gate and stop nothing.
      await postTurn(app, 'So where does this leave things?');
      const analysis = modelFacingAnalysis()!;
      expect(analysis['options']).toBeUndefined();

      // Belt and braces on the SERIALISED pack: neither option label may
      // appear anywhere in the model-facing analysis section, and neither win
      // probability may either. This catches a future field that reintroduces
      // the ranking under a new name — the drift a member list cannot see.
      const serialised = JSON.stringify(analysis);
      expect(serialised).not.toContain(LEADER_LABEL);
      expect(serialised).not.toContain(RUNNER_LABEL);
      expect(serialised).not.toContain('72%');
      expect(serialised).not.toContain('28%');
    });

    it('the absence is NEVER SILENT — the pack says why the ranking is missing', async () => {
      await postTurn(app, 'So where does this leave things?');
      expect(modelFacingAnalysis()!['leading_option_note']).toBe(WITHHELD_LEADER_INPUT_NOTE);
    });

    it('the RAW handler-facing analysis is UNTOUCHED (no collateral damage)', async () => {
      // The input gate is scoped to the model's view on purpose. The raw slot
      // drives chips, telemetry (`leading_option_present`) and projection
      // summaries, and the model never sees it — blanking it would degrade
      // unrelated surfaces to buy nothing. The deterministic composers that DO
      // read it are gated at their own call sites instead.
      await postTurn(app, 'So where does this leave things?');
      const raw = packHandedToTheModel()['analysis'] as Record<string, any> | null;
      expect(raw, 'the raw analysis slot must survive').not.toBeNull();
      expect(raw!['leading_option']?.label).toBe(LEADER_LABEL);
    });
  });

  /**
   * F2 — THE WIRED PROOF that the note's cause is no longer fabricated.
   *
   * The unit tests in `context/__tests__/withheld-leader-projection.test.ts`
   * prove the SELECTOR picks the right note; only this proves the STATE reaches
   * it from the persisted fact, through the hoist and the pack assembly seam
   * (TESTING-DISCIPLINE rule 3 — a unit test of a projection cannot tell you the
   * projection is wired with the right input).
   */
  describe('WITHHELD by the FAIL-CLOSED DEFAULT (pre-#710, unstamped) — F2', () => {
    beforeEach(() => {
      priorFacts = [priorUnstampedRunAnalysisFact()];
    });

    it('BRANCH DISCRIMINATOR: the turn really is withheld, by the default and not by a stamp', async () => {
      // Rule 1. The whole point of this arm is that NOTHING was recorded, so
      // the withholding must be shown to come from the fail-closed read — if
      // the fixture regressed to a stamped fact, this arm would silently become
      // a duplicate of the one above.
      await postTurn(app, 'So where does this leave things?');
      const analysis = modelFacingAnalysis()!;
      expect(analysis['leading_option'], 'the input gate must still have fired').toBeUndefined();
      expect(analysis['options']).toBeUndefined();
    });

    it('the note carries NO fabricated cause when no verdict was ever recorded', async () => {
      // The defect: the note said "a condition the user ratified could not be
      // checked against this result" on EVERY unstamped fact, including
      // scenarios where the user ratified nothing at all — whose verdict, had
      // one been derived, would have been `not_applicable` (permitted). The
      // model was handed a false factual premise about the user's own scenario
      // and coached to explain the withheld ranking with it.
      const note = await postTurn(app, 'So where does this leave things?').then(
        () => modelFacingAnalysis()!['leading_option_note'],
      );
      expect(note).toBe(WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE);
      expect(note).not.toBe(WITHHELD_LEADER_INPUT_NOTE);
      expect(note as string).not.toContain('ratified');
    });

    it('ANTI-OVER-CORRECTION: it is still NEVER SILENT', async () => {
      // Removing the cause must not remove the note. A ranking that vanishes
      // with no explanation invites the model either to invent one or to claim
      // no options exist — the failure the never-silent rule exists for.
      await postTurn(app, 'So where does this leave things?');
      const note = modelFacingAnalysis()!['leading_option_note'] as string;
      expect(note).toContain('Do not name or imply any option as the answer');
      expect(note).toContain('do not infer one from the drivers below');
    });
  });

  describe('PERMITTED (evaluated_feasible) — the over-suppression control', () => {
    beforeEach(() => {
      priorFacts = [priorRunAnalysisFact(true)];
    });

    it('POSITIVE CONTROL: the model-facing analysis keeps EVERY leader field', async () => {
      // Over-suppression is weighted equally with the leak. This is the arm
      // that fails if the gate ever becomes unconditional — and it is also the
      // branch-reached proof for the withheld arm: only a fixture that really
      // loaded the persisted fact can produce these values, so if the FK-parent
      // row regressed, THIS goes red rather than the absence assertions going
      // falsely green.
      await postTurn(app, 'So where does this leave things?');
      const analysis = modelFacingAnalysis()!;
      expect(analysis['leading_option']?.label).toBe(LEADER_LABEL);
      expect(analysis['runner_up']?.label).toBe(RUNNER_LABEL);
      expect(Array.isArray(analysis['options'])).toBe(true);
      expect((analysis['options'] as unknown[]).length).toBeGreaterThan(1);
      expect(analysis['leading_option_note']).toBeUndefined();

      // F7 (Fable review) — THE PRESENCE TWIN for the withheld arm's
      // serialised-pack absence checks. Those assert `'72%'` / `'28%'` never
      // appear anywhere in the model-facing analysis; without this, a change
      // that stopped emitting integer-percent strings entirely (or renamed the
      // field) would make BOTH absence checks pass while proving nothing. The
      // labels already had such a twin above; the probabilities did not.
      const serialisedPermitted = JSON.stringify(analysis);
      expect(serialisedPermitted).toContain('72%');
      expect(serialisedPermitted).toContain('28%');
    });

    it('POSITIVE CONTROL: the alarm stays SILENT on a permitted turn', async () => {
      // Same prose, same path, opposite verdict. Proves the alarm assertion in
      // the withheld arm is measuring the VERDICT and not the fixture text.
      const { status } = await postTurn(app, 'So where does this leave things?');
      expect(status).toBe(200);
      expect(
        events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress),
      ).toHaveLength(0);
    });
  });
});

/**
 * The DETERMINISTIC half. The post-analysis advice gate composes leader prose
 * in code with ZERO LLM calls, so input-gating the model cannot touch it — this
 * site has to consume the verdict itself, and here that is proved on the wire.
 *
 * BRANCH DISCRIMINATOR (rule 1): whether the router was called. The advice gate
 * is a PRE-ROUTE. If it serves, `routeWithToolUse` is never reached; if the
 * verdict makes it decline, routing proceeds. That is a property only the
 * intended branch can produce, and it is asserted in BOTH directions.
 */
describe('G-CEE-1 — the DETERMINISTIC advice gate consumes the verdict (ROADMAP 1.233)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    events = [];
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('A conversational reply.'));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('POSITIVE CONTROL: on a PERMITTED verdict the gate serves, and names the leader', async () => {
    priorFacts = [priorRunAnalysisFact(true)];
    const { status, body } = await postTurn(app, 'What drove this result?', 'frame');
    expect(status).toBe(200);
    // BRANCH-ONLY (rule 1): the advice gate is a PRE-ROUTE, so serving without
    // the router is something only this branch can produce. If the fixture ever
    // stops reaching the gate — the `top_driver` lever-suppression trap this
    // file already hit once — THIS goes red, rather than the withheld arm going
    // falsely green.
    expect(routeWithToolUseMock).not.toHaveBeenCalled();
    expect(body.assistant_text).toContain(LEADER_LABEL);
    expect(body.assistant_text).toContain('72%');
  });

  it('ANTI-OVER-SUPPRESSION: a NON-LEADER advice class still SERVES on a withheld verdict', async () => {
    // F5(a) (Fable review of #716). The claim that input-gating this gate does
    // not over-suppress previously rested on READING `CLASS_REQUIREMENTS` —
    // i.e. on an argument, not on a test. This is the test.
    //
    // `readiness` declares `needs_leading_option: false`, so a null-leader
    // projection must leave it completely unaffected. If the gate ever became
    // unconditional — declining every class on a withheld turn rather than only
    // the ones that need a leader — this goes red while every absence assertion
    // in this file stays green. That asymmetry is the whole point: the leak and
    // the over-suppression are weighted equally, and only one of them had
    // coverage.
    priorFacts = [priorRunAnalysisFact(false)];
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data });
    });
    const { status, body } = await postTurn(app, 'What evidence is missing?', 'frame');
    expect(status).toBe(200);

    // BRANCH-ONLY: the advice gate is a PRE-ROUTE, so serving without the
    // router is something only this branch can produce.
    expect(
      routeWithToolUseMock,
      'the readiness class needs no leading option, so a withheld verdict must not stop it serving',
    ).not.toHaveBeenCalled();
    expect(body.assistant_text.length).toBeGreaterThan(0);

    // The gate's own telemetry states the two halves of the claim on one line:
    // it MATCHED, and it did so with the leading option WITHHELD. That is the
    // difference between "a class that needs no leader kept working" and "the
    // turn happened to be answered by something else".
    const gate = events.find((e) => e.name === 'v5.post_analysis_advice_gate');
    expect(gate, 'the advice gate must have run').toBeDefined();
    expect(gate!.data['matched']).toBe(true);
    expect(gate!.data['advice_class']).toBe('evidence_gap');
    expect(gate!.data['leading_option_withheld']).toBe(true);
    expect(gate!.data['leading_option_present']).toBe(false);

    // And it is still leader-free, scanned with the production alarm's reader —
    // serving is not a licence to name a leader.
    expect(findLeaderClaims(body as never)).toHaveLength(0);
  });

  it('on a WITHHELD verdict the gate DECLINES: no leader, no probability, on the wire', async () => {
    // Same message, same graph, same fact — ONE member of the persisted
    // verdict differs. Both arms are driven here so the comparison is between
    // two observed responses rather than between one response and a
    // remembered expectation.
    priorFacts = [priorRunAnalysisFact(true)];
    const permitted = await postTurn(app, 'What drove this result?', 'frame');
    routeWithToolUseMock.mockClear();

    priorFacts = [priorRunAnalysisFact(false)];
    const withheld = await postTurn(app, 'What drove this result?', 'frame');

    expect(permitted.status).toBe(200);
    expect(withheld.status).toBe(200);

    // The gate declined: `evaluateAvailability` found `leading_option` missing
    // for a class that declares `needs_leading_option`, so the deterministic
    // leader answer was never composed. The turn is then served by the
    // fresh-analysis follow-up guard — a frozen constant, registered
    // `structural`, which is the honest degrade and not a second leak.
    expect(withheld.body.assistant_text).not.toContain(LEADER_LABEL);
    expect(withheld.body.assistant_text).not.toContain(RUNNER_LABEL);
    expect(withheld.body.assistant_text).not.toContain('72%');
    expect(withheld.body.assistant_text).not.toContain('28%');

    // NON-VACUITY (rule 2): the two arms must actually DIFFER. Without this,
    // an assertion set that passed because both arms returned the same
    // leader-free copy — e.g. if the fixture stopped reaching the gate
    // entirely — would read as a pass for the gate.
    expect(withheld.body.assistant_text).not.toBe(permitted.body.assistant_text);

    // And the whole serialised envelope is clean, not just `assistant_text`
    // (rule 3: assert the bytes the consumer receives). The blocks and any
    // sidecar are covered by this, which the prose-only assertions are not.
    expect(withheld.body.assistant_text.length).toBeGreaterThan(0);
    // F7 (Fable review) — the previous assertion here was
    // `JSON.stringify(withheld.body.blocks ?? []).not.toContain(LEADER_LABEL)`,
    // and it was VACUOUS: `blocks` is `[]` on BOTH arms of this path, so it
    // could never fail. Replaced with a scan of the WHOLE serialised envelope
    // using the production alarm's own scanner — which carries its own positive
    // control, because the permitted arm registers a hit and the withheld arm
    // must register none. Measured: withheld 0, permitted 1 (`the_lead`).
    expect(findLeaderClaims(withheld.body as never)).toHaveLength(0);
    expect(
      findLeaderClaims(permitted.body as never).length,
      'positive control: the permitted arm must be VISIBLE to the same scanner, ' +
        'or the absence assertion above is measuring nothing',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE PERSISTED SUMMARY IN THE MODEL INPUT — `older_relevant_facts` (P6).
// ---------------------------------------------------------------------------

/**
 * The live c5 fact summary, transcribed from the historic run_analysis fact
 * `c4ce3efd-f608-4875-8c0d-2f95a68f2aba` on scenario `f63ccb45` (staging), with
 * the option label remapped onto this file's graph.
 *
 * Verbatim source (`raw-2026-07-27-historic/historic-facts-survey.json`):
 *   "Double Down on SMB currently leads by 17 percentage points, but treat this
 *    as provisional: the result is sensitive to Sales Win Rate. The result is
 *    not yet robust — small changes could flip it."
 *
 * On build `74936a6` a withheld turn on that scenario answered, 5/5 samples:
 *   "Your stored record shows double down on SMB previously led by 17
 *    percentage points over enterprise…"
 */
const HISTORIC_LEADER_SUMMARY =
  `${LEADER_LABEL} currently leads by 17 percentage points, but treat this as ` +
  'provisional: the result is sensitive to Market demand. The result is not yet ' +
  'robust — small changes could flip it.';

/**
 * A rationale that makes NO comparative claim. The anti-over-suppression arm:
 * withholding is scoped to the CLAIM, not to the field, so this one must
 * survive a withheld turn BYTE-IDENTICAL.
 *
 * Asserted leader-free by the production reader rather than by inspection, so a
 * future vocabulary widening that swallows this string fails HERE (loudly)
 * instead of turning the over-suppression control into a second leak control.
 */
const LEADER_FREE_RATIONALE =
  'Logged after the budget review; the numbers were re-checked against the plan.';

function decisionRecordRow(statement: string): Record<string, unknown> {
  return {
    record_id: 'dddddddd-1233-4ddd-8ddd-dddddddddddd',
    scenario_id: SCENARIO_ID,
    created_at: '2026-07-13T23:01:27.965Z',
    // `chosen_option_*` is NOT a user choice: `buildDecisionRecordWrite`
    // (decision-records/capture.ts) sets `chosen_option_id` to the fact's
    // `leading_option_id`. The record's option IS the analysis's leader.
    decision: {
      chosen_option_id: 'opt_hire',
      chosen_option_label: LEADER_LABEL,
      graph_hash: 'aag_v1:sha256:0197a59b2a2f27e3',
    },
    // `statement` is the fact's `result.summary`, VERBATIM (capture.ts:234).
    prediction: { statement, confidence: 0.72, confidence_source: 'model_derived' },
  };
}

/**
 * G-CEE-1 — THE CHANNEL #721 DID NOT CLOSE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * #721 gated the persisted analysis summary ON THE WIRE (`blocks[].summary`,
 * via `projectAnalysisSummaryForWithheldClaim`). It did not gate the same
 * string in the MODEL INPUT, and there is a second, longer path by which it
 * gets there:
 *
 *   run_analysis fact `result.summary`
 *     → capture.ts:234  `prediction.statement` (VERBATIM)
 *     → decision_records row
 *     → project.ts      `- [date] Chose "<leader label>": <statement>`
 *     → ContextPack.older_relevant_facts
 *     → buildUserMessage `...rest`  ⇒ SERIALISED INTO THE PROMPT
 *
 * …and `OLDER_RELEVANT_FACTS_INSTRUCTION` is appended beside it telling the
 * model to "treat what it contains as established fact".
 *
 * So on a withheld turn the model was handed the withheld leader claim twice
 * over — as a ranking sentence AND as a dated designation — with an
 * instruction not to doubt it.
 *
 * ⚠ THE ASSERTIONS ARE ON THE MODEL BYTES, NOT ON THE PACK OBJECT. See
 * {@link buildUserMessage} above for why that distinction has already refuted
 * one lane's gating locus in this estate.
 *
 * ⚠ AND THEY ARE NOT ASSERTIONS ABOUT MODEL OUTPUT. c6's stored summary carries
 * a blatant leader claim and its prose stayed clean 5/5, so repetition is
 * probabilistic and un-pinnable. THE INPUT IS THE DEFECT; that is what is
 * measured here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('G-CEE-1 — the PERSISTED analysis summary in the MODEL INPUT (P6 decision records)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    events = [];
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('A conversational reply.'));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    // The c5 shape: a HISTORIC, UNSTAMPED fact ⇒ withheld by the fail-closed
    // default, exactly the class with no migration and therefore live.
    priorFacts = [priorUnstampedRunAnalysisFact()];
    decisionRecordPage = { records: [decisionRecordRow(HISTORIC_LEADER_SUMMARY)], totalCount: 1 };
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
    decisionRecordPage = { records: [], totalCount: 0 };
  });

  it('NON-VACUITY: the section really is in the model bytes on a withheld turn', async () => {
    // TESTING-DISCIPLINE rule 2. Every absence assertion below is worthless if
    // the section simply is not there — and it would not be there if the store
    // mock, the loader, or the pack key ever stopped working. This proves the
    // channel is OPEN and carrying content on the very turn the others measure.
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    expect(olderRelevantFactsSection(), 'the P6 section must be on the pack').toBeDefined();
    expect(bytes).toContain('Prior decisions recorded on this scenario');
    expect(bytes).toContain('2026-07-13');
  });

  it('BRANCH DISCRIMINATOR: this turn really is withheld', async () => {
    // Rule 1: without this, a fixture regression to a permitted verdict would
    // make the leak arm below fail for the RIGHT reason on the WRONG branch —
    // or, after the fix, pass for no reason at all.
    await postTurn(app, 'So where does this leave things?');
    expect(modelFacingAnalysis()!['leading_option']).toBeUndefined();
    expect(modelFacingAnalysis()!['options']).toBeUndefined();
  });

  it('THE LEAK: the historic fact summary must NOT reach the model bytes', async () => {
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');

    // The live leaking substring, and the whole sentence it came from.
    expect(bytes).not.toContain('17 percentage points');
    expect(bytes).not.toContain('currently leads');
    expect(bytes).not.toContain(HISTORIC_LEADER_SUMMARY);

    // And the DESIGNATION beside it. `Chose "<leader label>"` is the analysis's
    // leading option under another name (capture.ts sets it from
    // `leading_option_id`), stamped with a date and an instruction to treat it
    // as established fact — a leader claim in the model input whether or not
    // the rationale carries one. Scoped to the section because the label is
    // legitimately present elsewhere in the prompt (the graph's own node
    // labels), which is exactly why a whole-prompt label scan would be wrong.
    const section = olderRelevantFactsSection()!;
    expect(section).not.toContain(LEADER_LABEL);
    expect(section).not.toContain('Chose "');

    // Read with the PRODUCTION alarm's own vocabulary, so this test and the
    // instrument that measures the residue cannot drift apart.
    expect(textNamesLeadingOption(section)).toBe(false);

    // The substitution is the SHARED one (#721's), not a second copy of it.
    expect(section).toContain(WITHHELD_ANALYSIS_SUMMARY);
  });

  it('ANTI-OVER-SUPPRESSION: a leader-FREE rationale survives BYTE-IDENTICAL', async () => {
    // Withholding is scoped to the CLAIM, not to the field. Blanking every
    // stored rationale on a withheld turn would be the failure this estate
    // weights equally with the leak — and it is the failure a blanket gate
    // would produce while every absence assertion above stayed green.
    expect(
      textNamesLeadingOption(LEADER_FREE_RATIONALE),
      'the control rationale must itself be leader-free, or it is measuring the leak arm again',
    ).toBe(false);
    decisionRecordPage = { records: [decisionRecordRow(LEADER_FREE_RATIONALE)], totalCount: 1 };

    await postTurn(app, 'So where does this leave things?');
    const section = olderRelevantFactsSection()!;
    expect(section).toContain(LEADER_FREE_RATIONALE);
    expect(section).not.toContain(WITHHELD_ANALYSIS_SUMMARY);
  });

  it('POSITIVE CONTROL: on a PERMITTED verdict the record ships VERBATIM', async () => {
    // The over-suppression arm proper. Same record, same path, opposite
    // verdict: a permitted turn must be BYTE-IDENTICAL to a world without this
    // gate — designation, rationale and all. This is also the branch-reached
    // proof for the withheld arms: only a fixture that really loaded the
    // record can produce these bytes.
    priorFacts = [priorRunAnalysisFact(true)];

    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    const section = olderRelevantFactsSection()!;

    expect(section).toContain(`Chose "${LEADER_LABEL}": ${HISTORIC_LEADER_SUMMARY}`);
    expect(bytes).toContain(HISTORIC_LEADER_SUMMARY);
    expect(bytes).toContain('17 percentage points');
    expect(section).not.toContain(WITHHELD_ANALYSIS_SUMMARY);
  });
});

/**
 * The VERBATIM live leak, from `raw-2026-07-27-historic/phase-post-b35d09de-rep4/
 * c5.historic.propose.reading.json` — build `b35d09de`, i.e. AFTER #721 and
 * AFTER #723, on a turn whose own `may_name_leading_option` reads `false`.
 *
 * ⚠ ITS `assistant_text_leader_codes` IS `[]`. The production alarm scored ZERO
 * hits on this sentence: `\bleads\b` is present-tense and this is "led". That
 * measurement is the whole reason the redaction reader is a SEPARATE, WIDER one
 * — a gate built on the shared vocabulary could not have caught the string that
 * actually leaked. Pinned as an assertion below, not left as a comment.
 *
 * Labels are NOT remapped onto this file's graph, deliberately: these are the
 * live bytes, and the reader is label-independent by design (it triggers on the
 * ordering claim, never on an option roster — deriving the roster here would be
 * a second derivation of "who is leading" beside the verdict).
 */
const HISTORY_LEAK_SENTENCE_LIVE =
  'Double down on SMB previously led by 17 percentage points, flagged fragile on ' +
  'this exact assumption from the first run.';

/** The rep4 bytes exactly as captured ("17 points", not "17 percentage points"). */
const HISTORY_LEAK_SENTENCE_REP4 = 'Double down on SMB previously led by 17 points.';

/**
 * ONE prior assistant answer, shaped like the c5 turns that poisoned that
 * scenario: mostly legitimate coaching, with the ordering claim in one bullet.
 *
 * The surviving bullets are load-bearing. A gate that blanked the whole message
 * would pass every absence assertion below and destroy the coach's memory of
 * what the blocker is — the over-suppression failure this estate weights equally
 * with the leak. "sales win rate" in particular is a FACTOR NAME on the leaking
 * scenario, and it must survive a reader whose vocabulary includes `win`.
 */
const C5_SHAPED_ASSISTANT_MESSAGE =
  "You have asked this several times now, and the model cannot answer until one specific thing changes.\n" +
  '• The blocker is unchanged and narrow. The connection from sales win rate to revenue growth is still unverified against real pipeline numbers.\n' +
  `• Your stored lean was recorded on the first run. ${HISTORY_LEAK_SENTENCE_LIVE}\n` +
  `• ${HISTORY_LEAK_SENTENCE_REP4}\n` +
  '• Something other than the model may be holding this up. If pulling pipeline data or triggering a rerun both feel undoable right now, that is the actual thing worth solving.';

/** An answer that makes NO ordering claim — the anti-over-suppression fixture. */
const LEADER_FREE_ASSISTANT_MESSAGE =
  'The connection from sales win rate to revenue growth is still unverified against real pipeline numbers. ' +
  'Two things would change that: real enterprise figures from your pipeline, or a rerun of the analysis as it stands.';

/** A prior turn carrying conversation content, as `readRecent` returns it. */
function priorContentTurn(
  turnId: string,
  userMessage: string,
  assistantMessage: string,
): Record<string, unknown> {
  return {
    id: `cccccccc-1233-4ccc-8ccc-${turnId.padStart(12, '0').slice(-12)}`,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: turnId,
    turn_class: 'clarify',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 210,
    created_at: new Date(Date.now() - 30_000).toISOString(),
    user_message: userMessage,
    assistant_message: assistantMessage,
  };
}

/**
 * G-CEE-1 — THE FOURTH CHANNEL: the model's own CONVERSATION HISTORY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT #721 AND #723 DID NOT CLOSE, MEASURED ON THE BUILD THAT SHIPPED BOTH.
 *
 * `WALK-HISTORIC-PREP-2026-07-27.md` §10, build `b35d09de`: on historic scenario
 * `f63ccb45` the withheld turn's `assistant_text` named the withheld leader on
 * **2 of 5** samples — down from 5/5 on `74936a65` (so #723's decision-records
 * gate was real and material) but NOT zero. The residual channel is
 * `ContextPack.conversation.recent_turns[].assistant_message`, which
 * `buildUserMessage` serialises into the routing prompt through its `...rest`
 * spread with nothing on the path consulting the verdict.
 *
 * ⚠ AND IT SELF-REINFORCES. A leaked answer is persisted as that turn's
 * `assistant_message` and feeds the NEXT turn's window. Seven of the leaking
 * messages in `f63ccb45`'s history were written by the walk's own probe turns
 * (§10.4) — the instrument poisoned the scenario it was measuring. Gating the
 * INPUT is what breaks the loop.
 *
 * ⚠ THESE ARE NOT ASSERTIONS ABOUT MODEL OUTPUT, and the control that forces
 * that discipline is in the evidence: target `c6` carries EIGHT leader-naming
 * stored messages and leaked 0/5. Presence in history is not sufficiency, so a
 * leak rate is not pinnable in-repo. THE INPUT IS THE DEFECT; the model BYTES
 * are what is measured here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('G-CEE-1 — prior-turn ASSISTANT PROSE in the MODEL INPUT (conversation history)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    events = [];
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('A conversational reply.'));
    priorTurns = [
      priorContentTurn('prior-turn-c5', 'Which one should we go with?', C5_SHAPED_ASSISTANT_MESSAGE),
      PRIOR_RUN_ANALYSIS_TURN,
    ];
    // The c5 shape: a HISTORIC, UNSTAMPED fact ⇒ withheld by the fail-closed
    // default, which is the class with no migration and therefore live.
    priorFacts = [priorUnstampedRunAnalysisFact()];
    // CHANNEL ISOLATION. #723's channel is switched OFF for this whole arm, so
    // a hit here can only have come through `conversation`. Without it the two
    // channels ship the same "17 percentage points" substring and neither arm
    // would discriminate.
    decisionRecordPage = { records: [], totalCount: 0 };
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  /** The conversation section as it sits on the pack handed to the router. */
  const conversationSection = (): Record<string, any> =>
    packHandedToTheModel().conversation as Record<string, any>;

  it('INSTRUMENT: the live leak sentence is INVISIBLE to the shared alarm vocabulary', () => {
    // ⭐ THE MEASUREMENT THAT DICTATED THE DESIGN, asserted rather than asserted
    // about. The archive scored `assistant_text_leader_codes: []` on this
    // sentence; if that ever stops being true (someone widens
    // LEADER_CLAIM_PATTERNS — good) this test goes red and the "separate wider
    // reader" rationale must be re-derived rather than inherited.
    expect(textNamesLeadingOption(HISTORY_LEAK_SENTENCE_LIVE)).toBe(false);
    expect(textNamesLeadingOption(HISTORY_LEAK_SENTENCE_REP4)).toBe(false);
    expect(findLeaderClaims({ assistant_text: HISTORY_LEAK_SENTENCE_REP4 } as never)).toEqual([]);
    // …and the redaction reader DOES see it. A gate that cannot see the string
    // that leaked is theatre (rule 2: prove the instrument sees a PRESENCE).
    expect(historyAssertsLeaderClaim(HISTORY_LEAK_SENTENCE_LIVE)).toBe(true);
    expect(historyAssertsLeaderClaim(HISTORY_LEAK_SENTENCE_REP4)).toBe(true);
  });

  it('NON-VACUITY: the channel really is OPEN and carrying this turn’s history', async () => {
    // Rule 2. Every absence assertion below is worthless if the conversation
    // section is empty — which it would be if the store mock, the window
    // projection or the pack key stopped working.
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    expect(conversationSection()['recent_turns'].length).toBeGreaterThan(0);
    expect(bytes).toContain('"recent_turns"');
    expect(bytes).toContain('Which one should we go with?');
  });

  it('BRANCH DISCRIMINATOR: this turn really is withheld', async () => {
    // Rule 1: a fixture regression to a permitted verdict would make the leak
    // arm pass for no reason at all.
    await postTurn(app, 'So where does this leave things?');
    expect(modelFacingAnalysis()!['leading_option']).toBeUndefined();
    expect(modelFacingAnalysis()!['options']).toBeUndefined();
  });

  it('THE LEAK: the prior answer’s ordering claim must NOT reach the model bytes', async () => {
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');

    // The exact live strings, and the fragments the walk scored on.
    expect(bytes).not.toContain(HISTORY_LEAK_SENTENCE_LIVE);
    expect(bytes).not.toContain(HISTORY_LEAK_SENTENCE_REP4);
    expect(bytes).not.toContain('previously led');
    expect(bytes).not.toContain('17 percentage points');
    expect(bytes).not.toContain('17 points');

    // And on the SECTION, so a future field that re-exposes the same prose
    // elsewhere in the pack cannot make this pass by accident.
    const section = JSON.stringify(conversationSection());
    expect(section).not.toContain('previously led');
    expect(historyAssertsLeaderClaim(section)).toBe(false);

    // NEVER SILENT: the marker says what is absent and why.
    expect(section).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('ANTI-OVER-SUPPRESSION: the SURVIVING prose of the same message is untouched', async () => {
    // A gate that blanked the whole assistant message would pass every absence
    // assertion above and destroy the coach's memory of what the blocker is.
    // The redaction is sentence-scoped, and this is what proves it.
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    expect(bytes).toContain('The blocker is unchanged and narrow.');
    expect(bytes).toContain('sales win rate to revenue growth is still unverified');
    expect(bytes).toContain('Something other than the model may be holding this up.');
    // The USER's own words are never redacted — see the module docstring for
    // why that is a decision and not an oversight. Pinned so a later widening
    // to `user_message` is a deliberate edit here.
    expect(bytes).toContain('Which one should we go with?');
  });

  it('POSITIVE CONTROL: a withheld turn with LEADER-FREE history is BYTE-IDENTICAL', async () => {
    // The over-suppression arm proper, and the one that fails if the gate ever
    // becomes unconditional. Same verdict, same path, claim-free content.
    expect(
      historyAssertsLeaderClaim(LEADER_FREE_ASSISTANT_MESSAGE),
      'the control message must itself be claim-free, or it is measuring the leak arm again',
    ).toBe(false);
    priorTurns = [
      priorContentTurn('prior-turn-clean', 'What is blocking this?', LEADER_FREE_ASSISTANT_MESSAGE),
      PRIOR_RUN_ANALYSIS_TURN,
    ];

    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    const turn = conversationSection()['recent_turns'][0] as Record<string, any>;
    expect(turn['assistant_message']).toBe(LEADER_FREE_ASSISTANT_MESSAGE);
    expect(bytes).not.toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('POSITIVE CONTROL: on a PERMITTED verdict the history ships VERBATIM', async () => {
    // Same history, same path, opposite verdict. Byte-identity with a world in
    // which this gate does not exist — and the branch-reached proof for the
    // withheld arms above, since only a fixture that really loaded the turn can
    // produce these bytes.
    priorFacts = [priorRunAnalysisFact(true)];

    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    const turn = conversationSection()['recent_turns'][0] as Record<string, any>;
    expect(turn['assistant_message']).toBe(C5_SHAPED_ASSISTANT_MESSAGE);
    expect(bytes).toContain(HISTORY_LEAK_SENTENCE_LIVE);
    expect(bytes).toContain('17 percentage points');
    expect(bytes).not.toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('the INJECTED MARKER does not trip the alarm this gate exists to quieten', async () => {
    // The third positive control. An input gate that injected leader-vocabulary
    // residue into every withheld prompt would show up only as an alarm rate
    // nobody had a reason to look at — the trap
    // `withheld-leader-projection.ts` records hitting with "out in front".
    // Checked here on the REAL prompt bytes, not on the constant alone.
    await postTurn(app, 'So where does this leave things?');
    const bytes = modelBytes('So where does this leave things?');
    expect(bytes).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    expect(textNamesLeadingOption(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
    expect(historyAssertsLeaderClaim(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
    expect(findLeaderClaims({ assistant_text: WITHHELD_HISTORY_REDACTION_MARKER } as never)).toEqual(
      [],
    );
  });

  it('SELF-REINFORCEMENT: a SECOND leaked turn in the window is also removed', async () => {
    // The loop, in miniature. Once a turn leaks, its answer is persisted and
    // feeds the next turn's window — which is how seven probe turns compounded
    // on `f63ccb45`. The gate must be per-turn over the WHOLE window, not a
    // most-recent-turn special case.
    priorTurns = [
      priorContentTurn('prior-turn-c5b', 'And now?', `${HISTORY_LEAK_SENTENCE_REP4} Nothing else has changed.`),
      priorContentTurn('prior-turn-c5', 'Which one should we go with?', C5_SHAPED_ASSISTANT_MESSAGE),
      PRIOR_RUN_ANALYSIS_TURN,
    ];

    await postTurn(app, 'So where does this leave things?');
    const section = JSON.stringify(conversationSection());
    expect(section).not.toContain('previously led');
    expect(section).not.toContain('17 points');
    // The non-claiming half of the SECOND turn survives too.
    expect(section).toContain('Nothing else has changed.');
  });
});
