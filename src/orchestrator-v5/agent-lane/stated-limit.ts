/** S-E S4: read a ceiling on an existing money quantity, from THIS message only.
 * Budget/spend/available-money wording names the model's total cost; it never
 * picks a salary, price, risk or goal merely because it also holds pounds.
 * Token sequences are scanned linearly; no new regular expressions.
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWroteFor, ownUnitsOf } from './stated-by-user.js';
import { factorUnitOf } from './unit-conflict.js';

export interface NewLimitValue {
  node_id: string;
  operator: '<=';
  raw_value: number;
  unit: string;
  source_quote: string;
  value_frame?: import('@talchain/schemas').GoalThresholdFrameType;
  reserve?: { amount: number; alternative: number; message: string; detail: string; label: string };
}
export const NO_LIMIT_QUANTITY = 'This model has no unique cost quantity for that limit; add “Total cost” with each option’s cost first.';
const limitWords = (text: string): string[] => {
  const words: string[] = []; let word = '';
  for (const c of text.toLowerCase()) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) word += c;
    else if (word !== '') { words.push(word); word = ''; }
  }
  if (word !== '') words.push(word);
  return words;
};
const has = (ws: readonly string[], phrase: string): boolean => {
  const wanted = phrase.split(' ');
  return ws.some((_, i) => wanted.every((w, j) => ws[i + j] === w));
};
const ceilings = ['within', 'only have', 'budget', 'at most', 'no more than', 'can t spend more than', 'cannot spend more than'];
const notLimits = ['competitor', 'last year', 'if', 'suppose', 'imagine', 'would', 'could', 'used to', 'previously', 'spent', 'not', 'never', 'isn t', 'was', 'had', 'don t', 'doesn t'];
/** Currency display only; the node's unit, including its period, remains the writer's unit. */
export function limitFigure(value: number, unit: string): string {
  const reading = readCurrencyUnitWithQualifiers(unit);
  return `${reading.currencyDisplay ?? reading.currencyCode ?? unit}${(value * reading.multiplier).toLocaleString('en-GB', { maximumFractionDigits: 10 })}`;
}
export function limitQuantityUnit(raw: unknown, node: Record<string, unknown>): string | undefined {
  const reading = (node.unit_reading as { unit?: unknown } | undefined)?.unit;
  return ownUnitsOf(node)[0] ?? factorUnitOf(raw, node) ?? (typeof reading === 'string' ? reading : undefined);
}
export function readNewLimit(raw: Record<string, unknown>, text: string, value: number, askedLabel?: string): NewLimitValue | null {
  const sourceQuote = text.slice(0, 200);
  // Bound whitespace before invoking the shared scanners, retaining the original quote.
  // Those scanners allow leading whitespace and can revisit a long blank run.
  let compact = ''; let blank = false;
  for (const c of text) {
    if (c.trim() === '') { if (!blank) compact += c === '\n' ? '\n' : ' '; blank = true; }
    else { compact += c; blank = false; }
  }
  text = compact;
  if (!Number.isFinite(value) || value < 0 || text.includes('?')) return null;
  const amounts = findStatedAmounts(text);
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  const eligible = nodes.flatMap(n => {
    if (!['factor', 'outcome'].includes(String(n.kind)) || typeof n.label !== 'string' || typeof n.id !== 'string') return [];
    const unit = limitQuantityUnit(raw, n);
    if (typeof unit !== 'string' || readCurrencyUnitWithQualifiers(unit).kind !== 'currency') return [];
    return [{ node: n, id: n.id, label: n.label, unit, reading: readCurrencyUnitWithQualifiers(unit) }];
  });
  for (const a of amounts) {
    if (a.kind !== 'currency') continue;
    // Clause punctuation excludes a reserve, without splitting thousands separators.
    const before = text.slice(0, a.index);
    const preceding = amounts.filter(p => p.index < a.index).at(-1);
    const leftAt = Math.max(...['.', ';', '!', '\n'].map(c => before.lastIndexOf(c)),
      preceding === undefined ? -1 : preceding.index + preceding.matchedText.length - 1) + 1;
    const tail = text.slice(a.index + a.matchedText.length);
    const stops = ['.', ';', '!', '\n'].map(c => tail.indexOf(c)).filter(i => i >= 0);
    const clause = text.slice(leftAt, a.index + a.matchedText.length + (stops.length ? Math.min(...stops) : tail.length));
    const left = limitWords(text.slice(leftAt, a.index));
    const right = limitWords(tail.slice(0, stops.length ? Math.min(...stops) : tail.length));
    if (notLimits.some(p => has(left, p)) || !(ceilings.some(p => has(left, p)) || has(right, 'is all we have'))) continue;
    const ws = limitWords(clause);
    const matches = eligible.filter(n => {
      if (n.reading.currencyCode !== a.currencyCode || a.magnitude !== value * n.reading.multiplier) return false;
      const labelWords = limitWords(n.label);
      const named = has(ws, labelWords.join(' '));
      const totalCost = ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(labelWords.join(' '));
      const budgetNamesCost = totalCost && (has(left, 'budget') || has(left, 'spend') || has(left, 'only have') || has(right, 'is all we have'));
      if (!named && !budgetNamesCost) return false;
      const targets = [n.label, ...(budgetNamesCost ? ['budget', 'spend', 'only have', 'all we have'] : [])];
      return figureTheUserWroteFor(value, n.unit, text, { target: targets,
        others: eligible.filter(o => o.id !== n.id).map(o => o.label), at: a.index });
    });
    if (matches.length !== 1) continue;
    const n = matches[0]!;
    if (askedLabel !== undefined && limitWords(askedLabel).join(' ') !== limitWords(n.label).join(' ')) return null;
    // No invented period or level: carry only the quantity's already-held frame.
    const frame = n.node.quantity_frame;
    if (frame !== undefined && frame !== 'level') return null;
    const result: NewLimitValue = { node_id: n.id, operator: '<=', raw_value: value, unit: n.unit, source_quote: sourceQuote,
      value_frame: 'level' };
    const reserves = amounts.filter(r => {
      if (r.index <= a.index || r.kind !== 'currency' || r.currencyCode !== a.currencyCode || r.magnitude >= a.magnitude) return false;
      const from = limitWords(text.slice(a.index + a.matchedText.length, r.index));
      const after = limitWords(text.slice(r.index + r.matchedText.length));
      return ['held back', 'hold back', 'keep back', 'set aside'].some(p => has(from, p) || has(after, p));
    });
    if (reserves.length === 1) {
      const reserve = reserves[0]!.magnitude / n.reading.multiplier;
      const alternative = value - reserve;
      const figure = limitFigure(alternative, n.unit);
      result.reserve = { amount: reserve, alternative, label: `Use ${figure}`, message: `Use ${figure} instead.`,
        detail: `You said you'd keep ${limitFigure(reserve, n.unit)} back. Use ${figure} instead?` };
    }
    return result;
  }
  return null;
}
