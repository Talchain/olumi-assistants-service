import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GraphV3Schema } from '@talchain/schemas';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import * as admission from '../admit-model.js';
import { edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { statedEffectQuoteMatches } from '../../../cee/provenance/stated-effect.js';
import { resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
import * as copy from '../../response-finaliser.js';

const facts = 'Facts: each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.';
const candidate = (amount = 1200): admission.CandidateModel => ({
  goal: { metric: 'monthly recurring revenue', operator: '>=', value: 150000, unit: '£/month', horizon_months: 9, provenance: 'explicit' },
  options: [{ label: 'Raise prices', provenance: 'explicit', changes: ['Price increase'], interventions: [{ factor_label: 'Price increase', value: 10, unit: '%', provenance: 'explicit' }] }, { label: 'Keep pricing', provenance: 'explicit', is_status_quo: true }],
  factors: [{ label: 'Price increase', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred' }],
  risks: [{ label: 'Customer losses from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 400 }], outcomes: [], constraints: [],
  links: [{ from: 'Price increase', to: 'monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: amount, effect_per_source_change: 1, effect_provenance: 'inferred' }],
});
const edge = (c = candidate(), text = facts) => admission.admitCandidateModel(c, undefined, text).edges.find(e => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue')!;
const ne = { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%', strength_mean: 0.64, strength_mean_frame: 'edge_strength' as const };
const ns = [{ id: 'p', label: 'Price increase', unit: '%' }, { id: 'g', label: 'Monthly recurring revenue', unit: '£/month' }];
const l = { from: 'p', to: 'g', effect_direction: 'positive', natural_effect: ne };
const bind = (ls: any[], nodes: any[], text: string): Map<number, string> => (admission as any).bindStatedLinkSizes?.(ls, nodes, text) ?? new Map();
const control = () => expect(edge().provenance?.magnitude).toBe('user_stated');
const draw = (i: number) => JSON.parse(readFileSync(new URL(`../../admission/__tests__/fixtures/mc-p0/draw${i}.json`, import.meta.url), 'utf8'));
const brief = readFileSync(new URL('../../admission/__tests__/fixtures/mc-p0/BRIEF.txt', import.meta.url), 'utf8');

describe('MC P0 round 3 Fi', () => {
  it.each(['Monthly recurring revenue', 'Monthly recurring revenue (MRR)'])('R3-0 refuses £49 support cost when another label is %s', label => {
    control();
    const wrong = { from: 's', to: 'c', effect_direction: 'positive', natural_effect: { ...ne, amount: 49, per_source_change_unit: 'subscribers' } };
    expect(bind([wrong], [{ id: 's', label: 'Starter subscribers', unit: 'subscribers' }, { id: 'c', label: 'Starter support cost', unit: '£/month' }, { id: 'r', label, unit: '£/month' }], brief).size).toBe(0);
  });
  it('R3-0 accepted residual: MRR alone is not named by monthly recurring revenue', () => {
    control();
    const wrong = { from: 's', to: 'c', effect_direction: 'positive', natural_effect: { ...ne, amount: 49, per_source_change_unit: 'subscribers' } };
    expect(bind([wrong], [{ id: 's', label: 'Starter subscribers', unit: 'subscribers' }, { id: 'c', label: 'Starter support cost', unit: '£/month' }, { id: 'r', label: 'MRR', unit: '£/month' }], brief).get(0)).toBe('Each starter subscriber adds £49 a month to monthly recurring revenue.');
  });
  it.each([1, 2, 3])('R3-0 real draw %i £1,200 endpoints and all other nodes permit binding', i => {
    control(); const g = draw(i);
    const nodes = g.nodes.map((n: any) => ({ ...n, unit: n.observed_state?.unit ?? n.goal_threshold_unit ?? n.unit }));
    const ls = g.edges.map((e: any) => ({ ...e, natural_effect: e.provenance?.natural_effect }));
    const p = ls.findIndex((e: any) => e.to === 'monthly_recurring_revenue' && e.natural_effect?.amount === 1200);
    expect(bind(ls, nodes, brief).get(p)).toBe(facts);
  });
  it('R3-F1 target span is not an effect, and the base strength/std stay unchanged', () => {
    control(); const e = edge(candidate(150000), 'At a 1% Price increase, our target for monthly recurring revenue is £150,000 a month.');
    expect(e.provenance?.magnitude).not.toBe('user_stated'); expect(e.strength).toEqual({ mean: 0.5, std: 0.125 });
  });
  it('R3-F1 today span is not an effect, and the base strength/std stay unchanged', () => {
    control(); const e = edge(candidate(), 'With a 1% Price increase, monthly recurring revenue today is £1,200 a month.');
    expect(e.provenance?.magnitude).toBe('olumi_estimate'); expect(e.strength).toEqual({ mean: 0.64, std: 0.32 });
  });
  it('R3-F1 equal £1,200 level elsewhere cannot exclude the real adds-span by VALUE', () => {
    control(); expect(edge(candidate(), `Monthly recurring revenue today is £1,200 a month. ${facts}`).provenance?.source_quote).toBe(facts);
  });
  it('R3-F2 written % is not the stored percentage-points tuple', () => {
    control(); const base = candidate(0.2); const c: admission.CandidateModel = { ...base, goal: { ...base.goal, metric: 'Monthly churn', unit: '%', value: 3, operator: '<=', baseline_value: 2, baseline_known: true }, links: base.links.map(l => ({ ...l, to: 'Monthly churn' })) };
    const m = admission.admitCandidateModel(c, undefined, 'Each 1% Price increase adds 0.2% to Monthly churn.');
    expect(m.edges.find(e => e.to === 'monthly_churn')?.provenance?.magnitude).toBe('olumi_estimate');
  });
  it('R3-F2 points control is promoted with a matching stored tuple', () => {
    control(); const base = candidate(0.2); const c: admission.CandidateModel = { ...base, goal: { ...base.goal, metric: 'Monthly churn', unit: '%', value: 3, operator: '<=', baseline_value: 2, baseline_known: true }, links: base.links.map(l => ({ ...l, to: 'Monthly churn' })) };
    const quote = 'Each 1% Price increase adds 0.2 percentage points to Monthly churn.';
    const e = admission.admitCandidateModel(c, undefined, quote).edges.find(e => e.to === 'monthly_churn')!;
    expect(e.provenance?.magnitude).toBe('user_stated'); expect(e.provenance?.natural_effect?.amount_unit).toBe('percentage points');
    expect(statedEffectQuoteMatches(quote, e.provenance!.natural_effect!)).toBe(true);
  });
  it('R3-F2 every Fi receipt validates the STORED tuple', () => {
    control(); const m = admission.admitCandidateModel(candidate(), undefined, facts);
    const promoted = m.edges.filter(e => e.provenance?.source_quote !== undefined);
    expect(promoted.length).toBe(1);
    for (const e of promoted) expect(statedEffectQuoteMatches(e.provenance!.source_quote as string, e.provenance!.natural_effect!)).toBe(true);
  });
  it.each(['Each', 'Every', 'Per'])('R3-F3 %s numeric determiner refuses negative per, accepts negative amount/positive per', determiner => {
    control(); const text = `${determiner} 1% price rise cuts £1,200 a month from monthly recurring revenue.`;
    expect(bind([{ ...l, effect_direction: 'negative', natural_effect: { ...ne, per_source_change: -1 } }], ns, text).size).toBe(0);
    expect(bind([{ ...l, effect_direction: 'negative', natural_effect: { ...ne, amount: -1200 } }], ns, text).size).toBe(1);
  });
  it('R3-1 persisted CEE and pinned schemas keep source_quote byte-identical; Fi writes no reasoning', () => {
    control(); const m = admission.admitCandidateModel(candidate(), undefined, facts);
    const e = m.edges.find(e => e.to === 'monthly_recurring_revenue')!;
    expect(e.provenance?.source_quote).toBe(facts); expect(e.provenance?.reasoning).toBeUndefined();
    for (const parsed of [GraphV3.parse(m), GraphV3Schema.parse(m)]) expect(parsed.edges.find(e => e.to === 'monthly_recurring_revenue')!.provenance).toMatchObject({ source_quote: facts });
  });
  it('R3-5 production missing node unit refuses the stored draw1 £6 support edge', () => {
    control(); const g = draw(1), e = g.edges.find((e: any) => e.from === 'starter_subscribers' && e.to === 'starter_support_cost');
    const nodes = g.nodes.map((n: any) => ({ ...n, unit: n.observed_state?.unit ?? n.goal_threshold_unit ?? n.unit }));
    expect(nodes.find((n: any) => n.id === e.to).unit).toBeUndefined();
    expect(bind([{ ...e, natural_effect: e.provenance.natural_effect }], nodes, brief).size).toBe(0);
  });
});

// Explicit expectations, independent of both production readers. Columns are absent effect / present effect.
const sources = ['brief_extraction', 'cee_hypothesis', 'domain_knowledge', 'user_specified', undefined] as const;
const magnitudes = ['user_stated', 'olumi_estimate', 'olumi_placeholder', 'example_figure', undefined, 'malformed'] as const;
const expectedSizing = {
  user_stated: ['user', 'user', 'user', 'user', 'user'],
  olumi_estimate: ['olumi_estimate', 'olumi_estimate', 'olumi_estimate', 'user', 'olumi_estimate'],
  olumi_placeholder: ['placeholder', 'placeholder', 'placeholder', 'user', 'placeholder'],
  example_figure: ['unmarked', 'unmarked', 'unmarked', 'user', 'unmarked'],
  absent: ['unmarked', 'unmarked', 'unmarked', 'user', 'unmarked'],
  malformed: ['unmarked', 'unmarked', 'unmarked', 'user', 'unmarked'],
} as const;
const expectedCredit = {
  user_stated: [['ai_drafted', 'user_stated'], ['ai_drafted', 'user_stated'], ['ai_drafted', 'user_stated'], ['user_stated', 'user_stated'], ['ai_drafted', 'user_stated']],
  olumi_estimate: [['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['user_stated', 'user_stated'], ['ai_drafted', 'ai_drafted']],
  olumi_placeholder: [['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['user_stated', 'user_stated'], ['ai_drafted', 'ai_drafted']],
  example_figure: [['user_stated', 'user_stated'], ['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['user_stated', 'user_stated'], ['unattributed', 'unattributed']],
  absent: [['user_stated', 'user_stated'], ['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['user_stated', 'user_stated'], ['unattributed', 'unattributed']],
  malformed: [['user_stated', 'user_stated'], ['ai_drafted', 'ai_drafted'], ['ai_drafted', 'ai_drafted'], ['user_stated', 'user_stated'], ['unattributed', 'unattributed']],
} as const;
describe('R3-2 one sizing reader / explicit differential table', () => {
  for (const magnitude of magnitudes) for (const [index, source] of sources.entries()) for (const defaulted of [true, undefined]) for (const effect of [false, true]) {
    it(`${magnitude ?? 'absent'} × ${source ?? 'absent'} × defaulted=${defaulted} × natural_effect=${effect}`, () => {
      control(); const p = { source, magnitude, ...(effect ? { natural_effect: ne } : {}) };
      const e = { defaulted, provenance: p }, key = magnitude ?? 'absent';
      expect(linkSizing(e)).toBe(expectedSizing[key][index]);
      const stamped = magnitude === 'user_stated' || magnitude === 'olumi_estimate' || magnitude === 'olumi_placeholder' || source === 'user_specified';
      const base = expectedCredit[key][index][effect ? 1 : 0];
      expect(edgeStrengthProvenance(e)).toBe(!stamped && defaulted === true && base === 'user_stated' ? 'ai_drafted' : base);
    });
  }
  it.each([false, true])('RT-6 confirmed card shape is credited natural_effect=%s', effect => {
    control(); expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'user_specified', magnitude: 'user_stated', reading: 'agent_proposed_user_confirmed', source_quote: 'Each additional subscribed local café raises monthly wholesale subscription revenue by about £400.', ...(effect ? { natural_effect: { amount: 400, amount_unit: 'GBP per month', per_source_change: 1, per_source_change_unit: 'cafés', strength_mean: 0.4, strength_mean_frame: 'edge_strength' } } : {}) } })).toBe('user_stated');
  });
  it('review-only Olumi estimate stays uncredited', () => {
    control(); const e = { provenance: { source: 'brief_extraction', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } } };
    expect(linkSizing(e)).toBe('olumi_accepted'); expect(edgeStrengthProvenance(e)).toBe('ai_drafted');
  });
});
const FULL = 'At least one of the estimates this comparison rests on is yours, so a leading option can be named.';
const SHORT = 'At least one of the estimates this comparison rests on is yours.';
const ALL = "The sizes of the links that decide it are yours, from your brief. How uncertain they are, and whether each link holds, are Olumi's assumptions.";
describe('MC P0 round3 words', () => {
  it('R3-3 leader mode reason stays base MODE_REASON; only all-yours semantic reason differs', () => {
    control(); const g = draw(2); for (const e of g.edges) if (e.provenance?.natural_effect) e.provenance.magnitude = 'user_stated';
    const all = resolveAnalysisAdmission(g);
    expect(all.permitted_analysis_mode).toBe('comparative_leader');
    expect(all.reasons.find(r => r.field === 'permitted_analysis_mode')?.message).toBe(FULL);
    expect(all.reasons.find(r => r.field === 'semantic_quality_sufficient')?.message).toBe(ALL);
    const olumi = g.edges.find((e: any) => e.from === 'price_increase' && e.to === 'customer_losses_from_price_rise');
    olumi.provenance.magnitude = 'olumi_estimate'; olumi.provenance.reviewed_by_user = { intent: 'confirm' };
    const mixed = resolveAnalysisAdmission(g);
    expect(mixed.reasons.find(r => r.field === 'permitted_analysis_mode')?.message).toBe(FULL);
    expect(mixed.reasons.find(r => r.field === 'semantic_quality_sufficient')?.message).toBe(FULL);
  });
  it.each([
    ['named leader', true, 'raise_prices', undefined, FULL],
    ['target cap no leader', false, undefined, 'target_not_testable', SHORT],
    ['separation twin', false, 'raise_prices', 'separation_unavailable', SHORT],
    ['pre-Run', undefined, undefined, undefined, SHORT],
  ] as const)('R3-4 mixed + %s', (_name, permitted, id, withheld, expected) => {
    control();
    const r = { analysis_ready: { analysis_admission: { permitted_analysis_mode: _name === 'target cap no leader' ? 'exploratory' : 'comparative_leader', reasons: [{ field: 'semantic_quality_sufficient', code: 'CONFIDENCE_PARAMETERS_PARTLY_USER_STATED', message: FULL }] } }, analysis_state: { leader_claim: { permitted, withheld_reason: withheld } }, blocks: [{ type: 'analysis_result', leading_option_id: id }] };
    const projected = (copy as any).authorshipReasonForRun?.(r) ?? r;
    expect(projected.analysis_ready.analysis_admission.reasons[0].message).toBe(expected);
  });
});
