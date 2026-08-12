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
