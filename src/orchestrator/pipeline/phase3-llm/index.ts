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

      return buildDeterministicLLMResult(intentGate.tool, {});
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
  const messages = assembleMessages(context, userMessage);
  const toolDefs = assembleToolDefinitions(getToolDefinitions());

  if (!llmClient.chatWithTools) {
    // Fallback: plain chat if adapter doesn't support tools
    log.warn({ request_id: requestId }, "V2 pipeline: LLM client does not support chatWithTools");
    const chatResult = await llmClient.chat(
      { system: systemPrompt, userMessage },
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
 */
function buildConversationContext(enriched: EnrichedContext): ConversationContext {
  return {
    graph: enriched.graph,
    analysis_response: enriched.analysis,
    framing: enriched.framing,
    messages: enriched.conversation_history,
    selected_elements: enriched.selected_elements,
    scenario_id: enriched.scenario_id,
  };
}
