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
  STATUS_KEYS,
  type TrackedKey,
  type StatusKey,
  mapSource,
  resolvePublicVersion,
  type PublicSource,
} from './tracked.js';
import { dispositionOf, gateOf, type PromptDisposition } from './estate.js';
import { log } from '../utils/telemetry.js';
import { getRoutingLiveStatus } from './routing-live-status.js';
import type { CeeTaskId } from './schema.js';

const READINESS_CACHE_TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;
// Single-flight: coalesce concurrent probe calls so /healthz under burst
// doesn't issue N parallel 5-key probes. Once the first probe resolves it
// populates `cached`; subsequent callers within the TTL hit the cache.
let inflightProbe: Promise<boolean> | null = null;

// Separate cache for the PMS-coverage view. Kept independent of `cached`
// above so the existing arePromptsReady() path stays byte-for-byte unchanged.
let coverageCached: { value: CriticalPromptCoverage; expiresAt: number } | null = null;
let inflightCoverage: Promise<CriticalPromptCoverage> | null = null;

export interface PromptKeyStatus {
  key: StatusKey;
  source: PublicSource | 'error';
  version: string | null;
  content_hash: string | null;
  content_chars: number | null;
  error?: string;
  /** Alias-aware PMS task this key resolves from (e.g. routing→orchestrator). */
  pms_task?: CeeTaskId;
  /**
   * Set on the `routing` row when the LIVE served snapshot is stale because
   * a later rebuild was rejected (e.g. an oversized PMS prompt) and the
   * prior snapshot was restored. Surfacing this prevents a false-green where
   * the raw PMS row reads OK but is NOT what's actually served.
   */
  snapshot_error?: string;
  /**
   * Estate disposition: `live` (resolves on a live path) or `gated` (wired,
   * but behind the named off-by-default `gate`). Derived — see
   * `src/prompts/estate.ts`.
   */
  disposition?: PromptDisposition;
  /** Env var gating this prompt's call site, when `disposition === 'gated'`. */
  gate?: string;
  /** True when this key GATES health (`prompts_ready` / `all_pms`). */
  critical?: boolean;
}

function shortSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Resolve a given set of prompt keys once and report per-key status.
 *
 * Two callers, two sets, deliberately:
 *   - `probeTrackedPrompts()` → the CRITICAL five, for health GATING.
 *   - `probeStatusPrompts()`  → the derived REPORTED set, for observability.
 */
async function probePromptKeys(
  keys: readonly StatusKey[],
  trigger: PromptResolveTrigger,
): Promise<PromptKeyStatus[]> {
  const results = await Promise.all(
    keys.map(async (key): Promise<PromptKeyStatus> => {
      const meta = {
        disposition: dispositionOf(key),
        ...(gateOf(key) ? { gate: gateOf(key) } : {}),
        critical: (TRACKED_KEYS as readonly string[]).includes(key),
      };
      // The `routing` key reports from the LIVE served snapshot
      // (guard-applied, atomically swapped), NOT a raw unguarded
      // loadPrompt read of the current PMS row. This closes the
      // oversized-reload false-green: after a rejected rebuild the live
      // snapshot is the prior one, and `snapshot_error` flags the staleness.
      if (key === 'routing') {
        const live = getRoutingLiveStatus();
        if (live) {
          return {
            key,
            source: live.source,
            version: live.version,
            content_hash: live.content_hash,
            content_chars: live.content_chars,
            pms_task: live.pms_task,
            ...(live.snapshot_error ? { snapshot_error: live.snapshot_error } : {}),
            ...meta,
          };
        }
        // No snapshot built yet (pre-boot) → fall through to loadPrompt.
      }
      try {
        const loaded = await loadPrompt(key, { trigger });
        return {
          key,
          source: mapSource(loaded.source),
          version: resolvePublicVersion(key, loaded.source, loaded.version),
          content_hash: shortSha256(loaded.content),
          content_chars: loaded.content.length,
          ...meta,
        };
      } catch (err) {
        return {
          key,
          source: 'error',
          version: null,
          content_hash: null,
          content_chars: null,
          error: err instanceof Error ? err.message : String(err),
          ...meta,
        };
      }
    }),
  );
  return results;
}

/**
 * Resolve the CRITICAL prompt keys — the health-gating five. Feeds
 * `arePromptsReady()` and `getCriticalPromptCoverage()`.
 *
 * DELIBERATELY NOT WIDENED. `all_pms` is the "safe to arm fail-closed?"
 * signal on /healthz; widening it to every reported prompt would flip a live
 * health surface (`m2_graph_review` has no PMS row at all, by design).
 */
export async function probeTrackedPrompts(
  trigger: PromptResolveTrigger,
): Promise<Array<PromptKeyStatus & { key: TrackedKey }>> {
  // Narrowing cast, not a widening one: the rows come back keyed by exactly
  // the TRACKED_KEYS passed in, so the critical-coverage callers keep their
  // `TrackedKey` typing even though the shared prober is set-agnostic.
  return (await probePromptKeys(TRACKED_KEYS, trigger)) as Array<
    PromptKeyStatus & { key: TrackedKey }
  >;
}

/**
 * Resolve the DERIVED reported set — every live PMS prompt plus the
 * gated-but-wired ones. Feeds `/admin/prompts/status` and
 * `/admin/prompts/inventory`.
 *
 * This is the mirror-killer: the set comes from the operation map minus two
 * drift-guarded exception lists, so a newly wired prompt shows up here with
 * nobody remembering to add it.
 */
export async function probeStatusPrompts(
  trigger: PromptResolveTrigger,
): Promise<PromptKeyStatus[]> {
  return probePromptKeys(STATUS_KEYS, trigger);
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
 * Per-key PMS coverage for the critical (tracked) prompt keys. `all_pms` is the
 * honest "is it safe to arm fail-closed?" signal — true iff every critical key
 * resolves from PMS (not a bundled default, not an error). Distinct from
 * `arePromptsReady()`, which counts *any* source as ready.
 */
export interface CriticalPromptCoverage {
  all_pms: boolean;
  keys: Array<{
    key: TrackedKey;
    source: PublicSource | 'error';
    version: string | null;
    /** Alias-aware PMS task (e.g. routing→orchestrator). */
    pms_task?: CeeTaskId;
    /** Set when this key serves a STALE snapshot (a later rebuild was rejected). */
    snapshot_error?: string;
  }>;
  /** Critical keys NOT resolving from PMS (default or error) — the offenders. */
  default_or_error: TrackedKey[];
  /**
   * Critical keys serving a STALE snapshot: resolved from PMS, but a later
   * rebuild was REJECTED (e.g. an oversized prompt) and the prior snapshot was
   * restored. These ALSO fail `all_pms` — `all_pms===true` must mean the
   * LATEST PMS prompt is live (the fail-closed-arming contract), not merely
   * "some PMS prompt is served". Without this, a rejected oversized routing
   * reload would leave the operator health gate falsely green.
   */
  snapshot_errors: TrackedKey[];
}

/**
 * Cheap critical-prompt coverage for `/healthz` + startup logging. Cached for
 * 30s with single-flight, mirroring `arePromptsReady()`. Never throws — on
 * probe failure every key is reported `error` (→ `all_pms:false`).
 */
export async function getCriticalPromptCoverage(
  trigger: PromptResolveTrigger = 'healthz',
): Promise<CriticalPromptCoverage> {
  const now = Date.now();
  if (coverageCached && coverageCached.expiresAt > now) return coverageCached.value;
  if (inflightCoverage) return inflightCoverage;

  inflightCoverage = (async (): Promise<CriticalPromptCoverage> => {
    try {
      const statuses = await probeTrackedPrompts(trigger);
      const keys = statuses.map((s) => ({
        key: s.key,
        source: s.source,
        version: s.version,
        ...(s.pms_task ? { pms_task: s.pms_task } : {}),
        ...(s.snapshot_error ? { snapshot_error: s.snapshot_error } : {}),
      }));
      const default_or_error = statuses
        .filter((s) => s.source !== 'pms')
        .map((s) => s.key);
      // A STALE snapshot (PMS-resolved, but a later rebuild was rejected and the
      // prior snapshot restored) must also fail coverage: `all_pms` is the
      // "latest PMS prompt is live" gate, not "some PMS prompt is served".
      const snapshot_errors = statuses
        .filter((s) => s.snapshot_error != null)
        .map((s) => s.key);
      const coverage: CriticalPromptCoverage = {
        all_pms: default_or_error.length === 0 && snapshot_errors.length === 0,
        keys,
        default_or_error,
        snapshot_errors,
      };
      coverageCached = { value: coverage, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
      return coverage;
    } catch (err) {
      log.warn({ err }, 'critical_prompt_coverage probe failed');
      const coverage: CriticalPromptCoverage = {
        all_pms: false,
        keys: TRACKED_KEYS.map((key) => ({ key, source: 'error' as const, version: null })),
        default_or_error: [...TRACKED_KEYS],
        snapshot_errors: [],
      };
      coverageCached = { value: coverage, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
      return coverage;
    } finally {
      inflightCoverage = null;
    }
  })();
  return inflightCoverage;
}

/**
 * Drop the readiness cache so the next call re-probes. Used by the admin
 * reload endpoint (so post-reload `/healthz` reflects the new state) and
 * by tests that need a clean slate.
 */
export function resetPromptsReadyCache(): void {
  cached = null;
  coverageCached = null;
}

/** @deprecated use resetPromptsReadyCache() — kept for back-compat. */
export const __resetPromptsReadyCacheForTests = resetPromptsReadyCache;

export { TRACKED_KEYS, STATUS_KEYS } from './tracked.js';
