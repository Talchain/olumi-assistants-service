/** Deterministic number readings for link sizing; offsets always refer to the user's original words. */
import { findStatedAmounts, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';

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
/** Explicit percent levels state their difference, never a relative percent chosen by the Agent. */
export function linkEffectSourceLevels(quote: string): LinkEffectSourceLevels | undefined {
  const amounts = findLinkEffectAmounts(quote);
  const transitions = amounts.flatMap((a, i) => {
    const b = amounts[i + 1];
    if (b === undefined || a.kind !== 'percent' || b.kind !== 'percent'
      || !/\bfrom\s*$/i.test(quote.slice(0, a.index))
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
const fractionOfAFigure = new RegExp(`\\b(?:${FRACTION}|half)\\s+of\\s+(?:(?:a|an|the|our|your|its|their|that|this|those|these|each|every)\\s+)?`
  + `(?:[£$€]|\\d|(?:${CARDINAL_AMOUNT_SOURCE})\\b|${UNIT_WORD})`, 'iu');

/** Ranges cannot license either endpoint or a midpoint as a single user's figure. */
export function hasLinkEffectRange(quote: string): boolean {
  if (fractionOfANumber.test(quote) || fractionOfAUnit.test(quote) || fractionOfAFigure.test(quote)
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
