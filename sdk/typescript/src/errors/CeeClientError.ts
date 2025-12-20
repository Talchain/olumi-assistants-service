/**
 * CeeClientError
 *
 * Error class for CEE SDK client errors.
 * Used by CeeClient for all error conditions.
 *
 * M1 CEE Orchestrator - CEE SDK Workstream
 *
 * @module
 */

import type { CeeClientErrorCode } from "../types/review.js";

/**
 * Options for CeeClientError construction.
 */
export interface CeeClientErrorOptions {
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Original error that caused this error */
  cause?: unknown;
  /** Additional details about the error */
  details?: Record<string, unknown>;
  /** Request ID if available */
  requestId?: string;
  /** Retry-After header value in seconds */
  retryAfterSeconds?: number;
}

/**
 * Error class for all CEE client errors.
 *
 * Provides structured error information with:
 * - `code`: Machine-readable error code
 * - `message`: Human-readable error message
 * - `retriable`: Whether the request can be retried
 */
export class CeeClientError extends Error {
  /**
   * Machine-readable error code.
   */
  public readonly code: CeeClientErrorCode;

  /**
   * Whether this error is retriable.
   *
   * True for:
   * - CEE_NETWORK_ERROR (transient network issues)
   * - CEE_TIMEOUT (request timed out)
   * - CEE_RATE_LIMIT (rate limited, check retryAfterSeconds)
   * - CEE_INTERNAL_ERROR (server-side, may succeed on retry)
   *
   * False for:
   * - CEE_PROTOCOL_ERROR (service contract violation)
   * - CEE_VALIDATION_FAILED (fix input before retrying)
   * - CEE_CONFIG_ERROR (fix configuration)
   */
  public readonly retriable: boolean;

  /**
   * HTTP status code if this error originated from an HTTP response.
   */
  public readonly statusCode?: number;

  /**
   * Original error that caused this error.
   */
  public readonly cause?: unknown;

  /**
   * Additional details about the error.
   */
  public readonly details?: Record<string, unknown>;

  /**
   * Request ID if available from response headers.
   */
  public readonly requestId?: string;

  /**
   * Retry-After value in seconds for rate-limited requests.
   */
  public readonly retryAfterSeconds?: number;

  constructor(
    code: CeeClientErrorCode,
    message: string,
    options: CeeClientErrorOptions = {},
  ) {
    super(message);
    this.name = "CeeClientError";
    this.code = code;
    this.statusCode = options.statusCode;
    this.cause = options.cause;
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;

    // Determine retriability based on error code
    this.retriable = isRetriableCode(code);

    // Maintain proper stack trace for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CeeClientError);
    }

    // Ensure prototype chain is correct
    Object.setPrototypeOf(this, CeeClientError.prototype);
  }

  /**
   * Get delay in milliseconds before retry.
   *
   * For rate-limited requests, returns the Retry-After value.
   * For other retriable errors, returns a default backoff.
   * For non-retriable errors, returns null.
   */
  getRetryDelayMs(): number | null {
    if (!this.retriable) {
      return null;
    }

    if (this.code === "CEE_RATE_LIMIT" && this.retryAfterSeconds) {
      return this.retryAfterSeconds * 1000;
    }

    // Default exponential backoff base
    return 1000;
  }

  /**
   * Convert to a plain object for logging/serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retriable: this.retriable,
      statusCode: this.statusCode,
      requestId: this.requestId,
      retryAfterSeconds: this.retryAfterSeconds,
      details: this.details,
    };
  }
}

/**
 * Determine if an error code is retriable.
 */
function isRetriableCode(code: CeeClientErrorCode): boolean {
  switch (code) {
    case "CEE_NETWORK_ERROR":
    case "CEE_TIMEOUT":
    case "CEE_RATE_LIMIT":
    case "CEE_INTERNAL_ERROR":
      return true;
    case "CEE_PROTOCOL_ERROR":
    case "CEE_VALIDATION_FAILED":
    case "CEE_CONFIG_ERROR":
      return false;
    default:
      return false;
  }
}

/**
 * Type guard to check if an error is a CeeClientError.
 */
export function isCeeClientError(error: unknown): error is CeeClientError {
  return error instanceof CeeClientError;
}

/**
 * Create a CeeClientError from a fetch/network error.
 */
export function fromNetworkError(
  error: unknown,
  options: { timeout?: boolean; requestId?: string } = {},
): CeeClientError {
  const { timeout = false, requestId } = options;

  if (timeout || (error instanceof DOMException && error.name === "AbortError")) {
    return new CeeClientError(
      "CEE_TIMEOUT",
      "Request timed out",
      { cause: error, requestId },
    );
  }

  const message =
    error instanceof Error ? error.message : "Network request failed";

  return new CeeClientError(
    "CEE_NETWORK_ERROR",
    message,
    { cause: error, requestId },
  );
}

/**
 * Create a CeeClientError from an HTTP response.
 */
export function fromHttpResponse(
  statusCode: number,
  body: unknown,
  requestId?: string,
): CeeClientError {
  const parsed = parseErrorBody(body);

  // Map HTTP status to error code
  let code: CeeClientErrorCode;
  if (statusCode === 429) {
    code = "CEE_RATE_LIMIT";
  } else if (statusCode >= 400 && statusCode < 500) {
    code = "CEE_VALIDATION_FAILED";
  } else {
    code = "CEE_INTERNAL_ERROR";
  }

  // Override with server-provided code if it matches our error codes
  if (parsed.code && isValidCeeClientErrorCode(parsed.code)) {
    code = parsed.code;
  }

  return new CeeClientError(
    code,
    parsed.message || `HTTP ${statusCode}`,
    {
      statusCode,
      requestId: requestId || parsed.requestId,
      retryAfterSeconds: parsed.retryAfterSeconds,
      details: parsed.details,
    },
  );
}

/**
 * Check if a string is a valid CeeClientErrorCode.
 */
function isValidCeeClientErrorCode(code: string): code is CeeClientErrorCode {
  return [
    "CEE_PROTOCOL_ERROR",
    "CEE_NETWORK_ERROR",
    "CEE_TIMEOUT",
    "CEE_VALIDATION_FAILED",
    "CEE_RATE_LIMIT",
    "CEE_INTERNAL_ERROR",
    "CEE_CONFIG_ERROR",
  ].includes(code);
}

/**
 * Parse error body from server response.
 */
function parseErrorBody(body: unknown): {
  code?: string;
  message?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
} {
  if (!body || typeof body !== "object") {
    return {};
  }

  const obj = body as Record<string, unknown>;

  // Handle CEE error format: { schema: "cee.error.v1", code, message, ... }
  if (obj.schema === "cee.error.v1") {
    const trace = obj.trace as Record<string, unknown> | undefined;
    const details = obj.details as Record<string, unknown> | undefined;

    return {
      code: typeof obj.code === "string" ? obj.code : undefined,
      message: typeof obj.message === "string" ? obj.message : undefined,
      requestId: trace && typeof trace.request_id === "string"
        ? trace.request_id
        : undefined,
      retryAfterSeconds: details && typeof details.retry_after_seconds === "number"
        ? details.retry_after_seconds
        : undefined,
      details,
    };
  }

  // Handle generic error format
  return {
    code: typeof obj.code === "string" ? obj.code : undefined,
    message: typeof obj.message === "string" ? obj.message : undefined,
    requestId: typeof obj.request_id === "string" ? obj.request_id : undefined,
    details: typeof obj.details === "object" && obj.details !== null
      ? obj.details as Record<string, unknown>
      : undefined,
  };
}
