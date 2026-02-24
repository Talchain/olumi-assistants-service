/**
 * undo_patch Tool Handler
 *
 * Deterministic stub — NOT in LLM tool registry.
 * Intent gate routes "undo" phrases here.
 *
 * Returns: assistant_text explaining undo is coming soon, blocks: [].
 * turn_plan: { selected_tool: 'undo_patch', routing: 'deterministic', long_running: false }
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
