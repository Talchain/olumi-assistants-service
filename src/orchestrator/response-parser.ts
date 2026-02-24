/**
 * Response Parser for Orchestrator
 *
 * Parses ChatWithToolsResult to extract:
 * - assistant_text: concatenated text content blocks
 * - tool_invocations: tool_use content blocks (Anthropic native format)
 *
 * Follows the same content block parsing pattern used by draftGraph()
 * in src/adapters/llm/anthropic.ts.
 */

import type { ToolResponseBlock, ChatWithToolsResult } from "../adapters/llm/types.js";

// ============================================================================
// Parsed Response Types
// ============================================================================

export interface ToolInvocation {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ParsedLLMResponse {
  /** Concatenated text from all text blocks, or null if no text blocks */
  assistant_text: string | null;
  /** Tool invocations extracted from tool_use blocks */
  tool_invocations: ToolInvocation[];
  /** Raw stop reason from the LLM */
  stop_reason: ChatWithToolsResult['stop_reason'];
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a ChatWithToolsResult into structured components.
 *
 * Text blocks are concatenated with double newlines.
 * Tool use blocks are extracted as ToolInvocation objects.
 */
export function parseLLMResponse(result: ChatWithToolsResult): ParsedLLMResponse {
  const textParts: string[] = [];
  const toolInvocations: ToolInvocation[] = [];

  for (const block of result.content) {
    if (block.type === 'text') {
      const trimmed = block.text.trim();
      if (trimmed) {
        textParts.push(trimmed);
      }
    } else if (block.type === 'tool_use') {
      toolInvocations.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return {
    assistant_text: textParts.length > 0 ? textParts.join('\n\n') : null,
    tool_invocations: toolInvocations,
    stop_reason: result.stop_reason,
  };
}

/**
 * Check if the response contains any tool invocations.
 */
export function hasToolInvocations(parsed: ParsedLLMResponse): boolean {
  return parsed.tool_invocations.length > 0;
}

/**
 * Get the first tool invocation (most common case — single tool per turn).
 * Returns null if no tool invocations.
 */
export function getFirstToolInvocation(parsed: ParsedLLMResponse): ToolInvocation | null {
  return parsed.tool_invocations[0] ?? null;
}
