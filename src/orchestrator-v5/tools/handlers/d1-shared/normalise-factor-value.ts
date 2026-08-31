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
  evaluatePostOperatorFactorValue,
  type ProposalRejectionReason,
} from './evaluate-factor-value-proposal.js';
import { checkPairCoherence, resolveScaleFrame } from './scale-frame.js';
import { unitPinnedScaleFrame } from '../../../../cee/draft/records/unit-scale-class.js';
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
   * ROADMAP 2.159 — the factor's stored `observed_state.value` /
   * `observed_state.raw_value`, threaded so the shared predicate can tell a
   * scale REDECLARATION (a proposal-supplied unit/cap on a factor that already
   * has a recorded state) from a first-time declaration. Absent ⇒ both gates
   * inert ⇒ today's behaviour.
   */
  readonly factorObservedValue?: number;
  readonly factorObservedRawValue?: number;
  /**
   * The factor's persisted `scale_frame` (pass 3d's divisor), threaded from
   * the node by `set-factor-value.ts`. Present on every factor the draft
   * framed — INCLUDING one with no baseline of its own, which is precisely the
   * case the observed pair above cannot speak for. Absent ⇒ fall back to the
   * pair, then to today's raw write. See `resolveScaleFrame`.
   */
  readonly factorScaleFrame?: number;
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
  const {
    rawInput,
    unit,
    proposalCap,
    factorCap,
    factorUnit,
    factorObservedValue,
    factorObservedRawValue,
    factorScaleFrame,
    inputHasUnit,
  } = input;

  // `rawInput` here is the POST-operator computed value (the handler has
  // already applied the operator), not the user's stated number. Use the
  // dedicated post-operator validation API: it checks finiteness / cap /
  // range but NOT the bare-ratio gate — that gate judges the user's stated
  // RHS and already ran upstream (validator precheck + handler
  // `preEvaluation`). Re-running it on a computed product would falsely
  // reject honest results in (0,1) (e.g. `4% × 0.1 = 0.4%`) and break
  // validator/handler parity (AC.1).
  const evaluation = evaluatePostOperatorFactorValue({
    computedRaw: rawInput,
    ...(unit !== undefined ? { unit } : {}),
    ...(proposalCap !== undefined ? { proposalCap } : {}),
    ...(factorCap !== undefined ? { factorCap } : {}),
    ...(factorUnit !== undefined ? { factorUnit } : {}),
    ...(factorObservedValue !== undefined ? { factorObservedValue } : {}),
    ...(factorObservedRawValue !== undefined ? { factorObservedRawValue } : {}),
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

  // No cap → two shapes, told apart by `resolveScaleFrame` — the factor's
  // persisted `scale_frame` first, its own before-pair second:
  //
  //   · FRAMED (records pass 3d wrote it: value = raw/frame, raw_value = raw,
  //     and the frame itself on `node.scale_frame`. Still no `cap`: a stored
  //     cap would flip this very branch to the clamping path and break the
  //     user-scale round-trip — which is exactly why the frame needed a
  //     carrier of its own). ⚠ THE STORED FRAME IS NOT A CONVENIENCE. Reading
  //     the pair alone cannot speak for a factor the brief stated no value for
  //     — it has no pair — so its options' magnitudes were framed while its
  //     own baseline was written RAW, and the rerun refused with
  //     `baseline_scale_unresolved` on an edit the product had just invited.
  //     The frame is recovered through the shared owner and the write
  //     PRESERVES it:
  //     {value: rawInput/frame, raw_value: rawInput}. Without this, the first
  //     accepted bare edit rewrote the baseline to RAW beside framed levels
  //     and the next analysis computed on it silently (PR #926 review,
  //     BLOCKER 1 — the scale guard gates interventions only).
  //     Deliberately NO clamp and NO re-framing: an over-frame edit yields an
  //     honest level > 1 (the truth about the frame), because inventing a new
  //     frame mid-edit would silently rescale every sibling intervention.
  //   · UNFRAMED (raw == value, or no recorded pair) → store raw_value as-is
  //     in both fields, exactly as before. Counts, ratios, unbounded scales.
  if (cap === undefined) {
    const frame = resolveScaleFrame({
      storedFrame: factorScaleFrame,
      value: factorObservedValue,
      raw_value: factorObservedRawValue,
    });
    if (frame !== undefined) {
      const framedValue = rawInput / frame;
      if (Number.isFinite(framedValue)) {
        return { raw_value: rawInput, value: framedValue };
      }
    }

    // ⭐⭐ THE UNIT THE USER STATED IS EVIDENCE ABOUT THE SCALE — READ IT BEFORE
    // FALLING BACK. Reaching here means no frame was recoverable: the factor
    // has no pair and no persisted `scale_frame` (the projector writes one only
    // when the factor had a magnitude in view — `magnitudes.length === 0`
    // continues). Until this limb, EVERY such edit was written
    // `value === raw_value`, and that pair is not a neutral fallback: it
    // positively encodes "this number is already on the analysis scale". For
    // "12 percent" that assertion is FALSE BY A FACTOR OF 100, and the analysis
    // seam's baseline gate then refused the whole run
    // (`baseline_scale_unresolved`) on an edit the product had just accepted —
    // wire-witnessed. The user stated the scale in their own words and we threw
    // the words away.
    //
    // ⚠ ONLY THE UNIT-PINNED FRAMES ARE ADMISSIBLE HERE, AND THE DISTINCTION IS
    // THE WHOLE SAFETY ARGUMENT. `unitPinnedScaleFrame` returns percent → 100
    // and basis points → 10,000 and NOTHING ELSE, and only inside the bounds
    // that make them true. Which CONSTANT it returns is a function of the UNIT
    // ALONE, so it can never hand back a laddered, sibling-dependent number.
    //
    // ⚠ THE CLAIM IS "NEVER CONTRADICTS, MAY ABSTAIN" — NOT "ALWAYS AGREES".
    // This comment previously said the derived number is "the number the
    // projector would have written, whatever the sibling interventions are".
    // That universal was FALSE on `rawInput ∈ (0, 1]`, where the authority
    // returned 100 and the projector returned nothing, and it silently moved a
    // live class by 100× (see `unit-scale-class.ts`). The authority now abstains
    // there and above the pinned bound, so what reaches this line is either
    // `undefined` or exactly `deriveFactorScaleFrame([rawInput], unit)`. The
    // general
    // `deriveFactorScaleFrame` is NOT admissible and must never be called from
    // this seam: its {1,2,5}·10^k ladder is a function of the magnitude SET,
    // the edit sees only its own magnitude, and re-deriving it here lands
    // £600,000 at level 0.6 beside a £400,000 option at 0.8 — the status quo
    // scoring cheaper than a cheaper option, with no refusal anywhere (9 of 25
    // framings distorted, worst 100x; `records/projector.ts`'s persist site).
    //
    // ⚠ AND NOTE WHAT DELIBERATELY DOES NOT CHANGE. A currency or a count
    // classes `unknown`, pins no frame, and still falls through to the raw
    // write below — so the baseline gate still refuses it, loudly and
    // specifically. Closing the percent gap must not open the currency lie:
    // this limb is narrow because the honest refusal is the correct behaviour
    // for every unit whose divisor nobody has stated.
    //
    // ⚠ ONLY THE UNIT THE USER STATED ON THIS PROPOSAL COUNTS — the factor's
    // STORED unit is deliberately NOT consulted, and that is this estate's own
    // doctrine rather than my caution. `set-factor-value.ts` states it at the
    // call site: "The factor's stored unit is irrelevant to the user's intent —
    // a bare-number proposal '200' ... is ambiguous regardless of whether the
    // factor's existing observed_state.unit is '%'. Refuse rather than guess."
    // Falling back to `factorUnit` here would have silently overturned that
    // ruling for every capless factor, which is precisely the "closed the gap,
    // opened the lie" trade this limb exists to avoid. A bare-number edit stays
    // raw and the gate keeps refusing it, exactly as before.
    //
    // `inputHasUnit` is asserted rather than inferred from `unit` being set:
    // the two are equivalent for today's only caller, and pinning the intent
    // means a future caller that sets one without the other fails loudly here
    // instead of quietly inventing a divisor.
    //
    // ⭐⭐ AND "NO SCALE WAS RECORDED" IS NOT "A SCALE WAS RECORDED AND IT IS
    // INCOMPATIBLE". `resolveScaleFrame` collapses BOTH to `undefined`, and
    // reading only that collapsed answer would treat a factor whose own
    // carriers CONTRADICT EACH OTHER exactly like a factor that simply never
    // had a frame. Measured at this tip before the guard below existed:
    // `{storedFrame: 5, value: 7, raw_value: 7}` is `incoherent`, and a
    // "12 percent" edit on it was written `{12, 0.12}` — i.e. the stated unit
    // OVERRODE a recorded frame the code one line above had just refused to
    // trust. That is the conflation a sibling PR was closed for, and this is
    // now its only home.
    //
    // Why it matters rather than merely being untidy: a contradicted frame is
    // POSITIVE EVIDENCE that this factor's scale is corrupt, and its sibling
    // interventions were framed by whatever the real frame was. Writing a
    // unit-pinned level onto it produces a number that is not comparable to
    // those siblings — the same sibling-distortion harm this whole limb's
    // safety argument is built to avoid, reached through a different door.
    // `resolveScaleFrame`'s own header states the intended behaviour for this
    // case: "this degrades to today's unframed behaviour and the analysis
    // seam's baseline gate refuses honestly and visibly. We stop guessing; the
    // gate keeps refusing." The limb must not quietly overturn that.
    //
    // ⚠ THIS COSTS THE CAPABILITY NOTHING. `checkPairCoherence` is THREE-valued
    // and only `incoherent` suppresses: a factor with no pair at all is
    // `not_checkable`, which is the precise state the capability exists to
    // serve, and it still reaches the pinned limb. Verified in the same run by
    // a contrast control, so this guard is discriminating rather than a blanket
    // that would have re-closed the gap it was written to open.
    const recordedScaleContradictsItself =
      checkPairCoherence({
        storedFrame: factorScaleFrame,
        value: factorObservedValue,
        raw_value: factorObservedRawValue,
      }) === 'incoherent';

    if (!recordedScaleContradictsItself) {
      const statedUnit = inputHasUnit ? unit : undefined;
      const pinnedFrame = unitPinnedScaleFrame(statedUnit, rawInput);
      if (pinnedFrame !== undefined) {
        const pinnedValue = rawInput / pinnedFrame;
        if (Number.isFinite(pinnedValue)) {
          return { raw_value: rawInput, value: pinnedValue };
        }
      }
    }

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
