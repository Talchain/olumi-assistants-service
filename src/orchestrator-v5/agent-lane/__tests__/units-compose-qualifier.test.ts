/**
 * DL ruling (8 Oct, P02 B-alt C1 77cb0774): the Run said Olumi's reading "hasn't been confirmed" and nothing offered the
 * confirmation. The card's condition 3 refused "£ per Pro subscriber per month" × "Pro subscribers": the qualifier reader
 * refuses any qualified denominator, so `readMoney` never reached its own denominator check. Strict rule: the count noun
 * matches, every denominator qualifier is in the count; a count qualifier absent from the denominator is fine; a
 * mismatched qualifier never composes. Census (0 LLM, 617 stored product-goal scenarios, base c4db6fd4): 1 verdict
 * changes, this scenario, withheld → card.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unitsCompose } from '../reconciling-product.js';
import { readMoney } from '../same-unit.js';
import { proposeProductIdentity } from '../identity-proposal.js';

const compose = (rate: string, count: string) => unitsCompose('£ per month', 'MRR', { unit: rate, label: 'rate' }, { unit: count, label: 'count' }).kind;
const stored = JSON.parse(readFileSync(new URL('./fixtures/units-compose-qualifier-77cb0774.json', import.meta.url), 'utf8')) as unknown;

describe('unitsCompose: a qualified per-denominator (DL 8 Oct, 77cb0774)', () => {
  it('RED (77cb0774 stored graph): the card is offered', () => {
    expect(proposeProductIdentity(stored)?.words).toMatch(/^Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-rise churn’\./);
  });
  it('RED: "£ per Pro subscriber per month" × "Pro subscribers" (and "Pro paying subscribers") composes', () => {
    expect(compose('£ per Pro subscriber per month', 'Pro subscribers')).toBe('proof');
    expect(compose('£ per Pro subscriber per month', 'Pro paying subscribers')).toBe('proof');
    expect(readMoney('£ per Pro subscriber per month', '')).toEqual({ code: 'GBP', period: 'month', per: ['pro', 'subscriber'] });
  });
  it('CONTROL: the unqualified forms compose as before; a count qualifier absent from the denominator is fine', () => {
    expect(compose('£ per subscriber per month', 'subscribers')).toBe('proof');
    expect(compose('£/subscriber/month', 'Pro subscribers')).toBe('proof');
  });
  it.each([
    ['a mismatched qualifier', '£ per Pro subscriber per month', 'Basic subscribers'],
    ['a different count noun', '£ per Pro subscriber per month', 'Pro seats'],
    ['the denominator qualifier missing from the count (census b5c007f2 / f832d2b1 shape)', '£ per Pro subscriber per month', 'subscribers'],
    ['a percent is never a count (#2802 P0)', '£ per Pro subscriber per month', 'percent'],
    ['a scaled currency', '£k per Pro subscriber per month', 'Pro subscribers'],
    ['two denominators', '£ per Pro subscriber per seat per month', 'Pro subscribers'],
  ])('CONTROL: %s → no', (_n, rate, count) => {
    expect(compose(rate, count)).toBe('no');
  });
});
