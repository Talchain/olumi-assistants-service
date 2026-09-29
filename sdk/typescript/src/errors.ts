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
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;

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
    const retryAfterSec = (this.details as any)?.retry_after_seconds;
    if (typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      return retryAfterSec * 1000;
    }
    return null;
  }
}

export interface OlumiNetworkErrorOptions {
  cause?: unknown;
  timeout?: boolean;
}

/**
 * Network error (connection failed, timeout, etc.)
 */
export class OlumiNetworkError extends OlumiError {
  public readonly cause?: unknown;
  public readonly isTimeout: boolean;

  constructor(message: string, options: OlumiNetworkErrorOptions = {}) {
    super(message);
    this.name = "OlumiNetworkError";
    this.cause = options.cause;
    this.isTimeout = options.timeout === true;
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
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "OlumiValidationError";
    this.field = field;
    Object.setPrototypeOf(this, OlumiValidationError.prototype);
  }
}
