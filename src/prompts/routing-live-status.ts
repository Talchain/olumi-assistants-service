/**
 * Live routing-snapshot status seam (dependency inversion).
 *
 * The routing prompt is served from a no-TTL snapshot built + guarded in
 * `src/orchestrator-v5/routing/prompt-loader.ts`. Health/status reporting
 * (`src/prompts/readiness.ts`, `/admin/prompts/status`) lives in the lower
 * `src/prompts/` layer and MUST NOT import the higher orchestrator-v5
 * layer (would invert layering / risk an import cycle, and force the
 * routing eager-load on every readiness import).
 *
 * So the snapshot module REGISTERS a live-status provider here; readiness
 * reads it. This lets the routing key report what is ACTUALLY SERVED
 * (the guard-applied, atomically-swapped snapshot) instead of a raw,
 * unguarded `loadPrompt('routing')` read of the current PMS row.
 *
 * Why it matters: after a bad OVERSIZED `orchestrator` upload, an admin
 * reload rejects the new snapshot (size guard) and atomically restores the
 * previous one. A raw `loadPrompt('routing')` probe would still succeed
 * (PMS read works) and report the rejected prompt as `source:pms` —
 * a false-green while routing actually serves the old snapshot. Deriving
 * the routing row from the live snapshot (plus `snapshot_error`) closes
 * that gap.
 */

import type { CeeTaskId } from './schema.js';
import type { PublicSource } from './tracked.js';

export interface RoutingLiveStatus {
  /** Public source of the LIVE served snapshot ('pms' | 'default'). */
  readonly source: PublicSource;
  /** Version label of the live served snapshot (e.g. '111' or 'v40'). */
  readonly version: string;
  /** 16-char sha256 prefix of the live served (resolved) content. */
  readonly content_hash: string;
  /** Char length of the live served content. */
  readonly content_chars: number;
  /** The PMS task the routing key resolves from (alias-aware). */
  readonly pms_task: CeeTaskId;
  /**
   * Last build/reload error, when the live snapshot is STALE because a
   * subsequent rebuild was rejected (e.g. oversized PMS prompt) and the
   * previous snapshot was restored. `null` when the live snapshot is the
   * latest successful build.
   */
  readonly snapshot_error: string | null;
}

let provider: (() => RoutingLiveStatus | null) | null = null;

/** Register the live routing-snapshot status provider (called by the
 *  orchestrator-v5 routing prompt-loader at module init). */
export function registerRoutingLiveStatusProvider(
  fn: () => RoutingLiveStatus | null,
): void {
  provider = fn;
}

/** The live routing-snapshot status, or `null` if no snapshot has been
 *  built yet (pre-boot) / no provider registered. */
export function getRoutingLiveStatus(): RoutingLiveStatus | null {
  return provider ? provider() : null;
}

/** Test-only — clears the registered provider. */
export function __resetRoutingLiveStatusProviderForTests(): void {
  provider = null;
}
