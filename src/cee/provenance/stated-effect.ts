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

function unitsAt(quote: string, amount: StatedAmount): readonly string[] {
  if (amount.kind === "percent") return ["%"];
  if (amount.kind === "currency") {
    const currency = currencyToken(amount.matchedText);
    if (currency === undefined) return [];
    const tail = quote.slice(amount.index + amount.matchedText.length);
    const period = /^\s*(?:(?:a|per)\s+)?(month|months|mo|monthly|year|years|yr|yearly)\b/iu.exec(tail)?.[1];
    return [period === undefined ? currency : `${currency}/${PERIOD_WORDS[period.toLowerCase()]!}`];
  }
  const words = quote.slice(amount.index + amount.matchedText.length)
    .match(/^\s+((?:[A-Za-z][A-Za-z-]*\s*){1,3})/u)?.[1]
    .trim()
    .split(/\s+/u)
    .map((word) => word.toLowerCase()) ?? [];
  return words.flatMap((_, start) => words.slice(start).map((__, end) => words.slice(start, end + 1).join(" ")));
}

function locatedAmounts(quote: string): LocatedAmount[] {
  return findStatedAmounts(quote).flatMap((amount) => {
    const units = unitsAt(quote, amount);
    return units.length === 0 ? [] : [{ ...amount, units }];
  });
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
): LocatedAmount | undefined {
  const matches = amounts.filter((amount) => magnitudeMatches(Math.abs(value), amount)
    && amount.units.some((candidate) => sameUnit(unit, candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Validate, rather than extract, a typed natural effect against its quoted span.
 * The quote supplies no endpoints, signs, or values to the model: it can only
 * accept all four values already present on the typed record, with the quote's
 * own number formatting and units.
 */
export function statedEffectQuoteMatches(
  quote: string,
  detail: StatedEffectDetail,
): boolean {
  if (quote.trim().length === 0) return false;
  if (![detail.amount, detail.per_source_change].every((value) => Number.isFinite(value) && value !== 0)) return false;
  if (![detail.amount_unit, detail.per_source_change_unit].every((unit) => typeof unit === "string" && unit.trim().length > 0)) return false;
  const amounts = locatedAmounts(quote);
  const target = oneMatchingAmount(amounts, detail.amount, detail.amount_unit);
  const source = oneMatchingAmount(amounts, detail.per_source_change, detail.per_source_change_unit);
  return target !== undefined && source !== undefined && target.index !== source.index;
}
