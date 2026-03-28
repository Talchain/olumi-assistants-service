/**
 * Response Assembler
 *
 * Assembles a typed OrchestratorResponseEnvelope from LLM output + action results.
 * Adds response_version: 2 to every response.
 */

import { randomUUID } from "node:crypto";
import type {
  OrchestratorResponseEnvelope,
  TypedConversationBlock,
  SuggestedAction,
  ResponseLineage,
  TurnPlan,
} from "../types.js";
import type {
  DeterministicTurnContext,
  LLMJsonResponse,
  LLMInsight,
  ActionResult,
  DeterministicPipelineResult,
} from "./types.js";
import { buildChipsFromRecommendations } from "./chip-assembler.js";
import { normaliseDeterministicResponse } from "./response-normaliser.js";
import { computeContextHash } from "../context/context-hash.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import type { GuidanceItem } from "../types/guidance-item.js";

// ============================================================================
// Public API
// ============================================================================

export interface AssemblerInput {
  turnContext: DeterministicTurnContext;
  llmResponse: LLMJsonResponse | null;
  actionResult: ActionResult | null;
  turnId: string;
  routing: 'deterministic' | 'llm';
  selectedAction: string | null;
  executedActions: string[];
  /** LLM call latency in ms (if any). */
  llmLatencyMs?: number;
}

/**
 * Assemble the final response envelope from pipeline outputs.
 */
export function assembleDeterministicResponse(input: AssemblerInput): DeterministicPipelineResult {
  const {
    turnContext,
    llmResponse,
    actionResult,
    turnId,
    routing,
    selectedAction,
    executedActions,
    llmLatencyMs,
  } = input;

  // Build assistant text — action confirmation first, LLM coaching second
  let assistantText: string | null = null;
  if (actionResult?.assistantText) {
    assistantText = actionResult.assistantText;
  }
  if (llmResponse?.text) {
    assistantText = assistantText
      ? `${assistantText}\n\n${llmResponse.text}`
      : llmResponse.text;
  }

  // Build blocks
  const blocks: TypedConversationBlock[] = [
    ...(actionResult?.blocks ?? []),
  ];

  // Emit graph_patch block when operations were produced
  if (actionResult?.operations && actionResult.operations.length > 0) {
    const patchBlock = createGraphPatchBlock(
      {
        patch_type: 'edit',
        operations: actionResult.operations,
        status: 'proposed',
        auto_apply: false,
        applied_graph_hash: actionResult.applied_graph_hash,
        applied_graph: actionResult.applied_graph,
      },
      turnId,
    );
    blocks.push(patchBlock);
  }

  // Build chips from LLM recommendations
  let suggestedActions: SuggestedAction[] = [];
  if (llmResponse?.recommended_actions && llmResponse.recommended_actions.length > 0) {
    suggestedActions = buildChipsFromRecommendations(
      llmResponse.recommended_actions,
      turnContext,
    );
  }

  // Build lineage
  const lineage: ResponseLineage = {
    context_hash: computeContextHash({
      graph: null,
      analysis_response: null,
      framing: turnContext.stage ? { stage: turnContext.stage } : null,
    }),
    ...(actionResult?.applied_graph_hash ? { graph_hash: actionResult.applied_graph_hash } : {}),
  };

  // Build turn plan
  const turnPlan: TurnPlan = {
    selected_tool: selectedAction,
    routing,
    long_running: selectedAction === 'run_analysis',
    ...(llmLatencyMs != null ? { tool_latency_ms: llmLatencyMs } : {}),
    executed_tools: executedActions,
    deferred_tools: [],
  };

  // Cap insights at 3 and include in envelope
  const insights = llmResponse?.insights?.slice(0, 3) ?? [];

  // Collect guidance_items from action result + post-analysis guidance
  let guidanceItems: GuidanceItem[] = [...(actionResult?.guidance_items ?? [])];

  // Generate post-analysis guidance when analysis-related actions executed
  if (
    (executedActions.includes('run_analysis') || executedActions.includes('explain_result')) &&
    turnContext.analysis &&
    guidanceItems.length === 0
  ) {
    try {
      const postAnalysis = generatePostAnalysisGuidance(turnContext.analysis, turnContext.graph);
      if (postAnalysis.length > 0) {
        guidanceItems = [...guidanceItems, ...postAnalysis];
      }
    } catch {
      // Non-fatal — guidance is supplementary
    }
  }

  // Assemble envelope
  const envelope: OrchestratorResponseEnvelope & { response_version: 2; guidance_items?: unknown[] } = {
    turn_id: turnId,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions.length > 0 ? suggestedActions : undefined,
    analysis_response: actionResult?.analysis_response,
    lineage,
    turn_plan: turnPlan,
    stage_indicator: turnContext.stage,
    response_version: 2,
    ...(insights.length > 0 ? { insights } : {}),
    guidance_items: guidanceItems,
  };

  // Apply normaliser
  const normalised = normaliseDeterministicResponse(envelope);

  return {
    envelope: normalised as OrchestratorResponseEnvelope & { response_version: 2 },
    httpStatus: 200,
  };
}
