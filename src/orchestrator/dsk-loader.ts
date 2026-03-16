/**
 * DSK v0 Loader
 *
 * Process-level singleton that loads the DSK bundle from disk at startup.
 * Gated by ENABLE_DSK_V0 or DSK_ENABLED feature flags.
 *
 * When OFF: all exports are no-ops / return null / return [].
 * When ON:  reads data/dsk/v1.json, parses, validates hash, caches in memory.
 *           Graceful degradation: logs error and returns (dsk_version_hash = null)
 *           on ENOENT, parse error, shape mismatch, or hash mismatch.
 *           Service startup is never blocked by a missing or corrupt bundle.
 *
 * Call order:
 *   1. loadDskBundle() at server startup (once)
 *   2. queryDsk() at request time
 *   3. getDskVersionHash() in envelope assembly (lineage.dsk_version_hash)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config/index.js";
import { log } from "../utils/telemetry.js";
import type { DSKBundle, DSKObject, DSKClaim, DSKProtocol, DSKTrigger, DecisionStage } from "../dsk/types.js";
import { computeDSKHash } from "../dsk/hash.js";

// ============================================================================
// Process-level singleton
// ============================================================================

let _bundle: DSKBundle | null = null;

// ============================================================================
// Loader
// ============================================================================

/**
 * Load the DSK bundle from disk into the process-level singleton.
 *
 * Must be called once at server startup, before any request handling.
 * Idempotent — safe to call multiple times (only loads on first call when flag is ON).
 */
export function loadDskBundle(): void {
  // TODO: Deprecate ENABLE_DSK_V0 (config.features.dskV0) once DSK v1 bundle
  // is stable in production. Single canonical flag: DSK_ENABLED.
  // Dual gate exists because dskV0 predates production bundle integration.
  if (!config.features.dskV0 && !config.features.dskEnabled) {
    log.info({ flags: { ENABLE_DSK_V0: false, DSK_ENABLED: false } }, 'DSK loader skipped (both flags OFF)');
    return;
  }

  const loadStart = Date.now();
  const filePath = path.resolve(process.cwd(), 'data/dsk/v1.json');
  log.info({ flags: { ENABLE_DSK_V0: config.features.dskV0, DSK_ENABLED: config.features.dskEnabled }, resolved_path: filePath }, 'DSK loader activated');

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? `DSK bundle file not found: ${filePath}`
      : `DSK bundle read error: ${(err as Error).message}`;
    log.error({ resolved_path: filePath, error: (err as Error).message }, reason);
    return; // Degrade gracefully — dsk_version_hash will be null
  }

  let parsed: DSKBundle;
  try {
    parsed = JSON.parse(raw) as DSKBundle;
  } catch {
    log.error({ resolved_path: filePath }, `DSK bundle is not valid JSON: ${filePath}`);
    return; // Degrade gracefully
  }

  // Shape guard: all required top-level fields
  const shapeErrors: string[] = [];
  if (typeof parsed !== 'object' || parsed === null) shapeErrors.push('not an object');
  else {
    if (typeof parsed.version !== 'string') shapeErrors.push('missing/invalid version');
    if (typeof parsed.generated_at !== 'string') shapeErrors.push('missing/invalid generated_at');
    if (typeof parsed.dsk_version_hash !== 'string' || parsed.dsk_version_hash.length === 0)
      shapeErrors.push('missing/invalid dsk_version_hash');
    if (!Array.isArray(parsed.objects)) shapeErrors.push('missing/invalid objects[]');
  }
  if (shapeErrors.length > 0) {
    log.error({ resolved_path: filePath, shape_errors: shapeErrors }, `DSK bundle shape invalid (${shapeErrors.join(', ')}): ${filePath}`);
    return; // Degrade gracefully
  }

  // Verify hash integrity
  const computed = computeDSKHash(parsed);
  if (computed !== parsed.dsk_version_hash) {
    log.error(
      { resolved_path: filePath, expected: parsed.dsk_version_hash, computed },
      `DSK bundle hash mismatch — expected ${parsed.dsk_version_hash}, computed ${computed}: ${filePath}`,
    );
    return; // Degrade gracefully
  }

  _bundle = parsed;
  const typeCounts: Record<string, number> = {};
  for (const obj of _bundle.objects) typeCounts[obj.type] = (typeCounts[obj.type] ?? 0) + 1;
  log.info(
    {
      dsk_version: _bundle.version,
      dsk_hash_prefix: _bundle.dsk_version_hash.slice(0, 16),
      object_count: _bundle.objects.length,
      by_type: typeCounts,
      load_ms: Date.now() - loadStart,
      resolved_path: filePath,
    },
    'DSK bundle loaded',
  );
}

// ============================================================================
// Query
// ============================================================================

/**
 * Query the loaded DSK bundle for objects matching the given criteria.
 *
 * Returns [] when the bundle is not loaded (flag OFF or file missing).
 * Results are sorted by id ascending for stable output.
 *
 * @param stage - Decision stage to filter by (stage_applicability must include it)
 * @param contextTags - At least one must match obj.context_tags
 * @param detectionCodes - At least one must match obj.detection_codes (if present)
 */
export function queryDsk(stage: string, contextTags: string[], detectionCodes: string[]): DSKObject[] {
  if (!_bundle) return [];

  return _bundle.objects
    .filter((obj) => !obj.deprecated)
    .filter((obj) => obj.stage_applicability.includes(stage as DecisionStage))
    .filter((obj) => {
      const hasContextTag = contextTags.some((t) => obj.context_tags.includes(t));
      const detCodes: string[] =
        'detection_codes' in obj && Array.isArray(obj.detection_codes)
          ? (obj.detection_codes as string[])
          : [];
      const hasDetectionCode = detectionCodes.some((c) => detCodes.includes(c));
      return hasContextTag || hasDetectionCode;
    })
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ============================================================================
// Version Hash
// ============================================================================

/**
 * Get the dsk_version_hash from the loaded bundle.
 * Returns null when flag is OFF or bundle is not loaded.
 */
export function getDskVersionHash(): string | null {
  return _bundle?.dsk_version_hash ?? null;
}

/**
 * Resolve the DSK version hash for envelope construction.
 *
 * Flag-gated: returns null when both DSK flags are OFF.
 * When ON, prefers the loaded bundle hash, falling back to the enriched context value.
 *
 * All envelope builders should use this single function to ensure consistent resolution.
 */
export function resolveDskHash(enrichedContextDskHash?: string | null): string | null {
  if (!config.features.dskV0 && !config.features.dskEnabled) return null;
  return getDskVersionHash() ?? enrichedContextDskHash ?? null;
}

// ============================================================================
// Typed accessors
// ============================================================================

export function getClaimById(id: string): DSKClaim | undefined {
  return _bundle?.objects.find((o): o is DSKClaim => o.type === "claim" && o.id === id);
}

export function getProtocolById(id: string): DSKProtocol | undefined {
  return _bundle?.objects.find((o): o is DSKProtocol => o.type === "protocol" && o.id === id);
}

export function getTriggerById(id: string): DSKTrigger | undefined {
  return _bundle?.objects.find((o): o is DSKTrigger => o.type === "trigger" && o.id === id);
}

export function getAllByType<T extends DSKObject["type"]>(
  type: T,
): Extract<DSKObject, { type: T }>[] {
  if (!_bundle) return [];
  return _bundle.objects.filter((o): o is Extract<DSKObject, { type: T }> => o.type === type);
}

export function getVersion(): string | null {
  return _bundle?.version ?? null;
}

// ============================================================================
// Test helper
// ============================================================================

/**
 * Reset the singleton. For tests only — allows re-loading between test cases.
 * @internal
 */
export function _resetDskBundle(): void {
  _bundle = null;
}
