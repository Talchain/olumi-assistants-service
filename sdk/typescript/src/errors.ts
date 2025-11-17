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
}

/**
 * Network error (connection failed, timeout, etc.)
 */
export class OlumiNetworkError extends OlumiError {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "OlumiNetworkError";
    this.cause = cause;
    Object.setPrototypeOf(this, OlumiNetworkError.prototype);
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
