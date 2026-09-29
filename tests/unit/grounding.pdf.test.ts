/**
 * PDF Grounding Tests
 *
 * Verifies PDF text extraction with:
 * - Character limit enforcement
 * - Error handling
 * - Page marker logic (tested via integration tests with real PDFs)
 */

import { describe, it, expect } from "vitest";
import { extractTextFromPdf, enforceCharLimit } from "../../src/grounding/index.js";
import { Buffer } from "node:buffer";

describe("PDF Grounding", () => {
  describe("extractTextFromPdf", () => {
    it("rejects malformed PDF", async () => {
      const invalidPdf = Buffer.from("This is not a PDF");

      await expect(extractTextFromPdf(invalidPdf)).rejects.toThrow(/pdf_parse_failed/);
    });

    it("rejects empty buffer", async () => {
      const emptyPdf = Buffer.from("");

      await expect(extractTextFromPdf(emptyPdf)).rejects.toThrow(/pdf_parse_failed/);
    });

    it("accepts custom character limit parameter", async () => {
      // This tests the parameter passing, actual limit enforcement
      // is tested in integration tests with real PDFs
      const invalidPdf = Buffer.from("Invalid PDF");

      // Should fail to parse regardless of limit
      await expect(extractTextFromPdf(invalidPdf, 10000)).rejects.toThrow();
      await expect(extractTextFromPdf(invalidPdf, 1000)).rejects.toThrow();
    });

    // Note: Testing actual PDF parsing with page markers requires real PDF files.
    // These are covered in integration tests where we use actual PDF documents.
    // Unit tests focus on error handling and parameter validation.
  });

  describe("enforceCharLimit", () => {
    it("accepts text within limit", () => {
      const text = "A".repeat(4000);
      const result = enforceCharLimit(text, 5000);
      expect(result).toBe(text);
    });

    it("rejects text exceeding limit", () => {
      const text = "A".repeat(6000);
      expect(() => enforceCharLimit(text, 5000)).toThrow(/char_limit_exceeded/);
    });

    it("uses default 5k limit", () => {
      const text = "A".repeat(4000);
      const result = enforceCharLimit(text);
      expect(result).toBe(text);

      const longText = "A".repeat(6000);
      expect(() => enforceCharLimit(longText)).toThrow(/char_limit_exceeded/);
    });

    it("includes actual and limit values in error", () => {
      const text = "A".repeat(6000);
      expect(() => enforceCharLimit(text, 5000)).toThrow(/6000.*5000/);
    });

    it("handles exact limit boundary", () => {
      const text = "A".repeat(5000);
      const result = enforceCharLimit(text, 5000);
      expect(result).toBe(text);
      expect(result.length).toBe(5000);
    });

    it("rejects text at limit + 1", () => {
      const text = "A".repeat(5001);
      expect(() => enforceCharLimit(text, 5000)).toThrow(/char_limit_exceeded/);
    });
  });
});
