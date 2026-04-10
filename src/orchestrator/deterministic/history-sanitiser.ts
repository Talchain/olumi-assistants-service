import type { ToolResponseBlock } from "../../adapters/llm/types.js";
import { log } from "../../utils/telemetry.js";

type AssembledMessage = { role: 'user' | 'assistant'; content: string | ToolResponseBlock[] };

/**
 * Sanitise assistant turns whose content is a JSON envelope from the
 * deterministic pipeline (e.g. `{"text":"...","insights":[...]}`).
 *
 * The UI may store the full JSON string as the assistant turn. On
 * subsequent turns this polluted history is sent back to CEE. Without
 * sanitisation the LLM sees raw JSON instead of natural language.
 *
 * For each assistant message with string content that parses as JSON
 * with a non-empty `.text` field, we replace the content with `.text`.
 * User messages and non-JSON assistant messages are passed through unchanged.
 */
export function sanitiseAssistantHistory(
  messages: AssembledMessage[],
): AssembledMessage[] {
  return messages.map((msg, idx) => {
    if (msg.role !== 'assistant') return msg;
    if (typeof msg.content !== 'string') return msg;

    const trimmed = msg.content.trimStart();
    if (!trimmed.startsWith('{')) return msg;

    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.text === 'string' &&
        parsed.text.trim().length > 0
      ) {
        log.debug({
          turn_index: idx,
          original_length: msg.content.length,
          extracted_length: parsed.text.length,
        }, 'deterministic.history_json_extracted');
        return { ...msg, content: parsed.text };
      }
    } catch {
      // Malformed JSON — pass through unchanged
    }

    return msg;
  });
}
