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
  return `${numStr} ${pluraliseUnit(unit, value)}`;
}

/**
 * Grammatically agree a space-separated unit with its count: singular form
 * when |value| === 1 ("1 month", not "1 months"); the supplied plural form
 * otherwise ("12 months", "0 months", "2 months").
 *
 * Conservative by design — only collapses a regular trailing "-s" on an
 * alphabetic unit of 4+ characters, and never for "-ss"/"-us"/"-is" endings
 * (e.g. "status", "analysis", "bonus") or abbreviations shorter than 4 chars
 * (e.g. "bps"). Symbol / no-space / prefix units never reach here (handled by
 * the caller). Irregular plurals (e.g. "people") are intentionally left
 * untouched: rare in the decision domain and better readable-but-imperfect
 * than mangled. Only the documented "1 months" → "1 month" class is fixed.
 */
function pluraliseUnit(unit: string, value: number): string {
  if (Math.abs(value) !== 1) return unit;
  if (/[a-z]{3,}s$/i.test(unit) && !/(?:ss|us|is)$/i.test(unit)) {
    return unit.replace(/s$/i, '');
  }
  return unit;
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

/**
 * One-sided "set" confirmation for when the prior value is unresolvable (a
 * raw-value-less factor whose scale can't be reliably recovered). Omits the
 * "from X" clause entirely rather than fabricating a numeric prior (a "from 0"
 * would be a false claim). Only used on `set` — deltas require a resolved
 * current value and reject otherwise.
 */
export function formatFactorValueSet(input: {
  readonly label: string;
  readonly after: { readonly raw_value: number; readonly unit?: string };
}): string {
  const after = formatValueWithUnit(input.after.raw_value, input.after.unit);
  return `Updated ${input.label} to ${after}.`;
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

/**
 * Honest re-registration receipt for when a restated constraint value is
 * IDENTICAL to what is already persisted (ROADMAP 1.19(a) — receipt
 * claim-integrity). `formatConstraintUpdated` implies a fresh commit;
 * shipping it for a value that did not actually change is a false
 * "updated" claim — the fact channel already knows it is a no-op
 * (`AddConstraintHandlerFact.noop === true`) but the text channel
 * previously ignored that and always claimed "Updated" whenever a prior
 * constraint existed, regardless of whether the value differed.
 * Deliberately avoids a sentence-leading commit verb ("Updated"/"Set").
 */
export function formatConstraintUnchanged(input: ConstraintAddedInput): string {
  const phrase = OPERATOR_PHRASE[input.operator];
  const value = formatValueWithUnit(input.value, input.unit);
  return `${input.targetLabel} is already constrained to be ${phrase} ${value}.`;
}

/**
 * Receipt for a goal-target set through the add_constraint goal-threshold
 * join (lane CEE-W5 Mission B). Names the target honestly and states only
 * what durably happened (the threshold is stamped on the goal node in the
 * same committed write). provisional_doctrine_v0.
 *
 * Lane 22 honesty fix: the previous second sentence promised "The next
 * analysis will score your options against this target." — FALSE for
 * every goal-target registration today (goal-fit is deterministically
 * suppressed for goal nodes without a value channel; the PLoT
 * threshold-normalisation fix and the target_base doctrine implementation
 * are both pending). The receipt now promises only what the system can
 * honour: the target is saved, and goal fit is flagged once the analysis
 * can score it. The conditional "once" keeps the second sentence outside
 * the goal-target claim class (goal-target-receipt-guard
 * NEGATION_CONDITIONAL_RE) while sentence one remains guarded.
 */
export function formatGoalTargetSet(input: {
  readonly goalLabel: string;
  readonly value: number;
  readonly unit?: string;
}): string {
  const value = formatValueWithUnit(input.value, input.unit);
  return `Success target set: ${input.goalLabel} at least ${value}. I'll flag how your options score against it once the analysis can measure this goal.`;
}

/**
 * Honest re-registration receipt for when a restated success target is
 * IDENTICAL to what is already persisted (ROADMAP 1.19(a) — receipt
 * claim-integrity, single-goal re-registration). `formatGoalTargetSet`
 * unconditionally reads as a fresh registration event; shipping it when
 * the target did not actually change borrows the pre-existing threshold
 * to narrate a commit that did not happen this turn.
 */
export function formatGoalTargetUnchanged(input: {
  readonly goalLabel: string;
  readonly value: number;
  readonly unit?: string;
}): string {
  const value = formatValueWithUnit(input.value, input.unit);
  return `${input.goalLabel}'s success target is already ${value} — no need to change it.`;
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
