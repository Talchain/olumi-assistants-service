/**
 * Document Grounding Security (v1.4.0 - PR G)
 *
 * Security hardening for document processing:
 * - CSV formula injection prevention
 * - Filename validation (path traversal)
 * - Binary content detection
 * - Resource limit enforcement
 */

import { log } from "../utils/telemetry.js";

/**
 * Dangerous CSV prefixes that can trigger formula execution
 * in Excel, Google Sheets, LibreOffice Calc, etc.
 */
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Maximum allowed percentage of null bytes in text files
 * Higher percentages indicate binary/malicious content
 */
const MAX_NULL_BYTE_PERCENT = 0.01; // 1%

/**
 * Maximum file size in bytes (10 MB default)
 * Prevents memory exhaustion attacks
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Validate filename for security issues
 *
 * @throws Error if filename is unsafe
 */
export function validateFilename(filename: string): void {
  // Reject empty names
  if (!filename || filename.trim().length === 0) {
    throw new Error("filename_empty: Filename cannot be empty");
  }

  // Reject path traversal attempts
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    log.warn({ filename, redacted: true }, "Rejected filename with path traversal attempt");
    throw new Error("filename_invalid: Filename contains path separators or traversal sequences");
  }

  // Reject absolute paths (Unix/Windows)
  if (filename.startsWith("/") || /^[A-Za-z]:/.test(filename)) {
    log.warn({ filename, redacted: true }, "Rejected absolute path filename");
    throw new Error("filename_invalid: Absolute paths not allowed");
  }

  // Reject control characters
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    log.warn({ filename, redacted: true }, "Rejected filename with control characters");
    throw new Error("filename_invalid: Filename contains control characters");
  }

  // Length check (reasonable limit)
  if (filename.length > 255) {
    log.warn({ filename_length: filename.length, redacted: true }, "Rejected oversized filename");
    throw new Error("filename_invalid: Filename exceeds 255 characters");
  }
}

/**
 * Check if buffer contains excessive null bytes (binary content)
 *
 * @returns true if file appears to be binary/malicious
 */
export function detectBinaryContent(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  let nullCount = 0;
  const sampleSize = Math.min(buffer.length, 8192); // Check first 8KB

  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) nullCount++;
  }

  const nullPercent = nullCount / sampleSize;
  return nullPercent > MAX_NULL_BYTE_PERCENT;
}

/**
 * Sanitize CSV content to prevent formula injection
 *
 * Detects and blocks cells starting with dangerous prefixes.
 * CSV formula injection can lead to RCE in spreadsheet applications.
 *
 * @throws Error if dangerous formulas detected
 */
export function validateCsvSafety(csvText: string): void {
  const lines = csvText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for formula injection patterns
    for (const prefix of CSV_FORMULA_PREFIXES) {
      if (line.startsWith(prefix)) {
        log.warn({
          line_number: i + 1,
          prefix,
          redacted: true,
        }, "CSV formula injection detected");
        throw new Error(
          `csv_formula_injection: Line ${i + 1} starts with dangerous prefix '${prefix}'`
        );
      }
    }

    // Also check individual cells (basic CSV parsing)
    const cells = line.split(",");
    for (let j = 0; j < cells.length; j++) {
      let cell = cells[j].trim();

      // Remove quotes if present
      if ((cell.startsWith('"') && cell.endsWith('"')) ||
          (cell.startsWith("'") && cell.endsWith("'"))) {
        cell = cell.slice(1, -1);
      }

      for (const prefix of CSV_FORMULA_PREFIXES) {
        if (cell.startsWith(prefix)) {
          log.warn({
            line_number: i + 1,
            cell_index: j,
            prefix,
            redacted: true,
          }, "CSV formula injection detected in cell");
          throw new Error(
            `csv_formula_injection: Cell at line ${i + 1}, column ${j + 1} starts with '${prefix}'`
          );
        }
      }
    }
  }
}

/**
 * Validate file size to prevent resource exhaustion
 *
 * @throws Error if file exceeds size limit
 */
export function validateFileSize(buffer: Buffer, filename: string): void {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    log.warn({
      filename,
      size_bytes: buffer.length,
      limit_bytes: MAX_FILE_SIZE_BYTES,
      redacted: true,
    }, "File exceeds size limit");
    throw new Error(
      `file_too_large: File "${filename}" (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB limit`
    );
  }
}

/**
 * Enhanced PDF security checks
 *
 * Detects suspicious PDF features that may indicate malicious content:
 * - JavaScript execution
 * - Embedded files/streams
 * - Launch actions
 * - Form submission
 *
 * Note: pdf-parse library has limited introspection, so we perform
 * basic pattern matching on the raw buffer.
 */
export function validatePdfSecurity(buffer: Buffer): void {
  const sample = buffer.toString("binary", 0, Math.min(buffer.length, 16384)); // Check first 16KB

  // Check for JavaScript
  if (sample.includes("/JavaScript") || sample.includes("/JS")) {
    log.warn({ feature: "JavaScript", redacted: true }, "PDF contains JavaScript");
    throw new Error("pdf_security_risk: PDF contains JavaScript code");
  }

  // Check for embedded files
  if (sample.includes("/EmbeddedFile") || sample.includes("/Filespec")) {
    log.warn({ feature: "EmbeddedFile", redacted: true }, "PDF contains embedded files");
    throw new Error("pdf_security_risk: PDF contains embedded files");
  }

  // Check for launch actions (can execute external programs)
  if (sample.includes("/Launch")) {
    log.warn({ feature: "Launch", redacted: true }, "PDF contains launch actions");
    throw new Error("pdf_security_risk: PDF contains launch actions");
  }

  // Check for URI/GoToR actions (can navigate to external URLs)
  if (sample.includes("/URI") && sample.includes("/GoToR")) {
    log.warn({ feature: "GoToR", redacted: true }, "PDF contains external navigation");
    throw new Error("pdf_security_risk: PDF contains suspicious external references");
  }
}

/**
 * Comprehensive security validation for all document types
 */
export function validateDocumentSecurity(params: {
  filename: string;
  buffer: Buffer;
  kind: "pdf" | "csv" | "txt" | "md";
}): void {
  const { filename, buffer, kind } = params;

  // 1. Validate filename
  validateFilename(filename);

  // 2. Validate file size
  validateFileSize(buffer, filename);

  // 3. Type-specific validation
  switch (kind) {
    case "pdf":
      validatePdfSecurity(buffer);
      break;

    case "csv": {
      // Check for binary content
      if (detectBinaryContent(buffer)) {
        log.warn({ filename, redacted: true }, "CSV contains binary content");
        throw new Error("csv_invalid: File appears to contain binary data");
      }

      // Check for formula injection
      const csvText = buffer.toString("utf-8");
      validateCsvSafety(csvText);
      break;
    }

    case "txt":
    case "md": {
      // Check for binary content
      if (detectBinaryContent(buffer)) {
        log.warn({ filename, kind, redacted: true }, "Text file contains binary content");
        throw new Error(`${kind}_invalid: File appears to contain binary data`);
      }
      break;
    }
  }

  log.info({
    filename,
    kind,
    size_bytes: buffer.length,
    redacted: true,
  }, "Document passed security validation");
}
