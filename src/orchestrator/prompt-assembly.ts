/**
 * Prompt Assembly for Orchestrator
 *
 * Assembles the system prompt from the prompt management system (Zone 1)
 * and dynamic conversation context (Zone 2). Also provides tool definition
 * and message assembly for Anthropic native tool calling.
 *
 * Zone 1: Static orchestrator prompt loaded via getSystemPrompt('orchestrator').
 *         Managed by the prompt store — supports A/B testing, rollback, versioning.
 *         Warmed at startup, served from cache on subsequent calls.
 *
 * Zone 2: Dynamic context (decision stage, goal) appended per-turn.
 */

import { getSystemPrompt } from "../adapters/llm/prompt-loader.js";
import type { ToolDefinition, ToolResponseBlock } from "../adapters/llm/types.js";
import type { ConversationContext, ConversationMessage } from "./types.js";

// ============================================================================
// System Prompt Assembly
// ============================================================================

/**
 * Assemble the system prompt for the orchestrator LLM call.
 *
 * Structure:
 * - Zone 1: Static orchestrator prompt from prompt management system
 * - Zone 2: Dynamic context (stage, goal) appended per-turn
 *
 * Zone 1 is byte-identical on every call (cache-stable).
 * Zone 2 varies with conversation state.
 */
export async function assembleSystemPrompt(context: ConversationContext): Promise<string> {
  // Zone 1: Static orchestrator prompt (from prompt store / cache / defaults)
  const zone1 = await getSystemPrompt('orchestrator');

  // Zone 2: Dynamic conversation context
  const zone2Sections: string[] = [];

  const stage = context.framing?.stage ?? 'frame';
  zone2Sections.push(`Current stage: ${stage}`);

  const goal = context.framing?.goal ?? '';
  if (goal) {
    zone2Sections.push(`Decision goal: ${goal}`);
  }

  const zone2 = zone2Sections.join('\n');

  return `${zone1}\n\n${zone2}`;
}

// ============================================================================
// Tool Definitions Assembly
// ============================================================================

/**
 * Format tool registry definitions for Anthropic native tool calling.
 * Called by the turn handler to pass tool definitions to chatWithTools().
 *
 * @param toolDefs - Tool definitions from the registry
 * @returns Anthropic-formatted tool definitions
 */
export function assembleToolDefinitions(
  toolDefs: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
): ToolDefinition[] {
  return toolDefs.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
  }));
}

// ============================================================================
// Message Assembly
// ============================================================================

/**
 * Build the messages array from conversation history + current user message.
 *
 * Converts ConversationMessage[] to the format expected by chatWithTools().
 * Appends the current user message at the end.
 */
export function assembleMessages(
  context: ConversationContext,
  userMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }> = [];

  // Convert conversation history
  for (const msg of context.messages) {
    messages.push(convertMessage(msg));
  }

  // Append current user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/**
 * Convert a ConversationMessage to chatWithTools format.
 *
 * For messages with tool_calls, we reconstruct ToolResponseBlock[] format.
 * For plain text messages, we pass the content string directly.
 */
function convertMessage(
  msg: ConversationMessage,
): { role: 'user' | 'assistant'; content: string | ToolResponseBlock[] } {
  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    // Reconstruct tool_use blocks from stored tool calls
    const blocks: ToolResponseBlock[] = [];

    if (msg.content) {
      blocks.push({ type: 'text', text: msg.content });
    }

    for (const tc of msg.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: `toolu_${tc.name}`, // Placeholder ID for history reconstruction
        name: tc.name,
        input: tc.input,
      });
    }

    return { role: 'assistant', content: blocks };
  }

  return { role: msg.role, content: msg.content };
}
