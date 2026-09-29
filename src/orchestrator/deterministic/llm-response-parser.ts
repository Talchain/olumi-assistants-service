/**
 * LLM JSON Response Parser
 *
 * Multi-strategy extraction and validation of LLM JSON output.
 * Fallback chain: native JSON → markdown fence → regex → text-only.
 */

import { LLMResponseSchema, InsightSchema, RecommendedActionSchema } from "./llm-response-schema.js";
import type { LLMJsonResponse } from "./types.js";
import { log } from "../../utils/telemetry.js";
import { contentDigest } from "../../utils/redaction.js";

// ============================================================================
// Public API
// ============================================================================

export interface ParseResult {
  response: LLMJsonResponse;
  /** How the JSON was extracted. */
  extraction_method: 'native' | 'fence' | 'regex' | 'fallback';
  /** Warnings from parsing. */
  warnings: string[];
}

/**
 * Parse the LLM output into a validated LLMJsonResponse.
 * Uses a multi-strategy fallback chain.
 */
export function parseLLMJsonResponse(rawContent: string): ParseResult {
  const warnings: string[] = [];

  // Strategy 1: Direct JSON parse
  const directResult = tryDirectParse(rawContent);
  if (directResult) {
    return { response: directResult, extraction_method: 'native', warnings };
  }

  // Strategy 2: Extract from markdown code fence
  const fenceResult = tryFenceParse(rawContent);
  if (fenceResult) {
    return { response: fenceResult, extraction_method: 'fence', warnings };
  }

  // Strategy 3: Regex extraction of JSON object
  const regexResult = tryRegexParse(rawContent);
  if (regexResult) {
    warnings.push('JSON extracted via regex — may be incomplete');
    return { response: regexResult, extraction_method: 'regex', warnings };
  }

  // Strategy 4: Fallback — treat entire content as text
  warnings.push('No valid JSON found in LLM output — treating as plain text');
  log.warn(
    // Digest raw LLM output — never place it on the wire verbatim (see contentDigest).
    { content_length: rawContent.length, content_preview: contentDigest(rawContent) },
    'deterministic.llm_response_parse_fallback',
  );

  return {
    response: {
      text: stripXmlTags(rawContent),
      insights: [],
      recommended_actions: [],
    },
    extraction_method: 'fallback',
    warnings,
  };
}

// ============================================================================
// Parse Strategies
// ============================================================================

function tryDirectParse(content: string): LLMJsonResponse | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  return strictOrLenient(parsed);
}

function tryFenceParse(content: string): LLMJsonResponse | null {
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (!fenceMatch) return null;

  try {
    const parsed = JSON.parse(fenceMatch[1].trim());
    return strictOrLenient(parsed);
  } catch {
    // Invalid JSON in fence
  }
  return null;
}

function tryRegexParse(content: string): LLMJsonResponse | null {
  // Find each '{' and try to parse from it to each subsequent '}'
  // This handles nested objects and braces inside string values correctly
  // because JSON.parse is the authority on validity, not brace counting.
  const firstBrace = content.indexOf('{');
  if (firstBrace === -1) return null;

  for (let start = firstBrace; start < content.length; start++) {
    if (content[start] !== '{') continue;

    // Try each '}' from the end backwards — largest valid block first
    for (let end = content.lastIndexOf('}'); end > start; end = content.lastIndexOf('}', end - 1)) {
      const candidate = content.slice(start, end + 1);
      if (!candidate.includes('"text"')) break; // no point trying shorter spans

      try {
        const parsed = JSON.parse(candidate);
        const result = strictOrLenient(parsed);
        if (result) return result;
      } catch {
        // Try shorter span
      }
    }
  }
  return null;
}

/**
 * Attempt strict Zod validation first; if that fails due to hallucinated array
 * entries (unknown action_type or unknown insight type / >3 insights), apply
 * lenient filtering and retry. Returns null only when text itself is absent or
 * the JSON structure is fundamentally non-conformant.
 *
 * Applied by all three parse strategies so that a single unknown action_type
 * never cascades to the full plaintext fallback regardless of how the JSON
 * arrived (direct, fenced, or regex-extracted).
 */
function strictOrLenient(parsed: unknown): LLMJsonResponse | null {
  // Strict parse — all fields valid
  const strict = LLMResponseSchema.safeParse(parsed);
  if (strict.success) return strict.data;

  // Lenient parse — requires a non-empty text field to be worth salvaging
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.text !== 'string' || obj.text.length === 0) return null;

  // Filter invalid recommended_actions (hallucinated action_type)
  const cleanActions = Array.isArray(obj.recommended_actions)
    ? obj.recommended_actions.filter((a) => RecommendedActionSchema.safeParse(a).success)
    : [];

  // Cap and filter invalid insights (unknown type, missing fields, or array >3)
  const cleanInsights = Array.isArray(obj.insights)
    ? obj.insights.filter((ins) => InsightSchema.safeParse(ins).success).slice(0, 3)
    : [];

  const lenient = LLMResponseSchema.safeParse({ ...obj, recommended_actions: cleanActions, insights: cleanInsights });
  if (lenient.success) return lenient.data;

  // Last resort: valid text and nothing else
  const minimal = LLMResponseSchema.safeParse({ ...obj, recommended_actions: [], insights: [] });
  if (minimal.success) return minimal.data;

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Strip any XML tags from text (belt-and-braces for fallback). */
function stripXmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
}
