/**
 * T4 Slice 2 — the single `RecentMutation` → `FrameChanges` projection.
 *
 * Implements the {@link ProjectRecentChangesToFrame} contract declared in
 * `./types.ts`: this is the ONE place the recent-changes authority output is
 * mapped into the frame's `changes` shape. It runs once per turn, at the frame
 * build seam, over `contextPack.recent_changes` — the ALREADY-projected,
 * already-capped `RecentMutation[]` (see `../recent-changes.ts` for the cap and
 * no-identifier rules). Because the frame builder receives the output of this
 * function (`FrameChanges`), not raw facts, it structurally cannot re-run the
 * projection or re-apply the cap.
 *
 * PURE SHAPE ADAPTATION ONLY. Field-for-field mapping (`target_label` →
 * `targetLabel`); no filtering, no truncation, no re-reading of `prior_facts`,
 * no derivation. The summaries arriving here are already decision-language and
 * identifier-free by the recent-changes contract.
 */

import type { RecentMutation } from '../recent-changes.js';
import type { FrameChanges, ProjectRecentChangesToFrame } from './types.js';

/**
 * Map the already-projected recent changes into the frame's `changes` shape.
 * Pure, total, never throws; returns a frozen array of frozen elements — the
 * one frame instance is shared across a turn's consumers, so the read-only
 * contract is enforced at runtime (deep for this projection), not just via
 * compile-time `readonly`.
 */
export const projectRecentChangesToFrame: ProjectRecentChangesToFrame = (
  changes: readonly RecentMutation[],
): FrameChanges =>
  Object.freeze(
    changes.map((change) =>
      Object.freeze({
        action: change.action,
        summary: change.summary,
        targetLabel: change.target_label,
      }),
    ),
  );
