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
 *
 * ⚠ BUT IT COST A CI CYCLE, AND THE COST IS NOW GUARDED. Adding five exports to
 * the .mjs and forgetting them here produced SEVEN TS2305 errors that NO local
 * gate could see: `pnpm build` typechecks `tsconfig.build.json`, which EXCLUDES
 * tests, and this file is only read BY a test. So the required job passed
 * locally and the separate `Typecheck Drift (ratchet)` job — green on the three
 * preceding staging commits — went red. That is the hand-maintained mirror
 * defect exactly (CLAUDE.md trap 12), inside a file whose own header discloses
 * that it is one.
 *
 * The mirror stays (the .mjs must remain dependency-free plain JS, and `scripts/**`
 * is outside tsconfig's `include`), but it is no longer maintained by memory:
 * `staging-journey-smoke.test.ts` DERIVES the .mjs's export list and asserts
 * this file declares every one, so the next omission reds a unit test in
 * seconds instead of a CI job ten minutes later.
 */

/** Minimum node count for a drafted graph to count as usable. */
export declare const MIN_NODES: number;

/** Minimum comparable options for a decision to be analysable. */
export declare const MIN_OPTIONS: number;

/**
 * Exit paths whose `sendFinalised200` call site supplies an `analysisReady`
 * payload — the only paths on which an empty/absent `analysis_ready` is a LOSS.
 * Derived from `src/orchestrator/route-v2.ts`; the spec re-derives it and fails
 * loud on drift.
 */
export declare const READINESS_PRODUCING_EXIT_PATHS: ReadonlySet<string>;

/**
 * THE ONE PREDICATE for "this turn handed the user a model". Shared by the
 * journey's delivery/usability leg and the provenance check, so the two cannot
 * disagree about which turn drafted.
 */
export declare function carriedDraftGraph(body: unknown): boolean;

/**
 * How many option OBJECTS a response carries, identifiable or not. The single
 * counter behind both the minimum-count check and the continuity precondition.
 */
export declare function readyOptionCount(body: unknown): number;

/**
 * REPORTS ONLY — never asserts. The readiness fields that tell the four
 * producers of `{status:'blocked', goal_node_id:'', options:[]}` apart, printed
 * on every turn of every run so a failure has something to be compared against.
 * Shared by the per-turn log line and the continuity failure message.
 */
export declare function readinessDiagnosis(body: unknown): string;

/**
 * REPORTS ONLY — never asserts. The node-kind census of a turn's `draft_graph`,
 * so "the drafted model contained a goal node" is an observation rather than an
 * inference from a node total.
 */
export declare function draftGraphCensus(body: unknown): string;

/**
 * The product must not answer a CONVERSATIONAL turn with an ANALYSIS REFUSAL.
 *
 * Keyed on `blocked_reason` — which only `buildAnalysisRefusalReadiness` writes,
 * and which the refusal-payload fix PRESERVES — rather than on `options`, which
 * that fix repopulates. Orthogonal to the fix by construction, so the routing
 * defect stays observable after the payload defect is closed.
 *
 * `requestedAnalysis` is DECLARED by the caller (this gate composes the
 * messages, so it knows) and never inferred from the reply under test.
 *
 * @returns failure messages; an empty array means healthy.
 */
export declare function assertNoUnrequestedAnalysisRefusal(
  turns: ReadonlyArray<{ label: string; body: unknown; requestedAnalysis: boolean }>,
): string[];

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
 * A turn that PRODUCED a graph — delivered one on the wire, or declared the
 * `draft_graph` exit — must carry a non-empty prompt_identity, on any turn and
 * any exit path.
 * @param bodies the same turns' response bodies, index-aligned with
 *   `diagnostics`. Omit only when no bodies exist (no turns were driven).
 * @returns failure messages; an empty array means healthy.
 */
export declare function assertPromptProvenance(
  diagnostics: Array<Pick<ReturnType<typeof extractDiagnostics>, "exit_path" | "prompt_identity_count"> | null>,
  bodies?: readonly unknown[],
): string[];

/** The two failure classes. A finding's class is a property of the CHECK that produced it. */
export declare const VERDICT_JOURNEY_BROKEN: string;
export declare const VERDICT_PROVENANCE_DARK: string;

/**
 * The dashboard-only flag gating `_diagnostic_trace`. Named in the alarm
 * because finding it cost five days.
 */
export declare const TRACE_FLAG: string;

/**
 * PROVENANCE — every turn must be able to say WHICH PATH and WHICH BUILD served
 * it. Applies to every turn, not just turn 1, and `build_sha` is asserted here
 * for the first time (it was previously printed and never checked).
 * @returns failure messages; an empty array means the trace is observable.
 */
export declare function assertTraceObservability(
  turns: ReadonlyArray<{
    label: string;
    d: Pick<ReturnType<typeof extractDiagnostics>, "build_sha" | "exit_path"> | null;
  }>,
): string[];

/**
 * PROVENANCE — the continuity check could not be PERFORMED because the trace is
 * dark. Not a journey failure: the product may be fine and the gate simply
 * cannot see well enough to judge.
 * @returns failure messages; an empty array means every later turn was classifiable.
 */
export declare function assertContinuityJudgeable(frameBody: unknown, followUpBody: unknown): string[];

/**
 * The deployed service's OWN report of the trace posture, read from /healthz.
 * ABSENT IS NEVER REPORTED AS OFF — a build predating the field cannot speak to it.
 */
export declare function readTracePosture(healthBody: unknown): "on" | "off" | "not-reported";

/**
 * THE VERDICT. Pure, so the one thing this gate is read for is unit-testable.
 * Both failure classes exit non-zero: this separates the MESSAGE, never the severity.
 */
export declare function buildVerdict(input?: {
  journeyFailures?: readonly string[];
  provenanceFailures?: readonly string[];
  tracePosture?: "on" | "off" | "not-reported";
}): { exitCode: number; lines: string[] };
