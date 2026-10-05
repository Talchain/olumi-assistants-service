import { periodIn, sameUnit } from '../../../orchestrator-v5/agent-lane/same-unit.js';
import { findStatedAmounts, readUnit, readCurrencyUnitWithQualifiers } from '../../provenance/stated-amounts.js';
import type { DraftQuoteSpan, DraftValueRange, DraftStatedItem } from './grammar.js';

function boundMatches(quote: string, span: DraftQuoteSpan, value: number, unit?: string): boolean {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
    || span.start < 0 || span.end > quote.length || span.start >= span.end) return false;
  const slice = quote.slice(span.start, span.end);
  const amounts = findStatedAmounts(slice);
  const reading = readCurrencyUnitWithQualifiers(unit);
  if (amounts[0]?.kind === 'currency' && (reading.kind !== 'currency' || amounts[0].currencyCode !== reading.currencyCode)) return false;
  if (reading.kind === 'currency' && amounts[0]?.kind !== 'currency') return false;
  return amounts.length === 1 && amounts[0]!.index === 0 && amounts[0]!.matchedText.length === slice.length
    && amounts[0]!.magnitude * readUnit(slice).multiplier === value;
}

/** A typed range is checked, never inferred from wording or borrowed from a neighbour. */
export function admittedValueRange(range: DraftValueRange | undefined, quote: string, value: number, unit: string | undefined): DraftValueRange | undefined {
  if (range === undefined || range.low_span === undefined || range.high_span === undefined || unit === undefined || !sameUnit(range.unit, unit)
    || ![range.low, range.high, value].every(Number.isFinite)
    || range.low > value || value > range.high || range.low >= range.high
    || range.low_span.end > range.high_span.start
    || !boundMatches(quote, range.low_span, range.low, range.unit) || !boundMatches(quote, range.high_span, range.high, range.unit)) return undefined;
  return range;
}

/** Evidence-bound typed value. Unit text validates the declared unit; it never supplies a field. */
export function statedValueIsBound(item: DraftStatedItem, brief: string | undefined): boolean {
  const { value, unit, source_quote: quote, value_span, unit_span } = item;
  if (typeof brief !== 'string' || !brief.includes(quote) || quote.length === 0 || value === undefined
    || unit === undefined || value_span === undefined || unit_span === undefined
    || !boundMatches(quote, value_span, value, unit)
    || unit_span.start < 0 || unit_span.end > quote.length || unit_span.start >= unit_span.end) return false;
  const unitText = quote.slice(unit_span.start, unit_span.end);
  const reading = readCurrencyUnitWithQualifiers(unit);
  if (reading.kind === 'currency') return periodIn(unit) === periodIn(unitText);
  return sameUnit(unit, unitText);
}
