/** Deterministic number readings for link sizing; offsets always refer to the user's original words. */
import { findStatedAmounts, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';

/** Shared with the statement binder: a figure followed by one of these words describes a change. */
export const LINK_EFFECT_CHANGE_AFTER = /^\s*(?:(?:percentage\s+)?points?\s+)?(?:rises?|increases?|cuts?|drops?|falls?|jumps?|hikes?|reductions?|decreases?|gains?|loss|more|fewer|less|extra|additional|higher|lower|up|down|off|changes?|swings?)\b/i;

function normalised(quote: string): { text: string; starts: number[]; ends: number[] } {
  const re = new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})(?:\\s+and\\s+a\\s+half)?\\b|\\bhalf(?:\\s+a)?(?=\\s+(?:percentage\\s+)?points?\\b)|\\ba(?=\\s+(?:percentage\\s+)?points?\\b)`, 'giu');
  let text = ''; const starts: number[] = []; const ends: number[] = [];
  const append = (value: string, start: number, end: number, literal = false): void => {
    text += value;
    for (let i = 0; i < value.length; i++) { starts.push(literal ? start + i : start); ends.push(literal ? start + i + 1 : end); }
  };
  let at = 0;
  for (const m of quote.matchAll(re)) {
    const start = m.index!;
    append(quote.slice(at, start), at, start, true);
    const half = /\s+and\s+a\s+half$/i.test(m[0]);
    const base = half ? m[0].replace(/\s+and\s+a\s+half$/i, '') : m[0];
    const value = /^half(?:\s+a)?$/i.test(base) ? 0.5 : base.toLowerCase() === 'a' ? 1 : parseCardinalAmount(base);
    // Unknown fractions are never admitted as the integer fragment ("one and a quarter").
    const unclear = !half && /^\s+and\s+(?:a\s+)?(?:half|quarter|third)\b/i.test(quote.slice(start + m[0].length));
    append(value === null || value === undefined || unclear ? m[0] : String(value + (half ? 0.5 : 0)), start, start + m[0].length);
    at = start + m[0].length;
  }
  append(quote.slice(at), at, quote.length, true);
  return { text, starts, ends };
}

export function findLinkEffectAmounts(quote: string): readonly StatedAmount[] {
  const n = normalised(quote);
  return findStatedAmounts(n.text, { isoCurrencyCodes: true }).map(a => {
    const start = n.starts[a.index]!; const end = n.ends[a.index + a.matchedText.length - 1]!;
    return { ...a, index: start, matchedText: quote.slice(start, end) };
  });
}

export interface LinkEffectSourceLevels {
  readonly from: number;
  readonly to: number;
  readonly change: number;
  readonly quote: string;
  readonly unit: 'percentage points';
  readonly from_index: number;
  readonly end_index: number;
}
/**
 * Explicit percent levels state their difference, never a relative percent chosen by the Agent. They are the SOURCE's
 * levels only when the clause opening them names the source ("Halving waste from 8% to 4%"); "… and gross margin moves
 * from 20% to 25%" is another quantity's transition and never settles, or appears as, the source's change (Codex r1 HIGH).
 */
export function linkEffectSourceLevels(quote: string, namesSource: (word: string) => boolean): LinkEffectSourceLevels | undefined {
  const amounts = findLinkEffectAmounts(quote);
  const opensWithSource = (before: string): boolean => {
    const clause = before.split(/[,;:.!?\n]|\b(?:and|while|whereas|but|so|then|when|if|as)\b/i).pop() ?? '';
    return [...clause.matchAll(/[\p{L}]+/gu)].some(m => namesSource(m[0]));
  };
  const transitions = amounts.flatMap((a, i) => {
    const b = amounts[i + 1];
    if (b === undefined || a.kind !== 'percent' || b.kind !== 'percent'
      || !/\bfrom\s*$/i.test(quote.slice(0, a.index))
      || !opensWithSource(quote.slice(0, a.index).replace(/\bfrom\s*$/i, ''))
      || !/^\s+to\s+$/i.test(quote.slice(a.index + a.matchedText.length, b.index))) return [];
    return [{ from: a.magnitude, to: b.magnitude, change: b.magnitude - a.magnitude,
      quote: quote.slice(a.index, b.index + b.matchedText.length), unit: 'percentage points' as const,
      from_index: a.index, end_index: b.index + b.matchedText.length }];
  });
  return transitions.length === 1 ? transitions[0] : undefined;
}

/**
 * A fraction word is unclear only where it can change a written figure: right after a number ("two thirds"), right before
 * a unit ("a quarter point"), or OF a figure ("a third of 6 points", "half of £300", "a third of a percentage point"). A
 * ratio beside two written figures ("A third of any flour price rise comes off our margin, so an 18% rise costs us about
 * 6 points") puts no fraction on the card; staging cards that sentence today (Acceptance corpus row 6, replay @147c6630).
 */
const FRACTION = '(?:thirds?|quarters?|halves)';
const UNIT_WORD = '(?:percentage\\s+)?(?:points?|pp|percent|per\\s+cent)\\b';
const fractionOfANumber = new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE}|\\d+(?:\\.\\d+)?)\\s+${FRACTION}\\b`, 'iu');
const fractionOfAUnit = new RegExp(`\\b${FRACTION}\\s+${UNIT_WORD}`, 'iu');
// "2 and a half points", "2½": the normaliser reads "and a half" only after a number WORD; after digits, or as a
// vulgar fraction, the scanner would keep only the integer (Codex buddy r1 HIGH).
const digitsAndAFraction = /\d(?:\s+and\s+(?:a\s+|one\s+)?(?:half|halves|thirds?|quarters?)\b|\s*[\u00BC-\u00BE\u2150-\u215E])/iu;
const fractionOfAFigure = new RegExp(`\\b(?:${FRACTION}|half)\\s+of\\s+(?:(?:a|an|the|our|your|its|their|that|this|those|these|each|every)\\s+)?`
  + `(?:[£$€]|\\d|(?:${CARDINAL_AMOUNT_SOURCE})\\b|${UNIT_WORD})`, 'iu');

/** Ranges cannot license either endpoint or a midpoint as a single user's figure. */
export function hasLinkEffectRange(quote: string): boolean {
  if (boundedLinkEffectText(quote) !== undefined) return true;
  if (fractionOfANumber.test(quote) || fractionOfAUnit.test(quote) || fractionOfAFigure.test(quote) || digitsAndAFraction.test(quote)
    || new RegExp(`\\bpoint\\s+(?:${CARDINAL_AMOUNT_SOURCE}|\\d)\\b`, 'iu').test(quote)) return true;
  const amounts = findLinkEffectAmounts(quote);
  return amounts.some((a, i) => {
    const b = amounts[i + 1];
    if (b === undefined) return false;
    const between = quote.slice(a.index + a.matchedText.length, b.index);
    return /^\s*(?:,?\s*(?:maybe|or)|[-–—]|to)\s*$/i.test(between) && !/\bfrom\s*$/i.test(quote.slice(0, a.index))
      || /^\s*and\s*$/i.test(between) && /\bbetween\s*$/i.test(quote.slice(0, a.index));
  });
}

export interface LinkEffectBound {
  readonly direction: 'lower' | 'upper';
  readonly inclusive: boolean;
  readonly amount: StatedAmount;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Only the comparator words, allowing a source-warrant check without changing either figure or its units. */
  readonly comparator_start: number;
  readonly comparator_end: number;
}

// One vocabulary for every link-size reader. Prefix and suffix forms remain attached to their particular amount.
const LOWER_BOUND_WORDS = 'at least|no less than|no fewer than|at minimum|(?:a |the )?minimum(?: of)?|upwards? of|more than|over|above';
const UPPER_BOUND_WORDS = 'at most|no more than|no greater than|no higher than|no larger than|at maximum|(?:a |the )?maximum(?: of)?|up to|less than|under|below';
const BOUND_BEFORE = new RegExp(`\\b(${LOWER_BOUND_WORDS}|${UPPER_BOUND_WORDS})\\s+`
  + '(?:(?:increase|decrease|rise|fall|change|by|about|around|roughly|approximately|a|an)\\s+)*[+−-]?\\s*$', 'i');
const LOWER_BOUND = new RegExp(`^(?:${LOWER_BOUND_WORDS})$`, 'i');
const STRICT_BOUND = /^(?:more than|over|above|less than|under|below)$/i;
// Units may be a short count or currency-period phrase; punctuation or a second figure cannot be crossed.
const BOUND_AFTER = /^\s*(?:[\p{L}]+(?:\/[\p{L}]+)?\s+){0,5}(or\s+(?:more|less|fewer))\b/iu;
const CHANGE_WORDS = /\b(?:increas(?:e|es|ing|ed)|decreas(?:e|es|ing|ed)|rais(?:e|es|ing|ed)|ris(?:e|es|ing)|fall(?:s|ing)?|fell|cut(?:s|ting)?|drop(?:s|ped|ping)?|add(?:s|ed|ing)?|los(?:e|es|ing|t)|reduce(?:s|d)?|gain(?:s|ed)?|change(?:s|d)?)\b/i;

/**
 * All one-sided bounds attached to stated figures. By default only a CHANGE is returned, so a bounded current level
 * elsewhere cannot turn a separate definite effect into a range. Context classification also reads level comparators:
 * the "no" in "no less than 30%" is a bound rather than a denial.
 */
export function findLinkEffectBounds(quote: string, options?: { readonly changesOnly?: boolean }): readonly LinkEffectBound[] {
  return findLinkEffectAmounts(quote).flatMap(amount => {
    const amountEnd = amount.index + amount.matchedText.length;
    const before = quote.slice(0, amount.index);
    const after = quote.slice(amountEnd);
    const prefix = BOUND_BEFORE.exec(before);
    const suffix = BOUND_AFTER.exec(after);
    if (prefix === null && suffix === null) return [];
    const start = prefix?.index ?? amount.index;
    // The amount scanner omits a leading sign; it belongs to this figure, not the words proving it is a change.
    const lead = (before.slice(0, prefix?.index ?? amount.index).split(/[,;.!?\n]/).at(-1) ?? '').replace(/[+−-]\s*$/, '');
    const changes = prefix !== null && CHANGE_WORDS.test(prefix[0])
      || /(?:\bby|\bevery|\beach|\bper)\s*$/i.test(lead)
      || CHANGE_WORDS.test(lead.match(/(?:[\p{L}]+\s*){1,3}$/u)?.[0] ?? '')
      || LINK_EFFECT_CHANGE_AFTER.test(after);
    if (options?.changesOnly !== false && !changes) return [];
    const found: LinkEffectBound[] = [];
    if (prefix !== null) {
      found.push({ direction: LOWER_BOUND.test(prefix[1]!) ? 'lower' : 'upper', inclusive: !STRICT_BOUND.test(prefix[1]!), amount,
        text: quote.slice(start, amountEnd).trim(), start, end: amountEnd,
        comparator_start: start, comparator_end: start + prefix[1]!.length });
    }
    if (suffix !== null) {
      const comparatorStart = amountEnd + suffix[0].lastIndexOf(suffix[1]!);
      const end = comparatorStart + suffix[1]!.length;
      found.push({ direction: /^or\s+more$/i.test(suffix[1]!) ? 'lower' : 'upper', inclusive: true, amount,
        text: quote.slice(amount.index, end).trim(), start: amount.index, end,
        comparator_start: comparatorStart, comparator_end: end });
    }
    return found;
  });
}

/** Attached bound words are not denials; stripping them never supplies a point estimate. */
export function withoutLinkEffectBoundComparators(quote: string): string {
  const spans = findLinkEffectBounds(quote, { changesOnly: false })
    .map(bound => ({ start: bound.comparator_start, end: bound.comparator_end }))
    .sort((a, b) => b.start - a.start);
  return spans.reduce((text, span) => text.slice(0, span.start) + ' '.repeat(span.end - span.start) + text.slice(span.end), quote);
}

/** A one-sided change bound, never a bounded current level elsewhere in the sentence. */
export function boundedLinkEffectText(quote: string): string | undefined {
  return findLinkEffectBounds(quote)[0]?.text;
}
