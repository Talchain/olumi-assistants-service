/**
 * LLM JSON Response Parser
 *
 * Multi-strategy extraction and validation of LLM JSON output.
 * Fallback chain: native JSON → markdown fence → regex → text-only.
 */

import { LLMResponseSchema, RecommendedActionSchema } from "./llm-response-schema.js";
import type { LLMJsonResponse } from "./types.js";
import { log } from "../../utils/telemetry.js";

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
    { content_length: rawContent.length, content_preview: rawContent.slice(0, 200) },
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
    // Not valid JSON
    return null;
  }

  // Strict parse — all fields valid
  const strict = LLMResponseSchema.safeParse(parsed);
  if (strict.success) return strict.data;

  // Lenient parse — JSON is valid but some recommended_actions entries have
  // unknown action_type values (e.g. LLM hallucinated a type not in the schema).
  // Strip invalid actions and retry rather than falling through to full fallback,
  // which would corrupt response.text with raw JSON.
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const rawText = typeof obj.text === 'string' ? obj.text : null;
    if (rawText && rawText.length > 0) {
      // Filter out any recommended_actions entries that fail the element schema
      const filtered = {
        ...obj,
        recommended_actions: Array.isArray(obj.recommended_actions)
          ? obj.recommended_actions.filter((a) => RecommendedActionSchema.safeParse(a).success)
          : [],
      };
      const lenient = LLMResponseSchema.safeParse(filtered);
      if (lenient.success) return lenient.data;

      // Last resort: preserve text + insights, drop all actions
      const minimal = LLMResponseSchema.safeParse({ ...obj, recommended_actions: [] });
      if (minimal.success) return minimal.data;
    }
  }

  return null;
}

function tryFenceParse(content: string): LLMJsonResponse | null {
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (!fenceMatch) return null;

  try {
    const parsed = JSON.parse(fenceMatch[1].trim());
    const result = LLMResponseSchema.safeParse(parsed);
    if (result.success) return result.data;
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
        const result = LLMResponseSchema.safeParse(parsed);
        if (result.success) return result.data;
      } catch {
        // Try shorter span
      }
    }
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Strip any XML tags from text (belt-and-braces for fallback). */
function stripXmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
}
