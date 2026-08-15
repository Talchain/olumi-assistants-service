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

/**
 * Honest receipt for when a proposed factor value is IDENTICAL to the one
 * already persisted (Gate-1 claim integrity). `formatFactorChange` implies
 * a fresh commit; shipping it for a value that did not change produces the
 * self-refuting "Updated X from 0.8 to 0.8." — the fact channel already
 * knows it is a no-op (`SetFactorValueHandlerFact.noop === true`) but the
 * text channel ignored it and narrated a change regardless.
 *
 * Same discipline as `formatConstraintUnchanged` (ROADMAP 1.19(a)), which
 * fixed this exact divergence for add_constraint: deliberately avoids a
 * sentence-leading commit verb ("Updated"/"Set"), so the sentence cannot
 * be misread as a receipt for work done. The value is still named — the
 * user asked for a specific number and is owed confirmation that it is
 * the number in the model.
 */
export function formatFactorValueUnchanged(input: {
  readonly label: string;
  readonly after: { readonly raw_value: number; readonly unit?: string };
}): string {
  const value = formatValueWithUnit(input.after.raw_value, input.after.unit);
  return `${input.label} is already set to ${value}.`;
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
 * Overnight review F8(b) — distinct receipt for a restatement whose VALUE
 * is unchanged but whose LABEL differs from what is persisted. Neither
 * `formatConstraintUpdated` ("Updated constraint: …") — which implies a
 * value change that did not happen — nor `formatConstraintUnchanged`
 * ("… is already constrained …") — which implies nothing changed at all,
 * when the label in fact did — is honest here. `label` is excluded from
 * the add_constraint value-sameness predicate precisely so this case can
 * be named on its own terms.
 */
export function formatConstraintLabelUpdated(input: ConstraintAddedInput): string {
  const phrase = OPERATOR_PHRASE[input.operator];
  const value = formatValueWithUnit(input.value, input.unit);
  return `Updated the label to ${input.targetLabel} — the constraint (must be ${phrase} ${value}) is unchanged.`;
}

/**
 * ROADMAP 2.877 (link 2) — receipt fragment for the stated-baseline mint.
 * Appended to whichever constraint receipt applies when the SAME turn also
 * recorded the target's user-stated current level as its observed baseline.
 *
 * Two honesty jobs at once: (a) the user stated two facts (a bound and a
 * level) and is owed confirmation of both; (b) on an otherwise-unchanged
 * restatement turn the mint is the ONLY change, and the F9 discipline
 * (receipt and analysis-affecting hash must agree) forbids narrating that
 * turn as a pure no-op. Deliberately verb-led by "Noted" rather than
 * "Updated"/"Set": the level is recorded as context, not committed as a
 * constraint, and the receipt must not claim otherwise.
 */
export function formatBaselineNoted(input: {
  readonly targetLabel: string;
  readonly value: number;
  readonly unit?: string;
}): string {
  const value = formatValueWithUnit(input.value, input.unit);
  return `Noted ${input.targetLabel} is currently at ${value}.`;
}

/**
 * ROADMAP 2.918 — the interrogative dual of `formatBaselineNoted`, appended
 * to the constraint receipt on the SAME cell when there was no stated level
 * to note: the bound is saved (the receipt before this fragment says so), and
 * ONE concrete, answerable question asks for the current level. Honest about
 * why (ISL's level conversion genuinely cannot run without a baseline —
 * `CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`), names the target
 * so an elliptical answer has an identity to bind through, and says
 * "percentage" because the extractor's v1 grammar is percent-only — an
 * answer without '%' cannot mint. Leak-safe: no handler ids, no parameter
 * names, no internal tokens, no em dash.
 */
export function formatBaselineElicitation(input: { readonly targetLabel: string }): string {
  return (
    `To test that bound, the analysis also needs to know where ${input.targetLabel} stands today. ` +
    `Roughly what percentage is ${input.targetLabel} at right now?`
  );
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
 *
 * Overnight review N1: carries the same "at least" operator qualifier as
 * `formatGoalTargetSet` — the registered contract is `>=`, and the bare
 * value alone ("already 15%") under-specifies it, reading as an exact
 * target rather than a floor.
 */
export function formatGoalTargetUnchanged(input: {
  readonly goalLabel: string;
  readonly value: number;
  readonly unit?: string;
}): string {
  const value = formatValueWithUnit(input.value, input.unit);
  return `${input.goalLabel}'s success target is already at least ${value} — no need to change it.`;
}

export interface EdgeAdjustmentInput {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly beforeMean: number;
  readonly afterMean: number;
  /** Explicit persisted directions are required to describe zero honestly. */
  readonly beforeDirection?: 'positive' | 'negative';
  readonly afterDirection?: 'positive' | 'negative';
}

/**
 * Decision-language edge adjustment confirmation. Uses `bandFromMagnitude`
 * for strength and surfaces direction reversal explicitly. Never emits
 * the raw mean.
 */
export function formatEdgeAdjustment(input: EdgeAdjustmentInput): string {
  const beforeBand = describeBandWithDirection(input.beforeMean);
  const afterBand = describeBandWithDirection(input.afterMean);

  const beforeDirection =
    input.beforeDirection ?? (input.beforeMean < 0 ? 'negative' : 'positive');
  const afterDirection =
    input.afterDirection ?? (input.afterMean < 0 ? 'negative' : 'positive');
  const directionFlipped = beforeDirection !== afterDirection;

  // A zero mean has no numeric sign, but the canonical model deliberately
  // retains direction for a later non-zero adjustment. Do not narrate a
  // meaningless "no influence → no influence" band change or infer positive.
  if (
    input.beforeMean === 0 &&
    input.afterMean === 0 &&
    directionFlipped
  ) {
    return (
      `Adjusted the direction of the link between ${input.fromLabel} and ` +
      `${input.toLabel} to ${afterDirection}. Its strength remains zero, so ` +
      `it currently has no material influence.`
    );
  }

  const tail = directionFlipped
    ? input.afterMean === 0
      ? ` Its strength is now zero; the stored direction is ${afterDirection}.`
      : input.beforeMean === 0
        ? ''
        : ` Direction reversed: now ${afterDirection}.`
    : '';

  return `Adjusted the link between ${input.fromLabel} and ${input.toLabel} from ${beforeBand} to ${afterBand}.${tail}`;
}

/**
 * Honest receipt for an edge-strength proposal that matches the strength
 * already persisted (Gate-1 claim integrity). The counterpart to
 * `formatFactorValueUnchanged` for the edge handler, which had the same
 * fact/text divergence: `adjust-edge-strength.ts` computed `noop` for its
 * fact but always narrated via `formatEdgeAdjustment`, yielding the
 * false "Adjusted the link between A and B from moderate to moderate."
 *
 * No sentence-leading commit verb. Near-zero means take a "has no
 * material influence" phrasing because the band noun does not read as a
 * predicate complement ("is already no material influence" is not
 * English).
 */
export function formatEdgeStrengthUnchanged(input: {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly mean: number;
}): string {
  const link = `The link between ${input.fromLabel} and ${input.toLabel}`;
  if (Math.abs(input.mean) < NEAR_ZERO_INFLUENCE_THRESHOLD) {
    return `${link} already has no material influence.`;
  }
  return `${link} is already ${describeBandWithDirection(input.mean)}.`;
}

/**
 * Receipt for an explicit `confirm_current` edge-strength act. Unlike an
 * ordinary numeric no-op, confirmation changes provenance: the human has
 * adopted the current model value as their judgement. It deliberately repeats
 * neither a number nor a direction; the strict expected-before check proves
 * which current value was confirmed, and omitting both avoids reconstructing
 * either one from display state (especially at zero, whose direction is not
 * recoverable from sign).
 */
export function formatEdgeStrengthConfirmed(input: {
  readonly fromLabel: string;
  readonly toLabel: string;
}): string {
  return (
    `Confirmed the current strength of the link between ${input.fromLabel} ` +
    `and ${input.toLabel} as your judgement.`
  );
}

function describeBandWithDirection(mean: number): string {
  const abs = Math.abs(mean);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'no material influence';
  const band = bandFromMagnitude(abs);
  return mean < 0 ? `${band} (negative)` : band;
}
