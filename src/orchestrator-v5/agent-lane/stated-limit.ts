/** S-E S4: read a budget or loss-threshold ceiling, from THIS message only.
 * Budget/spend/available-money wording names the model's total cost; it never
 * picks a salary, price, risk or goal merely because it also holds pounds.
 * Token sequences are scanned linearly; no new regular expressions.
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { factorTheUserNamed, figureTheUserWroteFor, ownUnitsOf, sameWord, sentenceNamesOtherQuantity } from './stated-by-user.js';
import { factorUnitOf } from './unit-conflict.js';
import { isRelativeChangePercentUnit, readUnitParts, statedTailParts } from './same-unit.js';
import { isPeriodConnector, periodAdverb, periodNoun, shareKind } from '../../utils/unit-alphabet.js';

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
const ceilings = ['within', 'only have', 'budget', 'at most', 'up to', 'no more than', 'can t spend more than', 'cannot spend more than'];
/** Words that may stand before a budget cue: first-party, neutral, or a period word ("Our monthly budget", "Budget:"). */
const budgetSubjects = ['our', 'we', 'i', 'my', 'us', 'the', 'a', 'an', 'total', 'overall', 'have', 've', 'got', 'has', 'can', 'only', 'so', 'and', 'project'];
/** A reserve the user takes back in the same breath ("keep back £20k — actually no"). */
const reserveRejections = ['no', 'forget', 'ignore', 'scratch'];
const notLimits = ['competitor', 'rival', 'their', 'his', 'her', 'its', 'unless', 'provided', 'when', 'last year', 'if', 'suppose', 'imagine', 'would', 'could', 'used to', 'previously', 'spent', 'not', 'never', 'isn t', 'was', 'had', 'don t', 'doesn t'];
/** Closed loss vocabulary: no synonyms inferred by the Agent. Hyphens are token separators. */
export const LOSS_THRESHOLD_CONSEQUENCES = ['lose money', 'losing money', 'start to lose money', 'unprofitable', 'in the red', 'loss-making'] as const;
const lossConsequences = LOSS_THRESHOLD_CONSEQUENCES.map(limitWords);
const crossingCues = ['above', 'over', 'more than', 'past', 'tops', 'exceeds', 'goes above', 'anything over'].map(limitWords);
// Only this grammar admits "if": a crossing into the stated loss region names its inclusive complement.
const notLossLimits = notLimits.filter(p => p !== 'if');
const consequenceGlue = ['and', 'we', 're', 'are', 'will', 'll', 'start', 'starts', 'to', 'do', 'it', 's', 'is', 'become', 'becomes', 'be', 'then'];
const crossingSubjects = ['our', 'current', 'we', 'i', 'my', 'us', 'the', 'a', 'an', 'if', 'it', 'goes', 'anything', 'and', 'is', 're'];
/** Bound blanks before the shared amount scan, with an index back to the user's untouched words. */
function compactLimitText(text: string): { text: string; originalAt: number[] } {
  const originalAt: number[] = [];
  let compact = ''; let blank = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c.trim() === '') {
      if (c === '\n' && compact.at(-1) !== '\n') { compact += '\n'; originalAt.push(i); }
      else if (!blank) { compact += ' '; originalAt.push(i); }
      blank = true;
    } else { compact += c; originalAt.push(i); blank = false; }
  }
  return { text: compact, originalAt };
}
/** The same crossing cues, without granting a limit: the existing change door must not fall back
 * to a generic figure match when a percentage crossing fails the closed loss grammar. */
export function hasPercentageCrossing(text: string): boolean {
  text = compactLimitText(text).text;
  return findStatedAmounts(text).some(a => {
    if (a.kind === 'currency') return false;
    if (a.kind !== 'percent') {
      const tail = limitWords(text.slice(a.index + a.matchedText.length, a.index + a.matchedText.length + 32));
      if (![1, 2, 3].some(k => shareKind(tail.slice(0, k).join(' ')) === 'percent')) return false;
    }
    const left = limitWords(text.slice(Math.max(0, a.index - 32), a.index));
    return crossingCues.some(p => left.length >= p.length && p.every((w, j) => left[left.length - p.length + j] === w));
  });
}
/** Display the magnitude and the period the writer carries unchanged. */
export function limitFigure(value: number, unit: string): string {
  if (readUnitParts(unit)?.kind === 'percent') return `${value.toLocaleString('en-GB', { maximumFractionDigits: 10 })}%`;
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
    && (readCurrencyUnitWithQualifiers(limitQuantityUnit(raw, n)).kind === 'currency'
      || readUnitParts(limitQuantityUnit(raw, n))?.kind === 'percent'));
}

/** One bounded token grammar: cue immediately before X; a closed consequence within the same sentence.
 * Sentences and amounts advance once, with at most 16 tokens between X and its consequence. Repeated
 * near-miss cues/figures cannot trigger repeated scans of a long sentence. No regex is added here.
 */
function readLossThreshold(raw: Record<string, unknown>, text: string, value: number, askedLabel: string | undefined,
  original: string, originalAt: readonly number[], amounts: ReturnType<typeof findStatedAmounts>): NewLimitValue | null {
  if (value > 100) return null;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  const percentages = nodes.flatMap(node => {
    if (!['factor', 'outcome'].includes(String(node.kind)) || typeof node.label !== 'string' || typeof node.id !== 'string') return [];
    const unit = limitQuantityUnit(raw, node);
    const parts = readUnitParts(unit);
    if (typeof unit !== 'string' || parts?.kind !== 'percent') return [];
    const level = (node.quantity_frame === undefined || node.quantity_frame === 'level')
      && !(parts.qualifiers !== null && (isRelativeChangePercentUnit(unit, 1) || isRelativeChangePercentUnit(unit, -1)));
    return [{ node, id: node.id, label: node.label, unit, parts, level }];
  });
  const eligible = percentages.filter(n => n.level);
  // Naming a change quantity never licences substituting the model's one different level quantity.
  const named = percentages.filter(n => factorTheUserNamed(n.label, text, {
    options: nodes.filter(o => o.kind === 'option' && typeof o.label === 'string').map(o => String(o.label)),
    others: nodes.filter(o => o !== n.node && typeof o.label === 'string').map(o => String(o.label)),
  }));
  const candidates = named.length === 0 ? eligible : named;
  if (candidates.length !== 1) return null;
  const n = candidates[0]!;
  if (!n.level) return null;
  if (askedLabel !== undefined && limitWords(askedLabel).join(' ') !== limitWords(n.label).join(' ')) return null;
  const ownPeriods = [...new Set((n.parts.qualifiers ?? []).flatMap(w => periodAdverb(w) ?? periodNoun(w) ?? []))];
  if (ownPeriods.length > 1) return null;
  const quantityWords = limitWords(n.label);
  const namesQuantity = (w: string): boolean => quantityWords.some(q => sameWord(q, w));
  const matchesAt = (ws: readonly string[], at: number, phrase: readonly string[]): boolean => phrase.every((w, j) => ws[at + j] === w);
  let amountAt = 0; let sentenceStart = 0;
  const digit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
  for (let end = 0; end <= text.length; end += 1) {
    const c = text[end];
    if (end < text.length && !(['.', ';', '!', '?', '\n'].includes(c!)
      && !(c === '.' && digit(text[end - 1]) && digit(text[end + 1])))) continue;
    const sentence = text.slice(sentenceStart, end);
    const tokens: { word: string; start: number; end: number; clauseStart: number }[] = [];
    let word = ''; let start = 0; let clauseStart = 0;
    for (let i = sentenceStart; i <= end; i += 1) {
      const letter = text[i]?.toLowerCase();
      if (i < end && letter !== undefined && ((letter >= 'a' && letter <= 'z') || digit(letter))) {
        if (word === '') start = i;
        word += letter;
      } else {
        if (word !== '') { tokens.push({ word, start, end: i, clauseStart }); word = ''; }
        if (text[i] === ',') clauseStart = tokens.length;
      }
    }
    const ws = tokens.map(t => t.word);
    const rejected = notLossLimits.some(p => has(ws, p)) || foreignPossessive(sentence);
    let tokenAt = 0;
    while (amountAt < amounts.length && amounts[amountAt]!.index < end) {
      const a = amounts[amountAt++]!;
      if (rejected || a.index < sentenceStart || a.kind === 'currency' || a.magnitude !== value) continue;
      while (tokenAt < tokens.length && tokens[tokenAt]!.end <= a.index) tokenAt += 1;
      const cue = crossingCues.find(p => tokenAt >= p.length && matchesAt(ws, tokenAt - p.length, p));
      if (cue === undefined || text.slice(tokens[tokenAt - 1]!.end, a.index).trim() !== '') continue;
      let after = tokenAt;
      const amountEnd = a.index + a.matchedText.length;
      while (after < tokens.length && tokens[after]!.start < amountEnd) after += 1;
      if (a.kind !== 'percent') {
        let unitWords = 0;
        for (let k = Math.min(3, ws.length - after); k > 0; k -= 1) {
          if (shareKind(ws.slice(after, after + k).join(' ')) === 'percent') { unitWords = k; break; }
        }
        if (unitWords === 0) continue;
        after += unitWords;
      }
      if (ws[after] === 'point' || ws[after] === 'points') continue;
      let statedPeriod = periodAdverb(ws[after] ?? '');
      if (statedPeriod !== null) after += 1;
      else if (isPeriodConnector(ws[after] ?? '') && periodNoun(ws[after + 1] ?? '') !== null) {
        statedPeriod = periodNoun(ws[after + 1]!); after += 2;
      }
      if (statedPeriod !== null && statedPeriod !== ownPeriods[0]) continue;
      const cueAt = tokenAt - cue.length;
      const prefixStart = tokens[cueAt]!.clauseStart;
      if (cueAt - prefixStart > 16) continue;
      let consequence = false;
      let beforeLoss: number | undefined;
      // After X: only the quantity's own words and first-party/consequence glue may bridge to the loss.
      for (let at = after; at < Math.min(ws.length, after + 16); at += 1) {
        if (lossConsequences.some(p => matchesAt(ws, at, p))) { consequence = true; break; }
        if (!consequenceGlue.includes(ws[at]!) && !namesQuantity(ws[at]!)) break;
      }
      // Before X: "we lose money once churn tops X"; unrelated losses elsewhere in the sentence do not bind X.
      if (!consequence) for (let at = Math.max(0, cueAt - 16); at < cueAt; at += 1) {
        const loss = lossConsequences.find(p => matchesAt(ws, at, p));
        if (loss === undefined || ws[at + loss.length] !== 'once') continue;
        if (ws.slice(at + loss.length + 1, cueAt).every(w => namesQuantity(w) || ['it', 'goes'].includes(w))) {
          consequence = true; beforeLoss = at; break;
        }
      }
      if (!consequence) continue;
      // A named third party or another quantity before the cue cannot become this model's quantity.
      // Read only this bounded comma clause (or the subject of the loss-before form), not earlier context.
      const prefix = ws.slice(prefixStart, beforeLoss ?? cueAt);
      const leftPeriods = [...new Set(prefix.flatMap(w => namesQuantity(w) ? [] : periodAdverb(w) ?? periodNoun(w) ?? []))];
      if (leftPeriods.length > 1 || (leftPeriods.length === 1 && leftPeriods[0] !== ownPeriods[0])) continue;
      if (!prefix.every(w => crossingSubjects.includes(w) || namesQuantity(w) || periodAdverb(w) !== null
        || periodNoun(w) !== null || isPeriodConnector(w) || [...w].every(digit))) continue;
      const boundStart = originalAt[a.index]!;
      const boundEnd = originalAt[amountEnd - 1]! + 1;
      if (boundEnd - boundStart > 200) return null;
      const quoteStart = Math.max(0, boundStart - Math.floor((200 - (boundEnd - boundStart)) / 2));
      return { node_id: n.id, operator: '<=', raw_value: value, unit: n.unit, value_frame: 'level',
        source_quote: original.slice(quoteStart, quoteStart + 200) };
    }
    sentenceStart = end + 1;
  }
  return null;
}
export function readNewLimit(raw: Record<string, unknown>, text: string, value: number, askedLabel?: string): NewLimitValue | null {
  const original = text;
  // Bound whitespace before invoking the shared scanners, retaining the original quote.
  // Those scanners allow leading whitespace and can revisit a long blank run.
  const compact = compactLimitText(text);
  const originalAt = compact.originalAt;
  text = compact.text;
  if (!Number.isFinite(value) || value < 0 || text.includes('?')) return null;
  const amounts = findStatedAmounts(text);
  const lossThreshold = readLossThreshold(raw, text, value, askedLabel, original, originalAt, amounts);
  if (lossThreshold !== null) return lossThreshold;
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
    // A later clause of the same sentence that holds no amount qualifies this figure ("…£200k, but that was last year").
    let qualified = false;
    for (let at = span.end; at < sentence.end;) {
      const piece = spanAt(text, at + 1, true);
      at = piece.end;
      if (amounts.some(r => r.index >= piece.start && r.index < piece.end)) continue;
      if (notLimits.some(p => has(limitWords(text.slice(piece.start, piece.end)), p))) qualified = true;
    }
    if (qualified || notLimits.some(p => has(ws, p)) || foreignPossessive(clause)
      || ['if', 'unless', 'provided', 'when'].some(p => has(wholeSentence, p))
      || !(ceilings.some(p => has(left, p)) || has(right, 'is all we have'))) continue;
    const tail = statedTailParts(text, a);
    // A period word before the figure ("Our monthly budget is £200k") states its period as surely as one after it.
    const leftPeriods = [...new Set(left.flatMap(w => periodAdverb(w) ?? []))];
    if (leftPeriods.length > 1 || (leftPeriods.length === 1 && tail?.period != null && tail.period !== leftPeriods[0])) continue;
    const statedUnit = tail === null ? null : { ...tail, period: tail.period ?? leftPeriods[0] ?? null };
    // Every word before the first budget cue is first-party or neutral: "Acme has a budget of £200k for our project" is Acme's.
    const cueAt = left.findIndex((_, i) => [...ceilings, 'spend'].some(p => has(left.slice(i, i + p.split(' ').length), p)));
    const subject = (w: string) => budgetSubjects.includes(w) || periodAdverb(w) !== null;
    const ownedBudget = cueAt >= 0 ? left.slice(0, cueAt).every(subject) : left.every(subject) && has(right, 'is all we have');
    const matches = eligible.filter(n => {
      if (n.reading.currencyCode !== a.currencyCode || a.magnitude !== value * n.reading.multiplier) return false;
      const ownUnit = readUnitParts(n.unit);
      if (ownUnit === null || statedUnit === null || ownUnit.period !== statedUnit.period
        || JSON.stringify(ownUnit.per) !== JSON.stringify(statedUnit.per)) return false;
      const labelWords = limitWords(n.label);
      const named = has(ws, labelWords.join(' '));
      const totalCost = ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(labelWords.join(' '));
      const budgetNamesCost = totalCost && ownedBudget && (has(left, 'budget') || has(left, 'spend') || has(left, 'only have') || has(right, 'is all we have'));
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
      && ![...notLimits, ...reserveRejections].some(p => has(candidate.words, p)) && !foreignPossessive(candidate.local)
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
    // A figure the 200-character quote cannot hold whole is not quoted by halves.
    if (originalAt[a.index + a.matchedText.length - 1]! + 1 - boundStart > 200) return null;
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
