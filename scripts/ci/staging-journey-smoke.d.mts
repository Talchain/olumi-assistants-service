/**
 * Types for the staging live-journey smoke gate.
 *
 * The gate itself is plain `.mjs` on purpose: it runs in CI with `node` and no
 * install step, so the alarm still works when the dependency graph is what
 * broke. `scripts/**` is outside tsconfig's `include` and `allowJs` is off, so
 * the test's import needs this declaration (without it: TS7016).
 *
 * MIRROR CAVEAT (honest note): this is a hand-written type mirror of the .mjs
 * exports, so it can drift from the implementation. The drift is BOUNDED and
 * cannot make the alarm wrong: every export here is exercised at RUNTIME
 * against the real module by tests/unit/ci/staging-journey-smoke.test.ts,
 * including a positive control on a real captured outage response. A stale
 * declaration can only make types imprecise, never make a broken journey pass.
 */

/** Minimum node count for a drafted graph to count as usable. */
export declare const MIN_NODES: number;

/** Minimum comparable options for a decision to be analysable. */
export declare const MIN_OPTIONS: number;

/** @returns failure messages; an empty array means healthy. */
export declare function assertHealthyFrame(body: unknown): string[];

/**
 * @param label names the turn in every message (drafting moved to turn 1 in #1002).
 * @returns failure messages; an empty array means healthy.
 */
export declare function assertHealthyDraft(body: unknown, label?: string): string[];

/**
 * The journey invariant: the user leaves holding a usable model, on whichever
 * turn drafts, and later turns still name that model's option_ids.
 * @returns failure messages; an empty array means healthy.
 */
export declare function assertHealthyJourney(frameBody: unknown, followUpBody: unknown): string[];

export declare function extractDiagnostics(body: unknown): {
  build_sha: string | null;
  exit_path: string | null;
  prompt_identity_count: number;
  prompt_identity: string[];
};

/**
 * A `draft_graph` exit on ANY turn must carry a non-empty prompt_identity.
 * @returns failure messages; an empty array means healthy.
 */
export declare function assertPromptProvenance(
  diagnostics: Array<Pick<ReturnType<typeof extractDiagnostics>, "exit_path" | "prompt_identity_count"> | null>,
): string[];
