/**
 * Prompts readiness probe.
 *
 * Single boolean exposed on /healthz: `prompts_ready`. True iff each of the
 * five PMS-tracked prompt keys resolves from any source (store or registered
 * default). The result is cached briefly so /healthz hits don't hammer the
 * loader.
 *
 * Telemetry from these probe calls passes `trigger: 'healthz'` / `'status'`
 * so dashboards can filter probe noise out of real-traffic
 * `v5.prompt_resolved` events.
 */

import { createHash } from 'node:crypto';
import { loadPrompt, type PromptResolveTrigger } from './loader.js';
import {
  TRACKED_KEYS,
  type TrackedKey,
  mapSource,
  resolvePublicVersion,
  type PublicSource,
} from './tracked.js';
import { log } from '../utils/telemetry.js';

const READINESS_CACHE_TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;
// Single-flight: coalesce concurrent probe calls so /healthz under burst
// doesn't issue N parallel 5-key probes. Once the first probe resolves it
// populates `cached`; subsequent callers within the TTL hit the cache.
let inflightProbe: Promise<boolean> | null = null;

export interface PromptKeyStatus {
  key: TrackedKey;
  source: PublicSource | 'error';
  version: string | null;
  content_hash: string | null;
  content_chars: number | null;
  error?: string;
}

function shortSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Resolve every tracked prompt key once and report per-key status.
 * Used by /admin/prompts/status (full detail) and arePromptsReady() (boolean).
 */
export async function probeTrackedPrompts(
  trigger: PromptResolveTrigger,
): Promise<PromptKeyStatus[]> {
  const results = await Promise.all(
    TRACKED_KEYS.map(async (key): Promise<PromptKeyStatus> => {
      try {
        const loaded = await loadPrompt(key, { trigger });
        return {
          key,
          source: mapSource(loaded.source),
          version: resolvePublicVersion(key, loaded.source, loaded.version),
          content_hash: shortSha256(loaded.content),
          content_chars: loaded.content.length,
        };
      } catch (err) {
        return {
          key,
          source: 'error',
          version: null,
          content_hash: null,
          content_chars: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return results;
}

/**
 * Cheap boolean for /healthz. Cached for 30s; concurrent callers share a
 * single in-flight probe.
 */
export async function arePromptsReady(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (inflightProbe) return inflightProbe;

  inflightProbe = (async (): Promise<boolean> => {
    try {
      const statuses = await probeTrackedPrompts('healthz');
      const ready = statuses.every((s) => s.source !== 'error');
      cached = { value: ready, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
      return ready;
    } catch (err) {
      log.warn({ err }, 'prompts_ready probe failed');
      cached = { value: false, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
      return false;
    } finally {
      inflightProbe = null;
    }
  })();
  return inflightProbe;
}

/**
 * Drop the readiness cache so the next call re-probes. Used by the admin
 * reload endpoint (so post-reload `/healthz` reflects the new state) and
 * by tests that need a clean slate.
 */
export function resetPromptsReadyCache(): void {
  cached = null;
}

/** @deprecated use resetPromptsReadyCache() — kept for back-compat. */
export const __resetPromptsReadyCacheForTests = resetPromptsReadyCache;

export { TRACKED_KEYS } from './tracked.js';
