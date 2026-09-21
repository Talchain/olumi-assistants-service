/**
 * Unit tests for the SALVAGED, INERT attachment filename validator.
 *
 * Written fresh 2026-07-19 as a subset of PR #19's
 * `tests/unit/grounding.security.test.ts`. Only the control-character and
 * length-bound cases were carried across; #19's path-traversal, absolute-path
 * and CSV-formula-injection cases were dropped along with the checks they
 * covered, because those checks have no sink in this repo. See the module
 * header for the full reasoning.
 *
 * These tests deliberately also pin that path-like filenames are ACCEPTED, so
 * that a future reader cannot mistake the validator for a traversal guard.
 */

import { describe, it, expect } from "vitest";
import {
  validateFilename,
  MAX_FILENAME_LENGTH,
} from "../../src/grounding/filename-validation.js";

describe("validateFilename (salvaged, inert)", () => {
  describe("control characters", () => {
    it("accepts an ordinary filename", () => {
      expect(() => validateFilename("quarterly-report.pdf")).not.toThrow();
    });

    it("accepts non-ASCII characters", () => {
      expect(() => validateFilename("rapport-financière-Q3.pdf")).not.toThrow();
    });

    it("rejects a NUL byte", () => {
      expect(() => validateFilename("report\u0000.pdf")).toThrow(
        /filename_invalid: Filename contains control characters/
      );
    });

    it("rejects a newline", () => {
      expect(() => validateFilename("report\n.pdf")).toThrow(
        /control characters/
      );
    });

    it("rejects a carriage return", () => {
      expect(() => validateFilename("report\r.pdf")).toThrow(
        /control characters/
      );
    });

    it("rejects a tab", () => {
      expect(() => validateFilename("report\t.pdf")).toThrow(
        /control characters/
      );
    });

    it("rejects an escape character", () => {
      expect(() => validateFilename("report\u001B[31m.pdf")).toThrow(
        /control characters/
      );
    });

    it("rejects DEL (0x7F)", () => {
      expect(() => validateFilename("report\u007F.pdf")).toThrow(
        /control characters/
      );
    });

    it("accepts 0x20 (space), the first character above the control range", () => {
      expect(() => validateFilename("my report.pdf")).not.toThrow();
    });
  });

  describe("length bound", () => {
    it("accepts a filename of exactly MAX_FILENAME_LENGTH", () => {
      expect(() =>
        validateFilename("a".repeat(MAX_FILENAME_LENGTH))
      ).not.toThrow();
    });

    it("rejects a filename one character over the bound", () => {
      expect(() =>
        validateFilename("a".repeat(MAX_FILENAME_LENGTH + 1))
      ).toThrow(/filename_invalid: Filename exceeds 255 characters/);
    });

    it("pins the bound at 255", () => {
      expect(MAX_FILENAME_LENGTH).toBe(255);
    });
  });

  describe("scope pins — checks NOT imported from PR #19", () => {
    it("does NOT reject path traversal sequences (no filesystem sink here)", () => {
      expect(() => validateFilename("../../etc/passwd")).not.toThrow();
    });

    it("does NOT reject absolute paths", () => {
      expect(() => validateFilename("/etc/passwd")).not.toThrow();
      expect(() => validateFilename("C:\\Windows\\system32")).not.toThrow();
    });

    it("does NOT reject spreadsheet formula prefixes", () => {
      expect(() => validateFilename("=cmd|'/c calc'!A1")).not.toThrow();
    });

    it("does NOT reject an empty filename", () => {
      expect(() => validateFilename("")).not.toThrow();
    });
  });
});
