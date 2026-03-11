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
import type { IntentGateResult } from "../intent-gate.js";
import { classifyUserIntent } from "./phase1-enrichment/intent-classifier.js";
import { tryAnalysisLookup, buildLookupEnvelope } from "../lookup/analysis-lookup.js";
import type { EditGraphTraceDiagnostics } from "../tools/edit-graph.js";
import { isAnalysisCurrent, isAnalysisExplainable, isAnalysisPresent, isAnalysisRunnable } from "../analysis-state.js";
import { config } from "../../config/index.js";

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
      const narrationGraph = request.graph_state ?? updatedEnrichedContext.graph;
      const narrationAnalysis = routerResult.analysisResponse ?? updatedEnrichedContext.analysis;
      const canNarrateResults = (
        routerResult.needsNarration
        && request.message.trim().length > 5
        && isAnalysisExplainable(narrationAnalysis)
        && isAnalysisCurrent(updatedEnrichedContext.stage_indicator.stage, narrationAnalysis)
      );
      if (canNarrateResults) {
        const adapter = getAdapter('orchestrator');
        try {
          const { handleExplainResults } = await import('../tools/explain-results.js');
          const explainContext = {
            graph: narrationGraph,
            analysis_response: narrationAnalysis,
            framing: updatedEnrichedContext.framing,
            messages: updatedEnrichedContext.conversation_history,
            selected_elements: updatedEnrichedContext.selected_elements,
            scenario_id: updatedEnrichedContext.scenario_id,
            analysis_inputs: updatedEnrichedContext.analysis_inputs,
            conversational_state: updatedEnrichedContext.conversational_state,
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
      intentGate,
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
      editGraphDiagnostics: toolResult.edit_graph_diagnostics,
      stageFallbackInjected: toolResult.stage_fallback_injected,
      initialIntentGate: intentGate,
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

export interface TurnTraceInput {
  enrichedContext: EnrichedContext;
  requestId: string;
  request: OrchestratorTurnRequest;
  toolSelected: string | null;
  toolPermitted: boolean;
  toolSuppressedReason: string | null;
  declaredMode: string;
  inferredMode: string;
  envelope: OrchestratorResponseEnvelopeV2;
  /** edit_graph-only diagnostics emitted by the tool handler. */
  editGraphDiagnostics?: EditGraphTraceDiagnostics;
  /** True when Phase 4 injected the stage+tool-aware fallback message. */
  stageFallbackInjected?: boolean;
  initialIntentGate?: IntentGateResult;
}

/**
 * Emit a structured trace log at the end of every V2 pipeline turn.
 * Captures the full diagnostic picture: stage, tools, context, response shape.
 */
function emitTurnTrace(input: TurnTraceInput): void {
  const { enrichedContext: ec, request, envelope } = input;
  const graph = ec.graph;
  const analysis = ec.analysis;
  const analysisRecord = analysis as Record<string, unknown> | null;
  const brief = analysisRecord?.decision_brief;
  const analysisPresent = isAnalysisPresent(analysis);
  const analysisExplainable = isAnalysisExplainable(analysis);
  const analysisCurrent = isAnalysisCurrent(ec.stage_indicator.stage, analysis);
  const analysisRunnable = isAnalysisRunnable({
    graph: ec.graph,
    analysis_response: ec.analysis,
    framing: ec.framing,
    messages: ec.conversation_history,
    selected_elements: ec.selected_elements,
    scenario_id: ec.scenario_id,
    analysis_inputs: ec.analysis_inputs,
    conversational_state: ec.conversational_state,
  });
  const freshTurnIntentRaw = classifyUserIntent(request.message ?? '');
  const initialIntentGate = input.initialIntentGate ?? classifyIntent(request.message ?? '');
  const routeMetadata = envelope._route_metadata ?? null;
  const explainOverrideApplied = routeMetadata?.outcome === 'results_explanation';
  const explainOverrideReason = explainOverrideApplied
    ? routeMetadata?.reasoning ?? 'results_explanation'
    : null;
  const freshTurnIntentEffective = routeMetadata?.outcome === 'rationale_explanation'
    ? 'explain'
    : explainOverrideApplied
      ? 'explain'
      : freshTurnIntentRaw;
  const editTrace = input.toolSelected === 'edit_graph'
    ? (input.editGraphDiagnostics ?? null)
    : null;
  const narrowIntentGuardApplied = (
    editTrace?.classified_intent !== undefined
    && editTrace.classified_intent !== 'structural'
    && (
      editTrace.validation_outcome === 'intent_guard_failed'
      || editTrace.recovery_path_chosen === 'narrow_intent_recovery_question'
    )
  );
  const repeatedFailureEscalationApplied = editTrace?.recovery_path_chosen === 'narrow_intent_recovery_question';
  const structuralOpsProposedAnyway = editTrace?.operations_proposed_types.some((opType) =>
    opType === 'add_node'
    || opType === 'remove_node'
    || opType === 'add_edge'
    || opType === 'remove_edge',
  ) ?? false;
  const effectivePromptComponents = {
    v2_system_prompt: true,
    zone2_structurally_included: true,
    context_fabric_enabled: config.features.contextFabric,
    narrow_edit_instruction_shaping_applied: editTrace?.instruction_mode_applied !== undefined
      ? editTrace.instruction_mode_applied !== 'structural_default'
      : false,
  };
  const editPathSummary = editTrace
    ? `intent=${editTrace.classified_intent};mode=${editTrace.instruction_mode_applied};ops=${editTrace.operations_proposed_count};validation=${editTrace.validation_outcome};recovery=${editTrace.recovery_path_chosen}`
    : null;

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
      has_analysis: analysisPresent,
      analysis_present: analysisPresent,
      analysis_explainable: analysisExplainable,
      analysis_current: analysisCurrent,
      analysis_runnable: analysisRunnable,
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
      route_outcome: routeMetadata?.outcome ?? null,
      route_reasoning: routeMetadata?.reasoning ?? null,
      fresh_turn_intent_raw: freshTurnIntentRaw,
      fresh_turn_intent_effective: freshTurnIntentEffective,
      explain_override_applied: explainOverrideApplied,
      explain_override_reason: explainOverrideReason,
      narrow_intent_guard_applied: narrowIntentGuardApplied,
      repeated_failure_escalation_applied: repeatedFailureEscalationApplied,
      effective_prompt_components: effectivePromptComponents,
      edit_path_summary: editPathSummary,
      classified_intent: editTrace?.classified_intent ?? null,
      instruction_mode_applied: editTrace?.instruction_mode_applied ?? null,
      edit_instruction_preview: editTrace?.edit_instruction_preview ?? null,
      graph_context_node_count: editTrace?.graph_context_node_count ?? null,
      graph_context_edge_count: editTrace?.graph_context_edge_count ?? null,
      operations_proposed_count: editTrace?.operations_proposed_count ?? null,
      operations_proposed_types: editTrace?.operations_proposed_types ?? null,
      structural_ops_proposed_anyway: structuralOpsProposedAnyway,
      validation_outcome: editTrace?.validation_outcome ?? null,
      validation_violation_codes: editTrace?.validation_violation_codes ?? null,
      recovery_path_chosen: editTrace?.recovery_path_chosen ?? null,
      conversational_state_summary: editTrace?.conversational_state_summary ?? null,
      target_resolution: editTrace?.target_resolution ?? null,
      resolution_mode: editTrace?.resolution_mode ?? null,
      proposal_returned: editTrace?.proposal_returned ?? null,
    },
    'orchestrator.turn.trace',
  );
}
