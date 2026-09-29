/**
 * Document Grounding Module (v04)
 *
 * Text-only extraction for PDF/TXT/MD/CSV with strict character limits,
 * citation validation, and privacy guarantees (no content logging).
 */

import pdfParse from "pdf-parse";
import Papa from "papaparse";
import { log } from "../utils/telemetry.js";

const DEFAULT_CHAR_LIMIT = 5000;

/**
 * Citation structure for document references
 */
export type Citation = {
  source: string;      // Filename or metric name
  quote: string;       // Citation text (≤100 chars)
  location: string;    // Page/row/line reference
};

/**
 * CSV summary statistics (safe; no row data)
 */
export type CsvSummary = {
  count: number;
  mean?: number;
  p50?: number;
  p90?: number;
  /** Formatted text representation with [ROW N] markers for citations */
  markedText?: string;
};

/**
 * Extract plain text from PDF buffer.
 *
 * @throws Error if PDF is encrypted, malformed, or exceeds char limit
 */
export async function extractTextFromPdf(buffer: Buffer, maxChars: number = DEFAULT_CHAR_LIMIT): Promise<string> {
  try {
    const data = await pdfParse(buffer);

    // Check for encryption
    if (data.info?.IsAcroFormPresent || data.info?.Encrypted === 'yes') {
      log.warn({ encrypted: true }, "Rejected encrypted PDF");
      throw new Error("encrypted_pdf_not_supported");
    }

    let text = data.text || "";

    // Normalize whitespace and line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Add page markers for location tracking
    // Note: pdf-parse doesn't provide per-page text, so we approximate with form feeds
    const pages = text.split('\f');
    const markedText = pages
      .map((page, i) => `[PAGE ${i + 1}]\n${page.trim()}`)
      .join('\n\n');

    // Enforce character limit
    if (markedText.length > maxChars) {
      log.warn({
        actual_chars: markedText.length,
        limit: maxChars,
        redacted: true
      }, "PDF exceeds character limit");
      throw new Error(`pdf_exceeds_limit: ${markedText.length} chars > ${maxChars} limit`);
    }

    log.info({
      pages: data.numpages,
      chars: markedText.length,
      redacted: true
    }, "Extracted text from PDF");

    return markedText;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith("pdf_exceeds_limit") ||
          error.message === "encrypted_pdf_not_supported") {
        throw error;
      }
    }

    log.error({ error, redacted: true }, "PDF parsing failed");
    throw new Error("pdf_parse_failed");
  }
}

/**
 * Extract and normalize text from TXT/MD input.
 *
 * @throws Error if text exceeds char limit
 */
export function extractTextFromTxtMd(input: string, maxChars: number = DEFAULT_CHAR_LIMIT): string {
  // Normalize line endings
  let text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Trim trailing spaces from each line
  text = text.split('\n').map(line => line.trimEnd()).join('\n');

  // Add line number markers for location tracking
  const lines = text.split('\n');
  const markedText = lines
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  // Enforce character limit
  if (markedText.length > maxChars) {
    log.warn({
      actual_chars: markedText.length,
      limit: maxChars,
      redacted: true
    }, "TXT/MD exceeds character limit");
    throw new Error(`txt_exceeds_limit: ${markedText.length} chars > ${maxChars} limit`);
  }

  log.info({
    lines: lines.length,
    chars: markedText.length,
    redacted: true
  }, "Extracted text from TXT/MD");

  return markedText;
}

/**
 * Compute safe summary statistics from CSV buffer.
 * Returns counts and percentiles for numeric columns only.
 * Never echoes row data or headers.
 *
 * @throws Error if CSV is malformed or too large
 */
export function summarizeCsv(buffer: Buffer, maxChars: number = DEFAULT_CHAR_LIMIT): CsvSummary {
  const text = buffer.toString('utf-8');

  // Enforce character limit on raw CSV
  if (text.length > maxChars) {
    log.warn({
      actual_chars: text.length,
      limit: maxChars,
      redacted: true
    }, "CSV exceeds character limit");
    throw new Error(`csv_exceeds_limit: ${text.length} chars > ${maxChars} limit`);
  }

  try {
    const parsed = Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      // Be lenient with errors
      delimitersToGuess: [',', '\t', '|', ';'],
    });

    // Log parsing issues but don't fail unless no data was parsed
    if (parsed.errors.length > 0) {
      log.info({
        error_count: parsed.errors.length,
        redacted: true
      }, "CSV parsing warnings");
    }

    const rows = parsed.data as Record<string, any>[];
    const count = rows.length;

    // Allow empty data (e.g., header-only CSV)
    if (count === 0 && text.trim().length === 0) {
      // Completely empty input
      return { count: 0 };
    }

    // Extract numeric columns
    const numericValues: number[] = [];

    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
          numericValues.push(value);
        }
      }
    }

    // If no numeric data, return count only
    if (numericValues.length === 0) {
      log.info({
        row_count: count,
        numeric_values: 0,
        redacted: true
      }, "Summarized CSV (no numeric columns)");

      return {
        count,
        markedText: `[ROW 1] Row count: ${count}\n[ROW 2] Note: No numeric columns found`,
      };
    }

    // Compute safe statistics
    numericValues.sort((a, b) => a - b);

    const mean = numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length;
    // Percentile calculation: use nearest-rank method
    // Index = ceil(p * n) - 1 (convert to 0-based)
    const p50Index = Math.max(0, Math.ceil(0.5 * numericValues.length) - 1);
    const p90Index = Math.max(0, Math.ceil(0.9 * numericValues.length) - 1);

    // Create marked text representation for citations
    const markedText = [
      `[ROW 1] Row count: ${count}`,
      `[ROW 2] Mean: ${Number(mean.toFixed(2))}`,
      `[ROW 3] Median (p50): ${numericValues[p50Index]}`,
      `[ROW 4] 90th percentile (p90): ${numericValues[p90Index]}`,
    ].join('\n');

    const summary = {
      count,
      mean: Number(mean.toFixed(2)),
      p50: numericValues[p50Index],
      p90: numericValues[p90Index],
      markedText,
    };

    log.info({
      row_count: count,
      numeric_values: numericValues.length,
      redacted: true
    }, "Summarized CSV");

    return summary;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("csv_")) {
      throw error;
    }

    log.error({ error, redacted: true }, "CSV processing failed");
    throw new Error("csv_parse_failed");
  }
}

/**
 * Enforce character limit on extracted text.
 *
 * @throws Error with details if limit exceeded
 */
export function enforceCharLimit(text: string, max: number = DEFAULT_CHAR_LIMIT): string {
  if (text.length > max) {
    throw new Error(`char_limit_exceeded: ${text.length} chars > ${max} limit`);
  }
  return text;
}

/**
 * Create a citation with validation.
 *
 * @param source Document filename or metric name
 * @param quote Citation text (will be truncated to 100 chars)
 * @param location Page/row/line reference
 */
export function makeCitation(params: {
  source: string;
  quote: string;
  location: string;
}): Citation {
  // Enforce quote length limit
  let quote = params.quote;
  if (quote.length > 100) {
    log.warn({
      original_length: quote.length,
      redacted: true
    }, "Citation quote truncated to 100 chars");
    quote = quote.substring(0, 97) + "...";
  }

  return {
    source: params.source,
    quote,
    location: params.location,
  };
}

/**
 * Verify if a quote appears in the extracted text.
 * Used to determine if provenance_source should be "document" or "hypothesis".
 */
export function verifyQuote(quote: string, extractedText: string): boolean {
  // Normalize both for comparison
  const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedText = extractedText.toLowerCase().replace(/\s+/g, ' ');

  return normalizedText.includes(normalizedQuote);
}

/**
 * Extract location hint from marked text (page/row/line).
 * Searches for the quote in the text and returns the nearest location marker.
 */
export function extractLocation(quote: string, markedText: string): string | undefined {
  const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedText = markedText.toLowerCase().replace(/\s+/g, ' ');

  const index = normalizedText.indexOf(normalizedQuote);
  if (index === -1) return undefined;

  // Look backwards from quote position to find nearest location marker
  const beforeQuote = markedText.substring(0, index);

  // Check for page markers: [PAGE N]
  const pageMatch = beforeQuote.match(/\[PAGE (\d+)\][^[]*$/);
  if (pageMatch) {
    return `page ${pageMatch[1]}`;
  }

  // Check for row markers: [ROW N]
  const rowMatch = beforeQuote.match(/\[ROW (\d+)\][^[]*$/);
  if (rowMatch) {
    return `row ${rowMatch[1]}`;
  }

  // Check for line markers: N:
  const lineMatch = beforeQuote.match(/(\d+):[^:]*$/);
  if (lineMatch) {
    return `line ${lineMatch[1]}`;
  }

  return undefined;
}
