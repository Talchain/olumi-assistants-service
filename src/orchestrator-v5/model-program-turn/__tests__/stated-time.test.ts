/**
 * Stated time, v2 (DL 29 Oct, outbox/TIME-AND-DECIDE-BY-DESIGN-v2-20261029.md, with the PL's corrections A–H): the AI writes
 * the date or span it reads; the host counts it in the model's periods exactly, or not at all, never rounded. A whole count is
 * the figure; one that is not whole is Olumi's provisional reading, the nearest whole period, with the other reading named so it
 * can be confirmed (Paul, 29 Oct, option B); what cannot be read is asked. Each count's role is read from where the model uses it. r11 (289e63f1) lost a deadline by counting it itself (6 days
 * early) and could not run non-whole windows ("2.43 weeks", "4.5 weeks"). Every expectation is written by hand.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalModel, withDeclaredTiming, type CanonicalModelT, type CanonicalQuantityT, type CanonicalWindowT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import { DECISION_NODE_ID, project } from '../../model-program/project.js';
import { countStatedTime } from '../stated-time.js';
import { draftCanonicalModel, mergeUpdate, proposePostimage } from '../draft.js';
import { evaluateCanonical } from '../evaluate.js';
import { validatePostimage } from '../postimage.js';
import { figurePostimage } from '../program-tools.js';
import { withNewRun } from '../program-save.js';
import { MODEL_PROGRAM, reopenProgram } from '../program-store.js';
import { bakery, BRIEF, q } from './bakery.fixture.js';

type Stated = CanonicalQuantityT['stated_time'];
type Rec = Record<string, any>;
const P0 = '2026-10-29';
/** A stated date or span as the drafter writes it on a first draft: said today, period 0 (the schema asks for today's date). */
const date = (d: string): Stated => ({ date: d, span: null, unit: null, said_on: P0 });
const span = (n: number, unit: 'day' | 'week' | 'month' | 'year'): Stated => ({ date: null, span: n, unit, said_on: P0 });
/** A stated time said on another day (PL 14:12Z); null is a day not known (PL 16:42Z). */
const on = (t: Stated, day: string | null = P0): Stated => ({ ...t!, said_on: day });
/** The bakery with its sales aim counted over `weeks`, the quantity holding what they stated, in a window opening at `w`. */
function timed(stated: Stated, w: Partial<CanonicalWindowT> = {}, over: Partial<CanonicalQuantityT> = {}, period: CanonicalModelT['period'] = 'week'): CanonicalModelT {
  const m = bakery();
  m.period = period;
  m.quantities.push(q('weeks', period, { quote: 'by the end of March', stated_time: stated, ...over }));
  m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'weeks', ...w } } }));
  return m;
}
/** The bakery with its second oven arriving at `arrives`, the quantity holding what they stated. */
function arriving(stated: Stated, over: Partial<CanonicalQuantityT> = {}): CanonicalModelT {
  const m = bakery();
  m.quantities.push(q('arrives', 'week', { quote: 'the oven comes', stated_time: stated, ...over }));
  m.options = m.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'arrives' })) } : o));
  return m;
}
const of = (m: CanonicalModelT, id: string) => m.quantities.find((x) => x.id === id)!;
const asked = { value: null, low: null, high: null, status: 'asked' };

describe('a stated date or span is counted exactly, or as Olumi\'s provisional reading said with the other (never rounded silently)', () => {
  it('a whole count is the figure: 1 Apr 2027 is exactly 22 weeks from 29 Oct 2026, Olumi\'s reading with its basis; the AI\'s own figure is replaced', () => {
    const w = of(countStatedTime(timed(date('2027-04-01'), {}, { value: 21 }), P0), 'weeks');
    expect(w).toMatchObject({ value: 22, unit: 'week', status: 'known', author: 'olumi', question: null, quote: 'by the end of March', stated_time: on(date('2027-04-01')) });
    expect(w.basis).toBe('Read as 1 Apr 2027 from your words: 22 weeks from 29 Oct 2026.');
  });

  // 29 Oct (Paul, option B): a count whole periods cannot hold is Olumi's provisional reading, the nearest whole period, said
  // with the other reading so it can be confirmed or changed on the card; never silent, never their figure.
  it('v1 contrast (31 Mar 2027 was rounded to 22 silently): not whole is Olumi\'s provisional reading, 22, said with the other reading; the aim it times calculates on it', () => {
    const m = countStatedTime(timed(date('2027-03-31')), P0);
    expect(of(m, 'weeks')).toMatchObject({ value: 22, low: null, high: null, status: 'known', question: null, author: 'olumi', quote: 'by the end of March', stated_time: on(date('2027-03-31')) });
    expect(of(m, 'weeks').basis).toBe('Read as 31 Mar 2027 from your words: 21 weeks and 6 days from 29 Oct 2026. The model counts whole weeks, so Olumi counts it as 22 weeks '
      + '(to 1 Apr 2027) for now; confirm it, or say 21 (to 25 Mar 2027).');
    const c = compile(m, { sourceText: BRIEF });
    expect(c.errors).toEqual([]);
    const goal = c.perGoal.find((g) => g.goal_id === 'more_loaves')!;
    expect([goal.status, goal.asks, goal.reasons]).toEqual(['calculable', [], []]);
    expect(c.perLimit.map((l) => [l.limit_id, l.status])).toEqual(compile(bakery(), { sourceText: BRIEF }).perLimit.map((l) => [l.limit_id, l.status]));
  });

  it('PL 16:42Z: the chance says it rests on Olumi\'s reading of their date, "not yet confirmed" until accepted, gone once they answer; never as if on their exact date', () => {
    const notes = (m: CanonicalModelT) => (((evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view as Rec).goal_chance?.notes ?? []) as string[]);
    const m = countStatedTime(timed(date('2027-03-31')), P0);
    const reading = `‘weeks’ is Olumi’s reading (not yet confirmed). ${of(m, 'weeks').basis}`;
    expect(reading).toBe('‘weeks’ is Olumi’s reading (not yet confirmed). Read as 31 Mar 2027 from your words: 21 weeks and 6 days from 29 Oct 2026. '
      + 'The model counts whole weeks, so Olumi counts it as 22 weeks (to 1 Apr 2027) for now; confirm it, or say 21 (to 25 Mar 2027).');
    // Before it the notes said nothing of the date: "at 22 weeks from the start of this model" read as their own.
    expect(notes(m)).toContain(reading);
    // An exact reading of a date is Olumi's too, said the same way.
    expect(notes(countStatedTime(timed(date('2027-04-01')), P0))).toContain('‘weeks’ is Olumi’s reading (not yet confirmed). Read as 1 Apr 2027 from your words: 22 weeks from 29 Oct 2026.');
    // Accepted on the card: still Olumi's reading, no longer "not yet confirmed".
    const accepted = { ...m, quantities: m.quantities.map((x) => (x.id === 'weeks' ? { ...x, approval: 'approved' as const } : x)) };
    expect(notes(accepted)).toContain(`‘weeks’ is Olumi’s reading. ${of(m, 'weeks').basis}`);
    // Their answer replaces it: their figure, its stated time cleared, and no reading of a date is said.
    const answered = figurePostimage(m, { ...of(m, 'weeks'), value: 21, author: 'person', quote: '21 weeks', basis: null });
    // A time reading's note is "‘X’ is Olumi’s reading" (the shared basis beside the chances says "rests on Olumi’s reading of").
    expect(notes(answered).filter((n) => n.includes('is Olumi’s reading'))).toEqual([]);
    // CONTRAST: their span in the model's own unit is theirs, and no reading is said.
    expect(notes(countStatedTime(timed(span(22, 'week')), P0)).filter((n) => n.includes('is Olumi’s reading'))).toEqual([]);
  });

  it('review 29 Oct: a reading is said where the run reads it (a target), never for a setting the run does not keep', () => {
    const notes = (m: CanonicalModelT) => (((evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view as Rec).goal_chance?.notes ?? []) as string[]);
    const readings = (m: CanonicalModelT) => notes(m).filter((n) => n.includes('is Olumi’s reading'));
    // A deadline used as the goal's target, with no window: counted as a figure (22 weeks, provisional) and said.
    const target = bakery();
    target.quantities.push(q('build_time', 'week', { value: 21.9, quote: 'about 21.9 weeks to build' }), q('launch_by', 'week', { quote: 'by the end of March', stated_time: date('2027-03-31') }));
    target.goals = target.goals.map((g) => ({ ...g, measure: { ...g.measure!, quantity: 'build_time', target: 'launch_by', cmp: '<=', window: null } }));
    const t = countStatedTime(target, P0);
    expect(of(t, 'launch_by')).toMatchObject({ value: 22, status: 'known', author: 'olumi' });
    expect(compile(t).executable).not.toBeNull();
    expect(readings(t)).toEqual([`‘launch by’ is Olumi’s reading (not yet confirmed). ${of(t, 'launch_by').basis}`]);
    // Over their own 22 weeks (theirs: no reading said), the oven arriving in 4.5 weeks, provisionally 5.
    const arriving5 = (sets: (o: CanonicalModelT['options'][number]) => CanonicalModelT['options'][number]['sets']) => {
      const m = timed(span(22, 'week'));
      m.quantities.push(q('arrives', 'week', { quote: 'in four and a half weeks', stated_time: span(4.5, 'week') }), q('unused', '1', { value: 0 }));
      m.options = m.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: sets(o) } : o));
      return countStatedTime(m, P0);
    };
    // A setting on a figure nothing reads is dropped by the compiler: its timing is not this run's, so nothing is said of it.
    const dropped = arriving5((o) => [...o.sets, { ...o.sets[0]!, quantity: 'unused', to: null, value: 1, low: null, high: null, range_kind: null, question: null, starts_after_periods: 'arrives' }]);
    expect(compile(dropped).executable).not.toBeNull();
    expect(readings(dropped)).toEqual([]);
    // CONTRAST: the same timing on the setting the run keeps (the oven added) is said.
    const k = arriving5((o) => o.sets.map((x) => ({ ...x, starts_after_periods: 'arrives' })));
    expect(compile(k).executable).not.toBeNull();
    expect(readings(k)).toEqual([`‘arrives’ is Olumi’s reading (not yet confirmed). ${of(k, 'arrives').basis}`]);
  });

  it('review 29 Oct: a provisional count of 1,000 or more is said whole in its basis', () => {
    expect(of(countStatedTime(timed(span(1000.5, 'week')), P0), 'weeks').basis).toMatch(/^Read as 1,000\.5 weeks from your words\. The model counts whole weeks, so Olumi counts it as 1,001 weeks \(to [^)]+\) for now; confirm it, or say 1,000 \(to [^)]+\)\.$/);
  });

  it('months and years along the calendar, the same day of the month; month-end clamping is a declared convention, said where it applies', () => {
    expect(of(countStatedTime(timed(date('2027-03-29'), {}, {}, 'month'), P0), 'weeks')).toMatchObject({ value: 5, status: 'known',
      basis: 'Read as 29 Mar 2027 from your words: 5 months from 29 Oct 2026.' });
    expect(of(countStatedTime(timed(date('2027-02-28'), {}, {}, 'month'), '2027-01-31'), 'weeks')).toMatchObject({ value: 1, status: 'known',
      basis: 'Read as 28 Feb 2027 from your words: 1 month from 31 Jan 2027. Counted by calendar month: 31 Jan 2027 + 1 month = 28 Feb 2027.' });
    expect(of(countStatedTime(timed(date('2029-02-28'), {}, {}, 'year'), '2028-02-29'), 'weeks')).toMatchObject({ value: 1, status: 'known',
      basis: 'Read as 28 Feb 2029 from your words: 1 year from 29 Feb 2028. Counted by calendar year: 29 Feb 2028 + 1 year = 28 Feb 2029.' });
    // Not whole by a calendar month: 31 Mar 2027 is 5 months and 2 days from 29 Oct 2026, so Olumi's provisional reading is 5 (option B).
    expect(of(countStatedTime(timed(date('2027-03-31'), {}, {}, 'month'), P0), 'weeks')).toMatchObject({ status: 'known', value: 5, author: 'olumi',
      basis: 'Read as 31 Mar 2027 from your words: 5 months and 2 days from 29 Oct 2026. The model counts whole months, so Olumi counts it as 5 months (to 29 Mar 2027) for now; confirm it, or say 6 (to 29 Apr 2027).' });
  });

  it('a span: whole in the model\'s own unit keeps its author; a conversion is Olumi\'s; one not whole (4.5 weeks, 3 months, 2 days) is Olumi\'s provisional reading, said with the other', () => {
    expect(of(countStatedTime(timed(span(6, 'week')), P0), 'weeks')).toMatchObject({ value: 6, status: 'known', author: 'person', basis: null });
    expect(of(countStatedTime(timed(span(1, 'year'), {}, {}, 'month'), P0), 'weeks')).toMatchObject({ value: 12, author: 'olumi', basis: 'Read as 1 year from your words: 12 months.' });
    expect(of(countStatedTime(timed(span(14, 'day')), P0), 'weeks')).toMatchObject({ value: 2, author: 'olumi', basis: 'Read as 14 days from your words: 2 weeks.' });
    // Half a period rounds up; the reading is Olumi's, never theirs.
    expect(of(countStatedTime(timed(span(4.5, 'week')), P0), 'weeks')).toMatchObject({ value: 5, status: 'known', author: 'olumi', stated_time: on(span(4.5, 'week')),
      basis: 'Read as 4.5 weeks from your words. The model counts whole weeks, so Olumi counts it as 5 weeks (to 3 Dec 2026) for now; confirm it, or say 4 (to 26 Nov 2026).' });
    expect(of(countStatedTime(timed(span(3, 'month')), P0), 'weeks')).toMatchObject({ value: 13, status: 'known', author: 'olumi',
      basis: 'Read as 3 months from your words: 13 weeks and 1 day from 29 Oct 2026. The model counts whole weeks, so Olumi counts it as 13 weeks (to 28 Jan 2027) for now; confirm it, or say 14 (to 4 Feb 2027).' });
    // A window of less than one week has one whole reading, 1: never a window of zero, and no other reading to offer.
    expect(of(countStatedTime(timed(span(2, 'day')), P0), 'weeks')).toMatchObject({ value: 1, status: 'known', author: 'olumi',
      basis: 'Read as 2 days from your words. The model counts whole weeks, so Olumi counts it as 1 week (to 5 Nov 2026) for now; confirm it, or say what to change.' });
  });

  it('a position counts from period 0, and an offset of today is 0', () => {
    expect(of(countStatedTime(arriving(date(P0)), P0), 'arrives')).toMatchObject({ value: 0, status: 'known', author: 'olumi', basis: 'Read as 29 Oct 2026 from your words: 0 weeks from 29 Oct 2026.' });
    const m = countStatedTime(arriving(date('2026-11-26')), P0);
    expect(of(m, 'arrives')).toMatchObject({ value: 4, status: 'known' });
    expect(compile(m, { sourceText: BRIEF }).errors).toEqual([]);
  });

  it('a date as the length of a window that opens later counts from its opening: position − start (22 − 3 = 19)', () => {
    expect(of(countStatedTime(timed(date('2027-04-01'), { start: 3 }), P0), 'weeks')).toMatchObject({ value: 19, status: 'known',
      basis: 'Read as 1 Apr 2027 from your words: 19 weeks from 19 Nov 2026, when the window opens.' });
  });

  it('PL B: a span as a length converts along the calendar from the window\'s own opening, not from period 0', () => {
    // From Monday 4 Jan 2027, the window opens after 4 weeks, on 1 Feb 2027: one month on is 1 Mar 2027, exactly 4 weeks.
    expect(of(countStatedTime(timed(span(1, 'month'), { start: 4 }), '2027-01-04'), 'weeks')).toMatchObject({ value: 4, status: 'known', author: 'olumi',
      basis: 'Read as 1 month from your words: 4 weeks from 1 Feb 2027, when the window opens.' });
    // CONTRAST, the same span from period 0 (a position): 4 Jan to 4 Feb 2027 is 4 weeks and 3 days, Olumi's provisional 4 (option B).
    expect(of(countStatedTime(arriving(on(span(1, 'month'), '2027-01-04')), '2027-01-04'), 'arrives')).toMatchObject({ value: 4, status: 'known', author: 'olumi',
      basis: 'Read as 1 month from your words: 4 weeks and 3 days from 4 Jan 2027. The model counts whole weeks, so Olumi counts it as 4 weeks (to 1 Feb 2027) for now; confirm it, or say 5 (to 8 Feb 2027).' });
  });

  it('PL C: an origin_offset that is a quantity opens the window at its own figure when that is one known whole figure; a range or no figure withholds, saying why', () => {
    const offset = (f: Partial<CanonicalQuantityT>) => (m: CanonicalModelT) => ({ ...m, quantities: [...m.quantities, q('opening', 'week', { value: 4, quote: 'four weeks in', ...f })] });
    const read = (stated: Stated, f: Partial<CanonicalQuantityT>, p0 = P0) => of(countStatedTime(offset(f)(timed(stated, { origin_event: 'the opening', origin_offset: 'opening' })), p0), 'weeks');
    expect(read(span(1, 'month'), {}, '2027-01-04')).toMatchObject({ value: 4, status: 'known', basis: 'Read as 1 month from your words: 4 weeks from 1 Feb 2027, when the window opens.' });
    expect(read(date('2027-04-01'), { value: 3 })).toMatchObject({ value: 19, status: 'known' });
    expect(read(date('2027-04-01'), { value: 4, low: 3, high: 6, range_kind: 'plausible', status: 'estimated', author: 'olumi' })).toMatchObject({ value: null, status: 'unsupported',
      basis: 'Read as 1 Apr 2027 from your words, counted from when the window opens, which is "opening", a range rather than one figure, so it cannot be counted yet.' });
    expect(read(date('2027-04-01'), { value: null, status: 'asked', question: 'When does it open?' })).toMatchObject({ value: null, status: 'unsupported',
      basis: 'Read as 1 Apr 2027 from your words, counted from when the window opens, which is "opening", which has no whole figure in weeks yet, so it cannot be counted yet.' });
    // A span already in the model's unit needs no opening date: it is the count, whatever the offset.
    expect(read(span(6, 'week'), { value: null, status: 'asked', question: 'When does it open?' })).toMatchObject({ value: 6, status: 'known' });
  });

  it('one quantity in two roles that count differently is asked, naming both; the same count in both is the figure', () => {
    const both = (start: number) => { const m = timed(date('2027-04-01'), { start }); return countStatedTime({ ...m, options: m.options.map((o) => (o.id === 'second_oven'
      ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'weeks' })) } : o)) }, P0); };
    expect(of(both(3), 'weeks')).toMatchObject({ ...asked, stated_time: on(date('2027-04-01')),
      question: 'Read from your words as 1 Apr 2027, this counts as 22 weeks from 29 Oct 2026 in one place and 19 weeks from 19 Nov 2026 in another: which did you mean?' });
    expect(of(both(0), 'weeks')).toMatchObject({ value: 22, status: 'known' });
  });

  it('review 29 Oct (option B): two roles whose provisional readings differ are asked, never the first one saved; the same provisional count in both is the figure', () => {
    const both = (stated: Stated) => { const m = timed(stated); return countStatedTime({ ...m, options: m.options.map((o) => (o.id === 'second_oven'
      ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'weeks' })) } : o)) }, P0); };
    // 31 Oct is 2 days in: as a position Olumi would read 0 weeks, as a length never below 1. Before, both said "2 days" and 0 was saved.
    expect(of(both(date('2026-10-31')), 'weeks')).toMatchObject({ ...asked,
      question: 'Read from your words as 31 Oct 2026, this counts as 0 weeks from 29 Oct 2026 in one place and 1 week from 29 Oct 2026 in another: which did you mean?' });
    expect(of(both(span(2, 'day')), 'weeks')).toMatchObject({ ...asked,
      question: 'Read from your words as 2 days, this counts as 0 weeks in one place and 1 week in another: which did you mean?' });
    // CONTRAST: 31 Mar 2027 reads as 22 in both roles.
    expect(of(both(date('2027-03-31')), 'weeks')).toMatchObject({ value: 22, status: 'known', author: 'olumi' });
  });

  it('what cannot be read is asked with its own question: a past date, a date not after the opening, a length of 0, a span with no unit, no calendar date', () => {
    expect(of(countStatedTime(arriving(date('2026-10-01')), P0), 'arrives')).toMatchObject({ ...asked,
      question: 'The date read from your words (1 Oct 2026) is before 29 Oct 2026, when the model starts: which date did you mean?' });
    expect(of(countStatedTime(timed(date('2026-11-12'), { start: 3 }), P0), 'weeks')).toMatchObject({ ...asked,
      question: 'The date read from your words (12 Nov 2026) is not after 19 Nov 2026, when the window opens: which date did you mean?' });
    expect(of(countStatedTime(timed(span(0, 'week')), P0), 'weeks')).toMatchObject({ ...asked, question: 'A length of 0 weeks leaves nothing to count: how long did you mean?' });
    expect(of(countStatedTime(timed({ date: null, span: 6, unit: null, said_on: null }), P0), 'weeks')).toMatchObject({ ...asked, question: 'Is the 6 in your words days, weeks, months or years?' });
    expect(of(countStatedTime(timed(date('2027-02-30')), P0), 'weeks')).toMatchObject({ ...asked, question: '"2027-02-30" is not a calendar date: which date did you mean?' });
  });

  it('a quantity used in no timing slot (a duration in arithmetic, a deadline as a bound) is counted in its own unit where exact, else unsupported, never "known" with no figure; one outside the drafter\'s records is never counted', () => {
    // 29 Oct benchmark (prompts v2, 502949c7): 6 of 18 first drafts failed to compile on exactly this, a stated span left
    // "known" with no figure on a quantity no window or timing reads. Before it the stated time was cleared, figure as written.
    const m = bakery();
    m.quantities.push(q('spare', 'week', { value: null, stated_time: date('2027-04-01') }), q('season', 'week', { value: null, stated_time: span(6, 'week') }),
      q('fee_due', 'GBP', { value: null, stated_time: date('2027-04-01') }), q('given', 'GBP', { value: 40, stated_time: span(2, 'week') }));
    const c = countStatedTime(m, P0);
    expect(of(c, 'spare')).toMatchObject({ value: 22, status: 'known', author: 'olumi', basis: 'Read as 1 Apr 2027 from your words: 22 weeks from 29 Oct 2026.' });
    expect(of(c, 'season')).toMatchObject({ value: 6, status: 'known', author: 'person', basis: null });
    expect(of(c, 'fee_due')).toMatchObject({ value: null, status: 'unsupported',
      basis: '"fee due" is in "GBP", so the date or length of time read from your words cannot be counted in it.' });
    expect(of(c, 'given')).toMatchObject({ value: 40, status: 'known', stated_time: null });
    expect(compile(c).errors.filter((e) => e.code === 'figure_status')).toEqual([]);
    const saved = timed(date('2027-04-01'));
    expect(of(countStatedTime(saved, P0, new Set(['spare'])), 'weeks')).toEqual(of(saved, 'weeks'));
  });

  it('review 29 Oct: a saved provisional reading recounted where it is no longer a timing is their figure exactly, never with the earlier reading\'s basis', () => {
    const saved = countStatedTime(timed(span(4.5, 'week')), P0);
    expect(of(saved, 'weeks')).toMatchObject({ value: 5, author: 'olumi', basis: expect.stringContaining('Olumi counts it as 5 weeks (to 3 Dec 2026)') });
    // An update on 12 Nov drops the window and returns the quantity unrestated: 4.5 weeks in weeks is 4.5. The author it was saved
    // with is kept (a span in its own unit keeps its author); the basis Olumi wrote for 5 weeks no longer says how it was counted.
    const returned = { ...saved, goals: saved.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: null } })) };
    expect(of(countStatedTime(returned, P0, new Set(['weeks'])), 'weeks'))
      .toMatchObject({ value: 4.5, status: 'known', author: 'olumi', basis: null, stated_time: on(span(4.5, 'week')) });
  });

  it('CONTRAST: a model with no stated time to count is returned as it is', () => {
    const m = timed(null, {}, { value: 7 });
    expect(countStatedTime(m, P0)).toBe(m);
  });
});

describe('the PL\'s HOLD on v2 (DL-3 12:50Z): what cannot be counted exactly is withheld, never reinterpreted', () => {
  it('(b) a counting quantity in another unit is not counted: its own unit and bounds are kept, never read as the model\'s period', () => {
    const w = of(countStatedTime(timed(date('2027-04-01'), {}, { unit: 'day', floor: 0, ceiling: 400 }), P0), 'weeks');
    expect(w).toMatchObject({ unit: 'day', floor: 0, ceiling: 400, value: null, status: 'unsupported', stated_time: on(date('2027-04-01')),
      basis: '"weeks" counts the model\'s periods but is in "day": a counting quantity is in the model\'s period (week), so its stated time is not counted.' });
  });

  it('(c) a date and a span together are ambiguous: neither takes precedence, and it is not counted', () => {
    const both: Stated = { date: '2027-04-01', span: 6, unit: 'week', said_on: P0 };
    expect(of(countStatedTime(timed(both), P0), 'weeks')).toMatchObject({ value: null, status: 'unsupported', stated_time: on(both),
      basis: 'Your words were read as both a date (2027-04-01) and a length of time (6 weeks); which one this counts is not clear, so it is not counted.' });
  });

  it('(d) a window\'s length ends on the model\'s own calendar grid: from period 0 on 31 Jan, a month from the opening on 28 Feb ends 28 Mar, off period 2 (31 Mar), so it is withheld; CONTRAST, from period 0 it is 1 month', () => {
    const m = (start: number) => of(countStatedTime(timed(span(1, 'month'), { start }, {}, 'month'), '2027-01-31'), 'weeks');
    expect(m(1)).toMatchObject({ value: null, status: 'unsupported',
      basis: 'Read as 1 month from your words: from 28 Feb 2027, when the window opens, it ends on 28 Mar 2027, but the model\'s 1 month from then ends on 31 Mar 2027, counted by calendar month from 31 Jan 2027. A length that ends on the model\'s own months would be a change to your length of time.' });
    expect(m(0)).toMatchObject({ value: 1, status: 'known' });
  });

  it('(e) an opening offset with low = high is one point, as compile reads it, never a range', () => {
    const m = timed(span(1, 'month'), { origin_event: 'the opening', origin_offset: 'opening' });
    m.quantities.push(q('opening', 'week', { value: null, low: 4, high: 4, range_kind: 'bounds', quote: 'four weeks in' }));
    expect(of(countStatedTime(m, '2027-01-04'), 'weeks')).toMatchObject({ value: 4, status: 'known' });
  });

  it('(a) an update on a model saved without its start date never counts from today: a date, and a position span (PL 13:40Z: counted from today, measured from period 0), are withheld naming the missing start date; a length span in the model\'s own unit needs none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
      const saved = bakery();
      // 29 Oct (PL 15:19Z): a time newly stated in an update carries today's date as said_on, as the schema asks; null is unknown.
      const arrives = q('arrives', 'week', { quote: 'the oven comes on 26 November', stated_time: on(date('2026-11-26'), '2026-11-12') });
      const options = saved.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'arrives' })) } : o));
      const update = { version: 'canonical.v1', question: null, period: null, coaching_questions: null, decide_by: null, quantities: [arrives], relations: [], goals: [], limits: [],
        preferences: [], options: options.filter((o) => o.id === 'second_oven'), risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
      // No periodZero: a program saved before its first draft's day was kept.
      const out = await proposePostimage(saved, [BRIEF], 'The oven comes on 26 November.', [], async () => ({ text: JSON.stringify(update), status: 'completed', incomplete: null, usage: null }));
      expect(of(out.model!, 'arrives')).toMatchObject({ value: null, status: 'unsupported', stated_time: on(date('2026-11-26'), '2026-11-12'),
        basis: 'Read as 26 Nov 2026 from your words, but the date this model starts from (its period 0) was not kept when it was first saved, so it cannot be counted in weeks yet.' });
    } finally { vi.useRealTimers(); }
    // 29 Oct (PL 13:40Z): a position span counts from the day it is said, so it needs period 0 as a date does; before it the
    // position span counted 3 with no start date.
    expect(of(countStatedTime(arriving(on(span(3, 'week'), '2026-11-12')), null), 'arrives')).toMatchObject({ value: null, status: 'unsupported', stated_time: on(span(3, 'week'), '2026-11-12'),
      basis: 'Read as 3 weeks from your words, but the date this model starts from (its period 0) was not kept when it was first saved, so it cannot be counted in weeks yet.' });
    expect(of(countStatedTime(timed(on(span(3, 'week'), '2026-11-12')), null), 'weeks')).toMatchObject({ value: 3, status: 'known', author: 'person', basis: null });
  });
});

describe('on an update, only what the drafter returns is counted, from the saved period 0', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('PL D: on 12 Nov the update counts its new date from the saved 29 Oct; the saved answered figure beside it is untouched; an answer clears its stated time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    // Saved: their window, answered (their 20 weeks), beside the stated date it once had: never counted again.
    const saved = timed(date('2027-03-31'), {}, { value: 20, status: 'known', author: 'person', quote: 'twenty weeks' });
    const arrives = q('arrives', 'week', { quote: 'the oven comes on 26 November', stated_time: date('2026-11-26') });
    const options = saved.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'arrives' })) } : o));
    const update = { version: 'canonical.v1', question: null, period: null, coaching_questions: null, decide_by: null, quantities: [arrives], relations: [], goals: [], limits: [],
      preferences: [], options: options.filter((o) => o.id === 'second_oven'), risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
    const out = await proposePostimage(saved, [BRIEF], 'The oven comes on 26 November.', [], async () => ({ text: JSON.stringify(update), status: 'completed', incomplete: null, usage: null }), P0);
    expect(out.model).not.toBeNull();
    // 26 Nov is 4 weeks from the saved 29 Oct (2 from today, 12 Nov).
    expect(of(out.model!, 'arrives')).toMatchObject({ value: 4, status: 'known', author: 'olumi', basis: 'Read as 26 Nov 2026 from your words: 4 weeks from 29 Oct 2026.' });
    expect(of(out.model!, 'weeks')).toEqual(of(saved, 'weeks'));
    // Their answer on it: the figure is theirs, its stated time cleared (the S2 builder answers and the canvas both use).
    const answered = figurePostimage(out.model!, { ...of(out.model!, 'arrives'), value: 6, author: 'person', quote: 'six weeks', basis: null });
    expect(of(answered, 'arrives')).toMatchObject({ value: 6, author: 'person', stated_time: null });
  });

  it('PL 13:40Z: on 12 Nov a POSITION span counts from the day it is said, measured from the saved 29 Oct ("in 2 weeks": 26 Nov, 4 weeks); CONTRAST, a LENGTH span of 2 weeks stays 2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    // The same saved model and update as PL D, the oven's arrival now stated as a span, and the window's length restated as one.
    const saved = timed(date('2027-03-31'), {}, { value: 20, status: 'known', author: 'person', quote: 'twenty weeks' });
    // 29 Oct (PL 15:19Z): newly stated in this update, so each carries today's date as said_on.
    const arrives = q('arrives', 'week', { quote: 'it starts in 2 weeks from today', stated_time: on(span(2, 'week'), '2026-11-12') });
    const weeks = { ...of(saved, 'weeks'), value: null, status: 'known' as const, quote: 'over 2 weeks', stated_time: on(span(2, 'week'), '2026-11-12') };
    const options = saved.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'arrives' })) } : o));
    const update = { version: 'canonical.v1', question: null, period: null, coaching_questions: null, decide_by: null, quantities: [arrives, weeks], relations: [], goals: [], limits: [],
      preferences: [], options: options.filter((o) => o.id === 'second_oven'), risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
    const out = await proposePostimage(saved, [BRIEF], 'It starts in 2 weeks from today, over 2 weeks.', [], async () => ({ text: JSON.stringify(update), status: 'completed', incomplete: null, usage: null }), P0);
    expect(out.model).not.toBeNull();
    // Before it: 2, counted from period 0 as if said on 29 Oct.
    expect(of(out.model!, 'arrives')).toMatchObject({ value: 4, status: 'known', author: 'olumi', stated_time: on(span(2, 'week'), '2026-11-12'),
      basis: 'Read as 2 weeks from your words, said on 12 Nov 2026: to 26 Nov 2026, 4 weeks from 29 Oct 2026.' });
    expect(of(out.model!, 'weeks')).toMatchObject({ value: 2, status: 'known', author: 'person', basis: null });
  });

  /** PL 14:12Z: saved on 29 Oct with "in 2 weeks", their own figure, 2 (12 Nov), said on 29 Oct; on 12 Nov an update returns one quantity. */
  const savedSpan = () => countStatedTime(arriving(span(2, 'week')), P0);
  const updatedOn12Nov = (saved: CanonicalModelT, returned: CanonicalQuantityT, over: Rec = {}) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    return proposePostimage(saved, [BRIEF], 'The change.', [], async () => ({ status: 'completed', incomplete: null, usage: null,
      text: JSON.stringify({ version: 'canonical.v1', question: null, period: null, coaching_questions: null, decide_by: null, quantities: [returned], relations: [], goals: [], limits: [],
        preferences: [], options: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [], ...over }) }), P0);
  };

  it('PL 14:12Z (a): a rename that returns the saved said_on (29 Oct) keeps 2 (12 Nov): its position counts from the day it was said, never a later today', async () => {
    const saved = savedSpan();
    expect(of(saved, 'arrives')).toMatchObject({ value: 2, status: 'known', author: 'person', basis: null, stated_time: on(span(2, 'week')) });
    const a = of((await updatedOn12Nov(saved, { ...of(saved, 'arrives'), label: 'oven arrival', value: null })).model!, 'arrives');
    expect(a).toMatchObject({ label: 'oven arrival', value: 2, status: 'known', author: 'person', basis: null, stated_time: on(span(2, 'week')) });
  });

  it('PL 14:12Z (b) + 15:19Z: the same span newly stated on 12 Nov carries that day as said_on and counts from it: 26 Nov, 4 weeks from 29 Oct; CONTRAST, a null said_on on an update is an unknown day, withheld, never today', async () => {
    const saved = savedSpan();
    const b = of((await updatedOn12Nov(saved, { ...of(saved, 'arrives'), value: null, quote: 'in 2 weeks from now', stated_time: on(span(2, 'week'), '2026-11-12') })).model!, 'arrives');
    expect(b).toMatchObject({ value: 4, status: 'known', author: 'olumi', stated_time: on(span(2, 'week'), '2026-11-12'),
      basis: 'Read as 2 weeks from your words, said on 12 Nov 2026: to 26 Nov 2026, 4 weeks from 29 Oct 2026.' });
    const unknown = of((await updatedOn12Nov(saved, { ...of(saved, 'arrives'), value: null, stated_time: on(span(2, 'week'), null) })).model!, 'arrives');
    expect(unknown).toMatchObject({ value: null, status: 'unsupported',
      basis: 'Read as 2 weeks from your words, counted from the day they were said, which is not known, so it cannot be counted yet.' });
  });

  it('PL 14:12Z (c): a saved 1-year window returned after a switch to monthly periods is counted again: 12 months, never the saved 1', async () => {
    const saved = countStatedTime(timed(span(1, 'year'), {}, {}, 'year'), P0);
    expect(of(saved, 'weeks')).toMatchObject({ value: 1, status: 'known', unit: 'year' });
    const c = of((await updatedOn12Nov(saved, { ...of(saved, 'weeks'), unit: 'month', value: null }, { period: 'month' })).model!, 'weeks');
    expect(c).toMatchObject({ value: 12, status: 'known', unit: 'month', author: 'olumi', basis: 'Read as 1 year from your words: 12 months.', stated_time: on(span(1, 'year')) });
  });

  it('PL 14:12Z (d) + 16:42Z: a first draft counts every stated time, a position span from the day the drafter says it was said, period 0; a day not known is withheld there too, never today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const draft = async (stated: Stated) => of((await draftCanonicalModel(BRIEF, async () => ({ text: JSON.stringify(arriving(stated)), status: 'completed', incomplete: null, usage: null }),
      BRIEF, { interpret: true })).model!, 'arrives');
    const drafted = arriving(on(span(2, 'week'), '2026-11-12'));
    expect(await draft(on(span(2, 'week'), '2026-11-12'))).toMatchObject({ value: 2, status: 'known', author: 'person', basis: null, stated_time: on(span(2, 'week'), '2026-11-12') });
    expect(await draft(on(span(2, 'week'), '2026-11-12'))).toEqual(of(countStatedTime(drafted, '2026-11-12'), 'arrives'));
    // "They promised two weeks; I don't know when they said it": no day, so no position, on a first draft as on an update.
    // Before it a first draft's null was read as today and counted 2.
    expect(await draft(on(span(2, 'week'), null))).toMatchObject({ value: null, status: 'unsupported', stated_time: on(span(2, 'week'), null),
      basis: 'Read as 2 weeks from your words, counted from the day they were said, which is not known, so it cannot be counted yet.' });
  });

  it('PL 13:40Z: a position span from the day it is said lands on the model\'s grid, or off it is Olumi\'s provisional reading (option B); a day before period 0, or no day, is withheld; a first draft (said on period 0) is unchanged', () => {
    const said = (stated: Stated, day: string | null, p0: string | null = P0) => of(countStatedTime(arriving(on(stated, day)), p0), 'arrives');
    expect(said(span(10, 'day'), '2026-11-12')).toMatchObject({ value: 3, status: 'known', author: 'olumi',
      basis: 'Read as 10 days from your words, said on 12 Nov 2026: to 22 Nov 2026, 3 weeks and 3 days from 29 Oct 2026. The model counts whole weeks, so Olumi counts it as 3 weeks (to 19 Nov 2026) for now; confirm it, or say 4 (to 26 Nov 2026).' });
    expect(said(span(1, 'month'), '2026-11-12')).toMatchObject({ value: 6, status: 'known', author: 'olumi',
      basis: 'Read as 1 month from your words, said on 12 Nov 2026: to 12 Dec 2026, 6 weeks and 2 days from 29 Oct 2026. The model counts whole weeks, so Olumi counts it as 6 weeks (to 10 Dec 2026) for now; confirm it, or say 7 (to 17 Dec 2026).' });
    expect(said(span(2, 'week'), '2026-10-20')).toMatchObject({ value: null, status: 'unsupported', author: 'olumi',
      basis: 'Read as 2 weeks from your words, said on 20 Oct 2026, before 29 Oct 2026, when the model starts, so it cannot be counted.' });
    expect(said(span(2, 'week'), null)).toMatchObject({ value: null, status: 'unsupported', author: 'olumi',
      basis: 'Read as 2 weeks from your words, counted from the day they were said, which is not known, so it cannot be counted yet.' });
    // Said on period 0 (a first draft), exactly as before: their own figure, their author.
    expect(said(span(2, 'week'), P0)).toEqual(of(countStatedTime(arriving(span(2, 'week')), P0), 'arrives'));
    expect(said(span(2, 'week'), P0)).toMatchObject({ value: 2, status: 'known', author: 'person', basis: null });
    // A date is absolute: the day it is said does not move it (that day is kept, never read for a date).
    expect(said(date('2026-11-26'), '2026-11-12')).toEqual({ ...of(countStatedTime(arriving(date('2026-11-26')), P0), 'arrives'), stated_time: on(date('2026-11-26'), '2026-11-12') });
    // PL 14:12Z: a position span counts from its own said_on; one before period 0, or not a calendar date, is withheld.
    expect(said(span(2, 'week'), '2026-11-12')).toMatchObject({ value: 4, status: 'known', author: 'olumi', stated_time: on(span(2, 'week'), '2026-11-12') });
    expect(said(span(2, 'week'), '2026-10-20')).toMatchObject({ value: null, status: 'unsupported',
      basis: 'Read as 2 weeks from your words, said on 20 Oct 2026, before 29 Oct 2026, when the model starts, so it cannot be counted.' });
    expect(said(span(2, 'week'), 'last spring')).toMatchObject({ value: null, status: 'unsupported', stated_time: on(span(2, 'week'), 'last spring'),
      basis: 'Read as 2 weeks from your words, said on "last spring", which is not a calendar date, so it cannot be counted.' });
  });
});

describe('decide_by: when they must decide, kept apart from their words, never calculated', () => {
  const READ = { date: '2026-11-15', quote: 'mid-November' };
  const with_ = (decide_by: CanonicalModelT['decide_by']): CanonicalModelT => ({ ...bakery(), decide_by });
  const none = { version: 'canonical.v1', question: null, period: null, coaching_questions: null, decide_by: null, quantities: [], relations: [], goals: [], limits: [],
    preferences: [], options: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };

  it('a model saved before stated time reads with none on any quantity and no decide-by date', () => {
    const { stated_time: _s, ...oldQ } = q('weeks', 'week', {});
    const { decide_by: _d, ...oldM } = { ...bakery(), quantities: [oldQ] };
    const read = CanonicalModel.parse(withDeclaredTiming(oldM));
    expect([read.decide_by, read.quantities[0]!.stated_time]).toEqual([null, null]);
  });

  it('an update: null keeps the saved one, date and quote both null clear it, any other replaces it; each change is the card\'s row, Olumi\'s reading apart from their words', () => {
    const saved = with_(READ);
    expect(mergeUpdate(saved, none as never).decide_by).toEqual(READ);
    expect(mergeUpdate(saved, { ...none, decide_by: { date: null, quote: null } } as never).decide_by).toBeNull();
    const moved = mergeUpdate(saved, { ...none, decide_by: { date: '2026-11-26', quote: 'the board moved to the 26th' } } as never);
    expect(moved.decide_by).toEqual({ date: '2026-11-26', quote: 'the board moved to the 26th' });
    const row = (post: CanonicalModelT) => { const v = validatePostimage(saved, post, { removals: [], words: [BRIEF], fresh: [] }); return v.ok ? v.changes.map((c) => [c.id, c.label, c.before, c.after]) : v.code; };
    expect(row(moved)).toEqual([['decide_by', 'When you must decide', '15 Nov 2026, Olumi’s reading of “mid-November”', '26 Nov 2026, Olumi’s reading of “the board moved to the 26th”']]);
    expect(row(with_(null))).toEqual([['decide_by', 'When you must decide', '15 Nov 2026, Olumi’s reading of “mid-November”', 'Not given']]);
    expect(row(saved)).toBe('no_change');
    // (f, PL HOLD) A change or a clear is recoverable from the history, as a changed record is; setting one where none was is not.
    const historyOf = (post: CanonicalModelT) => { const v = validatePostimage(saved, post, { removals: [], words: [BRIEF], fresh: [] }); return v.ok ? v.model.history : v.code; };
    expect(historyOf(moved)).toEqual([{ id: 'decide_by', change: 'superseded', old: JSON.stringify(READ), quote: 'the board moved to the 26th', author_id: null, approved_by: null }]);
    expect(historyOf(with_(null))).toEqual([{ id: 'decide_by', change: 'withdrawn', old: JSON.stringify(READ), quote: null, author_id: null, approved_by: null }]);
    const fresh = validatePostimage(with_(null), saved, { removals: [], words: [BRIEF], fresh: [] });
    expect(fresh.ok ? fresh.model.history : fresh.code).toEqual([]);
  });

  it('round-trips save and reopen and is drawn on the decision node, date and quote apart; the compiler never reads it', () => {
    const { graph } = withNewRun({ model_program: MODEL_PROGRAM, canonical: with_(READ), seed: 7, person_words: [BRIEF], runs: [] });
    const opened = reopenProgram(JSON.parse(JSON.stringify(graph)))!;
    expect(opened.program.canonical.decide_by).toEqual(READ);
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    const m = with_(READ);
    const node = (project(m, compile(m, { sourceText: BRIEF }), { brief: BRIEF }).graph.nodes as Rec[]).find((n) => n.id === DECISION_NODE_ID)!;
    expect(node['decide_by']).toEqual(READ);
    // Never executed: the compiler has no reference to it, and compiles the model with or without it alike.
    expect(readFileSync(new URL('../../model-program/compile.ts', import.meta.url), 'utf8')).not.toContain('decide_by');
    expect(compile(m, { sourceText: BRIEF })).toEqual(compile(with_(null), { sourceText: BRIEF }));
  });
});
