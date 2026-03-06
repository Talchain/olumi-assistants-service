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
import type { ToolName } from "../../intent-gate.js";
import { assembleMessages, assembleToolDefinitions } from "../../prompt-assembly.js";
import { getToolDefinitions } from "../../tools/registry.js";

import type { EnrichedContext, SpecialistResult, LLMResult, LLMClient, ConversationContext } from "../types.js";
import { assembleV2SystemPrompt } from "./prompt-assembler.js";
import { parseV2Response, buildDeterministicLLMResult } from "./response-parser.js";

// ============================================================================
// Deterministic Routing Prerequisites
// ============================================================================

/**
 * Prerequisites for deterministic tool dispatch.
 * Same as turn-handler.ts — shared logic, not duplicated definition.
 */
const DETERMINISTIC_PREREQUISITES: Partial<Record<ToolName, (ctx: ConversationContext) => boolean>> = {
  run_analysis: (ctx) => ctx.graph != null,
  explain_results: (ctx) => ctx.analysis_response != null,
  edit_graph: (ctx) => ctx.graph != null,
  generate_brief: (ctx) => ctx.graph != null && ctx.analysis_response != null,
  run_exercise: (ctx) => ctx.analysis_response != null,
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
): Promise<LLMResult> {
  // 1. Check deterministic intent gate
  const intentGate = classifyIntent(userMessage);

  if (intentGate.routing === 'deterministic' && intentGate.tool) {
    // Check prerequisites
    const context = buildConversationContext(enrichedContext);
    const checkPrereq = DETERMINISTIC_PREREQUISITES[intentGate.tool];
    const prerequisitesMet = checkPrereq ? checkPrereq(context) : true;

    if (prerequisitesMet) {
      log.info(
        {
          request_id: requestId,
          tool: intentGate.tool,
          routing: 'deterministic',
          matched_pattern: intentGate.matched_pattern,
        },
        "V2 pipeline: deterministic routing — skipping LLM",
      );

      // For run_exercise, pass the exercise type; for research_topic, pass the extracted query
      let deterministicInput: Record<string, unknown> = {};
      if (intentGate.tool === 'run_exercise' && intentGate.exercise) {
        deterministicInput = { exercise: intentGate.exercise };
      } else if (intentGate.tool === 'research_topic' && intentGate.research_query) {
        deterministicInput = { query: intentGate.research_query };
      }
      return buildDeterministicLLMResult(intentGate.tool, deterministicInput);
    }

    // Prerequisites not met → fall through to LLM
    log.info(
      {
        request_id: requestId,
        tool: intentGate.tool,
        routing: 'llm',
        reason: 'prerequisites_not_met',
      },
      "V2 pipeline: deterministic gate matched but prerequisites not met — falling back to LLM",
    );
  }

  // 2. LLM routing — full tool-calling flow
  const systemPrompt = await assembleV2SystemPrompt(enrichedContext);
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
