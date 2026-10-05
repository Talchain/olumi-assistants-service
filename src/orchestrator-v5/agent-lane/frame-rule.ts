/**
 * The legacy construct's per-quantity FRAME rule, in one dependency-free module so the records compile reads the same
 * rule (`cee/draft/records/projector.ts`, pass 2 P2-FRAME) without importing the whole admission module.
 * `admit-model.ts` re-exports both functions; its behaviour is unchanged.
 */

/**
 * The frame is the smallest power of ten strictly above the largest number the model carries for a factor: DERIVED
 * from the data rather than picked; `raw_value` keeps the user's own number untouched. (Moved verbatim from
 * `admit-model.ts`, where its full rationale is kept beside its callers.)
 */
export function defaultFrameFor(largestMagnitude: number): number {
  const magnitude = Math.abs(largestMagnitude);
  if (!Number.isFinite(magnitude) || magnitude <= 1) return 1;
  // ⭐ HEADROOM (AIQ #72 5868446435): the frame sits STRICTLY above the figure, so an exact
  // power of ten takes the next step up — £100,000 → 0–1,000,000 (0.1), never 1.0 of its frame
  // (ISL clips a value at the edge one-sided; PLoT refuses a limit outside the frame). The old
  // `ceil(log10 + EPSILON)` only managed that for 10: above it the EPSILON was lost.
  let frame = 10 ** (Math.floor(Math.log10(magnitude)) + 1);
  // `Math.log10` can round across a power of ten; correct by one step either way.
  if (frame <= magnitude) frame *= 10;
  else if (frame / 10 > magnitude) frame /= 10;
  return frame;
}

/**
 * A stated range (`plausible_max` > 1) is the frame, unless a level exceeds it: then it is WIDENED to the smallest
 * power of ten above the largest such level (`defaultFrameFor`), never kept raw beside normalised siblings.
 */
export function statedRangeFrame(plausibleMax: number, levels: readonly number[]): number {
  const over = levels.filter((level) => Number.isFinite(level) && level > plausibleMax);
  return over.length === 0 ? plausibleMax : defaultFrameFor(Math.max(...over));
}

/**
 * The frame FIELDS the legacy construct writes on a framed factor (`framedObservedState`, `admit-model.ts`), shared so
 * the records compile writes exactly the same ones (F9: the run path's `buildFactorScaleMap` reads `cap`, never
 * `scale_frame`). `undefined` where no 0..cap frame can express the level: a missing/non-finite cap, a cap not
 * strictly above 1, a negative level or a level above the cap.
 */
export function framedFields(raw: number, cap: number | null | undefined):
  { value: number; raw_value: number; cap: number; declared_scale: 'unit_interval' } | undefined {
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 1 || raw < 0 || raw > cap) return undefined;
  return { value: raw / cap, raw_value: raw, cap, declared_scale: 'unit_interval' };
}
