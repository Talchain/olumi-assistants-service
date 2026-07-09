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
 * Tagged result of resolving a factor's current user-unit raw value. Making
 * the three outcomes explicit (rather than collapsing to `number | undefined`)
 * keeps the delta and narration policies honest:
 *   - `resolved`  → a reliable user-unit value; usable as a delta LHS and as
 *                   the "from" side of a change receipt.
 *   - `missing`   → the factor has no recorded value at all.
 *   - `ambiguous` → the factor HAS a value but its scale cannot be reliably
 *                   recovered (e.g. a raw-value-less `%` whose divisor is
 *                   unknown). Distinct from `missing` so narration never
 *                   fabricates a numeric "from" value for it.
 * Both `missing` and `ambiguous` fail closed for delta operators and produce a
 * one-sided ("to X") receipt — but the distinction is preserved for clarity
 * and telemetry.
 */
export type ExistingRawResolution =
  | { readonly kind: 'resolved'; readonly raw: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' };

/**
 * Resolve a factor's current USER-UNIT raw value from its observed_state, for
 * use as the left-hand side of delta operators (increase / decrease / multiply)
 * and for change narration. This is the INVERSE of `normaliseFactorValue`,
 * which stores `value = raw / cap` for EVERY capped factor (including `%`) and
 * `value === raw` when uncapped:
 *
 *   - `raw_value` present         → `resolved` (canonical user-unit value).
 *   - percentage (`unit === '%'`) → reconstruct as `value*100` ONLY when the
 *                                   value is a normalised proportion in [0,1]
 *                                   AND the divisor is unambiguous (no cap, or
 *                                   `cap === 100`). A `%` value OUTSIDE [0,1]
 *                                   (e.g. 5 → 500% via extractor `raw/100`, or
 *                                   5% as a legacy raw value — both plausible)
 *                                   or a `cap !== 100` is `ambiguous` → fail
 *                                   closed; there is no reliable scale provenance.
 *   - non-% value outside [0,1]   → `resolved` as already-raw. A normalised
 *                                   value is always in [0,1], so a stored value
 *                                   >1 (e.g. {value:200000, cap:500000}) or <0
 *                                   is an off-contract graph carrying a raw
 *                                   value (symmetric; the cap-range guard
 *                                   contains out-of-range results).
 *   - capped non-%                → `resolved` = value * cap (inverse of normalise).
 *   - uncapped non-%              → `resolved` = value (uncapped stores value===raw).
 *   - no value at all             → `missing`.
 *
 * Without this de-normalisation, a legacy/capped factor that stored only the
 * normalised `value` (e.g. `{ value: 0.4, cap: 100000 }` = £40,000) would have
 * its delta computed against `0.4` instead of `40000` — corrupting the result
 * (`× 0.3` → £0.12 instead of £12,000) and narrating "from 0.4 to £0.12".
 * Shared so the validator precheck, the executor precheck, and the handler all
 * resolve the LHS identically (validator/handler parity).
 */
export function resolveExistingRawValue(snapshot: {
  readonly raw_value?: number;
  readonly value?: number;
  readonly unit?: string;
  readonly cap?: number;
}): ExistingRawResolution {
  const { raw_value, value, unit, cap } = snapshot;
  if (raw_value !== undefined) return { kind: 'resolved', raw: raw_value };
  if (value === undefined) return { kind: 'missing' };

  if (unit === '%') {
    // A raw-value-less % factor has no reliable scale provenance: a handler-
    // produced % always carries raw_value (short-circuited above), so this is
    // an extractor/legacy state. value=raw/100 is only safe to invert when the
    // value is a normalised proportion in [0,1] and the divisor is unambiguous
    // (no cap, or cap===100). A value outside [0,1] (5 → 500%? or legacy 5%?)
    // or cap!==100 is genuinely ambiguous.
    const unambiguousDivisor = cap === undefined || cap === 100;
    if (unambiguousDivisor && value >= 0 && value <= 1) {
      return { kind: 'resolved', raw: value * 100 };
    }
    return { kind: 'ambiguous' };
  }

  // Non-%: a normalised capped value is always in [0,1]; a value outside that
  // range is an off-contract graph carrying an already-raw value (normalisation
  // never produces >1 or <0). Handle > 1 and < 0 symmetrically; the downstream
  // cap-range guard contains any out-of-range result.
  if (value < 0 || value > 1) return { kind: 'resolved', raw: value };
  // capped → value*cap (inverse of normaliseFactorValue); uncapped →
  // value === raw_value.
  return { kind: 'resolved', raw: cap !== undefined ? value * cap : value };
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
  // Public entry point: always enforces the full guard set, including the
  // stated-value `bare_ratio_on_unit_factor` gate. The bare-ratio suppression
  // is reachable ONLY through `evaluatePostOperatorFactorValue` (which calls
  // the non-exported impl) — there is no parameter on this signature to
  // disable a safety gate, so an arbitrary caller cannot bypass it.
  return evaluateFactorValueProposalImpl(input, false);
}

function evaluateFactorValueProposalImpl(
  input: EvaluateFactorValueProposalInput,
  suppressBareRatioGate: boolean,
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

    // 3b. delta_no_cap_and_no_unit. An uncapped, unitless delta has no
    //     bounded interpretation ("increase by 10" — 10 of what?). Surface
    //     as a clarification rather than writing a boundless value. This
    //     INCLUDES `multiply`: an UNCAPPED multiply has no upper or lower
    //     bound (no cap-range guard runs below to contain it), so a bare
    //     `× -0.5` or `× 1e9` would otherwise write a nonsensical or
    //     unbounded value (e.g. `12 people × -0.5 = -6 people`). Capped
    //     multiply is unaffected (cap is defined here) and is exempted from
    //     the bare-ratio gate at 3c instead, where the cap-range guard
    //     contains it.
    if (cap === undefined && !inputHasUnit) {
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
  //     scaling factor, never a value in the factor's unit. On a CAPPED
  //     factor "multiply by 0.3" unambiguously means ×0.3 ("scale to 30%",
  //     e.g. £40,000 → £12,000) — there is no proportion-vs-unit ambiguity,
  //     and the "give me a £ amount" clarification would be wrong guidance
  //     for a scaling operation. Sub-1 multipliers are the normal way to
  //     scale down, so on a capped factor they pass to the cap-range guard
  //     below (which contains overshoot/negative products). An UNCAPPED
  //     multiply is rejected earlier at gate 3b (no cap to bound it).
  //
  //     NOTE on multiply + explicit unit: a multiply RHS is treated as a
  //     pure scalar — its unit is NOT dimensionally validated. A unit that
  //     MATCHES the factor (e.g. `£40,000 × £0.3`) is harmlessly ignored
  //     (the math is ×0.3 → £12,000); a unit that DIFFERS is still caught
  //     by `unit_mismatch` (2b) above. Multiplying by a money/percent
  //     amount is incoherent input, but the numeric result is honest.
  //
  //     This gate judges the USER'S STATED `rawInput`, so it must only run
  //     where `rawInput` is that stated number — i.e. the validator
  //     precheck and the handler's `preEvaluation`. `normaliseFactorValue`
  //     re-runs this predicate against the POST-operator computed value
  //     (with `operator: 'set'`); it sets `suppressBareRatioGate` so a
  //     legitimate honest product that lands in (0,1) — e.g. `4% × 0.1 =
  //     0.4%`, or `decrease £5.30 by £5 = £0.30` — is not falsely rejected
  //     at execute (the stated-value check already happened upstream).
  //
  //     Tier A #1 (edit-reliability, 2026-07-09) — FIX 3 (1.45-F6):
  //     EXEMPT a factor whose cap is exactly 1 (`isProportionScaledFactor`).
  //     When a factor's own native range IS [0,1] (e.g. a churn-rate-style
  //     factor stored as a 0-1 proportion, whatever unit string happens to
  //     be attached), a bare "0.8" is UNAMBIGUOUSLY a value in that scale —
  //     there is no proportion-vs-unit interpretation gap to warn about,
  //     unlike a £/people/count factor where a sub-1 number is almost
  //     certainly a mis-stated ratio. This is deliberately narrow: it does
  //     NOT touch the doctrine-open case of a %-unit factor on a 0-100
  //     scale (`factorCap: 100`), where "0.8" could mean 0.8% or a typo for
  //     80% (Paul's open pp-vs-relative decision, D-D) — that case keeps
  //     the existing clarify unchanged (cap !== 1 there, so this exemption
  //     does not apply). The cap-range guard below still runs normally, so
  //     an out-of-[0,1] value on a cap-1 factor is still rejected.
  const isProportionScaledFactor = cap === 1;
  if (
    !suppressBareRatioGate &&
    operator !== 'multiply' &&
    !isProportionScaledFactor &&
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

/**
 * Dedicated post-operator validation API. The handler has already applied
 * the operator into `computedRaw` and enforced the STATED-value guards
 * (bare_ratio, unit_mismatch, delta guards) at `preEvaluation` against the
 * original RHS. This validates the resulting COMPUTED value against only the
 * value-level guards (finiteness, positive cap, cap range) — it never
 * re-runs the bare-ratio gate, because that gate judges the user's stated
 * input, not a computed product (re-running it would falsely reject honest
 * results in (0,1), e.g. `4% × 0.1 = 0.4%`).
 *
 * This is the ONLY place the bare-ratio gate is suppressed: it calls the
 * non-exported impl directly. The public `evaluateFactorValueProposal` exposes
 * no suppression parameter, so no other caller can disable the gate.
 */
export function evaluatePostOperatorFactorValue(input: {
  readonly computedRaw: number;
  readonly unit?: string;
  readonly proposalCap?: number;
  readonly factorCap?: number;
  readonly factorUnit?: string;
  readonly inputHasUnit: boolean;
}): FactorValueProposalEvaluation {
  return evaluateFactorValueProposalImpl(
    {
      rawInput: input.computedRaw,
      // The operator was already applied into `computedRaw`; treat it as a
      // final `set` value so the predicate does not re-apply operator math.
      operator: 'set',
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.proposalCap !== undefined ? { proposalCap: input.proposalCap } : {}),
      ...(input.factorCap !== undefined ? { factorCap: input.factorCap } : {}),
      ...(input.factorUnit !== undefined ? { factorUnit: input.factorUnit } : {}),
      inputHasUnit: input.inputHasUnit,
    },
    true,
  );
}
