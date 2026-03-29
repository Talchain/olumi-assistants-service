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
  TurnQualityMeta,
} from "./types.js";
import { buildChipsFromRecommendations } from "./chip-assembler.js";
import { normaliseDeterministicResponse, scanBannedTerms } from "./response-normaliser.js";
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
  /** How the LLM response was extracted. */
  extractionMethod?: 'native' | 'fence' | 'regex' | 'fallback';
  /** Whether TurnContext used the fallback path. */
  contextFallbackUsed?: boolean;
  /** Character count of the full system prompt. */
  promptCharCount?: number;
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
    extractionMethod,
    contextFallbackUsed,
    promptCharCount,
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
  let strippedActions: string[] = [];
  if (llmResponse?.recommended_actions && llmResponse.recommended_actions.length > 0) {
    const chipResult = buildChipsFromRecommendations(
      llmResponse.recommended_actions,
      turnContext,
    );
    suggestedActions = chipResult.chips;
    strippedActions = chipResult.strippedActions;
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

  // Check if normaliser had to inject default text (was empty before normaliser fixed it)
  const emptyBeforeNormalisation = !envelope.assistant_text || envelope.assistant_text.trim().length === 0;

  // Scan banned terms on user-visible surfaces
  const bannedTermsFound = scanBannedTerms(
    llmResponse,
    normalised,
    turnContext.scenario_id,
    turnId,
  );

  // Build quality metadata for telemetry
  // When LLM call failed (extractionMethod undefined), report as 'error' not 'native'
  const quality: TurnQualityMeta = {
    parse_method: extractionMethod ?? (llmResponse ? 'native' : 'error'),
    banned_terms_found: bannedTermsFound,
    ineligible_actions_stripped: strippedActions,
    insights_count: llmResponse?.insights?.length ?? 0,
    actions_count: llmResponse?.recommended_actions?.length ?? 0,
    text_word_count: (normalised.assistant_text ?? '').split(/\s+/).filter(Boolean).length,
    has_science_concept: llmResponse?.insights?.some((i) => !!i.science_concept) ?? false,
    disambiguation_triggered: turnContext.disambiguation_hints.length > 0,
    empty_after_normalisation: emptyBeforeNormalisation,
    llm_action_count_pre_filter: llmResponse?.recommended_actions?.length ?? 0,
    context_fallback_used: contextFallbackUsed ?? false,
    prompt_char_count: promptCharCount ?? 0,
  };

  return {
    envelope: normalised as OrchestratorResponseEnvelope & { response_version: 2 },
    httpStatus: 200,
    _quality: quality,
  };
}
