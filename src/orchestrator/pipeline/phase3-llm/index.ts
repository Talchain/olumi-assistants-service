/**
 * Phase 3: LLM Call
 *
 * Handles both deterministic routing (skipping LLM) and LLM-based tool selection.
 *
 * Deterministic routing: If the existing intent gate matches a tool directly,
 * skip the LLM call and go directly to Phase 4 with the matched tool.
 * This preserves V1's latency and cost optimization for explicit commands.
 *
 * LLM routing: Full tool-calling flow with prompt assembly and response parsing.
 */

import { log } from "../../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../../config/timeouts.js";
import { getMaxTokensFromConfig } from "../../../adapters/llm/router.js";
import { classifyIntent } from "../../intent-gate.js";
import type { IntentGateResult, ToolName } from "../../intent-gate.js";
import { assembleMessages, assembleToolDefinitions } from "../../prompt-assembly.js";
import { getToolDefinitions } from "../../tools/registry.js";
import { isToolAllowedAtStage } from "../../tools/stage-policy.js";
import { determineEditResolutionMode } from "../../tools/edit-graph.js";
import { isAnalysisCurrent, isAnalysisExplainable, isAnalysisRunnable } from "../../analysis-state.js";
import { classifyUserIntent } from "../phase1-enrichment/intent-classifier.js";

import type { EnrichedContext, SpecialistResult, LLMResult, LLMClient, ConversationContext } from "../types.js";
import { assembleV2SystemPrompt } from "./prompt-assembler.js";
import { parseV2Response, buildDeterministicLLMResult } from "./response-parser.js";
import { getSystemPromptMeta } from "../../../adapters/llm/prompt-loader.js";
import { config } from "../../../config/index.js";

// ============================================================================
// Deterministic Routing Prerequisites
// ============================================================================

/**
 * Prerequisites for deterministic tool dispatch.
 * Same as turn-handler.ts — shared logic, not duplicated definition.
 */
const DETERMINISTIC_PREREQUISITES: Partial<Record<ToolName, (ctx: ConversationContext) => boolean>> = {
  run_analysis: (ctx) => isAnalysisRunnable(ctx),
  explain_results: (ctx) => isAnalysisExplainable(ctx.analysis_response),
  edit_graph: (ctx) => ctx.graph != null,
  generate_brief: (ctx) => ctx.graph != null && isAnalysisCurrent(ctx.framing?.stage ?? null, ctx.analysis_response),
  run_exercise: (ctx) => isAnalysisCurrent(ctx.framing?.stage ?? null, ctx.analysis_response),
  draft_graph: (ctx) => {
    const f = ctx.framing;
    if (!f) return false;
    const fr = f as Record<string, unknown>;
    return Boolean(f.goal || fr.brief_text || (Array.isArray(fr.options) && (fr.options as unknown[]).length > 0));
  },
};

// ============================================================================
// Phase 3 Entry
// ============================================================================

/**
 * Phase 3 entry point: generate LLM response or apply deterministic routing.
 *
 * 1. Check deterministic intent gate first (reuses existing intent-gate.ts)
 * 2. If gate matches AND prerequisites met → skip LLM, return deterministic result
 * 3. Otherwise → full LLM call with tool definitions
 */
export async function phase3Generate(
  enrichedContext: EnrichedContext,
  specialistResult: SpecialistResult,
  llmClient: LLMClient,
  requestId: string,
  userMessage: string,
  initialIntentGate?: IntentGateResult,
): Promise<LLMResult> {
  // 1. Check deterministic intent gate
  const intentGate = initialIntentGate ?? classifyIntent(userMessage);
  const clarificationToolInput = buildClarificationContinuationInput(enrichedContext, userMessage);
  const freshTurnIntent = classifyUserIntent(userMessage);
  const editResolutionMode = (clarificationToolInput || intentGate.tool === 'edit_graph')
    ? determineEditResolutionMode(userMessage, buildConversationContext(enrichedContext))
    : null;
  const shouldAvoidEditGraph = editResolutionMode === 'no_edit_answer';
  const shouldPreferExplainResults = (
    enrichedContext.analysis != null
    && intentGate.tool === 'edit_graph'
    && (
      (
        enrichedContext.stage_indicator.stage === 'evaluate'
        && (freshTurnIntent === 'explain' || freshTurnIntent === 'recommend')
      )
      || shouldAvoidEditGraph
    )
  );
  const effectiveIntentGate = clarificationToolInput
    ? {
        routing: 'deterministic' as const,
        tool: 'edit_graph' as const,
        confidence: 'exact' as const,
        matched_pattern: '[clarification_continuation]',
      }
    : shouldPreferExplainResults
    ? {
        ...intentGate,
        tool: 'explain_results' as const,
        routing: 'deterministic' as const,
        matched_pattern: intentGate.matched_pattern ?? '[fresh_turn_explain_override]',
      }
    : shouldAvoidEditGraph
      ? {
          ...intentGate,
          tool: null,
          routing: 'llm' as const,
          matched_pattern: intentGate.matched_pattern ?? '[edit_graph_bypass]',
        }
    : intentGate;

  // `no_edit_answer` is a routing-only outcome. With evaluation-stage analysis we
  // deterministically narrate via explain_results; otherwise we bypass edit_graph
  // and let the orchestrator LLM answer without executing a tool.

  if (effectiveIntentGate.routing === 'deterministic' && effectiveIntentGate.tool) {
    // Check prerequisites
    const context = buildConversationContext(enrichedContext);
    const checkPrereq = DETERMINISTIC_PREREQUISITES[effectiveIntentGate.tool];
    const prerequisitesMet = checkPrereq ? checkPrereq(context) : true;

    if (!prerequisitesMet) {
      // Prerequisites not met → fall through to LLM
      log.info(
        {
          request_id: requestId,
          tool: effectiveIntentGate.tool,
          routing: 'llm',
          reason: 'prerequisites_not_met',
        },
        "V2 pipeline: deterministic gate matched but prerequisites not met — falling back to LLM",
      );
    } else {
      // Prerequisites met — check stage policy before dispatching.
      // Matches V1 behavior: fall through to LLM for a conversational response.
      const stageGuard = isToolAllowedAtStage(
        effectiveIntentGate.tool,
        enrichedContext.stage_indicator.stage,
        userMessage,
      );
      if (!stageGuard.allowed) {
        log.info(
          {
            request_id: requestId,
            tool: effectiveIntentGate.tool,
            stage: enrichedContext.stage_indicator.stage,
            reason: stageGuard.reason,
            routing: 'llm',
          },
          "V2 pipeline: stage policy suppressed deterministic tool — falling back to LLM",
        );
        // Fall through to LLM path
      } else {
        log.info(
          {
            request_id: requestId,
            tool: effectiveIntentGate.tool,
            routing: 'deterministic',
            matched_pattern: effectiveIntentGate.matched_pattern,
            fresh_turn_intent: freshTurnIntent,
            explain_override_applied: shouldPreferExplainResults,
          },
          "V2 pipeline: deterministic routing — skipping LLM",
        );

        // For run_exercise, pass the exercise type; for research_topic, pass the extracted query
        let deterministicInput: Record<string, unknown> = clarificationToolInput ?? {};
        if (effectiveIntentGate.tool === 'run_exercise' && effectiveIntentGate.exercise) {
          deterministicInput = { exercise: effectiveIntentGate.exercise };
        } else if (effectiveIntentGate.tool === 'research_topic' && effectiveIntentGate.research_query) {
          deterministicInput = { query: effectiveIntentGate.research_query };
        } else if (effectiveIntentGate.tool === 'edit_graph' && clarificationToolInput) {
          deterministicInput = clarificationToolInput;
        }
        return buildDeterministicLLMResult(effectiveIntentGate.tool, deterministicInput);
      }
    }
  }

  // 2. LLM routing — full tool-calling flow
  const systemPrompt = await assembleV2SystemPrompt(enrichedContext);

  // Task 7: Log prompt identity for every V2 LLM call
  const promptMeta = getSystemPromptMeta('orchestrator');
  log.info(
    {
      request_id: requestId,
      prompt_task_id: promptMeta.taskId,
      prompt_version: promptMeta.prompt_version,
      prompt_hash: promptMeta.prompt_hash ?? null,
      prompt_source: promptMeta.source,
      prompt_instance_id: promptMeta.instance_id ?? null,
      zone2_enabled: config.features.contextFabric,
      v2_prompt_zone2_included: true,
      context_fabric_config_enabled: config.features.contextFabric,
      system_prompt_chars: systemPrompt.length,
      pipeline: 'v2',
    },
    'phase3.prompt_identity',
  );

  const context = buildConversationContext(enrichedContext);

  // Filter [system] sentinel: when a system_event is present, replace with event context.
  // The '[system]' sentinel is sent by UI as a placeholder — it must never reach the LLM.
  const effectiveUserMessage = buildEffectiveUserMessage(enrichedContext, userMessage);

  const messages = assembleMessages(context, effectiveUserMessage);
  const toolDefs = assembleToolDefinitions(getToolDefinitions());

  if (!llmClient.chatWithTools) {
    // Fallback: plain chat if adapter doesn't support tools
    log.warn({ request_id: requestId }, "V2 pipeline: LLM client does not support chatWithTools");
    const chatResult = await llmClient.chat(
      { system: systemPrompt, userMessage: effectiveUserMessage },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
    );

    return {
      assistant_text: chatResult.content,
      tool_invocations: [],
      science_annotations: [],
      raw_response: chatResult.content,
      suggested_actions: [],
      diagnostics: null,
      parse_warnings: [],
    };
  }

  const llmResult = await llmClient.chatWithTools(
    {
      system: systemPrompt,
      messages,
      tools: toolDefs,
      tool_choice: { type: 'auto' },
      maxTokens: getMaxTokensFromConfig('orchestrator'),
    },
    { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
  );

  return parseV2Response(llmResult);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build ConversationContext from EnrichedContext for reuse with existing modules.
 *
 * Filters '[system]' sentinel messages from conversation_history — these are
 * UI placeholders that must never be forwarded to the LLM.
 */
function buildConversationContext(enriched: EnrichedContext): ConversationContext {
  const filteredHistory = enriched.conversation_history.filter(
    (msg) => msg.content !== SYSTEM_EVENT_SENTINEL,
  );

  return {
    graph: enriched.graph,
    analysis_response: enriched.analysis,
    framing: enriched.framing,
    messages: filteredHistory,
    selected_elements: enriched.selected_elements,
    scenario_id: enriched.scenario_id,
    analysis_inputs: enriched.analysis_inputs,
    conversational_state: enriched.conversational_state,
  };
}

/** Sentinel value sent by UI when a system event occurs. Must never reach the LLM. */
export const SYSTEM_EVENT_SENTINEL = '[system]';

/**
 * Resolve the effective user message for the LLM.
 *
 * When a system_event is present, the UI sends '[system]' as the message placeholder.
 * This sentinel must never be forwarded to the LLM. Instead, we send a formatted
 * description of the system event so the LLM can respond contextually.
 *
 * When no system_event is present, the original user message is returned unchanged.
 */
function buildEffectiveUserMessage(enriched: EnrichedContext, rawMessage: string): string {
  const systemEvent = enriched.system_event;

  if (!systemEvent) {
    return rawMessage;
  }

  // System event present — discard any '[system]' sentinel (and any user text)
  // and replace with a structured event description for the LLM
  const detailsSummary = systemEvent.details && Object.keys(systemEvent.details).length > 0
    ? ` Details: ${JSON.stringify(systemEvent.details)}`
    : '';

  return `[System event: ${systemEvent.event_type}${detailsSummary}]`;
}

function buildClarificationContinuationInput(
  enrichedContext: EnrichedContext,
  userMessage: string,
): Record<string, unknown> | null {
  const pending = enrichedContext.conversational_state?.pending_clarification;
  if (!pending || pending.tool !== 'edit_graph') return null;

  const trimmed = userMessage.trim();
  if (trimmed.length === 0) return null;

  const matchedLabel = pending.candidate_labels.find((label) => trimmed.toLowerCase() === label.toLowerCase());
  if (!matchedLabel) return null;

  return {
    edit_description: `${pending.original_edit_request} for ${matchedLabel}`,
  };
}
