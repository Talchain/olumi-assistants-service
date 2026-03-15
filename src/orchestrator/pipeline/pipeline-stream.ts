/**
 * Streaming Pipeline Orchestrator
 *
 * Async generator that yields OrchestratorStreamEvent events for SSE delivery.
 * Mirrors executePipeline but emits incremental events instead of returning a single envelope.
 *
 * Does NOT modify executePipeline, phase3Generate, phase4Execute, or phase5Validate.
 * All streaming code is additive.
 */

import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { extractDeclaredMode, inferResponseMode } from "../response-parser.js";
import { isToolAllowedAtStage } from "../tools/stage-policy.js";
import type { OrchestratorTurnRequest } from "../types.js";
import type {
  PipelineDeps,
  OrchestratorResponseEnvelopeV2,
  EnrichedContext,
  LLMResult,
  LLMClient,
  ConversationBlock,
} from "./types.js";
import type { Phase4Result } from "./phase4-tools/index.js";
import { phase1Enrich } from "./phase1-enrichment/index.js";
import { phase2Route } from "./phase2-specialists/index.js";
import { phase3Generate } from "./phase3-llm/index.js";
import { phase3PrepareForStreaming } from "./phase3-llm/index.js";
import { assembleV2SystemPrompt } from "./phase3-llm/prompt-assembler.js";
import { phase4Execute } from "./phase4-tools/index.js";
import { phase5Validate } from "./phase5-validation/index.js";
import { buildErrorEnvelope, resolveContextHash } from "./phase5-validation/envelope-assembler.js";
import { routeSystemEvent, appendSystemMessages } from "../system-event-router.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { classifyIntent } from "../intent-gate.js";
import type { IntentGateResult } from "../intent-gate.js";
import { tryAnalysisLookup, buildLookupEnvelope } from "../lookup/analysis-lookup.js";
import type { OrchestratorStreamEvent } from "./stream-events.js";
import { STREAM_ERROR_CODES } from "./stream-events.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "../../adapters/llm/errors.js";
import { DailyBudgetExceededError } from "../../adapters/llm/errors.js";
import { normalizeAnalysisEnvelope } from "../analysis-state.js";

// Long-running tools that warrant a tool_start event with long_running: true
const LONG_RUNNING_TOOLS = new Set(['run_analysis', 'draft_graph']);

/** Wrapper error for tool dispatch failures — allows mapErrorToStreamEvent to use TOOL_ERROR code. */
class ToolDispatchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ToolDispatchError';
  }
}

/**
 * Execute the five-phase pipeline as a streaming async generator.
 *
 * Yields OrchestratorStreamEvent events incrementally for SSE delivery.
 * The final event is always `turn_complete` (on success) or `error` (on failure).
 *
 * @param signal - AbortSignal from the route handler (budget timeout + client disconnect)
 */
export async function* executePipelineStream(
  request: OrchestratorTurnRequest,
  requestId: string,
  deps: PipelineDeps,
  signal?: AbortSignal,
): AsyncGenerator<OrchestratorStreamEvent> {
  let seq = 0;
  let enrichedContext: EnrichedContext | undefined;

  try {
    // Normalize: fold request-level overrides into context (matches V1 turn-handler behavior).
    // The UI sends analysis/graph via top-level fields after direct_analysis_run or patch_accepted;
    // phase1Enrich only reads context.*, so we must merge here.
    // Top-level fields (analysis_state, graph_state) always represent the latest UI-side state,
    // so they win over potentially stale context fields when both are present.
    log.debug({
      has_top_level_analysis_state: !!request.analysis_state,
      has_context_analysis_response: !!request.context?.analysis_response,
      context_analysis_status: (request.context?.analysis_response as Record<string, unknown> | null)?.analysis_status ?? null,
    }, 'pipeline-stream: analysis normalization input');

    if (request.analysis_state) {
      request.context.analysis_response = normalizeAnalysisEnvelope(request.analysis_state);
    } else if (request.context.analysis_response) {
      request.context.analysis_response = normalizeAnalysisEnvelope(
        request.context.analysis_response as import("../types.js").V2RunResponseEnvelope,
      );
    }
    if (request.graph_state) {
      request.context.graph = request.graph_state;
    }

    // Phase 1: Enrichment (deterministic, <50ms)
    enrichedContext = phase1Enrich(
      request.message,
      request.context,
      request.scenario_id,
      request.system_event,
    );

    const stage = enrichedContext.stage_indicator.stage;

    // System event handling — deterministic routing
    if (request.system_event) {
      yield { type: 'turn_start', seq: seq++, turn_id: enrichedContext.turn_id, routing: 'deterministic', stage };
      if (signal?.aborted) return;

      // System events run through the non-streaming pipeline since they're deterministic
      const { executePipeline } = await import("./pipeline.js");
      const envelope = await executePipeline(request, requestId, deps);
      yield { type: 'turn_complete', seq: seq++, envelope };
      return;
    }

    // Phase 2: Specialist Routing (stub)
    const specialistResult = phase2Route();

    // Analysis lookup — deterministic short-circuit
    const intentGate: IntentGateResult = request.generate_model
      ? { tool: 'draft_graph', routing: 'deterministic', confidence: 'exact', normalised_message: request.message.toLowerCase().trim(), matched_pattern: 'generate_model' }
      : classifyIntent(request.message);
    if (!intentGate.tool) {
      const lookupResult = tryAnalysisLookup(
        request.message,
        enrichedContext.analysis,
        enrichedContext.graph,
      );
      if (lookupResult.matched) {
        yield { type: 'turn_start', seq: seq++, turn_id: enrichedContext.turn_id, routing: 'deterministic', stage };
        const envelope = buildLookupEnvelope(enrichedContext, lookupResult);
        yield { type: 'turn_complete', seq: seq++, envelope };
        return;
      }
    }

    // Phase 3: Prepare for streaming
    const prep = await phase3PrepareForStreaming(
      enrichedContext,
      specialistResult,
      deps.llmClient,
      requestId,
      request.message,
      intentGate,
    );

    if (prep.kind === 'deterministic') {
      yield { type: 'turn_start', seq: seq++, turn_id: enrichedContext.turn_id, routing: 'deterministic', stage };
      if (signal?.aborted) return;

      // Run phase4 + phase5 with the deterministic result
      const toolResult = await phase4Execute(prep.result, enrichedContext, deps.toolDispatcher, requestId);
      const envelope = phase5Validate(prep.result, toolResult, enrichedContext, specialistResult);
      yield { type: 'turn_complete', seq: seq++, envelope };
      return;
    }

    // LLM path — stream text deltas
    yield { type: 'turn_start', seq: seq++, turn_id: enrichedContext.turn_id, routing: 'llm', stage };
    if (signal?.aborted) return;

    let llmResult: LLMResult;

    if (deps.llmClient.streamChatWithTools) {
      // Streaming LLM call
      const streamOpts = { ...prep.callOpts, signal };
      let messageResult: import("../../adapters/llm/types.js").ChatWithToolsResult | undefined;

      for await (const event of deps.llmClient.streamChatWithTools(prep.callArgs, streamOpts)) {
        if (signal?.aborted) return;

        if (event.type === 'text_delta') {
          yield { type: 'text_delta', seq: seq++, delta: event.delta };
        } else if (event.type === 'message_complete') {
          messageResult = event.result;
        }
        // tool_input_start/tool_input_complete are adapter-level events,
        // not surfaced to the client (client sees tool_start from phase4)
      }

      if (!messageResult) {
        throw new Error('Streaming LLM call ended without message_complete event');
      }

      llmResult = prep.postProcess(messageResult);
    } else {
      // Fallback: non-streaming LLM call
      const result = await deps.llmClient.chatWithTools(prep.callArgs, { ...prep.callOpts, signal });
      llmResult = prep.postProcess(result);
    }

    if (signal?.aborted) return;

    // Phase 4: Tool Execution — yield events per tool
    let toolResult: { result: Phase4Result; events: OrchestratorStreamEvent[] } | null;
    try {
      toolResult = await executePhase4WithEvents(
        llmResult,
        enrichedContext,
        deps,
        requestId,
        request.message,
        signal,
        () => seq++,
      );
    } catch (phase4Error) {
      // Wrap tool dispatch errors so mapErrorToStreamEvent can distinguish them
      const wrapped = new ToolDispatchError(
        phase4Error instanceof Error ? phase4Error.message : String(phase4Error),
        { cause: phase4Error },
      );
      throw wrapped;
    }

    if (!toolResult) return; // aborted

    // Yield tool events
    for (const event of toolResult.events) {
      yield event;
    }

    if (signal?.aborted) return;

    // Conversational retry
    if (toolResult.result.needs_conversational_retry) {
      try {
        const conversationalAssembled = await assembleV2SystemPrompt(enrichedContext);
        const conversationalText = await deps.llmClient.chat(
          { system: conversationalAssembled.text, userMessage: request.message },
          { requestId, timeoutMs: 30_000 },
        );
        (toolResult.result as Phase4Result).assistant_text = conversationalText.content;
      } catch {
        (toolResult.result as Phase4Result).assistant_text =
          "I can help answer that. Could you tell me more about what you'd like to know?";
      }
    }

    // Phase 5: Validation + Envelope Assembly
    const envelope = phase5Validate(llmResult, toolResult.result, enrichedContext, specialistResult);
    yield { type: 'turn_complete', seq: seq++, envelope };

  } catch (error) {
    const errorEvent = mapErrorToStreamEvent(error, seq++);
    yield errorEvent;
  }
}

/**
 * Execute phase4 and collect streaming events to yield.
 * Returns the Phase4Result and the events to yield, or null if aborted.
 *
 * Note: phase4Execute runs all tools before returning, so events are emitted
 * post-hoc. tool_start/tool_result pairs bracket each executed tool, and
 * blocks are emitted once (after tool events) to avoid duplication — blocks
 * are aggregated across all tools in Phase4Result and cannot be attributed
 * to individual tools without modifying phase4Execute.
 */
async function executePhase4WithEvents(
  llmResult: LLMResult,
  enrichedContext: EnrichedContext,
  deps: PipelineDeps,
  requestId: string,
  userMessage: string,
  signal: AbortSignal | undefined,
  nextSeq: () => number,
): Promise<{ result: Phase4Result; events: OrchestratorStreamEvent[] } | null> {
  const events: OrchestratorStreamEvent[] = [];

  // Run phase4Execute normally (non-streaming)
  const startTime = Date.now();
  const toolResult = await phase4Execute(llmResult, enrichedContext, deps.toolDispatcher, requestId);

  if (signal?.aborted) return null;

  // Emit tool_start/tool_result per executed tool
  for (const toolName of toolResult.executed_tools) {
    events.push({
      type: 'tool_start',
      seq: nextSeq(),
      tool_name: toolName,
      long_running: LONG_RUNNING_TOOLS.has(toolName),
    });

    events.push({
      type: 'tool_result',
      seq: nextSeq(),
      tool_name: toolName,
      success: !toolResult.stage_fallback_injected,
      duration_ms: toolResult.tool_latency_ms,
    });
  }

  // Emit blocks once — aggregated across all tools, no duplication
  for (const block of toolResult.blocks) {
    events.push({
      type: 'block',
      seq: nextSeq(),
      block,
    });
  }

  return { result: toolResult, events };
}

/**
 * Map an error to a stream error event.
 */
function mapErrorToStreamEvent(error: unknown, seq: number): OrchestratorStreamEvent {
  if (error instanceof UpstreamTimeoutError) {
    return {
      type: 'error',
      seq,
      error: { code: STREAM_ERROR_CODES.LLM_TIMEOUT, message: error.message },
      recoverable: true,
    };
  }

  if (error instanceof UpstreamHTTPError) {
    return {
      type: 'error',
      seq,
      error: { code: STREAM_ERROR_CODES.LLM_ERROR, message: error.message },
      recoverable: false,
    };
  }

  if (error instanceof DailyBudgetExceededError) {
    return {
      type: 'error',
      seq,
      error: { code: 'DAILY_BUDGET_EXCEEDED', message: error.message },
      recoverable: true,
    };
  }

  if (error instanceof ToolDispatchError) {
    return {
      type: 'error',
      seq,
      error: { code: STREAM_ERROR_CODES.TOOL_ERROR, message: 'Tool execution failed.' },
      recoverable: false,
    };
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
    return {
      type: 'error',
      seq,
      error: { code: STREAM_ERROR_CODES.TURN_BUDGET_EXCEEDED, message: 'Turn budget exceeded' },
      recoverable: true,
    };
  }

  return {
    type: 'error',
    seq,
    error: { code: STREAM_ERROR_CODES.PIPELINE_ERROR, message: 'Something went wrong.' },
    recoverable: false,
  };
}
