/**
 * A stated date becomes whole periods from today IN CODE (DL 24 Oct; DoD-G marketing r2–r5, where the AI did the calendar
 * arithmetic itself and the runs disagreed). Every row drafts through the real drafter (`draftCanonicalModel`, the function the
 * route's first turn calls, its provider answered here) with today pinned to 24 October 2026, and compiles what it returns.
 * Synthetic models (a bakery, a club); the marketing rows graft r5's and r4's saved timing records verbatim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalModelT, CanonicalQuantityT } from '../../model-program/canonical.js';
import { draftCanonicalModel, type ResponsesCall } from '../draft.js';
import { withStatedDates } from '../date-reading.js';
import { validatePostimage } from '../postimage.js';
import { bakery, BRIEF, club, CLUB_BRIEF, q } from './bakery.fixture.js';

const setQ = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>) => { m.quantities = m.quantities.map((x) => (x.id === id ? { ...x, ...f } : x)); };
/** The drafter, answered with `m` (no network); what it returns is the model the route saves. */
async function drafted(m: CanonicalModelT, brief: string) {
  const call: ResponsesCall = async () => ({ text: JSON.stringify(m), status: 'completed', incomplete: null, usage: null });
  const d = await draftCanonicalModel(brief, call, brief, { interpret: true });
  return { model: d.model!, compiled: d.compiled!, quantity: (id: string) => d.model!.quantities.find((x) => x.id === id)! };
}
/** The club's goal counted from its reopening, `reopen_offset` holding when that is, as the drafter wrote it. */
function reopening(f: Partial<CanonicalQuantityT>): CanonicalModelT {
  const m = club();
  m.quantities.push(q('reopen_offset', 'month', { label: 'Months from now until the reopening', ...f }));
  m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: 'the reopening', origin_offset: 'reopen_offset', start: 0, periods: 'months' } } }));
  return m;
}
/** The bakery's second oven arriving at a stated date: its setting starts after `oven_arrives` weeks. */
function ovenArrives(f: Partial<CanonicalQuantityT>): CanonicalModelT {
  const m = bakery();
  m.quantities.push(q('oven_arrives', 'week', { label: 'Weeks until the oven arrives', ...f }), q('weeks', 'week', { value: 10, quote: 'reach 380 loaves a week' }));
  m.options = m.options.map((o) => ({ ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'oven_arrives' })) }));
  m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'weeks' } } }));
  return m;
}
const READING = (date: string, n: string, unit = 'month') => `Olumi's reading of the date: ${date} is ${n} from today, 24 October 2026, to the nearest whole ${unit}.`;
const reading = (value: number, words: string, basis: string) => ({ kind: 'fact', status: 'known', author: 'olumi', value, low: null, high: null, range_kind: null,
  quote: null, party: null, question: null, stated_date: words, basis });

describe('a stated date is whole periods from today, worked out in code', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T09:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('"6 months from 9 October", today 24 October, on a month model: 6, as Olumi\'s labelled reading, whatever figure the drafter wrote; the window opens at period 6', async () => {
    // The drafter's own arithmetic (r2/r3: counted from the planning date) is replaced by the code's.
    const d = await drafted(reopening({ status: 'known', author: 'olumi', value: 5, basis: 'Counted from the planning date.', stated_date: '6 months from 9 October' }), CLUB_BRIEF);
    expect(d.quantity('reopen_offset')).toMatchObject(reading(6, '6 months from 9 October', READING('9 April 2027', '6 months')));
    expect(d.compiled.errors).toEqual([]);
    expect(d.compiled.executable!.goals[0]!.window).toEqual({ start_period: 6, periods: 3 });
    // The same date as YYYY-MM-DD, and an asked slot with no figure: the same reading.
    for (const f of [{ stated_date: '2027-04-09' }, { status: 'asked' as const, question: 'When does the club reopen?', stated_date: '9 April 2027' }]) {
      expect((await drafted(reopening(f), CLUB_BRIEF)).quantity('reopen_offset')).toMatchObject({ status: 'known', author: 'olumi', value: 6, question: null, basis: READING('9 April 2027', '6 months') });
    }
  });

  it('a date 10 days away on a month model is 0 whole months; on a week model the count is in whole weeks', async () => {
    const soon = await drafted(reopening({ status: 'asked', stated_date: '3 November 2026' }), CLUB_BRIEF);
    expect(soon.quantity('reopen_offset')).toMatchObject(reading(0, '3 November 2026', READING('3 November 2026', '0 months')));
    expect(soon.compiled.executable!.goals[0]!.window).toEqual({ start_period: 0, periods: 3 });
    // A week model, the oven arriving on 5 December (42 days): 6 whole weeks; 3 November (10 days): 1.
    const oven = await drafted(ovenArrives({ status: 'asked', stated_date: 'by 5 December 2026' }), BRIEF);
    expect(oven.quantity('oven_arrives')).toMatchObject(reading(6, 'by 5 December 2026', READING('5 December 2026', '6 weeks', 'week')));
    expect(oven.compiled.executable!.options.find((o) => o.id === 'second_oven')!.sets.map((s) => s.from_period)).toEqual([6]);
    expect((await drafted(ovenArrives({ status: 'asked', stated_date: '3 November 2026' }), BRIEF)).quantity('oven_arrives')).toMatchObject({ value: 1, basis: READING('3 November 2026', '1 week', 'week') });
  });

  it('a date the calendar cannot place stays asked with a question, never a figure; one already passed is not counted back', async () => {
    // The drafter's own figure goes: no guess survives. Its own question is kept; with none, the code asks for the date.
    const vague = await drafted(reopening({ status: 'known', author: 'olumi', value: 3, basis: 'A guess.', stated_date: 'after the summer rush', question: 'When does the club reopen?' }), CLUB_BRIEF);
    expect(vague.quantity('reopen_offset')).toMatchObject({ status: 'asked', author: 'person', value: null, low: null, high: null, basis: null, question: 'When does the club reopen?', stated_date: 'after the summer rush' });
    expect(vague.compiled.blockers).toContainEqual(expect.objectContaining({ id: 'reopen_offset', code: 'asked' }));
    expect(vague.compiled.executable!.goals).toEqual([]);
    const unasked = await drafted(reopening({ status: 'asked', stated_date: 'after the summer rush' }), CLUB_BRIEF);
    expect(unasked.quantity('reopen_offset')).toMatchObject({ status: 'asked', value: null, question: 'Which date do you mean by "after the summer rush"? Give a day, month and year.' });
    expect(unasked.compiled.errors).toEqual([]);
    // Passed: 9 August is before today and is never a negative count or a guess at 0.
    const passed = await drafted(reopening({ status: 'asked', stated_date: '9 August 2026' }), CLUB_BRIEF);
    expect(passed.quantity('reopen_offset')).toMatchObject({ status: 'unsupported', value: null, question: null,
      basis: '9 August 2026 is before today, 24 October 2026, so the model cannot count it in whole months from now.' });
    expect(passed.compiled.errors).toEqual([]);
    expect(passed.compiled.perGoal[0]!.status).toBe('withheld');
  });

  it('calendar order before rounding (buddy + Codex BLOCK on #3744): yesterday has passed, though it rounds to 0 months; today is 0; a date 10 days ahead is 0, known', async () => {
    const at = async (words: string) => (await drafted(reopening({ status: 'asked', stated_date: words }), CLUB_BRIEF)).quantity('reopen_offset');
    expect(await at('23 October 2026')).toMatchObject({ status: 'unsupported', value: null, basis: '23 October 2026 is before today, 24 October 2026, so the model cannot count it in whole months from now.' });
    expect(await at('2026-10-23')).toMatchObject({ status: 'unsupported', value: null });
    expect(await at('24 October 2026')).toMatchObject(reading(0, '24 October 2026', READING('24 October 2026', '0 months')));
    expect(await at('3 November 2026')).toMatchObject({ status: 'known', value: 0 });
  });

  it('month ends, a leap day and a year time step: whole calendar months as the deadline calendar counts them (a month end clamped), years as twelve of them', () => {
    const on = (today: string, words: string, period: CanonicalModelT['period'] = 'month') => {
      const m = { ...reopening({ status: 'asked', unit: period, stated_date: words }), period };
      return withStatedDates(m, today).quantities.find((x) => x.id === 'reopen_offset')!;
    };
    // From a month end: 31 January to 28 February 2027 is one whole month; to 31 March, two.
    expect(on('2027-01-31', '28 February 2027')).toMatchObject({ status: 'known', value: 1 });
    expect(on('2027-01-31', '31 March 2027')).toMatchObject({ status: 'known', value: 2 });
    // Today a leap day: the day before has passed; 29 March is one month on; 28 February 2029 is twelve (Feb 29 clamped).
    expect(on('2028-02-29', '28 February 2028')).toMatchObject({ status: 'unsupported', value: null });
    expect(on('2028-02-29', '29 March 2028')).toMatchObject({ status: 'known', value: 1 });
    expect(on('2028-02-29', '28 February 2029')).toMatchObject({ status: 'known', value: 12 });
    // A year time step: 24 months is 2 years; 3 months is 0; 18 months rounds up to 2.
    expect(on('2026-10-24', '24 October 2028', 'year')).toMatchObject({ status: 'known', value: 2,
      basis: 'Olumi\'s reading of the date: 24 October 2028 is 2 years from today, 24 October 2026, to the nearest whole year.' });
    expect(on('2026-10-24', '24 January 2027', 'year')).toMatchObject({ status: 'known', value: 0 });
    expect(on('2026-10-24', '24 April 2028', 'year')).toMatchObject({ status: 'known', value: 2 });
  });

  it('the date places the window and never the change goal\'s reference: "now" stays the level at period 0 (AIE), and a window counted from an event keeps its length as written', async () => {
    const m = reopening({ status: 'asked', stated_date: '6 months from 9 October' });
    m.quantities.push(q('growth_target', 'member', { value: 20, quote: 'reach 340 members' }));
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, target: 'growth_target', frame: 'change_abs', reference: { kind: 'now', option: null, quantity: null } } }));
    const d = await drafted(m, CLUB_BRIEF);
    expect(d.compiled.errors).toEqual([]);
    const x = d.compiled.executable!;
    expect(x.goals[0]).toMatchObject({ quantity: 'reach_340__change', window: { start_period: 6, periods: 3 } });
    // The change is from members today (the stock's start), not from the level when the window opens.
    expect(x.quantities.find((y) => y.id === 'reach_340__change')!.equation).toEqual({ form: 'definition', op: 'difference', parts: ['members', 'members_now'] });
    // A length counted from the reopening does not run from today: the drafter's figure stands, the date unread.
    const long = reopening({ status: 'asked', stated_date: '6 months from 9 October' });
    setQ(long, 'months', { stated_date: '9 July 2027' });
    expect((await drafted(long, CLUB_BRIEF)).quantity('months')).toMatchObject({ status: 'known', author: 'person', value: 3, stated_date: '9 July 2027' });
  });

  it('fixed when written: a date the change did not alter keeps its saved reading as the days pass; new words are read against that day', () => {
    const saved = withStatedDates(reopening({ status: 'asked', stated_date: '6 months from 9 October' }), '2026-10-24');
    expect(saved.quantities.find((x) => x.id === 'reopen_offset')!.value).toBe(6);
    const later = JSON.parse(JSON.stringify(saved)) as CanonicalModelT;
    setQ(later, 'reopen_offset', { value: 4, basis: 'Recounted.' });
    expect(withStatedDates(later, '2026-11-30', saved).quantities.find((x) => x.id === 'reopen_offset')).toMatchObject({ value: 6, basis: READING('9 April 2027', '6 months') });
    // Contrast: read afresh on 30 November it would be 4; and new words are read against that day.
    expect(withStatedDates(later, '2026-11-30').quantities.find((x) => x.id === 'reopen_offset')!.value).toBe(4);
    setQ(later, 'reopen_offset', { stated_date: '7 months from 9 October' });
    expect(withStatedDates(later, '2026-11-30', saved).quantities.find((x) => x.id === 'reopen_offset')).toMatchObject({ value: 5,
      basis: 'Olumi\'s reading of the date: 9 May 2027 is 5 months from today, 30 November 2026, to the nearest whole month.' });
  });

  it('the card says the date words as stored (Codex r1 #3744): the same date re-spelt is a change the card shows, never refused as unshown', () => {
    const saved = withStatedDates(reopening({ status: 'asked', stated_date: '9 April 2027' }), '2026-10-24');
    const respelt = { ...saved, quantities: saved.quantities.map((x) => (x.id === 'reopen_offset' ? { ...x, stated_date: '2027-04-09' } : x)) };
    const v = validatePostimage(saved, withStatedDates(respelt, '2026-10-24', saved), { removals: [], words: [CLUB_BRIEF], fresh: [] });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(v.ok && v.changes).toEqual([{ id: 'reopen_offset', kind: 'quantity', action: 'change', label: 'Months from now until the reopening',
      before: '6 month, for the date "9 April 2027"', after: '6 month, for the date "2027-04-09"', author: 'olumi' }]);
  });

  it('marketing r5 and r4 (DoD-G), their saved timing records verbatim with the date words the drafter now records: r5\'s launch is no longer unsupported, and r4\'s budget start, already passed, is no longer asked but said unsupported', async () => {
    // r5's launch_offset, as saved at 2164e468: unsupported, its basis on rounding; the drafter now records the launch date.
    const r5: Partial<CanonicalQuantityT> = { label: 'Time from now until the feature launch', unit: 'month', kind: 'fact', status: 'unsupported', author: 'person',
      quote: 'We are working from 9 October 2026, with launch on 9 April 2027 and the three-month sales assessment on 9 July 2027.',
      basis: 'The date answer fixes launch on 9 April 2027 and assessment on 9 July 2027; 9 October 2026 is the person\'s planning reference date, not today. From today, 24 October 2026, launch is not a whole number of calendar months away. This schema has no explicit calendar-date window fields, so the exact dates are retained in the goal origins and date records rather than replaced by a rounded month offset.' };
    const words = `${CLUB_BRIEF} ${r5.quote}`;
    const before = await drafted(reopening(r5), words);
    expect(before.compiled.perGoal[0]!.reasons.some((x) => /origin timing .* is unsupported/.test(x))).toBe(true);
    const after = await drafted(reopening({ ...r5, stated_date: '9 April 2027' }), words);
    expect(after.quantity('reopen_offset')).toMatchObject(reading(6, '9 April 2027', READING('9 April 2027', '6 months')));
    expect(after.compiled.perGoal[0]).toMatchObject({ status: 'calculable' });
    // r4's budget_start_offset, as saved: asked, because "the model's current reference date is not available".
    const r4: Partial<CanonicalQuantityT> = { label: 'Months from now to the budget start on 9 October 2026', unit: 'month', kind: 'fact', status: 'asked', author: 'person',
      question: 'How many whole months from now does the budget period starting on 9 October 2026 begin?',
      basis: 'The budget start date is stated, but the model\'s current reference date is not available to translate it into a whole-month offset.' };
    const budgeted = (f: Partial<CanonicalQuantityT>) => {
      const m = club();
      m.quantities.push(q('budget_start_offset', 'month', f), q('budget_window_months', 'month', { value: 12, quote: 'the 12 months starting on 9 October 2026' }));
      m.limits = m.limits.map((l) => ({ ...l, measure: { ...l.measure!, window: { origin_event: '9 October 2026', origin_offset: 'budget_start_offset', start: 0, periods: 'budget_window_months' } } }));
      return m;
    };
    const brief = `${CLUB_BRIEF} We can spend £800 in the 12 months starting on 9 October 2026.`;
    expect((await drafted(budgeted(r4), brief)).compiled.perLimit[0]).toMatchObject({ status: 'asks', asks: ['budget_start_offset'] });
    // 9 October is 15 days before today: passed, so never "0 months from now" (buddy + Codex BLOCK on #3744), and never asked again.
    const r4after = await drafted(budgeted({ ...r4, stated_date: '9 October 2026' }), brief);
    const PASSED = '9 October 2026 is before today, 24 October 2026, so the model cannot count it in whole months from now.';
    expect(r4after.quantity('budget_start_offset')).toMatchObject({ status: 'unsupported', author: 'olumi', value: null, question: null, stated_date: '9 October 2026', basis: PASSED });
    expect(r4after.compiled.perLimit[0]).toMatchObject({ status: 'withheld', asks: [] });
    expect(r4after.compiled.perLimit[0]!.reasons.some((x) => x.includes(PASSED))).toBe(true);
    expect(r4after.compiled.errors).toEqual([]);
  });
});

// A quantity no window, setting or risk counts from now is never read: its date words are only kept.
describe('what the reading touches', () => {
  it('a stated date on a quantity that is no timing changes nothing', () => {
    const m = bakery();
    setQ(m, 'budget', { stated_date: '9 April 2027' });
    expect(withStatedDates(m, '2026-10-24')).toBe(m);
  });
});
