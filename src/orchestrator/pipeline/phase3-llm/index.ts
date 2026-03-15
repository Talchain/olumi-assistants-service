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
import { isAnalysisCurrent, isAnalysisExplainable, isAnalysisRunnable, isResultsExplanationEligible } from "../../analysis-state.js";
import { classifyUserIntent } from "../phase1-enrichment/intent-classifier.js";

import type {
  EnrichedContext,
  SpecialistResult,
  LLMResult,
  LLMClient,
  ConversationContext,
  RouteMetadata,
  Phase3RouteDebug,
  IntentGateDebugSummary,
} from "../types.js";
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
  const hasExplainableCurrentAnalysis = isResultsExplanationEligible(
    enrichedContext.stage_indicator.stage,
    enrichedContext.analysis,
  );
  const explanationRoute = determineExplanationRoute(
    enrichedContext,
    userMessage,
    intentGate,
    freshTurnIntent,
    hasExplainableCurrentAnalysis,
  );
  const explicitGenerate = buildExplicitGenerateRoute(enrichedContext, userMessage, intentGate, context);
  const shouldBlockExplainResults = intentGate.tool === 'explain_results' && explanationRoute.kind !== 'results';
  const shouldBlockStableModelRedraft = intentGate.tool === 'draft_graph'
    && hasStableModel(enrichedContext)
    && !isClearRegenerateRequest(userMessage);
  const editResolutionMode = (clarificationToolInput || proposalFollowUp?.action === 'confirm' || intentGate.tool === 'edit_graph')
    ? determineEditResolutionMode(userMessage, context)
    : null;
  const shouldAvoidEditGraph = editResolutionMode === 'no_edit_answer';
  const shouldRedirectToResultsExplanation = hasExplainableCurrentAnalysis
    && explanationRoute.kind === 'results'
    && (
      intentGate.tool === 'explain_results'
      || intentGate.tool === 'edit_graph'
      || freshTurnIntent === 'explain'
      || freshTurnIntent === 'recommend'
      || shouldAvoidEditGraph
    );
  const routeDebugBase = buildRouteDebugBase(
    intentGate,
    clarificationToolInput,
    proposalFollowUp,
    explicitGenerate,
    shouldRedirectToResultsExplanation,
    explanationRoute.kind === 'rationale',
    hasExplainableCurrentAnalysis,
  );
  if (proposalFollowUp?.action === 'dismiss') {
    return buildConversationalLLMResult(
      'Okay — I won’t apply that change.',
      { outcome: 'proposal_dismissal', reasoning: 'dismissed_pending_proposal' },
      {
        ...routeDebugBase,
        final_intent_gate: {
          routing: 'llm',
          tool: null,
          matched_pattern: '[pending_proposal_dismissal]',
          confidence: 'exact',
        },
        deterministic_override: {
          applied: true,
          reason: 'dismissed_pending_proposal',
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
      },
    );
  }
  if (proposalFollowUp?.action === 'stale') {
    return buildConversationalLLMResult(
      'That proposal is out of date because the model changed. If you still want it, ask me to apply it again and I’ll regenerate it from the current model.',
      { outcome: 'proposal_stale_dismissal', reasoning: 'pending_proposal_invalidated_by_graph_change' },
      {
        ...routeDebugBase,
        final_intent_gate: {
          routing: 'llm',
          tool: null,
          matched_pattern: '[pending_proposal_stale]',
          confidence: 'exact',
        },
        deterministic_override: {
          applied: true,
          reason: 'pending_proposal_invalidated_by_graph_change',
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
      },
    );
  }
  if (explicitGenerate.kind === 'clarify') {
    return buildConversationalLLMResult(
      explicitGenerate.assistantText,
      { outcome: 'generation_clarification', reasoning: explicitGenerate.reasoning },
      {
        ...routeDebugBase,
        final_intent_gate: {
          routing: 'llm',
          tool: null,
          matched_pattern: '[explicit_generate_clarification]',
          confidence: 'exact',
        },
        deterministic_override: {
          applied: true,
          reason: explicitGenerate.reasoning,
        },
        draft_graph_selection: {
          considered: true,
          selected: false,
          reason: explicitGenerate.reasoning,
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
      },
    );
  }
  if (shouldBlockStableModelRedraft) {
    return buildConversationalLLMResult(
      'You already have a model. If you want a fresh one, ask me to regenerate it. Otherwise tell me what to change.',
      { outcome: 'generation_clarification', reasoning: 'stable_model_exists_and_regenerate_not_requested' },
      {
        ...routeDebugBase,
        final_intent_gate: {
          routing: 'llm',
          tool: null,
          matched_pattern: '[stable_model_redraft_blocked]',
          confidence: intentGate.confidence ?? null,
        },
        deterministic_override: {
          applied: true,
          reason: 'stable_model_exists_and_regenerate_not_requested',
        },
        draft_graph_selection: {
          considered: true,
          selected: false,
          reason: 'stable_model_exists_and_regenerate_not_requested',
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
      },
    );
  }
  if (explanationRoute.kind === 'rationale') {
    const rationaleText = await generateRationaleExplanation(llmClient, enrichedContext, userMessage, requestId);
    return buildConversationalLLMResult(
      rationaleText,
      { outcome: 'rationale_explanation', reasoning: explanationRoute.reasoning ?? 'analysis_not_current_or_not_explainable' },
      {
        ...routeDebugBase,
        final_intent_gate: {
          routing: 'llm',
          tool: null,
          matched_pattern: '[rationale_explanation]',
          confidence: intentGate.confidence ?? null,
        },
        deterministic_override: {
          applied: true,
          reason: explanationRoute.reasoning,
        },
        explain_results_selection: {
          considered: explanationRoute.considered,
          selected: false,
          reason: explanationRoute.reasoning,
          explanation_path: 'rationale_explanation',
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
      },
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
    : shouldRedirectToResultsExplanation
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
    // generate_model button bypasses structured-framing prerequisites — the user
    // message IS the brief and the user has explicitly requested generation.
    const prerequisitesBypassed = effectiveIntentGate.tool === 'draft_graph'
      && explicitGenerate.kind === 'deterministic'
      && intentGate.matched_pattern === 'generate_model';
    const prerequisitesMet = prerequisitesBypassed || (checkPrereq ? checkPrereq(context) : true);
    if (prerequisitesBypassed) {
      log.info(
        { request_id: requestId, tool: effectiveIntentGate.tool, matched_pattern: 'generate_model' },
        'V2 pipeline: generate_model bypassed structured-framing prerequisites',
      );
    }

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
            explain_override_applied: shouldRedirectToResultsExplanation,
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
        } else if (effectiveIntentGate.tool === 'explain_results' && explanationRoute.kind === 'results') {
          routeMetadata = { outcome: 'results_explanation', reasoning: explanationRoute.reasoning ?? 'completed_current_analysis_available' };
        }
        const routeDebug: Phase3RouteDebug = {
          ...routeDebugBase,
          final_intent_gate: summariseIntentGate(effectiveIntentGate),
          deterministic_override: {
            applied: effectiveIntentGate.tool !== intentGate.tool || effectiveIntentGate.routing !== intentGate.routing,
            reason: routeMetadata?.reasoning ?? (
              clarificationToolInput
                ? 'resolved_from_pending_clarification'
                : proposalFollowUp?.action === 'confirm'
                ? 'confirmed_pending_proposal'
                : explicitGenerate.kind === 'deterministic'
                ? explicitGenerate.reasoning
                : shouldRedirectToResultsExplanation
                ? explanationRoute.reasoning
                : null
            ),
          },
          explain_results_selection: {
            considered: explanationRoute.considered || shouldBlockExplainResults,
            selected: effectiveIntentGate.tool === 'explain_results',
            reason: effectiveIntentGate.tool === 'explain_results'
              ? explanationRoute.reasoning
              : shouldBlockExplainResults
              ? 'analysis_not_current_or_not_explainable'
              : null,
            explanation_path: effectiveIntentGate.tool === 'explain_results' ? 'results_explanation' : null,
          },
          post_analysis_followup: {
            triggered: shouldRedirectToResultsExplanation,
            reason: shouldRedirectToResultsExplanation ? explanationRoute.reasoning : null,
          },
          draft_graph_selection: {
            considered: explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph',
            selected: effectiveIntentGate.tool === 'draft_graph',
            reason: effectiveIntentGate.tool === 'draft_graph'
              ? (routeMetadata?.reasoning ?? (explicitGenerate.kind === 'deterministic' ? explicitGenerate.reasoning : null))
              : explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph'
              ? 'explicit_generate_not_selected'
              : null,
          },
        };
        return buildDeterministicLLMResult(effectiveIntentGate.tool, deterministicInput, routeMetadata, routeDebug);
      }
    }
  }

  // 2. LLM routing — full tool-calling flow
  const assembled = await assembleV2SystemPrompt(enrichedContext);
  const systemPrompt = assembled.text;

  // Task 7: Log prompt identity for every V2 LLM call
  const promptMeta = getSystemPromptMeta('orchestrator');
  log.info(
    {
      request_id: requestId,
      prompt_id: promptMeta.taskId,
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
  const currentStage = enrichedContext.stage_indicator.stage;
  const allToolDefs = assembleToolDefinitions(getToolDefinitions()).filter((tool) =>
    hasExplainableCurrentAnalysis || tool.name !== 'explain_results',
  );

  // Pre-LLM tool filtering: restrict tool definitions to stage-allowed tools only.
  // Uses isToolAllowedAtStage (same logic as the post-LLM guard in phase4) so that
  // intent-gated tools — research_topic in FRAME (requires explicit research intent)
  // and draft_graph in IDEATE (requires explicit rebuild intent) — are filtered
  // correctly before the LLM sees them. This prevents suppress-and-fallback turns
  // when the LLM would have selected a tool that phase4 would block anyway.
  // Unknown stage → isToolAllowedAtStage returns allowed:true (permissive fallback).
  const toolDefs = allToolDefs.filter((tool) => {
    const guard = isToolAllowedAtStage(tool.name, currentStage, userMessage);
    if (!guard.allowed) {
      log.debug(
        { stage: currentStage, tool_filtered: tool.name, reason: guard.reason, request_id: requestId },
        'phase3: tool filtered from LLM context by stage policy',
      );
    }
    return guard.allowed;
  });

  if (allToolDefs.length !== toolDefs.length) {
    log.info(
      {
        request_id: requestId,
        stage: currentStage,
        tools_before: allToolDefs.map(t => t.name),
        tools_after: toolDefs.map(t => t.name),
        filtered_count: allToolDefs.length - toolDefs.length,
      },
      'phase3: stage policy filtered tool definitions before LLM call',
    );
  }

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
      route_metadata: {
        outcome: 'default_llm',
        reasoning: 'no_tool_support_fallback',
        prompt_hash: promptMeta.prompt_hash ?? null,
        prompt_version: promptMeta.prompt_version ?? null,
      },
      route_debug: {
        ...routeDebugBase,
        final_intent_gate: summariseIntentGate(effectiveIntentGate),
      },
    };
  }

  const llmResult = await llmClient.chatWithTools(
    {
      system: systemPrompt,
      system_cache_blocks: assembled.cache_blocks,
      messages,
      tools: toolDefs,
      tool_choice: { type: 'auto' },
      maxTokens: getMaxTokensFromConfig('orchestrator'),
    },
    { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
  );

  // Resolve model observability after the call (adapter is selected lazily inside client).
  const resolvedModelInfo = llmClient.getResolvedModel?.() ?? null;
  log.info(
    {
      request_id: requestId,
      task: 'orchestrator',
      resolved_model: resolvedModelInfo?.model ?? null,
      resolved_provider: resolvedModelInfo?.provider ?? null,
    },
    'phase3.llm_call_resolved_model',
  );

  const parsed = parseV2Response(llmResult);

  // Cache metrics — include only when present (graceful degradation for non-Anthropic providers)
  const llmUsage = llmResult.usage;
  const cacheMetrics = llmUsage && (llmUsage.cache_read_input_tokens !== undefined || llmUsage.cache_creation_input_tokens !== undefined)
    ? {
        cache_creation_input_tokens: llmUsage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: llmUsage.cache_read_input_tokens ?? 0,
        cache_hit: (llmUsage.cache_read_input_tokens ?? 0) > 0,
      }
    : {};

  return {
    ...parsed,
    route_metadata: {
      outcome: 'default_llm',
      reasoning: 'no_deterministic_route_applied',
      resolved_model: resolvedModelInfo?.model ?? null,
      resolved_provider: resolvedModelInfo?.provider ?? null,
      prompt_hash: promptMeta.prompt_hash ?? null,
      prompt_version: promptMeta.prompt_version ?? null,
      ...cacheMetrics,
    },
    route_debug: {
      ...routeDebugBase,
      final_intent_gate: summariseIntentGate(effectiveIntentGate),
      deterministic_override: {
        applied: effectiveIntentGate.tool !== intentGate.tool || effectiveIntentGate.routing !== intentGate.routing,
        reason: !hasExplainableCurrentAnalysis && intentGate.tool === 'explain_results'
          ? 'analysis_not_current_or_not_explainable'
          : shouldAvoidEditGraph
          ? 'edit_graph_bypassed_for_non_edit_answer'
          : null,
      },
      explain_results_selection: {
        considered: intentGate.tool === 'explain_results' || shouldRedirectToResultsExplanation || shouldBlockExplainResults,
        selected: false,
        reason: shouldBlockExplainResults
          ? 'analysis_not_current_or_not_explainable'
          : shouldRedirectToResultsExplanation
          ? 'completed_current_analysis_available_but_llm_fell_through'
          : null,
        explanation_path: null,
      },
      post_analysis_followup: {
        triggered: shouldRedirectToResultsExplanation,
        reason: shouldRedirectToResultsExplanation ? 'completed_current_analysis_available' : null,
      },
      draft_graph_selection: {
        considered: explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph',
        selected: false,
        reason: shouldBlockStableModelRedraft
          ? 'stable_model_exists_and_regenerate_not_requested'
          : explicitGenerate.kind === 'none' && intentGate.tool === 'draft_graph'
          ? 'draft_graph_not_selected'
          : explicitGenerate.kind === 'deterministic'
          ? explicitGenerate.reasoning
          : null,
      },
    },
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

function summariseIntentGate(intentGate: Pick<IntentGateResult, 'routing' | 'tool' | 'matched_pattern' | 'confidence'>): IntentGateDebugSummary {
  return {
    routing: intentGate.routing,
    tool: intentGate.tool,
    matched_pattern: intentGate.matched_pattern ?? null,
    confidence: intentGate.confidence ?? null,
  };
}

function buildRouteDebugBase(
  intentGate: IntentGateResult,
  clarificationToolInput: Record<string, unknown> | null,
  proposalFollowUp: PendingProposalContinuation,
  explicitGenerate: ExplicitGenerateRoute,
  shouldRedirectToResultsExplanation: boolean,
  rationaleOnlyFollowUp: boolean,
  hasExplainableCurrentAnalysis: boolean,
): Phase3RouteDebug {
  return {
    initial_intent_gate: summariseIntentGate(intentGate),
    final_intent_gate: summariseIntentGate(intentGate),
    deterministic_override: {
      applied: false,
      reason: null,
    },
    explicit_generate_override: {
      considered: explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph',
      applied: explicitGenerate.kind === 'deterministic',
      reason: explicitGenerate.kind === 'none' ? null : explicitGenerate.reasoning,
    },
    explain_results_selection: {
      considered: intentGate.tool === 'explain_results' || shouldRedirectToResultsExplanation || rationaleOnlyFollowUp,
      selected: shouldRedirectToResultsExplanation,
      reason: shouldRedirectToResultsExplanation
        ? 'completed_current_analysis_available'
        : rationaleOnlyFollowUp
        ? 'analysis_not_current_or_not_explainable'
        : !hasExplainableCurrentAnalysis && intentGate.tool === 'explain_results'
        ? 'analysis_not_current_or_not_explainable'
        : null,
      explanation_path: rationaleOnlyFollowUp
        ? 'rationale_explanation'
        : shouldRedirectToResultsExplanation
        ? 'results_explanation'
        : null,
    },
    clarification_continuation: {
      present: clarificationToolInput !== null,
      grouped: Array.isArray(clarificationToolInput?.grouped_target_labels),
    },
    pending_proposal_followup: {
      present: proposalFollowUp !== null,
      action: proposalFollowUp?.action ?? null,
    },
    post_analysis_followup: {
      triggered: false,
      reason: null,
    },
    draft_graph_selection: {
      considered: explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph',
      selected: false,
      reason: explicitGenerate.kind === 'none' ? null : explicitGenerate.reasoning,
    },
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
      (label) =>
        normalisedInput.includes(normaliseLabelText(label))
        || normaliseLabelText(label).includes(normalisedInput),
    );
    if (substringMatches.length === 1) {
      return { edit_description: `${pending.original_edit_request} for ${substringMatches[0]}` };
    }
  }

  const tokenMatch = resolveSingleCandidateTokenMatch(normalisedInput, pending.candidate_labels);
  if (tokenMatch) {
    return { edit_description: `${pending.original_edit_request} for ${tokenMatch}` };
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

function resolveSingleCandidateTokenMatch(
  normalisedInput: string,
  candidateLabels: string[],
): string | null {
  const informativeTokens = normalisedInput
    .split(' ')
    .map((token) => token.trim())
    .filter((token) =>
      token.length >= 4
      && !['that', 'this', 'with', 'from', 'option', 'factor', 'node'].includes(token),
    );
  if (informativeTokens.length === 0) return null;

  const matches = candidateLabels.filter((label) => {
    const candidate = normaliseLabelText(label);
    return informativeTokens.every((token) => candidate.includes(token));
  });
  return matches.length === 1 ? matches[0] : null;
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

function determineExplanationRoute(
  enrichedContext: EnrichedContext,
  userMessage: string,
  intentGate: IntentGateResult,
  freshTurnIntent: ReturnType<typeof classifyUserIntent>,
  hasExplainableCurrentAnalysis: boolean,
): {
  kind: 'none' | 'rationale' | 'results';
  reasoning: string | null;
  considered: boolean;
} {
  const isExplanationRequest = (
    intentGate.tool === 'explain_results'
    || freshTurnIntent === 'explain'
    || freshTurnIntent === 'recommend'
    || /\bwhy\b|\brecommend(?:ed|ation)?\b|\bwalk me through\b|\bbreak it down\b|\bexplain\b/i.test(userMessage)
  );
  if (!isExplanationRequest) {
    return { kind: 'none', reasoning: null, considered: false };
  }
  if (hasExplainableCurrentAnalysis) {
    return {
      kind: 'results',
      reasoning: 'completed_current_analysis_available',
      considered: true,
    };
  }
  if (!enrichedContext.graph && !enrichedContext.framing) {
    return { kind: 'none', reasoning: null, considered: true };
  }
  if (/\bwhy\b|\brecommend(?:ed|ation)?\b|\bwalk me through\b|\bbreak it down\b/i.test(userMessage) || freshTurnIntent === 'recommend') {
    return {
      kind: 'rationale',
      reasoning: 'analysis_not_current_or_not_explainable',
      considered: true,
    };
  }
  return { kind: 'none', reasoning: null, considered: true };
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

  // When generate_model is explicitly set (UI "Generate Model" button), bypass the
  // minimum-context check — the user has decided to draft NOW with whatever context
  // exists. The user's message IS the brief; don't ask for more framing.
  const isButtonTriggered = intentGate.matched_pattern === 'generate_model';
  if (!isButtonTriggered && !hasMinimumViableFramingContext(context, userMessage)) {
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
  const conversationalState = context.conversational_state as unknown as Record<string, unknown> | null;
  const goal = typeof context.framing?.goal === 'string' ? context.framing.goal.trim() : '';
  const optionsCount = Array.isArray(framing?.options)
    ? framing.options.filter((option) => typeof option === 'string' && option.trim().length > 0).length
    : 0;
  const constraintCount = Array.isArray(framing?.constraints)
    ? framing.constraints.filter((constraint) => typeof constraint === 'string' && constraint.trim().length > 0).length
    : 0;
  const conversationalConstraintCount = Array.isArray(conversationalState?.stated_constraints)
    ? conversationalState.stated_constraints.filter((constraint) => typeof constraint === 'string' && constraint.trim().length > 0).length
    : 0;
  const userTurns = [...context.messages, { role: 'user' as const, content: userMessage }]
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((content) => content.length >= 8);
  const combinedLength = userTurns.join(' ').length;
  const hasGoal = goal.length > 0;
  const hasOptions = optionsCount > 0;
  const hasConstraints = constraintCount > 0 || conversationalConstraintCount > 0;
  const structuredSignals = [hasGoal, hasOptions, hasConstraints].filter(Boolean).length;

  return structuredSignals >= 2
    || (hasGoal && userTurns.length >= 2 && combinedLength >= 80)
    || (hasOptions && hasConstraints)
    || combinedLength >= 140;
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

  if (!goal) missing.push('the decision goal');
  if (optionsCount === 0) missing.push('the main options to compare');
  if (constraintCount === 0) missing.push('the biggest constraint or trade-off');

  if (missing.length === 1) {
    return `I can draft it once I have ${missing[0]}.`;
  }
  const prompts = missing.slice(0, 2).map((item, index) => `${index + 1}. ${item}`);
  return `I can draft it once I have:\n${prompts.join('\n')}`;
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

// ============================================================================
// Streaming Support
// ============================================================================

import type { ChatWithToolsArgs, CallOpts } from "../types.js";

/**
 * Prepare phase3 for streaming: run all deterministic routing, and if the
 * LLM path is needed, return the prepared call args instead of making the call.
 *
 * Does NOT modify phase3Generate — this is a parallel entry point for streaming.
 */
export type Phase3StreamPrep =
  | { kind: 'deterministic'; result: LLMResult }
  | { kind: 'llm'; callArgs: ChatWithToolsArgs; callOpts: CallOpts; postProcess: (llmResult: import("../../../adapters/llm/types.js").ChatWithToolsResult) => LLMResult };

export async function phase3PrepareForStreaming(
  enrichedContext: EnrichedContext,
  specialistResult: SpecialistResult,
  llmClient: LLMClient,
  requestId: string,
  userMessage: string,
  initialIntentGate?: IntentGateResult,
): Promise<Phase3StreamPrep> {
  // Replicate the same deterministic routing as phase3Generate
  const intentGate = initialIntentGate ?? classifyIntent(userMessage);
  const context = buildConversationContext(enrichedContext);
  const clarificationToolInput = buildClarificationContinuationInput(enrichedContext, userMessage);
  const proposalFollowUp = buildPendingProposalContinuation(enrichedContext, userMessage);
  const freshTurnIntent = classifyUserIntent(userMessage);
  const hasExplainableCurrentAnalysis = isResultsExplanationEligible(
    enrichedContext.stage_indicator.stage,
    enrichedContext.analysis,
  );
  const explanationRoute = determineExplanationRoute(
    enrichedContext, userMessage, intentGate, freshTurnIntent, hasExplainableCurrentAnalysis,
  );
  const explicitGenerate = buildExplicitGenerateRoute(enrichedContext, userMessage, intentGate, context);
  const shouldBlockExplainResults = intentGate.tool === 'explain_results' && explanationRoute.kind !== 'results';
  const shouldBlockStableModelRedraft = intentGate.tool === 'draft_graph'
    && hasStableModel(enrichedContext)
    && !isClearRegenerateRequest(userMessage);
  const editResolutionMode = (clarificationToolInput || proposalFollowUp?.action === 'confirm' || intentGate.tool === 'edit_graph')
    ? determineEditResolutionMode(userMessage, context)
    : null;
  const shouldAvoidEditGraph = editResolutionMode === 'no_edit_answer';
  const shouldRedirectToResultsExplanation = hasExplainableCurrentAnalysis
    && explanationRoute.kind === 'results'
    && (
      intentGate.tool === 'explain_results'
      || intentGate.tool === 'edit_graph'
      || freshTurnIntent === 'explain'
      || freshTurnIntent === 'recommend'
      || shouldAvoidEditGraph
    );

  // Try the same deterministic paths as phase3Generate — calling phase3Generate
  // for all deterministic cases ensures exact behavioral parity.
  // Deterministic detection: if phase3Generate would NOT reach the LLM call,
  // just call it directly and return the result.
  const isDeterministic = (
    proposalFollowUp?.action === 'dismiss'
    || proposalFollowUp?.action === 'stale'
    || (explicitGenerate.kind === 'clarify')
    || shouldBlockStableModelRedraft
    || (explanationRoute.kind === 'rationale')
    || shouldRedirectToResultsExplanation
    || (explicitGenerate.kind === 'deterministic')
    || (proposalFollowUp?.action === 'confirm')
    || (clarificationToolInput !== null)
    || (intentGate.tool && intentGate.routing === 'deterministic')
  );

  if (isDeterministic) {
    const result = await phase3Generate(
      enrichedContext, specialistResult, llmClient, requestId, userMessage, initialIntentGate,
    );
    return { kind: 'deterministic', result };
  }

  // LLM path: prepare the call args
  const assembled2 = await assembleV2SystemPrompt(enrichedContext);
  const systemPrompt = assembled2.text;
  if (systemPrompt.length < 1000) {
    log.warn({ system_prompt_length: systemPrompt.length }, 'phase3: suspiciously short system prompt for streaming');
  }
  const promptMeta = getSystemPromptMeta('orchestrator');
  const effectiveUserMessage = buildEffectiveUserMessage(enrichedContext, userMessage);
  const messages = assembleMessages(context, effectiveUserMessage);
  const currentStage = enrichedContext.stage_indicator.stage;
  const allToolDefs = assembleToolDefinitions(getToolDefinitions()).filter((tool) =>
    hasExplainableCurrentAnalysis || tool.name !== 'explain_results',
  );
  const toolDefs = allToolDefs.filter((tool) => {
    const guard = isToolAllowedAtStage(tool.name, currentStage, userMessage);
    return guard.allowed;
  });

  const routeDebugBase = buildRouteDebugBase(
    intentGate, clarificationToolInput, proposalFollowUp, explicitGenerate,
    shouldRedirectToResultsExplanation, explanationRoute.kind === 'rationale',
    hasExplainableCurrentAnalysis,
  );

  const effectiveIntentGate = intentGate;

  const callArgs: ChatWithToolsArgs = {
    system: systemPrompt,
    system_cache_blocks: assembled2.cache_blocks,
    messages,
    tools: toolDefs,
    tool_choice: { type: 'auto' },
    maxTokens: getMaxTokensFromConfig('orchestrator'),
  };

  const callOpts: CallOpts = {
    requestId,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  };

  const postProcess = (llmResult: import("../../../adapters/llm/types.js").ChatWithToolsResult): LLMResult => {
    const resolvedModelInfo = llmClient.getResolvedModel?.() ?? null;
    const parsed = parseV2Response(llmResult);

    // Cache metrics — include only when present (graceful degradation for non-Anthropic providers)
    const llmUsage = llmResult.usage;
    const streamCacheMetrics = llmUsage && (llmUsage.cache_read_input_tokens !== undefined || llmUsage.cache_creation_input_tokens !== undefined)
      ? {
          cache_creation_input_tokens: llmUsage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: llmUsage.cache_read_input_tokens ?? 0,
          cache_hit: (llmUsage.cache_read_input_tokens ?? 0) > 0,
        }
      : {};

    return {
      ...parsed,
      route_metadata: {
        outcome: 'default_llm',
        reasoning: 'no_deterministic_route_applied',
        resolved_model: resolvedModelInfo?.model ?? null,
        resolved_provider: resolvedModelInfo?.provider ?? null,
        prompt_hash: promptMeta.prompt_hash ?? null,
        prompt_version: promptMeta.prompt_version ?? null,
        ...streamCacheMetrics,
      },
      route_debug: {
        ...routeDebugBase,
        final_intent_gate: summariseIntentGate(effectiveIntentGate),
        deterministic_override: {
          applied: false,
          reason: shouldAvoidEditGraph ? 'edit_graph_bypassed_for_non_edit_answer' : null,
        },
        explain_results_selection: {
          considered: false,
          selected: false,
          reason: null,
          explanation_path: null,
        },
        post_analysis_followup: {
          triggered: false,
          reason: null,
        },
        draft_graph_selection: {
          considered: explicitGenerate.kind !== 'none' || intentGate.tool === 'draft_graph',
          selected: false,
          reason: null,
        },
      },
    };
  };

  return { kind: 'llm', callArgs, callOpts, postProcess };
}

