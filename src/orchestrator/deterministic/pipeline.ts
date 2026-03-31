/**
 * Deterministic Pipeline — Main Entry Point
 *
 * Orchestrates the three-layer architecture:
 * 1. Compute TurnContext (Layer 0)
 * 2. Check pending confirmation/clarification
 * 3. Classify intent → direct action or LLM
 * 4. LLM call → validate recommendations
 * 5. Execute actions
 * 6. Assemble response
 *
 * Feature flag: CEE_DETERMINISTIC_ORCHESTRATOR_ENABLED
 */

import { randomUUID } from "node:crypto";
import type { OrchestratorTurnRequest, ConversationContext } from "../types.js";
import type { DeterministicPipelineResult, DeterministicTurnContext, LLMJsonResponse, ActionResult } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { computeTurnContext } from "./turn-context.js";
import { handlePendingConfirmation, storePendingProposal, buildProposal } from "./confirmation-flow.js";
import { buildDeterministicPrompt } from "./llm-prompt.js";
import { parseLLMJsonResponse } from "./llm-response-parser.js";
import { assembleDeterministicResponse } from "./response-assembler.js";
import { ACTION_CATALOGUE, isValidAction } from "./actions/registry.js";
import { classifyIntent } from "../intent-gate.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import { log, emit } from "../../utils/telemetry.js";
import { createProposalBlock } from "../blocks/factory.js";
import { StreamingTextExtractor } from "./streaming-text-extractor.js";
import type { OrchestratorStreamEvent } from "../pipeline/stream-events.js";
import type { OrchestratorResponseEnvelopeV2 } from "../pipeline/types.js";
import { assembleMessages } from "../prompt-assembly.js";

// ============================================================================
// Intent → Action Mapping
// ============================================================================

/**
 * Map legacy tool names from intent gate to deterministic action names.
 */
const TOOL_TO_ACTION: Record<string, ActionName> = {
  run_analysis: 'run_analysis',
  explain_results: 'explain_result',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute the deterministic intelligence pipeline for a turn.
 */
export async function executeDeterministicPipeline(
  turnRequest: OrchestratorTurnRequest,
  requestId: string,
): Promise<DeterministicPipelineResult> {
  const turnId = randomUUID();
  const startTime = Date.now();

  emit('deterministic.pipeline.started', { request_id: requestId, turn_id: turnId });

  // ── Layer 0: Compute TurnContext ──────────────────────────────────────────
  let turnContext: DeterministicTurnContext;
  let contextFallbackUsed = false;

  try {
    turnContext = computeTurnContext(turnRequest);
    turnContext.turn_id = turnId;
  } catch (err) {
    log.warn({ request_id: requestId, err }, 'deterministic.turn_context_fallback');
    contextFallbackUsed = true;
    // Minimal fallback context — preserves scenario_id and stage if extractable
    const ctx = turnRequest.context;
    turnContext = {
      stage: 'frame',
      entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: ['context computation failed'] },
      analysis_summary: null,
      capabilities: { can_run_analysis: false, can_explain_results: false, can_compare_options: false, can_edit_graph: false, can_challenge: false, can_generate_artefact: false },
      blockers: [],
      signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
      conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
      eligible_actions: [],
      disambiguation_hints: [],
      graph: ctx.graph ?? turnRequest.graph_state ?? null,
      analysis: ctx.analysis_response ?? turnRequest.analysis_state ?? null,
      conversational_state: ctx.conversational_state ?? null,
      scenario_id: ctx.scenario_id,
      turn_id: turnId,
      analysis_inputs: ctx.analysis_inputs ?? null,
    };
  }

  log.info({
    request_id: requestId,
    stage: turnContext.stage,
    eligible_actions: turnContext.eligible_actions,
    node_count: turnContext.graph_summary.node_count,
    has_analysis: turnContext.analysis_summary != null,
    context_fallback_used: contextFallbackUsed,
    turn_count: turnContext.conversation.turn_count,
    messages_in_history: turnRequest.context?.messages?.length ?? 0,
    entity_count: turnContext.entities.nodes.size,
  }, 'deterministic.turn_context_computed');

  // ── Check pending confirmation ────────────────────────────────────────────
  const confirmResult = handlePendingConfirmation(turnRequest.message, turnContext);
  if (confirmResult.handled) {
    emit('deterministic.confirmation.handled', {
      request_id: requestId,
      confirmed: !confirmResult.cleared,
    });
    const confResult = assembleDeterministicResponse({
      turnContext,
      llmResponse: null,
      actionResult: confirmResult.actionResult ?? null,
      turnId,
      routing: 'deterministic',
      selectedAction: null,
      executedActions: [],
      contextFallbackUsed,
    });
    emitQualityTelemetry(confResult, turnRequest.context.scenario_id, turnId);
    return confResult;
  }

  // ── Chip metadata: bypass intent classification ──────────────────────────
  let directAction: ActionName | null = null;
  let chipParams: Record<string, unknown> | null = null;

  if (turnRequest.chip_metadata) {
    const chipAction = turnRequest.chip_metadata.action_type;
    if (isValidAction(chipAction)) {
      // Trust chip metadata — skip classifyIntent entirely.
      // Eligibility is handled downstream via prerequisite checks.
      directAction = chipAction as ActionName;
      chipParams = turnRequest.chip_metadata.parameters ?? {};
      emit('deterministic.chip_metadata.matched', {
        request_id: requestId,
        action: directAction,
      });
    }
  }

  // ── Intent classification (skipped when chip_metadata resolved) ─────────
  if (!directAction) {
    const intentResult = classifyIntent(turnRequest.message);
    if (intentResult.routing === 'deterministic' && intentResult.tool) {
      const mapped = TOOL_TO_ACTION[intentResult.tool];
      if (mapped && turnContext.eligible_actions.includes(mapped)) {
        directAction = mapped;
      }
    }
  }

  // ── Direct action dispatch (chip click or deterministic match) ───────────
  if (directAction) {
    const actionDef = ACTION_CATALOGUE.get(directAction);
    if (actionDef) {
      const prereqError = actionDef.prerequisite_checks(turnContext);
      if (prereqError) {
        // For chip clicks, return the prereq error instead of falling through
        if (chipParams) {
          emit('deterministic.chip_prereq_failed', {
            request_id: requestId,
            action: directAction,
            reason: prereqError,
          });
          const prereqResult = assembleDeterministicResponse({
            turnContext,
            llmResponse: null,
            actionResult: {
              blocks: [],
              assistantText: prereqError,
              guidance_items: [],
            },
            turnId,
            routing: 'deterministic',
            selectedAction: directAction,
            executedActions: [],
            contextFallbackUsed,
          });
          emitQualityTelemetry(prereqResult, turnRequest.context.scenario_id, turnId);
          return prereqResult;
        }
        // For intent-classified matches, fall through to LLM path
      } else {
        try {
          const actionResult = await actionDef.execute(
            chipParams ?? {},
            turnContext,
          );

          // For confirmable actions, store proposal and emit ProposalBlock
          if (actionDef.requires_confirmation && actionResult.operations && actionResult.operations.length > 0) {
            const proposal = buildProposal(
              directAction,
              actionResult.operations,
              actionResult.assistantText ?? directAction,
              actionResult.operations.map((o) => o.path),
            );
            storePendingProposal(turnContext.scenario_id, {
              proposal_id: proposal.proposal_id,
              action_type: directAction,
              operations: actionResult.operations,
              description: actionResult.assistantText ?? directAction,
              affected_elements: actionResult.operations.map((o) => o.path),
            });

            const proposalBlock = createProposalBlock(proposal, turnId);

            // Return with ProposalBlock but without operations (stored only)
            const proposalResult = assembleDeterministicResponse({
              turnContext,
              llmResponse: null,
              actionResult: {
                blocks: [proposalBlock],
                assistantText: actionResult.assistantText,
                guidance_items: actionResult.guidance_items,
                operations: undefined,
              },
              turnId,
              routing: 'deterministic',
              selectedAction: directAction,
              executedActions: [],
              contextFallbackUsed,
            });
            emitQualityTelemetry(proposalResult, turnRequest.context.scenario_id, turnId);
            return proposalResult;
          }

          emit('deterministic.action.executed', {
            request_id: requestId,
            action: directAction,
            routing: 'deterministic',
          });

          // For actions needing LLM narrative, do a quick LLM call
          let llmResponse: LLMJsonResponse | null = null;
          let llmCallMeta: LLMCallResult | null = null;
          if (!actionResult.assistantText) {
            llmCallMeta = await callLLM(turnContext, turnRequest.message, turnRequest.context, requestId, turnId);
            llmResponse = llmCallMeta?.response ?? null;
          }

          const result = assembleDeterministicResponse({
            turnContext,
            llmResponse,
            actionResult,
            turnId,
            routing: 'deterministic',
            selectedAction: directAction,
            executedActions: [directAction],
            extractionMethod: llmCallMeta?.extraction_method,
            contextFallbackUsed,
            promptCharCount: llmCallMeta?.prompt_char_count,
          });
          emitQualityTelemetry(result, turnRequest.context.scenario_id, turnId);
          return result;
        } catch (err) {
          log.error({ request_id: requestId, action: directAction, err }, 'deterministic.action.failed');
          // For chip clicks, return error instead of silently falling through to LLM
          if (chipParams) {
            const errResult = assembleDeterministicResponse({
              turnContext,
              llmResponse: null,
              actionResult: {
                blocks: [],
                assistantText: 'Something went wrong executing that action. Please try again.',
                guidance_items: [],
              },
              turnId,
              routing: 'deterministic',
              selectedAction: directAction,
              executedActions: [],
              contextFallbackUsed,
            });
            emitQualityTelemetry(errResult, turnRequest.context.scenario_id, turnId);
            return errResult;
          }
        }
      }
    }
  }

  // ── Full LLM call (free text) ────────────────────────────────────────────
  const llmStart = Date.now();
  const llmCallResult = await callLLM(turnContext, turnRequest.message, turnRequest.context, requestId, turnId);
  const llmLatencyMs = Date.now() - llmStart;
  const llmResponse = llmCallResult?.response ?? null;

  // Execute recommended actions that are read-only or have clear intent
  let actionResult: ActionResult | null = null;
  const executedActions: string[] = [];

  if (llmResponse && llmResponse.recommended_actions.length > 0) {
    const firstRec = llmResponse.recommended_actions[0];
    if (isValidAction(firstRec.action_type)) {
      const actionName = firstRec.action_type as ActionName;
      const actionDef = ACTION_CATALOGUE.get(actionName);

      // Auto-execute read-only (none) and low-risk non-confirmable actions.
      // Low-risk actions (add_constraint, set_factor_value, adjust_edge_strength, set_goal_target)
      // are safe graph modifications that don't require confirmation.
      const autoExecutable = actionDef
        && (actionDef.execution_risk === 'none' || (actionDef.execution_risk === 'low' && !actionDef.requires_confirmation))
        && turnContext.eligible_actions.includes(actionName);
      if (autoExecutable) {
        const prereqError = actionDef.prerequisite_checks(turnContext);
        if (!prereqError) {
          try {
            // Extract typed fields from discriminated union into generic params
            const { action_type: _at, priority: _p, rationale: _r, ...recParams } = firstRec;
            actionResult = await actionDef.execute(
              recParams,
              turnContext,
            );
            executedActions.push(actionName);
          } catch (err) {
            log.error({ request_id: requestId, action: actionName, err }, 'deterministic.auto_execute.failed');
          }
        }
      }
    }
  }

  emit('deterministic.pipeline.completed', {
    request_id: requestId,
    turn_id: turnId,
    duration_ms: Date.now() - startTime,
    llm_latency_ms: llmLatencyMs,
    actions_executed: executedActions,
  });

  const result = assembleDeterministicResponse({
    turnContext,
    llmResponse,
    actionResult,
    turnId,
    routing: 'llm',
    selectedAction: executedActions[0] ?? null,
    executedActions,
    llmLatencyMs,
    extractionMethod: llmCallResult?.extraction_method,
    contextFallbackUsed,
    promptCharCount: llmCallResult?.prompt_char_count,
  });
  emitQualityTelemetry(result, turnRequest.context.scenario_id, turnId);
  return result;
}

// ============================================================================
// Quality Telemetry
// ============================================================================

const PROMPT_SIZE_WARN_THRESHOLD = 25_000;

function emitQualityTelemetry(
  result: DeterministicPipelineResult,
  scenarioId: string,
  turnId: string,
): void {
  const q = result._quality;
  if (!q) return;

  emit('deterministic.turn_quality', {
    scenario_id: scenarioId,
    turn_id: turnId,
    ...q,
  });

  if (q.prompt_char_count > PROMPT_SIZE_WARN_THRESHOLD) {
    log.warn({
      scenario_id: scenarioId,
      turn_id: turnId,
      prompt_char_count: q.prompt_char_count,
    }, 'deterministic.prompt_size_exceeded');
  }
}

// ============================================================================
// LLM Call
// ============================================================================

interface LLMCallResult {
  response: LLMJsonResponse;
  extraction_method: 'native' | 'fence' | 'regex' | 'fallback';
  prompt_char_count: number;
  /** Streaming extractor state — only populated for streaming calls. */
  streaming_extractor_state?: 'streaming' | 'fallback';
}

async function callLLM(
  turnContext: DeterministicTurnContext,
  userMessage: string,
  conversationContext: ConversationContext,
  requestId: string,
  turnId: string,
): Promise<LLMCallResult | null> {
  try {
    const adapter = getAdapter('orchestrator');
    const systemPrompt = buildDeterministicPrompt(turnContext);

    // JSON-forcing suffix: aligns with v30.5 prompt evaluation.
    // The prompt + suffix enforce JSON since chatWithTools() has no responseFormat param.
    const effectiveMessage = userMessage + '\n\nRespond with valid JSON only.';

    // Build multi-turn messages from conversation history + current user message.
    // assembleMessages() maps ConversationMessage[] → { role, content }[] pairs.
    const messages = assembleMessages(conversationContext, effectiveMessage);

    let content: string;

    if (adapter.chatWithTools) {
      // Multi-turn path: sends full conversation history to the LLM
      const response = await adapter.chatWithTools(
        {
          system: systemPrompt,
          messages,
          tools: [],
          temperature: 0.3,
          maxTokens: 2048,
        },
        {
          requestId,
          timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
        },
      );

      // Extract text from ToolResponseBlock[] content (chatWithTools response format)
      content = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } else {
      // Fallback for adapters without chatWithTools — loses conversation history
      log.warn({ request_id: requestId }, 'deterministic.llm_call.no_chatWithTools_fallback');
      const response = await adapter.chat(
        {
          system: systemPrompt,
          userMessage: effectiveMessage,
          maxTokens: 2048,
          temperature: 0.3,
          responseFormat: 'json_object',
        },
        {
          requestId,
          timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
        },
      );
      content = response.content;
    }

    const parseResult = parseLLMJsonResponse(content);

    if (parseResult.warnings.length > 0) {
      log.warn({ request_id: requestId, warnings: parseResult.warnings }, 'deterministic.llm_parse_warnings');
    }

    // Emit structured json_fallback event when non-native extraction used
    if (parseResult.extraction_method !== 'native') {
      emit('deterministic.json_fallback', {
        method: parseResult.extraction_method,
        scenario_id: turnContext.scenario_id,
        turn_id: turnId,
      });
    }

    log.info({
      request_id: requestId,
      messages_sent: messages.length,
      system_prompt_chars: systemPrompt.length,
      response_chars: content.length,
      extraction_method: parseResult.extraction_method,
      has_insights: (parseResult.response.insights?.length ?? 0) > 0,
      has_actions: parseResult.response.recommended_actions.length > 0,
    }, 'deterministic.llm_call.completed');

    return {
      response: parseResult.response,
      extraction_method: parseResult.extraction_method,
      // Full compiled system prompt: PMS (or hardcoded fallback) + TurnContext state
      // + eligible_actions vocabulary + disambiguation section (if any).
      prompt_char_count: systemPrompt.length,
    };
  } catch (err) {
    log.error({ request_id: requestId, err }, 'deterministic.llm_call.failed');
    return null;
  }
}

// ============================================================================
// Streaming LLM Call
// ============================================================================

/** Event yielded by the streaming LLM call. */
export type StreamingLLMEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'complete'; result: LLMCallResult };

/**
 * Call the LLM with streaming, yielding progressive text deltas.
 *
 * Yields `text_delta` events as the "text" field streams from the API,
 * then yields a final `complete` event with the full parsed response.
 *
 * Falls back to single-delta if the adapter doesn't support streaming
 * or the JSON structure doesn't have "text" as the first field.
 */
async function* callLLMStreaming(
  turnContext: DeterministicTurnContext,
  userMessage: string,
  conversationContext: ConversationContext,
  requestId: string,
  turnId: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamingLLMEvent> {
  const adapter = getAdapter('orchestrator');
  const systemPrompt = buildDeterministicPrompt(turnContext);
  const effectiveMessage = userMessage + '\n\nRespond with valid JSON only.';
  const promptCharCount = systemPrompt.length;

  // Build multi-turn messages from conversation history + current user message
  const messages = assembleMessages(conversationContext, effectiveMessage);

  // If the adapter doesn't support streaming, fall back to non-streaming
  if (!adapter.streamChatWithTools) {
    const result = await callLLM(turnContext, userMessage, conversationContext, requestId, turnId);
    if (result) {
      if (result.response.text) {
        yield { type: 'text_delta', delta: result.response.text };
      }
      yield { type: 'complete', result };
    }
    return;
  }

  // Stream the LLM response, extracting text progressively
  const pendingDeltas: string[] = [];
  let extractorFallback = false;

  const extractor = new StreamingTextExtractor({
    onTextDelta: (delta) => { pendingDeltas.push(delta); },
    onTextComplete: () => {},
  });

  try {
    const streamArgs = {
      system: systemPrompt,
      messages,
      tools: [],
      temperature: 0.3,
      maxTokens: 2048,
    };

    for await (const event of adapter.streamChatWithTools(streamArgs, { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS, signal })) {
      if (signal?.aborted) break;

      if (event.type === 'text_delta') {
        extractor.push(event.delta);

        // Yield any text deltas the extractor produced from this chunk
        while (pendingDeltas.length > 0) {
          yield { type: 'text_delta', delta: pendingDeltas.shift()! };
        }
      }
    }

    // Capture fallback state BEFORE finish() — finish() transitions fallback → complete
    extractorFallback = extractor.getState() === 'fallback';
    extractor.finish();

    // Flush any remaining deltas
    while (pendingDeltas.length > 0) {
      yield { type: 'text_delta', delta: pendingDeltas.shift()! };
    }
  } catch (err) {
    log.error({ request_id: requestId, err }, 'deterministic.llm_call_streaming.failed');
    return;
  }

  // Parse the full buffer for validation and action extraction
  const fullContent = extractor.getFullBuffer();
  const parseResult = parseLLMJsonResponse(fullContent);

  if (parseResult.warnings.length > 0) {
    log.warn({ request_id: requestId, warnings: parseResult.warnings }, 'deterministic.llm_parse_warnings');
  }

  if (parseResult.extraction_method !== 'native') {
    emit('deterministic.json_fallback', {
      method: parseResult.extraction_method,
      scenario_id: turnContext.scenario_id,
      turn_id: turnId,
    });
  }

  log.info({
    request_id: requestId,
    messages_sent: messages.length,
    system_prompt_chars: promptCharCount,
    response_chars: fullContent.length,
    extraction_method: parseResult.extraction_method,
    has_insights: (parseResult.response.insights?.length ?? 0) > 0,
    has_actions: parseResult.response.recommended_actions.length > 0,
    streaming_fallback: extractorFallback,
  }, 'deterministic.llm_call_streaming.completed');

  // If extractor fell back (text wasn't first field), emit parsed text as single delta
  if (extractorFallback) {
    log.warn({
      buffer_preview: extractor.getFullBuffer().slice(0, 50),
      scenario_id: turnContext.scenario_id,
      turn_id: turnId,
    }, 'deterministic.streaming_extractor_fallback');

    if (parseResult.response.text) {
      yield { type: 'text_delta', delta: parseResult.response.text };
    }
  }

  const extractorState: 'streaming' | 'fallback' = extractorFallback ? 'fallback' : 'streaming';

  yield {
    type: 'complete',
    result: {
      response: parseResult.response,
      extraction_method: parseResult.extraction_method,
      prompt_char_count: promptCharCount,
      streaming_extractor_state: extractorState,
    },
  };
}

// ============================================================================
// Streaming Pipeline Generator
// ============================================================================

/**
 * Execute the deterministic pipeline as a streaming async generator.
 *
 * Yields OrchestratorStreamEvent events for SSE delivery.
 * Text from the LLM streams progressively via the text extractor.
 * Blocks and turn_complete are emitted after the full response is assembled.
 */
export async function* executeDeterministicPipelineStreaming(
  turnRequest: OrchestratorTurnRequest,
  requestId: string,
  signal?: AbortSignal,
): AsyncGenerator<OrchestratorStreamEvent> {
  const turnId = randomUUID();
  const startTime = Date.now();

  emit('deterministic.pipeline.started', { request_id: requestId, turn_id: turnId });

  // ── Layer 0: Compute TurnContext ──────────────────────────────────────────
  let turnContext: DeterministicTurnContext;
  let contextFallbackUsed = false;

  try {
    turnContext = computeTurnContext(turnRequest);
    turnContext.turn_id = turnId;
  } catch (err) {
    log.warn({ request_id: requestId, err }, 'deterministic.turn_context_fallback');
    contextFallbackUsed = true;
    const ctx = turnRequest.context;
    turnContext = {
      stage: 'frame',
      entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: ['context computation failed'] },
      analysis_summary: null,
      capabilities: { can_run_analysis: false, can_explain_results: false, can_compare_options: false, can_edit_graph: false, can_challenge: false, can_generate_artefact: false },
      blockers: [],
      signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
      conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
      eligible_actions: [],
      disambiguation_hints: [],
      graph: ctx.graph ?? turnRequest.graph_state ?? null,
      analysis: ctx.analysis_response ?? turnRequest.analysis_state ?? null,
      conversational_state: ctx.conversational_state ?? null,
      scenario_id: ctx.scenario_id,
      turn_id: turnId,
      analysis_inputs: ctx.analysis_inputs ?? null,
    };
  }

  log.info({
    request_id: requestId,
    stage: turnContext.stage,
    turn_count: turnContext.conversation.turn_count,
    messages_in_history: turnRequest.context?.messages?.length ?? 0,
    entity_count: turnContext.entities.nodes.size,
    context_fallback_used: contextFallbackUsed,
  }, 'deterministic.streaming.turn_context_computed');

  let seq = 0;
  const stage = turnContext.stage;

  yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing: 'deterministic', stage };
  if (signal?.aborted) return;

  // ── Check pending confirmation ────────────────────────────────────────────
  const confirmResult = handlePendingConfirmation(turnRequest.message, turnContext);
  if (confirmResult.handled) {
    emit('deterministic.confirmation.handled', {
      request_id: requestId,
      confirmed: !confirmResult.cleared,
    });
    const confResult = assembleDeterministicResponse({
      turnContext,
      llmResponse: null,
      actionResult: confirmResult.actionResult ?? null,
      turnId,
      routing: 'deterministic',
      selectedAction: null,
      executedActions: [],
      contextFallbackUsed,
    });
    emitQualityTelemetry(confResult, turnRequest.context.scenario_id, turnId);

    if (confResult.envelope.assistant_text) {
      yield { type: 'text_delta', seq: seq++, delta: confResult.envelope.assistant_text };
    }
    for (const block of confResult.envelope.blocks) {
      yield { type: 'block', seq: seq++, block };
    }
    yield { type: 'turn_complete', seq: seq++, envelope: confResult.envelope as unknown as OrchestratorResponseEnvelopeV2 };
    return;
  }

  // ── Chip metadata / intent classification ─────────────────────────────────
  let directAction: ActionName | null = null;
  let chipParams: Record<string, unknown> | null = null;

  if (turnRequest.chip_metadata) {
    const chipAction = turnRequest.chip_metadata.action_type;
    if (isValidAction(chipAction)) {
      directAction = chipAction as ActionName;
      chipParams = turnRequest.chip_metadata.parameters ?? {};
    }
  }

  if (!directAction) {
    const intentResult = classifyIntent(turnRequest.message);
    if (intentResult.routing === 'deterministic' && intentResult.tool) {
      const mapped = TOOL_TO_ACTION[intentResult.tool];
      if (mapped && turnContext.eligible_actions.includes(mapped)) {
        directAction = mapped;
      }
    }
  }

  // ── Direct action dispatch ────────────────────────────────────────────────
  if (directAction) {
    const actionDef = ACTION_CATALOGUE.get(directAction);
    if (actionDef) {
      const prereqError = actionDef.prerequisite_checks(turnContext);
      if (!prereqError) {
        try {
          const actionResult = await actionDef.execute(chipParams ?? {}, turnContext);

          // Confirmable actions
          if (actionDef.requires_confirmation && actionResult.operations?.length) {
            const proposal = buildProposal(
              directAction,
              actionResult.operations,
              actionResult.assistantText ?? directAction,
              actionResult.operations.map((o) => o.path),
            );
            storePendingProposal(turnContext.scenario_id, {
              proposal_id: proposal.proposal_id,
              action_type: directAction,
              operations: actionResult.operations,
              description: actionResult.assistantText ?? directAction,
              affected_elements: actionResult.operations.map((o) => o.path),
            });
            const proposalBlock = createProposalBlock(proposal, turnId);
            const proposalResult = assembleDeterministicResponse({
              turnContext, llmResponse: null,
              actionResult: { blocks: [proposalBlock], assistantText: actionResult.assistantText, guidance_items: actionResult.guidance_items, operations: undefined },
              turnId, routing: 'deterministic', selectedAction: directAction, executedActions: [], contextFallbackUsed,
            });
            emitQualityTelemetry(proposalResult, turnRequest.context.scenario_id, turnId);
            if (proposalResult.envelope.assistant_text) yield { type: 'text_delta', seq: seq++, delta: proposalResult.envelope.assistant_text };
            for (const block of proposalResult.envelope.blocks) yield { type: 'block', seq: seq++, block };
            yield { type: 'turn_complete', seq: seq++, envelope: proposalResult.envelope as unknown as OrchestratorResponseEnvelopeV2 };
            return;
          }

          emit('deterministic.action.executed', { request_id: requestId, action: directAction, routing: 'deterministic' });

          // For actions needing LLM narrative, stream the LLM call
          let llmResponse: LLMJsonResponse | null = null;
          let llmCallMeta: LLMCallResult | null = null;
          if (!actionResult.assistantText) {
            yield { type: 'progress', seq: seq++, tool_name: 'orchestrator', elapsed_ms: 0, message: 'Olumi is thinking\u2026' };
            for await (const llmEvent of callLLMStreaming(turnContext, turnRequest.message, turnRequest.context, requestId, turnId, signal)) {
              if (llmEvent.type === 'text_delta') {
                yield { type: 'text_delta', seq: seq++, delta: llmEvent.delta };
              } else if (llmEvent.type === 'complete') {
                llmCallMeta = llmEvent.result;
              }
            }
            llmResponse = llmCallMeta?.response ?? null;
          }

          const result = assembleDeterministicResponse({
            turnContext, llmResponse, actionResult, turnId,
            routing: 'deterministic', selectedAction: directAction, executedActions: [directAction],
            extractionMethod: llmCallMeta?.extraction_method, contextFallbackUsed, promptCharCount: llmCallMeta?.prompt_char_count,
            streamingExtractorState: llmCallMeta?.streaming_extractor_state,
          });
          emitQualityTelemetry(result, turnRequest.context.scenario_id, turnId);

          // If action provided its own text (not LLM), emit it as a single delta
          if (!llmResponse && result.envelope.assistant_text) {
            yield { type: 'text_delta', seq: seq++, delta: result.envelope.assistant_text };
          }
          for (const block of result.envelope.blocks) yield { type: 'block', seq: seq++, block };
          yield { type: 'turn_complete', seq: seq++, envelope: result.envelope as unknown as OrchestratorResponseEnvelopeV2 };
          return;
        } catch (err) {
          log.error({ request_id: requestId, action: directAction, err }, 'deterministic.action.failed');
          if (chipParams) {
            const errResult = assembleDeterministicResponse({
              turnContext, llmResponse: null,
              actionResult: { blocks: [], assistantText: 'Something went wrong executing that action. Please try again.', guidance_items: [] },
              turnId, routing: 'deterministic', selectedAction: directAction, executedActions: [], contextFallbackUsed,
            });
            emitQualityTelemetry(errResult, turnRequest.context.scenario_id, turnId);
            if (errResult.envelope.assistant_text) yield { type: 'text_delta', seq: seq++, delta: errResult.envelope.assistant_text };
            yield { type: 'turn_complete', seq: seq++, envelope: errResult.envelope as unknown as OrchestratorResponseEnvelopeV2 };
            return;
          }
        }
      }
    }
  }

  // ── Full LLM call with streaming text ─────────────────────────────────────
  // Emit progress only for the LLM path — fast paths (confirmation, direct action
  // with immediate text) skip this to avoid a flicker of "Olumi is thinking..."
  yield { type: 'progress', seq: seq++, tool_name: 'orchestrator', elapsed_ms: 0, message: 'Olumi is thinking\u2026' };

  const llmStart = Date.now();
  let llmCallResult: LLMCallResult | null = null;

  for await (const event of callLLMStreaming(turnContext, turnRequest.message, turnRequest.context, requestId, turnId, signal)) {
    if (event.type === 'text_delta') {
      yield { type: 'text_delta', seq: seq++, delta: event.delta };
    } else if (event.type === 'complete') {
      llmCallResult = event.result;
    }
  }

  const llmLatencyMs = Date.now() - llmStart;
  const llmResponse = llmCallResult?.response ?? null;

  // Auto-execute recommended actions
  let actionResult: ActionResult | null = null;
  const executedActions: string[] = [];

  if (llmResponse && llmResponse.recommended_actions.length > 0) {
    const firstRec = llmResponse.recommended_actions[0];
    if (isValidAction(firstRec.action_type)) {
      const actionName = firstRec.action_type as ActionName;
      const actionDef = ACTION_CATALOGUE.get(actionName);
      const autoExecutable = actionDef
        && (actionDef.execution_risk === 'none' || (actionDef.execution_risk === 'low' && !actionDef.requires_confirmation))
        && turnContext.eligible_actions.includes(actionName);
      if (autoExecutable) {
        const prereqError = actionDef.prerequisite_checks(turnContext);
        if (!prereqError) {
          try {
            const { action_type: _at, priority: _p, rationale: _r, ...recParams } = firstRec;
            actionResult = await actionDef.execute(recParams, turnContext);
            executedActions.push(actionName);
          } catch (err) {
            log.error({ request_id: requestId, action: actionName, err }, 'deterministic.auto_execute.failed');
          }
        }
      }
    }
  }

  emit('deterministic.pipeline.completed', {
    request_id: requestId, turn_id: turnId,
    duration_ms: Date.now() - startTime, llm_latency_ms: llmLatencyMs,
    actions_executed: executedActions,
  });

  const result = assembleDeterministicResponse({
    turnContext, llmResponse, actionResult, turnId,
    routing: 'llm', selectedAction: executedActions[0] ?? null, executedActions, llmLatencyMs,
    extractionMethod: llmCallResult?.extraction_method, contextFallbackUsed, promptCharCount: llmCallResult?.prompt_char_count,
    streamingExtractorState: llmCallResult?.streaming_extractor_state,
  });
  emitQualityTelemetry(result, turnRequest.context.scenario_id, turnId);

  // Emit blocks
  for (const block of result.envelope.blocks) {
    yield { type: 'block', seq: seq++, block };
  }

  yield { type: 'turn_complete', seq: seq++, envelope: result.envelope as unknown as OrchestratorResponseEnvelopeV2 };
}

