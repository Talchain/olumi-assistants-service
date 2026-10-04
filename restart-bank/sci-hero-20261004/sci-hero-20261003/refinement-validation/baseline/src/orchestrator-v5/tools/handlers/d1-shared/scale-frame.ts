/**
 * SCALE-FRAME RECOVERY — the edit-seam half of the records scale projection.
 *
 * The records projector (pass 3d, `cee/draft/records/projector.ts`) writes
 * magnitude-scaled factors as capless framed pairs: `value` is the level
 * (raw ÷ frame) and `raw_value` is the user's magnitude. The frame itself is
 * deliberately NOT persisted (a stored `cap` flips `normaliseFactorValue` to
 * cap-normalised writes and breaks the user-scale round-trip the golden
 * journey binds), so at edit time it must be RECOVERED from the pair:
 *
 *   frame = raw_value / value          (50000 / 0.5 = 100000)
 *
 * ── PRECONDITIONS COVER THE PRODUCERS' WHOLE PAIR DOMAIN (round 3) ──────────
 * ⚠ The first version copied `buildFactorScaleMap`'s normalised-convention
 * proof verbatim (`value ∈ (0,1]`) — a DRAFT-time invariant. But this
 * function's own consumer creates states OUTSIDE that domain: an over-frame
 * edit writes `{value: 5, raw_value: 500000}` (honest — 5× the frame), and
 * the `value ≤ 1` precondition then refused the very pair the writer had just
 * written, so the NEXT bare edit fell back to the raw write — resurrecting
 * the exact corruption this module exists to close (round-2 re-review, U2,
 * measured). The pair still encodes the frame EXACTLY (raw/value); refusing
 * it was the defect.
 *
 * The predicate is therefore derived from the PRODUCERS' pair domain
 * (enumerated in `__tests__/scale-frame-round3.test.ts`):
 *   framed (draft or edit): {raw/frame, raw} with frame > 1 ⇒ value > 0 and
 *     raw = value×frame > value — IN, whatever side of 1 the value is on;
 *   unframed writers: {x, x} — OUT (`raw > value` fails);
 *   zero / negative pairs: OUT (`value > 0` fails; zero is scale-ambiguous,
 *     negatives sign-symmetrically refused — a negative pair is never a
 *     framed producer state, since frames divide positives).
 * Quotient asserted finite and > 1 because this function is a spec, not an
 * optimisation.
 *
 * Pure, total, no I/O. Consumed by BOTH post-draft baseline writers
 * (`normalise-factor-value.ts` and `canonicalise-value-ops.ts`'s
 * `reconcileObservedValuePair`) so the two cannot drift apart (trap 12).
 */
export function recoverScaleFrame(before: {
  readonly value?: unknown;
  readonly raw_value?: unknown;
}): number | undefined {
  const value = before.value;
  const raw = before.raw_value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (!(value > 0)) return undefined;
  if (!(raw > value)) return undefined;
  const frame = raw / value;
  if (!Number.isFinite(frame) || frame <= 1) return undefined;
  return frame;
}

/**
 * The relative tolerance `checkPairCoherence` allows between a stored frame and
 * the pair beside it.
 *
 * Generous against representation error by ~7 orders of magnitude (a double
 * round-trip through JSON is exact; arithmetic error here is ~1e-16 relative)
 * and still tight enough to bite. The corruption class this guards is
 * order-of-magnitude — a raw magnitude written into `value` beside a draft
 * frame reads as a relative difference near 1, not near 1e-9. A tolerance too
 * slack to fail is the same defect one storey up, so this is pinned in both
 * directions by a just-inside / just-outside twin.
 */
export const PAIR_COHERENCE_RELATIVE_EPSILON = 1e-9;

/**
 * Three answers, and the third one is load-bearing. `not_checkable` is NOT a
 * quiet `coheres`: it is the honest verdict for a factor that has no pair to
 * check against — which is the precise case the stored frame exists to serve.
 */
export type PairCoherence = "coheres" | "incoherent" | "not_checkable";

/**
 * ⭐ DOES THE STORED FRAME AGREE WITH THE PAIR BESIDE IT?
 *
 * `resolveScaleFrame` below has always documented that the two carriers "agree
 * by construction — the pair IS raw/frame". That is true of the projector, and
 * `cee/draft/records/__tests__/scale-frame-carriage.test.ts` asserts it there.
 * It was never checked on a graph that had been through EDITS, and the stored
 * frame was trusted without ever being compared to the pair. This closes that:
 * the stored value is VALIDATED, NOT TRUSTED, and its own domain check
 * (finite, `> 1`) was only ever half of validation.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 * It does NOT bound `value`. A level above 1 is HONEST — it is the truth about
 * an over-frame edit, and an earlier `value <= 1` precondition in this very
 * module WAS the defect (see `recoverScaleFrame`'s header, round 3). Coherence
 * is an assertion about whether three numbers agree, never a claim about which
 * values a user is allowed to state. Enforcing a unit interval here would
 * discard the user's own stated magnitude to satisfy a rule no producer
 * honours.
 *
 * It also does not judge SIGN. Whether a negative magnitude is meaningful is a
 * different question with a different owner; `-74000 / 100000 === -0.74`
 * coheres, and it says so. The estate has shipped an asymmetric guard whose
 * classification quietly differed from its consumer's sign-symmetric one, so
 * the arithmetic is applied as stated and nothing is inferred from sign.
 *
 * ⚠ THE TWO CARRIERS ARE NOT TWINS TO MERGE — THEY ANSWER DIFFERENT QUESTIONS.
 *   · `scale_frame` (this module)          → "what is the DIVISOR?"  — a number.
 *   · `observed_state.declared_scale`      → "what CLASS of scale is this?"
 *     (`unit_interval | ratio | raw_count`, declared in the SHARED contract).
 * `transforms/schema-v3.ts` calls `declared_scale` "a second name for one
 * concept" and asks that they be resolved. Measured at both pins: they are not
 * one concept. Two names for two questions is CORRECT and must stay; two
 * questions under ONE name is the defect class. Collapsing them would lose the
 * divisor, which the class cannot carry.
 *
 * Pure, total, no I/O.
 */
export function checkPairCoherence(input: {
  readonly storedFrame?: unknown;
  readonly value?: unknown;
  readonly raw_value?: unknown;
}): PairCoherence {
  const stored = input.storedFrame;
  // Held to the SAME domain `resolveScaleFrame` accepts. A frame it would
  // refuse anyway must not be reported as judged — that would be a verdict
  // about a value nothing uses.
  if (typeof stored !== "number" || !Number.isFinite(stored) || !(stored > 1)) {
    return "not_checkable";
  }
  const value = input.value;
  const raw = input.raw_value;
  if (typeof value !== "number" || !Number.isFinite(value)) return "not_checkable";
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "not_checkable";

  const expected = raw / stored;
  const magnitude = Math.max(Math.abs(expected), Math.abs(value));
  // Both members zero: arithmetically coherent under every frame. (Whether a
  // zero is scale-AMBIGUOUS is `recoverScaleFrame`'s question, not this one.)
  if (magnitude === 0) return "coheres";

  const relativeDifference = Math.abs(value - expected) / magnitude;
  return relativeDifference <= PAIR_COHERENCE_RELATIVE_EPSILON ? "coheres" : "incoherent";
}

/**
 * ⭐⭐ THE ONE OWNER OF "WHAT FRAME IS THIS FACTOR ON?" — stored first, pair
 * second, nothing third.
 *
 * ── WHY A STORED FRAME EXISTS AT ALL (the defect this closes) ───────────────
 * `recoverScaleFrame` above can only speak for a factor that HAS a pair, and a
 * factor the brief states no value for has none — pass 3d framed its options'
 * intervention magnitudes and wrote the factor nothing. So the user was told
 * "setting a real value would make this result more trustworthy", set one, saw
 * the edit succeed, and the rerun REFUSED (`baseline_scale_unresolved`,
 * wire-witnessed 3/3). Pass 3d now persists the divisor it already computed
 * (`node.scale_frame`), and this function is where the two carriers meet.
 *
 * ── PRECEDENCE, AND WHY IT IS NOT A JUDGEMENT CALL ─────────────────────────
 * They agree by construction wherever both exist — the pair IS raw/frame — and
 * `cee/draft/records/__tests__/scale-frame-carriage.test.ts` asserts that
 * rather than assuming it. Stored wins for the case where they CANNOT agree:
 * the factor with no pair. Pair second, so a graph drafted before the field
 * existed keeps working exactly as it does today (no migration, no backfill).
 *
 * ── THE STORED VALUE IS VALIDATED, NOT TRUSTED ─────────────────────────────
 * Held to the SAME domain `recoverScaleFrame` proves for a recovered frame —
 * finite and strictly `> 1` — so the two paths cannot hand their consumers
 * different classes of answer. The contract declares `.positive()` rather than
 * `> 1` deliberately: a stricter schema would fail the WHOLE node parse on a
 * corrupt value and brick the session, where refusing here degrades to today's
 * unframed behaviour and the analysis seam's honest ask. A `<= 1` frame is not
 * a near-miss to be rounded — it is a value no producer emits, so it is
 * refused rather than repaired.
 *
 * ── ABSENCE IS AN ANSWER, NOT A FAILURE ────────────────────────────────────
 * `undefined` means "this factor is not on a frame", and the callers must
 * write raw — today's behaviour for counts, ratios and unbounded scales, which
 * is CORRECT and is pinned. It deliberately does NOT mean "refuse the edit":
 * this function cannot tell a genuinely unframed factor from a legacy one
 * whose frame was never stored, and breaking the working class to reach the
 * legacy one is a bad trade. Where the raw write really is incoherent, the
 * analysis seam's baseline gate still refuses it, honestly and visibly. We
 * stop guessing; the gate keeps refusing.
 *
 * Pure, total, no I/O. Consumed by both post-draft baseline WRITERS
 * (`normalise-factor-value.ts` and `canonicalise-value-ops.ts`'s
 * `reconcileObservedValuePair`, plus its `findAmbiguousScaleValueOps`
 * prescreen).
 *
 * ⚠⚠ THIS BLOCK CLAIMED "so no caller can hold a private opinion about the
 * frame (trap 12)". THAT WAS FALSE WHEN WRITTEN, and it is corrected in place
 * rather than deleted (trap 14 — an honest confession must not be tidied into
 * an excuse). There is a THIRD reader, and it is not a writer, which is how it
 * escaped the enumeration: `plot-intervention-scale.ts`'s baseline gate calls
 * `recoverScaleFrame` DIRECTLY, so it sees only the `{value, raw_value}` pair
 * and CANNOT see a persisted `scale_frame`. Consequence, measured: a factor
 * whose frame IS resolved by the stored field can still be refused there with
 * `baseline_scale_unresolved`.
 *
 * That residual is CONSERVATIVE — it refuses rather than computes, so it fails
 * in the safe direction — and it is deliberately left alone here: the gate is
 * the estate's refusal authority and widening it is a separate change with its
 * own blast radius. What is NOT acceptable is the sentence that told the next
 * reader the question had one owner when it has three. Enumerate READERS, not
 * writers: a reader that only ever refuses is still a reader.
 *
 * ⚠⚠ AND THE CORRECTION ABOVE UNDERSTATED ITS OWN BLAST RADIUS — corrected
 * again 2026-08-29, in place. Two things it got wrong:
 *
 *  1. IT NAMED ONE GATE. It scoped the consequence to the baseline gate and
 *     `baseline_scale_unresolved`. There is a FOURTH reader on the same seam:
 *     `scaleNumeric`'s rule 1, the INTERVENTION path. It was blind to a
 *     persisted `scale_frame` in exactly the same way, and it is the one a user
 *     actually hits — Paul's session was refused `mixed_scale_unresolved` on
 *     four cells whose frames (5 and 200000, the second being his own £200,000
 *     budget) were sitting in `node.scale_frame` and were ALSO recoverable from
 *     each cell's `{value, raw_value}` pair. Both carriers agreed; neither was
 *     read. Enumerating readers is only half the discipline — the enumeration
 *     must also state which SURFACE each reader's blindness reaches.
 *
 *  2. "CONSERVATIVE ... FAILS IN THE SAFE DIRECTION" IS NOT TRUE OF THE USER-
 *     FACING HALF. Refusing rather than computing is safe for the NUMBERS, and
 *     that judgement stands — a wrongly-permitted rescale returns confidently
 *     wrong answers and is much worse. But the copy the intervention refusal
 *     ships says "I don't have a step I can promise will clear it", so on this
 *     class the safe direction terminates in a DEAD END on a model the user has
 *     not touched: measured 2 of 8 fresh drafts of one ordinary brief on
 *     deployed staging, 2026-08-29. A refusal is only conservative when the
 *     user can act on it; otherwise "safe" is being scored against the engine
 *     and not against the person.
 *
 * The intervention limb is now closed — `scaleNumeric` consults
 * `recoverScaleFrame`, so a pair-carried frame demotes instead of dead-ending.
 * The BASELINE limb described above is still open and still real.
 */
export function resolveScaleFrame(input: {
  /** The factor's persisted `scale_frame`, if any. */
  readonly storedFrame?: unknown;
  readonly value?: unknown;
  readonly raw_value?: unknown;
}): number | undefined {
  const stored = input.storedFrame;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 1) {
    // ⭐ THE STORED VALUE IS VALIDATED, NOT TRUSTED — and its domain check was
    // only half of validation. Where the factor HAS a pair, that pair is
    // independent evidence about the same question, and a stored frame it
    // contradicts is wrong under every reading.
    //
    // Refuse rather than substitute. Returning the pair-recovered frame here
    // would be the measured-WORSE option: a frame derived from the baseline
    // alone ignores the sibling interventions the real frame was derived WITH
    // (9 of 25 framings distorted, worst 100x — `records/projector.ts`). So
    // this degrades to today's unframed behaviour and the analysis seam's
    // baseline gate refuses honestly and visibly. We stop guessing; the gate
    // keeps refusing.
    //
    // ⚠ NOTE WHICH CASE IS UNTOUCHED, because it is the case this field was
    // introduced for: a factor with NO pair is `not_checkable`, so the stored
    // frame still wins. Nothing that works today is refused by this.
    if (
      checkPairCoherence({
        storedFrame: stored,
        value: input.value,
        raw_value: input.raw_value,
      }) === "incoherent"
    ) {
      return undefined;
    }
    return stored;
  }
  return recoverScaleFrame({ value: input.value, raw_value: input.raw_value });
}
