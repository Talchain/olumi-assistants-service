/**
 * Factor-value normalisation. Sonnet emits user-units components via the
 * structured `parameters.value` shape:
 *
 *   { value: 5, unit: '%', cap?: 100 }     — percentage on 0-1 model scale
 *   { value: 50000, unit: '£', cap?: 100000 }  — currency, normalises by cap
 *   { value: 0.8 }                          — already a ratio
 *
 * Or as a primitive number, in which case the existing factor's stored
 * `unit` / `cap` drive interpretation.
 *
 * Output is { raw_value, value }:
 *   - raw_value is the user-unit number ("5", "50000", "0.8").
 *   - value is the model-unit number written into observed_state.value.
 *     When `cap` is defined, value = raw_value / cap (clamped to [0, cap]).
 *     When `cap` is absent, value = raw_value.
 *
 * The cap / range / unit guards are NOT defined inline here any more —
 * they live in `evaluateFactorValueProposal` (the single source of
 * truth, called from the validator and pre-synthesis sites too). This
 * function delegates to that predicate and converts a non-ok result
 * into the `D1HandlerError(PARAMETER_INVALID)` the handler contract
 * already throws. See workstream plan: AC.1 parity invariant.
 */

import { D1HandlerError } from './errors.js';
import {
  evaluateFactorValueProposal,
  type ProposalRejectionReason,
} from './evaluate-factor-value-proposal.js';
import { SET_FACTOR_VALUE_USER_GUIDANCE } from './user-guidance.js';

export interface NormaliseInput {
  /** The numeric value as the user states it (post operator application). */
  readonly rawInput: number;
  /** Optional explicit unit on the proposal parameter or the factor. */
  readonly unit?: string;
  /** Optional cap from the proposal parameter. */
  readonly proposalCap?: number;
  /** Cap stored on the factor's observed_state, if any. */
  readonly factorCap?: number;
  /**
   * The factor's stored unit, if any. Used as fallback when the proposal
   * parameter omits the unit.
   */
  readonly factorUnit?: string;
  /**
   * When true, the parameter arrived as a bare number with no unit. We
   * use this to detect ambiguous proposals against capped factors —
   * see correction #9 ("ambiguous value rejection").
   */
  readonly inputHasUnit: boolean;
}

export interface NormaliseResult {
  readonly raw_value: number;
  readonly value: number;
}

/**
 * Normalise a factor value. Throws `D1HandlerError(PARAMETER_INVALID)` when
 * the input would fail the shared `evaluateFactorValueProposal` predicate
 * (cap / range / unit / non-finite guards) — the same predicate the
 * validator and the deterministic-synthesis precheck call.
 *
 * By the time this function runs the handler has already applied the
 * operator (see set-factor-value.ts:`applyOperator` → `newRaw` →
 * `normaliseFactorValue({rawInput: newRaw, ...})`), so we pass
 * `operator: 'set'` to the predicate; delta-specific guards
 * (`delta_no_existing_value`, `delta_no_cap_and_no_unit`) fire upstream
 * at the validator / precheck so they can produce a clarification
 * BEFORE the handler runs at all.
 */
export function normaliseFactorValue(input: NormaliseInput): NormaliseResult {
  const { rawInput, unit, proposalCap, factorCap, factorUnit, inputHasUnit } =
    input;

  // Delegate to the shared predicate. By construction this exercises
  // the same guards the validator + pre-synthesis paths run, so a
  // proposal accepted by both upstream gates cannot fail here on
  // parameter grounds (AC.1 parity invariant).
  const evaluation = evaluateFactorValueProposal({
    rawInput,
    // The handler has already applied the operator into `rawInput` —
    // pass `'set'` so the predicate treats `rawInput` as the final
    // effectiveRaw without recomputing operator math.
    operator: 'set',
    ...(unit !== undefined ? { unit } : {}),
    ...(proposalCap !== undefined ? { proposalCap } : {}),
    ...(factorCap !== undefined ? { factorCap } : {}),
    ...(factorUnit !== undefined ? { factorUnit } : {}),
    inputHasUnit,
  });

  if (!evaluation.ok) {
    // Surface the same wire shape the handler has thrown historically —
    // `D1HandlerError(PARAMETER_INVALID)` mapped to `cause_kind:
    // 'parameter_invalid_at_execute'`. The granular predicate reason
    // lands in the structured `details` for telemetry triage; the user
    // sees the canonical `SET_FACTOR_VALUE_USER_GUIDANCE` recovery
    // template via the existing recoverable-handler-response path.
    throw new D1HandlerError('PARAMETER_INVALID', evaluation.specific_issue, {
      details: {
        rawInput,
        cap: proposalCap ?? factorCap ?? null,
        unit: unit ?? factorUnit ?? null,
        rejection_reason: evaluation.reason satisfies ProposalRejectionReason,
      },
      userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
    });
  }

  // Past this point the predicate has guaranteed: rawInput is finite,
  // cap (when supplied) is positive, and the value sits in the
  // factor's expected range. Normalisation math is straightforward.

  const cap = proposalCap ?? factorCap;

  // No cap → store raw_value as-is in both fields. Useful for absolute
  // values like counts or unbounded scales.
  if (cap === undefined) {
    return { raw_value: rawInput, value: rawInput };
  }

  // Capped factor: model value = raw / cap. When the input arrives with
  // a percentage-style unit and the factor is capped at 100, treat the
  // raw input as a percentage on its own scale — value=raw/100. This
  // matches the V3 convention where a "5% churn" factor stores
  // raw_value=5, value=0.05 (cap=100).
  const value = rawInput / cap;

  if (!Number.isFinite(value)) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'Normalised value is not finite.',
      {
        details: {
          rawInput,
          cap,
          rejection_reason: 'non_finite' satisfies ProposalRejectionReason,
        },
        userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
      },
    );
  }

  return { raw_value: rawInput, value };
}
