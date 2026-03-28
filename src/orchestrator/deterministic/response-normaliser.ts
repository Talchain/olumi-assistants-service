/**
 * Response Normaliser
 *
 * Server-side guardrails applied to every deterministic pipeline response.
 */

import type { OrchestratorResponseEnvelope, SuggestedAction, TypedConversationBlock } from "../types.js";
import { isValidAction } from "./actions/registry.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_CHIPS = 3;
const MAX_INSIGHTS = 3;
const DEFAULT_TEXT = "I'm here to help with your decision. What would you like to explore?";

// ============================================================================
// Public API
// ============================================================================

/**
 * Normalise a response envelope — belt-and-braces guardrails.
 */
export function normaliseDeterministicResponse(
  envelope: OrchestratorResponseEnvelope,
): OrchestratorResponseEnvelope {
  // 1. Empty text → default message
  if (!envelope.assistant_text || envelope.assistant_text.trim().length === 0) {
    envelope.assistant_text = DEFAULT_TEXT;
  }

  // 2. Strip any XML tags (belt-and-braces)
  envelope.assistant_text = stripXmlTags(envelope.assistant_text);

  // 3. Cap chips at MAX_CHIPS
  if (envelope.suggested_actions && envelope.suggested_actions.length > MAX_CHIPS) {
    envelope.suggested_actions = envelope.suggested_actions.slice(0, MAX_CHIPS);
  }

  // 4. Deduplicate blocks by type (keep first of each type)
  if (envelope.blocks.length > 0) {
    envelope.blocks = deduplicateBlocks(envelope.blocks);
  }

  // 5. Reject empty blocks
  envelope.blocks = envelope.blocks.filter((b) => !isEmptyBlock(b));

  // 6. Cap insights at 3
  if (envelope.insights && envelope.insights.length > MAX_INSIGHTS) {
    envelope.insights = envelope.insights.slice(0, MAX_INSIGHTS);
  }

  // 7. Validate suggested_actions reference valid actions
  if (envelope.suggested_actions) {
    envelope.suggested_actions = envelope.suggested_actions.filter((a) => {
      // Chip prompts are user-facing text, not action_type strings — always valid
      return a.label && a.label.trim().length > 0 && a.prompt && a.prompt.trim().length > 0;
    });
  }

  return envelope;
}

// ============================================================================
// Helpers
// ============================================================================

function stripXmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
}

function deduplicateBlocks(blocks: TypedConversationBlock[]): TypedConversationBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    // Allow multiple commentary blocks but deduplicate others
    if (block.block_type === 'commentary') return true;
    if (seen.has(block.block_type)) return false;
    seen.add(block.block_type);
    return true;
  });
}

function isEmptyBlock(block: TypedConversationBlock): boolean {
  switch (block.block_type) {
    case 'commentary':
      return !block.data.narrative || block.data.narrative.trim().length === 0;
    case 'graph_patch':
      return !block.data.operations || block.data.operations.length === 0;
    case 'fact':
      return !block.data.facts || block.data.facts.length === 0;
    default:
      return false;
  }
}
