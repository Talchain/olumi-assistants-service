/**
 * Phase 4: Tool Execution
 *
 * Dispatches tool invocations to the existing tool handler infrastructure.
 * Does not duplicate tool handler code — uses shared dispatch module.
 */

import type {
  EnrichedContext,
  LLMResult,
  ToolResult,
  ToolDispatcher,
  ConversationContext,
} from "../types.js";
import { dispatchToolHandler } from "../../tools/dispatch.js";
import type { ToolDispatchOpts } from "../../tools/dispatch.js";
import type { FastifyRequest } from "fastify";
import type { PLoTClientRunOpts } from "../../plot-client.js";

/**
 * Phase 4 entry point: execute tool invocations.
 *
 * If no tool invocations → return empty result (no side effects).
 * If tool present → dispatch via ToolDispatcher, track side effects.
 */
export async function phase4Execute(
  llmResult: LLMResult,
  enrichedContext: EnrichedContext,
  toolDispatcher: ToolDispatcher,
  requestId: string,
): Promise<ToolResult> {
  // No tool invocations → pure conversation
  if (llmResult.tool_invocations.length === 0) {
    return {
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: llmResult.assistant_text,
    };
  }

  // Dispatch first tool invocation
  const invocation = llmResult.tool_invocations[0];

  const context: ConversationContext = {
    graph: enrichedContext.graph,
    analysis_response: enrichedContext.analysis,
    framing: enrichedContext.framing,
    messages: enrichedContext.conversation_history,
    selected_elements: enrichedContext.selected_elements,
    scenario_id: enrichedContext.scenario_id,
  };

  const result = await toolDispatcher.dispatch(
    invocation.name,
    invocation.input,
    context,
    enrichedContext.turn_id,
    requestId,
  );

  return result;
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
    async dispatch(toolName, toolInput, context, turnId) {
      const opts: ToolDispatchOpts = { plotOpts, request };
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
      };
    },
  };
}
