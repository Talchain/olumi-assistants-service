import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, withGoalChanceLicence, goalChanceLicenceForAgent } from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../../agent-lane/goal-chance-screen-lines.js';

type Rec = Record<string, any>;
const PAUL = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8'));
const LOSS = 'mrr_lost_to_price_driven_churn';
const g = (): Rec => structuredClone(PAUL);
const n = (graph: Rec, id: string): Rec => graph.nodes.find((x: Rec) => x.id === id);
const options = () => [{ id: 'keep_49_pro_price', interventions: { pro_plan_price: 49 } }, { id: 'raise_pro_price_to_59', interventions: { pro_plan_price: 59 } }];
const response = (): Rec => ({ option_comparison: options().map((o, i) => ({ option_id: o.id, probability_of_goal: i ? .62 : .41 })),
  identity_evaluations: [{ node_id: 'mrr', evaluated: true }] });
type Context = { storedGraph: Rec; wireGraph: Rec; options: Rec[]; confirmationAvailable: boolean };
const context = (stored = g(), wire = structuredClone(stored)): Context => {
  n(wire, 'mrr').nonlinear_identity.reading_licence = 'olumi_reading';
  return { storedGraph: stored, wireGraph: wire, options: options(), confirmationAvailable: true };
};
const licence = (c = context(), r = response()): Rec | null => goalChanceLicenceOf(r, c.storedGraph, 'mrr', () => false, undefined, c) as Rec | null;
const EXPECTED = "‘Raise Pro price to £59’: about 62% chance of meeting your goal, in this model, if ‘MRR’ = ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’ (Olumi's reading; that loss has no figure yet, so Olumi's stand-in for it is used).";

describe('GR2 Run-bound reading licence (Science addendum 4)', () => {
  it('Paul 632b92b9 case (2): structured whole reading + exact stand-in sentence per option', () => {
    const l = licence()!;
    expect(l?.reading_label).toEqual({ v: 1, source: 'olumi_reading', goal: { id: 'mrr', label: 'MRR' }, factors: [
      { id: 'pro_plan_price', label: 'Pro plan price' }, { id: 'pro_paying_subscribers', label: 'Pro paying subscribers' }],
      addends: [{ id: LOSS, label: 'MRR lost to price-driven churn', sign: 'less', sized: false }] });
    expect(l?.form).toBe('each');
    expect(l?.reading_sentence_by_option.raise_pro_price_to_59).toBe(EXPECTED);
  });
  it('stamped on this Run + evaluated are both required; no complete label withholds with reason', () => {
    for (const edit of [
      (c: Rec) => { delete n(c.wireGraph, 'mrr').nonlinear_identity.reading_licence; },
      (c: Rec) => { c.confirmationAvailable = false; },
      (c: Rec) => { n(c.wireGraph, 'mrr').nonlinear_identity.factor_ids = ['pro_plan_price', 'monthly_churn_rate']; },
    ]) { const c = context(); edit(c); expect(licence(c)).toBeNull(); }
    const r = response(); r.identity_evaluations[0].evaluated = false; expect(licence(context(), r)).toBeNull();
    const c = context(); c.confirmationAvailable = false;
    const withheld = withGoalChanceLicence(response(), c.storedGraph, 'mrr', undefined, undefined, c) as Rec;
    expect(withheld.option_comparison.every((o: Rec) => o.probability_of_goal === undefined)).toBe(true);
    expect(withheld.inference_warnings?.some((w: Rec) => w.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED' && w.message)).toBe(true);
  });
  it.each(['unit', 'risk', 'contradiction', 'two'] as const)('NEG %s: no licence or figure', edit => {
    const c = context();
    if (edit === 'unit') n(c.storedGraph, 'pro_paying_subscribers').observed_state.unit = '%';
    if (edit === 'risk') n(c.storedGraph, LOSS).provenance = 'from_brief';
    if (edit === 'contradiction') n(c.storedGraph, 'mrr').observed_state = { raw_value: 30000, unit: '£/month', source: 'brief_extraction' };
    if (edit === 'two') n(c.storedGraph, LOSS).nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false };
    expect(licence(c)).toBeNull();
    const withheld = withGoalChanceLicence(response(), c.storedGraph, 'mrr', undefined, undefined, c) as Rec;
    expect(withheld.option_comparison.every((o: Rec) => o.probability_of_goal === undefined)).toBe(true);
    expect(withheld.inference_warnings.some((w: Rec) => w.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED' && w.message)).toBe(true);
  });
  it('case (1): a levelless LISTED addend has no licence/figure', () => {
    const c = context(); n(c.storedGraph, 'mrr').nonlinear_identity.addends = [LOSS]; n(c.wireGraph, 'mrr').nonlinear_identity.addends = [LOSS];
    expect(licence(c)).toBeNull();
  });
  it.each([-1000, 1000])('SIGN: listed executed value %s wins over negative edge', value => {
    const c = context();
    for (const graph of [c.storedGraph, c.wireGraph]) {
      n(graph, LOSS).observed_state = { raw_value: value, value: value / 20000, unit: '£/month', source: 'cee_inference' };
      n(graph, 'mrr').nonlinear_identity.addends = [LOSS];
    }
    const l = licence(c)!;
    expect(l?.reading_label.addends[0]).toEqual({ id: LOSS, label: 'MRR lost to price-driven churn', sign: value < 0 ? 'less' : 'plus', sized: true });
    expect(l?.reading_sentence_by_option.raise_pro_price_to_59).toContain(`, ${value < 0 ? 'less' : 'plus'} ‘MRR lost to price-driven churn’ (Olumi's reading).`);
    expect(l?.reading_sentence_by_option.raise_pro_price_to_59).not.toContain('stand-in');
  });
  it('placeholder range keeps its gate and receives the exact same whole inline reading', () => {
    const c = context(); const r = response();
    delete r.option_comparison[1].probability_of_goal;
    r.inference_warnings = [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', option_ids: ['raise_pro_price_to_59'], severity: 'warning', message: 'Not sized.' },
      { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Range licensed.', option_ids: ['raise_pro_price_to_59'], range_by_option: {
        raise_pro_price_to_59: { low_pct: 20, high_pct: 70, low_rounding: 'whole', high_rounding: 'whole', kind: 'link_strength',
          from: LOSS, to: 'mrr', among: 'unsized_links' } } }];
    const saved = { enrichment: withGoalChanceLicence(r, c.storedGraph, 'mrr', undefined, undefined, c) };
    const line = goalChanceScreenLinesForAgent(saved, c.storedGraph, true).find(l => l.option_id === 'raise_pro_price_to_59');
    expect(line?.chance).toBe(EXPECTED.replace('about 62%', 'between about 20% and 70%'));
    expect((saved.enrichment as Rec).option_comparison[1].probability_of_goal).toBeUndefined();
  });
  it('CONTROL Yes/T1b: stated true is plain, unstamped, no label', () => {
    const graph = g(); n(graph, 'mrr').nonlinear_identity.stated_in_brief = true;
    const l = goalChanceLicenceOf(response(), graph, 'mrr') as Rec;
    expect(l?.pct_by_option.raise_pro_price_to_59).toBe(62);
    expect(l).not.toHaveProperty('reading_label');
  });
  it('same Run record survives cold reload; screen and owed chat consume exact sentence', () => {
    const c = context(); const record = withGoalChanceLicence(response(), c.storedGraph, 'mrr', undefined, undefined, c);
    const saved = JSON.parse(JSON.stringify({ enrichment: record }));
    expect(goalChanceLicenceForAgent(saved)).toHaveProperty('reading_label');
    const lines = goalChanceScreenLinesForAgent(saved, c.storedGraph, true);
    expect(lines.find(l => l.option_id === 'raise_pro_price_to_59')?.chance).toBe(EXPECTED);
    expect(withScreenLinesOwed('Your results are ready.', lines).text).toContain(EXPECTED);
    const mutant = structuredClone(saved);
    const l = mutant.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
    delete l.reading_label;
    expect(goalChanceScreenLinesForAgent(mutant, c.storedGraph, true)).toEqual([]);
    delete l.reading_sentence_by_option;
    expect(goalChanceScreenLinesForAgent(mutant, c.storedGraph, true)).toEqual([]);
  });
});
