/**
 * THE LANE'S ONE FIGURE FORMATTER: a figure as the user writes it. Moved verbatim from `limited-level-ask.ts` (MG), so
 * the limit asks and the consent labels say a figure the same way (DL #72 5866282787: "72000 £ MRR" and "20000 £ over
 * 6 months" reached a consent subject after #2221).
 */
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';

/**
 * A prefix symbol by itself or by its code, DERIVED from the one currency vocabulary (never a list of our own: the
 * `currency-vocabulary.union` guard): its single-character, non-letter keys, as that guard reads them. "GBP" and the
 * pound sign both say the pound sign; "CHF", "kr" and the dollar variants stay after the figure.
 */
const PREFIX_SYMBOL: ReadonlyMap<string, string> = new Map(Object.entries(CURRENCY_SYMBOL_TO_CODE)
  .filter(([symbol]) => [...symbol].length === 1 && !/[a-z]/i.test(symbol))
  .flatMap(([symbol, code]) => [[symbol, symbol], [code, symbol]] as const));

/**
 * As the user writes a figure: "3%", "£49 per month", "1,500 subscribers". A currency CODE unit says its symbol
 * ("GBP" → "£30,000", DL copy nit on #2205 5864058391), never "30,000 GBP".
 */
export function sayFigure(value: number, unit: string): string {
  // Money with pence says both digits (Panel ROOT 5870330356: "£58.8" beside the card's "£58.80").
  const pence = currencyOf(unit) !== undefined && !Number.isInteger(value) && Math.round(value * 100) / 100 === value;
  return place(value.toLocaleString('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: pence ? 2 : 0 }), unit);
}

/** The prefix symbol a unit's leading token names ("GBP/month" → "£"), else undefined. */
function currencyOf(unit: string): { readonly symbol: string; readonly rest: string } | undefined {
  // The leading token, up to a space or a "/" (served journey E: "GBP/year"); the rest keeps its own separator.
  const [, head = '', rest = ''] = /^([^\s/]+)(.*)$/u.exec(unit) ?? [];
  const symbol = PREFIX_SYMBOL.get(head.toUpperCase()) ?? PREFIX_SYMBOL.get(head);
  return symbol === undefined ? undefined : { symbol, rest };
}

/**
 * ⛔ THE RATE SEPARATOR, ONE CONSTANT (DL ruling #72 5871074397: the design contract's spaced " / ", as the UI half of this
 * rule writes it, #2245): "£58.80 / month", "£49 per subscriber / month", "1,500 subscribers / month".
 */
export const RATE_SEPARATOR = ' / ';

/** A formatted number and its unit, placed as a person writes them. */
function place(n: string, rawUnit: string): string {
  const unit = rawUnit.replace(/\s*\/\s*/g, RATE_SEPARATOR);
  if (unit === '') return n;
  if (unit.startsWith('%')) return `${n}${unit}`;
  const c = currencyOf(unit);
  // The sign goes before the symbol, as a person writes it and as the UI half of this rule does (#2245): "-£500".
  if (c !== undefined) return n.startsWith('-') ? `-${c.symbol}${n.slice(1)}${c.rest}` : `${c.symbol}${n}${c.rest}`;
  return `${n} ${unit}`;
}

/**
 * {@link sayFigure} when it says the figure EXACTLY, else null. A consent label names the figure the approval writes,
 * and `sayFigure` keeps two decimal places: 0.125 would read as 0.13. The caller keeps its own exact rendering then.
 */
export function sayFigureExactly(value: number, unit: string): string | null {
  if (!Number.isFinite(value) || Math.round(value * 100) / 100 !== value) return null;
  return sayFigure(value, spoken(value, unit.trim()));
}

/** Percent spelled as a word is said as the sign; a machine unit's underscores are spaces. */
// "percentage points" is NOT "%": a change in points and a change in percent are different quantities (AIQ on #2247).
const PERCENT_WORD = /^(?:percent|percentage|pct)\b(?![\s_]+points?\b)/i;

/**
 * The unit as a person says it with THIS figure (DL #2227 follow-up B, 5867621499): "percent" → "%" (it read "5 percent"
 * where it had read "5%"), `story_points` → "story points", and one of a plain count or period is singular ("1 month",
 * never "1 months"; `pluraliseUnit`'s own conservative rule). A currency unit keeps its words: the symbol says it.
 */
function spoken(value: number, unit: string): string {
  const u = unit.replace(PERCENT_WORD, '%').replace(/_/g, ' ');
  const head = /^[^\s/]+/.exec(u)?.[0] ?? '';
  if (u === '' || u.startsWith('%') || PREFIX_SYMBOL.has(head) || PREFIX_SYMBOL.has(head.toUpperCase())) return u;
  return pluraliseUnit(u, value);
}

/**
 * A figure the approval does NOT write (a value it replaces), said so a person can read it: exact when it can be,
 * otherwise "about" and rounded, as a count is (DL #2227 follow-up A: "1469.3877551020407 subscribers → 1,500").
 */
export function sayFigureRead(value: number, unit: string): string {
  const exact = sayFigureExactly(value, unit);
  if (exact !== null || !Number.isFinite(value)) return exact ?? String(value);
  const r = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `about ${sayFigure(r, spoken(r, unit.trim()))}`;
}

/**
 * ⛔ CEE's ONE FIGURE RULE FOR A CONFIRMATION (DL #72 5870353946, the CEE half of Panel's ROOT 5870330356). A figure
 * the model now holds, said as the user writes it: "£49/month", never "49 GBP/month". It is EXACT: {@link
 * sayFigureExactly} when that says it, otherwise up to four decimal places (the confirmation's own precision, so 0.0525
 * is never read as 0.05), with the unit placed by the same rule.
 */
export function sayFigureAsWritten(value: number, unit: string): string {
  const exact = sayFigureExactly(value, unit);
  if (exact !== null) return exact;
  if (!Number.isFinite(value)) return String(value);
  const n = Math.abs(value) >= 1000
    ? value.toLocaleString('en-GB', { maximumFractionDigits: 4 })
    : value.toFixed(4).replace(/\.?0+$/, '');
  return place(n, spoken(value, unit.trim()));
}

/**
 * Grammatically agree a space-separated unit with its count: singular form
 * when |value| === 1 ("1 month", not "1 months"); the supplied plural form
 * otherwise ("12 months", "0 months", "2 months").
 *
 * Conservative by design — only collapses a regular trailing "-s" on an
 * alphabetic unit of 4+ characters, and never for "-ss"/"-us"/"-is" endings
 * (e.g. "status", "analysis", "bonus") or abbreviations shorter than 4 chars
 * (e.g. "bps"). Symbol / no-space / prefix units never reach here (handled by
 * the caller). Irregular plurals (e.g. "people") are intentionally left
 * untouched: rare in the decision domain and better readable-but-imperfect
 * than mangled. Only the documented "1 months" → "1 month" class is fixed.
 */
export function pluraliseUnit(unit: string, value: number): string {
  if (Math.abs(value) !== 1) return unit;
  // "-ies", "-ses", "-xes", "-zes", "-ches", "-shes" are left whole: dropping the "s" would print "deliverie" or "boxe".
  if (/[a-z]{3,}s$/i.test(unit) && !/(?:ss|us|is|ies|ses|xes|zes|ches|shes)$/i.test(unit)) {
    return unit.replace(/s$/i, '');
  }
  return unit;
}
