/**
 * Progress Tracker
 *
 * Computes progress_kind for the last N turns from conversation history.
 * Inspects tool invocations and system events to infer what happened.
 *
 * Pure function — no LLM calls, no I/O.
 */

import type { ConversationMessage, ProgressKind } from "../types.js";

const DEFAULT_LOOKBACK = 5;

/**
 * Compute progress_kind for each of the last N turns.
 *
 * Inspects conversation_history for tool invocations to infer progress:
 * - draft_graph or edit_graph invocation → changed_model
 * - run_analysis invocation → ran_analysis
 * - generate_brief invocation → committed
 * - explain_results invocation → added_evidence (user is learning from results)
 * - No tool invocations → none
 */
export function trackProgress(
  conversationHistory: ConversationMessage[],
  lookback: number = DEFAULT_LOOKBACK,
): ProgressKind[] {
  // Take last N messages (assistant turns carry tool_calls)
  const recent = conversationHistory.slice(-lookback);
  const markers: ProgressKind[] = [];

  for (const msg of recent) {
    if (msg.role !== 'assistant') {
      // User turns don't have tool calls — skip or mark none
      continue;
    }

    const toolCalls = msg.tool_calls ?? [];
    const toolNames = toolCalls.map(tc => tc.name);

    if (toolNames.includes('draft_graph') || toolNames.includes('edit_graph')) {
      markers.push('changed_model');
    } else if (toolNames.includes('run_analysis')) {
      markers.push('ran_analysis');
    } else if (toolNames.includes('generate_brief')) {
      markers.push('committed');
    } else if (toolNames.includes('explain_results')) {
      markers.push('added_evidence');
    } else {
      markers.push('none');
    }
  }

  return markers;
}
