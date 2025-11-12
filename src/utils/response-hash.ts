/**
 * Deterministic Response Hashing
 *
 * Generates SHA256 hashes of API responses for:
 * - Response integrity verification
 * - Cache key generation
 * - Replay detection
 *
 * Hash is deterministic: same response always produces same hash
 */

import { createHash } from "node:crypto";

/**
 * Generate deterministic hash of response body
 *
 * @param body Response body (any JSON-serializable value)
 * @returns SHA256 hash as hex string
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
 * Canonicalize JSON for deterministic hashing
 *
 * Recursively sorts object keys and normalizes structure:
 * - Objects: sort keys alphabetically
 * - Arrays: preserve order
 * - Primitives: pass through
 * - undefined/null: normalize to null
 */
function canonicalizeJson(value: unknown): unknown {
  // Null or undefined → null
  if (value === null || value === undefined) {
    return null;
  }

  // Array: recursively canonicalize elements
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  // Object: sort keys and recursively canonicalize values
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
      sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  // Primitive: pass through (string, number, boolean)
  return value;
}

/**
 * Short hash prefix for logging (first 8 characters)
 */
export function shortHash(hash: string): string {
  return hash.substring(0, 8);
}
