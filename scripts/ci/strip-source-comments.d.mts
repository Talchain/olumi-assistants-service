/**
 * Types for the shared literal-aware comment stripper used by the
 * source-scanning guards (shell guards via its CLI, vitest guard specs via
 * these exports). The module is plain `.mjs` on purpose — the shell guards
 * run it with bare `node`, no transpile step (repo precedent:
 * staging-journey-smoke.d.mts).
 *
 * MIRROR CAVEAT (honest note): this is a hand-written type mirror of the
 * .mjs exports, so it can drift from the implementation. The drift is
 * BOUNDED and cannot make a guard wrong: both exports are exercised at
 * RUNTIME with positive AND negative controls by
 * tests/unit/ci/strip-source-comments.test.ts (including mechanical parity
 * with the ratified tokeniser in controlled-factor-authority.scan.ts). A
 * stale declaration can only make types imprecise, never let a comment
 * masquerade as code.
 */

export interface TokenisedViews {
  /** Comments blanked (newline-preserving); string literals intact. */
  readonly noComments: string;
  /**
   * Comments AND string/regex-literal contents blanked (newline-preserving).
   * Template interpolations (`${…}`) remain visible as code.
   */
  readonly structural: string;
}

/** Length-preserving tokenisation of TypeScript source into the two views. */
export declare function tokenise(source: string): TokenisedViews;

/**
 * The comment-stripped view of `source` (string literals intact). Length-
 * and line-preserving: safe to split on '\n' keeping original line numbers.
 */
export declare function stripComments(source: string): string;

/**
 * Per-file memoised {@link stripComments}, for the tree-walking guard specs
 * that tokenise the whole `src/` tree (often more than once). Reads the file
 * at `path` and returns its comment-stripped view, caching keyed on the file's
 * `mtimeMs` — an edited file is always re-stripped, never served stale. Used
 * ONLY by the vitest guard specs; the shell-guard CLI does not consult it.
 */
export declare function stripCommentsFile(path: string): string;

/**
 * Explicit vitest `testTimeout` (ms) for the tree-walking guard specs, single-
 * sourced so every walking spec shares one value instead of a copied literal.
 * Sized at ≥3× the slowest isolated tree walk to absorb parallel-load CPU
 * contention without masking a genuinely hung walk.
 */
export declare const GUARD_WALK_TIMEOUT_MS: number;
