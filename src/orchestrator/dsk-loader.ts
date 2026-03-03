/**
 * DSK v0 Loader
 *
 * Process-level singleton that loads the DSK bundle from disk at startup.
 * Gated by ENABLE_DSK_V0 feature flag (config.features.dskV0).
 *
 * When OFF: all exports are no-ops / return null / return [].
 * When ON:  reads data/dsk/v1.json, parses, caches in memory.
 *           ENOENT → warn and skip (non-fatal).
 *           Parse error → log error and skip (non-fatal).
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
import type { DSKBundle, DSKObject, DecisionStage } from "../dsk/types.js";
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
  if (!config.features.dskV0) {
    log.info({ flag: 'ENABLE_DSK_V0', state: false }, 'DSK v0 loader skipped (flag OFF)');
    return;
  }

  const filePath = path.resolve(process.cwd(), 'data/dsk/v1.json');
  log.info({ flag: 'ENABLE_DSK_V0', state: true, resolved_path: filePath }, 'DSK v0 loader activated');

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DSKBundle;

    // Minimal shape guard: catch valid-JSON-but-nonsense-shape before hash verification
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'string' ||
      !Array.isArray(parsed.objects) ||
      typeof parsed.dsk_version_hash !== 'string' ||
      parsed.dsk_version_hash.length === 0
    ) {
      log.error(
        { resolved_path: filePath, flag: 'ENABLE_DSK_V0' },
        'DSK bundle has invalid shape — skipping',
      );
      _bundle = null;
      return;
    }

    // Verify hash integrity: recompute and compare to stored dsk_version_hash
    const computed = computeDSKHash(parsed);
    if (computed !== parsed.dsk_version_hash) {
      log.error(
        {
          stored_hash: parsed.dsk_version_hash,
          computed_hash: computed,
          resolved_path: filePath,
          flag: 'ENABLE_DSK_V0',
        },
        'DSK bundle hash mismatch — possible corruption, skipping',
      );
      _bundle = null;
      return;
    }

    _bundle = parsed;
    log.info(
      { dsk_version: _bundle.version, object_count: _bundle.objects.length, resolved_path: filePath },
      'DSK bundle loaded',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.warn(
        { resolved_path: filePath, flag: 'ENABLE_DSK_V0' },
        'DSK bundle file not found — skipping',
      );
    } else {
      log.error(
        { err, resolved_path: filePath, flag: 'ENABLE_DSK_V0' },
        'DSK bundle parse error — skipping',
      );
    }
    _bundle = null;
  }
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
