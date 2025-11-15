/**
 * Consolidated Hash Utilities
 *
 * Provides both cryptographic and non-cryptographic hashing functions
 * to avoid duplicate implementations across the codebase.
 *
 * Usage:
 * - Cryptographic: HMAC-SHA256 for secure token signing, share IDs
 * - Non-cryptographic: Fast hashing for IDs, prefixes, telemetry grouping
 */

import { createHmac } from "node:crypto";

/**
 * Fast non-cryptographic hash for IDs and prefixes
 *
 * Uses a simple 32-bit hash algorithm (Java-style hashCode).
 * NOT suitable for security - use for telemetry, grouping, prefixes only.
 *
 * @param input - String to hash
 * @param length - Output length in hex characters (default: 8)
 * @returns Hex string of specified length
 *
 * @example
 * ```typescript
 * const keyId = fastHash("api_key_abc123"); // "a3f5c7d1"
 * const prefix = fastHash("attachment_data", 16); // "a3f5c7d1e2b8f4a6"
 * ```
 */
export function fastHash(input: string, length: number = 8): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to hex and pad to ensure consistent length
  const hexHash = Math.abs(hash).toString(16);
  return hexHash.padStart(length, '0').substring(0, length);
}

/**
 * HMAC-SHA256 cryptographic hash
 *
 * Suitable for secure token signing, authentication, integrity checks.
 * Requires a secret key.
 *
 * @param data - Data to hash
 * @param secret - Secret key for HMAC
 * @param outputFormat - Output format: "hex" (default) or "base64"
 * @param length - Optional truncation length (in characters after encoding)
 * @returns HMAC-SHA256 hash in specified format
 *
 * @example
 * ```typescript
 * const signature = hmacSha256("user_data", "secret_key"); // Full hex hash
 * const shortHash = hmacSha256("share_123", "secret", "hex", 16); // Truncated to 16 chars
 * ```
 */
export function hmacSha256(
  data: string,
  secret: string,
  outputFormat: "hex" | "base64" = "hex",
  length?: number
): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  const hash = hmac.digest(outputFormat);

  if (length !== undefined) {
    return hash.substring(0, length);
  }

  return hash;
}

/**
 * HMAC-SHA256 with object input
 *
 * Automatically JSON-stringifies the input for hashing.
 * Useful for hashing structured data consistently.
 *
 * @param data - Object to hash (will be JSON-stringified)
 * @param secret - Secret key for HMAC
 * @param outputFormat - Output format: "hex" (default) or "base64"
 * @returns HMAC-SHA256 hash
 *
 * @example
 * ```typescript
 * const hash = hmacSha256Object({ userId: 123, action: "login" }, "secret");
 * ```
 */
export function hmacSha256Object(
  data: Record<string, unknown> | unknown[],
  secret: string,
  outputFormat: "hex" | "base64" = "hex"
): string {
  const json = JSON.stringify(data);
  return hmacSha256(json, secret, outputFormat);
}

/**
 * Verify HMAC-SHA256 signature
 *
 * Constant-time comparison to prevent timing attacks.
 *
 * @param data - Original data that was signed
 * @param signature - Signature to verify
 * @param secret - Secret key used for signing
 * @returns True if signature is valid
 *
 * @example
 * ```typescript
 * const valid = verifyHmacSha256("data", "a3f5c7d1...", "secret");
 * ```
 */
export function verifyHmacSha256(data: string, signature: string, secret: string): boolean {
  const expectedSignature = hmacSha256(data, secret, "hex");

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return result === 0;
}
