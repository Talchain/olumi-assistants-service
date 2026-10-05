/**
 * How Olumi reads a unit's words (money in one currency and period, a count, or plain words), and when two units name
 * the same quantity (`sameUnit`). Moved verbatim out of `reconciling-product.ts` so a pure reader (`placeholder-parts.ts`:
 * the ONE Olumi-guess test DR row 4 and B6 share) can use `sameUnit` without importing admission (its import chain
 * reaches `placeholder-parts.ts` itself). `reconciling-product.ts` re-exports what it exported before.
 */
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

/** U-CANON v1: spelling equivalence only. The table never changes a value or scale. */
export const UNIT_CANON = [
  ['%', ['%', 'percent', 'per cent', 'pct']],
  ['pp', ['percentage point', 'percentage points', 'pp']],
  ['GBP', ['£', 'GBP', 'pound', 'pounds', 'sterling']],
  ['USD', ['$', 'USD', 'dollar', 'dollars']],
  ['EUR', ['€', 'EUR', 'euro', 'euros']],
  ['day', ['day', 'days']], ['/day', ['daily']],
  ['week', ['week', 'weeks']], ['/week', ['weekly']],
  ['month', ['month', 'months', 'mo']], ['/month', ['monthly', 'pcm', 'mrr']],
  ['quarter', ['quarter', 'quarters']], ['/quarter', ['quarterly']],
  ['year', ['year', 'years', 'yr', 'annum']], ['/year', ['yearly', 'annual', 'annually', 'per annum', 'pa', 'arr']],
  ['hour', ['hour', 'hours', 'hr', 'hrs']], ['minute', ['minute', 'minutes', 'min', 'mins']],
] as const;
export type UnitPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
type Period = UnitPeriod | null;
const aliases = UNIT_CANON.flatMap(([canonical, forms]) => forms.map(form => ({canonical, form})))
  .sort((a,b) => b.form.length - a.form.length);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasPattern = new RegExp(`(?<![\\w])(?:${aliases.map(a=>escape(a.form)).join('|')})(?![\\w])`, 'gi');
/** Only unit text is normalised; quote literals and numbers are never rewritten. */
export function canonicalUnitSpelling(unit: string): string {
  return unit.replace(aliasPattern, form => aliases.find(a=>a.form.toLowerCase()===form.toLowerCase())!.canonical)
    .replace(/\b(?:per|a|an|each|every)\s+(day|week|month|quarter|year)\b/gi, '/$1')
    .replace(/\s*\/\s*/g, '/');
}
const unitWords = (s: string): string[] => words(canonicalUnitSpelling(s));
const PERIODS = new Set<string>(['day', 'week', 'month', 'quarter', 'year']);
export const words = (s: string): string[] => s.toLowerCase().replace(/[()]/g, ' ').replace(/\//g, ' / ').split(/[\s-]+/).filter((w) => w !== '');
export const singular = (w: string): string => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function periodOf(ws: readonly string[]): Period | 'both' {
  const ps = new Set(ws.filter(w => PERIODS.has(w)));
  return ps.size > 1 ? 'both' : ps.size === 1 ? [...ps][0] as UnitPeriod : null;
}

/** The one period named by the table, with no calendar conversion. */
export function periodIn(text: string): Period {
  const p = periodOf(unitWords(text));
  return p === 'both' ? null : p;
}
const isPeriod = (w: string): boolean => PERIODS.has(w);
const isCurrency = (w: string): boolean => readCurrencyUnitWithQualifiers(w).kind === 'currency';
/** The words `readCurrencyUnitWithQualifiers` lets stand beside the currency itself ("GBP recurring revenue", "£ a month"). */
const MONEY_WORDS = new Set(['revenue', 'recurring', 'a']);

/**
 * Money in ONE unscaled currency, its period, and its ONE per-unit denominator ("£/subscriber/month" → [subscriber]).
 *
 * ⛔ PR Review on 9fdc3f96: every "/" or "per" opens a segment, and each segment after the money must be a period or THE
 * denominator. A second denominator ("GBP per subscriber per seat per month") makes price × subscribers money per seat
 * per month, not the goal's money per month. So it is refused, as is a segment that mixes a period into a denominator.
 */
export function readMoney(unit: unknown, label: string): { code: string; period: Period; per: string[] | null; mixed?: true } | null {
  if (typeof unit !== 'string') return null;
  const ws = unitWords(unit);
  const currencies = ws.filter(isCurrency);
  const r = readCurrencyUnitWithQualifiers(currencies.length === 1 ? currencies[0] : undefined);
  if (r.kind !== 'currency' || r.currencyCode === undefined || (r.multiplier ?? 1) !== 1) return null;
  const segments: string[][] = [[]];
  for (const w of ws) {
    if (w === '/' || w === 'per') segments.push([]);
    else segments[segments.length - 1]!.push(w);
  }
  if (segments.some((s) => s.length === 0) || !segments[0]!.every((w) => isCurrency(w) || isPeriod(w) || MONEY_WORDS.has(w))) return null;
  // ⛔ AIQ 5891385320 (3): "per subscriber-month" names the count's noun with the period joined on. It composes (£ per
  // subscriber-month × subscribers IS £/month); the parser just never finished it, so it read as "don't compose" and got
  // neither a card nor the withhold. Read as the denominator plus its period, marked `mixed`: never a silent mint, the card.
  let mixed = false;
  for (const seg of segments.slice(1)) {
    if (seg.length >= 2 && isPeriod(seg[seg.length - 1]!) && !seg.slice(0, -1).some(isPeriod)) { mixed = true; }
  }
  if (mixed) {
    const parts = segments.slice(1);
    if (parts.length !== 1 || ws.filter(isPeriod).length !== 1) return null;
    const seg = parts[0]!;
    const nouns = seg.slice(0, -1);
    if (!nouns.every((w) => /^[a-z]+$/.test(w) && !isCurrency(w) && !MONEY_WORDS.has(w))) return null;
    const period = periodOf([seg[seg.length - 1]!]);
    if (period === 'both' || period === null) return null;
    return { code: r.currencyCode, period, per: nouns.map(singular), mixed: true };
  }
  const denominators = segments.slice(1).filter((s) => !s.every(isPeriod));
  if (denominators.length > 1) return null;
  if (denominators.some((s) => !s.every((w) => /^[a-z]+$/.test(w) && !isPeriod(w) && !isCurrency(w) && !MONEY_WORDS.has(w)))) return null;
  // ⛔ PR Review on 98be677f: ONE period at most. "GBP per subscriber per month per month" is money per month², and
  // "GBP monthly per subscriber per month" says the period twice; neither composes to money per month.
  if (ws.filter(isPeriod).length > 1) return null;
  // The goal's own name can carry its period ("MRR", "Monthly recurring revenue") when its unit does not.
  const own = periodOf(ws);
  const period = own !== null ? own : periodOf(unitWords(label));
  if (period === 'both') return null;
  return { code: r.currencyCode, period, per: denominators.length === 1 ? denominators[0]!.map(singular) : null };
}

/**
 * A stored money TOTAL in terms a goal's figure can be added to (PR Review 5894085840 on #2305): ONE unscaled currency,
 * no per-item denominator, and a period — the unit's own, else the node's name's ("Other-plan MRR"). Null when any part
 * is unreadable: "£1,500 per year" is never added into a monthly MRR.
 */
export function readMoneyTotal(unit: unknown, label: string): { code: string; period: UnitPeriod } | null {
  const m = readMoney(unit, label);
  return m === null || m.mixed === true || m.per !== null || m.period === null ? null : { code: m.code, period: m.period };
}

/** A count with at most one monthly/yearly period. Reuses the money period vocabulary. */
export function readCountRate(unit: unknown): { noun: string[]; period: Period } | null {
  if (typeof unit !== 'string' || !/^[a-z][a-z\s/-]*$/i.test(unit.trim())) return null;
  const ws = unitWords(unit);
  if (ws.length === 0 || ws.some(isCurrency) || ['%', 'pp'].includes(canonicalUnitSpelling(unit))) return null;
  const periods = ws.filter(isPeriod);
  if (periods.length > 1) return null;
  const period = periodOf(ws);
  if (period === 'both') return null;
  const noun = ws.filter(w => !isPeriod(w) && w !== '/' && w !== 'per' && w !== 'a' && w !== 'an' && w !== 'each' && w !== 'every');
  if (noun.length === 0 || (ws.includes('/') || ws.includes('per')) && period === null) return null;
  return { noun: noun.map(singular), period };
}
/** Total-count consumer compatibility: a rate never becomes a count total. */
export function readCount(unit: unknown): string[] | null {
  const rate = readCountRate(unit);
  return rate === null || rate.period !== null ? null : rate.noun;
}
/** Evidence periods use the same vocabulary and reject duplicates or competing periods. */
export function evidencePeriod(parts: readonly string[]): Period | 'ambiguous' {
  const ps = parts.flatMap(unitWords).filter(isPeriod);
  return ps.length > 1 ? 'ambiguous' : periodOf(ps) as Period;
}

/**
 * Two units naming the same quantity as `unitsCompose` reads them (AIQ 5906521706, P0 PARTNER row E): the same count noun
 * ("subscribers" = "subscriber"; never "customers"), or the same money (currency, period and denominator). A unit neither
 * reads is compared word for word; no unit on either side is never the same.
 */
export function sameUnit(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && ['%', 'pp'].includes(canonicalUnitSpelling(a))) return canonicalUnitSpelling(a) === canonicalUnitSpelling(b);
  const ca = readCountRate(a); const cb = readCountRate(b);
  if (ca !== null || cb !== null) return ca !== null && cb !== null && ca.noun.join(' ') === cb.noun.join(' ') && ca.period === cb.period;
  const ma = readMoney(a, ''); const mb = readMoney(b, '');
  if (ma !== null || mb !== null) {
    return ma !== null && mb !== null && ma.code === mb.code && ma.period === mb.period
      && (ma.per ?? []).join(' ') === (mb.per ?? []).join(' ');
  }
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const pa = periodOf(unitWords(a)); const pb = periodOf(unitWords(b));
  return pa !== null && pa !== 'both' && pa === pb
    && unitWords(a).filter(w=>w!=='/').every(isPeriod) && unitWords(b).filter(w=>w!=='/').every(isPeriod);
}
