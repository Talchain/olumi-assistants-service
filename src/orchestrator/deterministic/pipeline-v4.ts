/**
 * Pipeline v4 — Native Tool-Use Pipeline
 *
 * Single pipeline for all turn types. Uses Anthropic native tool calling
 * instead of JSON-contract parsing. One routing path, one assembler,
 * one normaliser.
 *
 * Execution classes:
 * 1. Deterministic (no LLM): system events, pending confirmations
 * 2. LLM with tools (standard turn): user message + eligible action tools
 * 3. LLM with forced tool (chip click): tool_choice: { type: 'tool', name }
 *
 * Feature flag: CEE_PIPELINE_V4_ENABLED
 */

import { randomUUID } from "node:crypto";
import type { OrchestratorTurnRequest, ConversationContext } from "../types.js";
import type { DeterministicTurnContext, ActionResult } from "./types.js";
import type { ActionName } from "./actions/types.js";
import type { OrchestratorStreamEvent } from "../pipeline/stream-events.js";
import type { OrchestratorResponseEnvelopeV2 } from "../pipeline/types.js";
import type { ChatWithToolsStreamEvent } from "../../adapters/llm/types.js";
import { computeTurnContext } from "./turn-context.js";
import { handleSystemEvent } from "./system-event-handler.js";
import { handlePendingConfirmation } from "./confirmation-flow.js";
import { buildDeterministicPromptV2 } from "./prompt-builder-v2.js";
import { buildToolDefinitions } from "./tool-builder.js";
import { buildDeterministicChips } from "./chip-builder-v4.js";
import { processAdapterStream } from "./stream-handler-v4.js";
import type { StreamHandlerResult } from "./stream-handler-v4.js";
import { normaliseDeterministicResponse, scanBannedTerms } from "./response-normaliser.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";
import { assembleMessages } from "../prompt-assembly.js";
import { sanitiseAssistantHistory } from "./pipeline.js";
import { filterHistoryV4 } from "./history-filter-v4.js";
import { computeContextHash } from "../context/context-hash.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import { log, emit } from "../../utils/telemetry.js";
import { STREAM_ERROR_CODES } from "../pipeline/stream-events.js";
import type { GuidanceItem } from "../types/guidance-item.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute the v4 native tool-use pipeline as a streaming generator.
 *
 * Yields OrchestratorStreamEvent for SSE delivery. All turn types
 * (system events, normal messages, chip clicks, generate_model)
 * are handled through this single pipeline.
 */
export async function* executePipelineV4(
  turnRequest: OrchestratorTurnRequest,
  requestId: string,
  signal?: AbortSignal,
  /** Fastify request — needed by draft_graph action to call the unified pipeline. */
  fastifyRequest?: import("fastify").FastifyRequest,
): AsyncGenerator<OrchestratorStreamEvent> {
  const turnId = randomUUID();
  const startTime = Date.now();
  let seq = 0;

  try {
    // ── Class 1: System events (deterministic, no LLM) ──────────────
    const systemEventResult = handleSystemEvent(turnRequest, turnId, requestId);
    if (systemEventResult) {
      yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing: 'deterministic', stage: turnRequest.context?.framing?.stage ?? 'frame' };
      yield { type: 'turn_complete', seq: seq++, envelope: systemEventResult.envelope as unknown as OrchestratorResponseEnvelopeV2 };

      log.info({
        request_id: requestId,
        turn_id: turnId,
        execution_class: 'system_event',
        event_type: turnRequest.system_event?.event_type,
        duration_ms: Date.now() - startTime,
      }, 'v4.turn_context');
      return;
    }

    // ── Compute TurnContext ──────────────────────────────────────────
    let turnContext: DeterministicTurnContext;
    let contextFallbackUsed = false;

    try {
      turnContext = computeTurnContext(turnRequest);
      turnContext.turn_id = turnId;
      // Thread FastifyRequest for draft_graph action
      turnContext.request = fastifyRequest;
    } catch (error) {
      contextFallbackUsed = true;
      log.warn({ request_id: requestId, error: error instanceof Error ? error.message : String(error) }, 'v4.turn_context_fallback');
      turnContext = buildFallbackContext(turnRequest, turnId);
    }

    const effectiveMessage = turnRequest.message?.trim() ?? '';
    const stage = turnContext.stage;

    log.info({
      request_id: requestId,
      turn_id: turnId,
      stage,
      turn_count: turnContext.conversation.turn_count,
      entity_count: turnContext.entities.nodes.size,
      eligible_actions_count: turnContext.eligible_actions.length,
      execution_class: determineExecutionClass(turnRequest, turnContext, effectiveMessage),
      generate_model: !!turnRequest.generate_model,
    }, 'v4.turn_context');

    if (signal?.aborted) return;

    // ── Class 1b: Pending confirmation (deterministic, no LLM) ──────
    if (effectiveMessage) {
      const confirmResult = handlePendingConfirmation(effectiveMessage, turnContext);
      if (confirmResult.handled && confirmResult.actionResult) {
        yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing: 'deterministic', stage };

        // Yield blocks from confirmed action
        for (const block of confirmResult.actionResult.blocks) {
          yield { type: 'block', seq: seq++, block };
        }

        const envelope = assembleV4Envelope({
          turnContext,
          turnId,
          assistantText: confirmResult.actionResult.assistantText,
          actionResult: confirmResult.actionResult,
          routing: 'deterministic',
          executedAction: confirmResult.executedProposal?.action_type as ActionName ?? null,
          contextFallbackUsed,
        });

        yield { type: 'turn_complete', seq: seq++, envelope };
        return;
      }
    }

    if (signal?.aborted) return;

    // ── Class 2/3: LLM call with tools ──────────────────────────────
    const routing: 'deterministic' | 'llm' = 'llm';
    yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing, stage };

    // Build prompt
    const prompt = buildDeterministicPromptV2(turnContext);

    // Build tool definitions — add draft_graph when generate_model or no graph
    const eligibleActions = [...turnContext.eligible_actions];
    if (turnRequest.generate_model || !turnContext.graph) {
      if (!eligibleActions.includes('draft_graph')) {
        eligibleActions.push('draft_graph');
      }
    }
    const toolDefs = buildToolDefinitions(eligibleActions as ActionName[]);

    // Determine tool_choice
    const chipAction = turnRequest.chip_metadata?.action_type as ActionName | undefined;
    const toolChoice = chipAction && ACTION_CATALOGUE.has(chipAction)
      ? { type: 'tool' as const, name: chipAction }
      : { type: 'auto' as const };

    // Build messages
    const conversationContext: ConversationContext = turnRequest.context ?? {
      messages: [],
      framing: { stage: 'frame' },
    };
    const messages = filterHistoryV4(sanitiseAssistantHistory(assembleMessages(conversationContext, effectiveMessage)));

    // Get adapter
    const adapter = getAdapter('anthropic');

    log.info({
      request_id: requestId,
      messages_sent: messages.length,
      system_prompt_chars: prompt.static_block.length + prompt.dynamic_block.length,
      has_cache_blocks: true,
      tool_count: toolDefs.length,
      tool_choice: toolChoice.type === 'tool' ? `forced:${toolChoice.name}` : toolChoice.type,
    }, 'v4.llm_call');

    if (signal?.aborted) return;

    // Stream the LLM call — omit tools/tool_choice when no tools available
    const hasTools = toolDefs.length > 0;
    const stream = adapter.streamChatWithTools!(
      {
        system: prompt.static_block, // fallback if adapter ignores cache blocks
        system_cache_blocks: [
          { type: 'text', text: prompt.static_block, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt.dynamic_block },
        ],
        messages,
        tools: hasTools ? toolDefs : [],
        ...(hasTools ? { tool_choice: toolChoice } : {}),
        temperature: 0,
        maxTokens: 2048,
      },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS, signal },
    );

    // Process stream — yields text_delta, tool_start, block, tool_result events
    const streamGen = processAdapterStream(stream, turnContext, requestId);
    let streamResult: StreamHandlerResult | undefined;

    while (true) {
      const { value, done } = await streamGen.next();
      if (done) {
        streamResult = value;
        break;
      }
      // Forward events with pipeline seq counter
      yield { ...value, seq: seq++ } as OrchestratorStreamEvent;
      if (signal?.aborted) {
        await streamGen.return(undefined as unknown as StreamHandlerResult);
        return;
      }
    }

    if (!streamResult) {
      throw new Error('Stream handler returned no result');
    }

    const llmDurationMs = Date.now() - startTime;

    log.info({
      request_id: requestId,
      response_text_chars: streamResult.assistantText.length,
      tool_calls_count: streamResult.toolExecution ? 1 : 0,
      discarded_tool_calls: streamResult.discardedToolCalls.length,
      extraction_method: 'native_tool_use',
      duration_ms: llmDurationMs,
    }, 'v4.llm_call');

    // ── Assemble response ─────────────────────────────────────────────
    const executedAction = streamResult.toolExecution?.toolName as ActionName ?? null;
    const actionResult = streamResult.toolExecution?.result ?? null;

    // Surface tool failure in the envelope when no text was produced
    let assistantText = streamResult.assistantText || null;
    if (!assistantText && streamResult.failedToolCall) {
      assistantText = 'Something went wrong while processing your request. Please try again.';
    }

    const envelope = assembleV4Envelope({
      turnContext,
      turnId,
      assistantText,
      actionResult,
      routing,
      executedAction,
      contextFallbackUsed,
      llmLatencyMs: llmDurationMs,
    });

    yield { type: 'turn_complete', seq: seq++, envelope };

  } catch (error) {
    // Emit error event
    const errorCode = resolveErrorCode(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    yield {
      type: 'error',
      seq: seq++,
      error: { code: errorCode, message: errorMessage },
      recoverable: errorCode !== STREAM_ERROR_CODES.PIPELINE_ERROR,
    };

    log.error({
      request_id: requestId,
      turn_id: turnId,
      error_code: errorCode,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    }, 'v4.pipeline_error');

    // Emit error envelope as turn_complete for UI consistency
    const errorEnvelope = {
      turn_id: turnId,
      assistant_text: null,
      blocks: [],
      lineage: { context_hash: '' },
      turn_plan: { selected_tool: null, routing: 'llm' as const, long_running: false },
      stage_indicator: turnRequest.context?.framing?.stage ?? 'frame',
      response_version: 2,
      guidance_items: [],
      error: {
        code: errorCode,
        message: errorMessage,
        recoverable: errorCode !== STREAM_ERROR_CODES.PIPELINE_ERROR,
      },
    } as unknown as OrchestratorResponseEnvelopeV2;

    yield { type: 'turn_complete', seq: seq++, envelope: errorEnvelope };
  }
}

// ============================================================================
// Response Assembly
// ============================================================================

interface AssembleInput {
  turnContext: DeterministicTurnContext;
  turnId: string;
  assistantText: string | null;
  actionResult: ActionResult | null;
  routing: 'deterministic' | 'llm';
  executedAction: ActionName | null;
  contextFallbackUsed: boolean;
  llmLatencyMs?: number;
}

/**
 * Assemble the v4 response envelope.
 *
 * Chips are built deterministically — no LLM input.
 * Assistant text comes directly from LLM text blocks (never JSON).
 */
function assembleV4Envelope(input: AssembleInput): OrchestratorResponseEnvelopeV2 {
  const {
    turnContext,
    turnId,
    assistantText: rawAssistantText,
    actionResult,
    routing,
    executedAction,
    contextFallbackUsed,
    llmLatencyMs,
  } = input;

  // Combine assistant text: action confirmation + LLM text
  let assistantText = rawAssistantText;
  if (actionResult?.assistantText && rawAssistantText) {
    assistantText = `${actionResult.assistantText}\n\n${rawAssistantText}`;
  } else if (actionResult?.assistantText) {
    assistantText = actionResult.assistantText;
  }

  // Build blocks
  const blocks = [...(actionResult?.blocks ?? [])];

  // Emit graph_patch block for graph-mutating actions
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

  // Build chips deterministically — no LLM input
  const suggestedActions = buildDeterministicChips(turnContext, executedAction);

  // Build lineage
  const lineage = {
    context_hash: computeContextHash({
      graph: null,
      analysis_response: null,
      framing: turnContext.stage ? { stage: turnContext.stage } : null,
    }),
    ...(actionResult?.applied_graph_hash ? { graph_hash: actionResult.applied_graph_hash } : {}),
  };

  // Build turn plan
  const executedTools = executedAction ? [executedAction] : [];
  const turnPlan = {
    selected_tool: executedAction,
    routing,
    long_running: executedAction === 'run_analysis' || executedAction === 'draft_graph',
    ...(llmLatencyMs != null ? { tool_latency_ms: llmLatencyMs } : {}),
    executed_tools: executedTools,
    deferred_tools: [] as string[],
  };

  // Collect guidance items
  let guidanceItems: GuidanceItem[] = [...(actionResult?.guidance_items ?? [])];
  if (
    (executedTools.includes('run_analysis') || executedTools.includes('explain_result')) &&
    turnContext.analysis &&
    guidanceItems.length === 0
  ) {
    try {
      const postAnalysis = generatePostAnalysisGuidance(turnContext.analysis, turnContext.graph);
      if (postAnalysis.length > 0) {
        guidanceItems = [...guidanceItems, ...postAnalysis];
      }
    } catch {
      // Non-fatal
    }
  }

  // Assemble envelope
  const envelope = {
    turn_id: turnId,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions.length > 0 ? suggestedActions : undefined,
    analysis_response: actionResult?.analysis_response,
    lineage,
    turn_plan: turnPlan,
    stage_indicator: turnContext.stage,
    response_version: 2 as const,
    guidance_items: guidanceItems,
  };

  // Apply normaliser
  const normalised = normaliseDeterministicResponse(envelope);

  // Scan banned terms
  scanBannedTerms(
    null, // no LLM JSON response — text comes from native tool-use
    normalised,
    turnContext.scenario_id,
    turnId,
  );

  return normalised as unknown as OrchestratorResponseEnvelopeV2;
}

// ============================================================================
// Helpers
// ============================================================================

function determineExecutionClass(
  turnRequest: OrchestratorTurnRequest,
  _turnContext: DeterministicTurnContext,
  effectiveMessage: string,
): string {
  if (turnRequest.system_event) return 'system_event';
  if (turnRequest.chip_metadata?.action_type) return 'forced_tool';
  if (turnRequest.generate_model) return 'generate_model';
  if (!effectiveMessage) return 'empty_message';
  return 'standard_turn';
}

function buildFallbackContext(turnRequest: OrchestratorTurnRequest, turnId: string): DeterministicTurnContext {
  return {
    stage: turnRequest.context?.framing?.stage ?? 'frame',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: false, can_explain_results: false, can_edit_graph: false, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph: turnRequest.context?.graph ?? null,
    analysis: turnRequest.context?.analysis_response ?? null,
    conversational_state: null,
    scenario_id: turnRequest.scenario_id ?? '',
    turn_id: turnId,
    analysis_inputs: null,
    request: undefined,
  };
}

function resolveErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return STREAM_ERROR_CODES.TURN_BUDGET_EXCEEDED;
    if (error.message.includes('timeout')) return STREAM_ERROR_CODES.LLM_TIMEOUT;
  }
  return STREAM_ERROR_CODES.PIPELINE_ERROR;
}
