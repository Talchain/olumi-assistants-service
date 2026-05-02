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
 */

import { D1HandlerError } from './errors.js';

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
 * the input is ambiguous or out-of-range.
 *
 * Ambiguity rule: when the input is a bare number with no unit, the factor
 * has a cap, and the value could plausibly be either user-units (e.g.
 * "5", meaning 5%) or model-units (0.05) — i.e. the input falls outside
 * [0, 1] but the factor is capped at 1 — refuse rather than guess.
 */
export function normaliseFactorValue(input: NormaliseInput): NormaliseResult {
  const { rawInput, unit, proposalCap, factorCap, factorUnit, inputHasUnit } = input;

  if (!Number.isFinite(rawInput)) {
    throw new D1HandlerError('PARAMETER_INVALID', 'Value must be a finite number.', {
      details: { value: rawInput },
    });
  }

  const cap = proposalCap ?? factorCap;
  const effectiveUnit = unit ?? factorUnit;

  // Ambiguity guard: bare number, capped factor, value lies outside [0, cap].
  // E.g. cap=1 (0-1 ratio) with rawInput=5 — could be "5%" or genuinely
  // out-of-range. Better to clarify than silently mis-scale.
  if (!inputHasUnit && cap !== undefined && (rawInput < 0 || rawInput > cap)) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      `Value ${rawInput} is outside the factor's expected range [0, ${cap}] and no unit was given.`,
      {
        details: { rawInput, cap, unit: effectiveUnit ?? null },
        userGuidance:
          'Specify the unit (e.g. "5%" or "0.05") so the value can be normalised correctly.',
      },
    );
  }

  // No cap → store raw_value as-is in both fields. Useful for absolute
  // values like counts or unbounded scales.
  if (cap === undefined) {
    return { raw_value: rawInput, value: rawInput };
  }

  // Capped factor: model value = raw / cap, clamped to [0, 1] when cap > 0.
  // Negative caps are nonsensical; reject them.
  if (cap <= 0) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      `Cap must be positive (received ${cap}).`,
      { details: { cap } },
    );
  }

  // When the input arrives with a percentage-style unit and the factor is
  // capped at 100, treat the raw input as a percentage on its own scale —
  // value=raw/100. This matches the V3 convention where a "5% churn"
  // factor stores raw_value=5, value=0.05 (cap=100).
  const value = rawInput / cap;

  if (!Number.isFinite(value)) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'Normalised value is not finite.',
      { details: { rawInput, cap } },
    );
  }

  return { raw_value: rawInput, value };
}
