/**
 * Types for the shadow-copy guard. The module is plain `.mjs` on purpose — the
 * CI step runs it with bare `node`, no transpile step (repo precedent:
 * strip-source-comments.d.mts, staging-journey-smoke.d.mts).
 *
 * MIRROR CAVEAT (honest note): this is a hand-written type mirror of the .mjs
 * exports and can drift from the implementation. The drift is BOUNDED and
 * cannot make the guard wrong: every export below is exercised at RUNTIME,
 * with positive AND negative controls, by both
 * `node scripts/ci/assert-no-shadow-copies.mjs --self-test` (run in CI) and
 * tests/unit/ci/assert-no-shadow-copies.test.ts (run in the required gate).
 * A stale declaration can only make types imprecise.
 */

/** Which naming family a duplication suffix belongs to. */
export type ShadowFamily = 'finder' | 'delimited';

export interface ShadowClassification {
  readonly family: ShadowFamily;
  /** The duplication suffix itself, e.g. " 2", " copy", "-copy". */
  readonly suffix: string;
  /** The basename this would be a copy OF (suffix removed, extension kept). */
  readonly original: string;
}

export interface ShadowFinding {
  /** Repo-relative POSIX path of the offending file. */
  readonly path: string;
  readonly family: ShadowFamily;
  readonly suffix: string;
  readonly original: string;
  /** Whether `original` is tracked in the SAME directory. */
  readonly siblingTracked: boolean;
}

export interface FixtureVerdicts {
  /** Paths the FROZEN historical glob guard would have flagged. */
  readonly legacy: readonly string[];
  /** Paths the current mechanism flags. */
  readonly next: readonly string[];
  /** Removes the throwaway fixture repo. Always call it. */
  readonly cleanup: () => void;
}

/**
 * The historical guard's eight globs, frozen verbatim as they stood at
 * ea886bef..d2cdd99b. Present only so the controls can prove the narrowing
 * with an old-vs-new pair; nothing in the live scan path reads it.
 */
export declare const LEGACY_GUARD_GLOBS: readonly string[];

/** Classify a BASENAME; null when it carries no duplication suffix. */
export declare function classifyBasename(basename: string): ShadowClassification | null;

/** The whole rule, as a pure function over a tracked-path list. */
export declare function findShadowCopies(trackedPaths: readonly string[]): ShadowFinding[];

/** NUL-safe `git ls-files -z` for the repo rooted at `cwd`. */
export declare function listTrackedFiles(cwd: string): string[];

/**
 * Create a throwaway git repo in the OS temp dir (never inside this repo),
 * `git add` the given paths, and return BOTH guards' verdicts on it. The
 * legacy verdict runs the real historical git pathspec globs, not a
 * re-implementation.
 */
export declare function evaluateFixture(files: readonly string[]): FixtureVerdicts;
