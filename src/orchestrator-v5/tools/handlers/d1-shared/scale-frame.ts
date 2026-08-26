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
 */
export function resolveScaleFrame(input: {
  /** The factor's persisted `scale_frame`, if any. */
  readonly storedFrame?: unknown;
  readonly value?: unknown;
  readonly raw_value?: unknown;
}): number | undefined {
  const stored = input.storedFrame;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 1) return stored;
  return recoverScaleFrame({ value: input.value, raw_value: input.raw_value });
}
