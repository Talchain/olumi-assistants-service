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
 * Decision-review auto-fire LLM call timeout (default: 22s, clamped 5s-5m).
 * V5 Group 1 Task B: the decision_review call fires synchronously after a
 * successful run_analysis with this hard timeout. On timeout the turn still
 * succeeds with thin content (decision_review enrichment absent).
 *
 * ROADMAP 2.73 Fix B: default raised 15s -> 22s. The 15-Jul Paul-session
 * RCA (RC5) observed the call aborting at 15,002ms — a coin flip against
 * observed gpt-4.1 latencies of ~9.7-11.6s. Staging already runs 22s via
 * an env override; raising the CODE default means environments without
 * the override (e.g. prod) do not silently re-inherit the coin flip.
 */
export const DECISION_REVIEW_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("DECISION_REVIEW_TIMEOUT_MS", 22_000),
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

/** Validation pipeline (Pass 2 / o4-mini) call timeout (default: 30s, clamped 5s–5m) */
export const VALIDATION_PIPELINE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CEE_VALIDATION_TIMEOUT_MS", 30_000),
);

// ---------------------------------------------------------------------------
// Request budget — single source of truth for draft-graph request lifecycle
// Intended chain: CEE LLM (105s) < CEE budget (120s) < PLoT proxy (135s) < Render gateway (~150s)
// ---------------------------------------------------------------------------

/** Overall request budget for draft-graph requests (default: 120s).
 *  CEE must return a response (success or error) before this deadline. */
export const DRAFT_REQUEST_BUDGET_MS = parseTimeoutEnv("DRAFT_REQUEST_BUDGET_MS", 120_000);

/** Headroom reserved for post-LLM processing (validation, repair, enrichment).
 *  The effective LLM timeout = DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS
 *
 *  SIBLING of `TURN_RESPONSE_HEADROOM_MS`: both reserve tail time inside an
 *  outer deadline so the layer below can turn its result into a response. This
 *  one guards the DRAFT pipeline inside `DRAFT_REQUEST_BUDGET_MS`;
 *  `TURN_RESPONSE_HEADROOM_MS` guards the V5 TURN pipeline inside
 *  `config.proxy.browserProxyTimeoutMs`. Independent knobs (different tails),
 *  but if you are changing one, check whether the other wants the same
 *  treatment. */
export const LLM_POST_PROCESSING_HEADROOM_MS = parseTimeoutEnv("LLM_POST_PROCESSING_HEADROOM_MS", 15_000);

/** Derived: maximum time the LLM draft call may run before being aborted.
 *  Computed as DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS. */
export const DRAFT_LLM_TIMEOUT_MS = Math.max(
  MIN_TIMEOUT_MS,
  DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS,
);

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
 * Conservative output-throughput floor (tokens/second).
 *
 * Measured effective draft throughput (output_tokens / total wall time):
 * 71.1 tok/s (07-20 morning), 71.2 (07-20 afternoon), 70.8 (07-19),
 * sd 1.7–3.0 — constant across two days, both pods, and both builds.
 * 60 is more than 3 standard deviations below the SLOWEST measured mean, so
 * a generation sized by this floor completes inside its timeout even at a
 * throughput excursion worse than anything ever observed.
 */
export const DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S = 60;

/**
 * Safety overhead (seconds) reserved for TTFB + network + request setup.
 *
 * The measured tok/s figures above are END-TO-END rates (output tokens over
 * total wall time), so first-token latency and network transfer are already
 * folded into them; sibling-call measurements put pure network overhead at
 * ~0.2–0.45s. Reserving a further 5s on top of the 15% throughput discount
 * is deliberate double margin, and still lands the derived budget at 6,000
 * tokens for the current 105s timeout — 1.45x the largest draft ever
 * observed (4,136 tokens).
 */
export const DRAFT_TTFB_SAFETY_OVERHEAD_S = 5;

/**
 * The number of output tokens a draft LLM call can AFFORD to emit inside
 * `timeoutMs`, at the conservative throughput floor, after reserving the
 * TTFB/network overhead. Floors at 0 for degenerate timeouts.
 *
 * At the default-derived DRAFT_LLM_TIMEOUT_MS (105s):
 * (105 - 5) x 60 = 6,000 tokens (~89.5s at the measured 71 tok/s).
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
    RETRY_BACKOFF_MS,
    MIN_RETRY_BUDGET_MS,
    RETRY_SAFETY_MARGIN_MS,
    TURN_RESPONSE_HEADROOM_MS,
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
