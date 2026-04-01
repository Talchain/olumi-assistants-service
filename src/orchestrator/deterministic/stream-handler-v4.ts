/**
 * Stream Handler v4 — Adapter Events → SSE Events
 *
 * Maps Anthropic ChatWithToolsStreamEvent to OrchestratorStreamEvent
 * for SSE delivery. Executes tools immediately at tool_input_complete
 * so the UI receives block events while the model may still be streaming.
 *
 * This is a thin mapping layer — business logic lives in pipeline-v4.ts.
 */

import type { ChatWithToolsStreamEvent } from "../../adapters/llm/types.js";
import type { OrchestratorStreamEvent } from "../pipeline/stream-events.js";
import type { TypedConversationBlock } from "../types.js";
import type { ActionResult, DeterministicTurnContext } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

/** Long-running actions that should show progress indicators. */
const LONG_RUNNING_ACTIONS: ReadonlySet<ActionName> = new Set([
  'run_analysis',
  'draft_graph',
]);

export interface ToolExecution {
  toolName: string;
  input: Record<string, unknown>;
  result: ActionResult;
  durationMs: number;
}

export interface StreamHandlerResult {
  assistantText: string;
  toolExecution: ToolExecution | null;
  /** Tool call that was attempted but failed. */
  failedToolCall: { name: string; error: string } | null;
  /** Additional tool calls that were discarded (at most one state-changing action per turn). */
  discardedToolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Process the adapter stream and yield SSE events.
 *
 * Yields text_delta and tool_start events as they arrive.
 * On tool_input_complete, executes the first tool immediately and yields
 * block/tool_result events. Subsequent tool calls are discarded.
 * Returns the accumulated result for envelope assembly.
 */
export async function* processAdapterStream(
  stream: AsyncIterable<ChatWithToolsStreamEvent>,
  turnContext: DeterministicTurnContext,
  requestId: string,
): AsyncGenerator<OrchestratorStreamEvent & { type: 'text_delta' | 'tool_start' | 'block' | 'tool_result' | 'progress' }, StreamHandlerResult> {
  let seq = 0;
  const textChunks: string[] = [];
  let toolExecution: ToolExecution | null = null;
  let failedToolCall: { name: string; error: string } | null = null;
  const discardedToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta': {
        textChunks.push(event.delta);
        yield { type: 'text_delta', seq: seq++, delta: event.delta };
        break;
      }

      case 'tool_input_start': {
        const isLongRunning = LONG_RUNNING_ACTIONS.has(event.tool_name as ActionName);
        yield { type: 'tool_start', seq: seq++, tool_name: event.tool_name, long_running: isLongRunning };
        break;
      }

      case 'tool_input_complete': {
        // Execute first tool immediately; discard subsequent calls
        if (toolExecution) {
          discardedToolCalls.push({ name: event.tool_name, input: event.input });
          log.warn({
            request_id: requestId,
            discarded_tool: event.tool_name,
            kept_tool: toolExecution.toolName,
          }, 'v4.tool_call_discarded');
          break;
        }

        const actionDef = ACTION_CATALOGUE.get(event.tool_name as ActionName);
        if (!actionDef) {
          log.warn({ request_id: requestId, tool_name: event.tool_name }, 'v4.unknown_tool_call');
          break;
        }

        const startTime = Date.now();
        try {
          const result = await actionDef.execute(event.input, turnContext);
          const durationMs = Date.now() - startTime;

          toolExecution = {
            toolName: event.tool_name,
            input: event.input,
            result,
            durationMs,
          };

          // Yield block events immediately so UI sees them while stream continues
          for (const block of result.blocks) {
            yield { type: 'block', seq: seq++, block };
          }

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: event.tool_name,
            success: true,
            duration_ms: durationMs,
          };

          log.info({
            request_id: requestId,
            tool_name: event.tool_name,
            success: true,
            duration_ms: durationMs,
            blocks_produced: result.blocks.length,
          }, 'v4.tool_executed');

        } catch (error) {
          const durationMs = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);

          failedToolCall = { name: event.tool_name, error: errorMessage };

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: event.tool_name,
            success: false,
            duration_ms: durationMs,
          };

          log.error({
            request_id: requestId,
            tool_name: event.tool_name,
            duration_ms: durationMs,
            error: errorMessage,
          }, 'v4.tool_execution_failed');
        }
        break;
      }

      case 'message_complete': {
        // Stream fully consumed — no action needed
        break;
      }
    }
  }

  return {
    assistantText: textChunks.join(''),
    toolExecution,
    failedToolCall,
    discardedToolCalls,
  };
}
