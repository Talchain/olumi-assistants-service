/** The synthetic bakery (never a test brief's words): one canonical model the model-program rows share. */
import type { CanonicalModelT, CanonicalQuantityT } from '../../model-program/canonical.js';

export const BRIEF = 'We bake 300 loaves a week with our one oven and want to reach 380 loaves a week. A second oven adds about 100 loaves a week, or we could keep our one oven. We have £3,000 to spend and don\'t know the oven price yet.';
export const at = { party: null, approval: 'proposed' as const, approved_by: null, author_id: null };
export const q = (id: string, unit: string, f: Partial<CanonicalQuantityT>): CanonicalQuantityT => ({ id, label: id.replace(/_/g, ' '), unit, kind: 'fact', value: null, low: null, high: null,
  range_kind: null, status: 'known', question: null, basis: null, direction: null, floor: null, ceiling: null, author: 'person', quote: null, ...at, ...f });
export function bakery(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the bakery buy a second oven?', period: 'week',
    quantities: [
      q('base_sales', 'loaf/week', { value: 300, quote: 'We bake 300 loaves a week' }),
      q('ovens_added', 'oven', { value: 0, quote: 'our one oven' }),
      q('one_oven', 'oven', { value: 1, quote: 'A second oven' }),
      q('extra_per_oven', 'loaf/week/oven', { kind: 'coefficient', value: 100, quote: 'adds about 100 loaves a week' }),
      q('sell_through', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.7, low: 0.5, high: 0.9, range_kind: 'plausible', basis: 'New capacity sells only as far as demand grows.' }),
      q('sold_per_oven', 'loaf/week/oven', { kind: 'coefficient', status: 'derived', author: 'olumi' }),
      q('sales', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('sales_target', 'loaf/week', { value: 380, quote: 'reach 380 loaves a week' }),
      q('budget', 'GBP', { value: 3000, quote: 'We have £3,000 to spend' }),
      q('oven_price', 'GBP/oven', { status: 'asked', question: 'What would the second oven cost?' }),
      q('spend', 'GBP', { kind: 'derived', status: 'derived', author: 'olumi' }),
    ],
    relations: [
      { form: 'definition', id: 'sold_rel', defines: 'sold_per_oven', op: 'product', parts: [{ id: 'extra_per_oven', power: 1 }, { id: 'sell_through', power: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'effect', id: 'sales_rel', defines: 'sales', base: 'base_sales', terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven', author: 'person', quote: 'A second oven adds about 100 loaves a week', ...at }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'spend_rel', defines: 'spend', op: 'product', parts: [{ id: 'oven_price', power: 1 }, { id: 'ovens_added', power: 1 }], author: 'olumi', quote: null, ...at },
    ],
    goals: [{ id: 'more_loaves', label: 'Reach 380 loaves a week', measure: { quantity: 'sales', per: null, cmp: '>=', target: 'sales_target', frame: 'level', reference: null, aggregation: 'end',
      window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'want to reach 380 loaves a week', ...at }],
    limits: [{ id: 'within_budget', label: 'Within the £3,000', measure: { quantity: 'spend', per: null, cmp: '<=', bound: 'budget', aggregation: 'end', window: null },
      question: null, author: 'person', quote: 'We have £3,000 to spend', ...at }],
    preferences: [],
    options: [
      { id: 'second_oven', label: 'A second oven', sets: [{ quantity: 'ovens_added', to: 'one_oven', value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author: 'person', quote: 'A second oven' }],
        status: 'live', developed_from: null, author: 'person', quote: 'A second oven', ...at },
      { id: 'keep_one', label: 'Keep our one oven', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'keep our one oven', ...at },
    ],
    risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
    title: null, coaching_questions: [],
  };
}
/** The same bakery with one draft defect the compiler names: Olumi's estimate given without its range. */
export function bakeryWithDefect(): CanonicalModelT {
  const m = bakery();
  // A MATHS defect (one end of a range only: the law cannot read it). S1 strip: B8's olumi_no_range is off the path.
  m.quantities = m.quantities.map((x) => (x.id === 'sell_through' ? { ...x, high: null } : x));
  return m;
}


/**
 * THE WITNESS (the PL's ruling, 23 Oct): a known-answer club with a STOCK (members), a LIMIT (the spend within the budget)
 * and ONE Olumi estimate (the promotion's effect, 3–7 extra joins a month around 5, a coefficient on Olumi's link).
 * After three months, members = 300 + 3 × (20 + effect × on − 10):
 *  · carry on: 330 < 340 → exactly 0;  · the promotion: ≥ 340 ⇔ effect ≥ 10/3 → Φ((5 − 3.3333) / (4/√12)) = Φ(1.4434) = 0.92554.
 * The promotion's £500 is within the £800.
 */
export const CLUB_BRIEF = 'We have 300 members today; 20 join each month and 10 leave each month. We want to reach 340 members within three months. Run a promotion, or carry on as now. The promotion costs £500 and we can spend £800.';
const off = (id: string, unit: string, value: number, basis: string) => q(id, unit, { value, author: 'structure', basis });
export function club(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the club run a promotion?', period: 'month',
    quantities: [
      q('members_now', 'member', { value: 300, quote: '300 members today' }),
      q('base_joins', 'member/month', { value: 20, quote: '20 join each month' }),
      off('promo_on', 'promotion', 0, 'The promotion switched off.'),
      off('one_promo', 'promotion', 1, 'The promotion switched on.'),
      q('promo_effect', 'member/month/promotion', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 5, low: 3, high: 7, range_kind: 'plausible', basis: 'Promotions at clubs this size bring a few extra joins a month.' }),
      q('joins', 'member/month', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('leavers', 'member/month', { value: 10, quote: '10 leave each month' }),
      q('members', 'member', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('member_target', 'member', { value: 340, quote: 'reach 340 members' }),
      q('months', 'month', { value: 3, quote: 'within three months' }),
      off('spend', 'GBP', 0, 'Nothing is spent when the promotion is not run.'),
      q('promo_cost', 'GBP', { value: 500, quote: 'The promotion costs £500' }),
      q('budget', 'GBP', { value: 800, quote: 'we can spend £800' }),
    ],
    relations: [
      { form: 'effect', id: 'joins_rel', defines: 'joins', base: 'base_joins', terms: [{ driver: 'promo_on', coefficient: 'promo_effect', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at },
      { form: 'stock', id: 'members_rel', defines: 'members', start: 'members_now', inflows: ['joins'], outflows: ['leavers'], author: 'olumi', quote: null, ...at },
    ],
    goals: [{ id: 'reach_340', label: 'Reach 340 members within three months', measure: { quantity: 'members', per: null, cmp: '>=', target: 'member_target', frame: 'level', reference: null,
      aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'months' }, measure_by: 'person', assumptions: [], exclusions: [] },
      question: null, author: 'person', quote: 'reach 340 members within three months', ...at }],
    limits: [{ id: 'within_budget', label: 'Within the £800', measure: { quantity: 'spend', per: null, cmp: '<=', bound: 'budget', aggregation: 'end', window: null },
      question: null, author: 'person', quote: 'we can spend £800', ...at }],
    preferences: [],
    options: [
      { id: 'promotion', label: 'Run a promotion', sets: [
        { quantity: 'promo_on', to: 'one_promo', value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author: 'person', quote: 'Run a promotion' },
        { quantity: 'spend', to: 'promo_cost', value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author: 'person', quote: 'The promotion costs £500' }],
        status: 'live', developed_from: null, author: 'person', quote: 'Run a promotion', ...at },
      { id: 'carry_on', label: 'Carry on as now', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'carry on as now', ...at },
    ],
    risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
    title: null, coaching_questions: [],
  };
}

/**
 * What a faithful update returns (DL 24 Oct: only what it changes) for a model a row wrote whole: by id, the records that
 * differ from the saved one or are new (an id given twice, each time), the ids it no longer has in remove, and the question
 * and time step only when they change.
 */
export function updateOf(saved: CanonicalModelT, whole: CanonicalModelT): Record<string, unknown> {
  const { version, question, period, history: _history, title: _title, coaching_questions: _coaching, ...families } = whole;
  const remove: string[] = [];
  const out: Record<string, unknown> = { version, question: question === saved.question ? null : question, period: period === saved.period ? null : period };
  for (const [f, rs] of Object.entries(families) as [keyof typeof families, { id: string }[]][]) {
    const was = new Map((saved[f] as { id: string }[]).map((r) => [r.id, JSON.stringify(r)] as const));
    out[f] = rs.filter((r) => was.get(r.id) !== JSON.stringify(r) || rs.filter((x) => x.id === r.id).length > 1);
    remove.push(...[...was.keys()].filter((id) => !rs.some((r) => r.id === id)));
  }
  return { ...out, remove };
}
