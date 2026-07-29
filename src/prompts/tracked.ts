/**
 * The reporting surface for PMS prompts: which keys are tracked, their
 * canonical default-version strings, and the source vocabulary that surfaces
 * on telemetry, /healthz, /admin/prompts/status, and reload.
 *
 * ## WHAT CHANGED, AND WHY
 *
 * `TRACKED_KEYS` used to be a HAND-LISTED five-key array. That is the
 * hand-maintained-mirror defect this programme keeps paying for: it failed
 * toward invisibility, and it duly went stale — `repair_edit_graph` is
 * PMS-registered and live-callable (edit-graph.ts attempt ≥2) and was absent
 * from the status endpoint because nobody remembered to add it.
 *
 * Both sets are now DERIVED from `src/prompts/estate.ts`:
 *
 *   - `TRACKED_KEYS`   = `CRITICAL_PMS_TASKS`  — the health-GATING subset,
 *                        unchanged (still the same five keys) so `/healthz`
 *                        `prompts_ready` / `critical_prompts_pms` behave
 *                        exactly as before.
 *   - `STATUS_KEYS`    = `REPORTED_PMS_TASKS`  — the REPORTING set, derived
 *                        from the operation map minus the two drift-guarded
 *                        exception lists. A newly wired prompt appears here
 *                        automatically.
 *
 * Keep this file lean — it's imported by readiness, telemetry, and the admin
 * routes.
 */

import type { CeeTaskId } from './schema.js';
import {
  CRITICAL_PMS_TASKS,
  DEFAULT_PROMPT_VERSIONS,
  REPORTED_PMS_TASKS,
  type CriticalPmsTask,
  type ResolvablePmsTask,
} from './estate.js';

/**
 * The prompt keys whose resolution GATES health. Derived from the estate's
 * `CRITICAL_PMS_TASKS`; the name is kept for the many existing importers.
 */
export const TRACKED_KEYS: readonly CriticalPmsTask[] = CRITICAL_PMS_TASKS;

export type TrackedKey = CriticalPmsTask;

/**
 * The prompt keys `/admin/prompts/status` REPORTS: every live PMS prompt plus
 * the gated-but-wired ones. Strictly a superset of `TRACKED_KEYS`.
 */
export const STATUS_KEYS: readonly ResolvablePmsTask[] = REPORTED_PMS_TASKS;

export type StatusKey = ResolvablePmsTask;

/**
 * Canonical default-version string for a prompt task. Re-exported from the
 * estate, which is now the single home for this fact (it previously existed
 * twice, keyed two different ways — see `DEFAULT_PROMPT_VERSIONS`).
 */
export const DEFAULT_VERSIONS: Partial<Record<CeeTaskId, string>> = DEFAULT_PROMPT_VERSIONS;

/**
 * Public-facing source vocabulary. The internal `LoadedPrompt.source`
 * uses 'store' for historical reasons; the brief specifies 'pms' on the
 * external surface. Always project through this mapper before emitting.
 */
export type PublicSource = 'pms' | 'default';

export function mapSource(internal: 'store' | 'default'): PublicSource {
  return internal === 'store' ? 'pms' : 'default';
}

/**
 * Pick the version string that should appear on telemetry / admin status.
 * For PMS-resolved prompts use the store version; for default fallbacks use
 * the canonical `DEFAULT_VERSIONS` entry.
 *
 * Widened from `TrackedKey` to `CeeTaskId` because the status surface now
 * covers more than the five gating keys. A key with no canonical default
 * version string reports `'default'` rather than `undefined` — honest, and it
 * keeps the field a string on every row.
 */
export function resolvePublicVersion(
  key: CeeTaskId,
  internalSource: 'store' | 'default',
  storeVersion: string | number | undefined,
): string {
  if (internalSource === 'store' && storeVersion != null) {
    return String(storeVersion);
  }
  return DEFAULT_VERSIONS[key] ?? 'default';
}

/** True for keys that GATE health (the critical subset). */
export function isTrackedKey(key: string): key is TrackedKey {
  return (TRACKED_KEYS as readonly string[]).includes(key);
}

/** True for keys the status/inventory surface REPORTS (live + gated). */
export function isStatusKey(key: string): key is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(key);
}

// Alias machinery now lives in the estate (it is an estate fact: a logical key
// and its target are ONE artefact, and the estate must not double-count them).
// Re-exported so existing importers are untouched.
export { PMS_TASK_ALIAS, pmsResolveTaskId } from './estate.js';
