import { describe, it, expect } from 'vitest';
import * as admission from '../admit-model.js';
import type { CandidateModel } from '../admit-model.js';
import { figureTheUserWroteFor } from '../stated-by-user.js';

const sentence = 'Each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.';
const nodes = [{ id: 'price', unit: '%' }, { id: 'mrr', unit: '£/month' }, { id: 'other', unit: 'subscribers' }, { id: 'cost', unit: '£/year' }];
const link = () => ({ from: 'price', to: 'mrr', effect_direction: 'positive', natural_effect: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' } });
type Link = ReturnType<typeof link>;
// Optional only for the base RED run: the old producer has no deterministic C2 door.
const bind = (links: Link[], text = sentence, ns = nodes): Map<number, string> =>
  (admission as unknown as { bindStatedLinkSizes?: (l: Link[], n: typeof nodes, b: string) => Map<number, string> }).bindStatedLinkSizes?.(links, ns, text) ?? new Map();
const control = () => expect(bind([link()]).get(0)).toBe(sentence);
const candidate = (): CandidateModel => ({
  goal: { metric: 'monthly recurring revenue', operator: '>=', value: 150000, unit: '£/month', horizon_months: 9, provenance: 'explicit' },
  options: [{ label: 'Raise prices', provenance: 'explicit', changes: ['Price increase'], interventions: [{ factor_label: 'Price increase', value: 10, unit: '%', provenance: 'explicit' }] }, { label: 'Keep pricing', provenance: 'explicit', is_status_quo: true }],
  factors: [{ label: 'Price increase', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred' }],
  risks: [{ label: 'Customer losses from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 400 }], outcomes: [], constraints: [],
  links: [{ from: 'Price increase', to: 'monthly recurring revenue', direction: 'positive', provenance: 'explicit', effect_amount: 1200, effect_per_source_change: 1, effect_provenance: 'explicit' }],
});

describe('MC P0 Fi: an added C2 size door, with C1/W3/SIGN-1', () => {
  it('draw-2 wording misses the strict label door but stores a user size AND the sentence through admission', () => {
    const c = candidate();
    const strict = (v: number, u: unknown, s: {target: readonly string[]; others: readonly string[]}) => figureTheUserWroteFor(v, u, sentence, { ...s, strict: true });
    expect(strict(1200, '£/month', { target: ['Price increase', 'monthly recurring revenue'], others: ['Customer losses from price rise'] })).toBe(false);
    const m = admission.admitCandidateModel(c, undefined, sentence, undefined, undefined, undefined, strict);
    const e = m.edges.find(e => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue')!;
    expect(e.provenance?.magnitude).toBe('user_stated');
    expect(e.provenance?.natural_effect?.amount).toBe(1200);
    expect(e.provenance?.source_quote).toBe(sentence);
    expect(e.defaulted).toBe(true); // spread/existence remain projected
  });
  it('split figures over two sentences never bind', () => {
    control();
    expect(bind([link()], 'A price rise is 1%. It adds £1,200 a month to monthly recurring revenue.').size).toBe(0);
  });
  it('one sentence matching two links binds neither (including other endpoints)', () => {
    control();
    expect(bind([link(), { ...link(), effect_direction: 'negative' }]).size).toBe(0); // W3 precedes sign eligibility
    expect(bind([link(), { ...link(), from: 'other', natural_effect: { ...link().natural_effect, per_source_change_unit: 'subscribers' } }], 'Each 1% price rise or each subscriber adds £1,200 a month.').size).toBe(0);
  });
  it('one link matching two sentences binds neither occurrence', () => {
    control();
    expect(bind([link()], `${sentence} ${sentence}`).size).toBe(0);
  });
  it('a second £1,200 link lacking a per literal in its sentence is not promoted (amount-only trap)', () => {
    control();
    const other = { ...link(), from: 'other', to: 'cost', natural_effect: { ...link().natural_effect, amount_unit: '£/year', per_source_change_unit: 'subscribers', per_source_change: 2 } };
    const b = bind([link(), other], `${sentence} Support costs £1,200 a year.`);
    expect([...b.keys()]).toEqual([0]);
  });
  it('C1: a typed end in a different node unit binds nothing', () => {
    control();
    expect(bind([link()], sentence, nodes.map(n => n.id === 'mrr' ? { ...n, unit: '£/year' } : n)).size).toBe(0);
    expect(bind([link()], sentence, nodes.map(n => n.id === 'price' ? { ...n, unit: 'subscribers' } : n)).size).toBe(0);
  });
  it('SIGN-1: a negative-negative twin stays Olumi’s', () => {
    control();
    expect(bind([{ ...link(), natural_effect: { ...link().natural_effect, amount: -1200, per_source_change: -1 } }]).size).toBe(0);
  });
  it('SIGN-1: determiner per with negative source change stays Olumi’s', () => {
    control();
    expect(bind([{ ...link(), from: 'other', effect_direction: 'negative', natural_effect: { ...link().natural_effect, per_source_change: -1, per_source_change_unit: 'subscribers' } }], 'Each subscriber adds £1,200 a month.').size).toBe(0);
  });
  it('direction disagreeing with amount × per binds nothing; neither values nor units change', () => {
    control();
    const l = { ...link(), effect_direction: 'negative' }; const before = JSON.stringify(l);
    expect(bind([l]).size).toBe(0); expect(JSON.stringify(l)).toBe(before);
  });
  it('the strict label door remains an OR door, and a user_specified edit wins without a brief', () => {
    control();
    const c = candidate();
    // This control isolates the already injected label door: the C2 door refuses split figures.
    const m = admission.admitCandidateModel(c, undefined, 'A price rise is 1%. It adds £1,200 a month.', undefined, undefined, undefined, () => true);
    expect(m.edges.find(e => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue')?.provenance?.magnitude).toBe('user_stated');
    const edit = { ...c, links: c.links.map(l => ({ ...l, provenance_source: 'user_specified' })) };
    expect(admission.admitCandidateModel(edit).edges.find(e => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue')?.provenance?.magnitude).toBe('user_stated');
  });
});
