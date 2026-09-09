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

/**
 * The PMS task `TRACKED_KEY` resolves from (`routing` -> `orchestrator`).
 * Mirrors `PMS_TASK_ALIAS` in src/prompts/estate.ts; the test asserts the two
 * agree by DERIVATION, so this mirror cannot drift silently.
 */
export declare const TRACKED_PMS_TASK: string;

/** One row of `GET /admin/prompts/status` (`{ keys: [...] }`). */
export interface ServedPromptStatusRow {
  key?: string;
  version?: string | number;
  sent_hash?: string;
  content_hash?: string;
  content_chars?: number;
  pms_task?: string;
  source?: string;
}

/** First 16 hex chars of the sha256 of `s` — the same short hash PMS reports. */
export declare function shortSha256(s: string): string;

/**
 * PURE consistency discriminator: did every sample agree on what is served?
 * A disagreement means different instances are serving different coach prompts
 * (observed live during the 2026-07-25 v119->v120 re-pin) and is reported as a
 * distinct condition, never as settled drift.
 */
export declare function evaluateConsistency(
  samples: Array<{ version: string | number; hash: string | undefined | null }>,
): { consistent: boolean; message: string };

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
  /** Carried onto the SAME line as the hash so the two can be correlated. */
  pmsTask?: string | undefined;
  source?: string | undefined;
}): { ok: boolean; message: string };

/**
 * PURE selection: the status row this alarm is about, chosen BY KEY.
 * `null` when the tracked key is absent — which the caller treats as fatal.
 */
export declare function selectTrackedRow(
  body: { keys?: ServedPromptStatusRow[] } | null | undefined,
): ServedPromptStatusRow | null;

/**
 * PURE task-binding discriminator: are these bytes the bytes of the task we
 * think they are? A hash match against the wrong row, an un-established
 * `pms_task`, or a re-pointed alias are each `{ ok: false }` with their own
 * named condition. Never throws, never reads the network.
 */
export declare function evaluateTaskBinding(args: {
  key: string | undefined | null;
  pmsTask: string | undefined | null;
  source?: string | undefined | null;
}): { ok: boolean; message: string };
