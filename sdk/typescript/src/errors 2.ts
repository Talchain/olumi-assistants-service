/**
 * Custom error classes for Olumi SDK
 */

import type { ErrorResponse } from "./types.js";

/**
 * Base error class for all Olumi SDK errors
 */
export class OlumiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OlumiError";
    Object.setPrototypeOf(this, OlumiError.prototype);
  }
}

/**
 * API error (4xx/5xx response from server)
 */
export class OlumiAPIError extends OlumiError {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(statusCode: number, error: ErrorResponse) {
    super(error.message);
    this.name = "OlumiAPIError";
    this.statusCode = statusCode;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.request_id;
    Object.setPrototypeOf(this, OlumiAPIError.prototype);
  }

  /**
   * Check if this error is retryable (5xx or 429)
   */
  isRetryable(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }

  /**
   * Get retry-after delay in milliseconds (if available)
   */
  getRetryAfter(): number | null {
    if (this.code === "RATE_LIMITED" && this.details?.retry_after_seconds) {
      return (this.details.retry_after_seconds as number) * 1000;
    }
    return null;
  }
}

/**
 * Network error (connection failed, timeout, etc.)
 */
export class OlumiNetworkError extends OlumiError {
  readonly cause?: Error;
  readonly isTimeout: boolean;

  constructor(message: string, cause?: Error, isTimeout = false) {
    super(message);
    this.name = "OlumiNetworkError";
    this.cause = cause;
    this.isTimeout = isTimeout;
    Object.setPrototypeOf(this, OlumiNetworkError.prototype);
  }

  /**
   * Network errors are always retryable
   */
  isRetryable(): boolean {
    return true;
  }
}

/**
 * Configuration error (missing API key, invalid URL, etc.)
 */
export class OlumiConfigError extends OlumiError {
  constructor(message: string) {
    super(message);
    this.name = "OlumiConfigError";
    Object.setPrototypeOf(this, OlumiConfigError.prototype);
  }
}

/**
 * Validation error (invalid input before request)
 */
export class OlumiValidationError extends OlumiError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "OlumiValidationError";
    this.field = field;
    Object.setPrototypeOf(this, OlumiValidationError.prototype);
  }
}
