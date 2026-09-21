/**
 * Replacement conversation layer — WHAT RANGE IS A FACTOR'S EFFECT A SHARE OF?
 *
 * ⭐ WHY THIS IS ITS OWN MODULE, AND WHY THAT IS THE WHOLE POINT.
 *
 * `set_option_effect` takes a share in [0, 1]. A share of WHAT was, until now,
 * a question only `set-option-effect.ts` could answer: it carried this
 * derivation inline, and the model's own view of the workspace
 * (`read-tools.ts`) never showed a range at all. So the model was asked to
 * express "£59" as a share of a range IT COULD NOT SEE, and the only way to
 * produce a number was to guess one.
 *
 * Closing that by writing a SECOND derivation in `read-tools.ts` would have
 * been the estate's most expensive defect wearing a fix's clothes: two
 * functions answering "what is this factor's range?", free to drift, so the
 * range the model is SHOWN could stop being the range the tool ACCEPTS — and
 * every symptom of that would look like the model guessing again.
 *
 * One function, imported by both. The shown range and the accepted range are
 * the same bytes by construction, not by anyone remembering (CLAUDE.md trap
 * 12 — derive, don't mirror; trap 21 — two authorities answering what looks
 * like one question).
 *
 * ── WHAT A REAL FACTOR CARRIES, DERIVED FROM CAPTURED WIRE ──────────────────
 *
 * This derivation was wrong TWICE before it was measured, both times because
 * the fixture encoded the author's model of the producer rather than the
 * producer itself. That history is kept here because it is the reason for
 * every arm below:
 *
 *   v1 read `range.{range_min, range_max}` — a combination declared in no
 *   schema. It refused every real factor.
 *
 *   v2 accepted `prior.{range_min, range_max}` or `range.{min, max}`, derived
 *   from the SCHEMAS. Still wrong: against 13 factor nodes from three real
 *   captures, `range` appears on ZERO and `prior` on ONE. It would have
 *   accepted 1 of 13.
 *
 * `GraphStateIngress` is `.passthrough()`, so the schemas were never the whole
 * story and reading them harder could not have found this. What real factors
 * actually carry, all captures agreeing:
 *
 *   · `scale_frame` — a NUMBER that is the range MAXIMUM, minimum implied 0.
 *     `observed_state.raw_value / scale_frame === observed_state.value` held
 *     in 6 of 6 cases. This is the producer's OWN normalisation basis, which
 *     is why it is named first among the derived arms.
 *   · `unit: 'scale'` with no frame — already normalised to [0, 1]. 5 of 13.
 *   · `prior: {distribution, range_min, range_max}` — a genuinely stated
 *     range. 1 of 13.
 *   · `observed_state.cap` — a clamping divisor. Simulated over 555 real
 *     factors: 242 refused for want of a range, 94 of those carrying a
 *     positive cap.
 *
 * ⛔ AN IGNORANCE PRIOR IS NOT A RANGE. `buildUnquantifiedPrior()` writes
 * `{uniform, 0, 1, prior_is_unquantified: true}` — U(0,1) meaning "nobody has
 * said". Accepting it would let an effect be set against a range no human ever
 * stated: the exact fabrication the guard exists to prevent, arriving through
 * the guard. Refused by name, and the refusal is reported separately from a
 * plain absence because the two need different things said to the user.
 */

/** Which field supplied the range. Named so a caller can say WHY, never to branch on. */
export type FactorRangeBasis =
  | 'stated_prior'
  | 'scale_frame'
  | 'cap'
  | 'declared_range'
  | 'already_normalised';

export interface FactorBounds {
  readonly lo: number;
  readonly hi: number;
  readonly basis: FactorRangeBasis;
}

/**
 * Why no range could be established. A placeholder someone never filled in is
 * a DIFFERENT situation from a factor nobody has bounded, and the conversation
 * must say different things about them — so they are different members here
 * rather than one `null` standing in for two worlds.
 */
export type FactorRangeAbsence = 'unquantified_placeholder' | 'no_range_stated';

export type FactorRangeOutcome =
  | { readonly ok: true; readonly bounds: FactorBounds }
  | { readonly ok: false; readonly absence: FactorRangeAbsence };

/** The shape this reads. Deliberately structural: the ingress graph is passthrough. */
interface RangeBearingNode {
  readonly prior?: { range_min?: unknown; range_max?: unknown; prior_is_unquantified?: unknown };
  readonly range?: { min?: unknown; max?: unknown };
  readonly scale_frame?: unknown;
  readonly observed_state?: { unit?: unknown; value?: unknown; cap?: unknown; raw_value?: unknown };
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the range an effect on this factor would be a share of.
 *
 * ⚠ ORDER IS DELIBERATE AND ONE ARM'S PLACEMENT IS RULED. `scale_frame` is the
 * producer's own normalisation basis, so where it exists it is the basis
 * named. `cap` is read AFTER it, because a cap divides AND CLAMPS and exempts
 * the factor from the analysis baseline gate, while a frame does neither and
 * is a property of the magnitude SET rather than of the node — three modules
 * rule them different questions (`schemas/graph.ts:420-435`,
 * `projector.ts:1307`, `set-factor-value.ts:538-543`, the last citing trap 21
 * by name). Reading both is safe here because this answers only "is there ANY
 * stated basis a share is meaningful against, and what is it".
 *
 * ⚠ `> 0` on frame and cap is load-bearing: `cap === 0` is the MODAL cap value
 * in the estate (247 occurrences) and is not a usable basis. A zero must fail
 * the test, never yield `{lo: 0, hi: 0}` — which would make every share a
 * division by zero one layer down.
 */
export function resolveFactorRange(factor: unknown): FactorRangeOutcome {
  if (factor === null || typeof factor !== 'object') {
    return { ok: false, absence: 'no_range_stated' };
  }
  const f = factor as RangeBearingNode;

  // Checked FIRST and reported by name: a placeholder must never fall through
  // to a later arm and get accepted on some other field's evidence.
  if (f.prior?.prior_is_unquantified === true) {
    return { ok: false, absence: 'unquantified_placeholder' };
  }

  if (typeof f.prior?.range_min === 'number' && typeof f.prior?.range_max === 'number') {
    return { ok: true, bounds: { lo: f.prior.range_min, hi: f.prior.range_max, basis: 'stated_prior' } };
  }
  if (positiveFinite(f.scale_frame)) {
    return { ok: true, bounds: { lo: 0, hi: f.scale_frame, basis: 'scale_frame' } };
  }
  if (positiveFinite(f.observed_state?.cap)) {
    return { ok: true, bounds: { lo: 0, hi: f.observed_state.cap as number, basis: 'cap' } };
  }
  // Kept because the contract declares it, though no capture shows one:
  // absence from three captures is not proof it never appears, and a declared
  // field costs one branch to honour.
  if (typeof f.range?.min === 'number' && typeof f.range?.max === 'number') {
    return { ok: true, bounds: { lo: f.range.min, hi: f.range.max, basis: 'declared_range' } };
  }
  if (f.observed_state?.unit === 'scale' && typeof f.observed_state?.value === 'number') {
    return { ok: true, bounds: { lo: 0, hi: 1, basis: 'already_normalised' } };
  }
  return { ok: false, absence: 'no_range_stated' };
}

/**
 * The share of `bounds` that `native` sits at.
 *
 * ⭐ THE AFFINE FORM IS NOT A CHOICE, IT IS THE PRODUCER'S OWN ARITHMETIC,
 * MEASURED. In every captured factor carrying both a frame and an observed
 * state, `raw_value / scale_frame === observed_state.value` exactly — £380,000
 * over a £500,000 frame is the stored 0.76; 0.75 months over a 10-month frame
 * is the stored 0.075. With `lo = 0` the general form `(native - lo) / (hi -
 * lo)` reduces to precisely that division, so this reproduces the producer
 * rather than inventing a second convention beside it.
 *
 * Returns `null` when the bounds are degenerate. A zero-width range has no
 * shares, and returning `Infinity` or `NaN` from here would put a non-number
 * into a contract that promises [0, 1].
 */
export function shareOfRange(native: number, bounds: FactorBounds): number | null {
  if (!Number.isFinite(native)) return null;
  const width = bounds.hi - bounds.lo;
  if (!Number.isFinite(width) || width === 0) return null;
  const share = (native - bounds.lo) / width;
  return Number.isFinite(share) ? share : null;
}

/**
 * Round a derived share for reading and for storing.
 *
 * The division reintroduces float dirt (0.59 of a 100 frame is
 * 0.5899999999999999) and a share offered to a user as "0.5899999999999999"
 * would be a new defect in the very confirmation built to prevent one.
 * Bounded by the VALUE rather than by a fixed multiplier, on the same
 * reasoning `graph-compact.ts` states for the mirror-image multiplication.
 */
export function roundShare(share: number): number {
  return Number(share.toPrecision(12));
}

/** `lo to hi`, with the unit when one is established. For display only. */
export function describeRange(bounds: FactorBounds, unit: string | null): string {
  const suffix = unit === null || unit.length === 0 || unit === 'scale' ? '' : ` ${unit}`;
  return `${Number(bounds.lo.toPrecision(12))} to ${Number(bounds.hi.toPrecision(12))}${suffix}`;
}
