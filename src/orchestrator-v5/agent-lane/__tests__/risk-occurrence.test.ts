/**
 * ⭐ The ONE writer of Olumi's occurrence range on an existing risk (`risk-occurrence.ts`), on the served hiring post3007 graph:
 * eligibility (a risk ROOT with no level, one goal with a period), the window (the goal's own period), the stale gate (the node
 * as the card showed it), the scoped postimage (that risk's `event_risk` only) and the verified no-op on a retry.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, olumiOccurrenceBlock, riskOccurrencePostimageIsScoped, riskOccurrenceSubject,
  type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { goalChanceEstimateCensus, olumiEstimateWords } from '../goal-chance-estimate-attribution.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const BLOCK = olumiOccurrenceBlock(20, 40, 3)!;
const approved = (g: Rec = G): ApprovedRiskOccurrence => ({ risk_id: RISK, event_risk: BLOCK, expected_node: structuredClone(riskOf(g)) });

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
});
