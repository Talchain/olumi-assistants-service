/**
 * ⭐ THE GOAL'S UNIT, AS A READING WITH ITS AUTHOR (`@talchain/schemas` 0.67.0 `NodeV3Schema.unit_reading`, MG; PTL A;
 * proposal P0 SHARED DATA #75 5914707462; meaning AIQ 5914471584 / 5914731075).
 *
 * Paul's funding brief never states a funding target, but it speaks of "investment firms that do deals between £1-2m", so Olumi reads the funding goal in GBP. Until 0.67.0 nothing could say that the unit is OLUMI'S reading and
 * not a figure the user gave, so a goal typed in £ read as the user's own unit.
 *
 * - `user_stated`: the brief writes the goal's own target in that currency ("MRR above £85k") — the quote is that amount.
 * - `olumi_reading`: the brief writes amounts in that currency, but not the goal's target — the quote is the first one.
 * - nothing: the goal's unit is not money, or the brief writes no amount in it (no span can ground a reading).
 *
 * ⛔ A unit is a READING, never a figure: the carrier holds no value, level, target or cap, and on its own it never
 * makes a goal target-testable. No Olumi reading ever travels as `user_stated` (AIQ's producer row).
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

export interface GoalUnitReading {
  readonly unit: string;
  readonly source: 'olumi_reading' | 'user_stated';
  readonly source_quote: string;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The brief's own sentence around a written amount, verbatim: an exact span that says what the amount is about. The
 * bare match is not enough — "deals between £1-2m" is read as "£1" (the range reader's known fragment), which
 * grounds nothing a person could check.
 */
function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '), before.lastIndexOf('\n'));
  const tail = text.slice(index + length);
  const endRel = tail.search(/[.?!](\s|$)|\n/);
  const end = endRel === -1 ? text.length : index + length + endRel;
  const span = text.slice(start === -1 ? 0 : start + 1, end).trim();
  return span.length <= 500 ? span : text.slice(index, index + length).trim();
}

export function goalUnitReading(
  goal: { readonly unit?: unknown; readonly value?: unknown; readonly target_stated?: unknown } | null | undefined,
  brief: string,
): GoalUnitReading | undefined {
  const unit = typeof goal?.unit === 'string' ? goal.unit.trim() : '';
  if (unit === '') return undefined;
  const read = readCurrencyUnitWithQualifiers(unit);
  if (read.kind !== 'currency' || typeof read.currencyCode !== 'string') return undefined;
  const code = read.currencyCode;
  const written = findStatedAmounts(brief).filter((a) => a.kind === 'currency' && a.currencyCode === code && a.matchedText.trim() !== '');
  if (written.length === 0) return undefined;
  const target = goal?.target_stated === true && typeof goal.value === 'number' && Number.isFinite(goal.value)
    ? written.find((a) => same(a.magnitude, (goal.value as number) * (read.multiplier ?? 1)))
    : undefined;
  const quote = (a: (typeof written)[number]): string => sentenceAround(brief, a.index, a.matchedText.length);
  return target !== undefined
    ? { unit: code, source: 'user_stated', source_quote: quote(target) }
    : { unit: code, source: 'olumi_reading', source_quote: quote(written[0]!) };
}
