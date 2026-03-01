/**
 * Robust JSON extraction from LLM responses.
 *
 * LLMs sometimes wrap valid JSON in markdown fences or prose.
 * This pipeline extracts it without penalising models that do so.
 */

export type ExtractionMethod = "direct" | "stripped_fence" | "bracketed";

export interface ExtractionResult {
  /** Parsed JSON object, or null if all methods failed */
  parsed: unknown | null;
  /** Which method succeeded, or null if all failed */
  method: ExtractionMethod | null;
  /** Always set — the original raw text */
  raw_text: string;
  /** true if we attempted extraction beyond direct parse */
  extraction_attempted: boolean;
}

/**
 * Extract JSON from a raw LLM response string.
 *
 * Pipeline:
 * 1. Try JSON.parse(raw) directly
 * 2. Strip markdown fences (```json...```) and retry
 * 3. Find first { and last }, extract substring, retry
 * 4. Return null if all fail
 */
export function extractJSON(raw: string): ExtractionResult {
  const trimmed = raw.trim();

  // Step 1: direct parse
  try {
    const parsed = JSON.parse(trimmed);
    return {
      parsed,
      method: "direct",
      raw_text: raw,
      extraction_attempted: false,
    };
  } catch {
    // fall through
  }

  // Step 2: strip markdown fences
  const stripped = stripMarkdownFences(trimmed);
  if (stripped !== trimmed) {
    try {
      const parsed = JSON.parse(stripped);
      return {
        parsed,
        method: "stripped_fence",
        raw_text: raw,
        extraction_attempted: true,
      };
    } catch {
      // fall through
    }
  }

  // Step 3: extract brace-delimited substring
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      return {
        parsed,
        method: "bracketed",
        raw_text: raw,
        extraction_attempted: true,
      };
    } catch {
      // fall through
    }
  }

  // All methods failed
  return {
    parsed: null,
    method: null,
    raw_text: raw,
    extraction_attempted: true,
  };
}

/**
 * Remove markdown code fences from a string.
 * Handles both ```json...``` and ``` ``` variants.
 */
function stripMarkdownFences(text: string): string {
  // Match ```json (optional) ... ``` with optional whitespace
  const fenced = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i, "$1");
  if (fenced !== text) return fenced.trim();

  // Also handle fences without newlines
  const inline = text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  if (inline !== text) return inline.trim();

  return text;
}
