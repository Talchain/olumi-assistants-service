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
// The production alarm's OWN scanner, so this acceptance test and the alarm
// cannot drift apart.
import { findLeaderClaims } from '../compose/leading-option-egress-guard.js';

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

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

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
      expect(
        alarms.length,
        'the withheld converse exit must arm the egress alarm with the REAL permission',
      ).toBeGreaterThan(0);
      expect(alarms[0]!.data['hit_count']).toBeGreaterThan(0);
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

  describe('PERMITTED (evaluated_feasible) — the over-suppression control', () => {
    beforeEach(() => {
      priorFacts = [priorRunAnalysisFact(true)];
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
    expect(JSON.stringify(withheld.body.blocks ?? [])).not.toContain(LEADER_LABEL);
  });
});
