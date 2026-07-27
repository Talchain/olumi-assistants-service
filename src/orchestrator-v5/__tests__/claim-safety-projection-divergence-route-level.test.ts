/**
 * F1 — AT THE BOUNDARY: a WITHHELD analysis reached the model under a NEWER
 * fact's permission, and the alarm was armed to ignore it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A ROUTE-LEVEL FILE AND NOT ONLY THE UNIT ONE.
 *
 * `context/__tests__/claim-safety-projection-divergence.test.ts` proves the
 * verdict function returns the right boolean. That is not the claim that
 * matters. The claim that matters is TESTING-DISCIPLINE rule 3's: what did the
 * MODEL RECEIVE, and what was the egress alarm ARMED WITH — neither of which a
 * unit test of a reader can speak for, because between them sit the pack
 * assembler, the model-input chokepoint at `turn-executor.ts:2208`, and
 * `buildUserMessage`, which destructures the raw `analysis` OUT and re-keys
 * `display_analysis` under that name. A pack field and a model-facing field are
 * not the same claim; a previous lane had a gating locus refuted on exactly
 * that distinction.
 *
 * THE FIXTURE is the divergence state, written as two persisted facts that
 * differ in the two members that matter and NOTHING else that could explain the
 * result:
 *
 *   A — `analysis_status: 'completed'`, OLDER, verdict WITHHELD, leader
 *       `opt_hire` at 72%. The newest SUCCESSFUL fact, so it is what
 *       `buildAnalysisFromPriorFacts` projects into the pack.
 *   B — `analysis_status: 'partial'`,  NEWER, verdict PERMITTED, leader
 *       `opt_hold` at 66%. The newest CLAIM-BEARING fact, so before this fix it
 *       is what the permission read.
 *
 * The two name DIFFERENT leaders at DIFFERENT probabilities on purpose: every
 * assertion below can therefore say WHICH fact grounded the bytes, instead of
 * only that some analysis did.
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

const SCENARIO_ID = 'a1b2c3d4-1741-4123-8123-a1b2c3d41741';
const A_LEADER_LABEL = 'Hire Marketing Manager';
const B_LEADER_LABEL = 'Hold';

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
    // A factor NO option intervenes on — without it the Spine A lever
    // suppression strips every driver and the advice gate declines for
    // `missing_inputs: ['top_driver']`, which would make both arms measure
    // something unrelated to the verdict.
    { id: 'fac_market', kind: 'factor', label: 'Market demand' },
    { id: 'opt_hire', kind: 'option', label: A_LEADER_LABEL, interventions: { fac_capacity: 1 } },
    {
      id: 'opt_hold',
      kind: 'option',
      label: B_LEADER_LABEL,
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

function runAnalysisFact(opts: {
  readonly status: string;
  readonly ageMs: number;
  readonly mayName: boolean;
  readonly leaderId: 'opt_hire' | 'opt_hold';
  readonly leaderProbability: number;
}): Record<string, unknown> {
  const otherId = opts.leaderId === 'opt_hire' ? 'opt_hold' : 'opt_hire';
  const label = (id: string) => (id === 'opt_hire' ? A_LEADER_LABEL : B_LEADER_LABEL);
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: opts.leaderId,
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - opts.ageMs).toISOString(),
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.mayName ? 'evaluated_feasible' : 'unevaluated',
      },
      enrichment: {
        analysis_status: opts.status,
        option_comparison: [
          {
            option_id: opts.leaderId,
            option_label: label(opts.leaderId),
            win_probability: opts.leaderProbability,
            outcome_mean: 0.5,
          },
          {
            option_id: otherId,
            option_label: label(otherId),
            win_probability: 1 - opts.leaderProbability,
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
      win_probabilities: {
        [opts.leaderId]: opts.leaderProbability,
        [otherId]: 1 - opts.leaderProbability,
      },
    },
  };
}

/** A — newest SUCCESSFUL, WITHHELD. What the pack's analysis is built from. */
const FACT_A_SUCCESSFUL_WITHHELD = (mayName = false) =>
  runAnalysisFact({
    status: 'completed',
    ageMs: 120_000,
    mayName,
    leaderId: 'opt_hire',
    leaderProbability: 0.72,
  });

/** B — NEWER `partial`, PERMITTED. What the permission read before this fix. */
const FACT_B_PARTIAL_PERMITTED = runAnalysisFact({
  status: 'partial',
  ageMs: 60_000,
  mayName: true,
  leaderId: 'opt_hold',
  leaderProbability: 0.66,
});

/**
 * The FK-parent turn row. Seeding facts alone yields an EMPTY `prior_facts`
 * (`buildTurnContext` loads by FK from the turn ids), the verdict reads as "no
 * analysis" ⇒ `true`, and every assertion below would pass vacuously on the
 * wrong branch.
 */
const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'bbbbbbbb-1741-4bbb-8bbb-bbbbbbbbbbbb',
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
      createRecord: async () => ({ record_id: 'unused-in-this-file', deduped: false }),
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

/** The REAL prompt serialiser, off the same module the production path calls. */
const { buildUserMessage } = await import('../routing/route-with-tool-use.js');

/**
 * A live §7-shaped leak naming A's leader — the fact whose OWN verdict withheld
 * it. Chosen because the production alarm can SEE this phrasing (asserted
 * below, rule 2), so the alarm arm measures the verdict and not a blind spot.
 */
const CONVERSE_LEADER_TEXT =
  `Looking at where things stand, ${A_LEADER_LABEL} leads at 72% against ` +
  `${B_LEADER_LABEL} at 28%. That is a 44 point margin. ` +
  'Market demand is the driver doing most of the work here.';

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

const QUESTION = 'So where does this leave things?';

/**
 * `_diagnostic_trace` is flag-gated (`CEE_DIAGNOSTIC_TRACE_ENABLED`), and the
 * trace IS the wire surface the provenance assertion below reads — so the flag
 * is set for the file and restored after, rather than assumed.
 */
let priorTraceFlag: string | undefined;

describe('F1 — the DIVERGENCE state at the boundary', () => {
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
      events.push({ name, data });
    });
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly(CONVERSE_LEADER_TEXT));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    // Newest-first, the order `readRecent` delivers.
    priorFacts = [FACT_B_PARTIAL_PERMITTED, FACT_A_SUCCESSFUL_WITHHELD()];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENTS FIRST (TESTING-DISCIPLINE rule 2) ─────────────────────────

  it('INSTRUMENT: the fixture prose really is residue the production scanner SEES', () => {
    // Every alarm assertion below is worthless if the alarm has nothing to
    // find. Two of the five live leaking sentences are invisible to
    // `LEADER_CLAIM_PATTERNS`; this one is not, and that is asserted.
    expect(findLeaderClaims({ assistant_text: CONVERSE_LEADER_TEXT } as never).length).toBeGreaterThan(
      0,
    );
  });

  it('INSTRUMENT: the pack’s analysis is grounded in the WITHHELD fact, not the permitting one', async () => {
    // THE BRANCH DISCRIMINATOR for this whole file, and the reason the two
    // facts name different leaders. The raw `analysis` slot is deliberately
    // never gated (it is handler-facing), so it reports, unfiltered, WHICH
    // analysis the turn is built from. `opt_hire` at 0.72 is A — the fact whose
    // own verdict WITHHELD the claim. If this ever reads `Hold` / 0.66 the
    // divergence has gone and every assertion below is measuring nothing.
    //
    // (The raw slot carries NUMERIC probabilities; the `'72%'` strings the
    // arms below assert on are a `display_analysis`-only formatting. Two
    // different shapes, asserted in the shape each actually has.)
    await postTurn(app, QUESTION);
    const raw = packHandedToTheModel()['analysis'] as Record<string, any>;
    expect(raw?.['leading_option']?.label).toBe(A_LEADER_LABEL);
    expect(raw?.['leading_option']?.probability).toBe(0.72);
    expect(raw?.['runner_up']?.label).toBe(B_LEADER_LABEL);
  });

  // ── THE DEFECT, ON THE BYTES THE MODEL RECEIVED ───────────────────────────

  it('RED-FIRST: the model-facing analysis carries NO leader from the withheld fact', async () => {
    // Pre-fix the pack shipped UNPROJECTED: the chokepoint at
    // `turn-executor.ts:2208` keys on the turn permission, the turn permission
    // was read off B (permitted), and the content was A's.
    await postTurn(app, QUESTION);
    const analysis = modelFacingAnalysis();
    expect(analysis, 'the pack must still carry an analysis section').not.toBeNull();
    expect(analysis!['leading_option']).toBeUndefined();
    expect(analysis!['runner_up']).toBeUndefined();
    expect(analysis!['margin']).toBeUndefined();
  });

  it('RED-FIRST: the RANKED OPTIONS TABLE is gone too', async () => {
    // The load-bearing half. `options` is sorted by win probability and carries
    // the probabilities, so `options[0]` IS the leader and the live leaking
    // sentence is reconstructible from this field alone.
    await postTurn(app, QUESTION);
    const analysis = modelFacingAnalysis()!;
    expect(analysis['options']).toBeUndefined();
    const serialised = JSON.stringify(analysis);
    expect(serialised).not.toContain(A_LEADER_LABEL);
    expect(serialised).not.toContain('72%');
  });

  it('RED-FIRST: the withheld leader is absent from the PROMPT BYTES the model was handed', async () => {
    // Rule 3, taken literally. `buildUserMessage` re-keys `display_analysis`
    // under `analysis`, so asserting on the pack object alone would not be a
    // claim about what the model read. This asserts on the serialised prompt.
    await postTurn(app, QUESTION);
    const bytes = buildUserMessage(packHandedToTheModel() as never, QUESTION);
    expect(bytes).not.toContain('72%');
    expect(bytes).not.toContain('"leading_option"');
  });

  it('RED-FIRST: the absence is NEVER SILENT — the pack says why the ranking is missing', async () => {
    // A ranking that vanishes with no explanation invites the model to invent
    // one or to claim no options exist.
    await postTurn(app, QUESTION);
    const note = modelFacingAnalysis()!['leading_option_note'];
    expect(typeof note).toBe('string');
    expect(note as string).toContain('Do not name or imply any option as the answer');
  });

  it('RED-FIRST: the Layer-3 alarm is ARMED WITH FALSE, so a leaked leader COUNTS', async () => {
    // The half that made this defect silent. `guardLeadingOptionClaimsAtEgress`
    // returns its input unchanged and emits NOTHING when the permission is
    // `true`. In the divergence state the permission WAS `true`, so the model
    // could recite A's withheld leader and the alarm recorded nothing at all.
    //
    // Exactly ONE, for #730-E1's multiplicity reason: the scan belongs on the
    // final `wireBody` in `sendFinalised200`, and more than one fire means it
    // has been re-added to a re-entered chokepoint.
    const { status } = await postTurn(app, QUESTION);
    expect(status).toBe(200);
    const alarms = events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress);
    expect(
      alarms.length,
      'the divergence turn must arm the egress alarm with the REAL permission, exactly once',
    ).toBe(1);
    expect(alarms[0]!.data['hit_count']).toBeGreaterThan(0);
  });

  it('RED-FIRST: the wire diagnostic NAMES the narrowing rather than hiding it', async () => {
    // A triager reading `_diagnostic_trace.claim_safety` must be able to tell
    // "the newest claim withheld" from "the newest claim permitted but the
    // analysis this turn can display withheld" — those have different fixes,
    // and #726 bought its discriminator precisely because two answers were the
    // same wire byte.
    const { body } = await postTurn(app, QUESTION);
    const claimSafety = body['_diagnostic_trace']?.['claim_safety'];
    expect(claimSafety, 'the diagnostic block must be present to be readable').toBeTruthy();
    expect(claimSafety['may_name_leading_option']).toBe(false);
    expect(claimSafety['verdict_provenance']).toBe('fail_closed_projected_analysis');
  });

  // ── OVER-SUPPRESSION CONTROL ──────────────────────────────────────────────

  describe('CONTROL: the SAME fixture with A PERMITTED must be untouched', () => {
    beforeEach(() => {
      // ONE member flipped — A's `may_name_leading_option`. Every behavioural
      // difference from the arm above is therefore attributable to the
      // displayed fact's verdict and to nothing else in the fixture.
      priorFacts = [FACT_B_PARTIAL_PERMITTED, FACT_A_SUCCESSFUL_WITHHELD(true)];
    });

    it('the model-facing analysis keeps EVERY leader field', async () => {
      // The arm that goes red if the gate ever becomes unconditional — and the
      // branch-reached proof for the arm above: only a fixture that really
      // loaded the persisted facts can produce these values.
      await postTurn(app, QUESTION);
      const analysis = modelFacingAnalysis()!;
      expect(analysis['leading_option']?.label).toBe(A_LEADER_LABEL);
      expect(analysis['runner_up']?.label).toBe(B_LEADER_LABEL);
      expect(Array.isArray(analysis['options'])).toBe(true);
      expect(analysis['leading_option_note']).toBeUndefined();
      expect(JSON.stringify(analysis)).toContain('72%');
    });

    it('the alarm stays SILENT', async () => {
      // Same prose, same path, same divergence — opposite verdict on the
      // DISPLAYED fact. Proves the alarm assertion above measures that verdict
      // and not the fixture text or the mere presence of two facts.
      const { status } = await postTurn(app, QUESTION);
      expect(status).toBe(200);
      expect(
        events.filter((e) => e.name === TelemetryEvents.V5LeadingOptionClaimAtEgress),
      ).toHaveLength(0);
    });
  });
});
