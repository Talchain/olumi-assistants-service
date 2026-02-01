/**
 * JSON Extractor Utility
 *
 * Extracts valid JSON from LLM responses that may contain conversational
 * preamble, suffix text, or markdown code blocks.
 *
 * This is particularly useful for Claude models which may add conversational
 * text like "I'll construct a graph for you..." before the JSON output,
 * even when instructed to output only JSON.
 */

import { log, emit, TelemetryEvents } from "./telemetry.js";

/**
 * Result of JSON extraction
 */
export interface JsonExtractionResult {
  /** The extracted and parsed JSON */
  json: unknown;
  /** Whether extraction was needed (true if raw content wasn't valid JSON) */
  wasExtracted: boolean;
  /** The raw content that was successfully parsed */
  extractedContent?: string;
  /** Characters of preamble text that was stripped */
  preambleLength?: number;
  /** Characters of suffix text that was stripped */
  suffixLength?: number;
  /** The extraction method used */
  extractionMethod?: "fast_path" | "code_block" | "boundary" | "bracket_matching";
  /** The full raw content before extraction (for debugging) */
  rawContent?: string;
}

/**
 * Options for JSON extraction
 */
export interface JsonExtractionOptions {
  /** Task name for telemetry (e.g., "draft_graph") */
  task?: string;
  /** Model name for telemetry */
  model?: string;
  /** Correlation ID for logging */
  correlationId?: string;
  /** Whether to log warnings when extraction is needed */
  logWarnings?: boolean;
  /** Whether to include raw content in result (for debugging) */
  includeRawContent?: boolean;
}

/**
 * Extract JSON from LLM response that may contain conversational preamble/suffix.
 *
 * Strategy (in order):
 * 1. Try parsing raw content as-is (fast path for well-behaved models)
 * 2. Try extracting from markdown code blocks (```json ... ```) - scans ALL blocks
 * 3. Try bracket-matching from each candidate `{` or `[` position until valid JSON found
 *
 * @param content - Raw LLM response content
 * @param options - Extraction options for telemetry
 * @returns Extraction result with parsed JSON and metadata
 * @throws Error if no valid JSON can be extracted
 */
export function extractJsonFromResponse(
  content: string,
  options: JsonExtractionOptions = {}
): JsonExtractionResult {
  const { task, model, correlationId, logWarnings = true, includeRawContent = false } = options;
  const trimmed = content.trim();

  // === Fast path: Already valid JSON ===
  // Most responses from OpenAI with json_object mode will be valid JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      return {
        json,
        wasExtracted: false,
        extractionMethod: "fast_path",
        rawContent: includeRawContent ? content : undefined,
      };
    } catch {
      // May have trailing text after valid JSON - try bracket matching from start first
      // This is an early-exit optimization that avoids code block scanning when
      // the JSON is at the start but has trailing content (common with some models)
      const earlyExitResult = extractJsonWithBracketMatching(trimmed, 0);
      if (earlyExitResult) {
        const suffixLength = trimmed.length - earlyExitResult.content.length;
        if (suffixLength > 0) {
          if (logWarnings) {
            log.warn(
              { task, model, correlationId, extraction_method: "boundary", suffix_length: suffixLength },
              "JSON extracted via early-exit bracket matching (trailing content stripped)"
            );
          }
          emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
            task, model, preamble_length: 0, suffix_length: suffixLength, extraction_method: "boundary",
          });
        }
        return {
          json: earlyExitResult.json,
          wasExtracted: suffixLength > 0,
          extractedContent: earlyExitResult.content,
          preambleLength: 0,
          suffixLength,
          extractionMethod: "boundary",
          rawContent: includeRawContent ? content : undefined,
        };
      }
      // Early exit failed, continue to full extraction
    }
  }

  // === Try ALL markdown code blocks ===
  // Claude often wraps JSON in ```json ... ``` blocks
  // Scan all blocks and return the first one with valid JSON
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let codeBlockMatch;
  while ((codeBlockMatch = codeBlockRegex.exec(trimmed)) !== null) {
    const blockContent = codeBlockMatch[1].trim();
    try {
      const json = JSON.parse(blockContent);
      const preambleLength = codeBlockMatch.index;
      const blockEnd = codeBlockMatch.index + codeBlockMatch[0].length;
      const suffixLength = trimmed.length - blockEnd;

      // Log and emit telemetry (telemetry always emits, logging respects logWarnings)
      if (logWarnings) {
        log.warn(
          {
            task,
            model,
            correlationId,
            extraction_method: "code_block",
            preamble_length: preambleLength,
            suffix_length: suffixLength,
          },
          "JSON extracted from markdown code block"
        );
      }

      // Always emit telemetry regardless of logWarnings setting
      emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
        task,
        model,
        preamble_length: preambleLength,
        suffix_length: suffixLength,
        extraction_method: "code_block",
      });

      return {
        json,
        wasExtracted: true,
        extractedContent: blockContent,
        preambleLength,
        suffixLength,
        extractionMethod: "code_block",
        rawContent: includeRawContent ? content : undefined,
      };
    } catch {
      // This code block wasn't valid JSON, try the next one
      continue;
    }
  }

  // === Bracket-matching extraction: Try each candidate JSON start ===
  // Find ALL positions of { and [ and try bracket-matching from each
  // This handles cases where preamble contains braces (e.g., "Use `{foo}` for...")
  const candidates: Array<{ index: number; char: "{" | "[" }> = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{" || trimmed[i] === "[") {
      candidates.push({ index: i, char: trimmed[i] as "{" | "[" });
    }
  }

  if (candidates.length === 0) {
    throw new Error("No JSON structure found in response: missing opening delimiter");
  }

  // Try each candidate position, returning the first valid JSON found
  for (const candidate of candidates) {
    const bracketResult = extractJsonWithBracketMatching(trimmed, candidate.index);
    if (bracketResult) {
      const preambleLength = candidate.index;
      const jsonEndIndex = candidate.index + bracketResult.content.length;
      const suffixLength = trimmed.length - jsonEndIndex;

      // Determine if this is "boundary" (first candidate worked) or "bracket_matching"
      const extractionMethod = candidate.index === candidates[0].index ? "boundary" : "bracket_matching";

      // Log warning if there was preamble/suffix text (respects logWarnings)
      if ((preambleLength > 0 || suffixLength > 0) && logWarnings) {
        const preamblePreview = preambleLength > 0
          ? trimmed.substring(0, Math.min(50, preambleLength))
          : undefined;

        log.warn(
          {
            task,
            model,
            correlationId,
            extraction_method: extractionMethod,
            preamble_length: preambleLength,
            suffix_length: suffixLength,
            preamble_preview: preamblePreview,
            candidates_tried: candidates.indexOf(candidate) + 1,
            total_candidates: candidates.length,
          },
          "JSON extraction required - model returned conversational preamble/suffix"
        );
      }

      // Always emit telemetry when extraction is performed (decoupled from logging)
      emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
        task,
        model,
        preamble_length: preambleLength,
        suffix_length: suffixLength,
        extraction_method: extractionMethod,
        candidates_tried: candidates.indexOf(candidate) + 1,
      });

      return {
        json: bracketResult.json,
        wasExtracted: true,
        extractedContent: bracketResult.content,
        preambleLength,
        suffixLength,
        extractionMethod,
        rawContent: includeRawContent ? content : undefined,
      };
    }
  }

  // All extraction methods failed
  throw new Error(
    `Failed to extract valid JSON from response: tried ${candidates.length} candidate position(s)`
  );
}

/**
 * Extract JSON using bracket matching (handles nested structures and trailing text).
 *
 * Scans from a starting position, counting brackets to find the complete
 * JSON structure, properly handling strings and escape sequences.
 */
function extractJsonWithBracketMatching(
  content: string,
  startIndex: number
): { json: unknown; content: string } | null {
  const openBracket = content[startIndex];
  if (openBracket !== "{" && openBracket !== "[") {
    return null;
  }
  const _closeBracket = openBracket === "{" ? "}" : "]"; // Used for type safety, depth tracking handles matching

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{" || char === "[") depth++;
    if (char === "}" || char === "]") depth--;

    if (depth === 0) {
      // Found the complete JSON structure
      const jsonStr = content.slice(startIndex, i + 1);
      try {
        const json = JSON.parse(jsonStr);
        return { json, content: jsonStr };
      } catch {
        // Bracket matching found a structure but it wasn't valid JSON
        return null;
      }
    }
  }

  // Unbalanced brackets
  return null;
}

/**
 * Convenience function that returns just the parsed JSON.
 *
 * Use this when you don't need the extraction metadata.
 *
 * @param content - Raw LLM response content
 * @param options - Extraction options
 * @returns Parsed JSON
 * @throws Error if no valid JSON can be extracted
 */
export function extractJson(content: string, options?: JsonExtractionOptions): unknown {
  return extractJsonFromResponse(content, options).json;
}
