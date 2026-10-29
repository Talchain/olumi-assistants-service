/**
 * GAP 2 (DL model-vs-spec audit, 29 Oct): a window's or a timing's one figure is read once, as whole periods, never drawn, so
 * the Run's domain check never saw it, and a figure outside its declared floor or ceiling ran as written. It is now held, as a
 * drawn figure outside its domain is (spec §3.7), naming the figure and the bound. Synthetic class studio only; every
 * expectation is written by hand from the fixture, with a contrast inside the bound beside each.
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalModelT } from '../canonical.js';
import { compile } from '../compile.js';
import { studio } from '../../model-program-turn/__tests__/class-studio.fixture.js';

type Q = CanonicalModelT['quantities'][number];
const goalOf = (c: ReturnType<typeof compile>, id: string) => c.perGoal.find((g) => g.goal_id === id)!;
const optionOf = (c: ReturnType<typeof compile>, id: string) => c.perOption.find((o) => o.option_id === id)!;
const time = (m: CanonicalModelT, id: string, label: string, value: number, bounds: Partial<Q>): Q =>
  ({ ...m.quantities.find((x) => x.id === 'members')!, id, label, unit: 'month', value, low: null, high: null, range_kind: null, quote: null, floor: null, ceiling: null, ...bounds }) as Q;

describe('a window or timing figure outside what Olumi reads it can be is held, never run as written', () => {
  const windowed = (value: number) => {
    const m = studio();
    m.quantities.push(time(m, 'term', 'The term', value, { floor: 1, ceiling: 12 }));
    m.goals = m.goals.map((g) => (g.id === 'takings_goal' ? { ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'term' } } } : g));
    return m;
  };

  it('a window length above its ceiling withholds the aim read over it, naming the figure and the bound', () => {
    const c = compile(windowed(30));
    expect(c.errors).toEqual([]);
    expect([goalOf(c, 'takings_goal').status, goalOf(c, 'takings_goal').reasons])
      .toEqual(['withheld', ['rests on "The term": it is 30 month, but Olumi reads it as between 1 month and 12 month.']]);
    // The members aim waits on its links in words, so with takings held nothing is run.
    expect(c.executable).toBeNull();
    // Contrast: three months, inside its bounds, calculates.
    expect(goalOf(compile(windowed(3)), 'takings_goal').status).toBe('calculable');
  });

  it('a sized risk on a window length withholds the aim read over it, naming the risk: the length is read once and a draw cannot change it', () => {
    const risked = (on: string) => {
      const m = windowed(3);
      const base = m.quantities.find((x) => x.id === 'members')!;
      m.quantities.push({ ...base, id: 'cut_chance', label: 'Chance the term is cut', unit: '1', value: 0.2, quote: null, floor: 0, ceiling: 1 } as Q,
        { ...base, id: 'cut_size', label: 'Lost by a cut', unit: on === 'term' ? 'month' : 'class/month', value: -1, quote: null } as Q);
      m.risks.push({ ...m.risks[0]!, id: 'term_cut', label: 'The term is cut short', effect_on: on, direction: 'down', occurrence: 'cut_chance', severity: 'cut_size', mode: 'add' } as CanonicalModelT['risks'][number]);
      return compile(m);
    };
    const c = risked('term');
    expect(c.errors).toEqual([]);
    expect([goalOf(c, 'takings_goal').status, goalOf(c, 'takings_goal').reasons])
      .toEqual(['withheld', ['rests on the risk "The term is cut short" on "The term", which the calculation reads once as written and cannot change in a draw.']]);
    // Contrast: the same risk on a figure that is drawn (classes taught now) is run, and the aim calculates.
    const drawn = risked('classes_now');
    expect([drawn.errors, goalOf(drawn, 'takings_goal').status]).toEqual([[], 'calculable']);
    expect(drawn.executable!.risks.map((k) => k.id)).toContain('term_cut');
  });

  it('an option\'s start time below its floor withholds that option; the others are still compared', () => {
    const started = (value: number) => {
      const m = studio();
      m.quantities.push(time(m, 'workshop_start', 'When workshops start', value, { floor: 2 }));
      m.options = m.options.map((o) => (o.id === 'weekend_workshops' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'workshop_start' })) } : o));
      return m;
    };
    const c = compile(started(0));
    expect([optionOf(c, 'weekend_workshops').status, optionOf(c, 'weekend_workshops').reasons])
      .toEqual(['withheld', ['rests on "When workshops start": it is 0 month, but Olumi reads it as at least 2 month.']]);
    expect(c.executable!.options.map((o) => o.id)).toContain('carry_on');
    // Contrast: starting after three months, above its floor, is compared.
    expect(optionOf(compile(started(3)), 'weekend_workshops').status).toBe('calculable');
  });
});
