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
