/**
 * Shared error types for LLM adapter failures
 * V04: Unified error handling across all adapters (Anthropic, OpenAI, etc.)
 */

/**
 * Upstream timeout error - thrown when an LLM API call times out
 *
 * This error provides detailed information about which phase of the request timed out
 * and includes metrics for observability.
 */
export class UpstreamTimeoutError extends Error {
  readonly name = "UpstreamTimeoutError";

  constructor(
    message: string,
    public readonly provider: string,
    public readonly operation: string,
    public readonly timeoutPhase: "connect" | "headers" | "body" | "pre_aborted",
    public readonly elapsedMs: number,
    public readonly cause?: unknown
  ) {
    super(message);
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UpstreamTimeoutError);
    }
  }
}

/**
 * Upstream HTTP error - thrown when an LLM API returns a non-2xx status
 *
 * Captures the HTTP status code, provider-specific error code, and request ID
 * for cross-referencing with provider logs.
 */
export class UpstreamHTTPError extends Error {
  readonly name = "UpstreamHTTPError";

  constructor(
    message: string,
    public readonly provider: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly requestId: string | undefined,
    public readonly elapsedMs: number,
    public readonly cause?: unknown
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UpstreamHTTPError);
    }
  }
}

/**
 * Upstream non-JSON error — thrown when the LLM returns content that
 * cannot be parsed as JSON (e.g. HTML error page, plain text).
 *
 * Carries a body preview (first 500 chars) for diagnostics without
 * leaking the full upstream response into logs or client responses.
 */
export class UpstreamNonJsonError extends Error {
  readonly name = "UpstreamNonJsonError";

  constructor(
    message: string,
    public readonly provider: string,
    public readonly operation: string,
    public readonly elapsedMs: number,
    public readonly bodyPreview: string,
    public readonly contentType?: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamRequestId?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UpstreamNonJsonError);
    }
  }
}

/**
 * LLM call timeout error — thrown when the draft LLM call exceeds its
 * derived budget (DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS).
 *
 * Distinct from UpstreamTimeoutError (generic HTTP-level timeout) because
 * this is budget-aware and carries the model + request_id for the 504 response.
 */
export class LLMTimeoutError extends Error {
  readonly name = "LLMTimeoutError";

  constructor(
    message: string,
    public readonly model: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
    public readonly requestId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LLMTimeoutError);
    }
  }
}

/**
 * Request budget exceeded error — thrown when the overall request budget
 * (DRAFT_REQUEST_BUDGET_MS) expires during post-LLM processing.
 */
export class RequestBudgetExceededError extends Error {
  readonly name = "RequestBudgetExceededError";

  constructor(
    message: string,
    public readonly budgetMs: number,
    public readonly elapsedMs: number,
    public readonly stage: string,
    public readonly requestId: string,
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestBudgetExceededError);
    }
  }
}

/**
 * Client disconnect error — thrown when the client closes the connection
 * before CEE can return a response.
 */
export class ClientDisconnectError extends Error {
  readonly name = "ClientDisconnectError";

  constructor(
    message: string,
    public readonly elapsedMs: number,
    public readonly requestId: string,
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ClientDisconnectError);
    }
  }
}
