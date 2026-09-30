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

type Json = Record<string, any>;
const RAW = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as { paul: Json; mrr: Json; n1: Json; cc: Json };
/** MRR after the identity card's Yes (#2292 makes the product the user's: `stated_in_brief: true`). */
const confirmed = (g: Json): Json => { const c = structuredClone(g); for (const n of c.nodes) if (n.kind === 'goal' && n.nonlinear_identity) n.nonlinear_identity.stated_in_brief = true; return c; };
/** Paul's graph after MODEL GENERATION's G6: his stated "£0 secured so far" is today's level (5913925033). */
const withToday = (g: Json): Json => { const c = structuredClone(g); for (const n of c.nodes) if (n.kind === 'goal') n.observed_state = { value: 0, baseline: 0, raw_value: 0, unit: '£', cap: n.goal_threshold_cap, source: 'user_stated' }; return c; };
/** …and every link into the goal sized (Olumi-sized counts, AIQ 5914055238). */
const sizedInto = (g: Json): Json => { const c = structuredClone(g); const goal = c.nodes.find((n: Json) => n.kind === 'goal').id; for (const e of c.edges) if (e.to === goal) e.provenance = { ...(e.provenance ?? {}), magnitude: 'olumi_estimate' }; return c; };
const FIX = { paul: RAW.paul, n1: RAW.n1, cc: RAW.cc, mrr: confirmed(RAW.mrr), mrrPreCard: RAW.mrr };
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

  it('CONTROL: £0 today AND every link into the goal sized → testable', () => {
    expect(targetTestabilityOf(sizedInto(withToday(FIX.paul)))).toEqual({ kind: 'testable', goal_id: 'securing_funding' });
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
    expect(line.startsWith('The analysis can run now.')).toBe(true);
    expect(line).toContain("can't yet test them against your target (at least £1,200,000)");
  });

  it('CONTROL: MRR (today\'s level stated) — no such field, and the line is unchanged', () => {
    expect(readinessViewOf(FIX.mrr)).not.toHaveProperty('target_not_testable');
    expect(postWriteReadinessLine(FIX.mrr, { status: 'ready', may_run: true })).not.toContain("can't yet test");
  });
});
