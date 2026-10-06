/**
 * ⭐ THE ONE UNIT VOCABULARY (Science U-GRAMMAR G0/G1, #87 5999605004; PR-U1). Spellings only: a period noun, a period
 * adverb, a connector, `%` and `pp`. Nothing here converts a period (no ×12, ×52) or touches a value: scale belongs to
 * the NUMBER (`readUnit().multiplier`), never to the unit.
 *
 * ⚠ A LEAF ON PURPOSE. same-unit → stated-amounts → evaluate-factor-value-proposal would cycle if this table lived in
 * `same-unit.ts`, which is the move already made for `currency-alphabet.ts` and `magnitude-alphabet.ts`. It imports
 * nothing. Every other period or %/pp list in `src/` is a known copy named in `__tests__/unit-alphabet.union.test.ts`,
 * and a NEW one REDs there.
 */

export type UnitPeriod = "second" | "minute" | "hour" | "day" | "week" | "fortnight" | "month" | "quarter" | "year";

/**
 * A period NOUN. On its own it is a duration ("18 months" counts months); it is the unit's PERIOD only after a
 * connector ("a month", "per year", "/week") — `readUnitParts` in `same-unit.ts` applies that rule.
 */
export const PERIOD_NOUN_SPELLINGS: Readonly<Record<UnitPeriod, readonly string[]>> = {
  second: ["second", "seconds"],
  minute: ["minute", "minutes", "mins"],
  hour: ["hour", "hours", "hr", "hrs"],
  day: ["day", "days"],
  week: ["week", "weeks", "wk", "wks"],
  fortnight: ["fortnight", "fortnights"],
  month: ["month", "months", "mo"],
  quarter: ["quarter", "quarters", "qtr"],
  year: ["year", "years", "yr", "yrs", "annum"],
};

/** A period ADVERB or metric word: the period with no connector ("£50k annually", "Monthly spend", "MRR"). */
export const PERIOD_ADVERB_SPELLINGS: Readonly<Record<UnitPeriod, readonly string[]>> = {
  second: [],
  minute: [],
  hour: ["hourly"],
  day: ["daily"],
  week: ["weekly"],
  fortnight: ["fortnightly"],
  month: ["monthly", "pcm", "mrr"],
  quarter: ["quarterly"],
  year: ["yearly", "annual", "annually", "pa", "p.a.", "arr"],
};

/** What makes a following period noun the unit's period: "a month", "per year", "each day", "/week". */
export const PERIOD_CONNECTORS: readonly string[] = ["per", "a", "an", "each", "every", "/"];

/** `%` — a share. Whole words and exact: "percentile" is not a percent. */
export const PERCENT_SPELLINGS: readonly string[] = ["%", "percent", "per cent", "pct", "percentage"];

/** Percentage POINTS — a difference of two shares, never a percent of one. "3%" is not "3 pp". */
export const POINTS_SPELLINGS: readonly string[] = [
  "pp", "ppt", "pps", "percentage point", "percentage points", "percent point", "percent points", "% point", "% points",
];

/** The one points spelling a stored RT-6 link change is written in (the card's words and the writer's unit). */
export const POINTS_UNIT = "percentage points";

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

const NOUN = new Map<string, UnitPeriod>();
const ADVERB = new Map<string, UnitPeriod>();
for (const [period, forms] of Object.entries(PERIOD_NOUN_SPELLINGS) as [UnitPeriod, readonly string[]][]) {
  for (const f of forms) NOUN.set(f, period);
}
for (const [period, forms] of Object.entries(PERIOD_ADVERB_SPELLINGS) as [UnitPeriod, readonly string[]][]) {
  for (const f of forms) ADVERB.set(f, period);
}
const CONNECTOR = new Set(PERIOD_CONNECTORS);
const PERCENT = new Set(PERCENT_SPELLINGS.map(norm));
const POINTS = new Set(POINTS_SPELLINGS.map(norm));

/** The period a NOUN spelling names ("months" → month), or null. A noun alone is a duration; see the note above. */
export function periodNoun(word: string): UnitPeriod | null {
  return NOUN.get(norm(word)) ?? null;
}

/** The period an ADVERB or metric spelling names ("annually" → year, "MRR" → month), or null. */
export function periodAdverb(word: string): UnitPeriod | null {
  return ADVERB.get(norm(word)) ?? null;
}

/** Whether a word makes a following period noun the period ("per", "a", "/"…). */
export function isPeriodConnector(word: string): boolean {
  return CONNECTOR.has(norm(word));
}

/** A WHOLE unit phrase that is exactly a percent or a points spelling; anything else (incl. "percentile") is null. */
export function shareKind(unit: string): "percent" | "points" | null {
  const u = norm(unit);
  if (PERCENT.has(u)) return "percent";
  if (POINTS.has(u)) return "points";
  return null;
}

/** Every spelling this leaf owns, for the union guard: nouns, adverbs, %, pp. */
export function allUnitSpellings(): readonly string[] {
  return [...NOUN.keys(), ...ADVERB.keys(), ...PERCENT, ...POINTS];
}
