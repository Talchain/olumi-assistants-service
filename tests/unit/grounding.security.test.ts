/**
 * Document Grounding Security Tests (v1.4.0 - PR G)
 *
 * Tests security hardening for document processing:
 * - CSV formula injection prevention
 * - Filename validation (path traversal, control chars)
 * - Binary content detection
 * - PDF security checks (JavaScript, embedded files)
 * - File size limits
 */

import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import {
  validateFilename,
  detectBinaryContent,
  validateCsvSafety,
  validateFileSize,
  validatePdfSecurity,
  validateDocumentSecurity,
} from "../../src/grounding/security.js";

describe("Document Grounding Security (v1.4.0)", () => {
  describe("validateFilename", () => {
    it("accepts valid simple filename", () => {
      expect(() => validateFilename("document.pdf")).not.toThrow();
      expect(() => validateFilename("notes.txt")).not.toThrow();
      expect(() => validateFilename("data_2024.csv")).not.toThrow();
    });

    it("rejects empty filename", () => {
      expect(() => validateFilename("")).toThrow("filename_empty");
      expect(() => validateFilename("  ")).toThrow("filename_empty");
    });

    it("rejects path traversal attempts", () => {
      expect(() => validateFilename("../etc/passwd")).toThrow("filename_invalid");
      expect(() => validateFilename("..\\windows\\system32")).toThrow("filename_invalid");
      expect(() => validateFilename("../../secrets.txt")).toThrow("filename_invalid");
    });

    it("rejects filenames with path separators", () => {
      expect(() => validateFilename("folder/file.txt")).toThrow("filename_invalid");
      expect(() => validateFilename("C:\\Users\\file.txt")).toThrow("filename_invalid");
      expect(() => validateFilename("/var/log/app.log")).toThrow("filename_invalid");
    });

    it("rejects absolute paths", () => {
      expect(() => validateFilename("/root/file.txt")).toThrow("filename_invalid");
      expect(() => validateFilename("C:\\file.txt")).toThrow("filename_invalid");
      expect(() => validateFilename("D:\\data.csv")).toThrow("filename_invalid");
    });

    it("rejects filenames with control characters", () => {
      expect(() => validateFilename("file\x00.txt")).toThrow("filename_invalid");
      expect(() => validateFilename("doc\x1F.pdf")).toThrow("filename_invalid");
      expect(() => validateFilename("data\n.csv")).toThrow("filename_invalid");
    });

    it("rejects oversized filenames", () => {
      const longName = "a".repeat(256) + ".txt";
      expect(() => validateFilename(longName)).toThrow("filename_invalid");
    });

    it("accepts filename with spaces and special chars", () => {
      expect(() => validateFilename("My Document (2024).pdf")).not.toThrow();
      expect(() => validateFilename("file-name_v2.txt")).not.toThrow();
      expect(() => validateFilename("data [backup].csv")).not.toThrow();
    });
  });

  describe("detectBinaryContent", () => {
    it("returns false for text content", () => {
      const buffer = Buffer.from("This is plain text content\nWith multiple lines\n", "utf-8");
      expect(detectBinaryContent(buffer)).toBe(false);
    });

    it("returns false for empty buffer", () => {
      const buffer = Buffer.from("", "utf-8");
      expect(detectBinaryContent(buffer)).toBe(false);
    });

    it("returns true for high null byte content", () => {
      // Create buffer with 50% null bytes
      const buffer = Buffer.alloc(1000);
      for (let i = 0; i < 500; i++) {
        buffer[i] = 0;
      }
      for (let i = 500; i < 1000; i++) {
        buffer[i] = 65; // 'A'
      }
      expect(detectBinaryContent(buffer)).toBe(true);
    });

    it("returns false for occasional null bytes (< 1%)", () => {
      const buffer = Buffer.alloc(1000);
      buffer.fill(65); // 'A'
      // Add 5 null bytes (0.5% - below threshold)
      buffer[0] = 0;
      buffer[100] = 0;
      buffer[200] = 0;
      buffer[300] = 0;
      buffer[400] = 0;

      expect(detectBinaryContent(buffer)).toBe(false);
    });

    it("handles small buffers correctly", () => {
      const textBuffer = Buffer.from("short", "utf-8");
      expect(detectBinaryContent(textBuffer)).toBe(false);

      const binaryBuffer = Buffer.from([0, 0, 0, 65]); // 75% nulls
      expect(detectBinaryContent(binaryBuffer)).toBe(true);
    });
  });

  describe("validateCsvSafety", () => {
    it("accepts safe CSV content", () => {
      const safeCsv = "name,age,city\nAlice,30,NYC\nBob,25,LA\n";
      expect(() => validateCsvSafety(safeCsv)).not.toThrow();
    });

    it("rejects CSV with = formula", () => {
      const maliciousCsv = "name,formula\nAlice,=1+1\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("rejects CSV with + formula", () => {
      const maliciousCsv = "name,calc\nBob,+1+2\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("rejects CSV with - formula", () => {
      const maliciousCsv = "name,value\nCharlie,-10-5\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("rejects CSV with @ formula", () => {
      const maliciousCsv = "name,ref\nDave,@A1\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("rejects CSV with tab prefix", () => {
      const maliciousCsv = "name,value\nEve,\t=1+1\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("rejects CSV starting with formula on first line", () => {
      const maliciousCsv = "=1+1,value\nAlice,100\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("detects formula in quoted cells", () => {
      const maliciousCsv = 'name,formula\nAlice,"=SUM(A1:A10)"\n';
      expect(() => validateCsvSafety(maliciousCsv)).toThrow("csv_formula_injection");
    });

    it("accepts negative numbers that don't look like formulas", () => {
      const safeCsv = "name,balance\nAlice,-50\nBob,-100.5\n";
      // Note: This will still throw because of the "-" prefix
      // This is intentionally strict to prevent any formula injection
      expect(() => validateCsvSafety(safeCsv)).toThrow("csv_formula_injection");
    });

    it("handles empty lines gracefully", () => {
      const csvWithEmptyLines = "name,age\n\nAlice,30\n\nBob,25\n";
      expect(() => validateCsvSafety(csvWithEmptyLines)).not.toThrow();
    });

    it("provides specific error with line and column info", () => {
      const maliciousCsv = "name,age\nAlice,30\nBob,=EVIL()\n";
      expect(() => validateCsvSafety(maliciousCsv)).toThrow(/line 3/);
    });
  });

  describe("validateFileSize", () => {
    it("accepts files within size limit", () => {
      const smallBuffer = Buffer.from("Small file content", "utf-8");
      expect(() => validateFileSize(smallBuffer, "small.txt")).not.toThrow();
    });

    it("accepts files at exactly 10 MB", () => {
      const tenMB = Buffer.alloc(10 * 1024 * 1024);
      expect(() => validateFileSize(tenMB, "large.bin")).not.toThrow();
    });

    it("rejects files exceeding 10 MB", () => {
      const overSized = Buffer.alloc(11 * 1024 * 1024);
      expect(() => validateFileSize(overSized, "huge.bin")).toThrow("file_too_large");
    });

    it("includes filename in error message", () => {
      const overSized = Buffer.alloc(15 * 1024 * 1024);
      expect(() => validateFileSize(overSized, "massive.pdf")).toThrow(/massive\.pdf/);
    });

    it("handles empty files", () => {
      const empty = Buffer.alloc(0);
      expect(() => validateFileSize(empty, "empty.txt")).not.toThrow();
    });
  });

  describe("validatePdfSecurity", () => {
    it("accepts safe PDF without suspicious features", () => {
      const safePdf = Buffer.from("%PDF-1.4\nSafe content here\n%%EOF", "binary");
      expect(() => validatePdfSecurity(safePdf)).not.toThrow();
    });

    it("rejects PDF with JavaScript", () => {
      const maliciousPdf = Buffer.from(
        "%PDF-1.4\n/JavaScript <</S /JavaScript>>\n%%EOF",
        "binary"
      );
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow("pdf_security_risk");
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow(/JavaScript/);
    });

    it("rejects PDF with /JS action", () => {
      const maliciousPdf = Buffer.from("%PDF-1.4\n/JS (app.alert('XSS'))\n%%EOF", "binary");
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow("pdf_security_risk");
    });

    it("rejects PDF with embedded files", () => {
      const maliciousPdf = Buffer.from(
        "%PDF-1.4\n/EmbeddedFile <</Type /Filespec>>\n%%EOF",
        "binary"
      );
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow("pdf_security_risk");
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow(/embedded/i);
    });

    it("rejects PDF with launch actions", () => {
      const maliciousPdf = Buffer.from("%PDF-1.4\n/Launch /Win (cmd.exe)\n%%EOF", "binary");
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow("pdf_security_risk");
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow(/launch/i);
    });

    it("rejects PDF with suspicious URI/GoToR", () => {
      const maliciousPdf = Buffer.from(
        "%PDF-1.4\n/URI /GoToR (http://evil.com)\n%%EOF",
        "binary"
      );
      expect(() => validatePdfSecurity(maliciousPdf)).toThrow("pdf_security_risk");
    });

    it("handles PDF with benign URI without GoToR", () => {
      const safePdf = Buffer.from("%PDF-1.4\n/URI (http://example.com)\n%%EOF", "binary");
      // Should not throw - only suspicious when combined with GoToR
      expect(() => validatePdfSecurity(safePdf)).not.toThrow();
    });
  });

  describe("validateDocumentSecurity (integration)", () => {
    it("validates PDF with all checks", () => {
      const safePdf = Buffer.from("%PDF-1.4\nSafe content\n%%EOF", "binary");
      expect(() =>
        validateDocumentSecurity({
          filename: "report.pdf",
          buffer: safePdf,
          kind: "pdf",
        })
      ).not.toThrow();
    });

    it("rejects PDF with JavaScript", () => {
      const maliciousPdf = Buffer.from("%PDF-1.4\n/JavaScript\n%%EOF", "binary");
      expect(() =>
        validateDocumentSecurity({
          filename: "evil.pdf",
          buffer: maliciousPdf,
          kind: "pdf",
        })
      ).toThrow("pdf_security_risk");
    });

    it("validates TXT with binary check", () => {
      const textBuffer = Buffer.from("Plain text file\nMultiple lines\n", "utf-8");
      expect(() =>
        validateDocumentSecurity({
          filename: "notes.txt",
          buffer: textBuffer,
          kind: "txt",
        })
      ).not.toThrow();
    });

    it("rejects TXT with binary content", () => {
      const binaryBuffer = Buffer.alloc(1000);
      binaryBuffer.fill(0); // All null bytes
      expect(() =>
        validateDocumentSecurity({
          filename: "fake.txt",
          buffer: binaryBuffer,
          kind: "txt",
        })
      ).toThrow("txt_invalid");
    });

    it("validates CSV with formula injection check", () => {
      const safeCsv = Buffer.from("name,age\nAlice,30\nBob,25\n", "utf-8");
      expect(() =>
        validateDocumentSecurity({
          filename: "data.csv",
          buffer: safeCsv,
          kind: "csv",
        })
      ).not.toThrow();
    });

    it("rejects CSV with formula injection", () => {
      const maliciousCsv = Buffer.from("name,formula\nAlice,=1+1\n", "utf-8");
      expect(() =>
        validateDocumentSecurity({
          filename: "exploit.csv",
          buffer: maliciousCsv,
          kind: "csv",
        })
      ).toThrow("csv_formula_injection");
    });

    it("rejects any file with path traversal filename", () => {
      const buffer = Buffer.from("content", "utf-8");
      expect(() =>
        validateDocumentSecurity({
          filename: "../etc/passwd",
          buffer,
          kind: "txt",
        })
      ).toThrow("filename_invalid");
    });

    it("rejects oversized files", () => {
      const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
      expect(() =>
        validateDocumentSecurity({
          filename: "huge.pdf",
          buffer: hugeBuffer,
          kind: "pdf",
        })
      ).toThrow("file_too_large");
    });

    it("handles MD files like TXT files", () => {
      const mdBuffer = Buffer.from("# Title\n\nContent here\n", "utf-8");
      expect(() =>
        validateDocumentSecurity({
          filename: "doc.md",
          buffer: mdBuffer,
          kind: "md",
        })
      ).not.toThrow();
    });

    it("rejects MD with binary content", () => {
      const binaryBuffer = Buffer.alloc(500);
      binaryBuffer.fill(0);
      expect(() =>
        validateDocumentSecurity({
          filename: "fake.md",
          buffer: binaryBuffer,
          kind: "md",
        })
      ).toThrow("md_invalid");
    });
  });
});
