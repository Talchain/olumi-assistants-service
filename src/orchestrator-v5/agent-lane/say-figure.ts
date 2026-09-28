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
  const n = value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (unit === '') return n;
  if (unit.startsWith('%')) return `${n}${unit}`;
  // The leading token, up to a space or a "/" (served journey E: "GBP/year"); the rest keeps its own separator.
  const [, head = '', rest = ''] = /^([^\s/]+)(.*)$/u.exec(unit) ?? [];
  const symbol = PREFIX_SYMBOL.get(head.toUpperCase()) ?? PREFIX_SYMBOL.get(head);
  if (symbol !== undefined) return `${symbol}${n}${rest}`;
  return `${n} ${unit}`;
}

/**
 * {@link sayFigure} when it says the figure EXACTLY, else null. A consent label names the figure the approval writes,
 * and `sayFigure` keeps two decimal places: 0.125 would read as 0.13. The caller keeps its own exact rendering then.
 */
export function sayFigureExactly(value: number, unit: string): string | null {
  if (!Number.isFinite(value) || Math.round(value * 100) / 100 !== value) return null;
  return sayFigure(value, unit.trim());
}
