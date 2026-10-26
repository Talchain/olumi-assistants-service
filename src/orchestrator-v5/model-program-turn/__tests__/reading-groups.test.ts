/**
 * Alpha G13: the first reply's one count line and the reading card's groups are ONE map, read off each record's fields
 * (author, quote, status, measure_by, family) only. Every expectation is written by hand from the fixture.
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { verbatimIn } from '../postimage.js';
import { readingGroups, readingLine } from '../reading-groups.js';
import { at, bakery, BRIEF, q } from './bakery.fixture.js';

const AGE = 'The old oven is 12 years old.';
const words = (quote: string) => verbatimIn(quote, [BRIEF, AGE]);
const groupsOf = (m: CanonicalModelT) => Object.fromEntries(readingGroups(m, words));

describe('the first reply counts what it used, inferred and left out (alpha G13)', () => {
  it('the bakery draft: 11 records theirs in their words, Olumi\'s sell-through estimate; workings, structure and an asked figure in no count', () => {
    expect(groupsOf(bakery())).toEqual({
      more_loaves: 'used', within_budget: 'used', second_oven: 'used', keep_one: 'used', sold_rel: 'other', sales_rel: 'used', spend_rel: 'other',
      base_sales: 'used', ovens_added: 'used', one_oven: 'used', extra_per_oven: 'used', sell_through: 'inferred', sold_per_oven: 'other', sales: 'other',
      sales_target: 'used', budget: 'used', oven_price: 'other', spend: 'other',
    });
    expect(readingLine(readingGroups(bakery(), words))).toBe('I used 11 things from your brief and added 1 of my own for you to check.');
  });

  it('what makes a record Olumi\'s to check, or left out: its measure, a link it drew, its reading of a date; a figure of theirs nothing uses', () => {
    const m = bakery();
    // Olumi suggested the measure for their aim: the goal row is Olumi's to check, though the aim is theirs.
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, measure_by: 'olumi' } }));
    // Olumi drew a second link on the sales effect: the row holds something Olumi added.
    m.quantities.push(q('promo_effect', 'loaf/week', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 20, low: 10, high: 30, range_kind: 'plausible', basis: 'A rough guess.' }),
      q('promo_on', '1', { value: 0, author: 'structure', basis: 'Switched off.' }),
      q('oven_weeks', 'week', { value: 2, author: 'olumi', basis: 'Two whole weeks from today.' }),
      q('old_oven_age', 'year', { value: 12, status: 'not_applicable', quote: 'The old oven is 12 years old', basis: 'Nothing in the model uses its age.' }));
    m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, terms: [...r.terms, { driver: 'promo_on', coefficient: 'promo_effect', author: 'olumi' as const, quote: null, ...at }] } : r));
    m.left_out.push({ id: 'weather', text: 'The weather', why: 'Not modelled.', question: null, concerns: [], author: 'olumi', quote: null, ...at });
    const g = groupsOf(m);
    expect([g.more_loaves, g.sales_rel, g.promo_effect, g.promo_on, g.oven_weeks, g.old_oven_age, g.weather])
      .toEqual(['inferred', 'inferred', 'inferred', 'other', 'inferred', 'left_out', 'left_out']);
    // more_loaves and sales_rel leave "used" (11 → 9); inferred: sell_through, more_loaves, sales_rel, promo_effect, oven_weeks.
    expect(readingLine(readingGroups(m, words))).toBe('I used 9 things from your brief, added 5 of my own for you to check, and left 2 out of the calculation.');
  });

  it('Codex r1: a figure still to be given or worked out is in no count, whoever wrote its words; nor is a quote not found in their words', () => {
    const m = bakery();
    m.quantities.push(q('flour_cost', 'GBP/week', { status: 'asked', quote: 'We bake 300 loaves a week', question: 'What does flour cost a week?' }),
      q('profit', 'GBP/week', { kind: 'derived', status: 'derived', quote: 'We bake 300 loaves a week' }),
      q('staff', 'person', { value: 4, quote: 'we have four bakers' }));
    const g = groupsOf(m);
    expect([g.flour_cost, g.profit, g.staff]).toEqual(['other', 'other', 'other']);
    // Contrast: the same figure in words they did write is theirs.
    const n = bakery();
    n.quantities.push(q('staff', 'person', { value: 4, quote: 'We bake 300 loaves a week' }));
    expect(groupsOf(n).staff).toBe('used');
  });

  it('singular words, a zero clause dropped, and no line when nothing is in any count', () => {
    const one = new Map([['a', 'used'], ['b', 'left_out'], ['c', 'other']] as const);
    expect(readingLine(one)).toBe('I used 1 thing from your brief and left 1 out of the calculation.');
    expect(readingLine(new Map([['x', 'inferred']] as const))).toBe('I added 1 of my own for you to check.');
    expect(readingLine(new Map([['s', 'other']] as const))).toBeNull();
    expect(readingLine(new Map())).toBeNull();
  });
});
