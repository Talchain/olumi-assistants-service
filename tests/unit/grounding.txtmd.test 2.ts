/**
 * TXT/MD Grounding Tests
 *
 * Verifies text/markdown extraction with:
 * - Line ending normalization
 * - Trailing space removal
 * - Line number markers for location tracking
 * - 5k character limit enforcement
 */

import { describe, it, expect } from "vitest";
import { extractTextFromTxtMd } from "../../src/grounding/index.js";

describe("TXT/MD Grounding", () => {
  describe("extractTextFromTxtMd", () => {
    it("extracts and normalizes plain text", () => {
      const input = "Line 1\nLine 2\nLine 3";
      const result = extractTextFromTxtMd(input);

      expect(result).toContain("1: Line 1");
      expect(result).toContain("2: Line 2");
      expect(result).toContain("3: Line 3");
    });

    it("normalizes CRLF to LF", () => {
      const input = "Line 1\r\nLine 2\r\nLine 3";
      const result = extractTextFromTxtMd(input);

      // Should not contain \r
      expect(result).not.toContain('\r');
      // Should have proper line markers
      expect(result).toContain("1: Line 1");
      expect(result).toContain("2: Line 2");
    });

    it("normalizes CR to LF", () => {
      const input = "Line 1\rLine 2\rLine 3";
      const result = extractTextFromTxtMd(input);

      expect(result).not.toContain('\r');
      expect(result).toContain("1: Line 1");
      expect(result).toContain("2: Line 2");
    });

    it("trims trailing spaces from lines", () => {
      const input = "Line 1   \nLine 2  \nLine 3";
      const result = extractTextFromTxtMd(input);

      // Should not have trailing spaces before newlines
      expect(result).toContain("1: Line 1\n");
      expect(result).toContain("2: Line 2\n");
      expect(result).not.toMatch(/Line 1 +\n/);
    });

    it("adds line number markers for location tracking", () => {
      const input = "First line\nSecond line\nThird line";
      const result = extractTextFromTxtMd(input);

      expect(result).toMatch(/1: First line/);
      expect(result).toMatch(/2: Second line/);
      expect(result).toMatch(/3: Third line/);
    });

    it("handles markdown syntax", () => {
      const input = "# Heading\n\n## Subheading\n\n- List item 1\n- List item 2";
      const result = extractTextFromTxtMd(input);

      expect(result).toContain("1: # Heading");
      expect(result).toContain("3: ## Subheading");
      expect(result).toContain("5: - List item 1");
    });

    it("enforces 5k character limit", () => {
      const longText = "A".repeat(6000);
      expect(() => extractTextFromTxtMd(longText)).toThrow(/txt_exceeds_limit/);
    });

    it("allows custom character limit", () => {
      const text = "A".repeat(4000);
      const result = extractTextFromTxtMd(text, 10000);
      expect(result).toBeTruthy();
    });

    it("handles empty input", () => {
      const result = extractTextFromTxtMd("");
      expect(result).toBe("1: ");
    });

    it("handles single line", () => {
      const result = extractTextFromTxtMd("Single line");
      expect(result).toBe("1: Single line");
    });

    it("preserves empty lines", () => {
      const input = "Line 1\n\nLine 3";
      const result = extractTextFromTxtMd(input);

      expect(result).toContain("1: Line 1");
      expect(result).toContain("2: ");
      expect(result).toContain("3: Line 3");
    });

    it("includes line count in output", () => {
      const input = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const result = extractTextFromTxtMd(input);

      // Should have 5 line markers
      expect(result.match(/^\d+:/gm)?.length).toBe(5);
    });

    it("handles unicode characters", () => {
      const input = "Hello 世界\nПривет мир\n🌍";
      const result = extractTextFromTxtMd(input);

      expect(result).toContain("1: Hello 世界");
      expect(result).toContain("2: Привет мир");
      expect(result).toContain("3: 🌍");
    });
  });
});
