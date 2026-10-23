/**
 * A range is not a law. This is the ONE reading the simulator applies to a `range`, and it is CEE's existing one, reused, not a
 * new choice: `rangeSpread` in `src/orchestrator-v5/path-b/living-model/mapper.ts:104-110` (#3678 for a bare link range, #3688
 * for a level's range; the DL's "existing AIE conversion"), with the mapper's own rule for when a level's range is used as its
 * spread (mapper.ts:571-578, DL ruling on #3688: "draws on the far side of zero stay near 2% or below").
 *   - The law: a Normal with uniform-matched moments, sd = (high − low)/√12 (mapper.ts:106), centred on the stated most likely
 *     value, or, with none, on the middle (mapper.ts:861, #3678).
 *   - The spread is used only where the draws keep their sign: the centre strictly inside the range (mapper.ts:572) and either
 *     the range crosses zero or |centre| ≥ 2 sd (mapper.ts:573).
 *   - Otherwise, as the mapper does: a most likely value is used as the figure, and the range is kept but not used as a spread
 *     (mapper.ts:578); a bare range has no figure to fall back on, so it is held (the mapper holds a bare level range,
 *     mapper.ts:580 `level_range_not_in_slice`), and the compiler must withhold what rests on it. Never an invented point.
 *   - A most likely value at or outside an end is a malformed range: it throws (DL ruling 4, 23 Oct; S1 refuses it at compile).
 *   - A chance (a risk's occurrence) is bounded by meaning: its spread is always used, and the simulator clips its draws to
 *     [0, 1] (DL ruling, 23 Oct). The sign rule is not needed for it.
 * The law is Olumi's assumption, never the person's calibration; the ends stay as stated, and `basis` says whose they are.
 */
import type { Dist } from '../executable.js';

export type RangeDist = Extract<Dist, { kind: 'range' }>;

export type RangeReading =
  | { readonly kind: 'normal'; readonly centre: number; readonly sd: number }
  | { readonly kind: 'point'; readonly value: number }
  | { readonly kind: 'held'; readonly reason: string };

export function rangeLaw(d: RangeDist, opts: { readonly chance?: boolean } = {}): RangeReading {
  const { low, high, mode } = d;
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(low < high)) {
    throw new Error(`range ${low} to ${high} is not low < high with finite ends`);
  }
  if (mode !== undefined && !(Number.isFinite(mode) && low < mode && mode < high)) {
    throw new Error(`range ${low} to ${high}: most likely value ${mode} is not strictly inside it`);
  }
  const sd = (high - low) / Math.sqrt(12);
  const centre = mode ?? (low + high) / 2;
  const keepsSign = (low < 0 && high > 0) || Math.abs(centre) >= 2 * sd;
  if (opts.chance === true || keepsSign) return { kind: 'normal', centre, sd };
  if (mode !== undefined) return { kind: 'point', value: mode };
  return { kind: 'held', reason: `the range ${low} to ${high} has no most likely value, and a spread matching its width would draw values on the other side of zero` };
}
