/**
 * The threshold search on the real evaluation path (`evaluateCanonical`), 0 provider calls.
 *
 * DoD-I hiring-r3 (25 Oct): a goal measured over a window that opens at the person's staffing decision waited on one asked
 * figure, the weeks from now to that decision. The open-ended search (present.ts `tippingThresholds`, deleted with alpha G10) doubled it, each probe
 * simulating that many more weeks, and the process froze for about 15 minutes. Every expected value here is written by hand.
 *
 * The evaluation is synchronous, so vitest's own timer cannot stop a runaway search; the simulator spy below enforces the
 * same per-test budget, so a regression fails RED inside the budget instead of hanging the worker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { evaluateCanonical } from '../evaluate.js';
import { bakery, BRIEF, club, CLUB_BRIEF, q } from './bakery.fixture.js';

const BUDGET_MS = 3_000;
let deadline = Infinity;
vi.mock('../../model-program/simulate/simulate.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../model-program/simulate/simulate.js')>();
  return { ...real, simulate: (...args: Parameters<typeof real.simulate>) => {
    if (performance.now() > deadline) throw new Error(`timed out: the evaluation ran past its ${BUDGET_MS} ms budget`);
    return real.simulate(...args);
  } };
});
beforeEach(() => { deadline = performance.now() + BUDGET_MS; });

type Json = Record<string, any>;

describe('no threshold search on the evaluation path (alpha G10); the evaluation ends fast', () => {
  it('a goal whose window opens at an asked decision date (no domain): the evaluation ends fast, with no threshold', { timeout: BUDGET_MS }, () => {
    // The bakery's loaves goal, counted for 4 weeks from a decision whose date is asked: sales do not change with the date
    // (no stock), so no date tips the goal, which is the run's shape.
    const m: CanonicalModelT = bakery();
    m.quantities = [...m.quantities,
      q('decision_weeks', 'week', { status: 'asked', question: 'How many weeks from now will you decide?' }),
      q('weeks_counted', 'week', { value: 4, quote: 'four weeks after we decide' })];
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: 'the decision', origin_offset: 'decision_weeks', start: 0, periods: 'weeks_counted' } } }));
    const t0 = performance.now();
    const e = evaluateCanonical(m, { sourceText: `${BRIEF} We count four weeks after we decide.`, seed: 7 });
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    const gc = (e.view as Json).goal_chance as Json;
    expect(e.compiled.perGoal.map((p) => [p.goal_id, p.status, p.asks])).toEqual([['more_loaves', 'asks', ['decision_weeks']]]);
    // The existing no-threshold outcome: no threshold, no "Threshold:" note, and the goal still says what it waits on.
    expect(gc.thresholds).toBeUndefined();
    expect((gc.notes as string[]).some((n) => n.startsWith('Threshold:'))).toBe(false);
    expect((gc.waits_on as Json[]).map((b) => [b.id, b.code])).toContainEqual(['decision_weeks', 'asked']);
  });

  it('alpha G10: a goal waiting on one asked figure that is no timing gets NO threshold (the search is off): it says what it waits on', { timeout: BUDGET_MS }, () => {
    // The club with the joins a month asked and the promotion's effect the person's own 5 a month. Until the search was switched
    // off this view said "Threshold: … is met with 'Run a promotion' if 'base joins' is at least 18.4", a claim an 11-point grid
    // cannot support (a second crossing between grid points is not excluded). Now: no threshold, no "Threshold:" note, and the
    // asked figure is still what the chance waits on.
    const m: CanonicalModelT = club();
    m.quantities = m.quantities.map((x) => (x.id === 'base_joins' ? q('base_joins', 'member/month', { status: 'asked', question: 'How many people join each month?' })
      : x.id === 'promo_effect' ? q('promo_effect', 'member/month/promotion', { kind: 'coefficient', value: 5, quote: 'about 5 extra joins a month' }) : x));
    const e = evaluateCanonical(m, { sourceText: `${CLUB_BRIEF} The promotion brings about 5 extra joins a month.`, seed: 7 });
    const gc = (e.view as Json).goal_chance as Json;
    expect(e.compiled.perGoal.map((p) => [p.goal_id, p.status, p.asks])).toEqual([['reach_340', 'asks', ['base_joins']]]);
    expect(gc.thresholds).toBeUndefined();
    expect((gc.notes as string[]).some((n) => n.includes('Threshold'))).toBe(false);
    expect((gc.waits_on as Json[]).map((b) => [b.id, b.code])).toContainEqual(['base_joins', 'asked']);
  });
});
