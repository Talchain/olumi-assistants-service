/**
 * ⭐ WHAT THE PERSON READS NAMES EACH RECORD BY ITS OWN LABEL, NEVER ITS ID (Paul's European-expansion test, 25 Oct: C2, C8).
 * Exact presentation: an id is replaced by that record's own label from the model, by lookup, never by reading words.
 * The drafter's repair sentences keep their ids (it needs them to fix the model). Synthetic bakery only; its ids differ
 * from its labels, and no label has an underscore, so any snake_case token in the words is an id.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../../model-program/compile.js';
import type { CanonicalModelT, CanonicalQuantityT } from '../../model-program/canonical.js';
import { validatePostimage } from '../postimage.js';
import { at, bakery, BRIEF, q } from './bakery.fixture.js';

const SNAKE_ID = /[a-z0-9]_[a-z0-9]/;
const ids = (m: CanonicalModelT): string[] => [...m.quantities, ...m.relations, ...m.goals, ...m.limits, ...m.preferences, ...m.options, ...m.assumptions].map((r) => r.id);

/** The bakery whose aim and limit are both read by a deadline: its weeks, which are `weeks`. */
function dated(weeks: Partial<CanonicalQuantityT>): CanonicalModelT {
  const m = bakery();
  m.quantities.push(q('weeks_to_reach', 'week', { label: 'Weeks to get there', ...weeks }));
  const window = { origin_event: null, origin_offset: null, start: 0, periods: 'weeks_to_reach' };
  m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window } }));
  m.limits = m.limits.map((l) => ({ ...l, measure: { ...l.measure!, window } }));
  return m;
}

describe('the compiler\'s reasons for a chance not shown name the goal and the limit by label (C2: "(customer_growth_goal)\'s length")', () => {
  it('a deadline no one can give yet: the goal\'s and the limit\'s reasons say their labels and carry no id', () => {
    const m = dated({ status: 'unknown', author: 'olumi', basis: 'No one has said by when yet.' });
    const c = compile(m, { sourceText: BRIEF });
    expect(c.errors).toEqual([]);
    const goal = c.perGoal.find((p) => p.goal_id === 'more_loaves')!.reasons.join(' ');
    const limit = c.perLimit.find((p) => p.limit_id === 'within_budget')!.reasons.join(' ');
    expect(goal).toContain('The goal "Reach 380 loaves a week"\'s length "Weeks to get there" is unknown: No one has said by when yet.');
    expect(limit).toContain('The limit "Within the £3,000"\'s length "Weeks to get there" is unknown: No one has said by when yet.');
    for (const words of [goal, limit]) {
      expect(words, 'no snake_case id').not.toMatch(SNAKE_ID);
      for (const id of ids(m)) expect(words, id).not.toContain(id.includes('_') ? id : `(${id})`);
    }
  });

  it('negative: the drafter\'s repair sentence for the same window keeps both ids (it needs them to fix the model)', () => {
    const c = compile(dated({ value: 2.5, quote: 'a week' }), { sourceText: BRIEF });
    const repair = c.errors.find((e) => e.code === 'window')?.message ?? '';
    expect(repair).toContain('The goal "Reach 380 loaves a week" (more_loaves)\'s length "Weeks to get there" (weeks_to_reach) is 2.5');
  });
});

describe('a card says a record with no name of its own as the card titles it (C8: "customer_base_evolution" in the chat receipt)', () => {
  /** The bakery with labels that differ from their ids, a preference, and (`post`) Olumi's assumption about a relation, the preference and the goal. */
  const labelled = (post: boolean): CanonicalModelT => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'sold_per_oven' ? { ...x, label: 'Loaves sold per extra oven' } : x.id === 'sales' ? { ...x, label: 'Weekly loaves sold' } : x));
    m.preferences = [{ id: 'more_sold', quantity: 'sales', direction: 'higher', author: 'olumi', quote: null, ...at }];
    if (post) m.assumptions = [{ id: 'demand_holds', text: 'Demand keeps up with the extra loaves', applied: false, concerns: ['sold_rel', 'more_sold', 'more_loaves'], author: 'olumi', quote: null, ...at }];
    return m;
  };

  it('an assumption about a relation and a preference names them by what they work out and are about; the goal by its own label', () => {
    const v = validatePostimage(labelled(false), labelled(true), { removals: [], words: [BRIEF], fresh: [] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const change = v.changes.find((c) => c.id === 'demand_holds')!;
    expect(change).toMatchObject({ kind: 'record', action: 'add', label: 'Demand keeps up with the extra loaves' });
    expect(change.after).toContain('about "Loaves sold per extra oven", "Weekly loaves sold" and "Reach 380 loaves a week"');
    expect(change.after, 'no snake_case id').not.toMatch(SNAKE_ID);
  });
});
