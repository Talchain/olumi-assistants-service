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
    public readonly timeoutPhase: "connect" | "headers" | "body",
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
