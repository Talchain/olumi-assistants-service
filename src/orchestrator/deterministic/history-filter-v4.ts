/**
 * History Filter v4
 *
 * Enforces the v4 history contract on the messages array before
 * it reaches the LLM:
 *
 * 1. For tool_call turns (ToolResponseBlock[]), extract text and drop tool_use blocks
 * 2. Drop messages matching error/sentinel patterns
 * 3. Drop empty/whitespace-only messages
 * 4. Cap at MAX_HISTORY_MESSAGES (10 = 5 user/assistant pairs), keeping most recent
 */

import type { ToolResponseBlock } from "../../adapters/llm/types.js";

type AssembledMessage = { role: 'user' | 'assistant'; content: string | ToolResponseBlock[] };

// ============================================================================
// Constants
// ============================================================================

/** Maximum messages sent to the LLM (5 user/assistant pairs). */
const MAX_HISTORY_MESSAGES = 10;

/** Normaliser default text — should not appear in history. */
const NORMALISER_DEFAULT = "I'm here to help with your decision. What would you like to explore?";

/** Patterns that indicate error/synthetic messages. Case-insensitive. */
const ERROR_PATTERNS: RegExp[] = [
  /couldn'?t generate/i,
  /try rephrasing/i,
  /something went wrong/i,
  /please try again/i,
  /unable to generate/i,
];

/** System sentinel prefix — injected by system event router, not for LLM history. */
const SYSTEM_SENTINEL = '[system]';

// ============================================================================
// Public API
// ============================================================================

/**
 * Filter and cap conversation messages for the v4 LLM call.
 *
 * Applied after assembleMessages() + sanitiseAssistantHistory(),
 * before the messages are passed to the adapter.
 */
export function filterHistoryV4(messages: AssembledMessage[]): AssembledMessage[] {
  const filtered: AssembledMessage[] = [];

  for (const msg of messages) {
    // For ToolResponseBlock[] content: extract text blocks, drop tool_use blocks
    const text = extractText(msg.content);
    if (text === null) continue;

    const trimmed = text.trim();

    // Drop empty/whitespace
    if (trimmed.length === 0) continue;

    // Drop system sentinels
    if (trimmed.startsWith(SYSTEM_SENTINEL)) continue;

    // Drop normaliser default text
    if (trimmed === NORMALISER_DEFAULT) continue;

    // Drop error-pattern messages
    if (ERROR_PATTERNS.some((re) => re.test(trimmed))) continue;

    // Emit as plain string content (tool_use blocks stripped)
    filtered.push({ role: msg.role, content: trimmed });
  }

  // Cap at most recent MAX_HISTORY_MESSAGES
  if (filtered.length > MAX_HISTORY_MESSAGES) {
    return filtered.slice(-MAX_HISTORY_MESSAGES);
  }

  return filtered;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract plain text from message content.
 *
 * - String content: returned as-is
 * - ToolResponseBlock[]: text blocks concatenated, tool_use blocks dropped
 * - Returns null if no text content found
 */
function extractText(content: string | ToolResponseBlock[]): string | null {
  if (typeof content === 'string') return content;

  // ToolResponseBlock[] — extract text blocks only
  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      textParts.push(block.text);
    }
  }

  return textParts.length > 0 ? textParts.join('') : null;
}
