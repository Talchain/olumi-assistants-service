/**
 * Types for the served-prompt drift alarm.
 *
 * The alarm itself is plain `.mjs` on purpose: it runs in CI with `node` and no
 * install step, so it still works when the dependency graph is what broke.
 * `scripts/**` is outside tsconfig's `include` and `allowJs` is off, so the
 * test's import needs this declaration (without it: TS7016). Mirrors the
 * `scripts/ci/staging-journey-smoke.d.mts` precedent.
 *
 * MIRROR CAVEAT (honest note): this is a hand-written type mirror of the .mjs
 * exports, so it can drift from the implementation. The drift is BOUNDED and
 * cannot make the alarm wrong: every export here is exercised at RUNTIME
 * against the real module by tests/unit/ci/served-prompt-drift.test.ts,
 * including a positive control on a real re-pin. A stale declaration can only
 * make types imprecise, never make a drifted prompt pass.
 */

/** Absolute path to the checked-in snapshot of the served coach prompt. */
export declare const SNAPSHOT_PATH: string;

/** The PMS status key whose bytes the sanction gate validates the pack against. */
export declare const TRACKED_KEY: string;

/** First 16 hex chars of the sha256 of `s` — the same short hash PMS reports. */
export declare function shortSha256(s: string): string;

/**
 * PURE drift discriminator. Returns `{ ok: false }` when the served prompt is
 * not the pinned snapshot (or when no live hash was available at all — a
 * degraded PMS is never a pass). Never throws, never reads the network.
 */
export declare function evaluateDrift(args: {
  liveHash: string | undefined | null;
  snapshotHash: string;
  version: string | number;
  liveChars: number;
  snapshotChars: number;
}): { ok: boolean; message: string };
