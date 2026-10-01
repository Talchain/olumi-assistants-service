/**
 * ⭐ DECISION-REPRESENTATION row 4 — "not target-testable" is said BEFORE any Run, on the one carrier (PTL A #77
 * 5912737934; AIQ words #77 5912882031 + rules #75 5913502854; R3 P1–P6 #77 5912916965; P0 PARTNER row 9 5913561360).
 *
 * Paul's test (4276f3f9): "at least £1.2m" with no today's level. Readiness said `may_run: true` with the admission's
 * mode `quantified_provisional`, and the Runs then showed win shares ("Model 80%") and named no reason the target could
 * not be tested. The graphs here are his (as the export holds it) and two served constructions (constructor `f7c8c86a`,
 * 0-LLM replays): MRR, whose goal has today's level (the control), and N1, which has none.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { targetTestabilityOf, notTargetTestableSentence } from '../target-testability.js';
import { resolveAnalysisAdmission, analysisReadyPermitsLeaderNaming, permittedAnalysisModeFromAnalysisReady } from '../analysis-admission.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { agentLaneLeaderWithheld } from '../../agent-lane/withheld-leader-fail-closed.js';
import { claimPermissionsFrom } from '../../agent-lane/first-analysis.js';
import { readinessViewOf } from '../../agent-lane/readiness-view.js';
import { postWriteReadinessLine } from '../../../routes/agent-v1-turn.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { sizedByApproval } from '../../../cee/magnitude/link-sizing.js';
import { olumiGuessedGoalLink, olumiGuessedLink } from '../../../orchestrator/context/placeholder-parts.js';

type Json = Record<string, any>;
const RAW = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as { paul: Json; mrr: Json; n1: Json; cc: Json };
/** MRR after the identity card's Yes (#2292 makes the product the user's: `stated_in_brief: true`). */
const confirmed = (g: Json): Json => { const c = structuredClone(g); for (const n of c.nodes) if (n.kind === 'goal' && n.nonlinear_identity) n.nonlinear_identity.stated_in_brief = true; return c; };
/** Paul's graph after MODEL GENERATION's G6: his stated "£0 secured so far" is today's level (5913925033). */
const withToday = (g: Json): Json => { const c = structuredClone(g); for (const n of c.nodes) if (n.kind === 'goal') n.observed_state = { value: 0, baseline: 0, raw_value: 0, unit: '£', cap: n.goal_threshold_cap, source: 'user_stated' }; return c; };
/** An Olumi-sized link (an `olumi_*` magnitude or a plain `defaulted` size, R3 5914745577), made the user's own. */
const olumiSized = (e: Json): boolean => e.provenance?.source !== 'user_specified' && ((typeof e.provenance?.magnitude === 'string' && e.provenance.magnitude.startsWith('olumi_')) || e.defaulted === true);
const userSizedWhere = (g: Json, which: (e: Json) => boolean): Json => { const c = structuredClone(g); for (const e of c.edges) if (olumiSized(e) && which(e)) e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' }; return c; };
/** Every Olumi-sized link made the user's own size (as the user's answers to the one question would). */
const userSized = (g: Json): Json => userSizedWhere(g, () => true);
/** …and every link into the goal given a £ size per unit of its source (R3 5914500931's £-sized form). */
const poundsInto = (g: Json): Json => { const c = userSized(g); const goal = c.nodes.find((n: Json) => n.kind === 'goal'); for (const e of c.edges) if (e.to === goal.id) e.provenance = { ...(e.provenance ?? {}), source: 'user_specified', natural_effect: { amount: 50000, amount_unit: goal.goal_threshold_unit, per_source_change: 1, per_source_change_unit: 'unit' } }; return c; };
/** R3's control: the user's qualitative "strong" on every link into the goal — theirs, but unitless. */
const strongInto = (g: Json): Json => { const c = userSized(g); const goal = c.nodes.find((n: Json) => n.kind === 'goal').id; for (const e of c.edges) if (e.to === goal) { e.provenance = { source: 'user_specified' }; e.strength = { mean: 0.55, std: 0.1 }; } return c; };
const FIX = { paul: RAW.paul, n1: RAW.n1, cc: RAW.cc, mrr: userSized(confirmed(RAW.mrr)), mrrPreCard: RAW.mrr };
const reasonOf = (a: { reasons: readonly { field: string; code: string; message: string }[] }) => a.reasons.find((r) => r.field === 'permitted_analysis_mode')!;
/** An entitled, SEPARATED run: the population Paul's "caveat, not withhold" ruling permits under `quantified_provisional`. */
const separatedClaim = { leader_claim: { permitted: true, separation: 'separated' } };

describe('the verdict (0 LLM)', () => {
  it('Paul: no today\'s level (a) AND his goal is reached only through links nobody sized (c)', () => {
    expect(targetTestabilityOf(FIX.paul)).toEqual({ kind: 'not_testable', goal_id: 'securing_funding', failures: [
      { precondition: 'P1', case: 'a', code: 'missing_goal_baseline' },
      { precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'Investment firm meetings' },
    ] });
  });

  it('Paul: AIQ\'s words — the target in his terms, EVERY failing reason, then the first question there is', () => {
    expect(notTargetTestableSentence(FIX.paul, targetTestabilityOf(FIX.paul))).toBe(
      "Olumi can compare your options, but can't yet test them against your target (at least £1,200,000), because it needs today's level of securing funding and the model doesn't yet say how Investment firm meetings turns into securing funding. What is securing funding today?");
  });

  it('RED (MODEL GENERATION 5913996539): after G6 writes his £0, the target is STILL not testable — the £ path is missing', () => {
    const v = targetTestabilityOf(withToday(FIX.paul));
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.code)).toEqual(['goal_path_unsized']);
  });

  it('CONTROL: £0 today AND every link into the goal sized IN £ by the user → testable', () => {
    expect(targetTestabilityOf(poundsInto(withToday(FIX.paul)))).toEqual({ kind: 'testable', goal_id: 'securing_funding' });
  });

  it('RED (R3 5914500931): his "strong" on every link into the goal is his belief, but unitless → still (c)', () => {
    const v = targetTestabilityOf(strongInto(withToday(FIX.paul)));
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.code)).toEqual(['goal_path_unsized']);
  });

  it('N1: (a), (b) and (c) all named; the question is (a)\'s ((b) is never asked)', () => {
    const v = targetTestabilityOf(FIX.n1);
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.case)).toEqual(['a', 'b', 'c']);
    const said = notTargetTestableSentence(FIX.n1, v)!;
    expect(said).toContain("because it needs today's level of median first-response time, it can't yet test a '<");
    expect(said.endsWith('What is median first-response time today?')).toBe(true);
  });

  it('MRR before the identity card: an unconfirmed product → (c), and no second question (the card is the way on)', () => {
    const v = targetTestabilityOf(FIX.mrrPreCard);
    expect(v.kind === 'not_testable' && v.failures).toEqual([expect.objectContaining({ precondition: 'P5', case: 'c', code: 'identity_unconfirmed' })]);
    expect(notTargetTestableSentence(FIX.mrrPreCard, v)!.endsWith('?')).toBe(false);
  });

  it('CONTROL: MRR after the card (identity confirmed) → no failure; its ISL identity rules are the Run\'s (`unchecked`)', () => {
    expect(targetTestabilityOf(FIX.mrr)).toEqual({ kind: 'unchecked', goal_id: expect.any(String), unchecked: ['P5'] });
  });

  it('CONTROL (R3 5914084339): a change-frame goal ("cut costs by 20%") is left as it was', () => {
    expect(targetTestabilityOf(FIX.cc).kind).toBe('unchecked');
  });

  it('CONTROL: a goal with no stated target is not this verdict\'s subject', () => {
    const g = structuredClone(FIX.paul);
    for (const n of g.nodes) if (n.kind === 'goal') delete n.goal_threshold_raw;
    delete g.goal_constraints;
    expect(targetTestabilityOf(g).kind).toBe('no_target');
  });

  it('RED (CI #2371 3054228c, route-level 2.349): a DEADLINE on the goal ("within 18 months") is row 3\'s time, never row 4\'s target', () => {
    const g = structuredClone(FIX.paul);
    for (const n of g.nodes) if (n.kind === 'goal') delete n.goal_threshold_raw;
    const goalId = g.nodes.find((n: Json) => n.kind === 'goal').id;
    const deadline = { constraint_id: 'constraint_goal_deadline', node_id: goalId, operator: '<=', value: 18, unit: 'months', source_quote: 'within 18 months', deadline_metadata: { deadline_date: '2028-03-31' } };
    g.goal_constraints = [deadline];
    expect(targetTestabilityOf(g).kind).toBe('no_target');
    // CONTRAST: the same row with no deadline marker IS the goal's own target (and Paul's still fails P1).
    const { deadline_metadata: _dropped, ...plain } = deadline;
    g.goal_constraints = [plain];
    expect(targetTestabilityOf(g).kind).toBe('not_testable');
  });
});

/**
 * R3's m1 (5914230653, corrected 5914418154; AIQ 5914435183): the served MRR Run after the identity card's Yes has its
 * chance on the goal's own scale (identity evaluated, P 0.9929), but it rests on Olumi's price → churn guess (0.07 pp per
 * £1, `olumi_estimate`), consequential over the year: `exploratory` until the user sizes that link. Then testable.
 */
describe('R3\'s m1: after the identity card\'s Yes, Olumi\'s price → churn guess still caps it; the user\'s own size lifts it', () => {
  const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-mrr-m1-card-yes-20260930.json', import.meta.url), 'utf8')).graph as Json;

  /**
   * P0 PARTNER #75 5916838445 (MG #2385 keeps drafted risks, some kept out of the calculation): a risk on the price's way
   * to MRR, on Olumi's links. Kept out (`retained_excluded`), the run guard hands PLoT the model without it, so it can
   * never be why the target is untestable; kept in, it is exactly that.
   */
  const withRisk = (g: Json, participation?: 'retained_excluded'): Json => {
    const c = structuredClone(g);
    c.nodes.push({ id: 'price_backlash_risk', kind: 'risk', label: 'Price backlash', ...(participation ? { analysis_participation: participation } : {}) });
    c.edges.push({ from: 'pro_plan_price', to: 'price_backlash_risk', strength: { mean: 0.3, std: 0.1 }, defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
    c.edges.push({ from: 'price_backlash_risk', to: 'mrr', strength: { mean: -0.2, std: 0.1 }, defaulted: true, provenance: { source: 'cee_hypothesis' } });
    return c;
  };

  it('RED (P0 PARTNER 5916838445): the route sized by the user + a KEPT-OUT risk on Olumi\'s links → the same verdict as without the risk', () => {
    const sized = userSized(M1);
    expect(targetTestabilityOf(sized).kind).not.toBe('not_testable');
    expect(targetTestabilityOf(withRisk(sized, 'retained_excluded'))).toEqual(targetTestabilityOf(sized));
  });

  it('CONTROL: the same risk KEPT IN → not testable, naming the price (its Olumi link is on the goal\'s path)', () => {
    const v = targetTestabilityOf(withRisk(userSized(M1)));
    expect(v.kind).toBe('not_testable');
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.lever)).toEqual([expect.stringMatching(/price/i)]);
  });

  it('BOUND to the run guard: the verdict on the stored graph equals the verdict on the graph the guard hands PLoT', () => {
    for (const g of [withRisk(userSized(M1), 'retained_excluded'), withRisk(M1, 'retained_excluded')]) {
      expect(targetTestabilityOf(g)).toEqual(targetTestabilityOf(guardAnalysisParticipation(g, { goalNodeId: 'mrr' }).graph));
    }
  });
  it('RED: m1 as served → not testable, (c), naming the price', () => {
    const v = targetTestabilityOf(M1);
    expect(v.kind === 'not_testable' && v.failures).toEqual([{ precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: expect.stringMatching(/price/i) }]);
    expect(resolveAnalysisAdmission(M1).permitted_analysis_mode).toBe('exploratory');
  });

  it('RED (R3 5914745577): price → churn user-sized ALONE still counts churn once — churn → subscribers-at-12-months is Olumi\'s default', () => {
    const v = targetTestabilityOf(userSizedWhere(M1, (e) => e.from === 'pro_plan_price' && e.to === 'monthly_churn_rate'));
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.lever)).toEqual([expect.stringMatching(/churn/i)]);
  });

  it('GREEN: the user answers AIQ\'s one question ("how many of your 1,500 would you lose over a year at £59?"), sizing the route → kept', () => {
    // The identity's own operand edges (price → mrr, subscribers → mrr) are exact, never "Olumi-sized" (R3 5914745577).
    const sized = userSizedWhere(M1, (e) => e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months');
    expect(targetTestabilityOf(sized).kind).toBe('unchecked');
    const a = resolveAnalysisAdmission(sized);
    expect(a.permitted_analysis_mode).not.toBe('exploratory');
    expect(reasonOf(a).code).not.toBe('TARGET_NOT_TESTABLE');
  });
});

describe('the admission says it before any Run, on the one carrier', () => {
  it('RED: Paul — the run may proceed, but the mode is capped at `exploratory` with the reason in AIQ\'s words', () => {
    const a = resolveAnalysisAdmission(FIX.paul);
    expect(a.structurally_analysable).toBe(true);
    expect(a.permitted_analysis_mode).toBe('exploratory');
    expect(reasonOf(a)).toEqual({ field: 'permitted_analysis_mode', code: 'TARGET_NOT_TESTABLE',
      message: notTargetTestableSentence(FIX.paul, targetTestabilityOf(FIX.paul)) });
  });

  it('CONTROL: MRR (today\'s level stated) keeps its mode and its own reason', () => {
    const a = resolveAnalysisAdmission(FIX.mrr);
    expect(a.permitted_analysis_mode).not.toBe('exploratory');
    expect(reasonOf(a).code).not.toBe('TARGET_NOT_TESTABLE');
  });

  it('CONTROL: the cap only LOWERS — a refused run keeps its refusal', () => {
    const g = structuredClone(FIX.paul);
    g.nodes = g.nodes.filter((n: Json) => n.kind !== 'option' || n.id === 'current_outreach');
    const a = resolveAnalysisAdmission(g);
    expect(a.structurally_analysable).toBe(false);
    expect(reasonOf(a).code).not.toBe('TARGET_NOT_TESTABLE');
  });
});

describe('every leader rail reads the capped mode (P0 PARTNER 5913561360), by execution', () => {
  const paul = buildCanonicalAnalysisReadyFromGraph(FIX.paul);
  const mrr = buildCanonicalAnalysisReadyFromGraph(FIX.mrr);

  it('the wire carries it: `analysis_ready.analysis_admission.permitted_analysis_mode` = exploratory', () => {
    expect(permittedAnalysisModeFromAnalysisReady(paul)).toBe('exploratory');
  });

  it('RED: the prose rail withholds naming a leader (it stood down only when the run itself was refused)', () => {
    expect(analysisReadyPermitsLeaderNaming(paul)).toBe(false);
  });

  it('RED: the agent lane withholds even a SEPARATED, entitled leader (the caveat arm is `quantified_provisional` only)', () => {
    expect(agentLaneLeaderWithheld({ mayNameLeadingOption: true, analysisReady: paul, separationEstablished: true })).toBe(true);
    expect(claimPermissionsFrom(separatedClaim, paul, { requested: true })).toMatchObject({ leader_may_be_named: false, permitted_analysis_mode: 'exploratory' });
  });

  it('CONTROL: MRR\'s separated, entitled leader keeps today\'s caveated permission', () => {
    const mode = permittedAnalysisModeFromAnalysisReady(mrr);
    expect(mode === 'quantified_provisional' || mode === 'comparative_leader').toBe(true);
    expect(agentLaneLeaderWithheld({ mayNameLeadingOption: true, analysisReady: mrr, separationEstablished: true })).toBe(false);
    expect(claimPermissionsFrom(separatedClaim, mrr, { requested: true }).leader_may_be_named).toBe(true);
  });
});

/**
 * AIQ #75 5913873948 row 3: after Paul's target card the Agent said "recording the stated £1m minimum target … would let
 * a later run test goal attainment", which is false (the verdict is `not_testable`). The verdict is now in the Agent's
 * typed input (`readiness`, the view `get_canonical_state` and the turn's readback carry) and in the post-write line.
 */
describe('the Agent reads it before any Run, and the post-write line says it', () => {
  it('RED: the readiness view the Agent reads carries AIQ\'s sentence on Paul\'s graph', () => {
    expect(readinessViewOf(FIX.paul).target_not_testable).toBe(notTargetTestableSentence(FIX.paul, targetTestabilityOf(FIX.paul)));
  });

  it('RED: after a write on Paul\'s graph, "can run now" never stands alone', () => {
    const line = postWriteReadinessLine(FIX.paul, { status: 'ready', may_run: true })!;
    // AIQ 5914209776: the lead, never "can run" followed by nothing.
    expect(line).toBe(notTargetTestableSentence(FIX.paul, targetTestabilityOf(FIX.paul)));
    expect(line).not.toContain('can run now');
  });

  it('CONTROL: MRR (today\'s level stated) — no such field, and the line is unchanged', () => {
    expect(readinessViewOf(FIX.mrr)).not.toHaveProperty('target_not_testable');
    expect(postWriteReadinessLine(FIX.mrr, { status: 'ready', may_run: true })).not.toContain("can't yet test");
  });
});

/**
 * ⭐ A LINK THAT HOLDS BY DEFINITION IS NO GUESS — CHECKED, NEVER CLAIMED (DL #75 5916504679; R3 5916525389, its rows).
 * R3's funding graph: every link into the goal user-sized except "Funding lost to distraction" → funding at −1 £ per £,
 * Olumi's size. Construction types such a link `provenance.definitional` only when its own size proves it (#2386); this
 * reader re-checks the stored edge, so a tag the size does not prove never lifts the cap, and it is never the question.
 * `tagged` writes `strength_mean` = the edge's β, as the sizer writes every natural effect (`link-effect.ts` `natural()`).
 */
describe('a definitional link (money lost is money not raised) is no Olumi guess, only when its own size proves it', () => {
  const F = JSON.parse(readFileSync(new URL('./fixtures/r3-funding-definitional-20260930.json', import.meta.url), 'utf8')).graph as Json;
  const RISK = (e: Json) => e.from === 'funding_lost_distraction' && e.to === 'securing_funding';
  const tagged = (edit?: (ne: Json, g: Json, e: Json) => void): Json => {
    const g = structuredClone(F);
    const e = g.edges.find(RISK);
    e.provenance.definitional = true;
    e.provenance.natural_effect.strength_mean = e.strength.mean;
    edit?.(e.provenance.natural_effect, g, e);
    return g;
  };
  const p5 = (g: Json) => { const v = targetTestabilityOf(g); return v.kind === 'not_testable' ? v.failures.filter((f) => f.precondition === 'P5') : []; };

  it('PRECONDITION: untagged, the risk\'s −1 £ per £ is Olumi\'s guess on the goal\'s path, and it is the lever asked about', () => {
    expect(F.edges.find(RISK).provenance).toMatchObject({ magnitude: 'olumi_estimate', natural_effect: { amount: -1, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£' } });
    expect(p5(F)).toEqual([expect.objectContaining({ code: 'goal_path_unsized', lever: expect.stringMatching(/distraction/i) })]);
  });

  it('GREEN: typed and proven (−1 £ per £; the goal and the risk in £; written for the β it holds) → no guess on the path', () => {
    expect(p5(tagged())).toEqual([]);
  });

  it('RED (P0 PARTNER CR 5917993638): typed and proven, then β re-estimated −0.5 → −0.2 (a stale size) → the lever is asked again', () => {
    expect(p5(tagged((_ne, _g, e) => { e.strength.mean = -0.2; })).map((f) => f.lever)).toEqual([expect.stringMatching(/distraction/i)]);
  });

  it('RED: typed, but the size says no β it was written for (no `strength_mean`) → still a guess (fails closed)', () => {
    expect(p5(tagged((ne) => { delete ne.strength_mean; })).map((f) => f.lever)).toEqual([expect.stringMatching(/distraction/i)]);
  });

  it('RED (the DL\'s guard): typed, but the risk read in hours/week → still Olumi\'s guess', () => {
    expect(p5(tagged((ne) => { ne.per_source_change_unit = 'hours/week'; })).map((f) => f.lever)).toEqual([expect.stringMatching(/distraction/i)]);
  });

  it('RED: typed, but −0.4 £ per £ → still a guess (a definition moves the target by exactly one unit)', () => {
    expect(p5(tagged((ne) => { ne.amount = -0.4; })).map((f) => f.lever)).toEqual([expect.stringMatching(/distraction/i)]);
  });

  it('RED: typed and one-for-one, but the risk node itself is read in another unit → still a guess', () => {
    const g = tagged((_ne, graph) => { graph.nodes.find((n: Json) => n.id === 'funding_lost_distraction').unit = 'hours/week'; });
    expect(p5(g).map((f) => f.lever)).toEqual([expect.stringMatching(/distraction/i)]);
  });
});

/**
 * ⭐ ROW 3 — THE USER'S OWN SIZE IS NEVER OLUMI'S GUESS (MODEL GENERATION 5918011036; AIQ 5918035214; P0 PARTNER 5918060026
 * row 3). Paul's funding: "each qualified investor conversation brings about £30,000" is written `magnitude: 'user_stated'`
 * with a £ natural effect, and ALSO `defaulted: true` because admission projected its spread. #2389 writes `user_stated`
 * only where the brief writes THAT link's figure, so the goal leaves `exploratory` once the user's own sizes are given.
 */
describe('row 3: a size construction credits to the user is no Olumi guess, even with a projected spread', () => {
  const F = JSON.parse(readFileSync(new URL('./fixtures/r3-funding-definitional-20260930.json', import.meta.url), 'utf8')).graph as Json;
  const MEETINGS = (e: Json) => e.from === 'investment_firm_meetings' && e.to === 'securing_funding';
  const RISK = (e: Json) => e.from === 'funding_lost_distraction' && e.to === 'securing_funding';
  /** R3's graph with the risk proven definitional (off the path's guesses), and the meetings link sized as `magnitude`. */
  const sizedAs = (magnitude: string): Json => {
    const g = structuredClone(F);
    const risk = g.edges.find(RISK);
    Object.assign(risk.provenance, { definitional: true });
    risk.provenance.natural_effect.strength_mean = risk.strength.mean;
    const e = g.edges.find(MEETINGS);
    e.provenance = { ...e.provenance, source: 'brief_extraction', magnitude };
    e.defaulted = true;
    return g;
  };
  const p5 = (g: Json) => { const v = targetTestabilityOf(g); return v.kind === 'not_testable' ? v.failures.filter((f) => f.precondition === 'P5') : []; };

  it('GREEN: `user_stated` + `defaulted` (the served shape) → no guess on the path, nobody is asked to size it', () => {
    expect(p5(sizedAs('user_stated'))).toEqual([]);
  });

  it('CONTROL: the same link sized by Olumi (`olumi_estimate`) → still the lever asked about', () => {
    expect(p5(sizedAs('olumi_estimate')).map((f) => f.lever)).toEqual([expect.stringMatching(/investment firm/i)]);
  });
});


/**
 * ⭐ L4 / DL ruling 5929790081 (i) AT THE GOAL TARGET READER (CODEX CR #2446 5930402198): Olumi's estimate the user
 * ACCEPTED sizes a link for goal figures, so R3's m1 is testable once the user approves Olumi's sizes, with Olumi's origin
 * kept. Controls: unapproved Olumi sizes and a reviewed legacy placeholder still cap it, and the user's own size lifts it.
 * The accepted state is built by the writer's own rule (`sizedByApproval`) plus the review the writer records.
 */
describe('L4 (i): an ACCEPTED Olumi size licenses the goal target; unapproved Olumi sizes still cap it', () => {
  const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-mrr-m1-card-yes-20260930.json', import.meta.url), 'utf8')).graph as Json;
  const review = { intent: 'confirm', at: '2026-10-01T09:25:10.219Z' };
  const accepted = (g: Json): Json => { const c = structuredClone(g); for (const e of c.edges) if (olumiSized(e) && e.provenance) e.provenance = { ...sizedByApproval(e.provenance, e), reviewed_by_user: review }; return c; };

  it('PRECONDITION: m1 rests on Olumi’s unapproved size → not testable (P5)', () => {
    const v = targetTestabilityOf(M1);
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.precondition)).toContain('P5');
  });

  it('RED (i): every Olumi size on the path ACCEPTED → the target is no longer capped by them, and stays Olumi’s', () => {
    const g = accepted(M1);
    expect(g.edges.filter((e: Json) => olumiSized(e)).every((e: Json) => e.provenance.source !== 'user_specified'), 'origin kept (R11)').toBe(true);
    expect(targetTestabilityOf(g).kind).not.toBe('not_testable');
    expect(targetTestabilityOf(g)).toEqual(targetTestabilityOf(userSized(M1)));
  });

  it('CONTROL: a REVIEWED legacy placeholder (Paul’s 09:25 links before L4) is still unsized → still capped', () => {
    const g = structuredClone(M1);
    for (const e of g.edges) if (olumiSized(e) && e.provenance) e.provenance = { ...e.provenance, magnitude: 'olumi_placeholder', reviewed_by_user: review };
    expect(targetTestabilityOf(g).kind).toBe('not_testable');
  });

  it('CONTROL (ii): the limit rule keeps the whole test — an accepted Olumi size is still Olumi’s guess for a limit', () => {
    const e = accepted(M1).edges.find((x: Json) => olumiSized(x))!;
    expect(olumiGuessedLink(e, () => undefined)).toBe(true);
    expect(olumiGuessedGoalLink(e, () => undefined)).toBe(false);
  });
});
