import type { LivingModelT } from '../../../../schemas/living-model.js';

/**
 * TRACK 2 F1 (21 Oct 2026): a deterministic breakdown, stated as a person would state it.
 * "We have 100 UK customers and 50 in the EU, so 150 in total; each pays £40 a month, so £6,000 today. We need at least
 * £6,500. Either we carry on, or we grow the UK to 120." Analytic: carry on 150 × £40 = £6,000 (never meets);
 * grow UK 170 × £40 = £6,800 (always meets). Nothing here is uncertain, so the chance is 0 and 1, with no spread.
 */
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const exact = (value: number, unit: string) => ({ form: 'exact' as const, estimate_by: null, value, sd: null, low: null, high: null, unit, sign: '+' as const });
const level = (id: string, label: string, value: number, unit: string, quote: string) =>
  ({ id, label, kind: 'factor' as const, estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(quote) });

const AIM = { id: 'rev', text: 'Monthly revenue of at least £6,500', status: 'current' as const, ...who('we need at least £6,500 a month; today it is £6,000'),
  target: { quantity: 'monthly revenue', comparator: '>=' as const, value: 6500, low: null, high: null, unit: '£', by_when: null, period_months: null, baseline: 'today',
    current: 6000, current_source: null, current_unit: null, change_kind: null, source: null } };
const OPTIONS: LivingModelT['options'] = [
  { status: 'feasible', id: 'hold', label: 'Carry on', settings: [], developed_from: null, ...who('or we carry on as now') },
  { status: 'feasible', id: 'grow_uk', label: 'Grow the UK', developed_from: null, ...who('grow the UK to 120 customers'),
    settings: [{ factor_id: 'uk', estimate_by: null, value: 120, low: null, high: null, unit: 'customers', ...who('grow the UK to 120 customers') }] },
];
const UK = level('uk', 'UK customers', 100, 'customers', 'we have 100 UK customers');
const EU = level('eu', 'EU customers', 50, 'customers', 'and 50 in the EU');
const PRICE = level('price', 'Price per customer', 40, '£ per customer per month', 'each pays £40 a month');
const TOTAL = { ...level('total', 'Total customers', 150, 'customers', 'so 150 customers in total'),
  defined_as: { op: 'sum' as const, of: ['uk', 'eu'], ...who('total customers is UK plus EU') } };
const REVENUE_IS = { op: 'product' as const, of: ['total', 'price'], ...who('revenue is customers times the price') };

/** The person's definitions, declared: total = UK + EU; revenue = total × price. No links: a definition is not a cause. */
export const F1_DEFINED: LivingModelT = {
  aims: [{ ...AIM, defined_as: REVENUE_IS }],
  options: OPTIONS, factors: [UK, EU, TOTAL, PRICE], links: [], risks: [], conditions: [], views: [], history: [],
};

/** Buddy r1: the goal AT the defined figure (£6,800). Grow the UK meets it in every draw, so its chance is 1, never ~50%. */
export const F1_AT_LIMIT: LivingModelT = { ...F1_DEFINED,
  aims: [{ ...AIM, text: 'Monthly revenue of at least £6,800', target: { ...AIM.target, value: 6800 }, defined_as: REVENUE_IS }] };

/** The same reasoning, coarse: total customers is the lever (150 → 170). An equivalent decomposition must agree with it. */
export const F1_COARSE: LivingModelT = {
  ...F1_DEFINED,
  options: [OPTIONS[0]!, { ...OPTIONS[1]!, settings: [{ factor_id: 'total', estimate_by: null, value: 170, low: null, high: null, unit: 'customers', ...who('grow to 170 customers') }] }],
  factors: [{ ...TOTAL, defined_as: null }, PRICE],
};

/** The definitions AND the person's own exact links between the same items: the links restate it, never count twice. */
export const F1_RESTATED: LivingModelT = {
  ...F1_DEFINED,
  links: [
    { id: 'uk_total', from: 'uk', to: 'total', ...who('total customers is UK plus EU'), effect: exact(1, 'customers') },
    { id: 'eu_total', from: 'eu', to: 'total', ...who('total customers is UK plus EU'), effect: exact(1, 'customers') },
  ],
};

/** CONTROL, unchanged by the identity diff: the breakdown written only as exact links still withholds (`exact_not_drawable`). */
export const F1_EXACT_LINKS: LivingModelT = {
  aims: [{ ...AIM, defined_as: null }], options: OPTIONS, factors: [UK, EU, { ...TOTAL, defined_as: null }], risks: [], conditions: [], views: [], history: [],
  links: [
    { id: 'uk_total', from: 'uk', to: 'total', ...who('total customers is UK plus EU'), effect: exact(1, 'customers') },
    { id: 'eu_total', from: 'eu', to: 'total', ...who('total customers is UK plus EU'), effect: exact(1, 'customers') },
    { id: 'total_rev', from: 'total', to: 'rev', ...who('each customer pays £40 a month'), effect: exact(40, '£') },
  ],
};

/** NEGATIVE: units that do not compose (£ per ORDER × customers is not £) are refused by name, never filled in. */
export const F1_UNIT_MISMATCH: LivingModelT = { ...F1_DEFINED, factors: [UK, EU, TOTAL, { ...PRICE, unit: '£ per order per month' }] };

/** NEGATIVE: a stated total that is not UK + EU (160 ≠ 150) is not a definition the engine can work out; it refuses. */
export const F1_INCONSISTENT: LivingModelT = { ...F1_DEFINED, factors: [UK, EU, { ...TOTAL, value: 160 }, PRICE] };

/** NEGATIVE (buddy r1): revenue today £6,100 is not 150 × £40; the engine would rescale Grow the UK to £6,913. Refused. */
export const F1_LEVEL_NOT_MADE: LivingModelT = { ...F1_DEFINED, aims: [{ ...AIM, target: { ...AIM.target, current: 6100 }, defined_as: REVENUE_IS }] };

/** NEGATIVE (buddy r1): the person's UK → total at −2 contradicts total = UK + EU; never silently dropped. */
export const F1_CONTRADICTED: LivingModelT = { ...F1_DEFINED,
  links: [{ id: 'uk_total', from: 'uk', to: 'total', ...who('each UK customer takes two off the total'),
    effect: { form: 'point', estimate_by: null, value: 2, sd: null, low: null, high: null, unit: 'customers', sign: '-' } }] };

/** Buddy r1: the person stated the goal, but the DEFINITION of revenue is Olumi's reading, so it is not the brief's. */
export const F1_OLUMI_READING: LivingModelT = { ...F1_DEFINED,
  aims: [{ ...AIM, defined_as: { ...REVENUE_IS, source: 'olumi', quote: null } }] };

/** NEGATIVE: definitions defined by each other (total = UK + rest; rest = total − … ) are refused, never sent. */
export const F1_CYCLE: LivingModelT = { ...F1_DEFINED, factors: [UK, EU,
  { ...TOTAL, defined_as: { ...TOTAL.defined_as, of: ['uk', 'rest'] } },
  { ...level('rest', 'Other customers', 50, 'customers', 'the rest'), defined_as: { op: 'sum', of: ['total', 'eu'], ...who('the rest') } }, PRICE] };

const MKT = level('mkt', 'UK marketing spend', 0, '£k', 'we spend nothing on UK marketing');
const SPEND: LivingModelT['options'] = [OPTIONS[0]!, { status: 'feasible', id: 'spend', label: 'Spend on UK marketing', developed_from: null, ...who('spend £2k a month on UK marketing'),
  settings: [{ factor_id: 'mkt', estimate_by: null, value: 2, low: null, high: null, unit: '£k', ...who('spend £2k a month on UK marketing') }] }];
const ABOUT_10 = { form: 'point' as const, estimate_by: null, value: 10, sd: null, low: null, high: null, unit: 'customers', sign: '+' as const };

/**
 * NEGATIVE CONTROL: a genuinely uncertain cause stays uncertain. "Each £1k of UK marketing adds about 10 UK customers" is a
 * stated point into a PART, so it keeps Olumi's illustrative spread (σ = |β|/2): ΔUK ~ N(20, 10), revenue meets £6,500
 * when ΔUK ≥ 12.5, so P = Φ(0.75) ≈ 0.773. The definition must not make it exact.
 */
export const F1_STOCHASTIC_PART: LivingModelT = {
  ...F1_DEFINED, options: SPEND, factors: [MKT, ...F1_DEFINED.factors],
  links: [{ id: 'mkt_uk', from: 'mkt', to: 'uk', ...who('each £1k of marketing adds about 10 UK customers'), effect: ABOUT_10 }],
};

/** NEGATIVE: a cause into the defined total itself is one the definition leaves out, so the chance is withheld. */
export const F1_OTHER_CAUSE: LivingModelT = {
  ...F1_STOCHASTIC_PART,
  links: [{ id: 'mkt_total', from: 'mkt', to: 'total', ...who('each £1k of marketing adds about 10 customers'), effect: ABOUT_10 }],
};
