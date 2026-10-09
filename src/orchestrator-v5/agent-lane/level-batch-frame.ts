import { defaultFrameFor } from './admit-model.js';

/** Resolve derived ranges over the complete native cohort, never its first/last member. */
export function proposedFrameForLevels(levels: readonly { raw_value?: number; cap?: number }[]): number | null {
  const native = levels.flatMap(l => typeof l.raw_value === 'number' && Number.isFinite(l.raw_value) ? [l.raw_value] : []);
  if (native.length === 0) return null;
  const largest = Math.max(...native.map(Math.abs));
  const caps = [...new Set(levels.flatMap(l => typeof l.cap === 'number' && Number.isFinite(l.cap) && l.cap > 0 ? [l.cap] : []))];
  if (caps.length === 1 && caps[0]! >= largest) return caps[0]!;
  return largest > 1 || caps.length > 1 ? defaultFrameFor(largest) : null;
}

/** Preserve the native point and all other metadata while changing its coordinate frame. */
export function levelOnFinalFrame<T extends { value: number; raw_value?: number; cap?: number }>(level: T, cap: number | null): T {
  return cap !== null && typeof level.raw_value === 'number' && Number.isFinite(level.raw_value)
    ? { ...level, value: level.raw_value / cap, cap } : level;
}
