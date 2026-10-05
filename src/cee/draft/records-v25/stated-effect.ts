import { findStatedAmounts, readUnit, type StatedAmount } from "../../provenance/stated-amounts.js";
import { sameUnit } from "./same-unit.js";

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
  return words.flatMap((_, start) => words.slice(start).map((__, end) => words.slice(start, end + 1).join(" ")));
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
  const matches = amounts.filter((amount) => (amount.implicitSource === true ? source && value === 1 : magnitudeMatches(Math.abs(value), amount))
    && amount.units.some((candidate) => sameUnit(unit, candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Validate, rather than extract, a typed natural effect against its quoted span.
 * The quote supplies no endpoints, signs or target values to the model. It
 * validates the four typed fields using located numerals and units; a counting
 * determiner can locate exactly one source unit.
 */
export function statedEffectQuoteMatches(
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
