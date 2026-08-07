import { env } from "node:process";

export const MIN_TIMEOUT_MS = 5_000; // 5s
export const MAX_TIMEOUT_MS = 5 * 60_000; // 5m

/** Default timeout for standard HTTP client operations (110s) */
export const DEFAULT_HTTP_CLIENT_TIMEOUT_MS = 110_000;

/** Default timeout for reasoning model operations (180s / 3 minutes) */
export const DEFAULT_REASONING_MODEL_TIMEOUT_MS = 180_000;

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return MIN_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}

function parseTimeoutEnv(name: string, defaultMs: number): number {
  const raw = env[name];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

function parseDelayEnv(name: string, defaultMs: number): number {
  const raw = env[name];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

function parseIntEnv(name: string, defaultVal: number): number {
  const raw = env[name];
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
// Core LLM & HTTP timeouts
// ---------------------------------------------------------------------------

export const HTTP_CLIENT_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("HTTP_CLIENT_TIMEOUT_MS", DEFAULT_HTTP_CLIENT_TIMEOUT_MS),
);

export const ROUTE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ROUTE_TIMEOUT_MS", 135_000),
);

/**
 * Extended timeout for reasoning models (e.g., gpt-5.2).
 * Reasoning models require more time for extended thinking.
 * Default: 180,000ms (3 minutes)
 */
export const REASONING_MODEL_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("REASONING_MODEL_TIMEOUT_MS", DEFAULT_REASONING_MODEL_TIMEOUT_MS),
);

/** Undici TCP connect timeout for LLM SDK HTTP clients (default: 3s) */
export const UNDICI_CONNECT_TIMEOUT_MS = parseTimeoutEnv("UNDICI_CONNECT_TIMEOUT_MS", 3_000);

// ---------------------------------------------------------------------------
// Upstream retry
// ---------------------------------------------------------------------------

const DEFAULT_UPSTREAM_RETRY_DELAY_MS = 800; // Default centre of ~600–900ms jitter
export const UPSTREAM_RETRY_DELAY_MS = parseDelayEnv(
  "UPSTREAM_RETRY_DELAY_MS",
  DEFAULT_UPSTREAM_RETRY_DELAY_MS,
);

export function getJitteredRetryDelayMs(base: number = UPSTREAM_RETRY_DELAY_MS): number {
  // ±25% jitter around base delay (e.g. ~600–1_000ms for 800ms base)
  const jitter = Math.floor(base * 0.25);
  const min = Math.max(0, base - jitter);
  const max = base + jitter;
  if (max <= min) return base;
  return Math.floor(min + Math.random() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Generic retry configuration
// ---------------------------------------------------------------------------

export const RETRY_BASE_DELAY_MS = parseDelayEnv("RETRY_BASE_DELAY_MS", 250);
export const RETRY_MAX_DELAY_MS = parseDelayEnv("RETRY_MAX_DELAY_MS", 5_000);
export const RETRY_MAX_ATTEMPTS = parseIntEnv("RETRY_MAX_ATTEMPTS", 3);

// ---------------------------------------------------------------------------
// Route-level operation timeouts
// ---------------------------------------------------------------------------

/** Suggest-options LLM call timeout (default: 10s, clamped 5s–5m) */
export const SUGGEST_OPTIONS_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("SUGGEST_OPTIONS_TIMEOUT_MS", 10_000),
);

/** Critique-graph LLM call timeout (default: 10s, clamped 5s–5m) */
export const CRITIQUE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CRITIQUE_TIMEOUT_MS", 10_000),
);

/** Explain-diff LLM call timeout (default: 15s, clamped 5s–5m) */
export const EXPLAIN_DIFF_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("EXPLAIN_DIFF_TIMEOUT_MS", 15_000),
);

/**
 * Decision-review auto-fire LLM call timeout (default: 30s, clamped 5s-5m).
 * V5 Group 1 Task B: the decision_review call fires synchronously after a
 * successful run_analysis with this hard timeout. On timeout the turn still
 * succeeds with thin content (decision_review enrichment absent).
 *
 * History: 15s -> 22s (ROADMAP 2.73 Fix B, after the 15-Jul RCA observed the
 * call aborting at 15,002ms) -> 30s (ROADMAP 2.180-B, below).
 *
 * ── ROADMAP 2.180-B: 22,000 -> 30,000. Not a guess and not a doubling. ──────
 *
 * THE DEFECT. The 22 s wall sat INSIDE the call's own working latency
 * distribution, so it did not trim a pathological tail — it cut healthy calls
 * in half. Measured from CEE Render logs 27-30 Jul, n=128 completions
 * (PHASE0-EVIDENCE-2026-07-28/reset-suppression-probe-2180-raw/
 * decision-review-durations-27to30jul.txt): min 4,825 / p50 7,178 / p95 15,766 /
 * max 19,802 ms, against failures at 22,003 and 22,007 ms. Persisted storage
 * over 14 days: 12 of 363 run_analysis facts shipped no review (3.3% pooled,
 * 24% on the worst day), and every one of the 6 attributable cases was this
 * timeout.
 *
 * ⚠ THE SAMPLE IS RIGHT-CENSORED AT THE VALUE BEING REVIEWED. The 22 s wall
 * truncates the very distribution used to size its replacement: "max success
 * 19,802" is the maximum BELOW the censoring point, and the two failures are
 * observations of unknown true duration >= 22,000. Sizing this constant as
 * "observed max + margin" would re-fit the budget to a sample the old budget
 * shaped. So the floor below is built on the SPREAD, not on the max.
 *
 * ── FLOOR: what the task needs ──────────────────────────────────────────────
 * The two live captures (probe4-A / probe4-B) show the WORK is near-constant —
 * 9,807 in / 972 out tokens in 7,992 ms, and 9,601 in / 901 out tokens in
 * 10,169 ms. Capture B produced 7% FEWER output tokens and took 27% LONGER
 * (88.6 vs 121.6 output tok/s). What varies is provider throughput, not the
 * amount of work. Across n=128 the observed spread is 19,802 / 4,825 = 4.10x,
 * and censoring makes 4.10x a LOWER bound on the true spread.
 *
 * A budget must therefore cover the TYPICAL call slowed by at least the
 * slowdown factor we have already directly observed:
 *   p50 7,178 ms x 4.104 = 29,459 ms.
 * (Deliberately p50 x spread, not min x spread: sizing off the luckiest call
 * is what produces a budget that only the lucky clear.)
 *
 * `p50 = 7,178` is the 64th of 128 sorted completions; the 65th is 7,188 (the
 * probe's prose quotes that one). The true median is their mean, 7,183. The
 * frozen constant uses 7,178, the lower and therefore more conservative of the
 * two — it produces a SMALLER floor, so it cannot flatter the chosen value.
 *
 * ⚠ TWO HONEST LIMITS ON THIS FLOOR (review amendment A5b). Stating them
 * because an earlier draft of this comment claimed the floor was "built on the
 * SPREAD, not the max", which oversells it:
 *   (a) It is NOT independent of the censored max. `p50 x (max/min)` contains
 *       `max` algebraically. Using it as a RATIO numerator is less sensitive
 *       than using it as an absolute level — but "not the max" was rhetoric,
 *       not algebra.
 *   (b) It is sensitive to a SINGLE observation. Drop just the fastest call
 *       (4,825; next is 5,201) and the floor falls 29,459 -> 27,330, a 2,129 ms
 *       swing off one data point.
 * The chosen 30,000 SURVIVES both: it clears 29,459 AND the drop-fastest 27,330,
 * and it independently clears the two floor conditions that use no ratio at all
 * — max-completed + the p95->max gap (23,838) and the censoring point (22,000).
 * The estimator is soft; the conclusion is not. And the concession below —
 * that 30,000 may still be insufficient because the true tail is unobservable —
 * is the honest cover for all of this, which is why it is not buried.
 *
 * ── CEILING: what the turn can afford ───────────────────────────────────────
 * The binding outer bound is the V5 turn abort, `budgets.turn_ms` =
 * min(TURN_BUDGET_MS 180 s, browserProxyTimeoutMs 125 s - TURN_RESPONSE_HEADROOM_MS
 * 10 s) = 115,000 ms (orchestrator-v5/budgets.ts). Both legs that reach the
 * enricher arm a timer at that same value (turn-executor.ts:1102,
 * chip-click-dispatch.ts:546-547) and the await is strictly serial on both.
 *
 * ⚠ THE NOMINAL LADDER IS ALREADY OVER-SUBSCRIBED, AND THAT IS NOT THIS
 * CHANGE'S DOING. On the TurnExecutor leg the two inner budgets that must both
 * complete before the enricher are routing (ORCHESTRATOR_TIMEOUT_MS 30,000) and
 * the handler (getHandlerBudgetMs() 85,000) — and 30,000 + 85,000 = 115,000 is
 * turn_ms EXACTLY. So at nominal worst case NO decision_review budget of any
 * size is affordable, and that was equally true at the old 22,000. Rung 2 of
 * `validateTimeoutRelationships` only checks handler < turn, so it certifies
 * headroom that routing then consumes in full. Recorded as a separate
 * pre-existing finding; a ceiling derived from the nominal ladder alone would
 * be 0 and therefore useless.
 *
 * The ceiling below is therefore derived by charging the one term that can
 * legitimately run long AND still yield a review at its full structural cap,
 * and the rest at measurement:
 *
 *  - PLOT_RUN_WORST_TIMEOUT_MS (75,000) = max(PLOT_RUN_TIMEOUT_MS,
 *    PLOT_RUN_BRIEF_TIMEOUT_MS). decision_review only exists on a turn whose
 *    run_analysis SUCCEEDED, and a successful PLoT /v2/run cannot exceed
 *    whichever of the pair `plot-client.ts:429` selected. Charged in full and
 *    at the MAX (review amendment A1): the selector depends on the dark
 *    `CEE_SEND_BRIEF_TO_PLOT` flag, and the two constants are independently
 *    env-raisable, so charging the base alone would be sound only by
 *    coincidence of today's equal defaults. PLoT cost scales with graph size
 *    (measured 2.12 s at 8 nodes → 12.54 s at 26 — see the note above).
 *  - PROMPT_STORE_FETCH_TIMEOUT_MS (5,000). `invoke.ts` fetches the
 *    decision_review system prompt INSIDE the enricher's try but passes it
 *    neither the signal nor the timeout, so on a cold prompt cache the await
 *    costs up to hardBudget + 5,000. The hard timer does not bound it.
 *  - Routing (30,000 nominal) charged at measurement, not at cap: it is a small
 *    classification call, the whole non-review turn work measured 5,109 and
 *    10,847 ms INCLUDING PLoT and routing, and the chip-click leg — the leg both
 *    live captures took, and the one the Run-analysis chip uses — makes NO
 *    routing call at all (chip-click-dispatch.ts, "Chip-click bypasses the
 *    routing layer").
 *
   resolveDecisionReviewHardBudgetMs(decomposeOff) + PROMPT_STORE_FETCH_TIMEOUT_MS
 *       <= turn_ms - PLOT_RUN_WORST_TIMEOUT_MS
 *   30,000 + 5,000 = 35,000  <=  115,000 - 75,000 = 40,000     ✔ 5,000 ms clear
 *
 * => the admissible interval is [29,459 , 35,000]. 30,000 is the round value
 * inside it, above the floor and holding 5,000 ms of ceiling margin; 22,000 was
 * BELOW the floor. Pinned both ways in
 * src/orchestrator-v5/coaching/__tests__/decision-review-budget-2180b.test.ts,
 * with the ceiling DERIVED from `getTurnExecutorBudgets()` and the constants
 * rather than restating 115,000 or 40,000.
 *
 * ⚠ THE DECOMPOSE FLAG BREACHES THIS CEILING, AND NOW SAYS SO. With
 * CEE_DECISION_REVIEW_DECOMPOSE on, the armed budget is
 * DECISION_REVIEW_TIMEOUT_MS + DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS = 38,000, and
 * 38,000 + 5,000 = 43,000 > 40,000. That flag is one env write away, so the
 * breach must not be silent: `validateTimeoutRelationships` gained a rung that
 * evaluates the budget ACTUALLY IN FORCE against this inequality and WARNS at
 * BOOT (the M2_REVIEW_TIMEOUT_MS rung is the precedent). The rung warns — it
 * does not fail the boot (`server.ts` runs a `log.warn` loop); the CI pins are
 * what go RED. Enabling decompose is a re-budget, not a flag flip.
 *
 * ⚠ WHAT THIS CEILING DOES **NOT** CLAIM. It is not a proof that a turn can
 * never exceed turn_ms — see the over-subscription note above. On such a turn
 * the OUTER signal aborts first, the enricher rethrows (it does not degrade),
 * and the executor returns a typed TURN_BUDGET_EXCEEDED. That path is unchanged
 * here. The ceiling's job is narrower and is stated exactly: never grant the
 * review more time than the turn can still be holding after its slowest LEGAL
 * SUCCESSFUL analysis plus a cold prompt fetch.
 *
 * ⚠ AND 30,000 MAY STILL NOT BE ENOUGH — that is a property of the problem, not
 * a defect in this number. The true tail is unobservable while the budget
 * censors it. This is why 2.180-B also makes the loss LOUD
 * (`v5.decision_review_degraded` now fires on the internal timeout, carrying
 * elapsed_ms and budget_ms — decision-review-enricher.ts): the residual loss
 * rate at 30 s becomes measurable instead of inferred. If loss persists, the
 * next lever is NOT more static budget — the ceiling above leaves only 5,000 ms
 * — it is the decomposed (parallel) path or a deadline-aware budget.
 */
export const DECISION_REVIEW_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("DECISION_REVIEW_TIMEOUT_MS", 30_000),
);

/**
 * V6 dual-draft M2 graph-review LLM call timeout (default: 25s, clamped 5s-5m).
 * Same shape as DECISION_REVIEW_TIMEOUT_MS: a synchronous post-success LLM
 * call whose timeout degrades to a thinner-but-valid turn (the M1 draft ships
 * unenriched). The dual-draft stage additionally gates on remaining
 * DRAFT_REQUEST_BUDGET_MS headroom before calling M2 at all — see
 * src/cee/dual-draft/m2-review.ts.
 */
export const M2_REVIEW_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CEE_M2_REVIEW_TIMEOUT_MS", 25_000),
);

/** Clarify-brief LLM call timeout (default: 10s, clamped 5s–5m) */
export const CLARIFY_BRIEF_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CLARIFY_BRIEF_TIMEOUT_MS", 10_000),
);

/** Ask endpoint LLM call timeout (default: 30s, clamped 5s–5m) */
export const ASK_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ASK_TIMEOUT_MS", 30_000),
);

/** Clarifier question-generation LLM call timeout (default: 15s, clamped 5s–5m) */
export const CLARIFIER_QUESTION_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CLARIFIER_QUESTION_TIMEOUT_MS", 15_000),
);

/** Clarifier answer-incorporation LLM call timeout (default: 30s, clamped 5s–5m) */
export const CLARIFIER_ANSWER_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CLARIFIER_ANSWER_TIMEOUT_MS", 30_000),
);

/** Graph orchestrator default LLM call timeout (default: 30s, clamped 5s–5m) */
export const ORCHESTRATOR_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ORCHESTRATOR_TIMEOUT_MS", 30_000),
);

/** Ack-only LLM call timeout for system events (default: 5s, clamped 5s–5m) */
export const ORCHESTRATOR_ACK_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ORCHESTRATOR_ACK_TIMEOUT_MS", 5_000),
);

/** Orchestrator turn budget — total time for a single /orchestrate/v1/turn request (default: 60s, clamped 5s–5m) */
export const ORCHESTRATOR_TURN_BUDGET_MS = clampTimeout(
  parseTimeoutEnv("ORCHESTRATOR_TURN_BUDGET_MS", 60_000),
);

/** Extended turn budget for draft_graph turns (default: 90s, clamped 5s–5m).
 *  Draft graph involves LLM generation + enrichment + repair and routinely
 *  takes 30-45s. The standard 60s budget causes frequent timeouts on first
 *  submissions. */
export const DRAFT_GRAPH_TURN_BUDGET_MS = clampTimeout(
  parseTimeoutEnv("DRAFT_GRAPH_TURN_BUDGET_MS", 90_000),
);

/**
 * PLoT /v2/run call timeout (default: 75s, clamped 5s–5m).
 *
 * Raised 30_000 → 75_000 (2026-07-19). A3 raised ISL to 50s and PLoT's
 * request budget to 70s; at a 30s cap CEE threw almost all of that headroom
 * away and cut off analyses PLoT would have completed.
 *
 * SIZED AGAINST MEASUREMENT, not against a feeling. Real POST /v2/run against
 * staging PLoT (build 9700d8b) with every expensive feature on
 * (include_thresholds / e_values / voi / path_decomposition, n_samples=10000,
 * detail_level=deep), tail := processing_time_ms - meta.isl_ms:
 *
 *   nodes/edges/opts | wall    | processing | isl_ms | TAIL  | network
 *   8  / 13  / 2     |  2.12s  |  1922ms    |  1835  |  87ms |  196ms
 *   15 / 41  / 3     |  4.57s  |  4222ms    |  4138  |  84ms |  344ms
 *   26 / 101 / 4     | 12.54s  | 12115ms    | 12017  |  98ms |  422ms
 *   42 / 211 / 5     | fast-fail — typed `failed`, compute-admission reject
 *
 * The un-budgeted post-compute tail is FLAT at ~84–98ms across a 6.5x span of
 * ISL compute time — it does not scale with graph size. Oversized graphs are
 * REJECTED FAST with a typed failure rather than run slowly, so there is no
 * slow-tail-under-load case hiding at the top end either.
 *
 * WHY 75s AND NOT 85s. The scoping note proposed 85s = PLoT's 70s budget + a
 * 15s allowance for that tail. Measurement puts the tail at ~0.1s, so 15s is
 * ~150x the observed value. 75s = PLoT's 70s REQUEST_BUDGET_MS + ~5s, which
 * is still ~50x the measured tail and absorbs network variance (~0.2–0.45s
 * measured) and clock skew. Spending the other 10s buys nothing measurable
 * and costs 10s of margin against the browser-proxy deadline — the single
 * scarcest quantity in this ladder. See the turn-budget derivation in
 * orchestrator-v5/budgets.ts.
 *
 * ON "PLoT DOESN'T ENFORCE ITS 70s BUDGET". Not a hard abort, true — but it
 * is enforced by pervasive clamping: the base ISL call, the flip search, and
 * threshold analysis are each clamped to the REMAINING request budget
 * (`base_isl_call_budget_clamped`, `flip_thresholds_budget_clamped`,
 * `threshold_analysis_skipped_budget`), so no internal leg can outlive the
 * caller. Structural worst case ≈ 60s base ISL (starts early) + ≤9s
 * thresholds-within-remaining + ~0.1s tail ≈ 70s.
 *
 * NOTE: this now EQUALS PLOT_RUN_BRIEF_TIMEOUT_MS. That is correct, not a
 * collision — both calls are bounded by the SAME PLoT-side REQUEST_BUDGET_MS,
 * which covers the decision-review callback too. The brief carve-out's live
 * function is now the RETRY policy (`skipRetryEntirely`), not the timeout.
 * `timeouts.invariants.test.ts` pins BRIEF >= base so a future raise of this
 * value cannot silently overtake the brief window.
 */
export const PLOT_RUN_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("PLOT_RUN_TIMEOUT_MS", 75_000),
);

/**
 * PLoT /v2/run call timeout for BRIEF-BEARING requests (default: 75s, clamped 30s–5m).
 *
 * When a request carries a decision `brief`, PLoT's `/v2/run` handler synchronously
 * calls back into CEE (`/assist/v1/review` + the LLM-backed `/assist/v1/decision-review`)
 * before responding. Live evidence (flag-activation trial, 2026-07-08) measured this
 * synchronous callback chain at ~40.5s wall time for a modest 4-option graph (including
 * one internal UNGROUNDED_NUMBER-guard retry) — comfortably exceeding the base 30s
 * PLOT_RUN_TIMEOUT_MS and causing a spurious CEE-side timeout+retry that fires the
 * entire (expensive, LLM-backed) callback chain a second time. This budget gives that
 * chain room to complete without CEE aborting mid-flight. Not applied to non-brief runs,
 * which do not trigger the callback and should keep the tighter base budget.
 */
export const PLOT_RUN_BRIEF_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("PLOT_RUN_BRIEF_TIMEOUT_MS", 75_000),
);

/**
 * The longest a SINGLE successful PLoT `/v2/run` attempt can take, whichever
 * branch `plot-client.ts:429` selects.
 *
 * ROADMAP 2.180-B (review amendment A1). `plot-client.ts:429` reads
 *   `const timeoutMs = briefBearing ? PLOT_RUN_BRIEF_TIMEOUT_MS : PLOT_RUN_TIMEOUT_MS;`
 * so the run_analysis path can be bounded by EITHER constant. Anything deriving
 * a downstream budget from "what PLoT can spend" must therefore charge the
 * worst of the pair, not one of them.
 *
 * WHY `max` AND NOT "the constant the path actually selects". The selector is
 * `isBriefBearingRunPayload` — true iff the outbound payload carries a non-empty
 * `brief` — and the run_analysis handler attaches that key only behind
 * `config.cee.sendBriefToPlot` (`CEE_SEND_BRIEF_TO_PLOT`, default FALSE,
 * `run-analysis.ts:423`). So which constant binds is a function of a dark flag
 * that is one env write away. A ceiling derived from the selected branch would
 * be correct today and silently wrong the day that flag flips. `max` is sound
 * under BOTH branches and needs no flag to be proven.
 *
 * The two are EQUAL at repo defaults (75,000 each), which is exactly what makes
 * this dangerous rather than obvious: the defect is invisible until an operator
 * raises one of them, and `timeouts.invariants.test.ts` explicitly PERMITS
 * `PLOT_RUN_BRIEF_TIMEOUT_MS >= PLOT_RUN_TIMEOUT_MS`. A legal env change would
 * otherwise invalidate the decision_review ceiling with every check green.
 */
export const PLOT_RUN_WORST_TIMEOUT_MS = Math.max(
  PLOT_RUN_TIMEOUT_MS,
  PLOT_RUN_BRIEF_TIMEOUT_MS,
);

/** PLoT /v1/validate-patch call timeout (default: 5s, clamped 5s–5m) */
export const PLOT_VALIDATE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("PLOT_VALIDATE_TIMEOUT_MS", 5_000),
);

// ---------------------------------------------------------------------------
// PLoT retry accounting
//
// These live HERE, alongside every other timing constant, rather than beside
// their only consumer in plot-client.ts — because they are not private to that
// client. `DEFAULT_LLM_HANDLER_BUDGET_MS` (orchestrator-v5/budgets.ts) is
// DERIVED from them, and `validateTimeoutRelationships()` below asserts the
// relationship at boot. A constant that two other modules must agree with is a
// ladder rung, not an implementation detail.
// ---------------------------------------------------------------------------

/** Backoff delay before a PLoT retry attempt (ms) */
export const RETRY_BACKOFF_MS = 2_000;

/** Minimum remaining budget required to attempt a PLoT retry (ms) */
export const MIN_RETRY_BUDGET_MS = 2_000;

/**
 * Safety margin subtracted from the retry's clamped timeout (ms).
 *
 * The retry attempt must finish, and its typed error must propagate back
 * through the handler, BEFORE the caller's remaining budget is exhausted.
 * Without this margin a retry sized at exactly `remaining - backoff` would
 * return its error at the instant the budget expires, so the turn would be
 * classified by the outer wall-clock abort rather than by this client's
 * typed PLoTTimeoutError.
 */
export const RETRY_SAFETY_MARGIN_MS = 1_000;

/**
 * Headroom reserved between the V5 turn budget and the browser-proxy deadline.
 *
 * The turn must not merely ABORT before the proxy gives up — CEE must still
 * have time to map the abort to a typed error, compose the OlumiResponse,
 * serialise it, and get the bytes onto the wire. 10s is generous for that
 * work (it is response assembly, not compute) while costing little.
 *
 * SIBLING of `LLM_POST_PROCESSING_HEADROOM_MS`: both reserve tail time inside
 * an outer deadline so the layer below can turn its result into a response.
 * `LLM_POST_PROCESSING_HEADROOM_MS` does it for the DRAFT pipeline inside
 * `DRAFT_REQUEST_BUDGET_MS`; this one does it for the V5 TURN pipeline inside
 * `config.proxy.browserProxyTimeoutMs`. They are independent knobs — the draft
 * and turn pipelines have different tails — but if you are changing one, check
 * whether the other wants the same treatment.
 *
 * Applied by `clampTurnBudgetToProxyDeadline` in `orchestrator-v5/budgets.ts`.
 * That function stays there deliberately: it reads `config.proxy.*`, and this
 * module is kept import-light (`node:process` only).
 */
export const TURN_RESPONSE_HEADROOM_MS = 10_000;

/** Extraction utility default LLM call timeout (default: 30s, clamped 5s–5m) */
export const EXTRACTION_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("EXTRACTION_TIMEOUT_MS", 30_000),
);

/** Prompt store fetch timeout during cache-miss (default: 5s) */
export const PROMPT_STORE_FETCH_TIMEOUT_MS = parseDelayEnv("PROMPT_STORE_FETCH_TIMEOUT_MS", 5_000);

/** SSE backpressure write-drain timeout (default: 30s, clamped 5s–5m) */
export const SSE_WRITE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("SSE_WRITE_TIMEOUT_MS", 30_000),
);

// ---------------------------------------------------------------------------
// Draft-graph specific timeouts
// ---------------------------------------------------------------------------

/** SSE fixture placeholder timeout — show skeleton if draft takes longer (default: 2.5s) */
export const FIXTURE_TIMEOUT_MS = parseDelayEnv("CEE_FIXTURE_TIMEOUT_MS", 2_500);

/** Total draft budget before repair is skipped (default: 25s, clamped 5s–5m) */
export const DRAFT_BUDGET_MS = clampTimeout(
  parseTimeoutEnv("CEE_DRAFT_BUDGET_MS", 25_000),
);

/** Repair LLM call timeout (default: 60s, clamped 5s–5m) */
export const REPAIR_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CEE_REPAIR_TIMEOUT_MS", 60_000),
);

/**
 * Validation pipeline (Pass 2 / o4-mini) call timeout (default: 60s, clamped 5s–5m).
 *
 * 30_000 -> 60_000 (2026-07-31, ROADMAP 2.146). NOT a doubling — both ends were
 * derived, and the interval they leave is narrow.
 *
 * ── FLOOR: what the task needs ──────────────────────────────────────────────
 * Measured through the deployed service (PHASE0-EVIDENCE-2026-07-28/
 * contested-edge-probe.md): a 16-causal-edge graph completed Pass 2 in
 * **27,961 ms** — 93.2% of the old 30 s budget, ~2.0 s of margin, N=1, on a
 * model whose registry `averageLatencyMs` is 75,000 (config/models.ts). Fitting
 * cost(E) = FIXED + PER_EDGE·E with FIXED := 0 maximises the slope, so
 * 27,961 / 16 = 1,747.6 ms per causal edge is an UPPER bound. Real drafts carry
 * 10–30 causal edges (contested-edge-slice.md C3; 33–35 total edges live,
 * cee2-live-latency.md), so covering the top of that range needs **52,427 ms**.
 * 30 s covered 17 edges — under the observed range, not merely tight.
 *
 * ── CEILING: what the turn can afford ───────────────────────────────────────
 * Pass 2 is fired after Repair and awaited after the coaching pass (#758), so
 * it costs TOTAL draft time only `max(0, pass2 − overlap)`. Live staged-frame
 * timings, 3 runs, per-chunk (cee2-live-latency.md): GRAPH_READY 35.8 s,
 * COACHING_READY 59.2 s, COMPLETE 60.9 s median; worst run COMPLETE 63,957 ms.
 * The overlap window is at least COACHING_READY − GRAPH_READY = 23,344 ms; we
 * credit only the design's 19,800 ms, which OVER-states the added latency — the
 * safe direction here.
 *
 * The binding outer bound is the V5 turn abort, `budgets.turn_ms` =
 * min(TURN_BUDGET_MS 180 s, browserProxyTimeoutMs 125 s − TURN_RESPONSE_HEADROOM_MS
 * 10 s) = **115,000 ms** (orchestrator-v5/budgets.ts). Note it is NOT
 * `DRAFT_GRAPH_TURN_BUDGET_MS`: that constant has no runtime consumer — only
 * this file's ladder warning and a self-referential unit test.
 *
 *   worst draft, flag on = 63,957 + (T − 19,800) <= 115,000  =>  T <= 74,800 ms
 *
 * At 60,000 the worst-case draft lands at 104,157 ms, 10,843 ms clear. At
 * 75,000 it lands at 119,157 ms and BLOWS the turn budget — which is why this
 * is 60 s and not "30 s doubled twice". Pinned both ways in
 * tests/unit/cee.validation-pipeline/pass2-budget.test.ts, with the ceiling
 * DERIVED from `getTurnExecutorBudgets()` rather than restating 115,000.
 */
export const VALIDATION_PIPELINE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CEE_VALIDATION_TIMEOUT_MS", 60_000),
);

// ---------------------------------------------------------------------------
// Request budget — single source of truth for draft-graph request lifecycle
// Intended chain (nesting, not fixed numbers — the live values are env-resolved,
// recompute from config): CEE LLM window < CEE draft budget < browser proxy <
// ROUTE_TIMEOUT_MS. The browser-proxy deadline is the BINDING external constraint
// on this ladder: the draft budget must keep a DRAFT_REQUEST_RESPONSE_HEADROOM_MS
// wire-composition margin under it, so the budget cannot rise without the proxy
// deadline rising first.
//
// This is no longer an honour-system comment. `validateTimeoutRelationships()`
// ENFORCES that margin at boot against the env-resolved values (see the
// DRAFT_REQUEST_BUDGET_MS vs browserProxyTimeoutMs rung); a bare
// `DRAFT_REQUEST_BUDGET_MS=130000` override that used to boot silently and
// re-open the proxy-504 symptom now warns instead.
// ---------------------------------------------------------------------------

/** Overall request budget for draft-graph requests (default: 120s).
 *  CEE must return a response (success or error) before this deadline. */
export const DRAFT_REQUEST_BUDGET_MS = parseTimeoutEnv("DRAFT_REQUEST_BUDGET_MS", 120_000);

/** Headroom reserved for post-LLM processing (validation, repair, enrichment).
 *  The effective LLM timeout = DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS
 *
 *  15s -> 10s (2026-07-20 recalibration): the post-LLM tail is MEASURED at
 *  ~1-1.5s end-to-end (live probe: success 50.3s total vs 48.8s provider;
 *  typed failures ~1s tail), so 10s remains >5x the observed worst while
 *  freeing 5s of the fixed request budget for the LLM window — the scarce
 *  quantity that decides the affordable draft token budget below.
 *
 *  SIBLING of `TURN_RESPONSE_HEADROOM_MS`: both reserve tail time inside an
 *  outer deadline so the layer below can turn its result into a response. This
 *  one guards the DRAFT pipeline inside `DRAFT_REQUEST_BUDGET_MS`;
 *  `TURN_RESPONSE_HEADROOM_MS` guards the V5 TURN pipeline inside
 *  `config.proxy.browserProxyTimeoutMs`. Independent knobs (different tails),
 *  but if you are changing one, check whether the other wants the same
 *  treatment. */
export const LLM_POST_PROCESSING_HEADROOM_MS = parseTimeoutEnv("LLM_POST_PROCESSING_HEADROOM_MS", 10_000);

/** Derived: maximum time the LLM draft call may run before being aborted.
 *  Computed as DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS. */
export const DRAFT_LLM_TIMEOUT_MS = Math.max(
  MIN_TIMEOUT_MS,
  DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS,
);

/**
 * Wire-composition margin the draft request budget must keep UNDER the
 * browser-proxy deadline (`config.proxy.browserProxyTimeoutMs`).
 *
 * `DRAFT_REQUEST_BUDGET_MS` is the deadline by which CEE must HAVE a response;
 * the proxy still has to RECEIVE the composed, serialised bytes before it gives
 * up. This reserves that tail (plus any pre-budget request handling the proxy
 * clock already counts). It is the DRAFT-path analogue of
 * `TURN_RESPONSE_HEADROOM_MS` (which guards the V5 TURN budget under the same
 * proxy deadline): separate knobs because the draft and turn tails differ.
 *
 * The value lives HERE as the single source of truth. The ladder-header comment
 * above and the config-schema note on `browserProxyTimeoutMs` DESCRIBE this
 * margin; they must not re-pin the number. Enforced at boot by
 * `validateTimeoutRelationships()` — raising `DRAFT_REQUEST_BUDGET_MS` toward or
 * past the proxy deadline without preserving this margin is the 2026-07-20
 * proxy-504 class.
 */
export const DRAFT_REQUEST_RESPONSE_HEADROOM_MS = 5_000;

// ---------------------------------------------------------------------------
// Draft token affordability — max_tokens is DERIVED from the timeout
//
// ROOT CAUSE of the 2026-07-20 draft outage (chronic: 4/14 failures 07-19,
// 10/15 on 07-20; RCA `parallel-briefs/DRAFT-TIMEOUT-RCA-2026-07-20.md`):
// the draft timeout was derived HERE while draft max_tokens was hand-set in
// `adapters/llm/anthropic.ts` (default 16,384, hard floor 8,192), with
// nothing relating the two. Provider throughput was CONSTANT across both
// outage windows and the prior day (70.8–71.2 tok/s, sd 1.7–3.0), so a 105s
// timeout affords ~7,450 tokens at best — the 8,192 FLOOR alone needed 115s.
// Any generation longer than the affordable budget HUNG to the timeout and
// surfaced as a 504, instead of returning truncated-but-typed.
//
// The derivation lives HERE, next to the timeout it derives from, so the two
// can never drift apart again (trap 12: derive, don't mirror).
// ---------------------------------------------------------------------------

/**
 * Conservative output-throughput floor (tokens/second) — the MARGINAL decode
 * rate, applied to the seconds remaining after `DRAFT_TTFB_SAFETY_OVERHEAD_S`.
 *
 * RECALIBRATED 2026-07-20 (60 -> 90) after the live probe
 * (`parallel-briefs/S-AUDIT-2026-07-20/probe-draft-affordability.md`) proved
 * the original calibration survivor-biased: 3 of 4 ordinary briefs (344-1,730
 * chars) hit the 6,000-token budget and failed as typed 500s.
 *
 * SETTLED THROUGHPUT MODEL (n=84 completed draft LLM calls, Render llm_usage
 * events 2026-07-17..07-20, BOTH builds/max_tokens configs, plus the 3
 * token-capped calls):
 *
 *   duration_s = 13.26 + output_tokens / 101.5     (residual sd 1.74s,
 *                                                    worst residual +5.17s)
 *
 * The earlier "~71 tok/s constant throughput" reading and the probe's
 * "113-115 tok/s" reading were BOTH real but measured different regimes of
 * this one model: effective end-to-end rate RISES with output size because
 * the ~13s fixed overhead amortises (3.1-3.5k-token drafts: ~70-73 effective;
 * 4.7-5.1k: ~78-82; the three capped 6,000-token generations: 111.9-115.1).
 * Neither a model config change nor a measurement artefact — a size-dependent
 * effective rate that a single flat number cannot represent.
 *
 * 90 is defensible against that settled distribution: below the fitted marginal
 * rate (101.5), and below the slowest capped call ONCE THAT RATE IS PUT ON THE
 * FIT'S BASIS. Watch the basis here: the 111.9-115.1 figures above are
 * provider_latency-based (decode window only), whereas the fit is measured
 * request-id-mint -> completion-event and therefore includes the pre-decode
 * overhead the capped calls also paid. On that shared mint->event basis the
 * slowest capped call runs ~92 tok/s, so the floor's real margin over it is
 * ~2 tok/s — NOT the ~22 a naive 90-vs-111.9 comparison implies. A recalibrator
 * MUST compare same-basis before raising this floor; the provider_latency rate
 * is not headroom.
 *
 * The strongest check is basis-independent: the model `15s + tokens/90` predicts
 * a LONGER duration than every single one of the 84 observed calls actually took
 * (0/84 violations; empirical p0, stronger than a p10 requirement).
 */
export const DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S = 90;

/**
 * Safety overhead (seconds) reserved for TTFB + prompt processing + the slow
 * early-decode phase + network.
 *
 * RECALIBRATED 2026-07-20 (5 -> 15): the 84-call fit puts the FIXED component
 * of draft duration at 13.26s (intercept of the linear model above) — the
 * original 5s treated overhead as near-zero because it was buried inside a
 * flat effective rate. 15s covers the fitted intercept with margin; paired
 * with the 90 tok/s floor the resulting affordability model over-predicts the
 * duration of every observed call (see floor comment). At the derived 110s
 * timeout this lands the budget at (110-15)*90 = 8,550 tokens — above the
 * proven >=6,000-token live demand floor and 1.66x the largest COMPLETED
 * draft in the sample (5,148 tokens).
 */
export const DRAFT_TTFB_SAFETY_OVERHEAD_S = 15;

/**
 * The number of output tokens a draft LLM call can AFFORD to emit inside
 * `timeoutMs`, at the conservative throughput floor, after reserving the
 * TTFB/network overhead. Floors at 0 for degenerate timeouts.
 *
 * At the default-derived DRAFT_LLM_TIMEOUT_MS (110s):
 * (110 - 15) x 90 = 8,550 tokens (~97.5s at the fitted 13.26s + tokens/101.5
 * model — inside the 110s cap with ~12s to spare at typical speed).
 */
export function getAffordableDraftTokens(timeoutMs: number): number {
  return Math.max(
    0,
    Math.floor(
      (timeoutMs / 1000 - DRAFT_TTFB_SAFETY_OVERHEAD_S) * DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
    ),
  );
}

/**
 * Boot assertion (the "never again"): a configured draft max_tokens that the
 * derived timeout cannot afford is the exact arithmetic that caused the
 * 2026-07-20 outage. Returns error strings for `server.ts` to log at ERROR
 * level; empty when the configuration is coherent.
 *
 * BOTH sides of the comparison are DERIVED from the real, env-applied values
 * (the caller injects the resolved CEE_MAX_TOKENS_DRAFT; the affordable
 * budget is recomputed from DRAFT_LLM_TIMEOUT_MS here) — never restated.
 * The runtime independently clamps (`resolveDraftMaxTokens` in the Anthropic
 * adapter), so this misconfiguration cannot hang drafts even if the log is
 * ignored — but it should be fixed, not tolerated.
 *
 * Pass `null` when CEE_MAX_TOKENS_DRAFT is unset: the runtime then derives
 * the affordable value itself and no assertion is needed.
 */
export function validateDraftTokenAffordability(
  configuredDraftMaxTokens: number | null,
): string[] {
  const errors: string[] = [];
  const affordable = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS);
  if (configuredDraftMaxTokens !== null && configuredDraftMaxTokens > affordable) {
    errors.push(
      `CEE_MAX_TOKENS_DRAFT (${configuredDraftMaxTokens} tokens) exceeds the affordable draft budget ` +
      `(${affordable} tokens) derived from DRAFT_LLM_TIMEOUT_MS (${DRAFT_LLM_TIMEOUT_MS}ms) at ` +
      `${DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S} tok/s minus ${DRAFT_TTFB_SAFETY_OVERHEAD_S}s overhead — ` +
      `a draft asked to emit more tokens than the timeout affords HANGS to the cap and 504s ` +
      `(2026-07-20 outage class). The runtime clamps the request to ${affordable} tokens; ` +
      `lower CEE_MAX_TOKENS_DRAFT or raise DRAFT_REQUEST_BUDGET_MS.`,
    );
  }
  return errors;
}

/** Derived: budget remaining for repair after the LLM draft call.
 *  Repair is skipped when elapsed draft time exceeds this threshold.
 *  Clamped to 0 — negative values mean repair can never run. */
export function getDerivedRepairBudgetMs(): number {
  return Math.max(0, DRAFT_LLM_TIMEOUT_MS - REPAIR_TIMEOUT_MS);
}

/** Minimum affordable window for a draft LLM retry (default: 55s).
 *
 *  Empirical anchor (recurrence RCA, staging 2026-07-20, n=7 successful
 *  drafts): min 37.9s / p50 43.4s / p95 53.7s / max 54.6s. The floor sits AT
 *  OR ABOVE the slowest success ever observed, so any window this gate
 *  authorizes fits every healthy draft in the distribution. A retry launched
 *  into a smaller window usually cannot complete a real draft — it only burns
 *  provider spend on a result the Step-11 budget guard is guaranteed to
 *  discard. (Originally 35s, which sat BELOW the cited 38–55s anchor and
 *  below the fastest draft ever observed; re-anchored per adversarial-review
 *  condition 1.)
 */
export const MIN_DRAFT_RETRY_BUDGET_MS = parseTimeoutEnv("MIN_DRAFT_RETRY_BUDGET_MS", 55_000);

/** Derived: the LLM window still affordable inside the draft request budget
 *  after `elapsedMs` has been spent, reserving post-processing headroom.
 *  Never exceeds the single-attempt cap (`DRAFT_LLM_TIMEOUT_MS`); floors at 0.
 *
 *  WHY THIS EXISTS (2026-07-20 staging outage). The draft retry used to hand
 *  attempt 2 a full fresh DRAFT_LLM_TIMEOUT_MS, giving a worst case of
 *  105s + ~0.8s + 105s ≈ 211s against a 120s request budget and a 125s
 *  browser-proxy deadline. Every retry outcome was unusable BY CONSTRUCTION:
 *  a retry timeout surfaced at ~211s (proxy 504'd at 125s), and a retry
 *  SUCCESS landed past the budget guard, which threw it away (observed twice:
 *  cee.request_budget.exceeded at 09:51:06Z and 10:12:02Z while llm_usage
 *  recorded the completed — and binned — drafts). Deriving the retry window
 *  from the SAME constants the budget guard enforces makes that arithmetic
 *  impossible to reintroduce by drift: a full-window first-attempt timeout
 *  yields 0 here, so slow-burn timeouts fail fast with CEE's typed error
 *  (~105s, inside every outer deadline) while EARLY failures — the only case
 *  a retry can actually help — keep an affordable, capped second attempt.
 */
/**
 * Milliseconds of REQUEST budget remaining after `elapsedMs`, once the LLM
 * post-processing headroom is reserved (never negative). THE single primitive
 * for "how much request budget is left" — extracted (altitude 2 / reuse F2,
 * 2026-07-24) because the 2026-07-20 staging outage came from re-deriving this
 * exact arithmetic inconsistently across sites (draft retry gate, coaching-pass
 * gate, repair gate). All three now derive from here.
 */
export function remainingRequestBudgetMs(elapsedMs: number): number {
  return Math.max(0, DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS - elapsedMs);
}

export function getDraftLlmRetryBudgetMs(elapsedMs: number): number {
  return Math.min(DRAFT_LLM_TIMEOUT_MS, remainingRequestBudgetMs(elapsedMs));
}

/**
 * Attempt-1 draft max_tokens ceiling — an OPTIONAL upper safety cap.
 *
 * DEFAULT = the FULL affordable budget derived from the draft timeout, so
 * attempt 1 uses the entire output window the deadline affords. Because the
 * default equals `getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS)`, the ceiling
 * is a no-op at the default configuration (`resolveDraftMaxTokens` applies it as
 * a `Math.min(affordable, ceiling)`), and it tracks the timeout by derivation —
 * NOT a hand-set mirror (trap 12).
 *
 * WHY IT WAS RAISED (2026-07-23 firefight — draft down on staging). The prior
 * default was a 6,800 UNDER-cap, chosen (2026-07-21) to truncate attempt 1
 * EARLY so a "lean retry" could fire in the freed window. That design failed in
 * production: claude-sonnet-4-6 now regularly drafts 6,800–8,550 output tokens
 * even for SIMPLE briefs (378-token prompt), so the 6,800 cap truncated attempt
 * 1 BELOW the model's real demand — and the lean retry it freed ran at only
 * ~3,178 tokens (< half of the 6,800 that had just overflowed), so it re-
 * truncated and the request 400'd after ~89s. A model that cannot fit 6,800
 * almost never fits 3,178: the sub-budget retry was doomed by construction.
 *
 * The fix (recommendation `d`, draft-runaway-structural-diagnosis 2026-07-21):
 * give attempt 1 the full affordable budget so the 6,800–8,550-token drafts
 * SUCCEED on attempt 1, and handle the residual true-runaway (>8,550-token)
 * class with salvage-or-fail-fast (`closeTruncatedJson` in the adapter +
 * `isDraftRetryAffordable` below) instead of a doomed sub-budget retry. The old
 * "lean-retry reachability" rationale is RETIRED with this raise.
 *
 * The cap is applied at the adapter (`resolveDraftMaxTokens` ceiling arg,
 * threaded via the draft call's `maxTokensCeiling` opt); it does NOT change the
 * attempt-1 TIMEOUT (still DRAFT_LLM_TIMEOUT_MS), so the max_tokens/timeout
 * derivation the #585 boot assertion guards is untouched — the ceiling can only
 * ever LOWER the affordable budget, never raise it past what the timeout
 * affords. Env override (`CEE_DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL`) is available
 * for staging tuning, but a value BELOW affordability re-opens the exact
 * attempt-1 starvation this raise removed — keep it at or above affordable.
 */
export const DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL = parseIntEnv(
  "CEE_DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL",
  getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS),
);

/**
 * Output-token demand floor a LEAN corrective draft must be able to afford
 * before the lean-retry backstop (parse.ts Step 7) is allowed to fire.
 *
 * The backstop fires ONE corrective retry when the first draft truncates at
 * max_tokens, appending a directive that cuts output-token demand (the primary
 * trade-off only, a hard node ceiling, numbers qualitative). This floor is a
 * MATCHED PAIR with that directive's node ceiling in `src/cee/constants.ts`
 * (`DRAFT_LEAN_RETRY_DIRECTIVE`): both are anchored to the observed CONVERGENT
 * draft distribution, so the retry only fires when the remaining window can
 * COMPLETE the graph the directive actually asks for. Derive them together —
 * a directive asking for a ≤12-node graph paired with a floor sized above
 * anything larger would fire retries that truncate again.
 *
 * RECALIBRATED 4,500 -> 2,700 (2026-07-21, lean-retry reachability). The 4,500
 * value was calibrated to the S-AUDIT-2026-07-20 V2/V3/V4c probes (4,065-4,220
 * tokens), which were the runaway brief with ONE dimension removed — still
 * relatively rich. Against the attempt-1 sentinel (6,800), a runaway truncates
 * with only ~30-48s of window left (affording ~1,650-2,970 tokens at the
 * conservative floor), so a 4,500-token floor could NEVER be met and the retry
 * stayed unreachable. 2,700 is calibrated instead to the observed healthy
 * CONVERGED drafts (12-14 nodes / 2,206-2,601 tokens) — but pinned just ABOVE
 * the TOP of that band (2,601), not into it. That is the point of the raise: a
 * boundary-authorized retry (one whose freed window affords EXACTLY the floor)
 * is then sized above the largest band-typical converged draft, so it can no
 * longer re-truncate on band-typical output the way a 2,500-token authorization
 * (below the 2,601 top) could. Reachability still closes at the higher floor
 * (re-verified): a runaway now truncating ~63s into the window frees a ~47s
 * retry budget, and getAffordableDraftTokens(~47s) ≈ 2,907 tokens ≥ 2,700 ✓ —
 * the retry clears the raised floor with ~200 tokens of margin. Budget honesty
 * is preserved (2026-07-20 RCA class): when even 2,700 tokens are unaffordable
 * — a late truncation (>~65s elapsed) — the gate still fails fast with the
 * typed truncation error rather than burn a second generation guaranteed to
 * truncate again or be discarded by the Step-11 budget guard.
 *
 * Paired with `getAffordableDraftTokens(getDraftLlmRetryBudgetMs(elapsed))`:
 * the remaining window must afford at least this many tokens at the derived
 * throughput floor, and the lean call's own derived max_tokens equals exactly
 * that affordable figure — so the gate checks precisely what the retry gets.
 * NOT env-gated (no new flags — the constant is derived from the measured
 * converged-draft distribution, not tuned per deployment).
 */
export const LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR = 2_700;

/**
 * ⭐ THE ANTI-DOOM GUARD — the SINGLE definition of "is another draft generation
 * worth funding?" Every retry/abort/skip decision in the draft path routes
 * through this one function. Do NOT re-express it, and do NOT compare against
 * `LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR` anywhere else (see the drift pin in
 * `tests/unit/draft-token-affordability.test.ts`).
 *
 * A generation that ended without a usable graph — truncated at max_tokens, or
 * aborted by the runaway detector — committed to a graph it could not finish
 * inside `priorAttemptMaxTokens` output tokens. Funding the NEXT generation with
 * a budget SMALLER than that is doomed by construction: a model that could not
 * fit `priorAttemptMaxTokens` re-truncates in anything less, burning ~30s of the
 * request budget on a result guaranteed to fail (the exact 2026-07-23 draft-down
 * mechanism: a 6,800-token attempt-1 truncation retried at only ~3,178 tokens →
 * re-truncate → 400 at ~89s).
 *
 * So the next generation may be funded ONLY when the remaining affordable window
 * can pay for AT LEAST the attempt that failed — `>= priorAttemptMaxTokens` —
 * and still clears the converged-graph floor. In the default regime (attempt 1
 * uses the FULL affordable budget) this is essentially never true, so no doomed
 * sub-budget generation can fire; truncation is handled by salvage-or-fail-fast
 * instead. The invariant is independent of the sentinel's value, so it holds
 * even if an operator lowers `CEE_DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL`.
 *
 * ⚠ RENAMED (2026-07-25, skip-gate alignment). It used to be
 * `isLeanRetryAffordable` and govern ONE call site (parse.ts Step 7's lean
 * retry). The SAME rule was independently hand-encoded in the Anthropic
 * adapter's final-attempt skip-gate with a WEAKER floor (a bare `< 2_700`,
 * dropping the `>= priorAttemptMaxTokens` half) — two encodings of one rule with
 * different floors, the estate's dominant defect class. Because 3,150 ≥ 2,700
 * the adapter gate never fired, so a doomed final attempt was allowed to run at
 * ~37% of the budget that had just been abandoned; it truncated by construction,
 * ~90s in, every time (measured: `/assist` A2killer 0/18 on 2026-07-24, caps
 * 3,146–3,826).
 *
 * ⚠⚠ THIS DOCSTRING WAS ITSELF DRIFTED, AND IS CORRECTED HERE (2026-07-25,
 * runaway-class-guard lane). Within hours of being written it claimed to be
 * "the SINGLE definition… EVERY retry/abort/skip decision routes through this
 * one function", said "do NOT re-express it", and listed `draft-budget.ts`
 * (`isAbortableRetryViable` / `shouldSkipDoomedFinalAttempt`) as runtime call
 * sites. The FAST-ABORT commit then re-aimed both of those onto
 * `isRunawayRetryAffordable` — deliberately, and correctly (see THE
 * RUNAWAY-RETRY YARDSTICK below). **All three claims were false at the bytes:**
 * `draft-budget.ts` names this function only in prose (`:514`, `:627`), and the
 * SOLE runtime caller is `parse.ts:607`. A maintainer trusting the file's own
 * stated authority got the wrong control-flow model of the draft path — the
 * hand-maintained-mirror class, applied to a docstring.
 *
 * ⇒ THE ACCURATE STATEMENT. There are TWO affordability rules, because there are
 * two genuinely different questions, and each has exactly one home:
 *   * THIS function — "the previous attempt TRUNCATED at a cap it committed to.
 *     Can the next one afford at least that?" Prior cap IS a demand signal.
 *     Runtime call site: `parse.ts` Step 7 (lean retry). One.
 *   * `isRunawayRetryAffordable` — "the previous attempt was ABORTED before it
 *     emitted an edge, so its cap signals nothing. Can the next one afford what
 *     a CONVERGED draft actually costs?" Runtime call sites: `draft-budget.ts`
 *     (`isAbortableRetryViable`, `shouldSkipDoomedFinalAttempt`).
 * They are not a fork: they share ONE floor (`LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR`,
 * via `Math.max` in both), and the drift pin in
 * `tests/unit/draft-token-affordability.test.ts` still fails loudly if any module
 * outside this file imports that raw constant. What must NOT be re-expressed is
 * either RULE — not "all affordability decisions", which was never true.
 *
 * Pure + exported so the gate arithmetic is unit-testable and mutation-checkable
 * in isolation.
 */
export function isDraftRetryAffordable(
  nextAttemptAffordableTokens: number,
  priorAttemptMaxTokens: number,
): boolean {
  return nextAttemptAffordableTokens >= viableDraftRetryFloorTokens(priorAttemptMaxTokens);
}

/**
 * The token floor `isDraftRetryAffordable` actually checks against, exported so
 * call sites can NAME the number in an error message or a log without importing
 * `LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR` and re-deriving the `Math.max`.
 *
 * That is the whole point: a call site that imports the raw constant is one
 * `Math.max` away from re-encoding the rule with the wrong floor, which is
 * exactly what happened in the Anthropic adapter and cost the drafting bar.
 * `tests/unit/draft-token-affordability.test.ts` FAILS LOUDLY if any module
 * outside this file imports the raw constant.
 */
export function viableDraftRetryFloorTokens(priorAttemptMaxTokens: number): number {
  return Math.max(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR, priorAttemptMaxTokens);
}

// ---------------------------------------------------------------------------
// ⭐ THE RUNAWAY-RETRY YARDSTICK (FAST-ABORT, 2026-07-25)
//
// `isDraftRetryAffordable` above compares the next attempt's budget against the
// cap the PREVIOUS attempt abandoned. For a NATURAL max_tokens truncation that
// is the right comparison — the model genuinely committed to a graph larger than
// its cap, so a smaller cap re-truncates by construction.
//
// ⚠ IT IS THE WRONG COMPARISON FOR A RUNAWAY ABORT, and applying it there
// switched the early-abort detector OFF in the only regime that matters.
// Measured, 29 live runs + a 30th (`parallel-briefs/
// TOKEN-CEILING-EXPERIMENT-2026-07-25.md`, settled — do not re-derive):
//
//   * 17 runaways. `time_to_edges_ms` NULL on 17/17; schema error
//     `edges: Required` on 17/17. The generation NEVER REACHED THE EDGES ARRAY.
//   * `completion_tokens == the cap, EXACTLY` on 17/17 — at 8,550, at 12,000 AND
//     at 16,000. ZERO runaways terminated in the extra room at any ceiling. A
//     runaway has no size it is trying to reach; it consumes what it is given.
//   * 12/12 terminations reached edges in 12,350-21,199 ms and finished the whole
//     graph in 1,652-2,271 completion tokens, 14-16 nodes / 23-29 edges / 4
//     options / 1 goal, at EVERY ceiling. The extra budget is never touched.
//
// So a runaway abort carries NO information about how large a graph the model
// needed. Sizing its retry from the abandoned cap demands
// `aff(110s - ceiling) >= 8,550`, which is arithmetically impossible, so
// `runaway_abort_count` was 0 on every one of the 30 observations: the cure was
// built, correct, and unreachable.
//
// THE CORRECTED YARDSTICK: what does a SUCCESSFUL draft actually need? Derived
// from the corpus maximum with an explicit headroom factor — never hand-picked,
// and pinned in `src/adapters/llm/__tests__/draft-fast-abort-yardstick.test.ts`
// against the full census of successful drafts, so editing either constant
// without editing the corpus FAILS LOUD.
//
// ⚠ THIS DOES NOT WEAKEN #675. The resulting floor (3,581) is STRICTER than the
// 2,700-token floor #675 shipped, and `Math.max` keeps that floor as a hard lower
// bound. Both properties #675 wanted still hold: no retry is funded below what a
// real draft costs, and no abort is authorised into a window the next gate will
// refuse (`DRAFT_RUNAWAY_MIN_RETRY_MS` is re-derived from THIS floor).
// ---------------------------------------------------------------------------

/**
 * The largest completion-token count ever observed on a SUCCESSFUL draft.
 *
 * Complete census (n=15), not a sample: the 12 terminations of the 2026-07-25
 * token-ceiling matrix (1,652 / 1,793 / 1,802 / 1,894 / 1,922 / 1,941 / 1,975 /
 * 2,041 / 2,073 / 2,168 / 2,214 / 2,271), the 30th post-fix observation (2,055),
 * and the 2 successes from this lane's own pre-merge `/assist` baseline on
 * `b9e02bd` (1,953 and **2,387**). Every one produced a well-formed graph
 * (14-16 nodes, 23-29 edges, 4 options, exactly 1 goal, zero orphans) matching
 * the known-good `/assist` comparator. The band is tight and INDEPENDENT of the
 * ceiling offered — 8,550, 12,000 and 16,000 all produced the same ~2,000-token
 * graph.
 *
 * ⚠ THE PIN ALREADY EARNED ITS KEEP. This constant was 2,271 when the fix was
 * written. The lane's own acceptance baseline then observed 2,387 — a LARGER
 * successful draft than anything in the recorded corpus — so the constant, and
 * everything derived from it, moved. That is the mechanism working: a value
 * claiming to be "the largest ever observed" must be re-derived the moment a
 * larger one is observed, not left to rot into a false claim.
 *
 * A recalibrator MUST update the census in the pin test alongside this value;
 * the pin asserts they agree and FAILS LOUD if they drift apart.
 */
export const OBSERVED_MAX_CONVERGED_DRAFT_TOKENS = 2_387;

/**
 * Headroom multiplier applied to the observed maximum when deciding whether a
 * window can fund a real draft.
 *
 * 1.5 is a deliberate, stated choice rather than a fitted one: the corpus is
 * n=15 over two briefs, so the true upper tail is not pinned down, and 1.5x the
 * observed max (3,581) sits comfortably above the largest draft ever seen while
 * still being ~2.4x smaller than the 8,550-token cap the old rule demanded. The
 * cost of being generous here is a rung of the retry ladder; the cost of being
 * mean is a retry that truncates — so the margin leans generous.
 *
 * The corpus max moving 2,271 -> 2,387 mid-lane is exactly why a FACTOR, not a
 * hand-picked absolute, is the right shape here: the floor tracked it without
 * anyone re-deciding a number.
 */
export const DRAFT_RETRY_HEADROOM_FACTOR = 1.5;

/**
 * The slowest time-to-edges ever observed on a HEALTHY draft, pooled across all
 * three live corpora: 19,570 ms (DETECTOR-FIX, 2026-07-24,
 * `cee.llm.draft_edges_reached` n=16), 21,199 ms (2026-07-25 token-ceiling
 * matrix, n=12), and **21,258 ms** (this lane's own pre-merge `/assist`
 * baseline on `b9e02bd`, n=2). Pooled p100 = 21,258 over n=30.
 *
 * This is the number the abort ceiling must clear and the drift tripwire is
 * anchored to. Both live in `draft-budget.ts` and are asserted against this
 * value; a threshold BELOW it aborts healthy drafts, which is exactly why the
 * blanket 20s gate was reverted on 2026-07-24. The 25,000 ms ceiling still
 * clears this by 3,742 ms.
 */
export const OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS = 21_258;

/**
 * The longest SINGLE JSON string token a HEALTHY draft has ever been observed to
 * emit, in raw stream characters.
 *
 * ⭐ THE CORPUS (n=20, complete census of a purpose-built measurement, not a
 * sample), measured live on `ea4229c1` against `/assist/v1/draft-graph` across
 * SIX brief classes — A2killer x10, vague, moderate, complex, plus two briefs
 * built specifically to stress the LONGEST string fields the grammar can emit
 * (a categorical brief to drive `data.encoding_map`, and one carrying verbatim
 * numeric targets to drive `goal_constraints[].source_quote`):
 *
 *   max = 76  `uncertainty_drivers[1]` — "Infrastructure maturity varies across
 *              UK, US-East, US-West, EU-Central, APAC"
 *   next = 60 `node.label` · 59 `uncertainty_drivers[1]` · 55/54/50/48 labels
 *   `goal_constraints[].source_quote` topped out at 48; `encoding_map` was not
 *   emitted at all on any of the 20.
 *
 * ⚠ THE FIRST DERIVATION OF THIS NUMBER WAS WRONG, AND IS RECORDED AS SUCH. A
 * field-aware locator read `uncertainty_drivers` from `node.data` (where the
 * SENT grammar puts it) and scored the corpus max at 47 — normalisation moves
 * the field to `node.observed_state`. It was caught ONLY because a second,
 * field-list-independent raw-byte locator was run over the same captures and
 * disagreed (76 vs 47). Two locators, always: the extractor trap has now flipped
 * a verdict in four consecutive lanes, this one included.
 *
 * ⚠ AND THE FIELD IT LANDED IN IS THE POINT. `uncertainty_drivers[]` is exactly
 * the residual the altitude review named as the sharpest un-closable risk — an
 * unbounded array of unbounded strings, with no formatter and no grammar lever.
 * It is also, measurably, where the longest healthy string already lives.
 */
export const OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS = 76;

/**
 * Headroom multiplier applied to the observed maximum to get the per-string
 * abort ceiling.
 *
 * ⚠ THIS IS DELIBERATELY MUCH LARGER THAN `DRAFT_RETRY_HEADROOM_FACTOR` (1.5),
 * and the asymmetry is the argument, not an oversight:
 *
 *  1. THE TAIL HERE IS GENUINELY UNEXPLORED. The token corpus measures a
 *     whole-graph AGGREGATE and is tightly clustered (1,652-2,387 over n=15) —
 *     1.5x is honest there. This corpus measures a per-field MAXIMUM whose tail
 *     is not pinned down at all: `source_quote` quotes the USER'S BRIEF (bounded
 *     only by `message.max(10000)`), and `encoding_map` is a JSON-stringified
 *     record whose escaped length scales with category count. NEITHER appeared
 *     at length in the 20 drafts, so neither is bounded by this evidence.
 *  2. THE POPULATIONS ARE ~400x APART. A runaway puts the ENTIRE budget inside
 *     one string — 8,550 tokens is >30,000 characters. Against a 76-character
 *     healthy max, a factor that would be reckless on the token yardstick costs
 *     nothing in detection power: 25x still fires within the first few percent
 *     of any real runaway.
 *  3. THE ERROR COSTS ARE ASYMMETRIC. A missed runaway costs the whole request.
 *
 * ⚠ CORRECTED 2026-07-25 (F3). Point 3 used to read "A false abort costs 25s and
 * buys a properly-funded retry" — and that was WRONG for the case it was
 * defending against, in two compounding ways:
 *
 *   (a) THE RETRY WAS NOT A RE-ROLL. Every draft attempt was sent at temperature
 *       0 (`anthropicTemperatureFor(model, {thinking:false})` → `requested ?? 0`;
 *       confirmed on the wire, deployed staging reports `temperature: 0`). A
 *       LEGITIMATE long string is deterministic input to a near-deterministic
 *       decode, so the retry reproduced it and false-aborted again — a false
 *       abort cost EVERY remaining abort, not 25s. Now fixed at the mechanism:
 *       a post-abort retry is sent at `DRAFT_RUNAWAY_RETRY_TEMPERATURE`
 *       (draft-budget.ts), so it CAN differ. The cost model above is true again
 *       only because of that change — do not restore the old sentence without it.
 *   (b) THE ABORTED STREAM IS STILL DISCARDED. `streamOneDraftAttempt` returns
 *       `{kind:"runaway"}` without `acc`, and the `closeTruncatedJson` salvage
 *       runs only on the max_tokens path. Because this trigger is deliberately
 *       ungated on `edgesReached`, it can fire on a stream whose `nodes` AND
 *       `edges` are already complete. Salvage is NOT attempted here on purpose:
 *       the string that tripped the ceiling is, in 10 of 10 characterised cases,
 *       the runaway itself, and salvaging would write it into the user's graph.
 *       The honest statement of the trade is "a false abort discards a possibly-
 *       complete stream and spends one abort", not "costs 25s".
 *
 * So the margin leans hard toward never false-aborting, and still catches the
 * class by an enormous margin. If a legitimate string ever DOES exceed the
 * ceiling, the corpus above is what must be re-derived — not this factor.
 */
export const DRAFT_STRING_RUN_HEADROOM_FACTOR = 25;

/**
 * The token floor a RUNAWAY-ABORT retry must be able to afford — the evidence-
 * derived requirement for a successful draft, floored at the shipped anti-doom
 * floor so this can never become a laxer gate than #675's.
 */
export function viableRunawayRetryFloorTokens(): number {
  return Math.max(
    LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
    Math.ceil(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS * DRAFT_RETRY_HEADROOM_FACTOR),
  );
}

/**
 * ⭐ May another generation be funded after a RUNAWAY ABORT?
 *
 * The runaway-specific twin of `isDraftRetryAffordable`. Same intent — never fund
 * a generation that cannot succeed — measured against the right thing: what a
 * converged draft costs, not what the abandoned attempt was allowed to spend.
 *
 * Deliberately takes NO `priorAttemptMaxTokens`: there is no such thing as a
 * "prior demand" for a generation that never emitted an edge, and accepting the
 * parameter would invite a future edit to start comparing against it again.
 *
 * Runtime call sites: `draft-budget.ts` (`isAbortableRetryViable` and
 * `shouldSkipDoomedFinalAttempt`, both consumed by the Anthropic adapter loop).
 * The lean retry in `parse.ts` Step 7 keeps `isDraftRetryAffordable` — it fires
 * on a natural truncation, where the prior cap IS a demand signal.
 */
export function isRunawayRetryAffordable(nextAttemptAffordableTokens: number): boolean {
  return nextAttemptAffordableTokens >= viableRunawayRetryFloorTokens();
}

// ---------------------------------------------------------------------------
// SSE heartbeat & resume polling
// ---------------------------------------------------------------------------

/** SSE heartbeat interval to prevent proxy idle disconnect (default: 10s) */
export const SSE_HEARTBEAT_INTERVAL_MS = parseDelayEnv("SSE_HEARTBEAT_INTERVAL_MS", 10_000);

/** SSE resume live-follow timeout (default: 120s / 2 min, clamped 5s–5m) */
export const SSE_RESUME_LIVE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("SSE_RESUME_LIVE_TIMEOUT_MS", 120_000),
);

/** SSE resume poll interval (default: 1.5s) */
export const SSE_RESUME_POLL_INTERVAL_MS = parseDelayEnv("SSE_RESUME_POLL_INTERVAL_MS", 1_500);

/** SSE resume snapshot renewal interval (default: 30s) */
export const SSE_RESUME_SNAPSHOT_RENEWAL_MS = parseDelayEnv("SSE_RESUME_SNAPSHOT_RENEWAL_MS", 30_000);

// ---------------------------------------------------------------------------
// Admin / testing timeouts
// ---------------------------------------------------------------------------

/** Admin test LLM call timeout for standard models (default: 120s, clamped 5s–5m) */
export const ADMIN_LLM_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ADMIN_LLM_TIMEOUT_MS", 120_000),
);

/** Admin test LLM call timeout for reasoning models (default: 180s, clamped 5s–5m) */
export const ADMIN_REASONING_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ADMIN_REASONING_TIMEOUT_MS", 180_000),
);

/** Admin test LLM call timeout for reasoning-high models (default: 300s, clamped 5s–5m) */
export const ADMIN_REASONING_HIGH_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ADMIN_REASONING_HIGH_TIMEOUT_MS", 300_000),
);

/** Admin UI toast notification duration (default: 4s) */
export const ADMIN_TOAST_DURATION_MS = parseDelayEnv("ADMIN_TOAST_DURATION_MS", 4_000);

// ---------------------------------------------------------------------------
// Startup diagnostics — call from server.ts to log all resolved values
// ---------------------------------------------------------------------------

/**
 * Budget-layer values this module cannot import.
 *
 * The V5 budget layer (`orchestrator-v5/budgets.ts`) depends on this module,
 * and `clampTurnBudgetToProxyDeadline` reads `config.proxy.*` — so importing
 * either here would create a cycle and drag config loading into a module that
 * is deliberately import-light (`node:process` only). They are INJECTED
 * instead, and the parameter is REQUIRED: a caller cannot omit it and silently
 * skip the rungs below. That "assume-good on absence" is the mirror hazard
 * these checks exist to close.
 */
export interface BudgetLadderInputs {
  /** Resolved per-handler inner budget — `getHandlerBudgetMs()`. */
  handlerBudgetMs: number;
  /** Resolved V5 turn budget — `getTurnExecutorBudgets().turn_ms`. */
  turnBudgetMs: number;
  /** Browser-proxy deadline — `config.proxy.browserProxyTimeoutMs`. */
  browserProxyTimeoutMs: number;
  /**
   * ROADMAP 2.180-B. The decision_review hard-abort budget ACTUALLY IN FORCE —
   * `resolveDecisionReviewHardBudgetMs(config.cee.decisionReviewDecompose)`,
   * NOT the raw `DECISION_REVIEW_TIMEOUT_MS`. The two differ by
   * DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS whenever CEE_DECISION_REVIEW_DECOMPOSE is
   * on, which is one env write away, and a rung that checked the raw constant
   * would certify a budget the service is not actually running.
   *
   * Injected for the same reason as the two above: `timeouts.ts` is kept
   * import-light and cannot reach the enricher (which imports it) or
   * `config.cee.*` without a cycle.
   */
  decisionReviewHardBudgetMs: number;
}

/**
 * Validate timeout relationships that must hold for correct behaviour.
 * Returns an array of warning strings (empty = all good).
 *
 * Runs at BOOT (`server.ts`) against the RESOLVED, env-applied values. That
 * placement is the point: a unit test only ever exercises repo defaults, so a
 * relationship pinned solely in CI stays green while an operator's env
 * override breaks it silently on the deployed instance.
 */
export function validateTimeoutRelationships(ladder: BudgetLadderInputs): string[] {
  const warnings: string[] = [];

  if (ROUTE_TIMEOUT_MS < HTTP_CLIENT_TIMEOUT_MS) {
    warnings.push(
      `ROUTE_TIMEOUT_MS (${ROUTE_TIMEOUT_MS}ms) < HTTP_CLIENT_TIMEOUT_MS (${HTTP_CLIENT_TIMEOUT_MS}ms) — ` +
      `route will abort before LLM client, causing confusing upstream errors and wasted LLM spend`,
    );
  }

  if (ROUTE_TIMEOUT_MS < REASONING_MODEL_TIMEOUT_MS) {
    warnings.push(
      `ROUTE_TIMEOUT_MS (${ROUTE_TIMEOUT_MS}ms) < REASONING_MODEL_TIMEOUT_MS (${REASONING_MODEL_TIMEOUT_MS}ms) — ` +
      `reasoning model calls may exceed route timeout`,
    );
  }

  if (REASONING_MODEL_TIMEOUT_MS < HTTP_CLIENT_TIMEOUT_MS) {
    warnings.push(
      `REASONING_MODEL_TIMEOUT_MS (${REASONING_MODEL_TIMEOUT_MS}ms) < HTTP_CLIENT_TIMEOUT_MS (${HTTP_CLIENT_TIMEOUT_MS}ms) — ` +
      `reasoning models have a shorter timeout than standard models`,
    );
  }

  if (LLM_POST_PROCESSING_HEADROOM_MS >= DRAFT_REQUEST_BUDGET_MS) {
    warnings.push(
      `LLM_POST_PROCESSING_HEADROOM_MS (${LLM_POST_PROCESSING_HEADROOM_MS}ms) >= DRAFT_REQUEST_BUDGET_MS (${DRAFT_REQUEST_BUDGET_MS}ms) — ` +
      `headroom exceeds budget, LLM calls will use minimum timeout (${MIN_TIMEOUT_MS}ms)`,
    );
  }

  if (DRAFT_REQUEST_BUDGET_MS > ROUTE_TIMEOUT_MS) {
    warnings.push(
      `DRAFT_REQUEST_BUDGET_MS (${DRAFT_REQUEST_BUDGET_MS}ms) > ROUTE_TIMEOUT_MS (${ROUTE_TIMEOUT_MS}ms) — ` +
      `request budget exceeds route timeout, Fastify will kill requests before budget expires`,
    );
  }

  if (REPAIR_TIMEOUT_MS > DRAFT_LLM_TIMEOUT_MS) {
    warnings.push(
      `REPAIR_TIMEOUT_MS (${REPAIR_TIMEOUT_MS}ms) > DRAFT_LLM_TIMEOUT_MS (${DRAFT_LLM_TIMEOUT_MS}ms) — ` +
      `repair timeout exceeds LLM draft budget, repair will always be skipped`,
    );
  }

  if (MIN_DRAFT_RETRY_BUDGET_MS >= DRAFT_LLM_TIMEOUT_MS) {
    warnings.push(
      `MIN_DRAFT_RETRY_BUDGET_MS (${MIN_DRAFT_RETRY_BUDGET_MS}ms) >= DRAFT_LLM_TIMEOUT_MS (${DRAFT_LLM_TIMEOUT_MS}ms) — ` +
      `the draft LLM retry is structurally unreachable even when the first attempt fails instantly; ` +
      `retry disabled by arithmetic rather than by policy`,
    );
  }

  if (ORCHESTRATOR_TIMEOUT_MS >= ORCHESTRATOR_TURN_BUDGET_MS) {
    warnings.push(
      `ORCHESTRATOR_TIMEOUT_MS (${ORCHESTRATOR_TIMEOUT_MS}ms) >= ORCHESTRATOR_TURN_BUDGET_MS (${ORCHESTRATOR_TURN_BUDGET_MS}ms) — ` +
      `LLM call timeout must be less than turn budget to leave room for tool execution`,
    );
  }

  if (DRAFT_GRAPH_TURN_BUDGET_MS > ROUTE_TIMEOUT_MS) {
    warnings.push(
      `DRAFT_GRAPH_TURN_BUDGET_MS (${DRAFT_GRAPH_TURN_BUDGET_MS}ms) > ROUTE_TIMEOUT_MS (${ROUTE_TIMEOUT_MS}ms) — ` +
      `draft graph budget exceeds route timeout, Fastify will kill draft requests before budget expires`,
    );
  }

  // V6 dual-draft M2 review: the headroom gate skips M2 when
  // pipelineElapsed + M2_REVIEW_TIMEOUT_MS + ~10s post-review headroom would
  // exceed DRAFT_REQUEST_BUDGET_MS (src/cee/dual-draft/m2-review.ts). A
  // timeout at or above budget−headroom makes the gate always-true and M2
  // permanently skipped as `insufficient_headroom` — warn at boot instead of
  // failing silently per turn.
  if (M2_REVIEW_TIMEOUT_MS + 10_000 >= DRAFT_REQUEST_BUDGET_MS) {
    warnings.push(
      `M2_REVIEW_TIMEOUT_MS (${M2_REVIEW_TIMEOUT_MS}ms) + 10s post-review headroom >= DRAFT_REQUEST_BUDGET_MS (${DRAFT_REQUEST_BUDGET_MS}ms) — ` +
      `the dual-draft headroom gate will always skip M2 (insufficient_headroom); lower CEE_M2_REVIEW_TIMEOUT_MS`,
    );
  }

  // -------------------------------------------------------------------------
  // V5 budget ladder (injected — see BudgetLadderInputs)
  //
  // BOTH ENDS OF EACH RELATIONSHIP BELOW ARE ENV-OVERRIDABLE. That is why they
  // are asserted here and not only in a unit test: `PLOT_RUN_TIMEOUT_MS=120000`
  // on Render satisfies every CI assertion (which runs at repo defaults) while
  // disabling the PLoT retry by arithmetic on the live instance.
  // -------------------------------------------------------------------------

  const minHandlerBudgetMs = PLOT_RUN_TIMEOUT_MS + RETRY_BACKOFF_MS + MIN_RETRY_BUDGET_MS;
  if (ladder.handlerBudgetMs < minHandlerBudgetMs) {
    warnings.push(
      `LLM_BUDGET_HANDLER_MS (${ladder.handlerBudgetMs}ms) < PLOT_RUN_TIMEOUT_MS (${PLOT_RUN_TIMEOUT_MS}ms) + ` +
      `RETRY_BACKOFF_MS (${RETRY_BACKOFF_MS}ms) + MIN_RETRY_BUDGET_MS (${MIN_RETRY_BUDGET_MS}ms) = ${minHandlerBudgetMs}ms — ` +
      `after one full-length PLoT attempt the remaining budget floors at 0 and the PLoT retry becomes UNREACHABLE, ` +
      `disabled by an accounting accident rather than by policy`,
    );
  }

  if (ladder.handlerBudgetMs >= ladder.turnBudgetMs) {
    warnings.push(
      `LLM_BUDGET_HANDLER_MS (${ladder.handlerBudgetMs}ms) >= resolved V5 turn budget (${ladder.turnBudgetMs}ms) — ` +
      `the per-handler inner budget is not nested inside the outer turn budget, so the turn's wall-clock abort ` +
      `will fire before a handler can return its own typed error`,
    );
  }

  // ---------------------------------------------------------------------------
  // ROADMAP 2.180-B — the decision_review budget vs the turn ceiling.
  //
  // WHY THIS RUNG EXISTS. Before it, NOTHING checked the decision_review budget
  // against the turn it has to fit inside — not this function, not CI, not a
  // test. The budget could be raised by env to any value up to `clampTimeout`'s
  // 300,000 ms and the only symptom would be turns dying at the outer abort with
  // a generic TURN_BUDGET_EXCEEDED, with nothing anywhere naming the cause. The
  // M2_REVIEW_TIMEOUT_MS rung above is the precedent and the same shape.
  //
  // WHAT IT ASSERTS. The budget actually armed, plus the prompt fetch the hard
  // timer does NOT bound (`invoke.ts` calls `getSystemPrompt('decision_review')`
  // inside the enricher's try but hands it neither the signal nor the timeout,
  // so a cold cache adds up to PROMPT_STORE_FETCH_TIMEOUT_MS), must still fit in
  // what the turn is holding after its slowest LEGAL SUCCESSFUL analysis — a
  // successful PLoT /v2/run cannot exceed PLOT_RUN_WORST_TIMEOUT_MS.
  //
  // ⚠ IT IS THE MAX OF THE PAIR, NOT THE BASE CONSTANT (review amendment A1).
  // `plot-client.ts:429` selects PLOT_RUN_BRIEF_TIMEOUT_MS for brief-bearing
  // payloads and PLOT_RUN_TIMEOUT_MS otherwise, and which one binds depends on
  // the dark `CEE_SEND_BRIEF_TO_PLOT` flag. Subtracting only the base constant
  // was sound at repo defaults (the two are equal) and would have gone silently
  // wrong the moment an operator raised BRIEF — which the invariants suite
  // explicitly permits. See PLOT_RUN_WORST_TIMEOUT_MS.
  //
  // It is DERIVED, not mirrored: raising EITHER PLoT constant, or lowering
  // BROWSER_PROXY_TIMEOUT_MS, tightens it automatically — which is the point of
  // asserting at boot rather than at repo defaults (both ends are
  // env-overridable — see the header of this block).
  //
  // ⚠ IT WARNS, IT DOES NOT FAIL THE BOOT (review amendment A5a). `server.ts`
  // collects these strings and emits them through a `log.warn` loop; nothing
  // exits non-zero. This rung makes a misconfiguration LOUD in the deploy log;
  // the CI pins in decision-review-budget-2180b.test.ts are what go RED.
  // Hard-failing a boot on a budget relationship is a separate, riskier
  // decision and is deliberately not taken here.
  //
  // ⚠ IT IS A CEILING, NOT A SUFFICIENCY PROOF. The nominal inner budgets
  // (ORCHESTRATOR_TIMEOUT_MS 30,000 routing + handler 85,000) already sum to
  // turn_ms exactly, so no decision_review budget is affordable at nominal worst
  // case — a pre-existing over-subscription this rung deliberately does not
  // restate, because a rung that always fires is a broken alarm.
  const decisionReviewCeilingMs = ladder.turnBudgetMs - PLOT_RUN_WORST_TIMEOUT_MS;
  const decisionReviewChargeMs =
    ladder.decisionReviewHardBudgetMs + PROMPT_STORE_FETCH_TIMEOUT_MS;
  if (decisionReviewChargeMs > decisionReviewCeilingMs) {
    warnings.push(
      `decision_review hard budget (${ladder.decisionReviewHardBudgetMs}ms) + PROMPT_STORE_FETCH_TIMEOUT_MS ` +
      `(${PROMPT_STORE_FETCH_TIMEOUT_MS}ms) = ${decisionReviewChargeMs}ms > resolved V5 turn budget ` +
      `(${ladder.turnBudgetMs}ms) - max(PLOT_RUN_TIMEOUT_MS ${PLOT_RUN_TIMEOUT_MS}ms, ` +
      `PLOT_RUN_BRIEF_TIMEOUT_MS ${PLOT_RUN_BRIEF_TIMEOUT_MS}ms) = ${decisionReviewCeilingMs}ms — ` +
      `after a full-length successful PLoT analysis the turn cannot hold a full-length decision_review, so the ` +
      `outer turn abort will fire mid-review and the turn fails with TURN_BUDGET_EXCEEDED instead of degrading ` +
      `to thin content. Lower DECISION_REVIEW_TIMEOUT_MS, or note that CEE_DECISION_REVIEW_DECOMPOSE adds ` +
      `its fallback floor on top of it`,
    );
  }

  if (ladder.turnBudgetMs >= ladder.browserProxyTimeoutMs) {
    warnings.push(
      `resolved V5 turn budget (${ladder.turnBudgetMs}ms) >= BROWSER_PROXY_TIMEOUT_MS (${ladder.browserProxyTimeoutMs}ms) — ` +
      `the browser proxy will answer before CEE does, so users get a generic PROXY_UPSTREAM_TIMEOUT instead of ` +
      `CEE's typed, analysis-specific error`,
    );
  }

  if (ladder.browserProxyTimeoutMs - ladder.turnBudgetMs < TURN_RESPONSE_HEADROOM_MS) {
    warnings.push(
      `BROWSER_PROXY_TIMEOUT_MS (${ladder.browserProxyTimeoutMs}ms) - resolved V5 turn budget (${ladder.turnBudgetMs}ms) < ` +
      `TURN_RESPONSE_HEADROOM_MS (${TURN_RESPONSE_HEADROOM_MS}ms) — ` +
      `CEE may abort in time but still not finish composing and serialising its typed error before the proxy gives up`,
    );
  }

  // Same shape as the turn-budget rung above, but for the DRAFT request budget.
  // DRAFT_REQUEST_BUDGET_MS is a module constant (env-resolved) rather than an
  // injected value, so this was the ladder's only step the header comment CLAIMED
  // but nothing enforced: a bare DRAFT_REQUEST_BUDGET_MS override could climb to
  // the proxy deadline and re-open the 2026-07-20 proxy-504 symptom while every
  // CI assertion (which runs at repo defaults) stayed green.
  if (ladder.browserProxyTimeoutMs - DRAFT_REQUEST_BUDGET_MS < DRAFT_REQUEST_RESPONSE_HEADROOM_MS) {
    warnings.push(
      `BROWSER_PROXY_TIMEOUT_MS (${ladder.browserProxyTimeoutMs}ms) - DRAFT_REQUEST_BUDGET_MS (${DRAFT_REQUEST_BUDGET_MS}ms) < ` +
      `DRAFT_REQUEST_RESPONSE_HEADROOM_MS (${DRAFT_REQUEST_RESPONSE_HEADROOM_MS}ms) — ` +
      `the draft request budget can hold to its own deadline but leave too little margin to compose and serialise the ` +
      `response before the browser proxy answers; raising DRAFT_REQUEST_BUDGET_MS without also raising ` +
      `BROWSER_PROXY_TIMEOUT_MS re-opens the 2026-07-20 proxy-504 symptom`,
    );
  }

  if (ladder.browserProxyTimeoutMs >= ROUTE_TIMEOUT_MS) {
    warnings.push(
      `BROWSER_PROXY_TIMEOUT_MS (${ladder.browserProxyTimeoutMs}ms) >= ROUTE_TIMEOUT_MS (${ROUTE_TIMEOUT_MS}ms) — ` +
      `Fastify will kill the request before the proxy deadline, so the ladder is no longer strictly nested`,
    );
  }

  return warnings;
}

export function getResolvedTimeouts(): Record<string, number> {
  return {
    HTTP_CLIENT_TIMEOUT_MS,
    ROUTE_TIMEOUT_MS,
    REASONING_MODEL_TIMEOUT_MS,
    UNDICI_CONNECT_TIMEOUT_MS,
    UPSTREAM_RETRY_DELAY_MS,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
    RETRY_MAX_ATTEMPTS,
    SUGGEST_OPTIONS_TIMEOUT_MS,
    CRITIQUE_TIMEOUT_MS,
    EXPLAIN_DIFF_TIMEOUT_MS,
    DECISION_REVIEW_TIMEOUT_MS,
    M2_REVIEW_TIMEOUT_MS,
    CLARIFY_BRIEF_TIMEOUT_MS,
    ASK_TIMEOUT_MS,
    CLARIFIER_QUESTION_TIMEOUT_MS,
    CLARIFIER_ANSWER_TIMEOUT_MS,
    ORCHESTRATOR_TIMEOUT_MS,
    ORCHESTRATOR_ACK_TIMEOUT_MS,
    ORCHESTRATOR_TURN_BUDGET_MS,
    DRAFT_GRAPH_TURN_BUDGET_MS,
    PLOT_RUN_TIMEOUT_MS,
    PLOT_RUN_BRIEF_TIMEOUT_MS,
    PLOT_VALIDATE_TIMEOUT_MS,
    EXTRACTION_TIMEOUT_MS,
    PROMPT_STORE_FETCH_TIMEOUT_MS,
    SSE_WRITE_TIMEOUT_MS,
    FIXTURE_TIMEOUT_MS,
    DRAFT_BUDGET_MS,
    REPAIR_TIMEOUT_MS,
    VALIDATION_PIPELINE_TIMEOUT_MS,
    DRAFT_REQUEST_BUDGET_MS,
    LLM_POST_PROCESSING_HEADROOM_MS,
    DRAFT_LLM_TIMEOUT_MS,
    MIN_DRAFT_RETRY_BUDGET_MS,
    RETRY_BACKOFF_MS,
    MIN_RETRY_BUDGET_MS,
    RETRY_SAFETY_MARGIN_MS,
    TURN_RESPONSE_HEADROOM_MS,
    DRAFT_REQUEST_RESPONSE_HEADROOM_MS,
    SSE_HEARTBEAT_INTERVAL_MS,
    SSE_RESUME_LIVE_TIMEOUT_MS,
    SSE_RESUME_POLL_INTERVAL_MS,
    SSE_RESUME_SNAPSHOT_RENEWAL_MS,
    ADMIN_LLM_TIMEOUT_MS,
    ADMIN_REASONING_TIMEOUT_MS,
    ADMIN_REASONING_HIGH_TIMEOUT_MS,
    ADMIN_TOAST_DURATION_MS,
  };
}
