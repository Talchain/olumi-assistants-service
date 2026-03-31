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
  TypedConversationBlock,
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
import { classifyIntent, classifyIntentWithContext } from "../intent-gate.js";
import type { IntentGateResult } from "../intent-gate.js";
import { isLongRunningTool } from "../tools/registry.js";
import { config } from "../../config/index.js";
import { tryAnalysisLookup, buildLookupEnvelope } from "../lookup/analysis-lookup.js";
import type { OrchestratorStreamEvent } from "./stream-events.js";
import { STREAM_ERROR_CODES } from "./stream-events.js";
import { StreamingEnvelopeStripper } from "./streaming-xml-stripper.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "../../adapters/llm/errors.js";
import { DailyBudgetExceededError } from "../../adapters/llm/errors.js";
import { normalizeAnalysisEnvelope } from "../analysis-state.js";
import { emitTurnTrace, attachDiagnosticTrace } from "./pipeline.js";

// Human-readable progress messages for long-running tools.
// Falls back to DEFAULT_PROGRESS_MESSAGE for unknown tools.
const PROGRESS_MESSAGES: Record<string, string> = {
  draft_graph: 'Building decision model\u2026',
  run_analysis: 'Running analysis\u2026',
};
const DEFAULT_PROGRESS_MESSAGE = 'Processing\u2026';
const PROGRESS_INTERVAL_MS = 5_000;

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

    // ── Deterministic intelligence pipeline (feature-flagged) ───────────────
    // When enabled, the three-layer deterministic pipeline replaces the V2 XML
    // pipeline. Text streams progressively via StreamingTextExtractor; blocks
    // and turn_complete are emitted after the full response is assembled.
    if (config.features.deterministicOrchestratorEnabled && !config.features.legacyOrchestratorEnabled) {
      const { executeDeterministicPipelineStreaming } = await import("../deterministic/pipeline.js");

      for await (const event of executeDeterministicPipelineStreaming(request, requestId, signal)) {
        yield { ...event, seq: seq++ };
        if (signal?.aborted) return;
      }
      return;
    }

    // Phase 2: Specialist Routing (stub)
    const specialistResult = phase2Route();

    // Analysis lookup — deterministic short-circuit
    const intentGate: IntentGateResult = request.generate_model
      ? { tool: 'draft_graph', routing: 'deterministic', confidence: 'exact', normalised_message: request.message.toLowerCase().trim(), matched_pattern: 'generate_model' }
      : config.features.briefDetectionEnabled
        ? classifyIntentWithContext(request.message, {
            hasGraph: enrichedContext.graph != null,
            graphNodeLabels: enrichedContext.graph?.nodes?.map((n) => n.label ?? '') ?? [],
            deterministicRoutingV2: config.features.deterministicRoutingV2,
          })
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
        attachDiagnosticTrace(envelope, { enrichedContext, streaming: true });
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
      attachDiagnosticTrace(envelope, {
        enrichedContext,
        llmResult: prep.result,
        toolResult,
        streaming: true,
      });
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

      // Strip XML envelope tags from text deltas before emitting to the client.
      // The full XML parsing still happens on message_complete via prep.postProcess().
      const xmlStripper = new StreamingEnvelopeStripper();

      try {
        for await (const event of deps.llmClient.streamChatWithTools(prep.callArgs, streamOpts)) {
          if (signal?.aborted) return;

          if (event.type === 'text_delta') {
            const clean = xmlStripper.process(event.delta);
            if (clean) {
              yield { type: 'text_delta', seq: seq++, delta: clean };
            }
          } else if (event.type === 'message_complete') {
            // Flush any remaining buffered text from the stripper
            const remaining = xmlStripper.flush();
            if (remaining) {
              yield { type: 'text_delta', seq: seq++, delta: remaining };
            }
            messageResult = event.result;
          }
          // tool_input_start/tool_input_complete are adapter-level events,
          // not surfaced to the client (client sees tool_start from phase4)
        }
      } finally {
        // Ensure any buffered text is emitted even if the stream errors or aborts.
        // This prevents partial suppression state from silently discarding user-visible text.
        if (!messageResult) {
          const remaining = xmlStripper.flush();
          if (remaining) {
            yield { type: 'text_delta', seq: seq++, delta: remaining };
          }
        }
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

    // V2 mode consistency telemetry (P0-1 Task 1: streaming parity)
    const v2DeclaredMode = extractDeclaredMode(llmResult.diagnostics);
    const v2InferredMode = llmResult.tool_invocations.length > 0
      ? 'ACT' as const
      : inferResponseMode({ assistant_text: llmResult.assistant_text, tool_invocations: llmResult.tool_invocations } as never);
    const v2ToolAttempted = llmResult.tool_invocations[0]?.name ?? null;
    const v2ToolPermitted = v2ToolAttempted
      ? isToolAllowedAtStage(v2ToolAttempted, enrichedContext.stage_indicator.stage, request.message).allowed
      : true;
    const v2ModeDisagreement = v2DeclaredMode !== 'unknown' && v2DeclaredMode !== v2InferredMode;

    log.info(
      {
        response_mode_declared: v2DeclaredMode,
        response_mode_inferred: v2InferredMode,
        tool_selected: v2ToolAttempted,
        tool_permitted: v2ToolPermitted,
        stage: enrichedContext.stage_indicator.stage,
        mode_disagreement: v2ModeDisagreement,
      },
      'orchestrator.v2.turn.telemetry',
    );

    if (v2ModeDisagreement) {
      emit(TelemetryEvents.OrchestratorModeDisagreement, {
        declared: v2DeclaredMode,
        inferred: v2InferredMode,
        tool_selected: v2ToolAttempted,
        stage: enrichedContext.stage_indicator.stage,
        scenario_id: enrichedContext.scenario_id,
        pipeline: 'v2',
        streaming: true,
      });
    }

    // Phase 4: Tool Execution — yield events per tool with live progress
    //
    // resultHolder passes the Phase4Result back from the async generator.
    // Async generators can only yield values; they cannot return a result to
    // the caller through `yield*`. The holder is a mutable container that the
    // generator assigns before its final yield.
    const phase4ResultHolder: { result: Phase4Result | null } = { result: null };
    try {
      yield* executePhase4WithEvents(
        llmResult,
        enrichedContext,
        deps,
        requestId,
        request.message,
        signal,
        () => seq++,
        phase4ResultHolder,
      );
    } catch (phase4Error) {
      // Wrap tool dispatch errors so mapErrorToStreamEvent can distinguish them
      const wrapped = new ToolDispatchError(
        phase4Error instanceof Error ? phase4Error.message : String(phase4Error),
        { cause: phase4Error },
      );
      throw wrapped;
    }

    if (!phase4ResultHolder.result) return; // aborted
    const toolResult = { result: phase4ResultHolder.result };

    if (signal?.aborted) return;

    // Conversational retry (P0-1 Task 3: streaming retry metadata propagation)
    if (toolResult.result.needs_conversational_retry) {
      try {
        const conversationalAssembled = await assembleV2SystemPrompt(enrichedContext);
        const conversationalText = await deps.llmClient.chat(
          { system: conversationalAssembled.text, userMessage: request.message },
          { requestId, timeoutMs: 30_000 },
        );
        const retryModelInfo = deps.llmClient.getResolvedModel?.() ?? null;
        log.info(
          {
            request_id: requestId,
            task: 'orchestrator_conversational_retry',
            resolved_model: retryModelInfo?.model ?? null,
            resolved_provider: retryModelInfo?.provider ?? null,
          },
          'pipeline_stream.conversational_retry.resolved_model',
        );
        (toolResult.result as Phase4Result).assistant_text = conversationalText.content;
        if (retryModelInfo) {
          (toolResult.result as Phase4Result).route_metadata = {
            outcome: 'default_llm',
            reasoning: 'conversational_retry',
            resolved_model: retryModelInfo.model,
            resolved_provider: retryModelInfo.provider,
          };
        }
      } catch (err) {
        log.warn({ request_id: requestId, err }, 'pipeline-stream: conversational retry failed — using fallback text');
        (toolResult.result as Phase4Result).assistant_text =
          "I can help answer that. Could you tell me more about what you'd like to know?";
      }
    }

    // Phase 5: Validation + Envelope Assembly
    const envelope = phase5Validate(llmResult, toolResult.result, enrichedContext, specialistResult);

    // Per-turn diagnostic trace (P0-1 Task 2: streaming turn trace parity)
    emitTurnTrace({
      enrichedContext,
      requestId,
      request,
      toolSelected: v2ToolAttempted,
      toolPermitted: v2ToolPermitted,
      toolSuppressedReason: !v2ToolPermitted && v2ToolAttempted
        ? `${v2ToolAttempted} not allowed at stage '${enrichedContext.stage_indicator.stage}'`
        : null,
      declaredMode: v2DeclaredMode,
      inferredMode: v2InferredMode,
      envelope,
      stageFallbackInjected: toolResult.result.stage_fallback_injected,
      initialIntentGate: intentGate,
      llmRouteDebug: llmResult.route_debug,
      pendingClarification: toolResult.result.pending_clarification,
      pendingProposal: toolResult.result.pending_proposal,
    });

    // Diagnostic trace — attach to envelope when feature flag is enabled
    attachDiagnosticTrace(envelope, {
      enrichedContext,
      llmResult,
      toolResult: toolResult.result,
      streaming: true,
    });

    yield { type: 'turn_complete', seq: seq++, envelope };

  } catch (error) {
    // Yield immediate error event for fast client feedback (backward compatible)
    const errorEvent = mapErrorToStreamEvent(error, seq++);
    yield errorEvent;

    // Build error envelope with diagnostic trace (parity with non-streaming pipeline.ts).
    // Wrapped in try-catch: error event above is the critical path; envelope is additive.
    try {
      const turnId = enrichedContext?.turn_id ?? 'pipeline-stream-error';
      const errMessage = error instanceof Error ? error.message : String(error);

      // Unwrap ToolDispatchError to access the original error's properties.
      // ToolDispatchError wraps the original error in `cause` (line 258-261) but doesn't
      // forward orchestratorError/toolLLMTelemetry. Traverse the cause chain to find them.
      const rootError = (error instanceof ToolDispatchError && error.cause)
        ? error.cause
        : error;

      // Extract typed error from tool dispatch / LLM errors (same as pipeline.ts lines 476-480)
      const orchError = (rootError != null && typeof rootError === 'object' && 'orchestratorError' in rootError)
        ? (rootError as { orchestratorError: { code?: string; message?: string; recoverable?: boolean } }).orchestratorError
        : undefined;
      const errorCode = orchError?.code ?? 'PIPELINE_ERROR';
      const userMsg = orchError?.message ?? 'Something went wrong.';

      const errorEnvelope = buildErrorEnvelope(
        turnId,
        errorCode,
        userMsg,
        enrichedContext,
      );

      // Extract upstream HTTP status — check both wrapper and root cause
      const statusSource = (rootError != null && typeof rootError === 'object' && 'status' in rootError && typeof (rootError as Record<string, unknown>).status === 'number')
        ? rootError
        : (error != null && typeof error === 'object' && 'status' in error && typeof (error as Record<string, unknown>).status === 'number')
          ? error
          : null;
      const upstreamStatus = statusSource ? (statusSource as { status: number }).status : 500;

      // Extract tool-level telemetry — check both wrapper and root cause
      const thrownToolTelemetry = (rootError != null && typeof rootError === 'object' && 'toolLLMTelemetry' in rootError)
        ? (rootError as { toolLLMTelemetry?: import("./types.js").ToolResult['_tool_llm_telemetry'] }).toolLLMTelemetry
        : (error != null && typeof error === 'object' && 'toolLLMTelemetry' in error)
          ? (error as { toolLLMTelemetry?: import("./types.js").ToolResult['_tool_llm_telemetry'] }).toolLLMTelemetry
          : undefined;

      attachDiagnosticTrace(errorEnvelope, {
        enrichedContext: enrichedContext ?? undefined,
        error: { status: upstreamStatus, type: errorCode, message: errMessage },
        streaming: true,
        ...(thrownToolTelemetry && {
          toolResult: { _tool_llm_telemetry: thrownToolTelemetry } as import("./types.js").ToolResult,
        }),
      });

      // Yield turn_complete with error envelope — carries _diagnostic_trace for observability
      yield { type: 'turn_complete', seq: seq++, envelope: errorEnvelope };
    } catch (envelopeErr) {
      log.warn({ err: envelopeErr }, 'pipeline-stream: failed to build error envelope for diagnostic trace');
    }
  }
}

/**
 * Execute phase4 as an async generator that yields streaming events in real-time.
 *
 * Emits tool_start BEFORE execution begins, progress events every 5s during
 * execution, then tool_result and block events once execution completes.
 *
 * The Phase4Result is passed back via `resultHolder` because async generators
 * can only yield values — `yield*` does not propagate the generator's return
 * value to the delegating generator.
 *
 * The progress interval is explicitly cleared on every exit path (completion,
 * error, abort) to prevent leaked timers after the stream closes.
 */
async function* executePhase4WithEvents(
  llmResult: LLMResult,
  enrichedContext: EnrichedContext,
  deps: PipelineDeps,
  requestId: string,
  userMessage: string,
  signal: AbortSignal | undefined,
  nextSeq: () => number,
  resultHolder: { result: Phase4Result | null },
): AsyncGenerator<OrchestratorStreamEvent> {
  // Pre-compute which tool will be the primary (long-running) tool.
  // Mirrors the reorder logic in phase4-tools/index.ts:90-97.
  const longRunning = llmResult.tool_invocations.filter(t => isLongRunningTool(t.name));
  const lightweight = llmResult.tool_invocations.filter(t => !isLongRunningTool(t.name));
  const primaryTool = longRunning[0]?.name ?? lightweight[0]?.name ?? null;

  // Yield tool_start for the primary tool BEFORE execution begins
  if (primaryTool) {
    yield {
      type: 'tool_start',
      seq: nextSeq(),
      tool_name: primaryTool,
      long_running: isLongRunningTool(primaryTool),
    };
  }

  const startTime = Date.now();
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  // Collects progress events emitted by the interval timer.
  // The timer cannot yield directly (it runs outside the generator), so events
  // are buffered here and drained after each Promise.race tick.
  const pendingProgress: OrchestratorStreamEvent[] = [];

  try {
    let phase4Done = false;
    let toolResult: Phase4Result | undefined;

    const phase4Promise = phase4Execute(
      llmResult, enrichedContext, deps.toolDispatcher, requestId,
    ).then(result => {
      phase4Done = true;
      toolResult = result;
      return result;
    });

    // Start the progress interval — pushes events into pendingProgress
    if (primaryTool) {
      progressTimer = setInterval(() => {
        if (!phase4Done) {
          pendingProgress.push({
            type: 'progress',
            seq: nextSeq(),
            tool_name: primaryTool,
            elapsed_ms: Date.now() - startTime,
            message: PROGRESS_MESSAGES[primaryTool] ?? DEFAULT_PROGRESS_MESSAGE,
          });
        }
      }, PROGRESS_INTERVAL_MS);
    }

    // Poll: race phase4 completion against progress ticks
    while (!phase4Done) {
      const tick = new Promise<'tick'>(resolve =>
        setTimeout(() => resolve('tick'), PROGRESS_INTERVAL_MS),
      );

      await Promise.race([phase4Promise, tick]);

      if (signal?.aborted) {
        resultHolder.result = null;
        return;
      }

      // Drain any pending progress events
      while (pendingProgress.length > 0) {
        yield pendingProgress.shift()!;
      }
    }

    // Ensure we have the result
    if (!toolResult) {
      toolResult = await phase4Promise;
    }

    if (signal?.aborted) {
      resultHolder.result = null;
      return;
    }

    // Yield tool_result for the primary tool
    if (primaryTool && toolResult.executed_tools.includes(primaryTool)) {
      yield {
        type: 'tool_result',
        seq: nextSeq(),
        tool_name: primaryTool,
        success: !toolResult.stage_fallback_injected,
        duration_ms: toolResult.tool_latency_ms,
      };
    }

    // Yield tool_start/tool_result for additional executed tools
    for (const toolName of toolResult.executed_tools) {
      if (toolName === primaryTool) continue;
      yield {
        type: 'tool_start',
        seq: nextSeq(),
        tool_name: toolName,
        long_running: isLongRunningTool(toolName),
      };
      yield {
        type: 'tool_result',
        seq: nextSeq(),
        tool_name: toolName,
        success: !toolResult.stage_fallback_injected,
      };
    }

    // Yield blocks — aggregated across all tools
    for (const block of toolResult.blocks) {
      yield { type: 'block', seq: nextSeq(), block };
    }

    resultHolder.result = toolResult;
  } finally {
    // Clean up progress timer on ALL exit paths (completion, error, abort)
    if (progressTimer !== null) {
      clearInterval(progressTimer);
    }
  }
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
