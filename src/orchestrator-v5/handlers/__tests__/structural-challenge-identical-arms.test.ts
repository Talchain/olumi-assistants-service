/**
 * SCI-DEEP beat 4 (DL 5 Oct): the served fa027cf5 Run was licensed (gap 0.134), yet "Test without this link" said
 * "Which option leads cannot be compared" and printed its expected results as "0 now and -0".
 *
 * Cause: the candidate's leader licence was recomputed from the EDITED graph's readiness. Removing a link that is a
 * factor's only route to the goal leaves NO_PATH_TO_GOAL, so readiness is `blocked`, admission is `none`, and the
 * withheld candidate licence also erased the baseline's canonical leader. The fix:
 *   (1) the candidate is licensed on the baseline's canonical readiness/admission, plus its OWN result (separation);
 *   (2) when every arm of the candidate RESULT is identical (and the baseline's are not), the reply says the lead
 *       rests entirely on this link, and never names a candidate leader;
 *   (3) model-scale amounts keep significant figures (never "0" for 0.0213, never "-0");
 *   (4) a target frequency unavailable in both versions is said once.
 *
 * Real `run_analysis` handler, real snapshot loader and real canonical read, on the served fa027cf5 graph
 * (Acceptance receipt hourly-0325-20261005 `.baseline_graph.graph`). The baseline rows are the served Run's own
 * numbers. The candidate rows are SYNTHETIC (self-authored): the served receipt does not carry the candidate's
 * numbers. Identity is by construction, because with the link removed no option reaches Quarterly revenue.
 */
import { createHash } from 'node:crypto';
import { StructuralChallengeResultV1Schema } from '@talchain/schemas';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';

vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
const turnContext = vi.hoisted(() => ({ current: null as unknown }));
const currentnessStore = vi.hoisted(() => ({ current: undefined as import('../../session/store.js').SessionStore | undefined }));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => currentnessStore.current }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTurnContext: vi.fn(async () => turnContext.current),
}));
/** R1b: force the candidate's OWN licence to `withheld` (gate 1 v2's identical-arm withhold will do this on staging). */
const forceCandidateWithheld = vi.hoisted(() => ({ on: false }));
vi.mock('../../model-management/version-result-binding.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../model-management/version-result-binding.js')>();
  return { ...original, boundRunLeaderLicence: (...args: Parameters<typeof original.boundRunLeaderLicence>) =>
    forceCandidateWithheld.on ? 'withheld' : original.boundRunLeaderLicence(...args) };
});

import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { priorRunForSeed } from '../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../tools/registry.js';
import { dispatchStructuralChallenge } from '../structural-challenge-dispatch.js';
import { formatChallengeAmount, structuralChallengePressId, structuralChallengeTurnFor } from '../../agent-lane/method-turn/structural-challenge-turn.js';

type Rec = Record<string, any>;
const SCENARIO = 'fa027cf5-c5c9-4021-9578-ee79b15c6eb8';
const servedGraph = JSON.parse(readFileSync(new URL('./fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as Rec;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;

const LEAD_LINK = { from_id: 'enterprise_prospect_signing_likelihood', to_id: 'quarterly_revenue' };
const OTHER_LINK = { from_id: 'revenue_lost_to_trial_abandonment', to_id: 'quarterly_revenue' };
const LEADER = 'ai_reporting_module_sprint';

type Stats = { w: number; mean: number; std: number; p10: number; p50: number; p90: number };
/** The served fa027cf5 Run's own rows (receipt `.run_response`, ISL @620ee5f0). */
const SERVED: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.5116166666666628, mean: 0.02134743573525561, std: 0.05794864377732945, p10: -0.04447165769637492, p50: 0.012637991252167108, p90: 0.10051804427935832 },
  integration_bug_fix_sprint: { w: 0.3777666666666818, mean: 0.01883963611307356, std: 0.054676120365086324, p10: -0.04206720064552672, p50: 0.009069426170272335, p90: 0.09350546215162735 },
  continue_current_plan: { w: 0.11061666666666901, mean: 0.015054768174162368, std: 0.05551686855808458, p10: -0.047450823228790816, p50: 0.005030893009746502, p90: 0.09102360146076206 },
};
/** SYNTHETIC: one shared row; with no option reaching the goal, every arm reads the same draws. */
const SAME: Omit<Stats, 'w'> = { mean: -0.0031, std: 0.0412, p10: -0.0551, p50: -0.0042, p90: 0.0493 };
/** SYNTHETIC distinct candidate (the other link removed: the AI path still separates the options). */
const DISTINCT: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.6, mean: 0.019, std: 0.05, p10: -0.04, p50: 0.012, p90: 0.09 },
  integration_bug_fix_sprint: { w: 0.3, mean: 0.014, std: 0.05, p10: -0.045, p50: 0.008, p90: 0.085 },
  continue_current_plan: { w: 0.1, mean: 0.011, std: 0.05, p10: -0.048, p50: 0.004, p90: 0.08 },
};

const hasLink = (g: Rec, l: { from_id: string; to_id: string }) => (g.edges as Rec[]).some((e) => e.from === l.from_id && e.to === l.to_id);

type Shape = 'served' | 'same' | 'distinct' | 'near_same';
function rowsOf(shape: Shape, options: Rec[]): Rec[] {
  const ids = options.map((o) => String(o.option_id ?? o.id));
  return options.map((o, i) => {
    const id = ids[i];
    const s: Stats = shape === 'served' ? SERVED[id] ?? { w: 0, mean: 0.01, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
      : shape === 'distinct' ? DISTINCT[id] ?? { w: 0, mean: 0.009, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
        // near_same: one arm differs by 1e-9 relative in its mean only (a contrast for the 1e-12 tolerance).
        : { ...SAME, w: 1 / ids.length, ...(shape === 'near_same' && i === 0 ? { mean: SAME.mean * (1 + 1e-9) } : {}) };
    return {
      option_id: id, option_label: o.label, win_probability: s.w, probability_of_goal: null, status: 'computed',
      outcome: { mean: s.mean, std: s.std, p10: s.p10, p50: s.p50, p90: s.p90, n_samples: 10_000, n_valid_samples: 10_000, validity_ratio: 1, percentiles_source: 'samples' },
    };
  });
}

/** PLoT double: the baseline is `baseline`; a body missing `removed` answers `candidate`. */
function plotDouble(removed: { from_id: string; to_id: string }, candidate: Shape, baseline: Shape = 'served') {
  const runBodies: Rec[] = [];
  const client = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      runBodies.push(structuredClone(body));
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      const seedUsed = body.seed !== undefined ? String(body.seed) : derived;
      const response = structuredClone(happy) as Rec;
      response.option_comparison = rowsOf(hasLink(body.graph as Rec, removed) ? baseline : candidate, body.options as Rec[]);
      response.option_comparison_status = 'computed';
      response.results = (response.option_comparison as Rec[]).map((r) => ({ option_id: r.option_id, option_label: r.option_label, win_probability: r.win_probability }));
      response.fact_objects = [];
      response.review_cards = [];
      response.meta = { ...(response.meta as Rec), seed_used: seedUsed, n_samples: 10_000 };
      response._meta = { builds: { plot: 'p1', isl: 'i1' } };
      response.identity_evaluations = [];
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  return { client, runBodies };
}

function context(turnId: string, priorFacts: Rec[]) {
  return {
    stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
    messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
    request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: priorFacts, scenarioBriefText: null, persistedGraph: null,
  };
}
const payloadOf = (turnId: string) =>
  makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'test without this link', turn_class: 'decide', stage: 'analyse' });

function canonicalStore(facts: Rec[]) {
  const store = createNoopSessionStore({
    facts: facts as never,
    factsWithTurn: facts.map((fact, i) => ({ fact, fact_row_id: `run-row-${i}`, fact_created_at: fact.result.computed_at, turn_id: `turn-row-${i}` })) as never,
    scenarioAnalysisFacts: facts as never,
  });
  store.readAnalysisInvalidatedAt = vi.fn(async () => null);
  return store;
}

async function harness(link: { from_id: string; to_id: string }, candidate: Shape, baseline: Shape = 'served') {
  currentnessStore.current = undefined;
  const graph = structuredClone(servedGraph);
  const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }));
  const plot = plotDouble(link, candidate, baseline);
  const handler = resolveHandler(createRegistry({ plotClient: plot.client, scenarioReader: reader, counterfactualClient: null }), 'run_analysis')!;
  const a = await runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
    () => handler({ context: context('turn-a', []), payload: payloadOf('turn-a'), requestId: 'turn-a', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation));
  const runA = a.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  expect(runA, 'Run A commits one Run fact').toBeDefined();
  const ask = (selected: { from_id: string; to_id: string }) => {
    turnContext.current = context('turn-q', [runA]);
    currentnessStore.current ??= canonicalStore([runA]);
    return dispatchStructuralChallenge({
      payload: payloadOf('turn-q'), requestId: 'turn-q', link: selected, origin: 'user_selected',
      turnMayNameLeader: true, exploratoryWorkAllowed: true, plotClient: plot.client, scenarioReader: reader,
    });
  };
  const turn = await structuralChallengeTurnFor(structuralChallengePressId(link), ask);
  expect(turn, 'the press yields a turn').not.toBeNull();
  return { runA, plot, turn: turn! };
}

const leaderClaim = (result: Rec | null) => (result?.claims as Rec[] | undefined)?.find((c) => c.kind === 'leader');

afterEach(() => { currentnessStore.current = undefined; turnContext.current = null; forceCandidateWithheld.on = false; });

describe('SCI-DEEP: the candidate is licensed on the baseline admission and its own result', () => {
  it('precondition: the served graph gives Run A a licensed leader, AI Reporting Module Sprint', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.runA.result.leading_option_id).toBe(LEADER);
    expect(h.plot.runBodies).toHaveLength(2); // Run A + the one candidate
    expect(hasLink(h.plot.runBodies[1].graph, LEAD_LINK)).toBe(false);
  });

  it('R1 (fa027cf5, RED-first): removing the link every option needs gives the identical-arms disclosure, not "cannot be compared"', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.result?.status).toBe('completed');
    StructuralChallengeResultV1Schema.parse(h.turn.result);
    const reply = h.turn.reply;
    expect(reply).not.toContain('Which option leads cannot be compared');
    expect(reply).toContain('Without the link from Enterprise prospect signing likelihood to Quarterly revenue, your options all come out the same');
    expect(reply).toContain('AI Reporting Module Sprint’s lead rests entirely on this link');
    // Never a named candidate leader: the typed claim names the baseline leader only.
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.identicalArms).toBe(true);
  });

  it('R1b: a WITHHELD candidate licence with identical arms still names the baseline leader, never a candidate one', async () => {
    forceCandidateWithheld.on = true;
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.candidateLeaderLicence).toBe('withheld');
    expect(h.turn.identicalArms).toBe(true);
    expect(h.turn.reply).toContain('AI Reporting Module Sprint’s lead rests entirely on this link');
    expect(h.turn.reply).not.toContain('Which option leads cannot be compared');
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
  });

  it('R2 (contrast, RED-first for the licence): removing a link that leaves the arms distinct compares leaders and never says "rests entirely"', async () => {
    const h = await harness(OTHER_LINK, 'distinct');
    expect(h.turn.result?.status).toBe('completed');
    const reply = h.turn.reply;
    expect(reply).not.toContain('rests entirely');
    expect(reply).not.toContain('come out the same');
    expect(reply).not.toContain('Which option leads cannot be compared');
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: LEADER, verdict: 'holds', basis: 'leader_same' });
    // The headline never contradicts a licensed lead that holds.
    expect(reply.split('\n')[0]).toBe('Without the link from Revenue lost to trial abandonment to Quarterly revenue, AI Reporting Module Sprint still leads. The other figures don\'t establish a conclusion either way.');
    expect(h.turn.identicalArms).toBe(false);
  });

  it('R3: arms identical in BOTH versions never say the lead rests on the link', async () => {
    const h = await harness(LEAD_LINK, 'same', 'same');
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.reply).not.toContain('come out the same');
    expect(h.turn.identicalArms).toBe(false);
  });

  it('R4: arms that differ by 1e-9 relative are not identical (tolerance contrast)', async () => {
    const h = await harness(LEAD_LINK, 'near_same');
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.identicalArms).toBe(false);
  });

  it('R5: model-scale amounts keep significant figures; never "0" for 0.0213 and never "-0"', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.reply).toContain('AI Reporting Module Sprint\'s expected result is 0.0213 now and -0.0031 without the link');
    expect(h.turn.reply).not.toMatch(/\b-0\b(?!\.)/);
    expect(h.turn.reply).not.toMatch(/expected result is 0 now/);
  });

  it('R6: a target frequency unavailable in both versions is said once', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.reply).not.toContain('The target frequency was unavailable');
    expect(h.turn.reply.match(/isn't available in either version/g)).toHaveLength(1);
  });
});

describe('formatChallengeAmount', () => {
  it.each([
    [0.02134743573525561, '0.0213'], [-0.0031, '-0.0031'], [-0, '0'], [0, '0'], [-1e-20, '-0.00000000000000000001'],
    [83433.86, '83,434'], [106250, '106,250'], [99.96, '100'], [-250.4, '-250'], [1.5, '1.5'],
  ])('%s → %s', (x, expected) => {
    expect(formatChallengeAmount(x)).toBe(expected);
  });
});
