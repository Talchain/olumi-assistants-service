/**
 * A STATED DATE BECOMES WHOLE PERIODS FROM TODAY, IN CODE (DL 24 Oct; DoD-G marketing r2–r5: with no code for it, the AI did
 * the calendar arithmetic itself and the runs disagreed: two moved period 0 to the planning date, one marked the timing
 * unsupported, one asked for it). The AI records the person's date words on the quantity (`stated_date`); this module turns
 * them into the quantity's figure: the whole periods from TODAY to that date, in the model's period unit, to the nearest whole
 * period. The figure is Olumi's labelled reading (author olumi, known, its basis giving the exact date and today), the one
 * shape `compile.ts` admits for a date reading.
 *
 * Only a timing counted from now is read so (a window's origin, a setting's or risk's start, the length of a window that opens
 * now): period 0 is now, and a window that counts from an event keeps its length as written. The reading never touches a
 * change goal's reference: "now" stays the level at period 0, whatever window the date places (AIE).
 *
 * Fixed when the model is written: a date the change did not alter keeps its saved reading (`saved`), so a reopen or a later
 * update never moves it as the days pass. A date the calendar cannot place is asked, never guessed.
 */
import type { CanonicalModelT, CanonicalQuantityT } from '../model-program/canonical.js';
import { readCalendarDay, readStatedDeadline, sayDate, timeBetween } from '../goal-target/deadline-date.js';

type Period = CanonicalModelT['period'];

/** The date the words state, YYYY-MM-DD: a deadline phrase (`readStatedDeadline`), or one whole calendar day with its year, passed or not. */
export function readStatedDate(words: string, today: string): string | null {
  const placed = readStatedDeadline(words, today);
  if (placed !== null) return placed.date;
  const plain = words.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/[.!?;:]+$/, '');
  return /\b\d{4}\b/.test(plain) ? readCalendarDay(plain, today) : null;
}

/** Whole periods from `today` to `date`, to the nearest whole period (a half rounds up). */
export function periodsFromToday(today: string, date: string, period: Period): number {
  const raw = period === 'week' ? timeBetween(today, date, 'weeks') : period === 'month' ? timeBetween(today, date, 'months') : timeBetween(today, date, 'months') / 12;
  return Math.round(raw) + 0;
}

/**
 * Each quantity that holds a timing counted from now, with the least figure it may take (a window's length is at least one
 * period). A quantity that is also the length of a window counted from an event is not one: its count does not run from today.
 */
function fromNowTimings(model: CanonicalModelT): Map<string, number> {
  const least = new Map<string, number>();
  const other = new Set<string>();
  const at = (id: string, min: number) => least.set(id, Math.max(min, least.get(id) ?? 0));
  for (const w of [...model.goals, ...model.limits].map((r) => r.measure?.window ?? null)) {
    if (w === null) continue;
    if (w.origin_offset !== null) at(w.origin_offset, 0);
    if (w.origin_offset === null && w.start === 0) at(w.periods, 1); else other.add(w.periods);
  }
  for (const t of [...model.options.flatMap((o) => o.sets.map((s) => s.starts_after_periods)), ...model.risks.map((r) => r.starts_after_periods)]) if (typeof t === 'string') at(t, 0);
  for (const id of other) least.delete(id);
  return least;
}

const plural = (n: number, period: Period) => `${n} ${period}${n === 1 ? '' : 's'}`;

/** One quantity's date words read against today: Olumi's reading, or why there is none. */
function readOne(q: CanonicalQuantityT, words: string, today: string, period: Period, min: number): CanonicalQuantityT {
  const none = { kind: 'fact' as const, value: null, low: null, high: null, range_kind: null, party: null, quote: null };
  const date = readStatedDate(words, today);
  if (date === null) {
    return { ...q, ...none, status: 'asked', author: 'person', basis: null,
      question: q.question !== null && q.question.trim() !== '' ? q.question : `Which date do you mean by "${words}"? Give a day, month and year.` };
  }
  const n = periodsFromToday(today, date, period);
  if (n < min) {
    return { ...q, ...none, status: 'unsupported', author: 'olumi', question: null,
      basis: `${sayDate(date)} is ${n < 0 ? 'before today' : `less than one whole ${period} from today`}, ${sayDate(today)}, so the model cannot count it in whole ${period}s from now.` };
  }
  return { ...q, ...none, status: 'known', author: 'olumi', value: n, question: null,
    basis: `Olumi's reading of the date: ${sayDate(date)} is ${plural(n, period)} from today, ${sayDate(today)}, to the nearest whole ${period}.` };
}

/** What a date reading sets on its quantity: the figure, what it is and whose, and why. */
const READING_FIELDS = ['kind', 'status', 'author', 'value', 'low', 'high', 'range_kind', 'question', 'basis', 'party', 'quote'] as const;

/**
 * The model with every stated date on a timing counted from now read as whole periods from `today` (YYYY-MM-DD). `saved`: the
 * model this one changes, whose readings stand for every date the change did not alter (same words, unit and time step).
 */
export function withStatedDates(model: CanonicalModelT, today: string, saved?: CanonicalModelT): CanonicalModelT {
  const timings = fromNowTimings(model);
  const was = new Map((saved?.quantities ?? []).map((q) => [q.id, q] as const));
  const quantities = model.quantities.map((q) => {
    const words = q.stated_date?.trim() ?? '';
    const min = timings.get(q.id);
    if (words === '' || min === undefined) return q;
    const kept = was.get(q.id);
    if (kept !== undefined && kept.stated_date === q.stated_date && kept.unit === q.unit && saved!.period === model.period) {
      return { ...q, ...Object.fromEntries(READING_FIELDS.map((k) => [k, kept[k]])) } as CanonicalQuantityT;
    }
    return readOne(q, words, today, model.period, min);
  });
  return quantities.some((x, i) => x !== model.quantities[i]) ? { ...model, quantities } : model;
}
