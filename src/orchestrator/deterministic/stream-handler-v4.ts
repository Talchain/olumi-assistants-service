/**
 * Stream Handler v4 — Adapter Events → SSE Events
 *
 * Maps Anthropic ChatWithToolsStreamEvent to OrchestratorStreamEvent
 * for SSE delivery. Executes short-running tools immediately at
 * tool_input_complete. Long-running tools (run_analysis, draft_graph)
 * are deferred to the pipeline level which can yield real-time progress
 * events during execution.
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

/** Long-running actions — deferred to pipeline level for real-time progress. */
export const LONG_RUNNING_ACTIONS: ReadonlySet<ActionName> = new Set([
  'run_analysis',
  'draft_graph',
]);

/** Progress messages per tool. */
export const PROGRESS_MESSAGES: Partial<Record<ActionName, string>> = {
  draft_graph: 'Building decision model\u2026',
  run_analysis: 'Running analysis\u2026',
};

/** Interval between progress events (ms). */
export const PROGRESS_INTERVAL_MS = 5000;

// ============================================================================
// Types
// ============================================================================

export interface ToolExecution {
  toolName: string;
  input: Record<string, unknown>;
  result: ActionResult;
  durationMs: number;
}

/** A tool call collected from the stream but not yet executed. */
export interface PendingToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface StreamHandlerResult {
  assistantText: string;
  toolExecution: ToolExecution | null;
  /** Tool call that was attempted but failed. */
  failedToolCall: { name: string; error: string } | null;
  /** Long-running tool call deferred to pipeline for execution with progress. */
  pendingLongRunningTool: PendingToolCall | null;
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
 * On tool_input_complete:
 * - Short-running tools: executed immediately, block/tool_result events yielded
 * - Long-running tools: deferred to pipeline (returned in pendingLongRunningTool)
 * Subsequent tool calls are discarded.
 * Returns the accumulated result for envelope assembly.
 */
export async function* processAdapterStream(
  stream: AsyncIterable<ChatWithToolsStreamEvent>,
  turnContext: DeterministicTurnContext,
  requestId: string,
): AsyncGenerator<OrchestratorStreamEvent & { type: 'text_delta' | 'tool_start' | 'block' | 'tool_result' }, StreamHandlerResult> {
  let seq = 0;
  const textChunks: string[] = [];
  // Note: these are mutated from the nested executeShortTool generator.
  // Explicit type annotations defeat TS's control-flow narrowing to the
  // initial null literal, which would otherwise cause `toolExecution?.x`
  // access to be flagged as property-on-never in the discard-guard below.
  const state: {
    toolExecution: ToolExecution | null;
    failedToolCall: { name: string; error: string } | null;
  } = { toolExecution: null, failedToolCall: null };
  let pendingLongRunningTool: PendingToolCall | null = null;
  const discardedToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  // A short-running tool call seen during streaming but deferred until
  // message_complete. We defer execution when no text_deltas have streamed yet
  // so that, if the model surfaces the headline text only in the final
  // message.content (common with Sonnet 4.6 + forced tool_choice), we can
  // extract the text and yield it BEFORE the tool's block/tool_result events.
  // Hard-required event ordering: text_delta → block → tool_result → turn_complete.
  let deferredShortTool: { name: string; input: Record<string, unknown> } | null = null;

  /**
   * Execute a short-running tool and yield its block + tool_result events.
   * Centralised so both the streaming path (tool_input_complete) and the
   * deferred path (message_complete) emit identical event sequences.
   */
  async function* executeShortTool(
    name: string,
    input: Record<string, unknown>,
    fallbackPath: boolean,
  ): AsyncGenerator<OrchestratorStreamEvent & { type: 'text_delta' | 'block' | 'tool_result' }> {
    const actionDef = ACTION_CATALOGUE.get(name as ActionName);
    if (!actionDef) {
      log.warn({ request_id: requestId, tool_name: name }, 'v4.unknown_tool_call');
      return;
    }

    const startTime = Date.now();
    try {
      const result = await actionDef.execute(input, turnContext);
      const durationMs = Date.now() - startTime;

      state.toolExecution = { toolName: name, input, result, durationMs };

      // Fix 2: if no headline text has been emitted yet (no LLM text_deltas
      // streamed and no text extracted from message_complete.content), use
      // the tool handler's own assistantText as a fallback headline and
      // yield it as a text_delta BEFORE the block/tool_result events.
      // Preserves the hard-required ordering: text_delta → block → tool_result.
      if (textChunks.length === 0 && result.assistantText && result.assistantText.trim()) {
        textChunks.push(result.assistantText);
        yield { type: 'text_delta', seq: seq++, delta: result.assistantText };
      }

      for (const block of result.blocks) {
        yield { type: 'block', seq: seq++, block };
      }

      yield {
        type: 'tool_result',
        seq: seq++,
        tool_name: name,
        success: true,
        duration_ms: durationMs,
      };

      log.info({
        request_id: requestId,
        tool_name: name,
        success: true,
        duration_ms: durationMs,
        blocks_produced: result.blocks.length,
        ...(fallbackPath ? { fallback_path: true } : {}),
      }, 'v4.tool_executed');
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.failedToolCall = { name, error: errorMessage };

      yield {
        type: 'tool_result',
        seq: seq++,
        tool_name: name,
        success: false,
        duration_ms: durationMs,
      };

      log.error({
        request_id: requestId,
        tool_name: name,
        duration_ms: durationMs,
        error: errorMessage,
        ...(fallbackPath ? { fallback_path: true } : {}),
      }, 'v4.tool_execution_failed');
    }
  }

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
        // Only one tool per turn — discard subsequent calls
        if (state.toolExecution || state.failedToolCall || pendingLongRunningTool || deferredShortTool) {
          discardedToolCalls.push({ name: event.tool_name, input: event.input });
          log.warn({
            request_id: requestId,
            discarded_tool: event.tool_name,
            kept_tool: state.toolExecution?.toolName ?? state.failedToolCall?.name ?? pendingLongRunningTool?.name ?? deferredShortTool?.name,
          }, 'v4.tool_call_discarded');
          break;
        }

        const actionDef = ACTION_CATALOGUE.get(event.tool_name as ActionName);
        if (!actionDef) {
          log.warn({ request_id: requestId, tool_name: event.tool_name }, 'v4.unknown_tool_call');
          break;
        }

        const isLongRunning = LONG_RUNNING_ACTIONS.has(event.tool_name as ActionName);

        if (isLongRunning) {
          // Defer to pipeline level for execution with real-time progress events
          pendingLongRunningTool = { name: event.tool_name, input: event.input };
          break;
        }

        // Short-running tool: if the model has already streamed text deltas
        // ahead of the tool call, there will be no headline text buried in
        // finalMessage.content — execute now for minimal latency. If no text
        // has streamed yet (common with Sonnet 4.6 + forced tool_choice),
        // defer execution until message_complete so any extracted text can be
        // yielded BEFORE the block/tool_result events.
        if (textChunks.length > 0) {
          yield* executeShortTool(event.tool_name, event.input, false);
        } else {
          deferredShortTool = { name: event.tool_name, input: event.input };
        }
        break;
      }

      case 'message_complete': {
        // Phase 1: extract any text blocks from the final message.
        // Runs regardless of whether a tool was seen during streaming — the
        // previous `!toolExecution` guard dropped headline text whenever the
        // model emitted zero streaming deltas (Sonnet 4.6 forced tool_choice).
        // Skip if deltas already streamed (textChunks non-empty) to avoid
        // double-emission in the normal streaming path.
        if (textChunks.length === 0) {
          for (const block of event.result.content) {
            if (block.type === 'text' && block.text) {
              textChunks.push(block.text);
              yield { type: 'text_delta', seq: seq++, delta: block.text };
            }
          }
        }

        // Phase 2: execute any deferred short-running tool from the streaming
        // path. Emits block + tool_result AFTER the text_delta above, giving
        // the required ordering: text_delta → block → tool_result.
        if (deferredShortTool) {
          const deferred = deferredShortTool;
          deferredShortTool = null;
          yield* executeShortTool(deferred.name, deferred.input, false);
        }

        // Phase 3: non-streaming fallback. If the adapter fell back to
        // chatWithTools and never emitted tool_input_complete, extract the
        // tool call from the final content blocks. Only runs when no tool
        // has been seen yet via any path.
        if (!state.toolExecution && !state.failedToolCall && !pendingLongRunningTool) {
          for (const block of event.result.content) {
            if (block.type !== 'tool_use') continue;

            // One tool per turn — discard extras
            if (state.toolExecution || state.failedToolCall || pendingLongRunningTool) {
              discardedToolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
              continue;
            }

            const toolInput = block.input as Record<string, unknown>;
            const isLongRunning = LONG_RUNNING_ACTIONS.has(block.name as ActionName);

            if (isLongRunning) {
              pendingLongRunningTool = { name: block.name, input: toolInput };
              continue;
            }

            yield* executeShortTool(block.name, toolInput, true);
          }
        }
        break;
      }
    }
  }

  // Safety net: if the stream closed without a message_complete event but a
  // short-running tool was deferred, execute it now so we never strand a
  // pending tool call. (Should not happen in practice — the adapter always
  // yields message_complete — but keeps the return invariant sound.)
  if (deferredShortTool && !state.toolExecution && !state.failedToolCall) {
    const deferred = deferredShortTool;
    deferredShortTool = null;
    yield* executeShortTool(deferred.name, deferred.input, false);
  }

  return {
    assistantText: textChunks.join(''),
    toolExecution: state.toolExecution,
    failedToolCall: state.failedToolCall,
    pendingLongRunningTool,
    discardedToolCalls,
  };
}
