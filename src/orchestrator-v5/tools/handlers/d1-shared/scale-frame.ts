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
 * ── PRECONDITIONS MIRROR THE ANALYSIS SEAM'S OWN PROOF ──────────────────────
 * `buildFactorScaleMap`'s normalised-convention evidence
 * (`plot-intervention-scale.ts:369`): a pair proves a frame only when
 * `value ∈ (0,1]` (zero is scale-ambiguous, negatives sign-symmetrically
 * refused) AND `raw_value > value` (real downscaling occurred — this is what
 * makes recovery IMPOSSIBLE on the unframed capless shape `raw == value`,
 * so ordinary count/ratio factors are untouched). Both finite; the quotient
 * finite and > 1 by construction, asserted anyway because this function is a
 * spec, not an optimisation.
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
  if (!(value > 0 && value <= 1)) return undefined;
  if (!(raw > value)) return undefined;
  const frame = raw / value;
  if (!Number.isFinite(frame) || frame <= 1) return undefined;
  return frame;
}
