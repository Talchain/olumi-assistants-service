import type { DraftQuoteSpan, DraftStatedRelationship } from "../draft/records/grammar.js";
import { findStatedAmounts, readUnit, type StatedAmount } from "./stated-amounts.js";
import { sameUnit } from "../../orchestrator-v5/agent-lane/same-unit.js";

export interface StatedEffectDetail {
  readonly amount: number;
  readonly amount_unit: string;
  readonly per_source_change: number;
  readonly per_source_change_unit: string;
}

interface LocatedAmount extends StatedAmount {
  readonly units: readonly string[];
  readonly implicitSource?: true;
}

const PERIOD_WORDS: Readonly<Record<string, string>> = {
  month: "month",
  months: "month",
  mo: "month",
  monthly: "month",
  year: "year",
  years: "year",
  yr: "year",
  yearly: "year",
};

function currencyToken(matchedText: string): string | undefined {
  const token = matchedText.match(/(?:A\$|C\$|NZ\$|[£$€¥₹]|CHF|kr)/iu)?.[0];
  return token;
}

function nounUnitsAt(tail: string): readonly string[] {
  const words = tail.match(/^\s+((?:[A-Za-z][A-Za-z-]*\s*){1,3})/u)?.[1]
    .trim()
    .split(/\s+/u)
    .map((word) => word.toLowerCase()) ?? [];
  return words.flatMap((_, start) => words.slice(start).map((__, end) => words.slice(start, start + end + 1).join(" ")));
}

function unitsAt(quote: string, amount: StatedAmount): readonly string[] {
  if (amount.kind === "percent") return ["%"];
  if (amount.kind === "currency") {
    const currency = currencyToken(amount.matchedText);
    if (currency === undefined) return [];
    const tail = quote.slice(amount.index + amount.matchedText.length);
    const period = /^\s*(?:(?:a|per)\s+)?(month|months|mo|monthly|year|years|yr|yearly)\b/iu.exec(tail)?.[1];
    return [period === undefined ? currency : `${currency}/${PERIOD_WORDS[period.toLowerCase()]!}`];
  }
  return nounUnitsAt(quote.slice(amount.index + amount.matchedText.length));
}

function locatedAmounts(quote: string): LocatedAmount[] {
  const amounts: LocatedAmount[] = findStatedAmounts(quote).flatMap((amount) => {
    const units = unitsAt(quote, amount);
    return units.length === 0 ? [] : [{ ...amount, units }];
  });
  // A counting determiner locates ONE source unit. It contributes no target
  // value, endpoint or sign, and explicit numerals still use the collector above.
  for (const match of quote.matchAll(/\b(?:each|every|per)\b(?=\s+[A-Za-z])/giu)) {
    const units = nounUnitsAt(quote.slice(match.index + match[0].length));
    if (units.length === 0) continue;
    amounts.push({ magnitude: 1, kind: "plain", matchedText: match[0], index: match.index, units, implicitSource: true });
  }
  return amounts;
}

function magnitudeMatches(expected: number, amount: StatedAmount): boolean {
  const reading = readUnit(amount.matchedText);
  return expected === amount.magnitude * reading.multiplier
    || Math.abs(expected - amount.magnitude * reading.multiplier)
      <= Math.max(Math.abs(expected), Math.abs(amount.magnitude * reading.multiplier), 1) * 1e-9;
}

function oneMatchingAmount(
  amounts: readonly LocatedAmount[],
  value: number,
  unit: string,
  source: boolean,
): LocatedAmount | undefined {
  const matches = amounts.filter((amount) => (amount.implicitSource === true ? source && Math.abs(value) === 1 : magnitudeMatches(Math.abs(value), amount))
    && amount.units.some((candidate) => sameUnit(unit, candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Validate, rather than extract, a typed natural effect against its quoted span.
 * The quote supplies no endpoints, signs or target values to the model. It
 * validates the four typed fields using located numerals and units; a counting
 * determiner can locate exactly one source unit.
 */
export function statedEffectFiguresMatch(
  quote: string,
  detail: StatedEffectDetail,
): boolean {
  if (quote.trim().length === 0) return false;
  if (![detail.amount, detail.per_source_change].every((value) => Number.isFinite(value) && value !== 0)) return false;
  if (![detail.amount_unit, detail.per_source_change_unit].every((unit) => typeof unit === "string" && unit.trim().length > 0)) return false;
  const amounts = locatedAmounts(quote);
  const target = oneMatchingAmount(amounts, detail.amount, detail.amount_unit, false);
  const source = oneMatchingAmount(amounts, detail.per_source_change, detail.per_source_change_unit, true);
  return target !== undefined && source !== undefined && target.index !== source.index;
}

function atSpan(amount: LocatedAmount, span: DraftQuoteSpan, quote: string): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end)
    && span.start >= 0 && span.end <= quote.length && span.start < span.end
    && amount.index >= span.start && amount.index + amount.matchedText.length <= span.end;
}

/** Figures alone cannot attest a signed relationship. The stated cause owns it. */
export function statedEffectQuoteMatches(
  quote: string,
  detail: StatedEffectDetail,
  authority?: DraftStatedRelationship,
): boolean {
  if (authority === undefined || authority.amount_span === undefined || authority.source_span === undefined || !statedEffectFiguresMatch(quote, detail)) return false;
  if (authority.amount !== detail.amount || authority.per_source_change !== detail.per_source_change
    || !sameUnit(authority.amount_unit, detail.amount_unit)
    || !sameUnit(authority.per_source_change_unit, detail.per_source_change_unit)) return false;
  const amounts = locatedAmounts(quote);
  const target = oneMatchingAmount(amounts, detail.amount, detail.amount_unit, false);
  const source = oneMatchingAmount(amounts, detail.per_source_change, detail.per_source_change_unit, true);
  if (target === undefined || source === undefined
    || !atSpan(target, authority.amount_span, quote) || !atSpan(source, authority.source_span, quote)) return false;
  // The two typed amount spans must be in one relationship clause. Punctuation
  // supplies no sign, value or endpoint; it only refuses cross-sentence evidence.
  const left = Math.min(authority.amount_span.end, authority.source_span.end);
  const right = Math.max(authority.amount_span.start, authority.source_span.start);
  const between = quote.slice(left, right);
  return ![".", "!", "?", ";"].some(delimiter => between.includes(delimiter));
}

/** Runtime read-back of signed evidence; malformed legacy/persisted evidence earns no authority. */
export function readStatedRelationship(value: unknown): DraftStatedRelationship | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const span = (raw: unknown): DraftQuoteSpan | undefined => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const s = raw as Record<string, unknown>;
    return typeof s.start === "number" && Number.isInteger(s.start) && s.start >= 0
      && typeof s.end === "number" && Number.isInteger(s.end) && s.end > s.start ? { start: s.start, end: s.end } : undefined;
  };
  const amount_span = span(v.amount_span), source_span = span(v.source_span);
  if (typeof v.from_quantity !== "number" || !Number.isInteger(v.from_quantity) || v.from_quantity < 0
    || typeof v.to_quantity !== "number" || !Number.isInteger(v.to_quantity) || v.to_quantity < 0
    || typeof v.amount !== "number" || !Number.isFinite(v.amount)
    || typeof v.per_source_change !== "number" || !Number.isFinite(v.per_source_change)
    || typeof v.amount_unit !== "string" || typeof v.per_source_change_unit !== "string"
    || amount_span === undefined || source_span === undefined) return undefined;
  return { from_quantity: v.from_quantity, to_quantity: v.to_quantity, amount: v.amount, amount_unit: v.amount_unit,
    per_source_change: v.per_source_change, per_source_change_unit: v.per_source_change_unit, amount_span, source_span };
}
