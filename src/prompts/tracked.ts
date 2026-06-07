/**
 * Single source of truth for the five PMS-tracked prompt keys, their
 * canonical default-version strings, and the source vocabulary that
 * surfaces on telemetry, /healthz, /admin/prompts/status, and reload.
 *
 * Keep this file lean — it's imported by readiness, telemetry, and the
 * admin routes. Drift between those surfaces is a recurring failure mode
 * the brief explicitly called out.
 */

import type { CeeTaskId } from './schema.js';

export const TRACKED_KEYS = [
  'routing',
  'edit_graph',
  'draft_graph',
  'decision_review',
  'repair_graph',
] as const satisfies readonly CeeTaskId[];

export type TrackedKey = (typeof TRACKED_KEYS)[number];

/**
 * Canonical default-version string for each tracked prompt. Used when a
 * prompt resolves from the registered default (no PMS row). Keep in sync
 * with the actual constants in src/prompts/defaults*.ts:
 *   - routing         → Prompts/v40.txt
 *   - edit_graph      → EDIT_GRAPH_PROMPT_V6
 *   - draft_graph     → DRAFT_GRAPH_PROMPT_V187
 *   - decision_review → DECISION_REVIEW_PROMPT (v11)
 *   - repair_graph    → REPAIR_GRAPH_PROMPT (v6)
 */
export const DEFAULT_VERSIONS: Record<TrackedKey, string> = {
  routing: 'v40',
  edit_graph: 'v6',
  draft_graph: 'v187',
  decision_review: 'v11',
  repair_graph: 'v6',
};

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
 * For PMS-resolved prompts use the store version; for default fallbacks
 * use the canonical DEFAULT_VERSIONS entry.
 */
export function resolvePublicVersion(
  key: TrackedKey,
  internalSource: 'store' | 'default',
  storeVersion: string | number | undefined,
): string {
  if (internalSource === 'store' && storeVersion != null) {
    return String(storeVersion);
  }
  return DEFAULT_VERSIONS[key];
}

export function isTrackedKey(key: string): key is TrackedKey {
  return (TRACKED_KEYS as readonly string[]).includes(key);
}

/**
 * PMS task-id alias for prompt RESOLUTION (the store lookup key).
 *
 * The CEE/V5 routing prompt IS the operator-managed `orchestrator` system
 * prompt (`olumi_orchestrator_system_prompt_v…`) — not a separate
 * user-managed prompt. The runtime logical key stays `routing` (so its
 * bundled default, size guard, and tracked-key reporting are unchanged),
 * but its PMS lookup resolves the `orchestrator` task so CEE serves the
 * prompt Paul manages. This mirrors the routing path's MODEL resolution,
 * which already uses `task_id='orchestrator'` (route-with-tool-use.ts).
 *
 * Resolution-only: the DEFAULT fallback deliberately stays the aliased
 * key's own registered default (`routing` → guard-safe v40), NEVER the
 * ~57k `orchestrator` v28 default, so a PMS-unavailable boot still passes
 * the routing [18.5k–22k] size guard.
 */
export const PMS_TASK_ALIAS: Partial<Record<CeeTaskId, CeeTaskId>> = {
  routing: 'orchestrator',
};

/** The PMS task id used to RESOLVE a prompt for `key` (alias-aware). */
export function pmsResolveTaskId(key: CeeTaskId): CeeTaskId {
  return PMS_TASK_ALIAS[key] ?? key;
}
