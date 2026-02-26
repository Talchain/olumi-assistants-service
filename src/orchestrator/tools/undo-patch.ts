/**
 * undo_patch Tool Handler
 *
 * Latent stub — NOT in LLM tool registry.
 * NOT routed deterministically (removed in v2). Kept as fallback
 * handler if LLM selects undo_patch via tool_use.
 *
 * Returns: assistant_text explaining undo is coming soon, blocks: [].
 * turn_plan: { selected_tool: 'undo_patch', routing: 'llm', long_running: false }
 *
 * Does NOT throw error or return error envelope.
 */

import type { ConversationBlock } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface UndoPatchResult {
  blocks: ConversationBlock[];
  assistantText: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the undo_patch tool.
 * Always succeeds — returns a friendly stub message.
 */
export function handleUndoPatch(): UndoPatchResult {
  return {
    blocks: [],
    assistantText: 'Undo is not yet available. You can ask me to edit the graph to reverse specific changes, or draft a new graph.',
  };
}
