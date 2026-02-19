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

/** Repair LLM call timeout (default: 20s, clamped 5s–5m) */
export const REPAIR_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("CEE_REPAIR_TIMEOUT_MS", 20_000),
);

// ---------------------------------------------------------------------------
// Request budget — single source of truth for draft-graph request lifecycle
// Intended chain: CEE LLM (105s) < CEE budget (120s) < PLoT proxy (135s) < Render gateway (~150s)
// ---------------------------------------------------------------------------

/** Overall request budget for draft-graph requests (default: 120s).
 *  CEE must return a response (success or error) before this deadline. */
export const DRAFT_REQUEST_BUDGET_MS = parseTimeoutEnv("DRAFT_REQUEST_BUDGET_MS", 120_000);

/** Headroom reserved for post-LLM processing (validation, repair, enrichment).
 *  The effective LLM timeout = DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS */
export const LLM_POST_PROCESSING_HEADROOM_MS = parseTimeoutEnv("LLM_POST_PROCESSING_HEADROOM_MS", 15_000);

/** Derived: maximum time the LLM draft call may run before being aborted.
 *  Computed as DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS. */
export const DRAFT_LLM_TIMEOUT_MS = Math.max(
  MIN_TIMEOUT_MS,
  DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS,
);

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

// ---------------------------------------------------------------------------
// Startup diagnostics — call from server.ts to log all resolved values
// ---------------------------------------------------------------------------

/**
 * Validate timeout relationships that must hold for correct behaviour.
 * Returns an array of warning strings (empty = all good).
 */
export function validateTimeoutRelationships(): string[] {
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
    CLARIFY_BRIEF_TIMEOUT_MS,
    ASK_TIMEOUT_MS,
    CLARIFIER_QUESTION_TIMEOUT_MS,
    CLARIFIER_ANSWER_TIMEOUT_MS,
    ORCHESTRATOR_TIMEOUT_MS,
    EXTRACTION_TIMEOUT_MS,
    PROMPT_STORE_FETCH_TIMEOUT_MS,
    SSE_WRITE_TIMEOUT_MS,
    FIXTURE_TIMEOUT_MS,
    DRAFT_BUDGET_MS,
    REPAIR_TIMEOUT_MS,
    DRAFT_REQUEST_BUDGET_MS,
    LLM_POST_PROCESSING_HEADROOM_MS,
    DRAFT_LLM_TIMEOUT_MS,
    SSE_HEARTBEAT_INTERVAL_MS,
    SSE_RESUME_LIVE_TIMEOUT_MS,
    SSE_RESUME_POLL_INTERVAL_MS,
    SSE_RESUME_SNAPSHOT_RENEWAL_MS,
    ADMIN_LLM_TIMEOUT_MS,
    ADMIN_REASONING_TIMEOUT_MS,
    ADMIN_REASONING_HIGH_TIMEOUT_MS,
  };
}
