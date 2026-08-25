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

// ───────────────────────────────────────────────────────────────────────────
// FRAME DERIVATION — the inverse of `recoverScaleFrame`, in the same module.
//
// Lifted here from `cee/draft/records/projector.ts` (row 2.1103). It was the
// records projector's private derivation; the edit seam now needs the SAME
// answer, and this estate's most repeated defect is two implementations of one
// derivation drifting apart (the two `generateGraphHash` twins, trap 12). So
// there is ONE home for "what is this factor's frame" — derived here, recovered
// above — and `projector.ts` re-exports these four names so every existing
// importer keeps working against the same bytes.
//
// Deliberately still a pure leaf: this module imports nothing, which is what
// makes it safe for both `cee/draft/records/` and `orchestrator-v5/` to depend
// on it without a cycle.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The percent-scaled unit vocabulary — the corpus spellings plus the ones an
 * adversarial review supplied from OUTSIDE that corpus ("per cent" — this is a
 * British-English estate — and "pct"). Trap 22: the corpus-only version
 * silently read "3 per cent" as a derived-frame 0.6.
 */
export function isPercentScaledUnit(unit: string | undefined): boolean {
  if (typeof unit !== "string") return false;
  const t = unit.trim().toLowerCase();
  return t.startsWith("%") || t.startsWith("percent") || t.startsWith("per cent") || t.startsWith("pct");
}

/**
 * Basis points declare scale 10,000 — NOT 100. Lumping "bps" into the percent
 * set would be a 100× error in the opposite direction (30 bps = 0.003, never
 * 0.3). Narrow on purpose: "bps" and "basis point(s)"; a bare "bp" is left to
 * the derived frame rather than guessed.
 */
export function isBasisPointsUnit(unit: string | undefined): boolean {
  if (typeof unit !== "string") return false;
  const t = unit.trim().toLowerCase();
  return t.startsWith("bps") || t.startsWith("basis point");
}

/**
 * The smallest {1,2,5}·10^k STRICTLY greater than `x` (x > 0, finite).
 * Pure arithmetic, no floating log tricks at the boundaries: the exponent scan
 * starts safely below x and walks up, so exact powers (100 → 200) behave.
 */
export function nextNiceNumberAbove(x: number): number {
  let magnitude = 10 ** Math.floor(Math.log10(x));
  // Math.log10 can land one bucket high or low at representation boundaries;
  // step down until magnitude ≤ x so the candidate walk below is complete.
  while (magnitude > x) magnitude /= 10;
  for (;;) {
    for (const m of [1, 2, 5]) {
      const candidate = m * magnitude;
      if (candidate > x) return candidate;
    }
    magnitude *= 10;
  }
}

/**
 * The per-factor frame, or `undefined` when none is needed (already unit
 * interval) or none truthfully exists (a negative magnitude).
 *
 * ⚠ CALLER OBLIGATION: every magnitude must be FINITE. `nextNiceNumberAbove`
 * does not terminate on NaN (`Math.log10(NaN)` → NaN → no candidate ever
 * exceeds NaN), and `Math.max` propagates one NaN through the whole array. The
 * projector's own call site filters with `Number.isFinite` before calling; the
 * edit seam asserts it too. Stated rather than defended in code because both
 * live callers already hold the guarantee and a silent re-check here would hide
 * a caller defect rather than surface it.
 */
export function deriveFactorScaleFrame(
  magnitudes: readonly number[],
  unit: string | undefined,
): number | undefined {
  if (magnitudes.length === 0) return undefined;
  if (magnitudes.some((m) => m < 0)) return undefined;
  const max = Math.max(...magnitudes);
  if (max <= 1) return undefined;
  if (isPercentScaledUnit(unit) && max <= 100) return 100;
  if (isBasisPointsUnit(unit) && max <= 10000) return 10000;
  const frame = nextNiceNumberAbove(max);
  // ~1.6e308 upward the {1,2,5}·10^k ladder overflows to Infinity, and an
  // infinite frame would ship a fabricated level 0 under a green guard
  // (review breadth finding). Non-finite frame → unframed, the honest path.
  if (!Number.isFinite(frame)) return undefined;
  return frame;
}
