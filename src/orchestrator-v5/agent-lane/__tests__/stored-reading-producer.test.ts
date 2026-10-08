import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as identity from '../identity-proposal.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[] };
const PAUL = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Graph;
const edit = (change: (g: Graph) => void = () => {}): Graph => { const g = structuredClone(PAUL); change(g); return g; };
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;
// The missing producer is the RED on #2802's pinned base. Its runtime API is exercised, not a source-text assertion.
const read = (g: Graph) => (identity as typeof identity & { storedReadingOf: (graph: unknown) => unknown }).storedReadingOf(g);
const READING = {
  goal: { id: 'mrr', label: 'MRR' },
  factors: [{ id: 'pro_plan_price', label: 'Pro plan price' }, { id: 'pro_paying_subscribers', label: 'Pro paying subscribers' }],
  addends: [{ id: 'mrr_lost_to_price_driven_churn', label: 'MRR lost to price-driven churn' }],
};
const WORDS = 'Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’. Is that how you work it out?';

describe('GOAL-REACH build 2: one stored-reading producer', () => {
  it('632b92b9 Run-1: exposes the complete reading by identity; the existing card words stay exact', () => {
    const before = JSON.stringify(PAUL);
    expect(read(PAUL)).toEqual(READING);
    expect(identity.proposeProductIdentity(PAUL)?.words).toBe(WORDS);
    expect(JSON.stringify(PAUL)).toBe(before);
  });
  it('the declared factor order and full labels are shared with the card', () => {
    const g = edit(g => { node(g, 'mrr').nonlinear_identity.factor_ids.reverse(); });
    expect(read(g)).toEqual({ ...READING, factors: [...READING.factors].reverse() });
    expect(identity.proposeProductIdentity(g)?.words).toBe('Olumi reads ‘MRR’ as ‘Pro paying subscribers’ × ‘Pro plan price’, less ‘MRR lost to price-driven churn’. Is that how you work it out?');
  });
  it.each(['from_brief', 'user_set', 'user_specified', 'user_stated', 'user'])('an authored direct risk parent (%s) vetoes the reading', source => {
    expect(read(edit(g => { node(g, 'mrr_lost_to_price_driven_churn').provenance = source; }))).toBeNull();
  });
  it('a non-definitional direct parent vetoes; retained_excluded parents do not enter the Run reading', () => {
    const g = edit(g => { delete g.edges.find(e => e.from === 'mrr_lost_to_price_driven_churn' && e.to === 'mrr')!.provenance.definitional; });
    expect(read(g)).toBeNull();
    node(g, 'mrr_lost_to_price_driven_churn').analysis_participation = 'retained_excluded';
    expect(read(g)).toEqual({ ...READING, addends: [] });
  });
  it('price × churn % cannot compose into MRR', () => {
    const g = edit(g => {
      node(g, 'mrr').nonlinear_identity.factor_ids[1] = 'monthly_churn_rate';
      g.edges = g.edges.filter(e => !(e.from === 'pro_paying_subscribers' && e.to === 'mrr'));
      g.edges.push({ from: 'monthly_churn_rate', to: 'mrr' });
    });
    expect(read(g)).toBeNull();
  });
  it('stated MRR £30k contradicts £49 × 300; £14,700 is the reconciliation control', () => {
    const g = edit(g => {
      Object.assign(node(g, 'pro_paying_subscribers').observed_state, { raw_value: 300, value: 0.15 });
      node(g, 'mrr').observed_state = { unit: '£/month', raw_value: 30000, value: 1.2, source: 'brief_extraction' };
    });
    expect(read(g)).toBeNull();
    node(g, 'mrr').observed_state.raw_value = 14700;
    expect(read(g)).toEqual(READING);
  });
  it('two active candidate products veto; one excluded product does not', () => {
    const g = edit(g => { node(g, 'mrr_lost_to_price_driven_churn').nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false }; });
    expect(read(g)).toBeNull();
    node(g, 'mrr_lost_to_price_driven_churn').analysis_participation = 'retained_excluded';
    expect(read(g)).toEqual({ ...READING, addends: [] });
  });
  it('Yes is outside the unconfirmed producer; replacing a factor lapses the reading until its own path holds again', () => {
    expect(read(edit(g => { node(g, 'mrr').nonlinear_identity.stated_in_brief = true; }))).toBeNull();
    const g = edit(g => { node(g, 'mrr').nonlinear_identity.factor_ids[1] = 'new_subscribers'; });
    expect(read(g)).toBeNull();
    g.nodes.push({ ...structuredClone(node(g, 'pro_paying_subscribers')), id: 'new_subscribers', label: 'New subscribers' });
    g.edges = g.edges.filter(e => !(e.from === 'pro_paying_subscribers' && e.to === 'mrr'));
    g.edges.push({ from: 'new_subscribers', to: 'mrr' });
    expect(read(g)).toEqual({ ...READING, factors: [READING.factors[0], { id: 'new_subscribers', label: 'New subscribers' }] });
  });
  it('case 1: a levelless listed addend has no reading; a sized definitional addend can be read without inventing its sign', () => {
    const g = edit(g => { node(g, 'mrr').nonlinear_identity.addends = ['mrr_lost_to_price_driven_churn']; });
    expect(read(g)).toBeNull();
    node(g, 'mrr_lost_to_price_driven_churn').observed_state = { raw_value: 1000, unit: '£/month', value: 0.05, source: 'cee_inference' };
    expect(read(g)).toEqual(READING);
    expect(read(g)).not.toHaveProperty('addends.0.sign');
  });
  it('pre-#2300: reuses the existing legacy card reading without persisting its temporary identity', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8'));
    const g = fixture.runs[0].graph as Graph;
    expect(node(g, 'mrr').nonlinear_identity).toBeUndefined();
    const before = JSON.stringify(g);
    expect(read(g)).toEqual({ goal: { id: 'mrr', label: 'MRR' }, factors: [{ id: 'pro_plan_price', label: 'Pro plan price' }, { id: 'paying_subscribers', label: 'Paying subscribers' }], addends: [] });
    expect(JSON.stringify(g)).toBe(before);
  });
});
