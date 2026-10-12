/**
 * ⭐ E5 (Paul's manual test, 12 Oct 2026, scenario 4184e877, turn 8e6f256f): the hiring times he stated per option become
 * the option's capacity parts — "two developers" is TWO starts, summed, never averaged — with each figure's origin kept.
 * Local only: no database, network or language model. Hand figures are worked in the comments.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withEventShareDate } from '../event-by-date-model.js';
import { applyTeamShareEdit } from '../team-share-write.js';
import { floorGraphSigmaForCompute } from '../../../validators/numeric-bounds.js';
import { COMPUTE_SIGMA_FLOOR } from '../../../cee/constants.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GOAL_CHANCE_RANGE } from '../goal-chance-range.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';
import { shareByDateGoalOf } from '../goal-kind.js';
import { exactChance, normalChance, gate, extraShareMoments, MULTI_PART_STEPS, type ShareParts } from '../event-by-date-share.js';
import { sharePartsForOption, shareGateForOption, shareChanceInputFailure } from '../share-by-date-run.js';
import { capacityPartsOf, hiringTimesHeld, olumiEstimateOf, planStarts, quoteStatedFor, readHiringStart, withHiringTimes,
  type ApprovedHiringTimes, type PlannedOption } from '../hiring-times.js';

type Rec = Record<string, any>;
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
/** Paul's turn 8e6f256f, verbatim (v5_conversation_turns, read-only, 12 Oct). */
const PAUL = "What hiring estimate would you give for a tech lead versus two developers? I would think, but I'm not sure, that a tech lead would take at least 3 months to get in the door. With two developers, we might be able to get one in within 2 months and then another a month or so later, as an estimate to use.";
const DATE = '2027-04-12', REF = '2026-10-12', UNIT = '% of next feature launch';
/** Paul's stored estimates: Tech lead 2–4 months at 12% a month; two developers 2–4 months at 20% a month. */
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'next feature launch', operator: '>=',
    unit: UNIT, value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null,
    horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
} as never);
const plainGraph = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
/** The register route's own ingress (identity-preserving: a point start's std 0 is stored as 0, floored only for compute). */
const stored = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(g) as never), { nodes: [], edges: [] }).graph as Rec;
/** Drafted, dated, and the current team's time held as a range, so the share goal is recognised (as served after E2). */
function paulsModel(): Rec {
  const a = admitCandidateModel(candidate(), {}, BRIEF);
  const dated = plainGraph(withEventShareDate(plainGraph({ nodes: a.nodes, edges: a.edges }), DATE, REF));
  const written = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 6, high_months: 10,
    deadline: DATE, reference_date: REF } as never, computeAnalysisAffectingGraphHash(dated as never)!);
  if (written.kind !== 'mutated') throw new Error(`team time not written: ${JSON.stringify(written)}`);
  return plainGraph(written.mutatedGraph);
}
const TECH = 'event_option_1', DEVS = 'event_option_2', CARRY = 'event_option_3';
const labelOf = (g: Rec, id: string): string => g.nodes.find((n: Rec) => n.id === id).label;

function plan(g: Rec, id: string, quotes: string[]): PlannedOption {
  const held = capacityPartsOf(g, id, 'event_goal'), estimate = olumiEstimateOf(held)!;
  const p = planStarts(quotes, estimate, held.length);
  if (!('parts' in p)) throw new Error(JSON.stringify(p));
  return { option_id: id, label: labelOf(g, id), part_ids: held.map(n => n.id), expected: held.map(n => n.observed_state.extra_share_by_date),
    olumi_estimate: estimate, parts: p.parts, quotes };
}
const approvedFor = (g: Rec, options: PlannedOption[]): ApprovedHiringTimes => ({ goal_id: 'event_goal', deadline: DATE, reference_date: REF, options });
const paulsApproval = (g: Rec): ApprovedHiringTimes => approvedFor(g, [
  plan(g, TECH, ['at least 3 months']), plan(g, DEVS, ['within 2 months', 'another a month or so later'])]);

describe('the sum of an option\'s parts (DL ruling 1: means add; independent uniform leads, so variances add)', () => {
  // Team: 15 months to finish, a point → share 6/15 = 0.4 by D = 6. Part A: 10% a month, lead U[2,4] → 0.1·(6−L) ∈ U[0.2, 0.4].
  // Part B: 10% a month, lead U[3,5] → U[0.1, 0.3]. S = 0.3 + 0.2·(U1+U2). Goal 100%: S ≥ 0.6 ⟺ U1+U2 ≥ 1.5 ⟺ (2−1.5)²/2 = 0.125.
  const HAND: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 15, high: 15 },
    extra: { monthlyShare: 0.1, D: 6, leadLow: 2, leadHigh: 4 }, furtherExtras: [{ monthlyShare: 0.1, D: 6, leadLow: 3, leadHigh: 5 }] };
  it('exact: 0.125 by hand, within the nested midpoint bound 2/N', () => {
    expect(Math.abs(exactChance(HAND, 1) - 0.125)).toBeLessThanOrEqual(2 / MULTI_PART_STEPS);
    expect(2 / MULTI_PART_STEPS * 100).toBeLessThan(0.05);
  });
  it('normal: mean 0.4 + 0.3 + 0.2 = 0.9; variance 0.04/12 + 0.04/12 + 0.01²·0.4² = 0.00668267; tail at z = 1.22328 is 0.1106124', () => {
    expect(extraShareMoments(0.1, 6, 2, 4).mean).toBeCloseTo(0.3, 12);
    expect(extraShareMoments(0.1, 6, 3, 5).mean).toBeCloseTo(0.2, 12);
    expect(normalChance(HAND, 1)).toBeCloseTo(0.1106124, 6);
  });
  it('two starts are kept, never averaged: past the deadline the later start adds nothing, an averaged one would', () => {
    // D = 2.5: starts at 2 and 3 → 0.1·0.5 + 0 = 0.05; one averaged start at 2.5 with 20% → 0.
    const team = { quantity: 'months_to_finish', D: 2.5, low: 5, high: 5 } as const; // 0.5
    const two: ShareParts = { team, extra: { monthlyShare: 0.1, D: 2.5, leadLow: 2, leadHigh: 2 }, furtherExtras: [{ monthlyShare: 0.1, D: 2.5, leadLow: 3, leadHigh: 3 }] };
    const averaged: ShareParts = { team, extra: { monthlyShare: 0.2, D: 2.5, leadLow: 2.5, leadHigh: 2.5 } };
    expect(exactChance(two, 0.55)).toBe(1);
    expect(exactChance(averaged, 0.55)).toBe(0);
  });
  it('a single part is byte-unchanged (literals from be084b06, Object.is)', () => {
    const CARRY_ON: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6, high: 10 } };
    const HIRE: ShareParts = { ...CARRY_ON, extra: { monthlyShare: 0.1, D: 6, leadLow: 3, leadHigh: 5 } };
    const PAULS_RANGE: ShareParts = { ...CARRY_ON, extra: { monthlyShare: 0.12, D: 6, leadLow: 2, leadHigh: 4 } };
    expect(exactChance(CARRY_ON, 1)).toBe(0);
    expect(normalChance(CARRY_ON, 1)).toBe(0.019935635165899572);
    expect(exactChance(HIRE, 1)).toBe(0.3848582120692513);
    expect(normalChance(HIRE, 1)).toBe(0.3956324999276054);
    expect(exactChance(PAULS_RANGE, 1)).toBe(0.8107631963832631);
    expect(normalChance(PAULS_RANGE, 1)).toBe(0.8283924258331166);
    expect(exactChance({ team: { quantity: 'months_to_finish', D: 6, low: 8, high: 8 }, extra: { monthlyShare: 0.12, D: 6, leadLow: 2, leadHigh: 4 } }, 1)).toBe(0.95831298828125);
  });
  it('more than two start ranges in one option is unsupported, never a guessed point', () => {
    const r = { monthlyShare: 0.1, D: 6, leadLow: 2, leadHigh: 4 };
    expect(() => exactChance({ team: { quantity: 'months_to_finish', D: 6, low: 6, high: 10 }, extra: r, furtherExtras: [r, r] }, 1)).toThrow(RangeError);
  });
});

describe('Paul\'s sentence → each start, with whose figure it is (AIE S8 rule set)', () => {
  it.each([
    ['at least 3 months', { kind: 'at_least', months: 3 }],
    ['within 2 months', { kind: 'within', months: 2 }],
    ['another a month or so later', { kind: 'after_previous', months: 1 }],
    ['about 4 months', { kind: 'about', months: 4 }],
    ['3-5 months', { kind: 'range', low: 3, high: 5 }],
    ['in two months', { kind: 'about', months: 2 }],
  ] as const)('%s', (quote, form) => expect(readHiringStart(quote)).toEqual(form));
  it.each(['soon', 'at least 3 months, within 5 months', 'a while', '3 months then 5 months'])('unreadable: %s', q => expect(readHiringStart(q)).toBeNull());

  it('the quote must be his, in this message, in a sentence naming that option', () => {
    expect(quoteStatedFor(PAUL, 'at least 3 months', 'Hire a Tech lead')).toBe('ok');
    expect(quoteStatedFor(PAUL, 'within 2 months', 'Hire two developers')).toBe('ok');
    expect(quoteStatedFor(PAUL, 'another a month or so later', 'Hire two developers')).toBe('ok');
    // ⛔ Attribution: his Tech-lead figure is never the developers', nor the reverse.
    expect(quoteStatedFor(PAUL, 'at least 3 months', 'Hire two developers')).toBe('not_for_option');
    expect(quoteStatedFor(PAUL, 'within 2 months', 'Hire a Tech lead')).toBe('not_for_option');
    expect(quoteStatedFor(PAUL, 'at least 4 months', 'Hire a Tech lead')).toBe('not_stated');
  });

  it('Tech lead: soonest 3 is his; latest 4 stays Olumi\'s; the pace stays Olumi\'s 12%', () => {
    const g = paulsModel();
    expect(plan(g, TECH, ['at least 3 months']).parts).toEqual([{
      lead_low: { value: 3, origin: 'user', quote: 'at least 3 months' }, lead_high: { value: 4, origin: 'olumi' },
      monthly_share: { value: 12, origin: 'olumi' } }]);
  });
  it('two developers: two starts, 2 then 3 months; the pace is Olumi\'s 20% split 10% + 10%', () => {
    const g = paulsModel();
    expect(plan(g, DEVS, ['within 2 months', 'another a month or so later']).parts).toEqual([
      { lead_low: { value: 2, origin: 'olumi' }, lead_high: { value: 2, origin: 'user', quote: 'within 2 months' }, monthly_share: { value: 10, origin: 'olumi' } },
      { lead_low: { value: 3, origin: 'olumi' }, lead_high: { value: 3, origin: 'user', quote: 'another a month or so later' }, monthly_share: { value: 10, origin: 'olumi' } },
    ]);
  });
  it('"within N" keeps min(Olumi\'s soonest, N) as Olumi\'s, never forced to N', () => {
    const p = planStarts(['within 3 months'], { lead_low: 2, lead_high: 4, monthly_share: 20 }, 1);
    expect('parts' in p && p.parts[0]!.lead_low).toEqual({ value: 2, origin: 'olumi' });
  });
  it('refusals: "at least N" past Olumi\'s latest; a first start stated as "later"; three starts; fewer starts than held', () => {
    const est = { lead_low: 2, lead_high: 4, monthly_share: 20 };
    expect(planStarts(['at least 5 months'], est, 1)).toEqual({ refusal: 'least_beyond_latest', quote: 'at least 5 months', months: 5, latest: 4 });
    expect(planStarts(['another a month later'], est, 1)).toEqual({ refusal: 'first_start_relative', quote: 'another a month later' });
    expect(planStarts(['in 2 months', 'in 3 months', 'in 4 months'], est, 1)).toEqual({ refusal: 'too_many_starts' });
    expect(planStarts(['in 2 months'], est, 2)).toEqual({ refusal: 'fewer_starts_than_held' });
    // PL AMEND 6121889192: a start said relative to a RANGE would be a dependent draw, never an independent part.
    expect(planStarts(['in 2-3 months', 'another a month later'], est, 1)).toEqual({ refusal: 'relative_to_range', quote: 'another a month later' });
    expect('parts' in planStarts(['in 2 months', 'another a month later'], est, 1)).toBe(true);
  });
});

describe('written into the model: the second start is its own part; every option keeps its chance (goal-kind lease)', () => {
  it('RED before E5: a two-hire option made the WHOLE share goal disappear; now every option is recognised and sized', () => {
    const g = paulsModel(), after = stored(withHiringTimes(g, paulsApproval(g)));
    expect(shareByDateGoalOf(after)?.team_part_id).toBe('event_team');
    expect(hiringTimesHeld(after, paulsApproval(g))).toBe(true);
    // Each option's parts, by identity: the developers' two starts are kept apart (2 and 3 months), each at 10% a month.
    expect(sharePartsForOption(after, DEVS)).toMatchObject({ extra: { monthlyShare: 0.1, leadLow: 2, leadHigh: 2 },
      furtherExtras: [{ monthlyShare: 0.1, leadLow: 3, leadHigh: 3 }] });
    expect(sharePartsForOption(after, TECH)).toMatchObject({ extra: { monthlyShare: 0.12, leadLow: 3, leadHigh: 4 } });
    expect(sharePartsForOption(after, TECH)?.furtherExtras).toBeUndefined();
    expect(sharePartsForOption(after, CARRY)?.extra).toBeUndefined();
    for (const id of [TECH, DEVS, CARRY]) expect(shareGateForOption(after, id), id).not.toBeNull();
  });
  it('the added start is a part of the developers\' option only, with the construction\'s link shapes', () => {
    const g = paulsModel(), after = withHiringTimes(g, paulsApproval(g)) as Rec;
    const second = after.nodes.find((n: Rec) => n.id === 'event_capacity_2_start_2');
    expect(second).toMatchObject({ kind: 'factor', category: 'controllable', observed_state: { value: 0,
      extra_share_by_date: { lead_low: 3, lead_high: 3, monthly_share: 10, deadline: DATE, reference_date: REF,
        olumi_estimate: { lead_low: 2, lead_high: 4, monthly_share: 20 } } } });
    const opts = after.nodes.filter((n: Rec) => n.kind === 'option');
    expect(Object.fromEntries(opts.map((o: Rec) => [o.id, o.interventions.event_capacity_2_start_2]))).toEqual({
      [TECH]: { value: 0 }, [DEVS]: { value: 1 }, [CARRY]: { value: 0 } });
    const m = extraShareMoments(0.1, 6, 3, 3);
    expect(after.edges.find((e: Rec) => e.from === second.id && e.to === 'event_goal')).toMatchObject({
      exists_probability: 1, effect_direction: 'positive', strength: { mean: m.mean, std: m.sd } });
    expect(after.edges.find((e: Rec) => e.from === second.id && e.to === 'event_goal').defaulted).toBeUndefined();
    // ⛔ Nothing else moves: the team part and the Tech lead's construction link keep their bytes apart from its own carrier.
    expect(after.nodes.find((n: Rec) => n.id === 'event_team')).toEqual(g.nodes.find((n: Rec) => n.id === 'event_team'));
  });
  it('a part that fails its own checks withholds only its own option, with the reason', () => {
    const g = paulsModel(), after = stored(withHiringTimes(g, paulsApproval(g)));
    after.nodes.find((n: Rec) => n.id === 'event_capacity_2_start_2').observed_state.extra_share_by_date.lead_low = -1;
    expect(shareChanceInputFailure(after, DEVS)).toMatch(/hiring-time range is not usable/);
    expect(sharePartsForOption(after, DEVS)).toBeNull();
    expect(shareGateForOption(after, TECH)).not.toBeNull();
    expect(shareGateForOption(after, CARRY)).not.toBeNull();
  });
  it('the developers\' chance sums both starts (hand: 0.1·(6−2) + 0.1·(6−3) = 0.7 added share, both points)', () => {
    const g = paulsModel(), after = stored(withHiringTimes(g, paulsApproval(g)));
    const parts = sharePartsForOption(after, DEVS)!, D = parts.extra!.D;
    expect(D).toBe(6);
    const one = { ...parts, furtherExtras: undefined };
    expect(gate(parts, 1)).not.toEqual(gate(one, 1));
    expect(exactChance(parts, 1)).toBeCloseTo(exactChance({ team: parts.team }, 1 - 0.7), 12);
  });
});

describe('a start given as one figure has no spread: the recogniser applies the SAME floor the Run computes with', () => {
  const SCENARIO = 'eeeeeeee-5555-4eee-8eee-eeeeeeeeeeee';
  const paulsAfter = (): Rec => { const g = paulsModel(); return stored(withHiringTimes(g, paulsApproval(g))); };
  const devsLink = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === 'event_capacity_2' && e.to === 'event_goal');
  it('stored std 0 and the compute graph\'s floored std are the same part: recognised on both', () => {
    const after = paulsAfter();
    expect(devsLink(after).strength.std).toBe(0);
    const floored = floorGraphSigmaForCompute(after).graph as Rec;
    expect(devsLink(floored).strength.std).toBe(COMPUTE_SIGMA_FLOOR);
    expect(shareByDateGoalOf(after)?.team_part_id).toBe('event_team');
    expect(shareByDateGoalOf(floored)?.team_part_id).toBe('event_team');
  });
  it('control: a spread that matches neither its moments nor the floor is still refused', () => {
    const after = paulsAfter();
    devsLink(after).strength.std = 0.01;
    expect(shareByDateGoalOf(after)).toBeNull();
  });
  it('Run: the real snapshot loader floors the spread, and the share gate still decides each option', async () => {
    const after = paulsAfter();
    const store = { readMostRecentPendingActions: async () => [], loadGraph: async () => structuredClone(after),
      loadGraphAndBriefText: async () => ({ graph: structuredClone(after), briefText: null }) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-e5-load', store as never);
    expect(devsLink(snapshot.graph as Rec).strength.std).toBe(COMPUTE_SIGMA_FLOOR);
    // The engine's points, as ISL would give them: each option's normal tail over its own summed parts.
    const ids = [TECH, DEVS, CARRY], point = Object.fromEntries(ids.map(id => [id, normalChance(sharePartsForOption(after, id)!, 1)]));
    const golden = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
    golden.results = ids.map(id => ({ ...golden.results[0], option_id: id, option_label: labelOf(after, id), probability_of_goal: point[id] }));
    const run = vi.fn(async () => structuredClone(golden));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn(async () => ({})) } as never,
      scenarioReader: vi.fn(async () => snapshot) });
    const outcome = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'req-e5', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-e5', signal: new AbortController().signal, orientationText: '',
    } as never);
    expect(run).toHaveBeenCalledOnce();
    const result = (outcome.handler_facts.find(f => f.fact_type === 'run_analysis') as unknown as Rec).result;
    // ⛔ Without the floor clause this Run says, for EVERY option, "Olumi can compare your options, but can't yet test them
    // against your target" (GOAL_FIGURES_TARGET_NOT_TESTABLE ×3, measured). With it the share gate decides each option on
    // the floored graph: the Tech lead's 3–4 month range is shown as a range, by identity.
    const warnings = result.enrichment.inference_warnings as Rec[];
    expect(warnings.filter(w => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toEqual([]);
    expect(warnings.find(w => w.code === GOAL_CHANCE_RANGE)?.option_ids).toEqual([TECH]);
  });
});
