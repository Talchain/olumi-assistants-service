/** The drafter's worked example (prompt.ts DRAFTING_INSTRUCTIONS, r10) as one canonical model: see estimates-example.test.ts. */
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { at, q } from './bakery.fixture.js';

export const BRIEF = 'We sell 400 loaves a week from our one oven and have £5,000 to spend. Should we buy a second oven? It adds 150 loaves a week of capacity. We want to sell 500 loaves a week without going over budget, and to grow the bakery.';
const olumi = { author: 'olumi' as const, quote: null };
const est = (value: number, low: number, high: number, basis: string) => ({ status: 'estimated' as const, ...olumi, value, low, high, range_kind: 'plausible' as const, basis });
const set = (quantity: string, to: string, author: 'person' | 'olumi', quote: string | null) =>
  ({ quantity, to, value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author, quote });

export function example(withRisk = true): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the bakery buy a second oven?', title: 'Second oven?', period: 'week',
    quantities: [
      q('base_sales', 'loaf/week', { value: 400, quote: 'sell 400 loaves a week', floor: 0 }),
      q('extra_capacity', 'loaf/week', { value: 150, quote: 'adds 150 loaves a week of capacity', floor: 0 }),
      q('budget', 'GBP', { value: 5000, quote: '£5,000 to spend' }),
      q('sales_target', 'loaf/week', { value: 500, quote: 'sell 500 loaves a week' }),
      q('added_capacity', 'loaf/week', { value: 0, ...olumi, basis: 'capacity the choice adds; carrying on adds none', floor: 0 }),
      q('hours_capacity', 'loaf/week', { ...est(40, 20, 80, 'typical for two more bakes a day from one oven'), floor: 0 }),
      q('sell_share', '1', { kind: 'coefficient', ...est(0.7, 0.4, 0.95, 'share of new capacity a small bakery typically sells; their unmet demand decides it'), floor: 0, ceiling: 1 }),
      q('extra_sales', 'loaf/week', { kind: 'derived', status: 'derived', ...olumi }),
      q('sales', 'loaf/week', { kind: 'derived', status: 'derived', ...olumi }),
      q('spend', 'GBP', { value: 0, ...olumi, basis: 'what the choice costs; carrying on costs nothing', floor: 0 }),
      q('oven_price', 'GBP', { ...est(4000, 2000, 9000, 'typical for a small deck oven, used to new'), floor: 0 }),
      q('grow_target', 'loaf/week', { status: 'asked', ...olumi, question: 'How many more loaves a week would count as growing?' }),
      ...(withRisk ? [
        q('rival_chance', '1', { kind: 'coefficient', ...est(0.15, 0.05, 0.3, 'a rough rate for a new rival near a small bakery'), floor: 0, ceiling: 1 }),
        q('rival_kept', '1', { kind: 'coefficient', ...est(0.8, 0.6, 0.95, 'share of new sales kept if one opens'), floor: 0, ceiling: 1 }),
      ] : []),
    ],
    relations: [
      { form: 'definition', id: 'extra_sales_rel', defines: 'extra_sales', op: 'product', parts: [{ id: 'added_capacity', power: 1 }, { id: 'sell_share', power: 1 }], ...olumi, ...at },
      { form: 'definition', id: 'sales_rel', defines: 'sales', op: 'sum', parts: [{ id: 'base_sales', sign: 1 }, { id: 'extra_sales', sign: 1 }], ...olumi, ...at },
    ],
    goals: [
      { id: 'sell_500', label: 'Sell 500 loaves a week', measure: { quantity: 'sales', per: null, cmp: '>=', target: 'sales_target', frame: 'level', reference: null, aggregation: 'end',
        window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'We want to sell 500 loaves a week', ...at },
      { id: 'grow', label: 'Grow the bakery', measure: { quantity: 'sales', per: null, cmp: '>=', target: 'grow_target', frame: 'change_abs', reference: { kind: 'value', option: null, quantity: 'base_sales' },
        aggregation: 'end', window: null, measure_by: 'olumi', assumptions: [], exclusions: ['beyond_loaves'] }, question: null, author: 'person', quote: 'to grow the bakery', ...at },
    ],
    limits: [{ id: 'in_budget', label: 'Within the £5,000', measure: { quantity: 'spend', per: null, cmp: '<=', bound: 'budget', aggregation: 'end', window: null },
      question: null, author: 'person', quote: 'without going over budget', ...at }],
    preferences: [],
    options: [
      { id: 'second_oven', label: 'Second oven', sets: [set('added_capacity', 'extra_capacity', 'person', 'buy a second oven'), set('spend', 'oven_price', 'olumi', null)],
        status: 'live', developed_from: null, carry_on: false, author: 'person', quote: 'buy a second oven', ...at },
      { id: 'longer_hours', label: 'Longer baking hours', sets: [set('added_capacity', 'hours_capacity', 'olumi', null)], status: 'live', developed_from: null, carry_on: false, ...olumi, ...at },
      { id: 'carry_on', label: 'Carry on as now', sets: [], status: 'live', developed_from: null, carry_on: true, ...olumi, ...at },
    ],
    risks: withRisk ? [{ id: 'rival', label: 'A supermarket bakery opens nearby', occurrence: 'rival_chance', severity: 'rival_kept', effect_on: 'sell_share', direction: 'down',
      mode: 'multiply', starts_after_periods: 0, ...olumi, ...at }] : [],
    claims: [], evidence: [],
    assumptions: [{ id: 'oven_alone', text: 'The £5,000 is for the oven alone', applied: true, concerns: ['in_budget'], ...olumi, ...at }],
    dissent: [],
    conditions: [{ id: 'staff_cover', text: 'Only if staff can cover the longer hours', kind: 'prerequisite', concerns: ['longer_hours'], ...olumi, ...at }],
    left_out: [{ id: 'beyond_loaves', text: 'Growth beyond loaf sales, such as new lines', why: 'Not in this model.', question: null, concerns: ['grow'], ...olumi, ...at }],
    coaching_questions: ['How many of the extra 150 loaves a week do you expect to sell?', 'What would the second oven cost?', 'Is the £5,000 for the oven alone, or for everything this choice needs?'],
    decide_by: null,
    history: [],
  };
}

