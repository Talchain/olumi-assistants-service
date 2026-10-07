/** S-E S4: read a ceiling on an existing money quantity, from THIS message only.
 * Budget/spend/available-money wording names the model's total cost; it never
 * picks a salary, price, risk or goal merely because it also holds pounds.
 * Token sequences are scanned linearly; no new regular expressions.
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWroteFor, ownUnitsOf, sentenceNamesOtherQuantity } from './stated-by-user.js';
import { factorUnitOf } from './unit-conflict.js';
import { readUnitParts, statedTailParts } from './same-unit.js';

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
const notLimits = ['competitor', 'rival', 'their', 'his', 'her', 'its', 'unless', 'provided', 'when', 'last year', 'if', 'suppose', 'imagine', 'would', 'could', 'used to', 'previously', 'spent', 'not', 'never', 'isn t', 'was', 'had', 'don t', 'doesn t'];
/** Display the currency magnitude and the period the writer carries unchanged. */
export function limitFigure(value: number, unit: string): string {
  const reading = readCurrencyUnitWithQualifiers(unit);
  const period = readUnitParts(unit)?.period;
  return `${reading.currencyDisplay ?? reading.currencyCode ?? unit}${(value * reading.multiplier).toLocaleString('en-GB', { maximumFractionDigits: 10 })}${period ? ` ${period === 'hour' ? 'an' : 'a'} ${period}` : ''}`;
}
export function limitQuantityUnit(raw: unknown, node: Record<string, unknown>): string | undefined {
  const reading = (node.unit_reading as { unit?: unknown } | undefined)?.unit;
  return ownUnitsOf(node)[0] ?? factorUnitOf(raw, node) ?? (typeof reading === 'string' ? reading : undefined);
}
/** An explicit possessive names a different owner; contractions do not. */
function foreignPossessive(text: string): boolean {
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    if (!["'", '’'].includes(lower[i]!)) continue;
    if (lower[i + 1] !== 's' || (lower[i + 2] !== undefined && lower[i + 2]!.trim() !== '')) continue;
    let start = i;
    while (start > 0 && lower[start - 1]! >= 'a' && lower[start - 1]! <= 'z') start -= 1;
    if (!['it', 'that', 'there', 'here', 'what'].includes(lower.slice(start, i))) return true;
  }
  return false;
}
/** Sentence/clause bounds around one figure; decimal and thousands punctuation stays inside it. */
function spanAt(text: string, at: number, commas: boolean): { start: number; end: number } {
  const digit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
  const boundary = (i: number): boolean => {
    const c = text[i]!;
    if ((c === '.' || c === ',') && digit(text[i - 1]) && digit(text[i + 1])) return false;
    return ['.', ';', '!', '?', '\n'].includes(c) || (commas && c === ',');
  };
  let start = at; let end = at;
  while (start > 0 && !boundary(start - 1)) start -= 1;
  while (end < text.length && !boundary(end)) end += 1;
  return { start, end };
}
/** Genuine absence only: a statement/currency rejection never means its quantity is missing. */
export function hasLimitQuantity(raw: Record<string, unknown>, askedLabel: string): boolean {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  return nodes.some(n => ['factor', 'outcome'].includes(String(n.kind)) && typeof n.label === 'string'
    && (limitWords(n.label).join(' ') === limitWords(askedLabel).join(' ')
      || ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(limitWords(n.label).join(' ')))
    && readCurrencyUnitWithQualifiers(limitQuantityUnit(raw, n)).kind === 'currency');
}
export function readNewLimit(raw: Record<string, unknown>, text: string, value: number, askedLabel?: string): NewLimitValue | null {
  const original = text;
  const originalAt: number[] = [];
  // Bound whitespace before invoking the shared scanners, retaining the original quote.
  // Those scanners allow leading whitespace and can revisit a long blank run.
  let compact = ''; let blank = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c.trim() === '') {
      // A newline remains a sentence boundary even after spaces in the same blank run.
      if (c === '\n' && compact.at(-1) !== '\n') { compact += '\n'; originalAt.push(i); }
      else if (!blank) { compact += ' '; originalAt.push(i); }
      blank = true;
    } else { compact += c; originalAt.push(i); blank = false; }
  }
  text = compact;
  if (!Number.isFinite(value) || value < 0 || text.includes('?')) return null;
  const amounts = findStatedAmounts(text);
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  // Rivals include EVERY money quantity, even kinds that cannot receive this limit.
  const money = nodes.flatMap(n => {
    if (typeof n.label !== 'string' || typeof n.id !== 'string') return [];
    const unit = limitQuantityUnit(raw, n);
    if (typeof unit !== 'string' || readCurrencyUnitWithQualifiers(unit).kind !== 'currency') return [];
    return [{ node: n, id: n.id, label: n.label, unit, reading: readCurrencyUnitWithQualifiers(unit) }];
  });
  const eligible = money.filter(n => ['factor', 'outcome'].includes(String(n.node.kind)));
  for (const a of amounts) {
    if (a.kind !== 'currency') continue;
    const sentence = spanAt(text, a.index, false);
    const span = spanAt(text, a.index, true);
    const clause = text.slice(span.start, span.end);
    const left = limitWords(text.slice(span.start, a.index));
    const right = limitWords(text.slice(a.index + a.matchedText.length, span.end));
    const ws = limitWords(clause);
    const wholeSentence = limitWords(text.slice(sentence.start, sentence.end));
    if (notLimits.some(p => has(ws, p)) || foreignPossessive(clause)
      || ['if', 'unless', 'provided', 'when'].some(p => has(wholeSentence, p))
      || !(ceilings.some(p => has(left, p)) || has(right, 'is all we have'))) continue;
    const statedUnit = statedTailParts(text, a);
    const matches = eligible.filter(n => {
      if (n.reading.currencyCode !== a.currencyCode || a.magnitude !== value * n.reading.multiplier) return false;
      const ownUnit = readUnitParts(n.unit);
      if (ownUnit === null || statedUnit === null || ownUnit.period !== statedUnit.period
        || JSON.stringify(ownUnit.per) !== JSON.stringify(statedUnit.per)) return false;
      const labelWords = limitWords(n.label);
      const named = has(ws, labelWords.join(' '));
      const totalCost = ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(labelWords.join(' '));
      const firstParty = ['our', 'we', 'i', 'my', 'us'].some(p => has(ws, p));
      const budgetNamesCost = totalCost && firstParty && (has(left, 'budget') || has(left, 'spend') || has(left, 'only have') || has(right, 'is all we have'));
      if (!named && !budgetNamesCost) return false;
      const targets = [n.label, ...(budgetNamesCost ? ['budget', 'spend', 'only have', 'all we have'] : [])];
      const others = money.filter(o => o !== n).map(o => o.label);
      if (sentenceNamesOtherQuantity(clause, n.unit, { target: targets, others })) return false;
      return figureTheUserWroteFor(value, n.unit, text, { target: targets, others, at: a.index });
    });
    if (matches.length !== 1) continue;
    const n = matches[0]!;
    if (askedLabel !== undefined && limitWords(askedLabel).join(' ') !== limitWords(n.label).join(' ')) return null;
    // No invented period or level: carry only the quantity's already-held frame.
    const frame = n.node.quantity_frame;
    if (frame !== undefined && frame !== 'level') return null;
    const result: NewLimitValue = { node_id: n.id, operator: '<=', raw_value: value, unit: n.unit, source_quote: '',
      value_frame: 'level' };
    // Count locally named reserves BEFORE testing size, negation or ownership.
    const reserves = amounts.flatMap((r, i) => {
      if (r.index <= a.index || r.index >= sentence.end || r.kind !== 'currency' || r.currencyCode !== a.currencyCode) return [];
      const previous = amounts[i - 1]!;
      const next = amounts[i + 1];
      const local = text.slice(Math.max(sentence.start, previous.index + previous.matchedText.length),
        Math.min(sentence.end, next?.index ?? sentence.end));
      const words = limitWords(local);
      return ['held back', 'hold back', 'keep back', 'set aside'].some(p => has(words, p)) ? [{ amount: r, words, local }] : [];
    });
    let quoteEnd = a.index + a.matchedText.length;
    const candidate = reserves.length === 1 ? reserves[0] : undefined;
    const boundStart = originalAt[a.index]!;
    if (candidate !== undefined && candidate.amount.magnitude < a.magnitude
      && !notLimits.some(p => has(candidate.words, p)) && !foreignPossessive(candidate.local)
      && originalAt[candidate.amount.index + candidate.amount.matchedText.length - 1]! + 1 - boundStart <= 200) {
      const reserveUnit = statedTailParts(text, candidate.amount);
      if (reserveUnit !== null && reserveUnit.period === statedUnit!.period) {
        const reserve = candidate.amount.magnitude / n.reading.multiplier;
        quoteEnd = candidate.amount.index + candidate.amount.matchedText.length;
        const alternative = value - reserve;
        const figure = limitFigure(alternative, n.unit);
        result.reserve = { amount: reserve, alternative, label: `Use ${figure}`, message: `Use ${figure} instead.`,
          detail: `You said you'd keep ${limitFigure(reserve, n.unit)} back. Use ${figure} instead?` };
      }
    }
    const boundEnd = originalAt[quoteEnd - 1]! + 1;
    const quoteStart = Math.max(0, boundStart - Math.floor((200 - (boundEnd - boundStart)) / 2));
    result.source_quote = original.slice(quoteStart, quoteStart + 200);
    return result;
  }
  return null;
}

/** Preserve figures and internal punctuation; normalise only case, whitespace and trailing sentence punctuation. */
export function limitApprovalWords(text: string): string {
  let normal = ''; let blank = false;
  for (const c of text.trim().toLowerCase()) {
    if (c.trim() === '') { blank = normal !== ''; }
    else { if (blank) normal += ' '; normal += c; blank = false; }
  }
  while (normal !== '' && ['.', '!', '?', ',', ';', ':'].includes(normal.at(-1)!)) normal = normal.slice(0, -1).trimEnd();
  return normal;
}
