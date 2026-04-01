/**
 * History Filter v4
 *
 * Enforces the v4 history contract on the messages array before
 * it reaches the LLM:
 *
 * 1. Drop messages with non-string content (tool_use blocks)
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
    // Drop non-string content (tool_use blocks from prior turns)
    if (typeof msg.content !== 'string') continue;

    const text = msg.content.trim();

    // Drop empty/whitespace
    if (text.length === 0) continue;

    // Drop system sentinels
    if (text.startsWith(SYSTEM_SENTINEL)) continue;

    // Drop normaliser default text
    if (text === NORMALISER_DEFAULT) continue;

    // Drop error-pattern messages
    if (ERROR_PATTERNS.some((re) => re.test(text))) continue;

    filtered.push(msg);
  }

  // Cap at most recent MAX_HISTORY_MESSAGES
  if (filtered.length > MAX_HISTORY_MESSAGES) {
    return filtered.slice(-MAX_HISTORY_MESSAGES);
  }

  return filtered;
}
