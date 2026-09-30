import type { CeeTaskId } from './schema.js';
import type { FallbackReason } from './resolution-policy.js';
import { isTrackedKey, resolvePublicVersion, type PublicSource, type TrackedKey } from './tracked.js';

/** The last actual runtime lookup for each health-gating prompt. No I/O. */
export interface RuntimePromptResolution {
  source: PublicSource;
  version: string;
  fallback_reason?: FallbackReason;
}

const runtimeResolutions = new Map<TrackedKey, RuntimePromptResolution>();

export function recordRuntimePromptResolution(
  key: CeeTaskId,
  source: 'store' | 'default',
  version: number | undefined,
  fallbackReason?: FallbackReason,
): void {
  if (!isTrackedKey(key)) return;
  // A forced/default-only resolution did not test the store and cannot clear
  // an earlier fetch error. Store success and a genuine not-found do test it.
  if (source === 'default' && fallbackReason !== 'fetch_error' && fallbackReason !== 'not_found') return;
  runtimeResolutions.set(key, {
    source: source === 'store' ? 'pms' : 'default',
    version: resolvePublicVersion(key, source, version),
    ...(fallbackReason && fallbackReason !== 'none' ? { fallback_reason: fallbackReason } : {}),
  });
}

export function getRuntimePromptResolution(key: TrackedKey): RuntimePromptResolution | undefined {
  return runtimeResolutions.get(key);
}

export function clearRuntimePromptResolutions(): void {
  runtimeResolutions.clear();
}
