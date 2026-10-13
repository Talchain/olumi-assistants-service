/**
 * ⭐ S-E GOALS — THE ONE DEADLINE CALENDAR (lane GOALS, DL 0fd71f, 7 Oct; Paul's prod test item 6, forensics D-01/D-06).
 *
 * A deadline the user states in their own words ("a deadline in 6 months", "by Q2", "end of March", "by 7 April 2027")
 * becomes a CALENDAR DATE here, and the time from today to that date in the goal's own time unit. Deterministic, pure,
 * in CEE: the language model never does date arithmetic (it would invent a year, or count months wrongly), and no clock
 * is read inside this module (the caller passes today, so every row is reproducible).
 *
 * Read only from a SHORT phrase the Agent quotes from the user's turn (`deadline_words`, ≤ 80 characters): the Agent
 * decides WHICH phrase is the deadline ("recruitment will take more than 3 months" is a duration, not one); this module
 * decides only WHEN that phrase falls. A phrase it cannot place returns `null`, never a guess.
 *
 * Calendar rules (UTC calendar dates, so no time zone can move a day):
 *  · "N months" from today keeps the day of the month, clamped to the month's last day (31 Aug + 6 months = 28/29 Feb,
 *    never 3 March as `Date.setMonth` overflows);
 *  · "N weeks" / "N days" add 7N / N days;
 *  · "Qn [yyyy]" is the last day of that CALENDAR quarter; a fiscal quarter needs the user's fiscal calendar, so it is
 *    never assumed: a quarter that has passed this year without a year means next year's;
 *  · "before …", "until …" and "till …" are never placed: whether the boundary day itself counts changes the date, so
 *    the user is asked;
 *  · "[end of] <Month> [yyyy]" (also "by" / "in <Month>") is that month's last day, the latest the words allow (the card
 *    shows the date, and [Change date] corrects another reading); "<day> <Month> [yyyy]" / "<Month> <day>[,] [yyyy]" that day; a
 *    date without a year that has passed means next year's;
 *  · "end of (the) year" / "year-end" is 31 December;
 *  · ⭐ RECOVERY BATCH B (B1, Paul's marketing test, 11 Oct): "N months/weeks/days [to <what>] from <day>" counts from a
 *    STATED day, not from today ("six months from 9 October", "6 months to launch our new features from last Friday").
 *    The day is a calendar date (day and month, optionally the year) or "last <weekday>". A start day without a year is
 *    the reference year's: it is NEVER rolled into next year (a start day in the past is normal), so a count that then
 *    ends on or before today is not placed (`null`, the user is asked). "last <weekday>" is the user's own dating of it
 *    ("Last Friday was the 9th of October", `readStatedWeekdayDate`, accepted only when that date IS that weekday).
 *    Otherwise `null`: the host must never select the date of a relative weekday (DL ruling A2g).
 *  · a date that is today or has passed is not a deadline: `null`.
 */

export type DeadlineForm = 'months_from_today' | 'weeks_from_today' | 'days_from_today' | 'months_from_date' | 'weeks_from_date' | 'days_from_date'
  | 'quarter_end' | 'month_end' | 'date' | 'year_end';

export interface StatedDeadline {
  /** The phrase as given (trimmed), for the card and the record. */
  readonly words: string;
  readonly form: DeadlineForm;
  /** The deadline, a calendar date: YYYY-MM-DD (the `goal_horizon.deadline` contract shape). */
  readonly date: string;
  /** Today, the reference the count runs from: YYYY-MM-DD. */
  readonly reference: string;
  /** The count the user stated, when they stated one ("6 months" → 6, unit months). Never derived from a date. */
  readonly stated_count?: { readonly value: number; readonly unit: 'months' | 'weeks' | 'days' };
  /**
   * Batch B: a count from a STATED day ("six months from 9 October"): that day and the count, for the card ("6 months from
   * 9 October 2026"). Never `stated_count`, which counts from the reference: the horizon is still measured from the
   * reference day, so a count from another day is not its length.
   */
  readonly anchor?: { readonly date: string; readonly count: { readonly value: number; readonly unit: 'months' | 'weeks' | 'days' } };
}

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** How a phrase is read beyond its words (Batch B). */
export interface DeadlineReadOptions {
  /** The user's own dating of "last <weekday>" (`readStatedWeekdayDate` over their message): used instead of counting back. */
  readonly lastWeekday?: { readonly weekday: Weekday; readonly date: string };
  /** Legacy caller option, retained for compatibility. The host never selects relative weekdays, regardless of this flag. */
  readonly relativeWeekdays?: boolean;
  /**
   * EBD E3: `true` keeps the closed lead-word list as the only words a phrase may open with (the brief's own date-span
   * scan and the drafter's stated-deadline card, which read text no one quoted as the deadline). Default `false`: the
   * phrase is the user's own bound quote, and the date expression it ends with is found inside it.
   */
  readonly leadWordsOnly?: boolean;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;
const MONTH_NAMES_UK = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTH_ALIASES: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  ...Object.fromEntries(MONTHS.map((m, i) => [m, i])),
};
const MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, eighteen: 18, 'twenty-four': 24, 'twenty four': 24,
};
const COUNT_RE = '(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty[- ]four)';

/**
 * Lead words a deadline phrase may open with ("we have a hard deadline in", "by the", "no later than"): stripped ONE
 * token at a time (at most 10), each a whole word, and every form is tried before each strip, so "a month" is read as a
 * count before its article is taken off.
 */
const LEAD_TOKEN = /^(?:we[ \t]{1,4}have|we've[ \t]{1,4}got|there[ \t]{1,4}is|there's|a|an|the|our|hard|firm|fixed|deadline|launch[ \t]{1,4}date|due[ \t]{1,4}date|is|of|at|by|before|until|till|within|in|no[ \t]{1,4}later[ \t]{1,4}than)(?:[ \t]{1,4}|$)/;

/**
 * ⭐ EBD E3 (Paul's hiring test, 12 Oct, scenario 4184e877: "…our launch deadline in six months time" was refused twice,
 * because "launch" is not a lead word). The span the Agent quotes is the user's own words, bound to their message by the
 * door; the date expression is found INSIDE it, as the phrase it ends with. Any word may come before it, except one that
 * makes its count something other than the deadline — a duration, a delay or a hiring time ("recruitment will take more
 * than 3 months", "miss it by over a month", "3 months ago"): then nothing is placed and the user is asked.
 */
const NOT_A_DEADLINE_WORD = /^(?:take|takes|took|taking|last|lasts|lasted|lasting|hire|hires|hiring|hired|recruit|recruits|recruiting|recruited|recruitment|onboard|onboards|onboarding|notice|ago|since|for|over|late|later|early|earlier|behind|delay|delays|delayed|slip|slips|slipped|slipping|miss|misses|missed|missing|spent|been)$/;
/** One whole word of a phrase and the space after it. */
const PHRASE_WORD = /^[^ \t]{1,80}[ \t]*/;

/** The forms a deadline phrase may take, anchored and bounded (no nested repeats); one canonical body each. */
const COUNT_FORM = new RegExp(`^${COUNT_RE}[ \\t-]{1,2}(months?|weeks?|days?)(?:'?s?[ \\t]{1,2}time|[ \\t]{1,2}from[ \\t]{1,2}(?:now|today)|[ \\t]{1,2}(?:deadline|away|out))?$`);
/**
 * Batch B: "<count> <unit> [to <at most 6 words>] from <day>" — a count from a stated day; the day is read by `readStartDay`.
 * Anchored, with ONE bounded nested repeat (the words between: letters only, at most six, each at most 20), timed with the
 * rest in `DEADLINE_PATTERNS_FOR_TIMING`.
 */
const FROM_DAY_FORM = new RegExp(`^${COUNT_RE}[ \\t-]{1,2}(months?|weeks?|days?)(?:[ \\t]{1,2}to(?:[ \\t]{1,2}[a-z']{1,20}){1,6})?[ \\t]{1,2}from[ \\t]{1,2}([a-z0-9][a-z0-9 ,\\t-]{0,40})$`);
const WEEKDAY_RE = `(${WEEKDAYS.join('|')})`;
const LAST_WEEKDAY_FORM = new RegExp(`^last[ \\t]{1,2}${WEEKDAY_RE}$`);
/** "last friday" anywhere in a phrase. */
const LAST_WEEKDAY_NAMED = new RegExp(`(?:^|[^a-z])last[ \\t]{1,4}${WEEKDAY_RE}(?![a-z])`);
/** "last friday was …" / "last friday is …" anywhere in a message (the date after it is read by `readCalendarDay`). */
const WEEKDAY_DATED = new RegExp(`(?:^|[^a-z])last[ \\t]{1,4}${WEEKDAY_RE}[ \\t]{1,4}(?:was|is)[ \\t]{1,4}`);
const QUARTER_FORM = /^(?:end[ \t]{1,2}of[ \t]{1,2}(?:the[ \t]{1,2})?)?q([1-4])(?:[ \t]{1,2}(\d{4}))?$/;
const YEAR_END_FORM = /^(?:end[ \t]{1,2}of[ \t]{1,2}(?:the[ \t]{1,2}|this[ \t]{1,2})?year|year[ \t-]?end|end[ \t]{1,2}of[ \t]{1,2}(\d{4}))$/;
const MONTH_END_FORM = new RegExp(`^(?:end[ \\t]{1,2}of[ \\t]{1,2})?${MONTH_RE}(?:[ \\t]{1,2}(\\d{4}))?$`);
const DAY_MONTH_FORM = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?:[ \\t]{1,2}of)?[ \\t]{1,2}${MONTH_RE}(?:[ \\t]{1,2}(\\d{4}))?$`);
const MONTH_DAY_FORM = new RegExp(`^${MONTH_RE}[ \\t]{1,2}(\\d{1,2})(?:st|nd|rd|th)?(?:,?[ \\t]{1,2}(\\d{4}))?$`);
const ISO_FORM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Every pattern this module runs, for the 5k → 20k timing rows only (the public reader gates input at 80 characters). */
export const DEADLINE_PATTERNS_FOR_TIMING: readonly RegExp[] = [LEAD_TOKEN, COUNT_FORM, FROM_DAY_FORM, LAST_WEEKDAY_FORM, LAST_WEEKDAY_NAMED, WEEKDAY_DATED, QUARTER_FORM, YEAR_END_FORM, MONTH_END_FORM, DAY_MONTH_FORM, MONTH_DAY_FORM, ISO_FORM, NOT_A_DEADLINE_WORD, PHRASE_WORD];

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m0: number, d: number): string => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const lastDay = (y: number, m0: number): number => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const isoOf = (d: Date): string => iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Today's calendar date in Europe/London as YYYY-MM-DD (Science ruling §3: "the turn's date, displayed in Europe/London"):
 * at 00:30 BST on 7 April the user's today is 7 April, though UTC still says 6 April.
 */
export function todayInLondon(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const out = `${part('year')}-${part('month')}-${part('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : isoOf(now);
}

/** Add whole calendar months, clamping the day to the target month's last day. */
export function addMonths(fromIso: string, months: number): string {
  const [y, m, d] = fromIso.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  return iso(ty, tm, Math.min(d, lastDay(ty, tm)));
}

function addDays(fromIso: string, days: number): string {
  const [y, m, d] = fromIso.split('-').map(Number) as [number, number, number];
  return isoOf(new Date(Date.UTC(y, m - 1, d + days)));
}

/** 0 = Monday … 6 = Sunday, of a YYYY-MM-DD calendar date. */
const weekdayIndexOf = (isoDate: string): number => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

/**
 * A calendar day written as a day and a month (optionally the year): "9 October", "the 9th of October", "October 9, 2026",
 * "2026-10-09". Without a year it is the year of `today` — NEVER rolled into another year (Batch B: a start day may well
 * have passed). `null` for anything else, or a day that month does not have.
 */
function readCalendarDay(raw: string, today: string): string | null {
  const t = raw.trim().replace(/,$/, '').replace(/^the[ \t]{1,2}/, '');
  const dayMonth = DAY_MONTH_FORM.exec(t);
  const monthDay = dayMonth === null ? MONTH_DAY_FORM.exec(t) : null;
  const isoDate = dayMonth === null && monthDay === null ? ISO_FORM.exec(t) : null;
  const parts = dayMonth !== null ? { d: Number(dayMonth[1]), m0: MONTH_ALIASES[dayMonth[2]!]!, y: dayMonth[3] }
    : monthDay !== null ? { d: Number(monthDay[2]), m0: MONTH_ALIASES[monthDay[1]!]!, y: monthDay[3] }
      : isoDate !== null ? { d: Number(isoDate[3]), m0: Number(isoDate[2]) - 1, y: isoDate[1] } : null;
  if (parts === null) return null;
  const y = parts.y !== undefined ? Number(parts.y) : Number(today.slice(0, 4));
  if (parts.m0 < 0 || parts.m0 > 11 || parts.d < 1 || parts.d > lastDay(y, parts.m0)) return null;
  return iso(y, parts.m0, parts.d);
}

/** The start day of a "from <day>" count; `null` when it cannot be read without guessing. */
function readStartDay(raw: string, today: string, opts: DeadlineReadOptions): string | null {
  const t = raw.trim().replace(/,$/, '').replace(/^the[ \t]{1,2}/, '');
  const last = LAST_WEEKDAY_FORM.exec(t);
  if (last !== null) {
    const weekday = last[1] as Weekday;
    if (opts.lastWeekday !== undefined && opts.lastWeekday.weekday === weekday) return opts.lastWeekday.date;
    // A reference day does not establish which occurrence the user meant. Only explicit dating
    // can resolve it here; an AI-proposed deadline is handled separately by the approval door.
    return null;
  }
  return readCalendarDay(t, today);
}

/**
 * ⭐ Batch B: the user's own dating of a relative weekday in their message — "Last Friday was the 9th of October." — read
 * against `today` for the year (never rolled), and accepted ONLY when that date IS that weekday (9 October 2026 is a
 * Friday). `null` otherwise: a date that is not that weekday is a slip to ask about, never a reading to choose.
 */
export function readStatedWeekdayDate(text: string, today: string): { readonly weekday: Weekday; readonly date: string } | null {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const plain = text.slice(0, 400).toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-');
  const m = WEEKDAY_DATED.exec(plain);
  if (m === null) return null;
  const rest = plain.slice(m.index + m[0].length);
  const stop = rest.search(/[.!?;\n]/);
  const day = readCalendarDay(stop < 0 ? rest : rest.slice(0, stop), today);
  const weekday = m[1] as Weekday;
  return day !== null && WEEKDAYS[weekdayIndexOf(day)] === weekday ? { weekday, date: day } : null;
}

/** The weekday a text names as "last <weekday>" (Batch B), or `null`. */
export function lastWeekdayNamedIn(text: string): Weekday | null {
  const m = LAST_WEEKDAY_NAMED.exec(String(text).slice(0, 400).toLowerCase());
  return m === null ? null : m[1] as Weekday;
}

/** The weekday a message DATES ("Last Friday was …"), date unchecked: the gate only; `readStatedWeekdayDate` reads the date. */
export function weekdayDatedIn(text: string): Weekday | null {
  const m = WEEKDAY_DATED.exec(String(text).slice(0, 400).toLowerCase());
  return m === null ? null : m[1] as Weekday;
}

const countOf = (raw: string): number | null => {
  const t = raw.trim().toLowerCase();
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
};

/** "7 April 2027": the British calendar date, day first, no ordinal and no comma. */
export function sayDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (m === null) return isoDate;
  return `${Number(m[3])} ${MONTH_NAMES_UK[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The time from `fromIso` to `toIso` in the goal's own time unit. Months: whole calendar months, plus the part-month left
 * as a fraction of the following month (6 from 7 Oct to 7 Apr exactly; 31 Mar from 7 Oct is 5 + 24/31). Rounded to two
 * decimals: a deadline is a calendar day, so finer is spurious precision. Weeks: days ÷ 7; days: days.
 */
export function timeBetween(fromIso: string, toIso: string, unit: 'months' | 'weeks' | 'days'): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
  if (unit === 'days') return days;
  if (unit === 'weeks') return Math.round((days / 7) * 100) / 100;
  let whole = (ty - fy) * 12 + (tm - fm);
  if (addMonths(fromIso, whole) > toIso) whole -= 1;
  const anchor = addMonths(fromIso, whole);
  const next = addMonths(fromIso, whole + 1);
  const span = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  const rest = Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  return Math.round((whole + (span > 0 ? rest / span : 0)) * 100) / 100;
}

/**
 * The deadline a short phrase states, on the calendar, from `today` (YYYY-MM-DD), or `null` when the phrase names no
 * date this module can place without guessing (a fiscal quarter, "soon", "next sprint", a date already passed).
 */
export function readStatedDeadline(phrase: string, today: string, opts: DeadlineReadOptions = {}): StatedDeadline | null {
  if (typeof phrase !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const words = phrase.trim();
  if (words === '' || words.length > 80) return null;
  // One canonical spelling: lower case, typographic apostrophes and dashes plain, runs of spaces single, end punctuation off.
  const plain = words.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[ \t]{2,}/g, ' ').replace(/[.!?,;:]+$/, '').trim();
  let body = plain;
  // 80 characters hold at most 40 words: every word can be tried as the start of the date expression.
  for (let i = 0; i <= 40 && body !== ''; i += 1) {
    const countBody = body.replace(/^(?:end of (?:the )?)?month (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)$/i, '$1 months');
    const placed = placeDeadline(countBody, words, today, opts);
    if (placed !== undefined) return placed;
    const lead = LEAD_TOKEN.exec(body);
    if (lead !== null) {
      // ⛔ Codex buddy r1 on #2742: "before March" is NOT the end of March, and "until March" may or may not include it. A
      // boundary word whose reading changes the date is never resolved here: the user is asked (`null`).
      if (/^(?:before|until|till)\b/.test(lead[0])) return null;
      body = body.slice(lead[0].length).trim();
      continue;
    }
    if (opts.leadWordsOnly === true) return null;
    // EBD E3: a word of the user's own sentence before the date expression ("launch", "it's"), stepped over whole.
    const word = PHRASE_WORD.exec(body);
    if (word === null || NOT_A_DEADLINE_WORD.test(word[0].trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))) return null;
    body = body.slice(word[0].length).trim();
  }
  return null;
}

/** One canonical body, every form; `undefined` when no form matches (the caller may strip a lead word and retry). */
function placeDeadline(body: string, words: string, today: string, opts: DeadlineReadOptions): StatedDeadline | null | undefined {
  const [ty] = today.split('-').map(Number) as [number];
  const result = (form: DeadlineForm, date: string, stated?: StatedDeadline['stated_count']): StatedDeadline | null =>
    date > today ? { words, form, date, reference: today, ...(stated !== undefined ? { stated_count: stated } : {}) } : null;

  // "6 months", "six-month deadline", "6 months from now", "6 months' time", "a month", "12 weeks", "30 days".
  const count = COUNT_FORM.exec(body);
  if (count !== null) {
    const n = countOf(count[1]!);
    if (n === null || n < 1 || n > 120) return null;
    const unit = count[2]!.startsWith('month') ? 'months' : count[2]!.startsWith('week') ? 'weeks' : 'days';
    if (unit === 'months') return result('months_from_today', addMonths(today, n), { value: n, unit });
    return result(unit === 'weeks' ? 'weeks_from_today' : 'days_from_today', addDays(today, unit === 'weeks' ? 7 * n : n), { value: n, unit });
  }
  // Batch B: "six months from 9 October", "6 months to launch our new features from last Friday".
  const fromDay = FROM_DAY_FORM.exec(body);
  if (fromDay !== null) {
    const n = countOf(fromDay[1]!);
    if (n === null || n < 1 || n > 120) return null;
    const unit = fromDay[2]!.startsWith('month') ? 'months' : fromDay[2]!.startsWith('week') ? 'weeks' : 'days';
    const startWords = fromDay[3]!.trim();
    if (startWords === 'now' || startWords === 'today') {
      const date = unit === 'months' ? addMonths(today, n) : addDays(today, unit === 'weeks' ? 7 * n : n);
      return result(unit === 'months' ? 'months_from_today' : unit === 'weeks' ? 'weeks_from_today' : 'days_from_today', date, { value: n, unit });
    }
    const start = readStartDay(startWords, today, opts);
    if (start === null) return null;
    const date = unit === 'months' ? addMonths(start, n) : addDays(start, unit === 'weeks' ? 7 * n : n);
    const form = unit === 'months' ? 'months_from_date' : unit === 'weeks' ? 'weeks_from_date' : 'days_from_date';
    return date > today ? { words, form, date, reference: today, anchor: { date: start, count: { value: n, unit } } } : null;
  }
  // "Q2", "Q2 2027", "end of Q2".
  const quarter = QUARTER_FORM.exec(body);
  if (quarter !== null) {
    const m0 = Number(quarter[1]) * 3 - 1;
    const explicit = quarter[2] !== undefined ? Number(quarter[2]) : undefined;
    let date = iso(explicit ?? ty, m0, lastDay(explicit ?? ty, m0));
    if (explicit === undefined && date <= today) date = iso(ty + 1, m0, lastDay(ty + 1, m0));
    return result('quarter_end', date);
  }
  // "end of the year", "year-end", "end of 2027".
  const yearEnd = YEAR_END_FORM.exec(body);
  if (yearEnd !== null) {
    const y = yearEnd[1] !== undefined ? Number(yearEnd[1]) : ty;
    return result('year_end', iso(y, 11, 31));
  }
  // "end of March", "March", "March 2027", "end of March 2027".
  const monthEnd = MONTH_END_FORM.exec(body);
  if (monthEnd !== null) {
    const m0 = MONTH_ALIASES[monthEnd[1]!]!;
    const explicit = monthEnd[2] !== undefined ? Number(monthEnd[2]) : undefined;
    let date = iso(explicit ?? ty, m0, lastDay(explicit ?? ty, m0));
    if (explicit === undefined && date <= today) date = iso(ty + 1, m0, lastDay(ty + 1, m0));
    return result('month_end', date);
  }
  // "7 April 2027", "7th April", "April 7, 2027", "2027-04-07".
  const dayMonth = DAY_MONTH_FORM.exec(body);
  const monthDay = MONTH_DAY_FORM.exec(body);
  const isoDate = ISO_FORM.exec(body);
  const parts = dayMonth !== null ? { d: Number(dayMonth[1]), m0: MONTH_ALIASES[dayMonth[2]!]!, y: dayMonth[3] }
    : monthDay !== null ? { d: Number(monthDay[2]), m0: MONTH_ALIASES[monthDay[1]!]!, y: monthDay[3] }
      : isoDate !== null ? { d: Number(isoDate[3]), m0: Number(isoDate[2]) - 1, y: isoDate[1] } : null;
  if (parts !== null) {
    const explicit = parts.y !== undefined ? Number(parts.y) : undefined;
    const y = explicit ?? ty;
    if (parts.m0 < 0 || parts.m0 > 11 || parts.d < 1 || parts.d > lastDay(y, parts.m0)) return null;
    let date = iso(y, parts.m0, parts.d);
    if (explicit === undefined && date <= today) {
      if (parts.d > lastDay(ty + 1, parts.m0)) return null;
      date = iso(ty + 1, parts.m0, parts.d);
    }
    return result('date', date);
  }
  return undefined;
}

/** "6 months from today" / "12 weeks from today" for a stated count; for a date, the time from today in `unit`. */
export function sayTimeFromToday(d: StatedDeadline, unit: 'months' | 'weeks' | 'days'): string {
  // Batch B: a count from a stated day says that day ("6 months from 9 October 2026"), never "from today".
  if (d.anchor !== undefined && d.anchor.count.unit === unit) {
    const c = d.anchor.count.value;
    return `${c} ${c === 1 ? unit.slice(0, -1) : unit} from ${sayDate(d.anchor.date)}`;
  }
  const n = d.stated_count !== undefined && d.stated_count.unit === unit ? d.stated_count.value : timeBetween(d.reference, d.date, unit);
  const one = unit.slice(0, -1);
  const about = d.stated_count !== undefined && d.stated_count.unit === unit ? '' : Number.isInteger(n) ? '' : 'about ';
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${about}${shown} ${n === 1 ? one : unit} from today`;
}

/** The card's "(6 months from today)": in the unit the user counted in, else months; a count from a stated day, from that day. */
export function sayDeadlineFromToday(d: StatedDeadline): string {
  return sayTimeFromToday(d, d.anchor?.count.unit ?? d.stated_count?.unit ?? 'months');
}
