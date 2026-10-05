import sealedSource from '../stated-natural-effects.test.ts?raw';
import type { DraftRecordSet, DraftStatedRelationship, DraftValueRange } from '../../grammar.js';

// The sealed source is imported as text because its BRIEF is intentionally not exported.
// Decode only JS string literals in that declaration; never edit or execute its tests.
const declaration = sealedSource.slice(sealedSource.indexOf('const BRIEF =') + 'const BRIEF ='.length);
const literals = declaration.slice(0, declaration.indexOf(';')).match(/"(?:[^"\\]|\\.)*"/gu);
if (literals === null) throw new Error('sealed BRIEF declaration is unreadable');
export const BRIEF: string = literals.map(literal => JSON.parse(literal) as string).join('');

const baseline = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month.';
const goal = 'Goal: reach at least £150,000 monthly recurring revenue within 9 months.';
const gross = 'each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.';
const churn = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const loss = 'Each lost customer removes £300 a month of monthly recurring revenue.';
const subscribers = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const subscription = 'Each starter subscriber adds £49 a month to monthly recurring revenue.';
const support = 'Each starter subscriber costs about £6 a month in support.';
function span(quote: string, literal: string) {
  const start = quote.indexOf(literal);
  if (start < 0) throw new Error(`fixture span not found: ${literal}`);
  return { start, end: start + literal.length };
}
function range(quote: string, low: number, high: number, unit: string): DraftValueRange {
  return { low, high, unit, meaning: 'min_max', low_span: { start: quote.lastIndexOf(String(low)), end: quote.lastIndexOf(String(low)) + String(low).length }, high_span: span(quote, String(high)) };
}
function relationship(quote: string, from_quantity: number, to_quantity: number, amount: number, amount_unit: string,
  per_source_change_unit: string, amountLiteral: string, sourceLiteral: string): DraftStatedRelationship {
  return { from_quantity, to_quantity, amount, amount_unit, per_source_change: 1, per_source_change_unit,
    amount_span: span(quote, amountLiteral), source_span: span(quote, sourceLiteral) };
}

/** Hand-typed business figures and topology. No extraction or provider is used to build this set. */
export function sealedRecords(): DraftRecordSet {
  return { stated_items: [
    /* 0 */ { kind: 'figure', source_quote: baseline, value: 120000, unit: '£/month', role: 'baseline', quantity: 0, value_span: span(baseline, '£120,000'), unit_span: span(baseline, 'monthly') },
    /* 1 */ { kind: 'figure', source_quote: '400 customers', value: 400, unit: 'customers', role: 'baseline', quantity: 1 },
    /* 2 */ { kind: 'figure', source_quote: '£300 a month', value: 300, unit: '£/month', role: 'baseline', quantity: 2 },
    /* 3 */ { kind: 'option', source_quote: 'raise prices by 10%', value: 10, unit: '%', role: 'context', is_baseline: false },
    /* 4 */ { kind: 'option', source_quote: 'launch a starter tier at £49 a month', value: 49, unit: '£/month', role: 'context', is_baseline: false },
    /* 5 */ { kind: 'option', source_quote: 'keep pricing as it is', is_baseline: true },
    /* 6 */ { kind: 'goal', source_quote: goal, value: 150000, baseline: 120000, unit: '£/month', role: 'target', quantity: 0, baseline_ref: 0, horizon_months: 9, horizon_ref: 7, direction: 'floor', direction_span: span(goal, 'at least'), value_span: span(goal, '£150,000'), unit_span: span(goal, 'monthly') },
    /* 7 */ { kind: 'figure', source_quote: 'within 9 months', value: 9, unit: 'months', role: 'context', quantity: 7, value_span: span('within 9 months', '9'), unit_span: span('within 9 months', 'months') },
    /* 8 */ { kind: 'cause', source_quote: gross, unit: '%', quantity: 8, relationship: relationship(gross, 8, 0, 1200, '£/month', '%', '£1,200', '1%') },
    /* 9 */ { kind: 'cause', source_quote: churn, value: 2, unit: 'customers', quantity: 9,
      relationship: relationship(churn, 8, 9, 2, 'customers', '%', '2', '1%'), range: range(churn, 1, 4, 'customers') },
    /* 10 */ { kind: 'cause', source_quote: loss, relationship: relationship(loss, 9, 0, -300, '£/month', 'customers', '£300', 'Each') },
    /* 11 */ { kind: 'figure', source_quote: subscribers, value: 150, unit: 'subscribers', role: 'context', quantity: 11, range: range(subscribers, 80, 250, 'subscribers') },
    /* 12 */ { kind: 'cause', source_quote: subscription, relationship: relationship(subscription, 11, 0, 49, '£/month', 'subscribers', '£49', 'Each') },
    /* 13 */ { kind: 'cause', source_quote: support, unit: '£/month', quantity: 13, relationship: relationship(support, 11, 13, 6, '£/month', 'subscribers', '£6', 'Each') },
    /* 14 */ { kind: 'figure', source_quote: 'Keeping pricing as it is adds nothing.', value: 0, unit: 'subscribers', role: 'context' },
    /* 15 */ { kind: 'figure', source_quote: 'raise prices by 10%', value: 10, unit: '%', role: 'context', quantity: 8 },
  ], claims: [
    /* 0 */ { claim_kind: 'factor', label: 'Price rise', value: 0, unit: '%', value_scale: 'raw_count', quantity: 8 },
    /* 1 */ { claim_kind: 'factor', label: 'Starter subscribers', value: 0, unit: 'subscribers', value_scale: 'raw_count', quantity: 11 },
    /* 2 */ { claim_kind: 'factor', label: 'Customers lost', value: 0, unit: 'customers', value_scale: 'raw_count', quantity: 9 },
    /* 3 */ { claim_kind: 'outcome', label: 'Monthly recurring revenue', value: 120000, unit: '£/month', quantity: 0 },
    /* 4 */ { claim_kind: 'outcome', label: 'Monthly support cost', value: 0, unit: '£/month', quantity: 13 },
    /* 5 */ { claim_kind: 'causal_link', label: 'Gross price effect', from_claim: 0, to_claim: 3, effect: 'positive', basis: [8], effect_detail: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' } },
    /* 6 */ { claim_kind: 'causal_link', label: 'Churn effect', from_claim: 0, to_claim: 2, effect: 'positive', basis: [9], effect_detail: { amount: 2, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: '%', range: range(churn, 1, 4, 'customers') } },
    /* 7 */ { claim_kind: 'causal_link', label: 'Lost-customer revenue effect', from_claim: 2, to_claim: 3, effect: 'negative', basis: [10], effect_detail: { amount: -300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'customers' } },
    /* 8 */ { claim_kind: 'causal_link', label: 'Subscriber revenue effect', from_claim: 1, to_claim: 3, effect: 'positive', basis: [12], effect_detail: { amount: 49, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers' } },
    /* 9 */ { claim_kind: 'causal_link', label: 'Subscriber support effect', from_claim: 1, to_claim: 4, effect: 'positive', basis: [13], effect_detail: { amount: 6, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers' } },
    /* 10 */ { claim_kind: 'causal_link', label: 'Same revenue quantity', from_claim: 3, to_stated: 6, effect: 'positive' },
    /* 11 */ { claim_kind: 'causal_link', label: 'Raise price level', from_stated: 3, to_claim: 0, sets_to: 10, effect: 'positive', basis: [15], unit: '%', value_scale: 'raw_count' },
    /* 12 */ { claim_kind: 'causal_link', label: 'Raise subscriber level', from_stated: 3, to_claim: 1, sets_to: 0, effect: 'positive' },
    /* 13 */ { claim_kind: 'causal_link', label: 'Starter price level', from_stated: 4, to_claim: 0, sets_to: 0, effect: 'positive' },
    /* 14 */ { claim_kind: 'causal_link', label: 'Starter subscriber level', from_stated: 4, to_claim: 1, sets_to: 150, effect: 'positive', basis: [11], unit: 'subscribers', value_scale: 'raw_count', range: range(subscribers, 80, 250, 'subscribers') },
  ] };
}
