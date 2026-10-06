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
 *   (3) an outcome level is never printed as a unitless model-scale number (DL beat-4 audit): the line says its direction;
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
import { runArmsDistinct, runArmsIdentical } from '../../coaching/structural-challenge-compare.js';
import { composeStructuralChallengeReply, structuralChallengePressId, structuralChallengeTurnFor } from '../../agent-lane/method-turn/structural-challenge-turn.js';

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

/** same_unequal: identical outcomes but the served (unequal) win shares. served_no_nvalid: no valid-draw counts. */
type Shape = 'served' | 'same' | 'distinct' | 'near_same' | 'same_unequal' | 'served_no_nvalid' | 'pair_same' | 'distinct_change' | 'served_pair' | 'served_pair_int_no_nvalid' | 'served_pair_untrusted';
/** SYNTHETIC pair_same (revenue-lost link removed): Integration ≡ Carry On — both leave AI capacity at today's 0% —
 *  so their wins split; AI Reporting Module Sprint distinct with the larger single share. */
const PAIR: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.4, mean: 0.016, std: 0.05, p10: -0.045, p50: 0.014, p90: 0.085 },
  integration_bug_fix_sprint: { w: 0.3, mean: 0.012, std: 0.05, p10: -0.05, p50: 0.01, p90: 0.08 },
  continue_current_plan: { w: 0.3, mean: 0.012, std: 0.05, p10: -0.05, p50: 0.01, p90: 0.08 },
};
/** SYNTHETIC served_pair (the served beat-4 link removed): AI Reporting Module Sprint ≡ Carry On — both leave
 *  integration capacity at today's 0% — while Integration Bug Fix Sprint still differs through the other path. */
const SERVED_PAIR: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.3, ...SAME },
  continue_current_plan: { w: 0.3, ...SAME },
  integration_bug_fix_sprint: { w: 0.4, mean: -0.0012, std: 0.0415, p10: -0.054, p50: -0.002, p90: 0.051 },
};
/** SYNTHETIC distinct_change: every arm distinct; Integration Bug Fix Sprint clearly leads. */
const CHANGE: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.25, mean: 0.012, std: 0.05, p10: -0.05, p50: 0.01, p90: 0.08 },
  integration_bug_fix_sprint: { w: 0.6, mean: 0.02, std: 0.05, p10: -0.04, p50: 0.018, p90: 0.09 },
  continue_current_plan: { w: 0.15, mean: 0.009, std: 0.05, p10: -0.052, p50: 0.006, p90: 0.075 },
};
function rowsOf(shape: Shape, options: Rec[]): Rec[] {
  const ids = options.map((o) => String(o.option_id ?? o.id));
  return options.map((o, i) => {
    const id = ids[i];
    const s: Stats = shape === 'served' || shape === 'served_no_nvalid' ? SERVED[id] ?? { w: 0, mean: 0.01, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
      : shape === 'same_unequal' ? { ...SAME, w: SERVED[id]?.w ?? 0 }
      : shape === 'pair_same' ? PAIR[id] ?? { w: 0, mean: 0.009, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
      : shape === 'served_pair' || shape === 'served_pair_int_no_nvalid' || shape === 'served_pair_untrusted' ? SERVED_PAIR[id] ?? { w: 0, mean: 0.0005, std: 0.04, p10: -0.05, p50: 0.0001, p90: 0.05 }
      : shape === 'distinct_change' ? CHANGE[id] ?? { w: 0, mean: 0.008, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
      : shape === 'distinct' ? DISTINCT[id] ?? { w: 0, mean: 0.009, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 }
        // near_same: one arm differs by 1e-9 relative in its mean only (a contrast for the 1e-12 tolerance).
        : { ...SAME, w: 1 / ids.length, ...(shape === 'near_same' && i === 0 ? { mean: SAME.mean * (1 + 1e-9) } : {}) };
    return {
      option_id: id, option_label: o.label, win_probability: s.w, probability_of_goal: null, status: 'computed',
      outcome: { mean: s.mean, std: s.std, p10: s.p10, p50: s.p50, p90: s.p90, n_samples: 10_000,
        ...(shape === 'served_no_nvalid' || (shape === 'served_pair_int_no_nvalid' && id === 'integration_bug_fix_sprint')
          || (shape === 'served_pair_untrusted' && id !== 'integration_bug_fix_sprint') ? {} : { n_valid_samples: 10_000 }),
        validity_ratio: 1, percentiles_source: 'samples' },
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
  let dispatched: Awaited<ReturnType<typeof dispatchStructuralChallenge>> | undefined;
  const ask = async (selected: { from_id: string; to_id: string }) => {
    turnContext.current = context('turn-q', [runA]);
    currentnessStore.current ??= canonicalStore([runA]);
    dispatched = await dispatchStructuralChallenge({
      payload: payloadOf('turn-q'), requestId: 'turn-q', link: selected, origin: 'user_selected',
      turnMayNameLeader: true, exploratoryWorkAllowed: true, plotClient: plot.client, scenarioReader: reader,
    });
    return dispatched;
  };
  const turn = await structuralChallengeTurnFor(structuralChallengePressId(link), ask);
  expect(turn, 'the press yields a turn').not.toBeNull();
  return { runA, plot, turn: turn!, dispatched: dispatched! };
}

const leaderClaim = (result: Rec | null) => (result?.claims as Rec[] | undefined)?.find((c) => c.kind === 'leader');

afterEach(() => { currentnessStore.current = undefined; turnContext.current = null; forceCandidateWithheld.on = false; });

describe('SCI-DEEP: the candidate is licensed on the baseline admission and its own result', () => {
  it('precondition: the served graph gives Run A a licensed leader, AI Reporting Module Sprint', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.runA.result.leading_option_id).toBe(LEADER);
    // Licensed by the CANONICAL read the dispatch consumed, not merely stored.
    expect(h.dispatched.kind === 'result' && h.dispatched.finalRead?.currentness?.permissions?.leader_may_be_named).toBe(true);
    expect(h.plot.runBodies).toHaveLength(2); // Run A + the one candidate
    expect(hasLink(h.plot.runBodies[1].graph, LEAD_LINK)).toBe(false);
  });

  it('R1 (fa027cf5, RED-first): removing the link every option needs gives the identical-arms disclosure, not "cannot be compared"', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.result?.status).toBe('completed');
    StructuralChallengeResultV1Schema.parse(h.turn.result);
    const reply = h.turn.reply;
    expect(reply).not.toContain('Which option most runs support cannot be compared');
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
    expect(h.turn.reply).not.toContain('Which option most runs support cannot be compared');
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
  });

  it('R2 (contrast, RED-first for the licence): removing a link that leaves the arms distinct compares leaders and never says "rests entirely"', async () => {
    const h = await harness(OTHER_LINK, 'distinct');
    expect(h.turn.result?.status).toBe('completed');
    const reply = h.turn.reply;
    expect(reply).not.toContain('rests entirely');
    expect(reply).not.toContain('come out the same');
    expect(reply).not.toContain('Which option most runs support cannot be compared');
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: LEADER, verdict: 'holds', basis: 'leader_same' });
    // The headline never contradicts a licensed lead that holds.
    expect(reply.split('\n')[0]).toBe('Without the link from Revenue lost to trial abandonment to Quarterly revenue, AI Reporting Module Sprint still leads. The other figures don\'t establish a conclusion either way.');
    expect(h.turn.identicalArms).toBe(false);
  });

  it('R3: arms identical in BOTH versions never say the lead rests on the link', async () => {
    const h = await harness(LEAD_LINK, 'same', 'same');
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.reply).not.toContain('your options all come out the same');
    expect(h.turn.identicalArms).toBe(false);
    // Still true and disclosed: without the link they come out the same, so no candidate leader is compared.
    expect(h.turn.reply).toContain('come out the same, so which option most runs support isn\'t compared for that version.');
  });

  it('R4: arms that differ by 1e-9 relative are not identical (tolerance contrast)', async () => {
    const h = await harness(LEAD_LINK, 'near_same');
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.identicalArms).toBe(false);
  });

  it('R5 (DL beat-4 audit): an outcome level is never a unitless model-scale number; the line says its direction', async () => {
    const h = await harness(LEAD_LINK, 'same');
    // Served 0.0213 → SAME -0.0031: lower without the link (fa027cf5 has no target, so no target clause).
    expect(h.turn.reply).toContain('AI Reporting Module Sprint\'s expected result is lower without the link.');
    expect(h.turn.reply).not.toContain('0.0213');
    expect(h.turn.reply).not.toMatch(/expected result is -?\d/);
    expect(h.turn.reply).not.toMatch(/\b-0\b(?!\.)/);
    // With the number gone, "The figures can be compared, but no supported conclusion boundary is available" would refer
    // to figures the reply no longer shows (Acceptance beat-4 witness 10:10Z: once per option).
    expect(h.turn.reply).not.toContain('no supported conclusion boundary');
  });

  it('R6: a target frequency unavailable in both versions is said once', async () => {
    const h = await harness(LEAD_LINK, 'same');
    expect(h.turn.reply).not.toContain('The target frequency was unavailable');
    expect(h.turn.reply.match(/isn't available in either version/g)).toHaveLength(1);
  });
});

describe('SCI-DEEP: Codex review 1 findings (a690458b)', () => {
  it('C1 (P1): identical outcomes with UNEQUAL win shares never name a candidate leader', async () => {
    const h = await harness(LEAD_LINK, 'same_unequal');
    expect(h.turn.identicalArms).toBe(true);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.reply).toContain('AI Reporting Module Sprint’s lead rests entirely on this link');
    expect(h.turn.reply).not.toContain('leads in both versions');
  });

  it('C2 (P1): an arm that is not computed (status skipped) never establishes identity; a computed copy does', async () => {
    const h = await harness(LEAD_LINK, 'same');
    const sameFact = structuredClone(h.runA);
    for (const row of sameFact.result.enrichment.option_comparison as Rec[]) Object.assign(row.outcome, { mean: 0.5, std: 0.1, p10: 0.4, p50: 0.5, p90: 0.6 });
    expect(runArmsIdentical(sameFact as never)).toBe(true); // control
    (sameFact.result.enrichment.option_comparison as Rec[])[1].status = 'skipped';
    expect(runArmsIdentical(sameFact as never)).toBe(false);
  });

  it('C3 (P1): a baseline without valid-draw counts is not affirmatively distinct, so no "rests entirely"', async () => {
    const control = await harness(LEAD_LINK, 'same');
    expect(runArmsDistinct(control.runA as never)).toBe(true); // control: the served rows differ
    const h = await harness(LEAD_LINK, 'same', 'served_no_nvalid');
    expect(runArmsDistinct(h.runA as never)).toBe(false);
    expect(h.turn.identicalArms).toBe(false);
    expect(h.turn.reply).not.toContain('rests entirely');
  });

  it('C4 (P2): a partial unavailability names whom it covers, never "each option"', async () => {
    const h = await harness(LEAD_LINK, 'same');
    const result = structuredClone(h.turn.result!) as Rec;
    const goal = (option_id: string, baseline: number | null, alternative: number | null) => ({ kind: 'goal_probability', option_id, constraint_id: null,
      baseline, alternative, target: null, constraint_boundary: null, invariant_by_construction: false,
      ...(baseline === null ? { noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'missing_on_one_side' }
        : { noise_verdict: 'signal', verdict: 'delta_only', basis: 'no_licensed_boundary' }) });
    result.claims = [...(result.claims as Rec[]).filter((c) => c.kind !== 'goal_probability'),
      goal('ai_reporting_module_sprint', null, null), goal('integration_bug_fix_sprint', null, null), goal('continue_current_plan', 0.5, 0.6)];
    const reply = composeStructuralChallengeReply({ result: result as never, labels: h.turn.labels });
    expect(reply).toContain('- How often AI Reporting Module Sprint and Integration Bug Fix Sprint reach the target isn\'t available in either version, so it isn\'t compared.');
    expect(reply).not.toContain('each option');
    expect(reply).toContain('Continue Current Plan — baseline: Reaches the target in about 50% of model runs.');
  });

  it('C5 (P2): stored certainty sentences are kept and the generic unavailable side is said once', async () => {
    const h = await harness(LEAD_LINK, 'same');
    const result = structuredClone(h.turn.result!) as Rec;
    const ids = ['ai_reporting_module_sprint', 'integration_bug_fix_sprint', 'continue_current_plan'];
    result.claims = [...(result.claims as Rec[]).filter((c) => c.kind !== 'goal_probability'), ...ids.map((option_id) => ({ kind: 'goal_probability', option_id,
      constraint_id: null, baseline: null, alternative: null, target: null, constraint_boundary: null, invariant_by_construction: false,
      noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side' }))];
    const certainty = { baseline: ids.map((option_id, i) => ({ option_id, probability_of_goal: null, earned: false, say: `Stored sentence ${i + 1}.` })), alternative: undefined };
    const reply = composeStructuralChallengeReply({ result: result as never, labels: h.turn.labels, certainty: certainty as never });
    expect(reply).not.toContain('The target frequency was unavailable');
    expect(reply.match(/isn't available in at least one version/g)).toHaveLength(1);
    expect(reply).toContain('- How often each option reaches the target isn\'t available in at least one version, so it isn\'t compared.');
    for (const [i, id] of ids.entries()) expect(reply).toContain(`- ${h.turn.labels.get(id)} — baseline: Stored sentence ${i + 1}.`);
  });
});

describe('SCI-DEEP: DL #2575 P1 — a PARTIAL identical group blocks the candidate leader', () => {
  it('R0 (served beat 4, RED-first): AI Reporting Module Sprint ≡ Carry On without the link → its edge over Carry On rests on the link', async () => {
    const h = await harness(LEAD_LINK, 'served_pair');
    expect(h.turn.result?.status).toBe('completed');
    expect(h.turn.identicalArms).toBe(false);
    expect(h.turn.identicalGroups).toEqual([['ai_reporting_module_sprint', 'continue_current_plan']]);
    expect(h.turn.leaderSameAs).toEqual(['continue_current_plan']);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.reply.split('\n')[0]).toBe('Without the link from Enterprise prospect signing likelihood to Quarterly revenue, AI Reporting Module Sprint comes out the same as Continue Current Plan, so its edge over it rests entirely on this link.');
    expect(h.turn.reply).toContain('- Without the link, AI Reporting Module Sprint and Continue Current Plan come out the same, so which option most runs support isn\'t compared for that version.');
    expect(h.turn.reply).not.toContain('Which option most runs support cannot be compared');
    expect(h.turn.reply).not.toContain('your options all come out the same');
  });

  it('D1 (RED before the fix): a pair WITHOUT the leader identical → no candidate leader, the pair disclosed, no "edge" claim', async () => {
    const h = await harness(OTHER_LINK, 'pair_same');
    expect(h.turn.result?.status).toBe('completed');
    expect(h.turn.identicalArms).toBe(false);
    expect(h.turn.identicalGroups).toEqual([['integration_bug_fix_sprint', 'continue_current_plan']]);
    expect(h.turn.leaderSameAs).toEqual([]);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.reply).not.toContain('leads in both versions');
    expect(h.turn.reply).not.toContain('leads in the version without the link');
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.reply).toContain('- Without the link, Integration Bug Fix Sprint and Continue Current Plan come out the same, so which option most runs support isn\'t compared for that version.');
    expect(h.turn.reply).not.toContain('Which option most runs support cannot be compared');
  });

  it('C6 (Codex review 3 P1): an unrelated arm without valid-draw counts never hides the pair', async () => {
    const h = await harness(LEAD_LINK, 'served_pair_int_no_nvalid');
    expect(h.turn.identicalGroups).toEqual([['ai_reporting_module_sprint', 'continue_current_plan']]);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.reply).not.toContain('leads in the version without the link');
    expect(h.turn.reply).toContain('- Without the link, AI Reporting Module Sprint and Continue Current Plan come out the same, so which option most runs support isn\'t compared for that version.');
  });

  it('C7 (Codex #2574 r3 P1): a pair without valid-draw counts still BLOCKS, but never earns "its edge rests entirely"', async () => {
    const h = await harness(LEAD_LINK, 'served_pair_untrusted');
    expect(h.turn.identicalGroups).toEqual([['ai_reporting_module_sprint', 'continue_current_plan']]);
    expect(h.turn.leaderSameAs).toEqual([]);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: null });
    expect(h.turn.reply).not.toContain('rests entirely');
    expect(h.turn.reply).not.toContain('leads in the version without the link');
    expect(h.turn.reply).toContain('- Without the link, AI Reporting Module Sprint and Continue Current Plan come out the same, so which option most runs support isn\'t compared for that version.');
  });

  it('D2 (contrast): every arm distinct → a clear leader change is still stated, and nothing is disclosed as the same', async () => {
    const h = await harness(OTHER_LINK, 'distinct_change');
    expect(h.turn.identicalGroups).toEqual([]);
    expect(leaderClaim(h.turn.result)).toMatchObject({ baseline_option_id: LEADER, alternative_option_id: 'integration_bug_fix_sprint', verdict: 'changes', basis: 'leader_changed' });
    expect(h.turn.reply).toContain('In the version without the link from Revenue lost to trial abandonment to Quarterly revenue, Integration Bug Fix Sprint leads');
    expect(h.turn.reply).not.toContain('come out the same');
  });
});

