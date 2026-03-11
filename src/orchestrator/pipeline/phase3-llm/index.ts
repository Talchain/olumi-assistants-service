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
import { computeGraphHash, determineEditResolutionMode } from "../../tools/edit-graph.js";
import { isAnalysisCurrent, isAnalysisExplainable, isAnalysisRunnable } from "../../analysis-state.js";
import { classifyUserIntent } from "../phase1-enrichment/intent-classifier.js";

import type { EnrichedContext, SpecialistResult, LLMResult, LLMClient, ConversationContext, RouteMetadata } from "../types.js";
import { assembleV2SystemPrompt } from "./prompt-assembler.js";
import { parseV2Response, buildConversationalLLMResult, buildDeterministicLLMResult } from "./response-parser.js";
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
    // Prerequisites check uses only structured framing fields — no message-length heuristics.
    // The explicit-generate path (buildExplicitGenerateRoute) applies message-length heuristics
    // separately when the user explicitly asks to generate.
    const framing = ctx.framing as Record<string, unknown> | null;
    const goal = typeof ctx.framing?.goal === 'string' ? ctx.framing.goal.trim() : '';
    const optionsCount = Array.isArray(framing?.options)
      ? framing.options.filter((o) => typeof o === 'string' && (o as string).trim().length > 0).length
      : 0;
    const constraintCount = Array.isArray(framing?.constraints)
      ? framing.constraints.filter((c) => typeof c === 'string' && (c as string).trim().length > 0).length
      : 0;
    return goal.length > 0 || optionsCount > 0 || constraintCount > 0;
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
  // Build context once; reused for resolution-mode check, prerequisite check, and LLM assembly.
  const context = buildConversationContext(enrichedContext);
  const clarificationToolInput = buildClarificationContinuationInput(enrichedContext, userMessage);
  const proposalFollowUp = buildPendingProposalContinuation(enrichedContext, userMessage);
  const freshTurnIntent = classifyUserIntent(userMessage);
  const hasExplainableCurrentAnalysis = (
    isAnalysisExplainable(enrichedContext.analysis)
    && isAnalysisCurrent(enrichedContext.stage_indicator.stage, enrichedContext.analysis)
  );
  const rationaleOnlyFollowUp = shouldUseRationaleExplanation(enrichedContext, userMessage, freshTurnIntent, hasExplainableCurrentAnalysis);
  const explicitGenerate = buildExplicitGenerateRoute(enrichedContext, userMessage, intentGate, context);
  const shouldBlockExplainResults = intentGate.tool === 'explain_results' && !hasExplainableCurrentAnalysis;
  const shouldBlockStableModelRedraft = intentGate.tool === 'draft_graph'
    && hasStableModel(enrichedContext)
    && !isClearRegenerateRequest(userMessage);
  const editResolutionMode = (clarificationToolInput || proposalFollowUp?.action === 'confirm' || intentGate.tool === 'edit_graph')
    ? determineEditResolutionMode(userMessage, context)
    : null;
  const shouldAvoidEditGraph = editResolutionMode === 'no_edit_answer';
  const shouldPreferExplainResults = (
    hasExplainableCurrentAnalysis
    && intentGate.tool === 'edit_graph'
    && (
      (
        enrichedContext.stage_indicator.stage === 'evaluate'
        && (freshTurnIntent === 'explain' || freshTurnIntent === 'recommend')
      )
      || shouldAvoidEditGraph
    )
  );
  if (proposalFollowUp?.action === 'dismiss') {
    return buildConversationalLLMResult(
      'Okay — I won’t apply that change.',
      { outcome: 'proposal_dismissal', reasoning: 'dismissed_pending_proposal' },
    );
  }
  if (proposalFollowUp?.action === 'stale') {
    return buildConversationalLLMResult(
      'That proposal is out of date because the model changed. If you still want it, ask me to apply it again and I’ll regenerate it from the current model.',
      { outcome: 'proposal_dismissal', reasoning: 'pending_proposal_invalidated_by_graph_change' },
    );
  }
  if (explicitGenerate.kind === 'clarify') {
    return buildConversationalLLMResult(
      explicitGenerate.assistantText,
      { outcome: 'generation_clarification', reasoning: explicitGenerate.reasoning },
    );
  }
  if (shouldBlockStableModelRedraft) {
    return buildConversationalLLMResult(
      'You already have a model. If you want a fresh one, ask me to regenerate it. Otherwise tell me what to change.',
      { outcome: 'generation_clarification', reasoning: 'stable_model_exists_and_regenerate_not_requested' },
    );
  }
  if (rationaleOnlyFollowUp) {
    const rationaleText = await generateRationaleExplanation(llmClient, enrichedContext, userMessage, requestId);
    return buildConversationalLLMResult(
      rationaleText,
      { outcome: 'rationale_explanation', reasoning: 'analysis_not_current_or_not_explainable' },
    );
  }

  const effectiveIntentGate = proposalFollowUp?.action === 'confirm'
    ? {
        routing: 'deterministic' as const,
        tool: 'edit_graph' as const,
        confidence: 'exact' as const,
        matched_pattern: '[pending_proposal_confirmation]',
      }
    : clarificationToolInput
    ? {
        routing: 'deterministic' as const,
        tool: 'edit_graph' as const,
        confidence: 'exact' as const,
        matched_pattern: '[clarification_continuation]',
      }
    : explicitGenerate.kind === 'deterministic'
    ? {
        routing: 'deterministic' as const,
        tool: 'draft_graph' as const,
        confidence: 'exact' as const,
        matched_pattern: '[explicit_generate_override]',
      }
    : shouldBlockExplainResults
    ? {
        ...intentGate,
        tool: null,
        routing: 'llm' as const,
        matched_pattern: intentGate.matched_pattern ?? '[results_explanation_blocked]',
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
    // Check prerequisites (reuses top-level `context`)
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
      const allowExplicitGenerateOverride = (
        effectiveIntentGate.tool === 'draft_graph'
        && explicitGenerate.kind === 'deterministic'
      );
      if (!stageGuard.allowed && !allowExplicitGenerateOverride) {
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
        let routeMetadata: RouteMetadata | undefined;
        if (effectiveIntentGate.tool === 'run_exercise' && effectiveIntentGate.exercise) {
          deterministicInput = { exercise: effectiveIntentGate.exercise };
        } else if (effectiveIntentGate.tool === 'research_topic' && effectiveIntentGate.research_query) {
          deterministicInput = { query: effectiveIntentGate.research_query };
        } else if (effectiveIntentGate.tool === 'draft_graph' && explicitGenerate.kind === 'deterministic') {
          deterministicInput = { brief: explicitGenerate.brief };
          routeMetadata = { outcome: 'explicit_generate', reasoning: explicitGenerate.reasoning };
        } else if (effectiveIntentGate.tool === 'edit_graph' && proposalFollowUp?.action === 'confirm') {
          deterministicInput = {
            edit_description: proposalFollowUp.pendingProposal.original_edit_request,
            pending_proposal: proposalFollowUp.pendingProposal,
            confirmation_mode: 'apply_pending_proposal',
          };
          routeMetadata = { outcome: 'proposal_confirmation', reasoning: 'confirmed_pending_proposal' };
        } else if (effectiveIntentGate.tool === 'edit_graph' && clarificationToolInput) {
          deterministicInput = clarificationToolInput;
          routeMetadata = { outcome: 'clarification_continuation', reasoning: 'resolved_from_pending_clarification' };
        } else if (effectiveIntentGate.tool === 'explain_results' && shouldPreferExplainResults) {
          routeMetadata = { outcome: 'results_explanation', reasoning: 'completed_current_analysis_available' };
        }
        return buildDeterministicLLMResult(effectiveIntentGate.tool, deterministicInput, routeMetadata);
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

  // Filter [system] sentinel: when a system_event is present, replace with event context.
  // The '[system]' sentinel is sent by UI as a placeholder — it must never reach the LLM.
  const effectiveUserMessage = buildEffectiveUserMessage(enrichedContext, userMessage);

  const messages = assembleMessages(context, effectiveUserMessage);
  const toolDefs = assembleToolDefinitions(getToolDefinitions()).filter((tool) =>
    hasExplainableCurrentAnalysis || tool.name !== 'explain_results',
  );

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

  const parsed = parseV2Response(llmResult);
  return {
    ...parsed,
    route_metadata: { outcome: 'default_llm', reasoning: 'no_deterministic_route_applied' },
  };
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

/** Normalise a string for label matching: lowercase, collapse whitespace, strip punctuation. */
function normaliseLabelText(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function buildClarificationContinuationInput(
  enrichedContext: EnrichedContext,
  userMessage: string,
): Record<string, unknown> | null {
  const pending = enrichedContext.conversational_state?.pending_clarification;
  if (!pending || pending.tool !== 'edit_graph') return null;

  const trimmed = userMessage.trim();
  if (trimmed.length === 0) return null;

  const normalisedInput = normaliseLabelText(trimmed);

  // Exact match takes highest priority — avoids false multi-matches when one label is a
  // substring of another (e.g. "Onboarding" and "Onboarding Time").
  const exactMatches = pending.candidate_labels.filter(
    (label) => normalisedInput === normaliseLabelText(label),
  );
  if (exactMatches.length === 1) {
    return { edit_description: `${pending.original_edit_request} for ${exactMatches[0]}` };
  }

  // Substring fallback — only when no exact match exists.
  if (exactMatches.length === 0) {
    const substringMatches = pending.candidate_labels.filter(
      (label) => normalisedInput.includes(normaliseLabelText(label)),
    );
    if (substringMatches.length === 1) {
      return { edit_description: `${pending.original_edit_request} for ${substringMatches[0]}` };
    }
  }

  const groupedLabels = resolveGroupedContinuationLabels(
    normalisedInput,
    pending.candidate_labels,
    enrichedContext.conversational_state?.active_entities ?? [],
  );
  if (!groupedLabels) return null;

  return {
    edit_description: pending.original_edit_request,
    grouped_target_labels: groupedLabels,
  };
}

function resolveGroupedContinuationLabels(
  normalisedInput: string,
  candidateLabels: string[],
  activeEntities: string[],
): string[] | null {
  const explicitMatches = candidateLabels.filter((label) => normalisedInput.includes(normaliseLabelText(label)));
  if (explicitMatches.length >= 1) {
    return explicitMatches;
  }

  if (candidateLabels.length === 2 && /\bboth\b/.test(normalisedInput)) {
    return candidateLabels;
  }
  if (candidateLabels.length === 3 && /\ball three\b/.test(normalisedInput)) {
    return candidateLabels;
  }
  if (/\ball options\b/.test(normalisedInput)) {
    return candidateLabels;
  }
  if (/\bthat one\b|\bthat option\b|\bthat factor\b/.test(normalisedInput)) {
    const activeMatch = activeEntities.find((entity) =>
      candidateLabels.some((candidate) => normaliseLabelText(candidate) === normaliseLabelText(entity)),
    );
    if (activeMatch) {
      return [activeMatch];
    }
  }
  return null;
}

function shouldUseRationaleExplanation(
  enrichedContext: EnrichedContext,
  userMessage: string,
  freshTurnIntent: ReturnType<typeof classifyUserIntent>,
  hasExplainableCurrentAnalysis: boolean,
): boolean {
  if (hasExplainableCurrentAnalysis) return false;
  if (freshTurnIntent !== 'explain' && freshTurnIntent !== 'recommend') return false;
  if (!enrichedContext.graph && !enrichedContext.framing) return false;
  return /\bwhy\b|\brecommend(?:ed|ation)?\b|\bwalk me through\b|\bbreak it down\b/i.test(userMessage);
}

async function generateRationaleExplanation(
  llmClient: LLMClient,
  enrichedContext: EnrichedContext,
  userMessage: string,
  requestId: string,
): Promise<string> {
  const contextSummary = buildRationaleContextSummary(enrichedContext);
  const response = await llmClient.chat(
    {
      system: [
        'You are explaining current model rationale before analysis has produced explainable results.',
        'Do not claim the analysis has run successfully unless the context explicitly says so.',
        'Answer in plain English, briefly, and ground the explanation in the stated goal, options, constraints, and current model structure.',
      ].join(' '),
      userMessage: `Question: ${userMessage}\n\nCurrent context:\n${contextSummary}`,
    },
    { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
  );
  return response.content;
}

function buildRationaleContextSummary(enrichedContext: EnrichedContext): string {
  const graphLabels = (enrichedContext.graph?.nodes ?? [])
    .map((node) => ('label' in node && typeof node.label === 'string') ? node.label : null)
    .filter((label): label is string => label !== null)
    .slice(0, 12);
  const framing = enrichedContext.framing as Record<string, unknown> | null;
  const options = Array.isArray(framing?.options)
    ? framing.options
        .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        .slice(0, 6)
    : [];
  const constraints = Array.isArray(framing?.constraints)
    ? framing.constraints
        .filter((constraint): constraint is string => typeof constraint === 'string' && constraint.trim().length > 0)
        .slice(0, 6)
    : [];

  return [
    `Goal: ${typeof enrichedContext.framing?.goal === 'string' ? enrichedContext.framing.goal : 'unknown'}`,
    `Options: ${options.length > 0 ? options.join(', ') : 'unknown'}`,
    `Constraints: ${constraints.length > 0 ? constraints.join(', ') : 'none stated'}`,
    `Model labels: ${graphLabels.length > 0 ? graphLabels.join(', ') : 'no model yet'}`,
  ].join('\n');
}

type ExplicitGenerateRoute =
  | { kind: 'none' }
  | { kind: 'deterministic'; brief: string; reasoning: string }
  | { kind: 'clarify'; assistantText: string; reasoning: string };

function buildExplicitGenerateRoute(
  enrichedContext: EnrichedContext,
  userMessage: string,
  intentGate: IntentGateResult,
  context: ConversationContext,
): ExplicitGenerateRoute {
  if (!isExplicitGenerateRequest(userMessage, intentGate)) return { kind: 'none' };
  if (hasStableModel(enrichedContext) && !isClearRegenerateRequest(userMessage)) {
    return { kind: 'none' };
  }
  if (!hasMinimumViableFramingContext(context, userMessage)) {
    return {
      kind: 'clarify',
      assistantText: buildGenerationClarificationMessage(enrichedContext),
      reasoning: 'explicit_generate_missing_minimum_viable_framing',
    };
  }
  return {
    kind: 'deterministic',
    brief: buildDraftBriefFromConversation(enrichedContext, userMessage),
    reasoning: hasStableModel(enrichedContext)
      ? 'explicit_regenerate_with_sufficient_context'
      : 'explicit_generate_with_sufficient_context',
  };
}

function isExplicitGenerateRequest(userMessage: string, intentGate: IntentGateResult): boolean {
  if (intentGate.tool === 'draft_graph') return true;
  return /\b(draft|build|generate|create)\b.+\b(model|graph)\b|\bdraft it\b|\bbuild it\b/i.test(userMessage);
}

function isClearRegenerateRequest(userMessage: string): boolean {
  return /\b(regenerate|redraft|rebuild|start over|new model)\b/i.test(userMessage);
}

function hasStableModel(enrichedContext: EnrichedContext): boolean {
  return (enrichedContext.graph?.nodes?.length ?? 0) > 0;
}

function hasMinimumViableFramingContext(context: ConversationContext, userMessage: string): boolean {
  const framing = context.framing as Record<string, unknown> | null;
  const goal = typeof context.framing?.goal === 'string' ? context.framing.goal.trim() : '';
  const optionsCount = Array.isArray(framing?.options)
    ? framing.options.filter((option) => typeof option === 'string' && option.trim().length > 0).length
    : 0;
  const constraintCount = Array.isArray(framing?.constraints)
    ? framing.constraints.filter((constraint) => typeof constraint === 'string' && constraint.trim().length > 0).length
    : 0;
  const userTurns = [...context.messages, { role: 'user' as const, content: userMessage }]
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((content) => content.length >= 20);
  const combinedLength = userTurns.join(' ').length;

  return goal.length > 0 || optionsCount > 0 || constraintCount > 0 || userTurns.length >= 2 || combinedLength >= 120;
}

function buildDraftBriefFromConversation(enrichedContext: EnrichedContext, userMessage: string): string {
  const framing = enrichedContext.framing as Record<string, unknown> | null;
  const parts: string[] = [];
  if (typeof enrichedContext.framing?.goal === 'string' && enrichedContext.framing.goal.trim().length > 0) {
    parts.push(`Goal: ${enrichedContext.framing.goal.trim()}`);
  }
  if (Array.isArray(framing?.options)) {
    const options = framing.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0);
    if (options.length > 0) {
      parts.push(`Options: ${options.join('; ')}`);
    }
  }
  if (Array.isArray(framing?.constraints)) {
    const constraints = framing.constraints.filter((constraint): constraint is string => typeof constraint === 'string' && constraint.trim().length > 0);
    if (constraints.length > 0) {
      parts.push(`Constraints: ${constraints.join('; ')}`);
    }
  }
  const recentUserMessages = [...enrichedContext.conversation_history, { role: 'user' as const, content: userMessage }]
    .filter((message) => message.role === 'user' && message.content !== SYSTEM_EVENT_SENTINEL)
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .slice(-4);
  if (recentUserMessages.length > 0) {
    parts.push(`Conversation context: ${recentUserMessages.join(' ')}`);
  }
  return parts.join('\n');
}

function buildGenerationClarificationMessage(enrichedContext: EnrichedContext): string {
  const framing = enrichedContext.framing as Record<string, unknown> | null;
  const missing: string[] = [];
  const goal = typeof enrichedContext.framing?.goal === 'string' ? enrichedContext.framing.goal.trim() : '';
  const optionsCount = Array.isArray(framing?.options)
    ? framing.options.filter((option) => typeof option === 'string' && option.trim().length > 0).length
    : 0;
  const constraintCount = Array.isArray(framing?.constraints)
    ? framing.constraints.filter((constraint) => typeof constraint === 'string' && constraint.trim().length > 0).length
    : 0;

  if (!goal) missing.push('what decision or outcome you want the model to optimise for');
  if (optionsCount === 0) missing.push('the main options you want compared');
  if (constraintCount === 0) missing.push('the biggest constraint or trade-off');

  const prompts = missing.slice(0, 3).map((item, index) => `${index + 1}. ${item}`);
  return `I can draft it once I have a bit more framing:\n${prompts.join('\n')}`;
}

type PendingProposalContinuation =
  | { action: 'confirm'; pendingProposal: NonNullable<EnrichedContext['conversational_state']['pending_proposal']> }
  | { action: 'dismiss' }
  | { action: 'stale' }
  | null;

function buildPendingProposalContinuation(
  enrichedContext: EnrichedContext,
  userMessage: string,
): PendingProposalContinuation {
  const pendingProposal = enrichedContext.conversational_state?.pending_proposal;
  if (!pendingProposal) return null;

  const normalised = normaliseLabelText(userMessage);
  if (isDismissalMessage(normalised)) {
    return { action: 'dismiss' };
  }
  if (!isConfirmationMessage(normalised)) {
    return null;
  }

  if (!enrichedContext.graph || computeGraphHash(enrichedContext.graph) !== pendingProposal.base_graph_hash) {
    return { action: 'stale' };
  }

  return { action: 'confirm', pendingProposal };
}

function isConfirmationMessage(normalised: string): boolean {
  return /\b(yes|yep|yeah|ok|okay|apply|do it|go ahead|looks good|sounds good|please do)\b/.test(normalised)
    && !/\b(no|dont|don't|stop|cancel|not now)\b/.test(normalised);
}

function isDismissalMessage(normalised: string): boolean {
  return /\b(no|dont|don't|cancel|dismiss|not now|leave it)\b/.test(normalised);
}

