/**
 * ⭐ ONE AUTHORITY for the sentence "…and here is the kind of value I need".
 *
 * JOURNEY-WITNESSED DEFECT (staging UI `88cb7e37` / CEE `4e88390`): on a
 * UNITLESS 0-1 quality factor ("Rep Adoption Quality"), the product's own
 * "Best next step" asked the user to set a value, then refused every attempt
 * and closed with *"Please tell me the number you want, for example
 * £100,000."* A CURRENCY example, offered for a factor the same paragraph had
 * just described as having no unit.
 *
 * Root cause was not one bad string: FOUR composer branches each spelled
 * their own example inline, and every one of them hardcoded `£100,000`
 * regardless of what the factor measures. That is the hand-maintained-mirror
 * defect at the top of `CLAUDE.md` wearing copy's clothes, so the fix is a
 * single derived authority rather than a fifth variant.
 *
 * THE RULES THIS MODULE ENFORCES:
 *
 *  1. An example is only ever drawn from the factor's OWN unit family. The
 *     family comes from `unitFamilyOf` (`value-unit-resolution.ts`), the
 *     vocabulary the misroute containment already maintains, so this is not a
 *     second list that can drift from the first (trap 12).
 *
 *  2. ⭐ WHEN THE SCALE IS NOT KNOWN, THERE IS NO EXAMPLE. Every entry point
 *     returns `null` rather than falling back to a currency. A fabricated
 *     example is worse than no example: it tells the user their input was the
 *     wrong SHAPE when the blocker was something else entirely, so they
 *     retype numbers that keep failing (this is exactly what the witness
 *     recorded). `null` is the honest answer and callers must render the ask
 *     without an example, never substitute one.
 *
 *  3. ⚠ NO 0-1 CLAIM FOR A FACTOR VALUE. The working option-effect chip says
 *     *"a number from 0 (this option does nothing to it) to 1 (this option
 *     drives it fully)"* and that copy is correct THERE, because an option's
 *     effect on a factor is a normalised edge weight bounded by contract. A
 *     unitless FACTOR VALUE is not: `evaluate-factor-value-proposal.ts`
 *     states, at the bytes, that bounding a normalised factor "needs a
 *     DECLARED scale on the contract" and that "an uncapped unitless factor
 *     is left exactly as unbounded as it is today". Asserting 0-1 here would
 *     replace a false currency claim with a false range claim. Unitless
 *     factors therefore get `UNITLESS_VALUE_SCALE_PHRASE`, which points at
 *     the factor's own scale without inventing a bound.
 */

import { unitFamilyOf, type UnitFamily } from '../routing/value-unit-resolution.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../cee/extraction/numeric-parser.js';

/**
 * The scale phrase for a factor PROVABLY recorded without a unit. Deliberately
 * makes no claim about a range (see rule 3 above) — it only tells the user
 * which scale to answer on.
 */
export const UNITLESS_VALUE_SCALE_PHRASE = 'on the same scale the factor already uses' as const;

/**
 * ⭐ DERIVED, NOT MIRRORED (trap 12, and caught by this repo's own
 * `currency-vocabulary.union` guard when the first draft of this file spelled
 * its own three-symbol set). Whether a symbol is a renderable currency is
 * asked of THE canonical vocabulary — `CURRENCY_SYMBOL_TO_CODE` in
 * `cee/extraction/numeric-parser.ts`, the same list the provenance locator
 * derives from. A second hand-written currency list here would drift, and a
 * symbol missing from the copy would silently render the wrong currency to a
 * user. This module only READS that constant; it owns nothing in `cee/`.
 */
function isKnownCurrencySymbol(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, symbol);
}

/** Fallback when the family is currency but the symbol is unknown/absent. */
const DEFAULT_CURRENCY_SYMBOL = '£';

/**
 * An example value for a factor whose unit FAMILY is known.
 *
 * `unit` is the short symbol the validator threads ('£', '%', 'people') when
 * it has one; family-only callers (e.g. `VALUE_UNIT_UNRESOLVED`, which threads
 * `factor_unit_family` and no symbol) may omit it.
 *
 * Returns `null` when no example can be drawn honestly — the caller must then
 * render its ask WITHOUT an example.
 */
export function valueExampleForFamily(
  family: UnitFamily | null | undefined,
  unit?: string,
): string | null {
  if (family === null || family === undefined) return null;
  const symbol = unit?.trim();
  switch (family) {
    case 'currency': {
      const rendered =
        symbol !== undefined && isKnownCurrencySymbol(symbol)
          ? symbol
          : DEFAULT_CURRENCY_SYMBOL;
      return `${rendered}100,000`;
    }
    case 'percent':
      return '25%';
    case 'time':
      return symbol !== undefined && symbol.length > 0 ? `12 ${symbol}` : '12 months';
    case 'count':
    case 'metric':
      // No generic magnitude is meaningful without the unit word itself
      // ("for example 50" tells the user nothing), so stay silent when the
      // symbol is absent rather than invent one.
      return symbol !== undefined && symbol.length > 0 ? `50 ${symbol}` : null;
    default: {
      // Exhaustiveness: a new UnitFamily must be given an example (or an
      // explicit null) here rather than silently inheriting a currency.
      const never: never = family;
      void never;
      return null;
    }
  }
}

/**
 * An example value for a factor whose unit SYMBOL is known. Returns `null` for
 * an absent, empty or unclassifiable unit — the two cases that used to fall
 * through to `£100,000`.
 */
export function valueExampleForUnit(unit: string | undefined): string | null {
  if (unit === undefined) return null;
  const trimmed = unit.trim();
  if (trimmed.length === 0) return null;
  return valueExampleForFamily(unitFamilyOf(trimmed), trimmed);
}

/**
 * The full "how to answer" clause for an ask, ready to interpolate.
 *
 * Known scale  -> `", for example £100,000,"` (leading comma, trailing comma)
 * Unknown/none -> `""`, so the caller's sentence closes up cleanly.
 */
export function exampleClause(example: string | null): string {
  return example === null ? '' : `, for example ${example},`;
}
