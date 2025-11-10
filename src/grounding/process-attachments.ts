/**
 * Attachment Processing for Grounding
 *
 * Processes attachments (PDF/TXT/MD/CSV) and extracts text/summaries
 * for use in LLM prompts. Handles character limits and error cases.
 */

import { Buffer } from "node:buffer";
import { log } from "../utils/telemetry.js";
import { type DocPreview } from "../services/docProcessing.js";
import {
  extractTextFromPdf,
  extractTextFromTxtMd,
  summarizeCsv,
  type CsvSummary as _CsvSummary,
} from "./index.js";

export type AttachmentInput = {
  id: string;
  kind: "pdf" | "csv" | "txt" | "md";
  name: string;
  /** Raw content as Buffer or base64 string */
  content?: Buffer | string;
};

export type GroundingStats = {
  files_processed: number;
  pdf: number;
  txt_md: number;
  csv: number;
  total_chars: number;
};

// Maximum total characters across all attachments (50k = ~10 files at 5k each)
const MAX_TOTAL_CHARS = 50000;

/**
 * Process attachments and extract text/summaries.
 *
 * @throws Error with BAD_INPUT code if any file exceeds limits
 */
export async function processAttachments(
  attachments: AttachmentInput[]
): Promise<{ docs: DocPreview[]; stats: GroundingStats }> {
  const docs: DocPreview[] = [];
  const stats: GroundingStats = {
    files_processed: 0,
    pdf: 0,
    txt_md: 0,
    csv: 0,
    total_chars: 0,
  };

  for (const attachment of attachments) {
    try {
      // Get buffer from content
      let buffer: Buffer;
      if (!attachment.content) {
        log.warn({
          attachment_id: attachment.id,
          name: attachment.name,
          redacted: true,
        }, "Attachment missing content, skipping");
        continue;
      }

      if (Buffer.isBuffer(attachment.content)) {
        buffer = attachment.content;
      } else {
        // Validate and decode base64 string
        try {
          // Strip whitespace once for consistent validation and decoding
          const cleanedBase64 = attachment.content.replace(/\s/g, '');
          buffer = Buffer.from(cleanedBase64, 'base64');
          // Verify base64 validity by checking if re-encoding matches
          const reEncoded = buffer.toString('base64');
          if (reEncoded !== cleanedBase64) {
            throw new Error('Invalid base64 encoding');
          }
        } catch (decodeError) {
          log.error({
            attachment_id: attachment.id,
            name: attachment.name,
            error: decodeError instanceof Error ? decodeError.message : String(decodeError),
            redacted: true,
          }, "Failed to decode attachment payload");
          throw new Error(`File "${attachment.name}": Attachment payload must be valid base64-encoded content`);
        }
      }

      let preview: string;

      switch (attachment.kind) {
        case 'pdf': {
          try {
            preview = await extractTextFromPdf(buffer);
            stats.pdf++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            // Enhance error message with context
            if (err.message.includes('pdf_exceeds_limit')) {
              throw new Error(`File "${attachment.name}": ${err.message}`);
            }
            if (err.message.includes('encrypted_pdf')) {
              throw new Error(`File "${attachment.name}": PDF is encrypted and cannot be processed`);
            }

            throw new Error(`File "${attachment.name}": PDF parsing failed - ${err.message}`);
          }
          break;
        }

        case 'txt':
        case 'md': {
          try {
            const text = buffer.toString('utf-8');
            preview = extractTextFromTxtMd(text);
            stats.txt_md++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            if (err.message.includes('txt_exceeds_limit')) {
              throw new Error(`File "${attachment.name}": ${err.message}`);
            }

            throw new Error(`File "${attachment.name}": Text extraction failed - ${err.message}`);
          }
          break;
        }

        case 'csv': {
          try {
            const summary = summarizeCsv(buffer);
            // Use markedText for LLM context
            preview = summary.markedText || `Row count: ${summary.count}`;
            stats.csv++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            if (err.message.includes('csv_exceeds_limit')) {
              throw new Error(`File "${attachment.name}": ${err.message}`);
            }
            if (err.message.includes('csv_parse_failed')) {
              throw new Error(`File "${attachment.name}": CSV parsing failed - check file format`);
            }

            throw new Error(`File "${attachment.name}": CSV processing failed - ${err.message}`);
          }
          break;
        }

        default:
          log.warn({
            kind: attachment.kind,
            name: attachment.name,
            redacted: true,
          }, "Unsupported attachment kind");
          continue;
      }

      // Determine location hint based on file type
      let locationHint: string;
      switch (attachment.kind) {
        case 'pdf':
          locationHint = "cite with page numbers (e.g., page 2)";
          break;
        case 'csv':
          locationHint = "cite with row numbers for statistics (e.g., row 2)";
          break;
        case 'txt':
        case 'md':
          locationHint = "cite with line numbers if needed (e.g., line 5)";
          break;
      }

      docs.push({
        source: attachment.name,
        type: attachment.kind,
        preview,
        locationHint,
      });

      stats.files_processed++;
      stats.total_chars += preview.length;

      // Check aggregate size limit
      if (stats.total_chars > MAX_TOTAL_CHARS) {
        log.warn({
          total_chars: stats.total_chars,
          limit: MAX_TOTAL_CHARS,
          files_processed: stats.files_processed,
          redacted: true,
        }, "Aggregate attachment size exceeds limit");
        throw new Error(`aggregate_exceeds_limit: Total attachment size (${stats.total_chars} chars) exceeds ${MAX_TOTAL_CHARS} character limit`);
      }

      log.info({
        name: attachment.name,
        type: attachment.kind,
        chars: preview.length,
        redacted: true,
      }, "Processed attachment");

    } catch (error) {
      // Re-throw with enhanced error message
      const err = error instanceof Error ? error : new Error(String(error));
      log.error({
        attachment_id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        error: err.message,
        redacted: true,
      }, "Attachment processing failed");

      throw err;
    }
  }

  log.info({
    ...stats,
    redacted: true,
  }, "Attachment processing complete");

  return { docs, stats };
}
