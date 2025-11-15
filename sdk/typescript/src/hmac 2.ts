/**
 * HMAC Signature Utilities for Olumi Assistants SDK
 *
 * Provides client-side HMAC-SHA256 signing for API requests with:
 * - Automatic nonce generation (UUID v4)
 * - Timestamp management
 * - Canonical string building
 * - Request signing helpers
 */

import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * HMAC signature headers for API requests
 */
export interface HmacHeaders {
  "X-Olumi-Signature": string;
  "X-Olumi-Timestamp": string;
  "X-Olumi-Nonce": string;
}

/**
 * HMAC signing options
 */
export interface HmacSignOptions {
  /** HMAC secret key (required) */
  secret: string;
  /** Optional custom timestamp (defaults to Date.now()) */
  timestamp?: number;
  /** Optional custom nonce (defaults to UUID v4) */
  nonce?: string;
}

/**
 * Generate a cryptographically secure nonce (UUID v4)
 *
 * @returns UUID v4 string
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * // => "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateNonce(): string {
  return randomUUID();
}

/**
 * Compute SHA256 hash of request body
 *
 * Matches server-side implementation:
 * - Empty body => empty string (not SHA256 of empty)
 * - Non-empty body => hex digest of SHA256
 *
 * @param body - Request body (string or undefined)
 * @returns Body hash string
 */
function hashBody(body: string | undefined): string {
  if (!body || body.length === 0) {
    return ""; // Empty body hash
  }

  return createHash("sha256").update(body).digest("hex");
}

/**
 * Build canonical signing string for HMAC-SHA256
 *
 * Format: `METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_SHA256`
 *
 * @param method - HTTP method (e.g., "POST")
 * @param path - Request path (e.g., "/assist/draft-graph")
 * @param timestamp - Unix timestamp in milliseconds
 * @param nonce - Unique request nonce
 * @param bodyHash - SHA256 hash of request body
 * @returns Canonical string for signing
 */
function buildCanonicalString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): string {
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Sign an API request with HMAC-SHA256
 *
 * Generates signature headers for authenticating requests to the
 * Olumi Assistants Service. Includes timestamp and nonce for replay protection.
 *
 * @param method - HTTP method (uppercase, e.g., "POST")
 * @param path - Request path (e.g., "/assist/draft-graph")
 * @param body - Request body as JSON string (or undefined for GET)
 * @param options - HMAC signing options (secret required)
 * @returns HMAC signature headers to include in request
 *
 * @throws {Error} If secret is not provided
 *
 * @example
 * ```typescript
 * const body = JSON.stringify({ brief: "Create a todo app" });
 * const headers = sign("POST", "/assist/draft-graph", body, {
 *   secret: process.env.HMAC_SECRET!
 * });
 *
 * // Include headers in fetch request
 * await fetch(url, {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *     ...headers
 *   },
 *   body
 * });
 * ```
 */
export function sign(
  method: string,
  path: string,
  body: string | undefined,
  options: HmacSignOptions
): HmacHeaders {
  if (!options.secret) {
    throw new Error("HMAC secret is required for signing");
  }

  // Generate timestamp and nonce
  const timestamp = (options.timestamp || Date.now()).toString();
  const nonce = options.nonce || generateNonce();

  // Compute body hash
  const bodyHash = hashBody(body);

  // Build canonical string
  const canonical = buildCanonicalString(method, path, timestamp, nonce, bodyHash);

  // Generate HMAC-SHA256 signature
  const signature = createHmac("sha256", options.secret)
    .update(canonical)
    .digest("hex");

  return {
    "X-Olumi-Signature": signature,
    "X-Olumi-Timestamp": timestamp,
    "X-Olumi-Nonce": nonce,
  };
}

/**
 * Verify response hash (for response integrity checking)
 *
 * Validates that the response body matches the expected hash signature
 * provided by the server. Prevents response tampering.
 *
 * @param responseBody - Response body as string
 * @param expectedHash - Expected SHA256 hash (hex) from X-Olumi-Response-Hash header
 * @returns True if hash matches, false otherwise
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * const body = await response.text();
 * const hash = response.headers.get("X-Olumi-Response-Hash");
 *
 * if (hash && !verifyResponseHash(body, hash)) {
 *   throw new Error("Response integrity check failed");
 * }
 * ```
 */
export function verifyResponseHash(
  responseBody: string,
  expectedHash: string
): boolean {
  const actualHash = createHash("sha256")
    .update(responseBody)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < expectedHash.length; i++) {
    result |= expectedHash.charCodeAt(i) ^ actualHash.charCodeAt(i);
  }

  return result === 0;
}
