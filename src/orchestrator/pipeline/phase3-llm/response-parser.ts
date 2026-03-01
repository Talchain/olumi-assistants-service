/**
 * Response Parser (V2)
 *
 * Delegates to the existing response parser and wraps the result
 * into the V2 LLMResult type with science_annotations.
 */

import { parseLLMResponse } from "../../response-parser.js";
import type { ChatWithToolsResult } from "../../../adapters/llm/types.js";
import type { LLMResult, ScienceAnnotation, SuggestedAction } from "../types.js";

/**
 * Parse a ChatWithToolsResult into V2 LLMResult.
 *
 * Delegates to existing parseLLMResponse() for Layer 1 + Layer 2 parsing,
 * then wraps into V2 shape with empty science_annotations.
 */
export function parseV2Response(result: ChatWithToolsResult): LLMResult {
  const parsed = parseLLMResponse(result);

  // Map suggested_actions from parser format to V2 format
  const suggestedActions: SuggestedAction[] = parsed.suggested_actions;

  return {
    assistant_text: parsed.assistant_text,
    tool_invocations: parsed.tool_invocations,
    science_annotations: [] as ScienceAnnotation[], // A.10: Populated when science annotations are active
    raw_response: result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n\n'),
    suggested_actions: suggestedActions,
    diagnostics: parsed.diagnostics,
    parse_warnings: parsed.parse_warnings,
  };
}

/**
 * Build a deterministic LLMResult for cases where the intent gate
 * matched a tool directly (no LLM call needed).
 */
export function buildDeterministicLLMResult(
  toolName: string,
  toolInput: Record<string, unknown>,
): LLMResult {
  return {
    assistant_text: null,
    tool_invocations: [{ id: 'deterministic', name: toolName, input: toolInput }],
    science_annotations: [] as ScienceAnnotation[],
    raw_response: '',
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
  };
}
