/**
 * Citation Helper Tests
 *
 * Verifies citation creation, quote verification, and location extraction:
 * - Quote truncation to 100 chars
 * - Quote verification against extracted text
 * - Location marker extraction (PDF/TXT/CSV)
 * - Fuzzy matching for truncated quotes
 */

import { describe, it, expect } from "vitest";
import { makeCitation, verifyQuote, extractLocation } from "../../src/grounding/index.js";

describe("Citation Helpers", () => {
  describe("makeCitation", () => {
    it("creates valid citation with all fields", () => {
      const citation = makeCitation({
        source: "report.pdf",
        quote: "This is a test quote",
        location: "page 2",
      });

      expect(citation.source).toBe("report.pdf");
      expect(citation.quote).toBe("This is a test quote");
      expect(citation.location).toBe("page 2");
    });

    it("truncates quote exceeding 100 chars", () => {
      const longQuote = "A".repeat(150);
      const citation = makeCitation({
        source: "doc.txt",
        quote: longQuote,
        location: "line 5",
      });

      expect(citation.quote.length).toBe(100);
      expect(citation.quote).toMatch(/\.\.\.$/); // Should end with ...
      expect(citation.quote).toBe("A".repeat(97) + "...");
    });

    it("preserves quote at exactly 100 chars", () => {
      const quote = "A".repeat(100);
      const citation = makeCitation({
        source: "file.md",
        quote,
        location: "line 1",
      });

      expect(citation.quote.length).toBe(100);
      expect(citation.quote).toBe(quote);
    });

    it("handles unicode characters in truncation", () => {
      const quote = "Test 🌍".repeat(20); // Unicode emoji
      const citation = makeCitation({
        source: "unicode.txt",
        quote,
        location: "line 10",
      });

      expect(citation.quote.length).toBeLessThanOrEqual(100);
    });

    it("handles empty quote", () => {
      const citation = makeCitation({
        source: "empty.txt",
        quote: "",
        location: "line 1",
      });

      expect(citation.quote).toBe("");
    });
  });

  describe("verifyQuote", () => {
    it("verifies exact match", () => {
      const text = "This is the extracted text from a document.";
      const quote = "extracted text";

      expect(verifyQuote(quote, text)).toBe(true);
    });

    it("verifies case-insensitive match", () => {
      const text = "Hello World";
      const quote = "hello world";

      expect(verifyQuote(quote, text)).toBe(true);
    });

    it("handles whitespace differences", () => {
      const text = "Multiple   spaces   here";
      const quote = "Multiple spaces here";

      expect(verifyQuote(quote, text)).toBe(true);
    });

    it("rejects quote not in text", () => {
      const text = "This is the actual text";
      const quote = "missing quote";

      expect(verifyQuote(quote, text)).toBe(false);
    });

    it("handles partial quotes", () => {
      const text = "The quick brown fox jumps over the lazy dog";
      const quote = "quick brown fox";

      expect(verifyQuote(quote, text)).toBe(true);
    });

    it("handles quotes with punctuation", () => {
      const text = "Hello, world! How are you?";
      const quote = "Hello, world!";

      expect(verifyQuote(quote, text)).toBe(true);
    });

    it("rejects truncated quotes that don't match", () => {
      const text = "This is a very long sentence that continues beyond the quote.";
      const quote = "This is a very long sentence that continues beyond the quote and then some more...";

      expect(verifyQuote(quote, text)).toBe(false);
    });
  });

  describe("extractLocation", () => {
    it("extracts page location from PDF marked text", () => {
      const markedText = "[PAGE 1]\nIntroduction text\n\n[PAGE 2]\nMain content here\n\n[PAGE 3]\nConclusion";
      const quote = "Main content";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("page 2");
    });

    it("extracts line location from TXT marked text", () => {
      const markedText = "1: First line\n2: Second line\n3: Third line with content\n4: Fourth line";
      const quote = "Third line";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("line 3");
    });

    it("extracts row location from CSV marked text", () => {
      const markedText = "[ROW 1] Row count: 10\n[ROW 2] Mean: 25.5\n[ROW 3] Median (p50): 25\n[ROW 4] 90th percentile (p90): 40";
      const quote = "Mean: 25.5";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("row 2");
    });

    it("returns undefined for quote not found", () => {
      const markedText = "[PAGE 1]\nSome content";
      const quote = "Missing quote";

      const location = extractLocation(quote, markedText);

      expect(location).toBeUndefined();
    });

    it("handles case-insensitive matching", () => {
      const markedText = "[PAGE 1]\nHello World";
      const quote = "hello world";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("page 1");
    });

    it("finds nearest marker before quote", () => {
      const markedText = "[PAGE 1]\nIntro\n[PAGE 2]\nStart of page 2\nMiddle content\nEnd of page 2\n[PAGE 3]\nNext page";
      const quote = "Middle content";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("page 2");
    });

    it("handles multiple markers of same type", () => {
      const markedText = "1: Line one\n2: Line two\n3: Line three\n4: Line four";
      const quote = "Line four";

      const location = extractLocation(quote, markedText);

      expect(location).toBe("line 4");
    });

    it("returns undefined when no markers present", () => {
      const markedText = "Plain text without any markers";
      const quote = "text without";

      const location = extractLocation(quote, markedText);

      expect(location).toBeUndefined();
    });
  });
});
