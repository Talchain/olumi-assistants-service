/**
 * Prompt Assembly for Orchestrator
 *
 * Infrastructure shell for building LLM prompts and tool definitions.
 * Paul writes the actual prompt text; this module provides the calling
 * infrastructure for assembleSystemPrompt, assembleToolDefinitions,
 * and assembleMessages.
 *
 * Uses Anthropic native tool calling via chatWithTools() on the LLM adapter.
 */

import type { ToolDefinition, ToolResponseBlock } from "../adapters/llm/types.js";
import type { ConversationContext, ConversationMessage } from "./types.js";

// ============================================================================
// System Prompt Assembly
// ============================================================================

/**
 * Assemble the system prompt for the orchestrator LLM call.
 *
 * Structure:
 * 1. Role and capabilities description
 * 2. Decision stage context
 * 3. Tool usage instructions
 * 4. Output format constraints
 *
 * --- CONTENT SLOT: Paul writes the actual prompt text ---
 */
export function assembleSystemPrompt(context: ConversationContext): string {
  const stage = context.framing?.stage ?? 'frame';
  const goal = context.framing?.goal ?? '';

  // Placeholder structure — Paul fills in actual prompt content
  const sections: string[] = [
    `You are a decision modelling assistant helping the user through the "${stage}" stage of their decision process.`,
  ];

  if (goal) {
    sections.push(`The user's decision goal: ${goal}`);
  }

  sections.push(
    'Use tools when appropriate. Only call one long-running tool (draft_graph, run_analysis) per turn.',
    'When explaining results, cite specific facts rather than generating numbers from memory.',
  );

  return sections.join('\n\n');
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
