/**
 * Olumi's spread for a link's mean — PURE, moved out of the `adjust_edge_strength` handler (F1b 52f8cd, #2482 r2) so the
 * Run-pair diff (`coaching/run-input-changes.ts`) can check that a band move's spread is the writer's own without
 * importing a handler (that import closed a module cycle through the tool registry). The handler re-exports both.
 */
import { DEFAULT_STRENGTH_STD } from '../constants.js';

/**
 * The top of a link's std on this writer — the bound `AdjustEdgeStrengthStdSchema` has always enforced, named once so
 * the spread this writer derives itself (`olumiSpreadForMean`) is held to the same bound, not a second copy of it.
 */
export const ADJUST_EDGE_STRENGTH_STD_MAX = 0.5;

/**
 * ⭐ A6f — OLUMI'S SPREAD, CARRIED TO THE MEAN THE USER WROTE (AIQ N1 on #2096, 5856128077).
 *
 * An exact figure states a mean and no range, so the link's std stays Olumi's. It must not stay Olumi's ABSOLUTE std:
 * that was sized for Olumi's mean. Paul's `price_sensitivity → monthly_churn` (captures `17d1cd3a` / `08bf9a1f`) kept
 * std 0.00375 — sized for 0.0075 — on the user's 0.85, a CV of 0.4 %, so the analysis ran near-certain on a spread
 * nobody chose. Olumi's RELATIVE spread is kept instead: std × |new| / |old| (0.00375 → 0.425, CV 0.5 either side).
 *
 *  - The magnitude did not move (a confirm, or a sign flip): the std is returned exactly — nothing to rescale.
 *  - |old| > 0 and a finite std: the relative spread, computed CV-first so an exact ratio stays exact, held to the
 *    writer's own top bound (`ADJUST_EDGE_STRENGTH_STD_MAX`).
 *  - Otherwise — Olumi's mean was 0 (no relative spread exists), the stored std is unusable, or the new mean is 0 (a
 *    relative spread of 0 breaks `EdgeStrengthV3.std > 0`): the estate's default spread, `DEFAULT_STRENGTH_STD`.
 */
export function olumiSpreadForMean(args: {
  readonly oldMean: number;
  readonly oldStd: number;
  readonly newMean: number;
}): number {
  const oldAbs = Math.abs(args.oldMean);
  const newAbs = Math.abs(args.newMean);
  const usableStd = Number.isFinite(args.oldStd) && args.oldStd > 0;
  if (usableStd && newAbs === oldAbs) return args.oldStd;
  if (usableStd && Number.isFinite(oldAbs) && oldAbs > 0) {
    const relative = (args.oldStd / oldAbs) * newAbs;
    if (Number.isFinite(relative) && relative > 0) return Math.min(relative, ADJUST_EDGE_STRENGTH_STD_MAX);
  }
  return DEFAULT_STRENGTH_STD;
}
