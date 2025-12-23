/**
 * Response Hash Tests
 *
 * Verifies deterministic hashing with canonical JSON serialization.
 * Hash algorithm: SHA256, first 12 characters of hex digest.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeJson,
  computeResponseHash,
  hashResponse,
  RESPONSE_HASH_LENGTH,
} from "../../src/utils/response-hash.js";

describe("canonicalizeJson", () => {
  it("should sort object keys alphabetically", () => {
    const input = { z: 1, a: 2, m: 3 };
    const result = canonicalizeJson(input);
    expect(Object.keys(result as object)).toEqual(["a", "m", "z"]);
  });

  it("should preserve null values", () => {
    const input = { a: null, b: 1 };
    const result = canonicalizeJson(input);
    expect(result).toEqual({ a: null, b: 1 });
  });

  it("should skip undefined values in objects", () => {
    const input = { a: 1, b: undefined, c: 3 };
    const result = canonicalizeJson(input);
    expect(result).toEqual({ a: 1, c: 3 });
    expect(Object.keys(result as object)).not.toContain("b");
  });

  it("should recursively sort nested objects", () => {
    const input = { outer: { z: 1, a: 2 }, name: "test" };
    const result = canonicalizeJson(input);
    expect(JSON.stringify(result)).toBe('{"name":"test","outer":{"a":2,"z":1}}');
  });

  it("should preserve array order", () => {
    const input = { arr: [3, 1, 2] };
    const result = canonicalizeJson(input);
    expect((result as any).arr).toEqual([3, 1, 2]);
  });

  it("should handle deeply nested structures", () => {
    const input = {
      level1: {
        z: {
          deep: { c: 3, a: 1, b: 2 },
        },
        a: "first",
      },
    };
    const result = canonicalizeJson(input);
    const json = JSON.stringify(result);
    expect(json).toBe('{"level1":{"a":"first","z":{"deep":{"a":1,"b":2,"c":3}}}}');
  });

  it("should handle mixed arrays and objects", () => {
    const input = {
      items: [{ z: 1, a: 2 }, { b: 3 }],
    };
    const result = canonicalizeJson(input);
    expect(JSON.stringify(result)).toBe('{"items":[{"a":2,"z":1},{"b":3}]}');
  });

  it("should handle primitive values", () => {
    expect(canonicalizeJson("string")).toBe("string");
    expect(canonicalizeJson(123)).toBe(123);
    expect(canonicalizeJson(true)).toBe(true);
    expect(canonicalizeJson(false)).toBe(false);
    expect(canonicalizeJson(null)).toBe(null);
  });

  it("should handle empty objects and arrays", () => {
    expect(canonicalizeJson({})).toEqual({});
    expect(canonicalizeJson([])).toEqual([]);
  });
});

describe("computeResponseHash", () => {
  it("should return 12-character hash", () => {
    const hash = computeResponseHash({ test: "value" });
    expect(hash).toHaveLength(RESPONSE_HASH_LENGTH);
  });

  it("should be deterministic (same input = same hash)", () => {
    const input = { z: 1, a: 2, m: 3 };
    const hash1 = computeResponseHash(input);
    const hash2 = computeResponseHash(input);
    expect(hash1).toBe(hash2);
  });

  it("should produce same hash regardless of key order", () => {
    const input1 = { z: 1, a: 2, m: 3 };
    const input2 = { a: 2, m: 3, z: 1 };
    const input3 = { m: 3, z: 1, a: 2 };

    const hash1 = computeResponseHash(input1);
    const hash2 = computeResponseHash(input2);
    const hash3 = computeResponseHash(input3);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("should produce different hashes for different values", () => {
    const hash1 = computeResponseHash({ a: 1 });
    const hash2 = computeResponseHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("should ignore undefined values consistently", () => {
    const withUndefined = { a: 1, b: undefined, c: 3 };
    const withoutUndefined = { a: 1, c: 3 };

    const hash1 = computeResponseHash(withUndefined);
    const hash2 = computeResponseHash(withoutUndefined);

    expect(hash1).toBe(hash2);
  });

  // Document actual test vectors for our implementation
  it("should match documented test vectors", () => {
    // Test vector 1: Simple object with unordered keys
    const vector1 = { z: 1, a: 2, m: 3 };
    const hash1 = computeResponseHash(vector1);
    expect(hash1).toBe("ebba85cfdc0a");

    // Test vector 2: Nested object
    const vector2 = { outer: { z: 1, a: 2 }, name: "test" };
    const hash2 = computeResponseHash(vector2);
    expect(hash2).toBe("08b91d33cd40");
  });
});

describe("hashResponse (deprecated)", () => {
  it("should return full 64-character SHA256 hash", () => {
    const hash = hashResponse({ test: "value" });
    expect(hash).toHaveLength(64);
  });

  it("should be deterministic", () => {
    const input = { a: 1, b: 2 };
    const hash1 = hashResponse(input);
    const hash2 = hashResponse(input);
    expect(hash1).toBe(hash2);
  });
});

describe("RESPONSE_HASH_LENGTH", () => {
  it("should be 12", () => {
    expect(RESPONSE_HASH_LENGTH).toBe(12);
  });
});
