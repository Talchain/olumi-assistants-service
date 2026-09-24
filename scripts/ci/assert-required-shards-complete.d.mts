/**
 * Types for the sharded-required-tests completeness guard. The module is plain
 * `.mjs` on purpose — the `Lint, TypeCheck, Unit Tests` job runs it with bare
 * `node`, no install and no transpile step (repo precedent:
 * assert-no-shadow-copies.d.mts, staging-journey-smoke.d.mts).
 *
 * MIRROR CAVEAT (honest note): this is a hand-written type mirror of the .mjs
 * exports and can drift from the implementation. The drift is BOUNDED and
 * cannot make the guard wrong: every export below is exercised at RUNTIME, with
 * positive AND negative controls, by tests/unit/ci/required-shards-complete.test.ts
 * (run in the required gate). A stale declaration can only make types imprecise.
 */

export interface ShardRow {
  readonly shard: number;
  readonly files: number;
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  readonly todo: number;
}

export interface ShardVerdict {
  /** Empty when every required file ran in exactly one shard and every shard is green. */
  readonly errors: string[];
  readonly shards: ShardRow[];
  readonly totals: Omit<ShardRow, "shard">;
  readonly expectedCount?: number;
  readonly observedCount?: number;
}

/** Repo-relative POSIX path, or null when `file` lies outside `root`. */
export declare function toRepoPath(file: string, root: string): string | null;

/** Parse `vitest list --filesOnly --json` output (`[{ file }]`) into paths. */
export declare function parseExpectedList(text: string): string[];

/** The whole rule, as a pure function. */
export declare function verifyShardReports(input: {
  expectedFiles: readonly string[];
  /** shard index → parsed vitest JSON report, or an Error when unparseable. */
  reports: Map<number, unknown>;
  shardTotal: number;
  root: string;
}): ShardVerdict;

/** Read every `shard-<k>.json` in `dir`; an unparseable file becomes an Error value. */
export declare function readShardReports(dir: string): Map<number, unknown>;
