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
  const parts = readUnitParts(unit);
  const suffix = parts?.period ? ` ${parts.period === 'hour' ? 'an' : 'a'} ${parts.period}` : '';
  if (parts?.kind === 'percent') {
    const qualifiers = parts.qualifiers ?? [];
    const periods = [...new Set(qualifiers.flatMap(w => periodAdverb(w) ?? periodNoun(w) ?? []))];
    const periodOnly = periods.length === 1 && qualifiers.every(w => w === '/' || isPeriodConnector(w)
      || periodAdverb(w) !== null || periodNoun(w) !== null);
    const tail = parts.base !== null ? ` of ${parts.base.join(' ')}` : periodOnly
      ? ` ${periods[0] === 'hour' ? 'an' : 'a'} ${periods[0]}` : qualifiers.length > 0 ? ` ${qualifiers.join(' ')}` : suffix;
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 10 })}%${tail}`;
  }
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
/** Genuine absence only: a statement/currency rejection never means its quantity is missing. */
export function hasLimitQuantity(raw: Record<string, unknown>, askedLabel: string): boolean {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  return nodes.some(n => ['factor', 'outcome'].includes(String(n.kind)) && typeof n.label === 'string'
    && (limitWords(n.label).join(' ') === limitWords(askedLabel).join(' ')
      || ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(limitWords(n.label).join(' ')))
    && (readCurrencyUnitWithQualifiers(limitQuantityUnit(raw, n)).kind === 'currency'
      || readUnitParts(limitQuantityUnit(raw, n))?.kind === 'percent'));
}

/** One advancing pass records sentence/clause bounds and assigns amounts once. */
interface LimitClause { start: number; end: number; amounts: ReturnType<typeof findStatedAmounts> }
interface LimitSentence extends LimitClause { clauses: LimitClause[] }
function limitSentences(text: string, amounts: ReturnType<typeof findStatedAmounts>): LimitSentence[] {
  const sentences: LimitSentence[] = [];
  let sentenceStart = 0; let clauseStart = 0; let amountAt = 0; let clauses: LimitClause[] = [];
  const digit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
  for (let end = 0; end <= text.length; end += 1) {
    const c = text[end];
    const sentenceEnd = end === text.length || ['.', ';', '!', '?', '\n'].includes(c ?? '');
    if (!sentenceEnd && c !== ',') continue;
    if ((c === '.' || c === ',') && digit(text[end - 1]) && digit(text[end + 1])) continue;
    const first = amountAt;
    while (amountAt < amounts.length && amounts[amountAt]!.index < end) amountAt += 1;
    clauses.push({ start: clauseStart, end, amounts: amounts.slice(first, amountAt) });
    clauseStart = end + 1;
    if (sentenceEnd) {
      sentences.push({ start: sentenceStart, end, clauses, amounts: clauses.flatMap(p => p.amounts) });
      sentenceStart = end + 1; clauses = [];
    }
  }
  return sentences;
}
interface LossToken { word: string; start: number; end: number; amount?: ReturnType<typeof findStatedAmounts>[number] }
/** Every amount and punctuation mark survives. Only word hyphens and contractions split into words. */
function lossTokens(text: string, sentence: LimitSentence): LossToken[] {
  const tokens: LossToken[] = []; let amountAt = 0; let word = ''; let start = sentence.start;
  const letter = (c: string | undefined): boolean => c !== undefined && c.toLowerCase() >= 'a' && c.toLowerCase() <= 'z';
  const flush = (end: number): void => { if (word !== '') { tokens.push({ word, start, end }); word = ''; } };
  for (let i = sentence.start; i < sentence.end; i += 1) {
    const a = sentence.amounts[amountAt];
    if (a !== undefined && i >= a.index) {
      flush(i); tokens.push({ word: '#', start: a.index, end: a.index + a.matchedText.length, amount: a });
      i = a.index + a.matchedText.length - 1; amountAt += 1; continue;
    }
    const c = text[i]!.toLowerCase();
    if (letter(c) || (c >= '0' && c <= '9')) { if (word === '') start = i; word += c; }
    else {
      flush(i);
      if (c.trim() !== '' && !(["'", '’', '-'].includes(c) && letter(text[i - 1]) && letter(text[i + 1]))) {
        tokens.push({ word: c, start: i, end: i + 1 });
      }
    }
  }
  flush(sentence.end); return tokens;
}
/**
 * Closed, complete productions (at most 32 tokens, exactly one figure):
 *   [if|once]? [it|named quantity|empty] CROSS X% [named quantity]? [period]? [,]? [and|then]? LOSS
 *   FIRST-PARTY LOSS once [it|named quantity|empty] CROSS X% [named quantity]? [period]?
 * CROSS is crossingCues. LOSS is [we|we're|we'll|we are|we will|i|I'm|I'll|i am|i will]?
 * followed by LOSS_THRESHOLD_CONSEQUENCES. Named subjects admit only their label words,
 * our/my/the/current and unit-reader period words. EVERY token must occupy one of these slots.
 * Unknown bases, auxiliaries, qualifiers, extra figures and trailing clauses fail closed.
 */
function readLossThreshold(raw: Record<string, unknown>, text: string, value: number, askedLabel: string | undefined,
  original: string, originalAt: readonly number[], amounts: ReturnType<typeof findStatedAmounts>): NewLimitValue | null {
  if (value > 100 || !amounts.some(a => a.kind !== 'currency' && a.magnitude === value)) return null;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  const quantities = nodes.flatMap(node => {
    if (!['factor', 'outcome', 'goal', 'risk'].includes(String(node.kind)) || typeof node.label !== 'string' || typeof node.id !== 'string') return [];
    const unit = limitQuantityUnit(raw, node); const parts = readUnitParts(unit);
    const level = typeof unit === 'string' && parts?.kind === 'percent' && ['factor', 'outcome'].includes(String(node.kind))
      && (node.quantity_frame === undefined || node.quantity_frame === 'level')
      && !(parts.qualifiers !== null && (isRelativeChangePercentUnit(unit, 1) || isRelativeChangePercentUnit(unit, -1)));
    const words = limitWords(node.label);
    const scope = { options: nodes.filter(o => o.kind === 'option' && typeof o.label === 'string').map(o => String(o.label)),
      others: nodes.filter(o => o !== node && typeof o.label === 'string').map(o => String(o.label)) };
    const decisive = words.filter(w => factorTheUserNamed(node.label as string, w, scope));
    return [{ node, id: node.id, label: node.label, unit, parts, level, words, decisive }];
  });
  const eligible = quantities.filter(n => n.level);
  if (eligible.length === 0) return null;
  type Quantity = typeof quantities[number];
  const matchesAt = (ws: readonly string[], at: number, phrase: readonly string[]): boolean => phrase.every((w, j) => ws[at + j] === w);
  const sentences = limitSentences(text, amounts).map(s => ({ ...s, tokens: lossTokens(text, s) }));
  const mentions: { at: number; quantity: Quantity; foreign: boolean }[] = [];
  const named = new Set<Quantity>(); const foreignNamed = new Set<Quantity>();
  for (const s of sentences) {
    let foreign = false;
    for (let at = 0; at < s.tokens.length; at += 1) {
      const t = s.tokens[at]!;
      if (['our', 'my', 'we', 'i'].includes(t.word)) foreign = false;
      if (['competitor', 'rival', 'their', 'his', 'her', 'its'].includes(t.word)
        || foreignPossessive(text.slice(t.start, t.end + 2))) foreign = true;
      for (const n of quantities) {
        const ws = s.tokens.slice(Math.max(0, at - n.words.length + 1), at + 1).map(x => x.word);
        if (!n.decisive.some(w => sameWord(w, t.word)) && !(ws.length === n.words.length && matchesAt(ws, 0, n.words))) continue;
        mentions.push({ at: t.start, quantity: n, foreign }); named.add(n);
        if (foreign) foreignNamed.add(n);
      }
    }
  }
  const firstParty = ['we re', 'we ll', 'we are', 'we will', 'i m', 'i ll', 'i am', 'i will', 'we', 'i', ''].map(limitWords);
  for (const s of sentences) {
    const ts = s.tokens; const ws = ts.map(t => t.word);
    if (ts.length > 32 || s.amounts.length !== 1 || notLossLimits.some(p => has(ws, p)) || foreignPossessive(text.slice(s.start, s.end))) continue;
    const figureAt = ts.findIndex(t => t.amount !== undefined); const a = ts[figureAt]?.amount;
    if (a === undefined || a.kind === 'currency' || a.magnitude !== value) continue;
    let tailAt = figureAt + 1;
    if (a.kind !== 'percent') {
      let length = 0;
      for (let k = 3; k > 0; k -= 1) if (shareKind(ws.slice(tailAt, tailAt + k).join(' ')) === 'percent') { length = k; break; }
      if (length === 0) continue; tailAt += length;
    }
    const subject = (from: number, end: number): { quantity?: Quantity; itAt?: number; periods: string[] } | null => {
      const said = ws.slice(from, end);
      if (said.length === 0) return { periods: [] };
      if (said.length === 1 && said[0] === 'it') return { itAt: ts[from]!.start, periods: [] };
      let first = 0;
      if (['our', 'my', 'the'].includes(said[first] ?? '')) first += 1;
      if (said[first] === 'current') first += 1;
      const periodAt = (at: number): { length: number; period: string } | null => {
        const adverb = periodAdverb(said[at] ?? '');
        if (adverb !== null) return { length: 1, period: adverb };
        const noun = periodNoun(said[at + 1] ?? '');
        return isPeriodConnector(said[at] ?? '') && noun !== null ? { length: 2, period: noun } : null;
      };
      const matches: { quantity: Quantity; periods: string[] }[] = [];
      // A named phrase is one contiguous portion of the held label, with at most one complete period on either side.
      for (const prefix of [null, periodAt(first)]) {
        const nameAt = first + (prefix?.length ?? 0);
        for (let nameEnd = nameAt + 1; nameEnd <= said.length; nameEnd += 1) {
          const suffix = periodAt(nameEnd);
          if (nameEnd !== said.length && (suffix === null || nameEnd + suffix.length !== said.length)) continue;
          const phrase = said.slice(nameAt, nameEnd);
          for (const n of quantities) {
            const namedHere = phrase.some(w => n.decisive.some(q => sameWord(q, w))) || phrase.join(' ') === n.words.join(' ');
            if (!namedHere || !n.words.some((_, i) => i + phrase.length <= n.words.length && phrase.every((w, j) => sameWord(w, n.words[i + j]!)))) continue;
            matches.push({ quantity: n, periods: [prefix?.period, nameEnd === said.length ? undefined : suffix?.period].filter((p): p is string => p !== undefined) });
          }
        }
      }
      const identities = [...new Set(matches.map(m => m.quantity))];
      if (identities.length !== 1) return null;
      // Prefer the held label itself: "Monthly churn rate" does not invent a period absent from its unit.
      return matches.find(m => m.periods.length === 0) ?? matches[0]!;
    };
    const consequenceAt = (from: number, end: number, requireParty: boolean): boolean => firstParty.some(p =>
      (!requireParty || p.length > 0) && matchesAt(ws, from, p) && lossConsequences.some(loss =>
        from + p.length + loss.length === end && matchesAt(ws, from + p.length, loss)));
    // The cue and the figure touch; punctuation/signs cannot be discarded between them.
    for (const cue of crossingCues) {
      const cueAt = figureAt - cue.length;
      if (cueAt < 0 || !matchesAt(ws, cueAt, cue) || text.slice(ts[figureAt - 1]!.end, a.index).trim() !== '') continue;
      const forms: { from: number; forward: boolean }[] = [{ from: ['if', 'once'].includes(ws[0] ?? '') ? 1 : 0, forward: true }];
      for (let onceAt = 1; onceAt < cueAt; onceAt += 1) {
        if (ws[onceAt] === 'once' && consequenceAt(0, onceAt, true)) forms.push({ from: onceAt + 1, forward: false });
      }
      for (const form of forms) {
        const before = subject(form.from, cueAt);
        if (before === null) continue;
        // Enumerate bounded tail slots; both subject and complete consequence must consume their full slices.
        for (let end = tailAt; end <= Math.min(ts.length, tailAt + 12); end += 1) {
          const after = subject(tailAt, end);
          if (after === null || after.itAt !== undefined) continue;
          let at = end; let statedPeriod: string | null = null;
          if (periodAdverb(ws[at] ?? '') !== null) { statedPeriod = periodAdverb(ws[at]!); at += 1; }
          else if (isPeriodConnector(ws[at] ?? '') && periodNoun(ws[at + 1] ?? '') !== null) {
            statedPeriod = periodNoun(ws[at + 1]!); at += 2;
          }
          if (form.forward) {
            if (ws[at] === ',') at += 1;
            if (['and', 'then'].includes(ws[at] ?? '')) at += 1;
            if (!consequenceAt(at, ts.length, false)) continue;
          } else if (at !== ts.length) continue;
          let n = before.quantity ?? after.quantity;
          if (before.quantity !== undefined && after.quantity !== undefined && before.quantity !== after.quantity) continue;
          if (before.itAt !== undefined) {
            let low = 0; let high = mentions.length;
            while (low < high) {
              const middle = Math.floor((low + high) / 2);
              if (mentions[middle]!.at < before.itAt) low = middle + 1; else high = middle;
            }
            const nearest = mentions[low - 1];
            if (nearest !== undefined) {
              if (mentions[low - 2]?.at === nearest.at || nearest.foreign || (n !== undefined && n !== nearest.quantity)) continue;
              n = nearest.quantity;
            } else if (named.size !== 0) continue;
          }
          if (n === undefined) {
            const choices = named.size === 0 ? eligible : [...named];
            if (choices.length !== 1) continue; n = choices[0]!;
            if (foreignNamed.has(n)) continue;
          }
          if (!n.level || typeof n.unit !== 'string' || (askedLabel !== undefined && limitWords(askedLabel).join(' ') !== limitWords(n.label).join(' '))) continue;
          const periods = [...new Set([...before.periods, ...after.periods, ...(statedPeriod === null ? [] : [statedPeriod])])];
          const ownPeriods = [...new Set((n.parts?.qualifiers ?? []).flatMap(w => periodAdverb(w) ?? periodNoun(w) ?? []))];
          if (ownPeriods.length > 1 || periods.length > 1 || (periods.length === 1 && periods[0] !== ownPeriods[0])) continue;
          const boundStart = originalAt[a.index]!; const boundEnd = originalAt[a.index + a.matchedText.length - 1]! + 1;
          if (boundEnd - boundStart > 200) return null;
          const quoteStart = Math.max(0, boundStart - Math.floor((200 - (boundEnd - boundStart)) / 2));
          return { node_id: n.id, operator: '<=', raw_value: value, unit: n.unit, value_frame: 'level', source_quote: original.slice(quoteStart, quoteStart + 200) };
        }
      }
    }
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
  const compatible = (a: ReturnType<typeof findStatedAmounts>[number]): boolean => a.kind === 'currency'
    && eligible.some(n => n.reading.currencyCode === a.currencyCode && a.magnitude === value * n.reading.multiplier);
  // Reject incompatible figures before sentence, unit and entity work.
  if (!amounts.some(compatible)) return null;
  for (const sentence of limitSentences(text, amounts)) {
    const clauses = sentence.clauses.map(span => {
      const clause = text.slice(span.start, span.end); const ws = limitWords(clause);
      return { ...span, clause, ws, rejected: notLimits.some(p => has(ws, p)) || foreignPossessive(clause) };
    });
    if (['if', 'unless', 'provided', 'when'].some(p => clauses.some(c => has(c.ws, p)))) continue;
    // A later amount-free clause qualifies earlier figures. Compute the suffix once.
    const qualifiedAfter: boolean[] = []; let qualified = false;
    for (let i = clauses.length - 1; i >= 0; i -= 1) {
      qualifiedAfter[i] = qualified;
      if (clauses[i]!.amounts.length === 0 && clauses[i]!.rejected) qualified = true;
    }
    for (let clauseAt = 0; clauseAt < clauses.length; clauseAt += 1) {
      const span = clauses[clauseAt]!;
      if (span.rejected || qualifiedAfter[clauseAt]) continue;
      const candidates = span.amounts.filter(compatible);
      // Two compatible figures in one clause do not identify one ceiling.
      if (candidates.length !== 1) continue;
      const a = candidates[0]!; const { clause, ws } = span;
      const left = limitWords(text.slice(span.start, a.index));
      const right = limitWords(text.slice(a.index + a.matchedText.length, span.end));
      if (!(ceilings.some(p => has(left, p)) || has(right, 'is all we have'))) continue;
      // Shared readers see this clause and its relative amount, never the whole message per figure.
      const localAmount = { ...a, index: a.index - span.start };
      const tail = statedTailParts(clause, localAmount);
      const leftPeriods = [...new Set(left.flatMap(w => periodAdverb(w) ?? []))];
      if (leftPeriods.length > 1 || (leftPeriods.length === 1 && tail?.period != null && tail.period !== leftPeriods[0])) continue;
      const statedUnit = tail === null ? null : { ...tail, period: tail.period ?? leftPeriods[0] ?? null };
      const cueAt = left.findIndex((_, i) => [...ceilings, 'spend'].some(p => has(left.slice(i, i + p.split(' ').length), p)));
      const subject = (w: string) => budgetSubjects.includes(w) || periodAdverb(w) !== null;
      const ownedBudget = cueAt >= 0 ? left.slice(0, cueAt).every(subject) : left.every(subject) && has(right, 'is all we have');
      const matches = eligible.filter(n => {
        if (n.reading.currencyCode !== a.currencyCode || a.magnitude !== value * n.reading.multiplier) return false;
        const ownUnit = readUnitParts(n.unit);
        if (ownUnit === null || statedUnit === null || ownUnit.period !== statedUnit.period
          || JSON.stringify(ownUnit.per) !== JSON.stringify(statedUnit.per)) return false;
        const labelWords = limitWords(n.label);
        const explicitlyNamed = has(ws, labelWords.join(' '));
        const totalCost = ['total cost', 'total costs', 'overall cost', 'overall costs'].includes(labelWords.join(' '));
        const budgetNamesCost = totalCost && ownedBudget && (has(left, 'budget') || has(left, 'spend') || has(left, 'only have') || has(right, 'is all we have'));
        if (!explicitlyNamed && !budgetNamesCost) return false;
        const targets = [n.label, ...(budgetNamesCost ? ['budget', 'spend', 'only have', 'all we have'] : [])];
        const others = money.filter(o => o !== n).map(o => o.label);
        if (sentenceNamesOtherQuantity(clause, n.unit, { target: targets, others })) return false;
        return figureTheUserWroteFor(value, n.unit, clause, { target: targets, others, at: localAmount.index });
      });
      if (matches.length !== 1) continue;
      const n = matches[0]!;
      if (askedLabel !== undefined && limitWords(askedLabel).join(' ') !== limitWords(n.label).join(' ')) return null;
      const frame = n.node.quantity_frame;
      if (frame !== undefined && frame !== 'level') return null;
      const result: NewLimitValue = { node_id: n.id, operator: '<=', raw_value: value, unit: n.unit, source_quote: '', value_frame: 'level' };
      // Disjoint local windows: each amount and its reserve words advance once within this sentence.
      const reserves = sentence.amounts.flatMap((r, i) => {
        if (r.index <= a.index || r.kind !== 'currency' || r.currencyCode !== a.currencyCode) return [];
        const previous = sentence.amounts[i - 1]!; const next = sentence.amounts[i + 1];
        const local = text.slice(Math.max(sentence.start, previous.index + previous.matchedText.length), Math.min(sentence.end, next?.index ?? sentence.end));
        const words = limitWords(local);
        return ['held back', 'hold back', 'keep back', 'set aside'].some(p => has(words, p)) ? [{ amount: r, words, local }] : [];
      });
      let quoteEnd = a.index + a.matchedText.length;
      const candidate = reserves.length === 1 ? reserves[0] : undefined; const boundStart = originalAt[a.index]!;
      if (candidate !== undefined && candidate.amount.magnitude < a.magnitude
        && ![...notLimits, ...reserveRejections].some(p => has(candidate.words, p)) && !foreignPossessive(candidate.local)
        && originalAt[candidate.amount.index + candidate.amount.matchedText.length - 1]! + 1 - boundStart <= 200) {
        const reserveUnit = statedTailParts(text.slice(sentence.start, sentence.end), { ...candidate.amount, index: candidate.amount.index - sentence.start });
        if (reserveUnit !== null && reserveUnit.period === statedUnit!.period) {
          const reserve = candidate.amount.magnitude / n.reading.multiplier;
          quoteEnd = candidate.amount.index + candidate.amount.matchedText.length;
          const alternative = value - reserve; const figure = limitFigure(alternative, n.unit);
          result.reserve = { amount: reserve, alternative, label: `Use ${figure}`, message: `Use ${figure} instead.`,
            detail: `You said you'd keep ${limitFigure(reserve, n.unit)} back. Use ${figure} instead?` };
        }
      }
      const boundEnd = originalAt[quoteEnd - 1]! + 1;
      if (originalAt[a.index + a.matchedText.length - 1]! + 1 - boundStart > 200) return null;
      const quoteStart = Math.max(0, boundStart - Math.floor((200 - (boundEnd - boundStart)) / 2));
      result.source_quote = original.slice(quoteStart, quoteStart + 200);
      return result;
    }
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
