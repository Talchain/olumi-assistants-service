/**
 * Shared evaluator for `set_factor_value` proposal parameters. The single
 * source of truth for the cap / range / unit / delta guards that the
 * handler's `normaliseFactorValue` runs at execute time.
 *
 * The predicate is called from THREE places:
 *
 *   1. The handler (`normaliseFactorValue` delegates to this — task #3
 *      refactor).
 *   2. The validator (validation-registry / validator — task #4 wiring) so
 *      structural-pass proposals that would fail at execute are rejected
 *      earlier with `invalid_parameter`, routing into the existing
 *      recoverable path.
 *   3. The deterministic-value-update synthesis site in TurnExecutor
 *      (task #5) so synthesised proposals never reach the handler with
 *      parameters the handler would reject.
 *
 * Calling the same predicate from all three sites is the parity contract
 * that closes the AC.1 invariant: any proposal accepted by validator AND
 * precheck must never produce `parameter_invalid_at_execute` at the
 * handler — because the handler runs the same rules.
 *
 * The predicate does NOT throw. It returns a discriminated union so
 * callers can compose the rejection into a domain-appropriate response
 * (validator → invalid_parameter; TurnExecutor → clarify downgrade;
 * handler → D1HandlerError(PARAMETER_INVALID)).
 *
 * User-facing copy is uniform across rejection reasons — see
 * `SET_FACTOR_VALUE_USER_GUIDANCE`. The granular `reason` enum is for
 * telemetry only; the user-visible string in `specific_issue` matches
 * the canonical handler copy that `normaliseFactorValue` produces today.
 */

import { formatValueWithUnit } from './format-confirmation.js';

/**
 * Operators the handler's `applyOperator` supports. Mirrors the union
 * inside `set-factor-value.ts` — kept here so the predicate is
 * self-contained and the validator wiring doesn't need to import a
 * handler-internal helper.
 *
 * Wire enum from `routing/types.ts` is `'set' | 'increase' | 'decrease'
 * | 'multiply'`; we mirror that exactly.
 */
export type FactorValueOperator = 'set' | 'increase' | 'decrease' | 'multiply';

/**
 * Granular rejection reasons. Bound to the telemetry enum — additions
 * here require a plan amendment (see "Locked telemetry enums" in the
 * workstream plan). Reasons are ordered roughly by check sequence:
 * structural → delta-guards → range-guards.
 */
export type ProposalRejectionReason =
  | 'missing_value' // value parameter absent or wrong shape on the proposal
  | 'invalid_operator' // operator is not in the FactorValueOperator union
  | 'non_finite' // rawInput is NaN / Infinity / -Infinity
  | 'cap_non_positive' // cap <= 0 (nonsensical)
  | 'unit_mismatch' // proposal.unit and factor.unit both defined and differ
  | 'delta_no_existing_value' // operator !== 'set' AND factor has no finite raw_value
  | 'delta_no_cap_and_no_unit' // operator !== 'set' AND no cap AND no unit (ambiguous)
  | 'bare_number_outside_cap' // !inputHasUnit AND cap defined AND effectiveRaw outside [0, cap]
  | 'value_exceeds_cap' // inputHasUnit AND cap defined AND effectiveRaw outside [0, cap]
  | 'bare_ratio_on_unit_factor'; // !inputHasUnit AND factor has a unit AND 0 < |rawInput| < 1 (looks like a normalised proportion)

/**
 * Result of evaluating a proposal. `ok: true` means the handler's
 * `normaliseFactorValue` would not throw for these inputs. `ok: false`
 * carries the granular reason (telemetry) and the canonical user
 * message (`specific_issue`).
 */
export type FactorValueProposalEvaluation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: ProposalRejectionReason;
      readonly specific_issue: string;
    };

export interface EvaluateFactorValueProposalInput {
  /** The user-units number on the proposal (operator's right-hand side). */
  readonly rawInput: number;
  /** Operator carried on the proposal parameter. Defaults to `'set'` if undefined. */
  readonly operator?: FactorValueOperator;
  /** Explicit unit on the proposal, if any. */
  readonly unit?: string;
  /** Explicit cap on the proposal, if any. */
  readonly proposalCap?: number;
  /** Cap stored on the factor's observed_state, if any. */
  readonly factorCap?: number;
  /**
   * The factor's stored unit, if any. Used as fallback when the proposal
   * parameter omits the unit.
   */
  readonly factorUnit?: string;
  /**
   * The factor's stored user-units value (`raw_value`), used as the
   * left-hand side of delta operators. Missing / non-finite values
   * short-circuit to `delta_no_existing_value` BEFORE the operator is
   * applied — never silently defaults to 0 (regression of staging
   * 2fcd2221 fixed: AC.3).
   */
  readonly factorExistingRaw?: number;
  /**
   * When true, the parameter arrived with an explicit unit. Mirrors
   * `parseProposalValue`'s flag — bare numbers vs unit-bearing values
   * have different guard rules (`bare_number_outside_cap` vs
   * `value_exceeds_cap`).
   */
  readonly inputHasUnit: boolean;
  /**
   * Suppresses the `bare_ratio_on_unit_factor` gate (3c). Set ONLY by
   * `normaliseFactorValue`, which runs this predicate against the
   * POST-operator computed value (with `operator: 'set'`). The bare-ratio
   * gate judges whether the USER'S STATED number looks like a proportion;
   * that check already happened upstream against the original RHS (at the
   * validator precheck and the handler's `preEvaluation`). Re-applying it
   * to a computed product would falsely reject legitimate honest results
   * whose value lands in (0,1) — e.g. `4% × 0.1 = 0.4%`, or
   * `decrease £5.30 by £5 = £0.30`. Default (undefined/false): gate active.
   */
  readonly suppressBareRatioGate?: boolean;
}

/**
 * Apply a numeric operator to `current` and `rhs`. Mirrors the handler's
 * `applyOperator` exactly so the predicate computes the same
 * `effectiveRaw` that the handler will. Exported so `set-factor-value.ts`
 * can re-import it from this module (single source of truth).
 *
 * `undefined` operator collapses to `'set'` — same default as the
 * handler.
 */
export function applyFactorValueOperator(
  current: number,
  operator: FactorValueOperator | undefined,
  rhs: number,
): number {
  switch (operator) {
    case undefined:
    case 'set':
      return rhs;
    case 'increase':
      return current + rhs;
    case 'decrease':
      return current - rhs;
    case 'multiply':
      return current * rhs;
  }
}

/**
 * Pre-execute evaluation of a `set_factor_value` proposal. Returns
 * `{ ok: true }` when the handler's `normaliseFactorValue` would
 * accept these inputs without throwing; returns `{ ok: false, reason,
 * specific_issue }` otherwise.
 *
 * Check order matches the handler's existing guard sequence so the
 * `reason` enum aligns one-to-one with the failure paths telemetry can
 * see today, with two additions called out by the workstream plan:
 *
 *   - `delta_no_existing_value`: checked BEFORE `applyFactorValueOperator`
 *     so a missing/NaN `factorExistingRaw` never silently defaults to 0
 *     and silently corrupts a delta computation (AC.3).
 *   - `delta_no_cap_and_no_unit`: an uncapped, unitless delta has no
 *     bounded interpretation; rejecting earlier surfaces a clear
 *     clarification path rather than letting the handler write a
 *     boundless value.
 *
 * British English. No internal terms in user-facing copy.
 */
export function evaluateFactorValueProposal(
  input: EvaluateFactorValueProposalInput,
): FactorValueProposalEvaluation {
  const {
    rawInput,
    operator: rawOperator,
    unit,
    proposalCap,
    factorCap,
    factorUnit,
    factorExistingRaw,
    inputHasUnit,
    suppressBareRatioGate,
  } = input;

  const operator: FactorValueOperator = rawOperator ?? 'set';

  // 1. Structural: rawInput must be finite. Matches the
  //    "Value must be a finite number." guard at normalise-factor-value.ts:62.
  if (!Number.isFinite(rawInput)) {
    return {
      ok: false,
      reason: 'non_finite',
      specific_issue: 'Value must be a finite number.',
    };
  }

  // The cap that will be applied — proposal-supplied takes precedence
  // over factor-stored, matching `normaliseFactorValue`'s line 69.
  const cap = proposalCap ?? factorCap;
  const effectiveUnit = unit ?? factorUnit;

  // 2. cap_non_positive. Matches the guard at normalise-factor-value.ts:99.
  //    Only meaningful when a cap was actually supplied; an undefined cap
  //    means "uncapped factor" and is allowed.
  if (cap !== undefined && cap <= 0) {
    return {
      ok: false,
      reason: 'cap_non_positive',
      specific_issue: `Cap must be positive (received ${cap}).`,
    };
  }

  // 2b. unit_mismatch. When BOTH the proposal carries a unit AND the
  //     factor has a stored unit, they must match. Otherwise the
  //     handler would persist the proposal's unit over the existing
  //     one — e.g. a `%` factor accepting a `£` value would silently
  //     become a currency factor downstream. Brief: "If the unit is
  //     incompatible, ask a concise clarification."
  //
  //     Strict string equality is sufficient: CQE's `mapCqeQuantityToProposalValue`
  //     already canonicalises units (GBP→'£', percentage→'%', etc.) so
  //     equivalent forms have already been normalised by the time the
  //     proposal reaches this predicate. The factor's stored unit is
  //     written by previous handler turns through the same mapping.
  if (unit !== undefined && factorUnit !== undefined && unit !== factorUnit) {
    return {
      ok: false,
      reason: 'unit_mismatch',
      specific_issue: `This factor uses ${factorUnit}; the value provided is in ${unit}.`,
    };
  }

  // 3. Delta guards — run BEFORE `applyFactorValueOperator`.
  if (operator !== 'set') {
    // 3a. delta_no_existing_value. The factor must carry a finite
    //     raw_value for the operator's LHS. Anything else (undefined,
    //     NaN, ±Infinity) would silently default to 0 in the old
    //     handler path — regression of staging 2fcd2221 (AC.3).
    if (
      factorExistingRaw === undefined ||
      !Number.isFinite(factorExistingRaw)
    ) {
      return {
        ok: false,
        reason: 'delta_no_existing_value',
        specific_issue:
          "This factor has no recorded current value to adjust from.",
      };
    }

    // 3b. delta_no_cap_and_no_unit. An uncapped, unitless `increase`/
    //     `decrease` delta has no bounded interpretation ("increase by 10"
    //     — 10 of what?). Surface as a clarification rather than writing a
    //     boundless value. `multiply` is EXCLUDED: its right-hand side is a
    //     dimensionless scaling factor, so "multiply by 0.3" (= ×0.3) is
    //     fully bounded by the existing finite value (guaranteed by gate 3a)
    //     regardless of cap or unit — and asking for "a unit" would be wrong
    //     guidance for a scaling operation. Uncapped multiply therefore
    //     passes through to the finite/cap-range guards below.
    if (operator !== 'multiply' && cap === undefined && !inputHasUnit) {
      return {
        ok: false,
        reason: 'delta_no_cap_and_no_unit',
        specific_issue: "This change can't be applied without a unit.",
      };
    }
  }

  // 3c. bare_ratio_on_unit_factor. A bare (unit-less) number below 1 in
  //     magnitude, applied to a factor that HAS a unit, reads as a
  //     normalised proportion (0.3), not a value in that unit. Accepting
  //     it would persist raw_value=0.3 and narrate the misleading
  //     "£0.3" / "0.3 people" — a false user-visible claim. Gate on the
  //     user's stated number (rawInput), not effectiveRaw, so
  //     "increase budget by 0.3" is caught too. `rawInput === 0` is
  //     unambiguous ("zero it") and is allowed through; an explicit unit
  //     (`inputHasUnit`) means the user asserted the scale, so it is left
  //     to the cap-range guards below (e.g. an explicit "£0.30" is a
  //     fully-specified amount, not the bare-number ambiguity).
  //
  //     `multiply` is EXCLUDED: its right-hand side is a dimensionless
  //     scaling factor, never a value in the factor's unit. "multiply by
  //     0.3" unambiguously means ×0.3 ("scale to 30%", e.g. a £100k-capped
  //     £40,000 → £12,000) — there is no proportion-vs-unit ambiguity, and
  //     the "give me a £ amount" clarification would be wrong guidance for
  //     a scaling operation. Sub-1 multipliers are the normal way to scale
  //     down, so they pass to the cap-range guards.
  //
  //     This gate judges the USER'S STATED `rawInput`, so it must only run
  //     where `rawInput` is that stated number — i.e. the validator
  //     precheck and the handler's `preEvaluation`. `normaliseFactorValue`
  //     re-runs this predicate against the POST-operator computed value
  //     (with `operator: 'set'`); it sets `suppressBareRatioGate` so a
  //     legitimate honest product that lands in (0,1) — e.g. `4% × 0.1 =
  //     0.4%`, or `decrease £5.30 by £5 = £0.30` — is not falsely rejected
  //     at execute (the stated-value check already happened upstream).
  if (
    !suppressBareRatioGate &&
    operator !== 'multiply' &&
    !inputHasUnit &&
    effectiveUnit !== undefined &&
    rawInput !== 0 &&
    Math.abs(rawInput) < 1
  ) {
    return {
      ok: false,
      reason: 'bare_ratio_on_unit_factor',
      specific_issue:
        `${rawInput} looks like a proportion, not a value in ${effectiveUnit}. ` +
        `Tell me the amount in ${effectiveUnit}.`,
    };
  }

  // 4. Compute `effectiveRaw`. For `'set'` operator this is just
  //    `rawInput`; for delta operators we know `factorExistingRaw` is
  //    finite (gate 3a) so the computation is safe.
  const effectiveRaw =
    operator === 'set'
      ? rawInput
      : applyFactorValueOperator(
          factorExistingRaw as number,
          operator,
          rawInput,
        );

  // 5. Defensive: a finite-input operator can still produce Infinity
  //    under multiplication on the edges of the float range. Mirrors
  //    the "Normalised value is not finite." guard at
  //    normalise-factor-value.ts:141.
  if (!Number.isFinite(effectiveRaw)) {
    return {
      ok: false,
      reason: 'non_finite',
      specific_issue: 'Value must be a finite number.',
    };
  }

  // 6. Cap-range guards. Identical predicates to
  //    normalise-factor-value.ts:75 and :117 — applied to
  //    `effectiveRaw`, so a delta that would overshoot the cap is
  //    rejected just like an absolute that does.
  if (cap !== undefined) {
    const outOfRange = effectiveRaw < 0 || effectiveRaw > cap;
    if (outOfRange) {
      if (!inputHasUnit) {
        // 6a. bare_number_outside_cap.
        return {
          ok: false,
          reason: 'bare_number_outside_cap',
          specific_issue: `Value ${effectiveRaw} is outside the factor's expected range [0, ${cap}] and no unit was given.`,
        };
      }
      // 6b. value_exceeds_cap. Format via the shared helper so
      //     currency prefixes render correctly (`£500,000`, not
      //     `500000£`).
      const formattedInput = formatValueWithUnit(effectiveRaw, effectiveUnit);
      const formattedCap = formatValueWithUnit(cap, effectiveUnit);
      return {
        ok: false,
        reason: 'value_exceeds_cap',
        specific_issue: `Value ${formattedInput} exceeds the factor's cap of ${formattedCap}.`,
      };
    }
  }

  return { ok: true };
}
