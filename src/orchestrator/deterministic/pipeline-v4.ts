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
import { computeTurnContext } from "./turn-context.js";
import { handleSystemEvent } from "./system-event-handler.js";
import { handlePendingConfirmation } from "./confirmation-flow.js";
import { buildDeterministicPromptV2 } from "./prompt-builder-v2.js";
import { buildToolDefinitions } from "./tool-builder.js";
import { buildDeterministicChips } from "./chip-builder-v4.js";
import { processAdapterStream, PROGRESS_MESSAGES, PROGRESS_INTERVAL_MS } from "./stream-handler-v4.js";
import type { StreamHandlerResult, ToolExecution } from "./stream-handler-v4.js";
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
import { log } from "../../utils/telemetry.js";
import { STREAM_ERROR_CODES } from "../pipeline/stream-events.js";
import type { GuidanceItem } from "../types/guidance-item.js";

// ============================================================================
// Chip-Click Text Templates (Task 5)
// ============================================================================

/** Pre-generated text for forced tool calls (chip clicks). */
const CHIP_TEXT_TEMPLATES: Record<string, (ctx: DeterministicTurnContext) => string> = {
  compare_options: (ctx) => `Comparing your ${ctx.graph_summary.option_count} options.`,
  what_would_flip: () => 'Looking at what would need to change to flip the recommendation.',
  run_premortem: () => 'Running a pre-mortem analysis.',
  explain_result: () => 'Breaking down what is driving the result.',
  run_analysis: () => 'Running the analysis now.',
  challenge_assumption: () => 'Examining that assumption more closely.',
  draft_graph: () => 'Building your decision model.',
};

/** Fallback text templates for empty LLM responses after successful tool execution (Task 3). */
const TOOL_RESULT_TEXT_TEMPLATES: Record<string, string> = {
  compare_options: "Here's how your options compare.",
  what_would_flip: "Here's what would need to change to flip the winner.",
  run_premortem: 'Running a pre-mortem on your leading option.',
  explain_result: "Here's what's driving the result.",
  run_analysis: 'Running the analysis now.',
  draft_graph: 'Building your decision model.',
  set_factor_value: 'Updated the factor value.',
  add_factor: 'Added the factor to your model.',
  add_option: 'Added the option to your model.',
  add_constraint: 'Added the constraint.',
  adjust_edge_strength: 'Adjusted the edge strength.',
  remove_factor: 'Removed the factor from your model.',
  set_goal_target: 'Updated the goal target.',
  challenge_assumption: 'Examining that assumption.',
};

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

    // Build prompt (async — loads from PMS with TTL cache)
    const prompt = await buildDeterministicPromptV2(turnContext);

    // Build tool definitions — add draft_graph when generate_model or no graph
    const eligibleActions = [...turnContext.eligible_actions];
    if (turnRequest.generate_model || !turnContext.graph) {
      if (!eligibleActions.includes('draft_graph')) {
        eligibleActions.push('draft_graph');
      }
    }
    const toolDefs = buildToolDefinitions(eligibleActions as ActionName[], turnContext);

    // Log filtering impact when tools were removed
    const filteredCount = eligibleActions.length - toolDefs.length;
    if (filteredCount > 0) {
      const toolNames = new Set(toolDefs.map(t => t.name));
      const removed = eligibleActions.filter(a => !toolNames.has(a) && a !== 'generate_artefact');
      log.info({
        request_id: requestId,
        eligible_count: eligibleActions.length,
        tool_count: toolDefs.length,
        removed_tools: removed,
        has_analysis: !!turnContext.analysis_summary,
        has_graph: !!turnContext.graph && turnContext.graph_summary.node_count > 0,
        disambiguation_hints: turnContext.disambiguation_hints.length,
      }, 'v4.tool_filtering');
    }

    // Determine tool_choice
    const chipAction = turnRequest.chip_metadata?.action_type as ActionName | undefined;
    // Guard: only force tool_choice when the chip action survived context filtering
    // and is present in toolDefs. If context filtering removed it (e.g. run_analysis
    // suppressed because no graph, or target_id tool suppressed due to ambiguity),
    // forcing the name would produce an invalid API call → downgrade to auto.
    const chipActionInTools = chipAction && toolDefs.some(t => t.name === chipAction);
    const toolChoice = chipActionInTools
      ? { type: 'tool' as const, name: chipAction! }
      : { type: 'auto' as const };
    if (chipAction && !chipActionInTools) {
      log.warn({
        request_id: requestId,
        chip_action: chipAction,
        tool_count: toolDefs.length,
      }, 'v4.chip_action_filtered_downgrade: chip action was removed by context filtering, downgrading tool_choice to auto');
    }

    // Build messages
    const conversationContext: ConversationContext = turnRequest.context ?? {
      messages: [],
      framing: { stage: 'frame' },
    };
    const messages = filterHistoryV4(sanitiseAssistantHistory(assembleMessages(conversationContext, effectiveMessage)));

    // Get adapter — task-based routing reads CEE_MODEL_ORCHESTRATOR, auto-detects provider
    const adapter = getAdapter('orchestrator');

    log.info({
      request_id: requestId,
      messages_sent: messages.length,
      system_prompt_chars: prompt.static_block.length + prompt.dynamic_block.length,
      has_cache_blocks: true,
      tool_count: toolDefs.length,
      tool_choice: toolChoice.type === 'tool' ? `forced:${toolChoice.name}` : toolChoice.type,
    }, 'v4.llm_call');

    if (signal?.aborted) return;

    // ── Chip-click pre-text (Task 5) ─────────────────────────────────
    // Yield deterministic text immediately for forced tool calls so the
    // user sees something while the tool executes.
    // Only emit when the chip action survived context filtering (chipActionInTools).
    // Otherwise the pre-text would be misleading — e.g. "Running the analysis now."
    // when run_analysis was filtered out and tool_choice downgraded to auto.
    let chipPreText: string | null = null;
    if (chipActionInTools && CHIP_TEXT_TEMPLATES[chipAction!]) {
      chipPreText = CHIP_TEXT_TEMPLATES[chipAction!](turnContext);
      yield { type: 'text_delta', seq: seq++, delta: chipPreText };
    }

    // Stream the LLM call — empty tool list is valid (model won't call tools)
    // tool_choice only meaningful when tools are present
    const hasTools = toolDefs.length > 0;
    if (!adapter.streamChatWithTools) {
      throw new Error(`Adapter ${adapter.name} does not support streaming tool calls — task 'orchestrator' requires a streaming-capable adapter`);
    }
    const stream = adapter.streamChatWithTools(
      {
        system: `${prompt.static_block}\n\n---\n\n${prompt.dynamic_block}`,
        system_cache_blocks: [
          { type: 'text', text: prompt.static_block, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt.dynamic_block },
        ],
        messages,
        tools: toolDefs,
        ...(hasTools ? { tool_choice: toolChoice } : {}),
        temperature: 0,
        maxTokens: 2048,
      },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS, signal },
    );

    // Process stream — yields text_delta, tool_start, block, tool_result events.
    // Long-running tools are deferred to the pipeline level (below) for real-time progress.
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

    // ── Execute deferred long-running tool with real-time progress ────
    // The stream handler defers long-running tools so the pipeline can
    // yield progress events between Promise.race ticks.
    let toolExecution: ToolExecution | null = streamResult.toolExecution;
    let failedToolCall = streamResult.failedToolCall;

    if (streamResult.pendingLongRunningTool) {
      const pending = streamResult.pendingLongRunningTool;
      const actionDef = ACTION_CATALOGUE.get(pending.name as ActionName);

      if (actionDef) {
        const toolStartTime = Date.now();
        const progressMessage = PROGRESS_MESSAGES[pending.name as ActionName] ?? 'Processing\u2026';

        try {
          // Race execution against progress ticks — yield real-time progress events
          const execPromise = actionDef.execute(pending.input, turnContext);
          let execDone = false;
          let execResult: import("./types.js").ActionResult | undefined;
          let execError: unknown;

          const wrappedExec = execPromise.then(
            (r) => { execDone = true; execResult = r; },
            (e) => { execDone = true; execError = e; },
          );

          while (!execDone) {
            const tick = new Promise<void>((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS));
            await Promise.race([wrappedExec, tick]);

            if (!execDone) {
              yield {
                type: 'progress',
                seq: seq++,
                tool_name: pending.name,
                elapsed_ms: Date.now() - toolStartTime,
                message: progressMessage,
              };
            }

            if (signal?.aborted) break;
          }

          // Await once more to ensure promise is settled
          await wrappedExec;

          if (execError) throw execError;

          const durationMs = Date.now() - toolStartTime;
          toolExecution = {
            toolName: pending.name,
            input: pending.input,
            result: execResult!,
            durationMs,
          };

          for (const block of execResult!.blocks) {
            yield { type: 'block', seq: seq++, block };
          }

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: pending.name,
            success: true,
            duration_ms: durationMs,
          };

          log.info({
            request_id: requestId,
            tool_name: pending.name,
            success: true,
            duration_ms: durationMs,
            blocks_produced: execResult!.blocks.length,
          }, 'v4.tool_executed');

        } catch (error) {
          const durationMs = Date.now() - toolStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          failedToolCall = { name: pending.name, error: errorMessage };

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: pending.name,
            success: false,
            duration_ms: durationMs,
          };

          log.error({
            request_id: requestId,
            tool_name: pending.name,
            duration_ms: durationMs,
            error: errorMessage,
          }, 'v4.tool_execution_failed');
        }
      }
    }

    const llmDurationMs = Date.now() - startTime;

    log.info({
      request_id: requestId,
      response_text_chars: streamResult.assistantText.length,
      tool_calls_count: toolExecution ? 1 : 0,
      discarded_tool_calls: streamResult.discardedToolCalls.length,
      extraction_method: 'native_tool_use',
      duration_ms: llmDurationMs,
    }, 'v4.llm_call');

    // ── Assemble response ─────────────────────────────────────────────
    const executedAction = toolExecution?.toolName as ActionName ?? null;
    const actionResult = toolExecution?.result ?? null;

    // Surface tool failure in the envelope when no text was produced.
    // NOTE: This text intentionally matches ERROR_PATTERNS in history-filter-v4.ts
    // so failed tool turns are excluded from conversation history.
    let assistantText = streamResult.assistantText || null;

    // ── Text injection for empty LLM responses (Task 3) ──────────────
    // When a tool executed successfully but the LLM produced no text,
    // inject text from the action result or a template so no turn
    // reaches the UI with a tool execution but no assistant text.
    if ((!assistantText || !assistantText.trim()) && toolExecution && !failedToolCall) {
      if (toolExecution.result.assistantText) {
        assistantText = toolExecution.result.assistantText;
      } else {
        const templateText = TOOL_RESULT_TEXT_TEMPLATES[toolExecution.toolName];
        if (templateText) {
          assistantText = templateText;
        }
      }
    }

    // Prepend chip pre-text to assistantText so it enters the envelope.
    // Skip if LLM text already contains the pre-text (e.g. LLM echoed the template).
    if (chipPreText) {
      if (!assistantText || !assistantText.includes(chipPreText)) {
        assistantText = assistantText
          ? `${chipPreText}\n\n${assistantText}`
          : chipPreText;
      }
    }

    if (failedToolCall) {
      const errorText = 'Something went wrong while processing your request. Please try again.';
      if (!assistantText || !assistantText.trim()) {
        // No text at all — set outright.
        assistantText = errorText;
      } else {
        // Text is present (from LLM or chip pre-text) — always append the error sentinel
        // so history-filter-v4 can match ERROR_PATTERNS and drop this turn from history.
        // Without this, a failed turn with non-empty LLM text would appear to be a
        // success message in the next LLM call's conversation context.
        assistantText = `${assistantText}\n\n${errorText}`;
        if (chipPreText) {
          // Chip pre-text was already streamed as a delta — emit the error as a
          // follow-up delta so the streaming client also sees the failure.
          yield { type: 'text_delta', seq: seq++, delta: `\n\n${errorText}` };
        }
      }
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
    contextFallbackUsed: _contextFallbackUsed,
    llmLatencyMs,
  } = input;

  // Combine assistant text: action confirmation + LLM text.
  // Guard: when the pipeline injected actionResult.assistantText as rawAssistantText
  // (Task 3 empty-LLM-text injection) or prepended chip pre-text, skip the prefix
  // to avoid duplication.
  let assistantText = rawAssistantText;
  if (actionResult?.assistantText && rawAssistantText) {
    const alreadyContains = rawAssistantText === actionResult.assistantText
      || rawAssistantText.includes(actionResult.assistantText);
    if (!alreadyContains) {
      assistantText = `${actionResult.assistantText}\n\n${rawAssistantText}`;
    }
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

  // Outbound contract validation (warn-only, never blocks response)
  validateEnvelope(normalised as unknown as Record<string, unknown>, turnId);

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
// Outbound Envelope Validation
// ============================================================================

/**
 * Lightweight contract validation for the v4 response envelope.
 * Logs warnings but never blocks the response — observational only.
 */

/** Must match DecisionStage in ../types.ts */
const VALID_STAGES = new Set(['frame', 'ideate', 'evaluate', 'decide', 'optimise']);

export function validateEnvelope(envelope: Record<string, unknown>, turnId: string): void {
  const warnings: string[] = [];

  // assistant_text: null or non-empty string (never undefined or empty string)
  const text = envelope.assistant_text;
  if (text === undefined) {
    warnings.push('assistant_text is undefined (should be null or non-empty string)');
  } else if (text !== null && (typeof text !== 'string' || text.trim().length === 0)) {
    warnings.push(`assistant_text is empty string (should be null or non-empty), got: ${JSON.stringify(text)}`);
  }

  // blocks: must be array
  if (!Array.isArray(envelope.blocks)) {
    warnings.push(`blocks is not an array, got: ${typeof envelope.blocks}`);
  } else {
    for (let i = 0; i < (envelope.blocks as unknown[]).length; i++) {
      const block = (envelope.blocks as Record<string, unknown>[])[i];
      if (!block.block_type) warnings.push(`blocks[${i}] missing block_type`);
      if (!block.block_id) warnings.push(`blocks[${i}] missing block_id`);
    }
  }

  // turn_plan.routing
  const turnPlan = envelope.turn_plan as Record<string, unknown> | undefined;
  if (turnPlan) {
    if (turnPlan.routing !== 'llm' && turnPlan.routing !== 'deterministic') {
      warnings.push(`turn_plan.routing is "${String(turnPlan.routing)}", expected "llm" or "deterministic"`);
    }
  }

  // stage_indicator: must be a valid DecisionStage string
  const stage = envelope.stage_indicator;
  if (stage === undefined || stage === null) {
    warnings.push('stage_indicator is missing');
  } else if (typeof stage !== 'string') {
    warnings.push(`stage_indicator is ${typeof stage}, expected a stage string`);
  } else if (!VALID_STAGES.has(stage)) {
    warnings.push(`stage_indicator is "${stage}", expected one of: ${[...VALID_STAGES].join(', ')}`);
  }

  // response_version is 2
  if (envelope.response_version !== 2) {
    warnings.push(`response_version is ${String(envelope.response_version)}, expected 2`);
  }

  if (warnings.length > 0) {
    log.warn({ turn_id: turnId, violations: warnings }, 'v4.envelope_validation_warnings');
  }
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
