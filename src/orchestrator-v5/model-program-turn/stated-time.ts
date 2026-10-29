/**
 * Stated time, counted by the host exactly, never rounded silently (DL v2, 29 Oct, outbox/TIME-AND-DECIDE-BY-DESIGN-v2-20261029.md,
 * with the PL's corrections A–H). The drafter writes a date or a span exactly as it reads the person's words (`stated_time`);
 * the calendar arithmetic is the host's: a week is 7 days, a month the same day of the month (clamped to the month's last
 * day, said in the basis), a year the same month and day. No prose is parsed: reading "the end of March" as a date stays the AI's.
 *
 * Each count's role is read from where the model uses the quantity, never assumed:
 *  · POSITION (a window's `origin_offset`, an option setting's or a risk's `starts_after_periods`): periods from period 0, 0 allowed;
 *    a span counts from the day it was said (PL 13:40Z), its `said_on` (PL 14:12Z: today when stated in this message, the saved
 *    day when the record is returned unrestated; null is not known, PL 16:42Z), along the calendar, then from period 0 exactly
 *    as a date (said on period 0, as in a first draft, it is the span itself);
 *  · LENGTH (a window's `periods`): a date counts from the window's opening, `position − (offset + start)`, at least 1; a span
 *    counts along the calendar from that opening's date.
 * A whole count is the figure, known. A count that is not whole is Olumi's provisional reading (Paul, 29 Oct, option B): the
 * nearest whole period, author olumi, its basis naming the other whole reading so the person confirms or changes it on the card.
 * What cannot be read at all (a past date, an empty window, uses that disagree, no unit) is asked, with its own question.
 * A quantity the model uses in no timing slot has its stated time cleared: it is never read, so nothing unshown is saved.
 * The PL's HOLD (DL-3 12:50Z): a model saved without its start date has no period 0 to count a date from, never today; a
 * counting quantity is in the model's period, or it is not counted; a date and a span together are ambiguous; a window's
 * length ends on the model's own calendar grid from period 0, or it is withheld; an opening offset with low = high is a point.
 * Dates are absolute: the day they are said never moves them. Every count keeps the day it was said (`said_on`), so a later
 * update counts a span said earlier from that day, and a change of period counts it again in the new period.
 */
import { FIGURE_STATUSES, type CanonicalModelT, type CanonicalQuantityT } from '../model-program/canonical.js';
import { isCalendarDate } from '../goal-target/deadline-date.js';

type Period = CanonicalModelT['period'];
type Unit = 'day' | 'week' | 'month' | 'year';
type Stated = NonNullable<CanonicalQuantityT['stated_time']>;

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY;
const shown = (day: number) => new Date(Math.floor(day) * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const num = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 6 });
const counted = (n: number, unit: string) => `${num(n)} ${unit}${n === 1 ? '' : 's'}`;
/** Float tolerance only (0.25 year × 12 is 3 months): a count is whole or it is not; nothing is rounded to make it so. */
const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;

/** `k` whole units after day `a` along the calendar, and the day of the month it was clamped from, if it was. */
function after(a: number, k: number, unit: Unit): { readonly day: number; readonly clamped: boolean } {
  if (unit === 'day' || unit === 'week') return { day: a + k * (unit === 'week' ? 7 : 1), clamped: false };
  const d = new Date(a * DAY);
  const months = d.getUTCMonth() + k * (unit === 'year' ? 12 : 1);
  const y = d.getUTCFullYear() + Math.floor(months / 12);
  const m = ((months % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return { day: Date.UTC(y, m, day) / DAY, clamped: day !== d.getUTCDate() };
}
/** The declared month-end convention (PL H), said only where it applied. */
const clampNote = (a: number, k: number, p: Unit): string => {
  const at = after(a, k, p);
  return at.clamped ? ` Counted by calendar ${p}: ${shown(a)} + ${counted(k, p)} = ${shown(at.day)}.` : '';
};
/** From day `a` to day `e` in the model's periods: the whole periods that fit (`k`), and whether `e` falls exactly on one. */
function measure(a: number, e: number, p: Period): { readonly k: number; readonly whole: boolean; readonly rest: number } {
  let k = Math.floor((e - a) / (p === 'week' ? 7 : p === 'month' ? 30.4375 : 365.25));
  while (after(a, k, p).day > e) k -= 1;
  while (after(a, k + 1, p).day <= e) k += 1;
  const rest = e - after(a, k, p).day;
  return { k, whole: rest === 0, rest };
}
const inPeriods = (k: number, rest: number, p: Period) => (rest === 0 ? counted(k, p) : k === 0 ? counted(rest, 'day') : `${counted(k, p)} and ${counted(rest, 'day')}`);

/** One use's reading: a count (whole, or Olumi's provisional reading); what cannot be counted (unsupported); or a question. */
type Reading =
  | { readonly kind: 'count'; readonly n: number; readonly olumi: boolean; readonly basis: string | null; readonly say: string }
  | { readonly kind: 'unsupported'; readonly olumi: boolean; readonly basis: string; readonly say: string }
  | { readonly kind: 'ask'; readonly question: string };
/** Where the model uses a quantity as a timing: a position, or the length of a window opening at `offset` + `start`. */
type Use = { readonly role: 'position' } | { readonly role: 'length'; readonly offset: string | null; readonly start: number };

function usesOf(model: CanonicalModelT, id: string): Use[] {
  const windows = [...model.goals.map((g) => g.measure?.window), ...model.limits.map((l) => l.measure?.window)].filter((w) => w != null);
  return [
    ...windows.filter((w) => w.origin_offset === id).map((): Use => ({ role: 'position' })),
    ...model.options.flatMap((o) => o.sets).filter((s) => s.starts_after_periods === id).map((): Use => ({ role: 'position' })),
    ...model.risks.filter((k) => k.starts_after_periods === id).map((): Use => ({ role: 'position' })),
    ...windows.filter((w) => w.periods === id).map((w): Use => ({ role: 'length', offset: w.origin_offset, start: w.start })),
  ];
}

/**
 * A count whole periods cannot hold exactly (Paul, 29 Oct, option B): Olumi's PROVISIONAL reading, the nearest whole period,
 * said with the other whole reading and its date, so the person confirms or changes it on the card. Olumi's own reading
 * (author olumi), shown "not yet confirmed" until they do; never a silent rounding, and never below `min`.
 */
function provisional(head: string, k: number, rest: number, p: Period, grid: (j: number) => number, min: number, from: string): Reading {
  const n = k < min ? min : rest * 2 < grid(k + 1) - grid(k) ? k : k + 1;
  const other = n === k ? k + 1 : k;
  const alt = other >= min ? `; confirm it, or say ${num(other)} (to ${shown(grid(other))})` : '; confirm it, or say what to change';
  // Said as the count it gives, as a whole count is, so two uses that count it differently are asked (review 29 Oct).
  return { kind: 'count', n, olumi: true, say: `${counted(n, p)} from ${from}`, basis: `${head} The model counts whole ${p}s, so Olumi counts it as ${counted(n, p)} (to ${shown(grid(n))}) for now${alt}.` };
}

/**
 * The basis kept on a count that is not Olumi's reading (their span in its own unit): never one Olumi wrote for an earlier
 * reading, which no longer says how this figure was counted (review 29 Oct: a saved provisional 5 weeks recounted as 4.5).
 */
const keptBasis = (q: CanonicalQuantityT): string | null => (q.author === 'olumi' ? null : q.basis);

/** What cannot be counted without the model's own start date (a save from before it was kept): never counted from today. */
const noStart = (what: string, p: Period): Reading => ({ kind: 'unsupported', olumi: true, say: 'with no start date',
  basis: `Read as ${what} from your words, but the date this model starts from (its period 0) was not kept when it was first saved, so it cannot be counted in ${p}s yet.` });
const notOpen = (what: string, why: string): Reading => ({ kind: 'unsupported', olumi: true, say: 'counted from when the window opens',
  basis: `Read as ${what} from your words, counted from when the window opens, which ${why}, so it cannot be counted yet.` });

/**
 * One use of one stated time. `p0` is period 0's day, or null when the model's start date is not known; `said` the day the
 * words were said (YYYY-MM-DD: its said_on), or null when not known;
 * `opening` the window's opening in periods (a length), or why it cannot be known yet. Every count lands on the model's own
 * grid: whole periods from period 0 along the calendar.
 */
function readUse(t: Stated, use: Use, p: Period, p0: number | null, said: string | null, opening: number | { readonly why: string }): Reading {
  const length = use.role === 'length';
  // A date and a span together: which one counts is not clear, and neither takes precedence.
  if (t.date !== null && t.span !== null) {
    return { kind: 'unsupported', olumi: true, say: 'both a date and a length of time',
      basis: `Your words were read as both a date (${t.date}) and a length of time (${counted(t.span, t.unit ?? 'period')}); which one this counts is not clear, so it is not counted.` };
  }
  if (t.date !== null) {
    if (!isCalendarDate(t.date)) return { kind: 'ask', question: `"${t.date}" is not a calendar date: which date did you mean?` };
    const d = dayOf(t.date);
    if (p0 === null) return noStart(shown(d), p);
    if (!length) {
      if (d < p0) return { kind: 'ask', question: `The date read from your words (${shown(d)}) is before ${shown(p0)}, when the model starts: which date did you mean?` };
      const m = measure(p0, d, p);
      return m.whole
        ? { kind: 'count', n: m.k, olumi: true, basis: `Read as ${shown(d)} from your words: ${counted(m.k, p)} from ${shown(p0)}.${clampNote(p0, m.k, p)}`, say: `${counted(m.k, p)} from ${shown(p0)}` }
        : provisional(`Read as ${shown(d)} from your words: ${inPeriods(m.k, m.rest, p)} from ${shown(p0)}.`, m.k, m.rest, p, (j) => after(p0, j, p).day, 0, shown(p0));
    }
    if (typeof opening !== 'number') return notOpen(shown(d), opening.why);
    const o = after(p0, opening, p).day;
    const opens = opening === 0 ? '' : `, when the window opens`;
    if (d <= o) return { kind: 'ask', question: `The date read from your words (${shown(d)}) is not after ${shown(o)}${opens}: which date did you mean?` };
    const m = measure(p0, d, p);
    const n = m.k - opening;
    return m.whole
      ? { kind: 'count', n, olumi: true, basis: `Read as ${shown(d)} from your words: ${counted(n, p)} from ${shown(o)}${opens}.${clampNote(p0, m.k, p)}`, say: `${counted(n, p)} from ${shown(o)}` }
      : provisional(`Read as ${shown(d)} from your words: ${inPeriods(n, m.rest, p)} from ${shown(o)}${opens}.`, n, m.rest, p, (j) => after(p0, opening + j, p).day, 1, shown(o));
  }
  if (t.span === null) return { kind: 'ask', question: 'Which date or length of time did you mean?' };
  if (t.unit === null) return { kind: 'ask', question: `Is the ${num(t.span)} in your words days, weeks, months or years?` };
  if (t.span < 0 || (length && t.span === 0)) return { kind: 'ask', question: `A length of ${counted(t.span, t.unit)} leaves nothing to count: how long did you mean?` };
  const what = counted(t.span, t.unit);
  const months = t.span * (t.unit === 'year' ? 12 : 1);
  // A position span counts from the day it is said (PL 13:40Z): along the calendar from then, then from period 0 on the
  // model's grid with the same whole check as a date. Said on period 0 (a first draft), it is the span itself, read below.
  const now = said !== null && isCalendarDate(said) ? dayOf(said) : null;
  if (!length && (p0 === null || now !== p0)) {
    if (p0 === null) return noStart(what, p);
    if (said !== null && now === null) return { kind: 'unsupported', olumi: true, say: `said on "${said}"`,
      basis: `Read as ${what} from your words, said on "${said}", which is not a calendar date, so it cannot be counted.` };
    if (now === null) return { kind: 'unsupported', olumi: true, say: 'from a day not known',
      basis: `Read as ${what} from your words, counted from the day they were said, which is not known, so it cannot be counted yet.` };
    if (now < p0) return { kind: 'unsupported', olumi: true, say: `from ${shown(now)}`,
      basis: `Read as ${what} from your words, said on ${shown(now)}, before ${shown(p0)}, when the model starts, so it cannot be counted.` };
    const calendar = t.unit === 'month' || t.unit === 'year';
    const days = t.span * (t.unit === 'week' ? 7 : 1);
    if (!whole(calendar ? months : days)) {
      return { kind: 'unsupported', olumi: true, say: what, basis: `Read as ${what} from your words, said on ${shown(now)}, which is not a whole number of calendar ${calendar ? 'months' : 'days'}, so it cannot be counted in ${p}s exactly; a figure in ${p}s would be a change to your length of time.` };
    }
    const end = calendar ? after(now, Math.round(months), 'month') : { day: now + Math.round(days), clamped: false };
    const note = end.clamped ? ` Counted by calendar month: ${shown(now)} + ${counted(Math.round(months), 'month')} = ${shown(end.day)}.` : '';
    const m = measure(p0, end.day, p);
    const head = `Read as ${what} from your words, said on ${shown(now)}: to ${shown(end.day)}, ${inPeriods(m.k, m.rest, p)} from ${shown(p0)}.`;
    if (m.whole) return { kind: 'count', n: m.k, olumi: true, basis: `${head}${note || clampNote(p0, m.k, p)}`, say: `${counted(m.k, p)} from ${shown(p0)}` };
    return provisional(head, m.k, m.rest, p, (j) => after(p0, j, p).day, 0, shown(p0));
  }
  const own = t.unit === p;
  const start = length ? opening : 0;
  const opens = length && opening !== 0 ? ', when the window opens' : '';
  // A span in its own family (days and weeks, months and years) converts exactly with no calendar; across them it is counted
  // along the calendar from where it starts: period 0 for a position, the window's opening for a length (PL B).
  const linear = own || ((t.unit === 'day' || t.unit === 'week') === (p === 'week'));
  if (linear) {
    const n = (t.span * (t.unit === 'week' ? 7 : t.unit === 'year' ? 12 : 1)) / (p === 'week' ? 7 : p === 'year' ? 12 : 1);
    if (whole(n)) {
      const c = Math.round(n);
      // A length in months or years from an opening after period 0 must end on the model's own grid (period 0 + whole periods):
      // from an opening clamped to a month's end (31 Jan + 1 month = 28 Feb), a calendar month on ends off it (28 Mar, not 31 Mar).
      if (length && start !== 0 && p !== 'week' && (p0 === null || new Date(p0 * DAY).getUTCDate() > 28)) {
        if (p0 === null) return noStart(what, p);
        if (typeof start !== 'number') return notOpen(what, (start as { readonly why: string }).why);
        const o = after(p0, start, p).day;
        const end = after(o, Math.round(months), 'month').day;
        const grid = after(p0, start + c, p).day;
        if (end !== grid) {
          return { kind: 'unsupported', olumi: true, say: `${what} from ${shown(o)}`,
            basis: `Read as ${what} from your words: from ${shown(o)}, when the window opens, it ends on ${shown(end)}, but the model's ${counted(c, p)} from then ${c === 1 ? 'ends' : 'end'} on ${shown(grid)}, counted by calendar ${p} from ${shown(p0)}. A length that ends on the model's own ${p}s would be a change to your length of time.` };
        }
      }
      return own ? { kind: 'count', n: c, olumi: false, basis: null, say: counted(c, p) }
        : { kind: 'count', n: c, olumi: true, basis: `Read as ${what} from your words: ${counted(c, p)}.`, say: counted(c, p) };
    }
    const k = Math.floor(n);
    const at = (j: number): number | null => (p0 === null ? null : typeof start !== 'number' ? null : after(p0, start + j, p).day);
    // In the model's own terms: weeks and days, or years and months (a part of a month stays a part).
    const inOwn = p === 'week' ? inPeriods(k, (n - k) * 7, p) : p === 'year' && whole((n - k) * 12) ? `${counted(k, 'year')} and ${counted(Math.round((n - k) * 12), 'month')}` : `${num(n)} ${p}s`;
    const min = length ? 1 : 0, c = Math.max(min, Math.round(n)), other = c > n ? c - 1 : c + 1;
    const to = (j: number) => { const day = at(j); return day === null ? '' : ` (to ${shown(day)})`; };
    return { kind: 'count', n: c, olumi: true, say: counted(c, p),
      basis: `Read as ${what} from your words${own || inOwn === what ? '' : `: ${inOwn}`}. The model counts whole ${p}s, so Olumi counts it as ${counted(c, p)}${to(c)} for now${other >= min ? `; confirm it, or say ${num(other)}${to(other)}` : '; confirm it, or say what to change'}.` };
  }
  if (p0 === null) return noStart(what, p);
  if (typeof start !== 'number') return notOpen(what, start.why);
  const from = after(p0, start, p).day;
  if ((t.unit === 'month' || t.unit === 'year') && !whole(months)) {
    return { kind: 'unsupported', olumi: true, say: what, basis: `Read as ${what} from your words, which is not a whole number of calendar months, so it cannot be counted in ${p}s exactly; a figure in ${p}s would be a change to your length of time.` };
  }
  const end = t.unit === 'month' || t.unit === 'year' ? after(from, Math.round(months), 'month') : { day: from + t.span * (t.unit === 'week' ? 7 : 1), clamped: false };
  const note = end.clamped ? ` Counted by calendar month: ${shown(from)} + ${counted(Math.round(months), 'month')} = ${shown(end.day)}.` : '';
  // Counted on the model's own grid from period 0: the periods from the opening to where the span ends.
  const m = measure(p0, end.day, p);
  const n = m.k - start;
  return m.whole
    ? { kind: 'count', n, olumi: true, basis: `Read as ${what} from your words: ${counted(n, p)} from ${shown(from)}${opens}.${note || clampNote(p0, m.k, p)}`, say: `${counted(n, p)} from ${shown(from)}` }
    : provisional(`Read as ${what} from your words: ${inPeriods(n, m.rest, p)} from ${shown(from)}${opens}.`, n, m.rest, p, (j) => after(p0, start + j, p).day, length ? 1 : 0, shown(from));
}

/**
 * The model with the stated time of each quantity in `only` (every quantity when omitted) counted from `periodZero`
 * (YYYY-MM-DD): the saved anchor, or null when the model's start date was never kept (never today on an update). A position
 * span counts from the day it was said (PL 13:40Z), its `said_on`: the drafter writes today's date for words said in this
 * message and keeps the saved day for a record returned unrestated; null is a day not known, on a first draft as on an
 * update, never today (PL 16:42Z). Every count keeps that day (PL 14:12Z).
 */
export function countStatedTime(model: CanonicalModelT, periodZero: string | null, only?: ReadonlySet<string>): CanonicalModelT {
  const mine = (q: CanonicalQuantityT) => q.stated_time !== null && (only === undefined || only.has(q.id));
  if (!model.quantities.some(mine)) return model;
  const p = model.period;
  const p0 = periodZero !== null && isCalendarDate(periodZero) ? dayOf(periodZero) : null;
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const done = new Map<string, CanonicalQuantityT>();
  const busy = new Set<string>();
  /** A window's opening in periods: 0 from now; else the offset's own figure when it is one known whole figure (PL C). */
  const openingOf = (use: Use & { role: 'length' }): number | { readonly why: string } => {
    if (use.offset === null) return use.start;
    const x = Q.get(use.offset);
    const at = x === undefined ? undefined : mine(x) && !busy.has(x.id) ? resolve(x) : x;
    if (at === undefined) return { why: 'is not in the model' };
    // As compile reads a timing: a figure in hand, in the model's period; low = high is one point, never a range.
    if (at.low !== null && at.high !== null && at.low !== at.high) return { why: `is "${at.label}", a range rather than one figure` };
    const v = at.value ?? at.low;
    if (!FIGURE_STATUSES.has(at.status) || at.unit !== p || v === null || !Number.isInteger(v) || v < 0) return { why: `is "${at.label}", which has no whole figure in ${p}s yet` };
    return v + use.start;
  };
  /**
   * A stated time on a quantity the model uses in no timing slot (a duration in arithmetic, a deadline used as a bound): counted
   * in that quantity's own unit (week, month or year) where that is exact; otherwise their figure as written if they gave one,
   * else unsupported with its reason. Never left "known" with no figure (29 Oct benchmark: 6 of 18 drafts failed to compile).
   */
  const freeOf = (q: CanonicalQuantityT, t: Stated, saidOn: string | null, blank: CanonicalQuantityT): CanonicalQuantityT => {
    // A span in the quantity's own unit, or one fixed conversion away (days and weeks, months and years), is that figure exactly:
    // a duration in arithmetic is any amount, never a whole-period count (review 29 Oct: 1.5 weeks idle, 0 weeks).
    const per: Readonly<Record<string, number>> = { day: 1, week: 7, month: 1, year: 12 };
    const family = (u: string | null) => (u === 'day' || u === 'week' ? 'days' : u === 'month' || u === 'year' ? 'months' : null);
    if (t.date === null && t.span !== null && t.span >= 0 && t.unit !== null && family(t.unit) !== null && family(t.unit) === family(q.unit)) {
      const v = (t.span * per[t.unit]!) / per[q.unit!]!;
      return t.unit === q.unit ? { ...blank, value: v, status: 'known', question: null, basis: keptBasis(q) }
        : { ...blank, value: v, status: 'known', question: null, author: 'olumi', basis: `Read as ${counted(t.span, t.unit)} from your words: ${counted(v, q.unit!)}.` };
    }
    const own = q.unit === 'week' || q.unit === 'month' || q.unit === 'year' ? q.unit : null;
    const r = own === null ? null : readUse(t, t.date !== null ? { role: 'position' } : { role: 'length', offset: null, start: 0 }, own, p0, saidOn, 0);
    if (r?.kind === 'count') return { ...blank, value: r.n, status: 'known', question: null, author: r.olumi ? 'olumi' : q.author, basis: r.olumi ? r.basis : keptBasis(q) };
    // Their figure or range as written, where they gave one and it cannot be counted.
    if (q.value !== null || (q.low !== null && q.high !== null)) return { ...q, stated_time: null };
    if (r?.kind === 'ask') return { ...blank, status: 'asked', question: r.question, basis: null };
    if (r?.kind === 'unsupported') return { ...blank, status: 'unsupported', question: null, author: r.olumi ? 'olumi' : q.author, basis: r.basis };
    return { ...blank, status: 'unsupported', question: null,
      basis: `"${q.label}" is in ${q.unit === null ? 'no unit' : `"${q.unit}"`}, so the date or length of time read from your words cannot be counted in it.` };
  };
  const resolve = (q: CanonicalQuantityT): CanonicalQuantityT => {
    const was = done.get(q.id);
    if (was !== undefined) return was;
    busy.add(q.id);
    const t = q.stated_time!;
    // Nothing stated (no date, no span) is nothing to read; a quantity used in no timing slot is never read (both cleared).
    const uses = t.date === null && t.span === null ? [] : usesOf(model, q.id);
    // The day it was said: its own said_on, as the drafter wrote it; a null is a day not known, never today (PL 15:19Z, 16:42Z).
    const saidOn = t.said_on;
    const readings = uses.map((u) => readUse(t, u, p, p0, saidOn, u.role === 'length' ? openingOf(u) : 0));
    busy.delete(q.id);
    // Its own unit and bounds are never reinterpreted: a counting quantity is in the model's period, or it is not counted.
    // Every count keeps the day it was said, so a later update counts from it, never from its own today (PL 14:12Z).
    const kept = { ...q, stated_time: { ...t, said_on: saidOn } };
    const blank = { ...kept, value: null, low: null, high: null, range_kind: null };
    const ask = readings.find((r): r is Reading & { kind: 'ask' } => r.kind === 'ask');
    const said = [...new Set(readings.map((r) => (r.kind === 'ask' ? '' : r.say)))];
    const first = readings[0];
    // Nothing stated and no figure: never "known" with nothing (review 29 Oct); with a figure, as written.
    const empty = q.value === null && !(q.low !== null && q.high !== null) && FIGURE_STATUSES.has(q.status)
      ? { ...q, stated_time: null, status: 'unsupported' as const, question: null, basis: `No figure, date or length of time was read for "${q.label}".` } : { ...q, stated_time: null };
    const out: CanonicalQuantityT = first === undefined ? (t.date === null && t.span === null ? empty : freeOf(q, t, saidOn, blank))
      : q.unit !== p ? { ...blank, status: 'unsupported', question: null,
        basis: `"${q.label}" counts the model's periods but is in ${q.unit === null ? 'no unit' : `"${q.unit}"`}: a counting quantity is in the model's period (${p}), so its stated time is not counted.` }
      : ask !== undefined ? { ...blank, status: 'asked', question: ask.question, basis: null }
      : said.length > 1 || first.kind === 'ask' ? { ...blank, status: 'asked', basis: null,
        question: `Read from your words as ${t.date !== null ? shown(dayOf(t.date)) : counted(t.span ?? 0, t.unit ?? p)}, this counts as ${said.length === 2 ? `${said[0]} in one place and ${said[1]} in another` : `${said.slice(0, -1).join(', ')} and ${said.at(-1)} in different places`}: which did you mean?` }
      : first.kind === 'count' ? { ...blank, value: first.n, status: 'known', question: null, author: first.olumi ? 'olumi' : q.author, basis: first.olumi ? first.basis : keptBasis(q) }
      : { ...blank, status: 'unsupported', question: null, author: first.olumi ? 'olumi' : q.author, basis: first.basis };
    done.set(q.id, out);
    return out;
  };
  return { ...model, quantities: model.quantities.map((q) => (mine(q) ? resolve(q) : q)) };
}
