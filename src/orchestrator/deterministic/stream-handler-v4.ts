/**
 * Stream Handler v4 — Adapter Events → SSE Events
 *
 * Maps Anthropic ChatWithToolsStreamEvent to OrchestratorStreamEvent
 * for SSE delivery. Executes tools immediately at tool_input_complete
 * so the UI receives block events while the model may still be streaming.
 *
 * Long-running tools (run_analysis, draft_graph) emit periodic progress
 * events during execution via a Promise.race polling pattern.
 */

import type { ChatWithToolsStreamEvent } from "../../adapters/llm/types.js";
import type { OrchestratorStreamEvent } from "../pipeline/stream-events.js";
import type { ActionResult, DeterministicTurnContext } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

/** Long-running actions that should show progress indicators. */
const LONG_RUNNING_ACTIONS: ReadonlySet<ActionName> = new Set([
  'run_analysis',
  'draft_graph',
]);

/** Progress messages per tool. */
const PROGRESS_MESSAGES: Partial<Record<ActionName, string>> = {
  draft_graph: 'Building decision model\u2026',
  run_analysis: 'Running analysis\u2026',
};

/** Interval between progress events (ms). */
const PROGRESS_INTERVAL_MS = 5000;

// ============================================================================
// Types
// ============================================================================

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
 * block/tool_result events. Long-running tools get periodic progress events.
 * Subsequent tool calls are discarded.
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
        if (toolExecution || failedToolCall) {
          discardedToolCalls.push({ name: event.tool_name, input: event.input });
          log.warn({
            request_id: requestId,
            discarded_tool: event.tool_name,
            kept_tool: toolExecution?.toolName ?? failedToolCall?.name,
          }, 'v4.tool_call_discarded');
          break;
        }

        const actionDef = ACTION_CATALOGUE.get(event.tool_name as ActionName);
        if (!actionDef) {
          log.warn({ request_id: requestId, tool_name: event.tool_name }, 'v4.unknown_tool_call');
          break;
        }

        const isLongRunning = LONG_RUNNING_ACTIONS.has(event.tool_name as ActionName);
        const startTime = Date.now();

        try {
          let result: ActionResult;

          if (isLongRunning) {
            // Long-running tool: race execution against progress timer
            const progressEvents: Array<OrchestratorStreamEvent & { type: 'progress' }> = [];
            result = await executeWithProgress(
              () => actionDef.execute(event.input, turnContext),
              event.tool_name as ActionName,
              startTime,
              progressEvents,
            );
            // Yield buffered progress events
            for (const pe of progressEvents) {
              yield { ...pe, seq: seq++ };
            }
          } else {
            result = await actionDef.execute(event.input, turnContext);
          }

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

// ============================================================================
// Progress Helper
// ============================================================================

/**
 * Execute a long-running tool with periodic progress events.
 *
 * Uses Promise.race to interleave progress ticks with the execution promise.
 * Progress events are collected into the buffer (can't yield from a non-generator).
 * The caller yields them after execution completes.
 *
 * Note: progress events are buffered, not streamed in real-time. This is a
 * limitation of the generator pattern — the caller yields them in a burst
 * after execution. For the UI, this means progress events arrive late but
 * still provide context in the SSE log. The tool_start event (with
 * long_running: true) is the real-time signal for the UI spinner.
 */
async function executeWithProgress<T>(
  executeFn: () => Promise<T>,
  toolName: ActionName,
  startTime: number,
  progressBuffer: Array<OrchestratorStreamEvent & { type: 'progress' }>,
): Promise<T> {
  const message = PROGRESS_MESSAGES[toolName] ?? 'Processing\u2026';

  let done = false;
  const execPromise = executeFn().finally(() => { done = true; });

  const progressTimer = setInterval(() => {
    if (done) return;
    progressBuffer.push({
      type: 'progress',
      seq: 0, // seq assigned by caller
      tool_name: toolName,
      elapsed_ms: Date.now() - startTime,
      message,
    });
  }, PROGRESS_INTERVAL_MS);

  try {
    return await execPromise;
  } finally {
    clearInterval(progressTimer);
  }
}
