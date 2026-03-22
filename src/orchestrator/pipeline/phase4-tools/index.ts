/**
 * Phase 4: Tool Execution
 *
 * Dispatches tool invocations to the existing tool handler infrastructure.
 * Does not duplicate tool handler code — uses shared dispatch module.
 *
 * Long-running guard: at most one long-running tool (draft_graph, run_analysis)
 * per turn. Invocations are reordered so long-running tools always execute
 * before lightweight follow-ups — this prevents out-of-order LLM responses
 * from running explain_results before run_analysis completes.
 *
 * Context carry-forward: after each tool executes, analysis_response and
 * graph are updated from the result so follow-up tools see fresh state.
 *
 * If the LLM returns more than one long-running tool, only the first executes.
 * Additional long-running tools are deferred with a deterministic note.
 */

import type {
  EnrichedContext,
  LLMResult,
  ToolResult,
  ToolDispatcher,
  ConversationContext,
} from "../types.js";
import { getStageAwareFallbackEntry } from "../../validation/stage-fallbacks.js";
import { dispatchToolHandler } from "../../tools/dispatch.js";
import type { ToolDispatchOpts } from "../../tools/dispatch.js";
import { isLongRunningTool } from "../../tools/registry.js";
import { isToolAllowedAtStage } from "../../tools/stage-policy.js";
import { log, emit, TelemetryEvents } from "../../../utils/telemetry.js";
import type { FastifyRequest } from "fastify";
import type { PLoTClientRunOpts } from "../../plot-client.js";

// ============================================================================
// Execution result shape extended with multi-tool tracking
// ============================================================================

export interface Phase4Result extends ToolResult {
  /** Tools that executed this turn, in execution order. */
  executed_tools: string[];
  /** Long-running tools deferred because one already ran this turn. */
  deferred_tools: string[];
  /** True when the stage+tool-aware fallback message was injected (all tools suppressed, no LLM text). */
  stage_fallback_injected?: boolean;
  /**
   * True when run_analysis was suppressed but the user's intent is conversational/explain (not act).
   * Pipeline should retry with a plain conversational LLM call instead of showing the stage fallback.
   */
  needs_conversational_retry?: boolean;
  /** Name of the suppressed tool that triggered needs_conversational_retry. */
  suppressed_tool_for_retry?: string;
}

/**
 * Phase 4 entry point: execute tool invocations.
 *
 * If no tool invocations → return empty result (no side effects).
 * If tools present:
 *   1. Reorder so long-running tool comes first (stable, LLM-order-independent).
 *   2. Execute the long-running tool (if any), then all lightweight follow-ups.
 *   3. Skip any additional long-running tools with a deferred note.
 *   4. Carry forward analysis_response and graph into each subsequent context.
 */
export async function phase4Execute(
  llmResult: LLMResult,
  enrichedContext: EnrichedContext,
  toolDispatcher: ToolDispatcher,
  requestId: string,
): Promise<Phase4Result> {
  // No tool invocations → pure conversation
  if (llmResult.tool_invocations.length === 0) {
    return {
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: llmResult.assistant_text,
      guidance_items: [],
      executed_tools: [],
      deferred_tools: [],
      ...(llmResult.route_metadata && { route_metadata: llmResult.route_metadata }),
    };
  }

  // Stable reorder: long-running first, lightweight after.
  // Within each group, preserve original LLM order.
  const longRunning = llmResult.tool_invocations.filter(t => isLongRunningTool(t.name));
  const lightweight = llmResult.tool_invocations.filter(t => !isLongRunningTool(t.name));

  // Only the first long-running tool executes; extras are deferred.
  const toExecute = [
    ...(longRunning.length > 0 ? [longRunning[0]] : []),
    ...lightweight,
  ];
  const deferred = longRunning.slice(1);

  // Build mutable context — will be updated after each tool result.
  // Includes all accumulated decision context (brief, constraints, event log)
  // so every tool sees the full picture.
  let currentContext: ConversationContext = {
    graph: enrichedContext.graph,
    analysis_response: enrichedContext.analysis,
    framing: enrichedContext.framing,
    messages: enrichedContext.conversation_history,
    event_log_summary: enrichedContext.event_log_summary,
    selected_elements: enrichedContext.selected_elements,
    scenario_id: enrichedContext.scenario_id,
    analysis_inputs: enrichedContext.analysis_inputs,
    conversational_state: enrichedContext.conversational_state,
  };

  const allBlocks: ToolResult['blocks'] = [];
  const sideEffects: ToolResult['side_effects'] = {
    graph_updated: false,
    analysis_ran: false,
    brief_generated: false,
  };
  const allGuidanceItems: ToolResult['guidance_items'] = [];
  const allSuggestedActions: ToolResult['suggested_actions'] = [];
  let assistantText: string | null = llmResult.assistant_text;
  let analysisResponse: ToolResult['analysis_response'];
  let toolLatencyMs: number | undefined;
  const executedTools: string[] = [];
  let stageFallbackInjected = false;
  let editGraphDiagnostics: ToolResult['edit_graph_diagnostics'];
  let pendingClarification: ToolResult['pending_clarification'];
  let pendingProposal: ToolResult['pending_proposal'];
  let proposedChanges: ToolResult['proposed_changes'];
  let routeMetadata = llmResult.route_metadata;
  let appliedChanges: ToolResult['applied_changes'];
  let deterministicAnswerTier: ToolResult['deterministic_answer_tier'];

  for (const invocation of toExecute) {
    // Stage policy guard — skip tool if not allowed at current stage
    const stageGuard = isToolAllowedAtStage(
      invocation.name,
      enrichedContext.stage_indicator.stage,
      enrichedContext.user_message,
    );
    if (!stageGuard.allowed) {
      log.info(
        { stage: enrichedContext.stage_indicator.stage, tool_attempted: invocation.name, reason: stageGuard.reason },
        'Phase 4: stage policy suppressed tool invocation',
      );
      emit(TelemetryEvents.OrchestratorToolSuppressed, {
        tool_attempted: invocation.name,
        stage: enrichedContext.stage_indicator.stage,
        scenario_id: enrichedContext.scenario_id,
        turn_id: enrichedContext.turn_id,
        pipeline: 'v2',
      });
      continue;
    }

    const result = await toolDispatcher.dispatch(
      invocation.name,
      invocation.input,
      currentContext,
      enrichedContext.turn_id,
      requestId,
      { intentClassification: enrichedContext.intent_classification },
    );

    allBlocks.push(...result.blocks);
    allGuidanceItems.push(...(result.guidance_items ?? []));
    if (result.suggested_actions && result.suggested_actions.length > 0) {
      allSuggestedActions.push(...result.suggested_actions);
    }
    executedTools.push(invocation.name);

    if (result.assistant_text) {
      assistantText = assistantText
        ? `${assistantText}\n\n${result.assistant_text}`
        : result.assistant_text;
    }
    if (result.analysis_response) {
      analysisResponse = result.analysis_response;
      // Carry forward: follow-up tools see the fresh analysis
      currentContext = { ...currentContext, analysis_response: result.analysis_response };
    }
    if (result.tool_latency_ms !== undefined) {
      toolLatencyMs = (toolLatencyMs ?? 0) + result.tool_latency_ms;
    }
    if (invocation.name === 'edit_graph' && result.edit_graph_diagnostics) {
      editGraphDiagnostics = result.edit_graph_diagnostics;
    }
    if (result.pending_clarification) {
      pendingClarification = result.pending_clarification;
    }
    if (result.pending_proposal) {
      pendingProposal = result.pending_proposal;
    }
    if (result.proposed_changes) {
      proposedChanges = result.proposed_changes;
    }
    if (result.route_metadata) {
      routeMetadata = result.route_metadata;
    }
    if (result.applied_changes) {
      appliedChanges = result.applied_changes;
    }
    if (result.deterministic_answer_tier !== undefined) {
      deterministicAnswerTier = result.deterministic_answer_tier;
    }

    // Accumulate side effects from the actual tool result, not the tool name.
    // This preserves the distinction between a successful model mutation and a
    // clarification/proposal-only edit_graph turn.
    sideEffects.graph_updated = sideEffects.graph_updated || result.side_effects.graph_updated;
    sideEffects.analysis_ran = sideEffects.analysis_ran || result.side_effects.analysis_ran;
    sideEffects.brief_generated = sideEffects.brief_generated || result.side_effects.brief_generated;
  }

  // Guaranteed fallback: all tools suppressed + blank/null LLM text → never emit silent response.
  // Check after the loop so we only fire when nothing executed AND there is no usable text.
  const allToolsSuppressed = toExecute.length > 0 && executedTools.length === 0;
  let needsConversationalRetry = false;
  let suppressedToolForRetry: string | undefined;
  if (allToolsSuppressed && !assistantText?.trim()) {
    const suppressedTool = toExecute[0]?.name;

    // Prerequisite-aware suppression: if the suppressed tool is run_analysis but the user did
    // not explicitly request an action (act classification), signal the pipeline to retry with
    // a plain conversational call. This covers: conversational ("what does X mean?"),
    // explain ("why is Y high?"), recommend ("which option is better?") — none contain
    // explicit action verbs like "run", "analyse", "add". Only act intent (e.g. "Run the
    // analysis") means the user explicitly requested analysis → preserve the prerequisite fallback.
    const intent = enrichedContext.intent_classification;
    const isNotExplicitAction = intent !== 'act';
    if (suppressedTool === 'run_analysis' && isNotExplicitAction) {
      needsConversationalRetry = true;
      suppressedToolForRetry = suppressedTool;
      log.info(
        {
          stage: enrichedContext.stage_indicator.stage,
          suppressed_tool: suppressedTool,
          intent,
          turn_id: enrichedContext.turn_id,
        },
        'Phase 4: run_analysis suppressed for non-action intent — signalling conversational retry',
      );
    } else {
      const fallbackEntry = getStageAwareFallbackEntry(enrichedContext.stage_indicator.stage, suppressedTool);
      assistantText = fallbackEntry.message;
      stageFallbackInjected = true;
      // Inject actionable chip so the user has an obvious next step
      allGuidanceItems.length = 0; // clear any stale guidance
      allSuggestedActions.push(fallbackEntry.chip);
      log.info(
        { stage: enrichedContext.stage_indicator.stage, suppressed_tool: suppressedTool, turn_id: enrichedContext.turn_id },
        'Phase 4: all tools suppressed with no LLM text — stage+tool-aware fallback injected',
      );
    }
  }

  // Append deferred note if any long-running tools were skipped
  if (deferred.length > 0) {
    const toolList = deferred.map(t => t.name).join(', ');
    const note = `(${toolList} deferred — only one long-running operation per turn. Run it next.)`;
    assistantText = assistantText ? `${assistantText}\n\n${note}` : note;
  }

  return {
    blocks: allBlocks,
    side_effects: sideEffects,
    assistant_text: assistantText,
    ...(analysisResponse && { analysis_response: analysisResponse }),
    ...(toolLatencyMs !== undefined && { tool_latency_ms: toolLatencyMs }),
    guidance_items: allGuidanceItems,
    ...(allSuggestedActions.length > 0 && { suggested_actions: allSuggestedActions }),
    ...(editGraphDiagnostics && { edit_graph_diagnostics: editGraphDiagnostics }),
    ...(pendingClarification && { pending_clarification: pendingClarification }),
    ...(pendingProposal && { pending_proposal: pendingProposal }),
    ...(proposedChanges && { proposed_changes: proposedChanges }),
    ...(routeMetadata && { route_metadata: routeMetadata }),
    ...(appliedChanges && { applied_changes: appliedChanges }),
    ...(deterministicAnswerTier !== undefined && { deterministic_answer_tier: deterministicAnswerTier }),
    executed_tools: executedTools,
    deferred_tools: deferred.map(t => t.name),
    ...(stageFallbackInjected && { stage_fallback_injected: true }),
    ...(needsConversationalRetry && {
      needs_conversational_retry: true,
      suppressed_tool_for_retry: suppressedToolForRetry,
    }),
  };
}

/**
 * Create the production ToolDispatcher that wraps the shared dispatch module.
 *
 * Both V1 (turn-handler) and V2 (pipeline) share the same tool handler code
 * via tools/dispatch.ts — no duplication.
 */
export function createProductionToolDispatcher(
  requestId: string,
  plotOpts?: PLoTClientRunOpts,
  request?: FastifyRequest,
): ToolDispatcher {
  return {
    async dispatch(toolName, toolInput, context, turnId, _reqId, options) {
      const opts: ToolDispatchOpts = {
        plotOpts,
        request,
        intentClassification: options?.intentClassification,
      };
      const result = await dispatchToolHandler(
        toolName,
        toolInput,
        context,
        turnId,
        requestId,
        opts,
      );

      // Map handler result to ToolResult with side_effects
      const sideEffects = {
        graph_updated: result.blocks.some((block) => block.block_type === 'graph_patch'),
        analysis_ran: toolName === 'run_analysis' && !!result.analysisResponse,
        brief_generated: toolName === 'generate_brief' && result.blocks.length > 0,
      };

      return {
        blocks: result.blocks,
        side_effects: sideEffects,
        assistant_text: result.assistantText,
        analysis_response: result.analysisResponse,
        tool_latency_ms: result.toolLatencyMs,
        guidance_items: result.guidanceItems,
        edit_graph_diagnostics: result.editGraphDiagnostics,
        pending_clarification: result.pendingClarification,
        pending_proposal: result.pendingProposal,
        proposed_changes: result.proposedChanges,
        route_metadata: result.routeMetadata,
        ...(result.suggestedActions && result.suggestedActions.length > 0 && {
          suggested_actions: result.suggestedActions,
        }),
        ...(result.appliedChanges && { applied_changes: result.appliedChanges }),
        ...(result.deterministicAnswerTier !== undefined && { deterministic_answer_tier: result.deterministicAnswerTier }),
      };
    },
  };
}
