/**
 * V2 Pipeline Orchestrator
 *
 * Thin orchestration layer: Phase 1 → 2 → 3 → 4 → 5.
 * Receives validated request, returns V2 envelope.
 *
 * ~50-80 lines. No shared mutable state. No side effects except
 * Phase 4 (tool execution) and Phase 5 (persistence stubs).
 */

import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { extractDeclaredMode, inferResponseMode } from "../response-parser.js";
import { isToolAllowedAtStage } from "../tools/stage-policy.js";
import type { OrchestratorTurnRequest } from "../types.js";
import type { PipelineDeps, OrchestratorResponseEnvelopeV2, EnrichedContext } from "./types.js";
import { phase1Enrich } from "./phase1-enrichment/index.js";
import { phase2Route } from "./phase2-specialists/index.js";
import { phase3Generate } from "./phase3-llm/index.js";
import { phase4Execute } from "./phase4-tools/index.js";
import { phase5Validate } from "./phase5-validation/index.js";
import { buildErrorEnvelope, resolveContextHash } from "./phase5-validation/envelope-assembler.js";
import { routeSystemEvent, appendSystemMessages } from "../system-event-router.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { classifyIntent } from "../intent-gate.js";
import { tryAnalysisLookup, buildLookupEnvelope } from "../lookup/analysis-lookup.js";

/**
 * Execute the five-phase pipeline.
 *
 * Each phase receives explicitly typed inputs and returns explicitly typed outputs.
 * No shared mutable state between phases.
 *
 * Error handling: if any phase throws, the pipeline catches and returns an error
 * envelope with all new fields populated with defaults.
 */
// Phase inputs are treated as immutable — do not mutate enrichedContext or other phase outputs.
// Each phase receives typed inputs and returns new typed outputs. No shared mutable state.
export async function executePipeline(
  request: OrchestratorTurnRequest,
  requestId: string,
  deps: PipelineDeps,
): Promise<OrchestratorResponseEnvelopeV2> {
  let enrichedContext;

  try {
    // Phase 1: Enrichment (deterministic, <50ms)
    enrichedContext = phase1Enrich(
      request.message,
      request.context,
      request.scenario_id,
      request.system_event,
    );

    // System event handling — deterministic routing, bypasses intent gate entirely
    if (request.system_event) {
      const routerResult = await routeSystemEvent({
        event: request.system_event,
        turnRequest: request,
        turnId: enrichedContext.turn_id,
        requestId,
        plotClient: deps.plotClient ?? null,
        plotOpts: deps.plotOpts,
      });

      // Error from router (e.g. MISSING_GRAPH_STATE) → error envelope
      if (routerResult.error) {
        return buildSystemEventErrorEnvelope(enrichedContext, routerResult.error.code, routerResult.error.message);
      }

      // direct_analysis_run Path B: delegate to run_analysis via regular pipeline
      if (routerResult.delegateToTool === 'run_analysis') {
        // Inject [system] entry into enriched context, then proceed through phases
        const updatedEnrichedContext = injectSystemEntries(enrichedContext, routerResult.systemContextEntries);
        return await runAnalysisViaPipeline(updatedEnrichedContext, deps, requestId, request.system_event);
      }

      // Inject [system] context entries into the enriched conversation history
      const updatedEnrichedContext = injectSystemEntries(enrichedContext, routerResult.systemContextEntries);

      // direct_analysis_run Path A with narration: chain explain_results
      let finalBlocks = routerResult.blocks;
      let finalAssistantText = routerResult.assistantText;
      if (routerResult.needsNarration && request.message.trim().length > 5) {
        const adapter = getAdapter('orchestrator');
        try {
          const { handleExplainResults } = await import('../tools/explain-results.js');
          const explainContext = {
            graph: updatedEnrichedContext.graph,
            analysis_response: routerResult.analysisResponse ?? updatedEnrichedContext.analysis,
            framing: updatedEnrichedContext.framing,
            messages: updatedEnrichedContext.conversation_history,
            selected_elements: updatedEnrichedContext.selected_elements,
            scenario_id: updatedEnrichedContext.scenario_id,
          };
          const explainResult = await handleExplainResults(
            explainContext,
            adapter,
            requestId,
            updatedEnrichedContext.turn_id,
          );
          finalBlocks = [...finalBlocks, ...explainResult.blocks];
          finalAssistantText = explainResult.assistantText;
        } catch {
          // Non-fatal
        }
      }

      // Build a direct V2 ack envelope from router result (skips phases 3-5)
      return buildSystemEventAckEnvelope(
        updatedEnrichedContext,
        finalAssistantText,
        finalBlocks,
        routerResult.guidanceItems,
        request.system_event,
        routerResult.graphHash,
        routerResult.analysisResponse,
      );
    }

    // Phase 2: Specialist Routing (stub)
    const specialistResult = phase2Route();

    // Analysis lookup — deterministic short-circuit for factual analysis queries.
    // Fires AFTER the intent gate (if the gate matched a tool, skip lookup).
    // If matched, returns a minimal V2 envelope and skips the LLM call entirely.
    const intentGate = classifyIntent(request.message);
    if (!intentGate.tool) {
      const lookupResult = tryAnalysisLookup(
        request.message,
        enrichedContext.analysis,
        enrichedContext.graph,
      );
      if (lookupResult.matched) {
        log.info(
          { request_id: requestId, pattern: lookupResult.pattern },
          "V2 pipeline: analysis lookup matched — skipping LLM",
        );
        return buildLookupEnvelope(enrichedContext, lookupResult);
      }
    }

    // Phase 3: LLM Call (or deterministic routing)
    const llmResult = await phase3Generate(
      enrichedContext,
      specialistResult,
      deps.llmClient,
      requestId,
      request.message,
    );

    // V2 mode consistency telemetry
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
      });
    }

    // Phase 4: Tool Execution
    const toolResult = await phase4Execute(
      llmResult,
      enrichedContext,
      deps.toolDispatcher,
      requestId,
    );

    // Phase 5: Validation + Envelope Assembly
    const envelope = phase5Validate(
      llmResult,
      toolResult,
      enrichedContext,
      specialistResult,
    );

    // Per-turn diagnostic trace (Task 1)
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
      stageFallbackInjected: toolResult.stage_fallback_injected,
    });

    return envelope;
  } catch (error) {
    const turnId = enrichedContext?.turn_id ?? 'pipeline-error';
    const message = error instanceof Error ? error.message : String(error);

    log.error(
      { error: message, turn_id: turnId, request_id: requestId },
      "V2 pipeline error",
    );

    return buildErrorEnvelope(
      turnId,
      'PIPELINE_ERROR',
      'Something went wrong.',
      enrichedContext,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a silent acknowledgement envelope for feedback_submitted events.
 *
 * System prompt contract: "feedback_submitted → Do not respond."
 * Returns a minimal envelope: null assistant_text, empty blocks, empty actions.
 * No LLM call is made.
 */
function buildFeedbackAckEnvelope(enrichedContext: EnrichedContext): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: enrichedContext.turn_id,
    assistant_text: null,
    blocks: [],
    suggested_actions: [],

    lineage: {
      context_hash: resolveContextHash(enrichedContext),
      dsk_version_hash: enrichedContext.dsk.version_hash,
    },

    stage_indicator: {
      stage: enrichedContext.stage_indicator.stage,
      confidence: enrichedContext.stage_indicator.confidence,
      source: enrichedContext.stage_indicator.source,
    },

    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },

    progress_marker: {
      kind: 'none',
    },

    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'deterministic',
      long_running: false,
    },

    guidance_items: [],
  };
}

/**
 * Inject [system] sentinel strings into the enriched context's conversation history.
 * Returns a new EnrichedContext — does not mutate the input.
 */
function injectSystemEntries(enrichedContext: EnrichedContext, entries: string[]): EnrichedContext {
  if (entries.length === 0) return enrichedContext;
  const updatedHistory = appendSystemMessages(enrichedContext.conversation_history, entries);
  return {
    ...enrichedContext,
    conversation_history: updatedHistory,
    messages: appendSystemMessages(enrichedContext.messages ?? [], entries),
  };
}

/**
 * Build a V2 envelope for system events that produced structured outputs.
 *
 * Silent envelope invariant: assistant_text is always string | null (never omitted).
 */
function buildSystemEventAckEnvelope(
  enrichedContext: EnrichedContext,
  assistantText: string | null,
  blocks: import("../types.js").ConversationBlock[],
  guidanceItems: import("../types/guidance-item.js").GuidanceItem[],
  event: import("../types.js").SystemEvent,
  graphHash?: string,
  analysisResponse?: import("../types.js").V2RunResponseEnvelope,
): OrchestratorResponseEnvelopeV2 {
  const lineage: OrchestratorResponseEnvelopeV2['lineage'] = {
    context_hash: resolveContextHash(enrichedContext),
    dsk_version_hash: enrichedContext.dsk.version_hash,
  };

  if (analysisResponse) {
    lineage.response_hash = analysisResponse.response_hash ?? analysisResponse.meta?.response_hash;
  }

  if (graphHash) {
    (lineage as Record<string, unknown>).graph_hash = graphHash;
  }

  return {
    turn_id: enrichedContext.turn_id,
    assistant_text: assistantText,
    blocks,
    suggested_actions: [],

    lineage,

    stage_indicator: {
      stage: enrichedContext.stage_indicator.stage,
      confidence: enrichedContext.stage_indicator.confidence,
      source: enrichedContext.stage_indicator.source,
    },

    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },

    progress_marker: {
      kind: analysisResponse ? 'ran_analysis' : 'none',
    },

    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'deterministic',
      long_running: false,
      system_event: { type: event.event_type, event_id: event.event_id },
    },

    guidance_items: guidanceItems,
  };
}

/**
 * Build a V2 error envelope for system event router errors (e.g. MISSING_GRAPH_STATE).
 */
function buildSystemEventErrorEnvelope(
  enrichedContext: EnrichedContext,
  code: string,
  message: string,
): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: enrichedContext.turn_id,
    assistant_text: null,
    blocks: [],
    suggested_actions: [],

    lineage: {
      context_hash: resolveContextHash(enrichedContext),
      dsk_version_hash: enrichedContext.dsk.version_hash,
    },

    stage_indicator: {
      stage: enrichedContext.stage_indicator.stage,
      confidence: enrichedContext.stage_indicator.confidence,
      source: enrichedContext.stage_indicator.source,
    },

    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },

    progress_marker: { kind: 'none' },

    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'deterministic',
      long_running: false,
    },

    guidance_items: [],

    error: { code, message },
  };
}

/**
 * Run the analysis via the regular pipeline (direct_analysis_run Path B).
 * Uses Phase 4 (run_analysis tool dispatch) and Phase 5 (envelope assembly).
 *
 * Path equivalence guarantee: same code path as "run the analysis" message.
 */
async function runAnalysisViaPipeline(
  enrichedContext: EnrichedContext,
  deps: PipelineDeps,
  requestId: string,
  event: import("../types.js").SystemEvent,
): Promise<OrchestratorResponseEnvelopeV2> {
  const specialistResult = phase2Route();

  // Synthetic deterministic LLM result: route directly to run_analysis
  const llmResult: import("./types.js").LLMResult = {
    assistant_text: null,
    tool_invocations: [{ name: 'run_analysis', input: {}, id: 'deterministic' }],
    science_annotations: [],
    raw_response: '',
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
  };

  const toolResult = await phase4Execute(llmResult, enrichedContext, deps.toolDispatcher, requestId);

  // Add system_event to turn_plan
  const envelope = phase5Validate(llmResult, toolResult, enrichedContext, specialistResult);
  envelope.turn_plan = {
    ...envelope.turn_plan,
    system_event: { type: event.event_type, event_id: event.event_id },
  };

  return envelope;
}

// ============================================================================
// Per-turn Diagnostic Trace (Task 1)
// ============================================================================

interface TurnTraceInput {
  enrichedContext: EnrichedContext;
  requestId: string;
  request: OrchestratorTurnRequest;
  toolSelected: string | null;
  toolPermitted: boolean;
  toolSuppressedReason: string | null;
  declaredMode: string;
  inferredMode: string;
  envelope: OrchestratorResponseEnvelopeV2;
  /** True when Phase 4 injected the stage+tool-aware fallback message. */
  stageFallbackInjected?: boolean;
}

/**
 * Emit a structured trace log at the end of every V2 pipeline turn.
 * Captures the full diagnostic picture: stage, tools, context, response shape.
 */
function emitTurnTrace(input: TurnTraceInput): void {
  const { enrichedContext: ec, request, envelope } = input;
  const graph = ec.graph;
  const analysis = ec.analysis as Record<string, unknown> | null;
  const brief = analysis?.decision_brief;

  log.info(
    {
      event: 'orchestrator.turn.trace',
      turn_id: ec.turn_id,
      request_id: input.requestId,
      scenario_id: ec.scenario_id,
      user_message_preview: (request.message ?? '').slice(0, 80),
      stage_from_ui: request.context.framing?.stage ?? null,
      stage_inferred: ec.stage_indicator.stage,
      has_graph: graph != null && (graph.nodes?.length ?? 0) > 0,
      graph_node_count: graph?.nodes?.length ?? 0,
      has_analysis: analysis != null,
      has_brief: brief != null,
      brief_length: typeof brief === 'string' ? brief.length : brief ? JSON.stringify(brief).length : 0,
      conversation_turns: ec.conversation_history?.length ?? 0,
      tool_selected: input.toolSelected,
      tool_permitted: input.toolPermitted,
      tool_suppressed_reason: input.toolSuppressedReason,
      response_mode_declared: input.declaredMode,
      response_mode_inferred: input.inferredMode,
      assistant_text_length: envelope.assistant_text?.length ?? 0,
      blocks_count: envelope.blocks.length,
      chips_count: envelope.suggested_actions.length,
      fallback_injected: input.stageFallbackInjected ?? false,
      contract_violations: envelope._contract_violation_codes ?? [],
    },
    'orchestrator.turn.trace',
  );
}
