/**
 * Deterministic Response Hashing
 *
 * Generates SHA256 hashes of API responses for:
 * - Response integrity verification
 * - Cache key generation
 * - Replay detection
 * - Cross-service correlation (matches UI implementation)
 *
 * Hash is deterministic: same response always produces same hash
 */

import { createHash } from "node:crypto";

/**
 * Standard hash length for response hashes (12 hex chars)
 */
export const RESPONSE_HASH_LENGTH = 12;

/**
 * Canonicalize JSON for deterministic hashing
 *
 * Recursively sorts object keys and normalizes structure:
 * - Objects: sort keys alphabetically, skip undefined values
 * - Arrays: preserve order, recursively canonicalize elements
 * - null: preserved as null
 * - undefined: skipped (not included in output)
 * - Primitives: pass through (string, number, boolean)
 *
 * This matches the UI implementation for cross-service hash consistency.
 */
export function canonicalizeJson(value: unknown): unknown {
  // null → null
  if (value === null) {
    return null;
  }

  // Array: recursively canonicalize elements
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  // Object: sort keys and recursively canonicalize values, skip undefined
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      // Skip undefined values (matches UI behavior)
      if (v !== undefined) {
        sorted[key] = canonicalizeJson(v);
      }
    }

    return sorted;
  }

  // Primitive: pass through (string, number, boolean)
  return value;
}

/**
 * Compute deterministic response hash
 *
 * Uses canonical JSON serialization (sorted keys, no undefined) and SHA256.
 * Returns first 12 characters of hex digest for brevity.
 *
 * @param body Response body (any JSON-serializable value)
 * @returns 12-character SHA256 hash prefix
 */
export function computeResponseHash(body: unknown): string {
  const canonical = JSON.stringify(canonicalizeJson(body));
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, RESPONSE_HASH_LENGTH);
}

/**
 * Generate deterministic hash of response body
 *
 * @param body Response body (any JSON-serializable value)
 * @returns Full SHA256 hash as hex string (for backwards compatibility)
 * @deprecated Use computeResponseHash() for standard 12-char hash
 */
export function hashResponse(body: unknown): string {
  // Serialize with sorted keys for determinism
  const canonical = canonicalizeJson(body);
  const json = JSON.stringify(canonical);

  // Hash with SHA256
  const hash = createHash("sha256");
  hash.update(json, "utf8");
  return hash.digest("hex");
}

/**
 * Short hash prefix for logging (first 8 characters)
 * @deprecated Use computeResponseHash() which returns 12-char hash
 */
export function shortHash(hash: string): string {
  return hash.substring(0, 8);
}
