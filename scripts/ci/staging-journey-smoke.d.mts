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

/**
 * THE USER'S ROUTE. Named once so the gate and its guards cannot hold two
 * different opinions about which path is under test.
 */
export declare const TURN_PATH: string;

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

/**
 * REPORTS ONLY — never asserts. The error-envelope fields that tell a drafting
 * failure's causes apart: the orchestrator's STRING `error` vs the proxy's
 * OBJECT `error.code`, the reason, the violation code, the repair-skip reason,
 * retryability, whether a recovery suggestion was offered, and both clocks.
 * Shared by the per-turn log line AND both failure paths, so the alarm and the
 * diagnostic can never describe the same turn differently. A body with no error
 * envelope reports `absent(no-error-envelope)` — absent is never printed as
 * empty, for the same reason `readinessDiagnosis` refuses to.
 */
export declare function draftErrorDiagnosis(body: unknown): string;

/**
 * The proxy error code on a body, or `null` when the proxy did not refuse.
 * Reads `error.code`: the proxy's `error` is an OBJECT and the orchestrator's is
 * a STRING, so the code is read rather than the field's stringification.
 */
export declare function proxyFailureCode(body: unknown): string | null;

/**
 * PROXY-LAYER DELIVERY — assert the response was DELIVERED, not merely
 * generated. A proxy refusal means the model may be perfectly fine and the user
 * still received nothing, which is a different failure with a different action
 * from a generation failure.
 * @param label names the turn in every message.
 * @returns failure messages; an empty array means the proxy handed it over.
 */
export declare function assertProxyDelivered(body: unknown, label?: string): string[];

/**
 * REPORTS ONLY — never asserts. Classify ONE journey sample's outcome, so a
 * rate becomes actionable: "3 of 5 failed" says look, "3 of 5 failed, all
 * VIOLATION:OPTIONS_IDENTICAL" says where. Codes are read from the PRODUCER's
 * own fields, most-specific first (threw → proxy → violation → reason → error →
 * HTTP → assertions). `ok` is decided by the failure list, never by the code,
 * so an unanticipated failure class reports `ASSERTIONS_FAILED` rather than
 * passing.
 */
export declare function classifyJourneySample(
  turns: ReadonlyArray<{ label?: string; status?: number; body?: unknown; threw?: string }>,
  failures: readonly string[],
): { ok: boolean; code: string };

/**
 * Aggregate samples into the numbers printed on EVERY run. `failureRate` is
 * `null` when nothing was attempted — "no samples ran" and "no samples failed"
 * are opposite facts and a 0 would print them identically.
 */
export declare function summariseSamples(samples: ReadonlyArray<{ ok?: boolean; code?: string }>): {
  attempted: number;
  ok: number;
  failed: number;
  failureRate: number | null;
  byCode: Record<string, number>;
};

/**
 * `1 - (1 - rate)^k` — P(this gate reds on a push) for k independent samples
 * that must all deliver. Exported so the job output, the PR body and the test
 * share one function rather than three copies of a number. Returns `null` on
 * inputs that are not a usable (k, rate) pair.
 */
export declare function detectionProbability(k: number, failureRate: number): number | null;

/**
 * `1 - 0.5^(1/k)` — the true per-sample failure rate at which this gate is a
 * coin flip. Below it, a given push is more likely missed than caught. This is
 * the number that bounds what k buys.
 */
export declare function halfDetectionRate(k: number): number | null;

/**
 * THE FLOOR. Two separate failures, deliberately not one predicate: too few
 * SAMPLES (the run is unmeasured, never healthy) and too few SUCCESSES. The
 * floor is scaled to the samples actually taken and rounded up, so truncation
 * can neither weaken it silently nor invert into a false red.
 * @returns failure messages; an empty array means the run cleared the floor.
 */
export declare function assertSampleFloor(
  summary: { attempted: number; ok: number; failed: number; byCode: Record<string, number> },
  options: { floor: number; requested: number; minSamples: number },
): string[];

/**
 * REPORTS ONLY — never asserts. The lines printed on every run, healthy or not:
 * the census, the observed rate, the effective floor, the detection-power table
 * and the blindness statement. A gate that only speaks when it fails teaches
 * nobody what normal looks like, and the rate is the number that would have
 * stopped the 11 Sep merge.
 */
export declare function samplingReport(
  summary: { attempted: number; ok: number; failed: number; failureRate: number | null; byCode: Record<string, number> },
  options: { floor: number; requested: number; minSamples: number },
): string[];
