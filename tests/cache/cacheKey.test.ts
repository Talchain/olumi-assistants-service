import { describe, it, expect } from "vitest";
import { generateCacheKey } from "../../src/cache/cacheKey.js";

describe("Cache Key Generation (v1.4.0)", () => {
  describe("Deterministic key generation", () => {
    it("generates identical keys for identical inputs", () => {
      const input = {
        brief: "Should we expand to international markets?",
        flags: { grounding: true },
      };

      const result1 = generateCacheKey(input);
      const result2 = generateCacheKey(input);

      expect(result1.key).toBe(result2.key);
      expect(result1.key).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it("generates different keys for different briefs", () => {
      const input1 = { brief: "Should we expand to international markets?" };
      const input2 = { brief: "Should we focus on domestic growth?" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
    });

    it("generates different keys for different flags", () => {
      const input1 = { brief: "Test brief", flags: { grounding: true } };
      const input2 = { brief: "Test brief", flags: { grounding: false } };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
    });
  });

  describe("Brief normalization", () => {
    it("normalizes whitespace in brief", () => {
      const input1 = { brief: "Should   we    expand   to   international   markets?" };
      const input2 = { brief: "Should we expand to international markets?" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });

    it("normalizes case in brief (case-insensitive)", () => {
      const input1 = { brief: "SHOULD WE EXPAND TO INTERNATIONAL MARKETS?" };
      const input2 = { brief: "should we expand to international markets?" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });

    it("trims leading/trailing whitespace", () => {
      const input1 = { brief: "   Should we expand to international markets?   " };
      const input2 = { brief: "Should we expand to international markets?" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });

    it("handles newlines and tabs in brief", () => {
      const input1 = { brief: "Should\nwe\texpand\n\tto\tinternational\nmarkets?" };
      const input2 = { brief: "Should we expand to international markets?" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });
  });

  describe("Attachment handling", () => {
    it("includes attachment content in cache key", () => {
      const attachment = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("sample content"),
      };

      const input1 = { brief: "Test brief", attachments: [attachment] };
      const input2 = { brief: "Test brief" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
      expect(result1.shape.attachment_count).toBe(1);
      expect(result2.shape.attachment_count).toBe(0);
    });

    it("changes key when attachment content changes", () => {
      const attachment1 = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("content A"),
      };

      const attachment2 = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("content B"),
      };

      const input1 = { brief: "Test brief", attachments: [attachment1] };
      const input2 = { brief: "Test brief", attachments: [attachment2] };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
    });

    it("sorts attachments for deterministic ordering", () => {
      const att1 = { id: "att1", kind: "txt", name: "a.txt", content: Buffer.from("A") };
      const att2 = { id: "att2", kind: "txt", name: "b.txt", content: Buffer.from("B") };

      const input1 = { brief: "Test", attachments: [att1, att2] };
      const input2 = { brief: "Test", attachments: [att2, att1] }; // Reversed order

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      // Keys should be identical despite different ordering
      expect(result1.key).toBe(result2.key);
    });

    it("handles base64 string attachments", () => {
      const bufferAttachment = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("test"),
      };

      const stringAttachment = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("test").toString("base64"),
      };

      const input1 = { brief: "Test", attachments: [bufferAttachment] };
      const input2 = { brief: "Test", attachments: [stringAttachment] };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });
  });

  describe("Flag filtering", () => {
    it("includes only cache-affecting flags", () => {
      const input = {
        brief: "Test brief",
        flags: {
          grounding: true,
          critique: false,
          clarifier: true,
          include_debug: true, // Should be ignored (not cache-affecting)
          some_future_flag: false, // Should be ignored
        },
      };

      const result = generateCacheKey(input);

      expect(result.shape.flags).toEqual({
        grounding: true,
        critique: false,
        clarifier: true,
      });
    });

    it("generates same key when only non-cache-affecting flags differ", () => {
      const input1 = {
        brief: "Test brief",
        flags: { grounding: true, include_debug: true },
      };

      const input2 = {
        brief: "Test brief",
        flags: { grounding: true, include_debug: false },
      };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).toBe(result2.key);
    });

    it("handles missing flags gracefully", () => {
      const input = { brief: "Test brief" };

      const result = generateCacheKey(input);

      expect(result.shape.flags).toEqual({});
      expect(result.key).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("Cache key shape", () => {
    it("includes brief length without exposing content", () => {
      const input = { brief: "Should we expand to international markets?" };

      const result = generateCacheKey(input);

      expect(result.shape.brief_normalized_length).toBeGreaterThan(0);
      expect(result.shape.brief_normalized_length).toBe(
        "should we expand to international markets?".length
      );
    });

    it("includes attachment hashes (truncated) without exposing content", () => {
      const attachment = {
        id: "att1",
        kind: "txt",
        name: "data.txt",
        content: Buffer.from("sensitive content"),
      };

      const input = { brief: "Test brief", attachments: [attachment] };

      const result = generateCacheKey(input);

      expect(result.shape.attachment_count).toBe(1);
      expect(result.shape.attachment_hashes).toHaveLength(1);
      expect(result.shape.attachment_hashes[0]).toHaveLength(8); // Truncated to 8 chars
    });

    it("includes template version for cache invalidation", () => {
      const input = { brief: "Test brief" };

      const result = generateCacheKey(input);

      expect(result.shape.template_version).toBe("v1.0.0");
    });
  });

  describe("Future clarifier support", () => {
    it("includes clarifier answers in cache key", () => {
      const input1 = {
        brief: "Test brief",
        clarifierAnswers: [
          { question: "What is your budget?", answer: "$100k" },
        ],
      };

      const input2 = { brief: "Test brief" };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
      expect(result1.shape.clarifier_answer_count).toBe(1);
      expect(result2.shape.clarifier_answer_count).toBe(0);
    });

    it("changes key when clarifier answers change", () => {
      const input1 = {
        brief: "Test brief",
        clarifierAnswers: [
          { question: "What is your budget?", answer: "$100k" },
        ],
      };

      const input2 = {
        brief: "Test brief",
        clarifierAnswers: [
          { question: "What is your budget?", answer: "$200k" },
        ],
      };

      const result1 = generateCacheKey(input1);
      const result2 = generateCacheKey(input2);

      expect(result1.key).not.toBe(result2.key);
    });
  });
});
