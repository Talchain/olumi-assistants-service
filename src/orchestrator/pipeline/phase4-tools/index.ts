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

    // Accumulate side effects
    if (invocation.name === 'draft_graph' || invocation.name === 'edit_graph') {
      sideEffects.graph_updated = true;
    }
    if (invocation.name === 'run_analysis') {
      sideEffects.analysis_ran = true;
    }
    if (invocation.name === 'generate_brief') {
      sideEffects.brief_generated = true;
    }
  }

  // Guaranteed fallback: all tools suppressed + blank/null LLM text → never emit silent response.
  // Check after the loop so we only fire when nothing executed AND there is no usable text.
  const allToolsSuppressed = toExecute.length > 0 && executedTools.length === 0;
  if (allToolsSuppressed && !assistantText?.trim()) {
    const suppressedTool = toExecute[0]?.name;
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
    executed_tools: executedTools,
    deferred_tools: deferred.map(t => t.name),
    ...(stageFallbackInjected && { stage_fallback_injected: true }),
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
        graph_updated: toolName === 'draft_graph' || toolName === 'edit_graph',
        analysis_ran: toolName === 'run_analysis',
        brief_generated: toolName === 'generate_brief',
      };

      return {
        blocks: result.blocks,
        side_effects: sideEffects,
        assistant_text: result.assistantText,
        analysis_response: result.analysisResponse,
        tool_latency_ms: result.toolLatencyMs,
        guidance_items: result.guidanceItems,
        ...(result.suggestedActions && result.suggestedActions.length > 0 && {
          suggested_actions: result.suggestedActions,
        }),
      };
    },
  };
}
