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

/** Known orchestrator XML envelope tags — presence indicates XML-formatted history. */
const KNOWN_ENVELOPE_TAGS = ['<diagnostics>', '<response>', '<blocks>', '<suggested_actions>'];

/** Extract content from <assistant_text>...</assistant_text> tags. */
const ASSISTANT_TEXT_RE = /<assistant_text>([\s\S]*?)<\/assistant_text>/;

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

    // XML sanitisation for assistant-role entries (transitional: cf-v28 XML envelopes)
    const sanitised = msg.role === 'assistant' ? sanitiseXmlHistory(text) : text;

    const trimmed = sanitised.trim();

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
 * Sanitise XML-envelope content from cf-v28 assistant history.
 *
 * Extraction precedence:
 * 1. If <assistant_text>...</assistant_text> exists, extract the first non-empty payload.
 * 2. If known envelope tags are present, strip all XML tags and return remaining text.
 * 3. Otherwise passthrough unchanged.
 *
 * Only applied to assistant-role messages. User messages are never modified.
 */
export function sanitiseXmlHistory(text: string): string {
  // Precedence 1: extract <assistant_text> payload
  const match = ASSISTANT_TEXT_RE.exec(text);
  if (match && match[1] != null) {
    const extracted = match[1].trim();
    // Return the payload even if empty — the downstream empty-message guard
    // in filterHistoryV4 will drop it. Falling through to tag stripping
    // would leak diagnostics/internal content from other XML tags.
    return extracted;
  }

  // Precedence 2: known envelope tags present → strip all XML tags
  const hasEnvelopeTags = KNOWN_ENVELOPE_TAGS.some((tag) => text.includes(tag));
  if (hasEnvelopeTags) {
    return text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
  }

  // Precedence 3: passthrough
  return text;
}

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
