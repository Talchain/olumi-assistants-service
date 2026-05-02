/**
 * Decision-language confirmation formatters for D1 handlers.
 *
 * Rules per correction #5:
 *   - Percentages: no space before "%".  "5%" not "5 %".
 *   - Currency: no space between symbol and number. "£50,000" not "£ 50,000".
 *   - Other units: single space.          "12 months", "800 customers".
 *   - Edge strengths: never raw decimals — always influence-band words via
 *     `bandFromMagnitude` (already shared, do not duplicate).
 */

import {
  bandFromMagnitude,
  NEAR_ZERO_INFLUENCE_THRESHOLD,
} from '../../../format/influence-bands.js';

const NO_SPACE_UNITS = new Set(['%']);
const PREFIX_UNITS = new Set(['£', '$', '€', '¥']);

/**
 * Render a number with a unit suffix or prefix. Returns the bare number
 * (toString) when no unit is supplied. Numbers ≥ 1000 get thousands
 * separators (`Intl.NumberFormat('en-GB')`) so "£50000" displays as
 * "£50,000".
 */
export function formatValueWithUnit(value: number, unit?: string): string {
  const numStr = formatNumber(value);
  if (!unit) return numStr;
  if (NO_SPACE_UNITS.has(unit)) return `${numStr}${unit}`;
  if (PREFIX_UNITS.has(unit)) return `${unit}${numStr}`;
  return `${numStr} ${unit}`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Trim trailing zeros after up to 4 decimal places so 0.05 stays "0.05"
  // rather than "0.0500" but 5 stays "5".
  const fixed = Math.abs(n) >= 1000
    ? new Intl.NumberFormat('en-GB').format(n)
    : Number.isInteger(n)
      ? n.toString()
      : n.toFixed(4).replace(/\.?0+$/, '');
  return fixed;
}

export interface FactorChangeInput {
  readonly label: string;
  readonly before: { readonly raw_value: number; readonly unit?: string };
  readonly after: { readonly raw_value: number; readonly unit?: string };
}

export function formatFactorChange(input: FactorChangeInput): string {
  const before = formatValueWithUnit(input.before.raw_value, input.before.unit);
  const after = formatValueWithUnit(input.after.raw_value, input.after.unit);
  return `Updated ${input.label} from ${before} to ${after}.`;
}

export interface ConstraintAddedInput {
  readonly targetLabel: string;
  readonly operator: '>=' | '<=';
  readonly value: number;
  readonly unit?: string;
}

const OPERATOR_PHRASE: Record<'>=' | '<=', string> = {
  '>=': 'at least',
  '<=': 'at most',
};

export function formatConstraintAdded(input: ConstraintAddedInput): string {
  const phrase = OPERATOR_PHRASE[input.operator];
  const value = formatValueWithUnit(input.value, input.unit);
  return `Added constraint: ${input.targetLabel} must be ${phrase} ${value}.`;
}

export function formatConstraintUpdated(input: ConstraintAddedInput): string {
  const phrase = OPERATOR_PHRASE[input.operator];
  const value = formatValueWithUnit(input.value, input.unit);
  return `Updated constraint: ${input.targetLabel} must be ${phrase} ${value}.`;
}

export interface EdgeAdjustmentInput {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly beforeMean: number;
  readonly afterMean: number;
}

/**
 * Decision-language edge adjustment confirmation. Uses `bandFromMagnitude`
 * for strength and surfaces direction reversal explicitly. Never emits
 * the raw mean.
 */
export function formatEdgeAdjustment(input: EdgeAdjustmentInput): string {
  const beforeBand = describeBandWithDirection(input.beforeMean);
  const afterBand = describeBandWithDirection(input.afterMean);

  const directionFlipped =
    Math.sign(input.beforeMean) !== 0 &&
    Math.sign(input.afterMean) !== 0 &&
    Math.sign(input.beforeMean) !== Math.sign(input.afterMean);

  const tail = directionFlipped
    ? ` Direction reversed: now ${input.afterMean < 0 ? 'negative' : 'positive'}.`
    : '';

  return `Adjusted the link between ${input.fromLabel} and ${input.toLabel} from ${beforeBand} to ${afterBand}.${tail}`;
}

function describeBandWithDirection(mean: number): string {
  const abs = Math.abs(mean);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'no material influence';
  const band = bandFromMagnitude(abs);
  return mean < 0 ? `${band} (negative)` : band;
}
