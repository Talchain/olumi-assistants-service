/**
 * ⭐ The ONE writer of Olumi's occurrence range on an existing risk (`risk-occurrence.ts`), on the served hiring post3007 graph:
 * eligibility (a risk ROOT with no level, one goal with a period), the window (the goal's own period), the stale gate (the node
 * as the card showed it), the scoped postimage (that risk's `event_risk` only) and the verified no-op on a retry.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, olumiOccurrenceBlock, riskOccurrenceGoalSubject, riskOccurrencePostimageIsScoped, riskOccurrenceSubject,
  type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { goalChanceEstimateCensus, olumiEstimateWords } from '../goal-chance-estimate-attribution.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const BLOCK = olumiOccurrenceBlock(20, 40, 3)!;
const approved = (g: Rec = G): ApprovedRiskOccurrence => ({ risk_id: RISK, event_risk: BLOCK, expected_node: structuredClone(riskOf(g)),
  goal_id: 'productivity', expected_goal: riskOccurrenceGoalSubject(g, 'productivity')! });
/** The served goal with a saved 3-month window, 14 October 2026 to 14 January 2027 (Codex r1's shape). */
const dated = (): Rec => {
  const g = structuredClone(G);
  Object.assign(goalOf(g), { goal_horizon: { deadline: '2027-01-14' }, goal_horizon_reference_date: '2026-10-14', goal_horizon_months: 3,
    goal_horizon_stated_months: 3 });
  return g;
};

describe('risk-occurrence: Olumi’s range for an unvalued risk root', () => {
  it('the served risk is eligible over the goal’s own period (3 months), and the block is Olumi’s', () => {
    expect(riskOccurrenceSubject(G, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
    expect(BLOCK).toEqual({ version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } });
    expect([olumiOccurrenceBlock(40, 20, 3), olumiOccurrenceBlock(-1, 20, 3), olumiOccurrenceBlock(20, 101, 3), olumiOccurrenceBlock('20', 40, 3)]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('writes ONLY that risk’s event_risk; a retry of the landed write is a verified no-op', () => {
    const out = applyRiskOccurrenceEdit(G, approved());
    expect(out.kind).toBe('mutated');
    const expected = structuredClone(G);
    riskOf(expected).event_risk = BLOCK;
    expect((out as Rec).mutatedGraph).toEqual(expected);
    expect(riskOccurrencePostimageIsScoped(G, expected, approved())).toBe(true);
    expect(applyRiskOccurrenceEdit(expected, approved())).toEqual({ kind: 'unchanged' });
  });

  it('refuses: the node moved since the card, a cause link, a level, no single goal period, or a block that is not Olumi’s', () => {
    const renamed = structuredClone(G); riskOf(renamed).label = 'Code quality';
    expect(applyRiskOccurrenceEdit(renamed, approved())).toEqual({ kind: 'refused', reason: 'risk_changed' });
    const caused = structuredClone(G); (caused.edges as Rec[]).push({ from: 'tech_lead_hires', to: RISK, strength: { mean: 0.3, std: 0.1 } });
    expect(applyRiskOccurrenceEdit(caused, approved())).toEqual({ kind: 'refused', reason: 'has_a_cause' });
    const valued = structuredClone(G); riskOf(valued).observed_state = { value: 0.3 };
    expect(riskOccurrenceSubject(valued, RISK)).toEqual({ kind: 'ineligible', reason: 'holds_a_level' });
    const noPeriod = structuredClone(G); delete goalOf(noPeriod).goal_target_basis;
    expect(applyRiskOccurrenceEdit(noPeriod, approved(noPeriod))).toEqual({ kind: 'refused', reason: 'no_window' });
    const moved = structuredClone(G); goalOf(moved).goal_target_basis.period_months = 6;
    expect(applyRiskOccurrenceEdit(moved, approved(moved))).toEqual({ kind: 'refused', reason: 'risk_changed' });
    const users = { ...approved(), event_risk: { ...BLOCK, occurrence: { ...BLOCK.occurrence, basis: 'user' as const } } };
    expect(applyRiskOccurrenceEdit(G, users)).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(riskOccurrenceSubject(G, 'leadership_coverage')).toEqual({ kind: 'ineligible', reason: 'not_a_risk' });
  });

  it('⛔ Codex r1: the card binds the goal’s WINDOW, not its month count — the same 3 months a month later writes nothing', () => {
    const card = approved(dated());
    expect(riskOccurrenceSubject(dated(), RISK)).toMatchObject({ kind: 'eligible', window_months: 3, goal_id: 'productivity' });
    expect(card.expected_goal).toMatchObject({ horizon: { deadline: '2027-01-14', months: 3 }, starts: '2026-10-14', reading: { period_months: 3 } });
    // The saved window moves to 14 November–14 February: the analysis hash does not see it; the card does.
    const shifted = dated();
    Object.assign(goalOf(shifted), { goal_horizon: { deadline: '2027-02-14' }, goal_horizon_reference_date: '2026-11-14' });
    expect(computeAnalysisAffectingGraphHash(shifted as never)).toBe(computeAnalysisAffectingGraphHash(dated() as never));
    expect(applyRiskOccurrenceEdit(shifted, card)).toEqual({ kind: 'refused', reason: 'goal_changed' });
    // Each bound member alone retires it: the start, the end, the reading.
    const started = dated(); goalOf(started).goal_horizon_reference_date = '2026-11-14';
    const ended = dated(); goalOf(ended).goal_horizon = { deadline: '2027-02-14' };
    const relabelled = dated(); goalOf(relabelled).label = 'Team productivity';
    expect([started, ended, relabelled].map((g) => applyRiskOccurrenceEdit(g, card))).toEqual(Array(3).fill({ kind: 'refused', reason: 'goal_changed' }));
    // CONTRAST: an unrelated link edit leaves the card's subject as bound, so the writer still writes.
    const unrelated = dated(); (unrelated.edges as Rec[]).find((e) => e.from === 'leadership_coverage')!.strength = { mean: 0.1, std: 0.05 };
    expect(applyRiskOccurrenceEdit(unrelated, card).kind).toBe('mutated');
  });

  it('⛔ Codex r1: a reading counted from a launch beside a horizon counted from its own date is a conflict, even with the same month count: no card', () => {
    const launch = dated(); goalOf(launch).goal_target_basis.reference = 'launch';
    expect(riskOccurrenceSubject(launch, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
    expect(riskOccurrenceSubject(dated(), RISK).kind).toBe('eligible');
    // CONTRAST: a launch reading with no separate horizon is the goal's one window (no conflict).
    const launchOnly = structuredClone(G); goalOf(launchOnly).goal_target_basis.reference = 'launch';
    expect(riskOccurrenceSubject(launchOnly, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
  });

  it('⛔ Codex r1 RACED READ-BACK: a concurrent 3 → 6 month change after the commit → not confirmed: no receipt, readiness not checked', async () => {
    let g = structuredClone(G);
    let commits = 0;
    const ctx = { scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r', turn_id: 't', user_text: 'Please propose an assumption.' };
    const caps = createAgentCapabilities(async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      throw new Error(path);
    }, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: async (input) => {
      commits += 1;
      const r = applyRiskOccurrenceEdit(g, input.risk_occurrence!);
      if (r.kind !== 'mutated') throw new Error(r.kind);
      g = r.mutatedGraph as Rec;
      const committedHash = computeAnalysisAffectingGraphHash(g as never)!;
      goalOf(g).goal_target_basis.period_months = 6; // a second, independent write lands after this commit
      return { status: 'committed', graph_hash: committedHash, already_applied: false, committed_levels: [], links_resized: [], receipt: null } as never;
    } });
    const p = await caps.proposeAssumptions(ctx as never, { assumptions: [{ factor_label: riskOf(g).label, value: 30, unit: '%', basis: 'An estimate for the launch window.',
      user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never);
    expect(p).toMatchObject({ ok: true });
    const res = await caps.authoriseChange({ ...ctx, user_text: 'Yes, use that.', typed_approval_of: String(p.proposal_id), typed_approval_words: 'Yes, use that.' } as never,
      { proposal_id: String(p.proposal_id) });
    expect(commits).toBe(1);
    expect(res).toMatchObject({ ok: false, applied: false, refusal: 'not_confirmed', readiness_after: { checked: false } });
    expect(res).not.toHaveProperty('follow_up');
    expect(JSON.stringify(res)).not.toContain('Recorded Olumi’s starting assumption');
  });

  it('DL Q2: the chance rests on Olumi’s occurrence too — counted on the face and listed on the panel, by the risk’s id', () => {
    const OPTIONS = ['hire_tech_lead', 'hire_two_developers', 'continue_as_now'];
    const before = goalChanceEstimateCensus(G, OPTIONS, 'productivity');
    expect(before.estimates!.values.map((v) => v.id)).not.toContain(RISK);
    const written = (applyRiskOccurrenceEdit(G, approved()) as Rec).mutatedGraph as Rec;
    const after = goalChanceEstimateCensus(written, OPTIONS, 'productivity');
    expect(after.estimates!.values.filter((v) => v.id === RISK)).toEqual([expect.objectContaining({ kind: 'value', id: RISK, label: 'Code quality deterioration' })]);
    expect(after.counts.values).toBe(before.counts.values + 1);
    expect({ ...after.counts, values: before.counts.values }).toEqual(before.counts);
    expect(olumiEstimateWords({ values: after.counts.values, links: after.counts.links })).toContain(`${after.counts.values} starting value`);
    // CONTRAST: the user's own stated range on the same risk is not Olumi's estimate.
    const users = structuredClone(written); riskOf(users).event_risk.occurrence.basis = 'user';
    expect(goalChanceEstimateCensus(users, OPTIONS, 'productivity').counts).toEqual(before.counts);
  });

  it('AIE window: the goal’s CURRENT recorded period; two recorded periods that disagree are no window licence', () => {
    const agree = structuredClone(G); goalOf(agree).goal_horizon_months = 3;
    expect(riskOccurrenceSubject(agree, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    expect(riskOccurrenceSubject(conflict, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
  });

  it('AIE readiness copy: the eligible event path asks the occurrence within the window; an ineligible risk keeps its question, never promising a card', () => {
    const ask = (g: Rec): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
      .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === RISK).map((i) => i.message);
    expect(ask(G)).toEqual(['How likely is ‘Code quality deterioration’ to happen at least once within 3 months? The numerical analysis is '
      + 'withheld until this risk has a supported value. You can also ask Olumi to propose a labelled starting assumption for review.']);
    // PL 05:53Z: where no card can exist (no single saved goal period), the ask never offers one.
    const honest = ['How likely or how large is "Code quality deterioration" today? The numerical analysis is withheld until this '
      + 'risk has a supported value.'];
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    expect(ask(conflict)).toEqual(honest);
    const noPeriod = structuredClone(G); delete goalOf(noPeriod).goal_target_basis;
    expect(riskOccurrenceSubject(noPeriod, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
    expect(ask(noPeriod)).toEqual(honest);
  });
});
