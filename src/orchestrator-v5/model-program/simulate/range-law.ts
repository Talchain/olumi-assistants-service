/**
 * A range is not a law. This is the ONE conversion the simulator applies to a `range`, and it is CEE's existing one, reused, not
 * a new choice: `rangeSpread` in `src/orchestrator-v5/path-b/living-model/mapper.ts:104-110` (#3678 for a bare link range, #3688
 * for a level's range; the DL's "existing AIE conversion"), as the mapper applies it to a factor's level (mapper.ts:571-574) and
 * to a bare link range (mapper.ts:858-861, :875). The engine draws it as a Normal with uniform-matched moments:
 *   - spread: sd = (high − low) / √12 (mapper.ts:106);
 *   - centre: the stated most likely value when it lies strictly inside the range (mapper.ts:572, a level's figure
 *     strictly inside its range), else, with no most likely value, the middle (mapper.ts:861, #3678).
 * The law is Olumi's assumption, never the person's calibration; the ends stay as stated on the Dist, whose `basis` says
 * whose ends they are. A most likely value at or outside an end, or a range that is not low < high, is refused: the mapper
 * keeps base behaviour there, which is the compiler's decision, never a silent law here.
 */
import type { Dist } from '../executable.js';

export type RangeDist = Extract<Dist, { kind: 'range' }>;

export interface NormalLaw {
  readonly centre: number;
  readonly sd: number;
}

export function rangeLaw(d: RangeDist): NormalLaw {
  const { low, high, mode } = d;
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(low < high)) {
    throw new Error(`range ${low} to ${high} is not low < high with finite ends`);
  }
  if (mode !== undefined && !(Number.isFinite(mode) && low < mode && mode < high)) {
    throw new Error(`range ${low} to ${high}: most likely value ${mode} is not strictly inside it`);
  }
  return { centre: mode ?? (low + high) / 2, sd: (high - low) / Math.sqrt(12) };
}
