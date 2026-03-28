/**
 * LLM JSON Response Parser
 *
 * Multi-strategy extraction and validation of LLM JSON output.
 * Fallback chain: native JSON → markdown fence → regex → text-only.
 */

import { LLMResponseSchema } from "./llm-response-schema.js";
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

  try {
    const parsed = JSON.parse(trimmed);
    const result = LLMResponseSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // Not valid JSON
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
  // Find the outermost { ... } containing "text"
  const jsonMatch = content.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = LLMResponseSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // Invalid JSON
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
