import { describe, it, expect } from "vitest";
import { hashResponse, shortHash } from "../../src/utils/response-hash.js";

describe("response-hash", () => {
  describe("hashResponse()", () => {
    it("should return consistent hash for same input", () => {
      const body = { message: "hello", code: 200 };

      const hash1 = hashResponse(body);
      const hash2 = hashResponse(body);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it("should return different hash for different input", () => {
      const body1 = { message: "hello" };
      const body2 = { message: "world" };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);

      expect(hash1).not.toBe(hash2);
    });

    it("should be deterministic regardless of key order", () => {
      const body1 = { a: 1, b: 2, c: 3 };
      const body2 = { c: 3, a: 1, b: 2 };
      const body3 = { b: 2, c: 3, a: 1 };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);
      const hash3 = hashResponse(body3);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should handle nested objects", () => {
      const body1 = {
        user: { name: "Alice", age: 30 },
        status: "active",
      };

      const body2 = {
        status: "active",
        user: { age: 30, name: "Alice" },
      };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);

      expect(hash1).toBe(hash2);
    });

    it("should handle arrays", () => {
      const body = {
        items: [1, 2, 3],
        tags: ["a", "b", "c"],
      };

      const hash1 = hashResponse(body);
      const hash2 = hashResponse(body);

      expect(hash1).toBe(hash2);
    });

    it("should be sensitive to array order", () => {
      const body1 = { items: [1, 2, 3] };
      const body2 = { items: [3, 2, 1] };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle null and undefined", () => {
      const body1 = { value: null };
      const body2 = { value: undefined };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);

      // null and undefined should normalize to same hash
      expect(hash1).toBe(hash2);
    });

    it("should handle primitive types", () => {
      const hash1 = hashResponse("hello");
      const hash2 = hashResponse(42);
      const hash3 = hashResponse(true);
      const hash4 = hashResponse(null);

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash3).toMatch(/^[a-f0-9]{64}$/);
      expect(hash4).toMatch(/^[a-f0-9]{64}$/);

      // Different primitives should have different hashes
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
    });

    it("should handle empty objects and arrays", () => {
      const hash1 = hashResponse({});
      const hash2 = hashResponse([]);
      const hash3 = hashResponse("");

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash3).toMatch(/^[a-f0-9]{64}$/);

      // Different empty structures should have different hashes
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
    });

    it("should handle complex nested structures", () => {
      const body = {
        schema: "draft-graph.v1",
        graph: {
          nodes: [
            { id: "a", type: "question", label: "Should we?" },
            { id: "b", type: "option", label: "Yes" },
            { id: "c", type: "option", label: "No" },
          ],
          edges: [
            { from: "a", to: "b", label: "proceed" },
            { from: "a", to: "c", label: "abort" },
          ],
        },
        confidence: 0.85,
      };

      const hash1 = hashResponse(body);
      const hash2 = hashResponse(body);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should detect changes in nested values", () => {
      const body1 = {
        graph: { nodes: [{ id: "a", label: "X" }] },
      };

      const body2 = {
        graph: { nodes: [{ id: "a", label: "Y" }] },
      };

      const hash1 = hashResponse(body1);
      const hash2 = hashResponse(body2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle deeply nested objects", () => {
      const body = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: "deep",
                },
              },
            },
          },
        },
      };

      const hash = hashResponse(body);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("shortHash()", () => {
    it("should return first 8 characters of hash", () => {
      const fullHash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const short = shortHash(fullHash);

      expect(short).toBe("abcdef12");
      expect(short.length).toBe(8);
    });

    it("should work with real hashes", () => {
      const body = { message: "test" };
      const fullHash = hashResponse(body);
      const short = shortHash(fullHash);

      expect(short.length).toBe(8);
      expect(fullHash.startsWith(short)).toBe(true);
    });
  });
});
