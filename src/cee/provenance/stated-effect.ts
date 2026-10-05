import { findStatedAmounts, readUnit, type StatedAmount } from "./stated-amounts.js";
import {
  carrierCompatible,
  nounUnitsAt,
  readUnitParts,
  sameUnit,
  statedTailParts,
  unitsAt,
} from "../../orchestrator-v5/agent-lane/same-unit.js";

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

// ⭐ The tail reader that used to live here (`unitsAt`, `nounUnitsAt`, a private month/year `PERIOD_WORDS`) moved into
// `same-unit.ts` (Science U-GRAMMAR G0, PR-U1): ONE source-located reader over the ONE vocabulary leaf, so "£75,000
// annually", "/year", "per annum" and "p.a." read as a year here exactly as a declared unit does.

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
 * Every place in `text` that states this TARGET figure, by C3 (carrier-compatible, Science U-GRAMMAR G2): the written
 * figure equals |amount| × the declared unit's SCALE ("£k/year" holding −75 is £75,000: FA-R1), the kinds and currency
 * agree, and no part both sides state conflicts ("£75,000 a month" never binds a GBP/year edge; a part only one side
 * states is no conflict). A caller with no quote uses this to find WHICH written figure an edge holds; more than one
 * place means it cannot say.
 */
export function statedTargetAmountSpans(
  text: string,
  amount: number,
  amountUnit: string,
): { readonly start: number; readonly end: number }[] {
  if (!Number.isFinite(amount) || amount === 0 || amountUnit.trim().length === 0) return [];
  const declared = readUnitParts(amountUnit);
  if (declared === null) return [];
  const expected = Math.abs(amount) * declared.scale;
  return locatedAmounts(text)
    .filter((located) => located.implicitSource !== true
      && magnitudeMatches(expected, located)
      && (() => {
        // Every part the user STATED after the figure (Codex r1, P1): nothing they wrote is dropped before C3 looks.
        const stated = statedTailParts(text, located);
        return stated !== null && carrierCompatible(stated, declared);
      })())
    .map((located) => ({ start: located.index, end: located.index + located.matchedText.length }));
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
