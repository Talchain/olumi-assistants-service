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
import { parseOrchestratorResponse } from "../response-parser.js";
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

/**
 * Detects whether streamed text needs to go through parseOrchestratorResponse.
 *
 * Returns true when the text either:
 *   (a) contains an XML envelope tag anywhere
 *       (<diagnostics>, <response>, <assistant_text>, <blocks>, <suggested_actions>), or
 *   (b) contains any line matching the diagnostics-preamble pattern
 *       (Mode:|Stage:|Context:|Route:|Tool:|Using:|No tool needed/invocation).
 *
 * Returns false for clean prose so the parser's side-effects do not run on
 * legitimate streamed output:
 *   1. rescueInlineActions() (Path 5 plain text) would strip lines like
 *      "Facilitator: Label — Message" into suggested_actions[]; the stream
 *      handler does not plumb suggested_actions through, so those lines
 *      would silently disappear from assistant_text. The gate skips clean
 *      prose entirely so this side-effect never fires on streamed text.
 *   2. Path 5 telemetry (`orchestrator.xml_parse_fallback`) would emit on
 *      every clean streamed turn, polluting the parse-fallback signal.
 *
 * Mirrors the parser's own DIAGNOSTICS_PREAMBLE_LINE pattern so the gate
 * triggers on the same conditions the stripper would actually act on.
 * Falsely matching legitimate prose (e.g. "Tool: a Monte Carlo simulation.")
 * is a known limitation shared with the parser itself; the fail-safe inside
 * stripDiagnosticsPreamble restores the original text if stripping would
 * empty it. Catching the bundle-evidenced "headline + middle diagnostics +
 * prose" leak (debug bundle bce361c4) is more important than that edge.
 */
const ENVELOPE_TAG_RE = /<(?:diagnostics|response|assistant_text|blocks|suggested_actions)\b/i;
const DIAGNOSTICS_LINE_RE =
  /^[ \t]*(?:Mode:|Stage:|Context:|Route:|Tool:|Using:|No tool (?:needed|invocation)\b)/im;

function needsEnvelopeParse(text: string): boolean {
  return ENVELOPE_TAG_RE.test(text) || DIAGNOSTICS_LINE_RE.test(text);
}

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
  // Tracks whether phase-1 message_complete extraction ran the envelope
  // parser successfully. When true, `textChunks` already contains the
  // cleaned <assistant_text> payload and the post-assembly parser must
  // not run a second time — a second Path 5 parse on clean prose could
  // strip legitimate marker lines (e.g. "Using: historical data…") via
  // stripDiagnosticsPreamble, mangling the already-correct headline.
  let phase1Parsed = false;

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

      // If no substantive headline text has been emitted yet and the handler
      // has fallback text, yield it as a text_delta BEFORE block/tool_result.
      // Skip when the handler produced a HandlerFact — the response composer
      // will produce authoritative decision-language text for the envelope,
      // and streaming the handler's count-based text would show the user
      // "Added N factors..." before the composer replaces it.
      if (
        textChunks.join('').trim() === ''
        && result.assistantText && result.assistantText.trim()
        && !result.fact
      ) {
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

        // Short-running tool: if substantive text has already streamed
        // ahead of the tool call, there will be no headline text buried in
        // finalMessage.content — execute now for minimal latency. If no
        // substantive text has streamed yet (common with Sonnet 4.6 +
        // forced tool_choice, including the whitespace-only delta case),
        // defer execution until message_complete so any extracted text can
        // be yielded BEFORE the block/tool_result events.
        //
        // Uses the same `trim() === ''` test as the phase-1 extraction
        // guard in the message_complete handler — keeping the two in lock-
        // step avoids the mismatch where phase-1 extracts but the tool has
        // already executed inline (which would violate the required
        // text_delta → block → tool_result ordering).
        if (textChunks.join('').trim() !== '') {
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
        //
        // The guard treats whitespace-only streamed content as empty: if
        // nothing substantive has arrived via deltas, the finalMessage text
        // block is the headline. Using `.trim() === ''` (instead of
        // `length === 0`) avoids silently dropping the headline when the
        // model streams a stray whitespace delta before the tool_use block.
        // When real content has streamed we skip extraction to prevent
        // double-emission — the normal streaming path is preserved.
        if (textChunks.join('').trim() === '') {
          // Sonnet 4.6 + forced tool_choice bundles the entire XML envelope
          // (<diagnostics>...</diagnostics><response><assistant_text>...
          // </assistant_text></response>) into the final message content.
          // Concatenate all substantive text blocks in order and parse once
          // so the SSE text_delta and the accumulated textChunks carry only
          // the user-visible assistant_text — never the diagnostics prose.
          //
          // Skipping whitespace-only blocks before joining prevents the
          // parser's empty-input Path 6 from substituting its generic
          // "I had trouble processing that..." fallback in place of an
          // actual tool-handler headline (which is owned by the Fix 2
          // fallback inside executeShortTool, gated on textChunks staying
          // empty). Joining once also avoids splitting an envelope across
          // independent parses.
          const rawTextParts: string[] = [];
          for (const block of event.result.content) {
            if (block.type === 'text' && block.text && block.text.trim().length > 0) {
              rawTextParts.push(block.text);
            }
          }
          if (rawTextParts.length > 0) {
            // parseOrchestratorResponse never throws and has a plain-text
            // fallback, so unwrapped prose round-trips unchanged.
            const parsed = parseOrchestratorResponse(rawTextParts.join(''));
            const clean = parsed.assistant_text;
            if (clean) {
              textChunks.push(clean);
              yield { type: 'text_delta', seq: seq++, delta: clean };
            }
            // Mark phase-1 as having run the parser (even if clean was
            // empty) so post-assembly does not double-parse the result.
            phase1Parsed = true;
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

  // Post-assembly parse: covers the streamed-delta path where the LLM
  // emits the entire <diagnostics>...</diagnostics><response>
  // <assistant_text>...</assistant_text></response> envelope as
  // token-level deltas. The phase-1 message_complete extraction only
  // fires when textChunks is empty pre-finalisation, so streamed turns
  // never went through it. Parse the accumulated text once here to
  // strip diagnostics from the returned assistantText. SSE text_delta
  // events were already yielded raw to the client during streaming —
  // the client reconciles to the canonical assistant_text in the final
  // envelope, so transient deltas are acceptable.
  //
  // We GATE this parse on the presence of envelope or diagnostics
  // markers because parseOrchestratorResponse has two side-effects we
  // do not want on clean prose:
  //   1. rescueInlineActions() (Path 5 plain text) strips lines like
  //      "Facilitator: Label — Message" into suggested_actions[]. The
  //      stream handler does not plumb suggested_actions through, so
  //      those lines would silently disappear from assistant_text.
  //   2. stripDiagnosticsPreamble() scans the entire text when no XML
  //      tag is present, removing legitimate prose lines that begin
  //      with "Mode:", "Stage:", "Tool:", "Context:", "Route:",
  //      "Using:", or "No tool needed/invocation". On clean turns this
  //      mangles real prose.
  // Gating also avoids telemetry pollution: every clean streamed turn
  // would otherwise emit an `orchestrator.xml_parse_fallback` event.
  //
  // The gate triggers when EITHER an envelope tag is present anywhere
  // in the text, OR any line in the text matches the diagnostics
  // preamble pattern. This covers both the full-envelope leak and the
  // bundle-evidenced "headline + middle diagnostics + prose" leak
  // (debug bundle bce361c4) where the diagnostics block sits between
  // two prose paragraphs with no XML tags. See needsEnvelopeParse for
  // the matching rules and the rationale.
  //
  // CRITICAL: we also skip post-assembly parsing when phase-1 already
  // ran the parser. After phase-1, `textChunks` holds the cleaned
  // <assistant_text> payload. Re-parsing it could mangle legitimate
  // marker lines inside that payload (e.g. "Using: historical data as
  // the baseline"), because stripDiagnosticsPreamble on clean prose
  // would scan the whole text and drop the line. Single-parse guarantee.
  //
  // Empty/whitespace-only input bypasses the parser entirely so the
  // parser's Path 6 generic fallback ("I had trouble processing that…")
  // never replaces an empty assistantText that pipeline-v4 will
  // populate via its chip pre-text / template / tool-handler fallbacks.
  //
  // Empty-result handling: when the gate triggered because an envelope
  // tag was present (the structural case), trust the parser's output
  // even if empty — a malformed envelope with no <assistant_text>
  // should degrade to the response-normaliser's DEFAULT_TEXT, not
  // leak the raw envelope through to the response-normaliser's naive
  // tag-stripper (which would leave the diagnostics content intact).
  // When the gate triggered only via a diagnostics-style line with no
  // envelope tags, the stripping is heuristic: prefer the raw text if
  // parsing would empty it, so a false-positive never silently drops
  // a real response.
  const rawAssistantText = textChunks.join('');
  let assistantText = rawAssistantText;
  if (
    !phase1Parsed
    && rawAssistantText.trim().length > 0
    && needsEnvelopeParse(rawAssistantText)
  ) {
    const parsed = parseOrchestratorResponse(rawAssistantText);
    if (parsed.assistant_text && parsed.assistant_text.length > 0) {
      assistantText = parsed.assistant_text;
    } else if (ENVELOPE_TAG_RE.test(rawAssistantText)) {
      // Structural envelope but no <assistant_text> payload → empty
      // string; the response-normaliser will substitute DEFAULT_TEXT.
      assistantText = '';
    }
    // else: diagnostics-line-only match that emptied the text → keep raw.
  }

  return {
    assistantText,
    toolExecution: state.toolExecution,
    failedToolCall: state.failedToolCall,
    pendingLongRunningTool,
    discardedToolCalls,
  };
}
