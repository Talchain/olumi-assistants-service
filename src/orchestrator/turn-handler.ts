/**
 * Turn Handler — Core Orchestrator Turn Processing
 *
 * Processing flow:
 * 1. Idempotency check → return cached if hit
 * 2. Create turn budget AbortController (ORCHESTRATOR_TURN_BUDGET_MS)
 * 3. Check system_event → handle per table
 * 4. Intent gate (deterministic first, then LLM)
 * 5. Dispatch to tool handler
 * 6. Assemble envelope
 * 7. Cache response (per TTL rules)
 * 8. Return envelope
 *
 * System event handling:
 * - patch_accepted, patch_dismissed, feedback_submitted → no LLM call, log + return empty
 * - direct_graph_edit → lightweight LLM turn
 * - direct_analysis_run → route to run_analysis
 */

import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { ORCHESTRATOR_TURN_BUDGET_MS, ORCHESTRATOR_TIMEOUT_MS } from "../config/timeouts.js";
import { log } from "../utils/telemetry.js";
import { getAdapter } from "../adapters/llm/router.js";
import type {
  OrchestratorTurnRequest,
  OrchestratorResponseEnvelope,
  ConversationBlock,
  OrchestratorError,
  TurnPlan,
} from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { getIdempotentResponse, setIdempotentResponse, getInflightRequest, registerInflightRequest } from "./idempotency.js";
import { resolveIntent } from "./intent-gate.js";
import { createPLoTClient } from "./plot-client.js";
import type { PLoTClient } from "./plot-client.js";
import { assembleSystemPrompt, assembleMessages, assembleToolDefinitions } from "./prompt-assembly.js";
import { parseLLMResponse, getFirstToolInvocation } from "./response-parser.js";
import type { ExtractedBlock } from "./response-parser.js";
import { assembleEnvelope, buildTurnPlan } from "./envelope.js";
import { getToolDefinitions } from "./tools/registry.js";
import { createCommentaryBlock, createReviewCardBlock } from "./blocks/factory.js";
import { handleRunAnalysis } from "./tools/run-analysis.js";
import { handleDraftGraph } from "./tools/draft-graph.js";
import { handleGenerateBrief } from "./tools/generate-brief.js";
import { handleEditGraph } from "./tools/edit-graph.js";
import { handleExplainResults } from "./tools/explain-results.js";
import { handleUndoPatch } from "./tools/undo-patch.js";

// ============================================================================
// Singleton PLoT client (created on first use)
// ============================================================================

let plotClient: PLoTClient | null | undefined;

function getPlotClient(): PLoTClient | null {
  if (plotClient === undefined) {
    plotClient = createPLoTClient();
  }
  return plotClient;
}

// ============================================================================
// Turn Handler
// ============================================================================

export interface TurnResult {
  envelope: OrchestratorResponseEnvelope;
  httpStatus: number;
}

/**
 * Process a single orchestrator turn.
 */
export async function handleTurn(
  turnRequest: OrchestratorTurnRequest,
  request: FastifyRequest,
  requestId: string,
): Promise<TurnResult> {
  const turnId = randomUUID();

  // 1. Idempotency check — completed responses
  const cached = getIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (cached) {
    log.info({ request_id: requestId, client_turn_id: turnRequest.client_turn_id }, "Idempotency cache hit");
    const status = cached.error ? getHttpStatusForError(cached.error) : 200;
    return { envelope: cached, httpStatus: status };
  }

  // 1b. Concurrent dedup — in-flight requests
  const inflight = getInflightRequest(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (inflight) {
    log.info({ request_id: requestId, client_turn_id: turnRequest.client_turn_id }, "Idempotency inflight hit");
    const envelope = await inflight;
    const status = envelope.error ? getHttpStatusForError(envelope.error) : 200;
    return { envelope, httpStatus: status };
  }

  // 2. Turn budget timeout
  const budgetController = new AbortController();
  const budgetTimeout = setTimeout(() => budgetController.abort(), ORCHESTRATOR_TURN_BUDGET_MS);

  // Register this request as in-flight for concurrent dedup
  let resolveInflight!: (value: OrchestratorResponseEnvelope) => void;
  let rejectInflight!: (reason: unknown) => void;
  const inflightPromise = new Promise<OrchestratorResponseEnvelope>((resolve, reject) => {
    resolveInflight = resolve;
    rejectInflight = reject;
  });
  registerInflightRequest(turnRequest.scenario_id, turnRequest.client_turn_id, inflightPromise);

  try {
    // 3. Check system event
    if (turnRequest.system_event) {
      const result = await handleSystemEvent(turnRequest, turnId, request, requestId);
      setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, result.envelope);
      resolveInflight(result.envelope);
      return result;
    }

    // 4. Intent gate
    const intent = resolveIntent(turnRequest.message);

    let envelope: OrchestratorResponseEnvelope;

    if (intent.routing === 'deterministic' && intent.tool) {
      // Deterministic routing — skip LLM
      envelope = await dispatchDeterministic(
        intent.tool,
        turnRequest,
        turnId,
        request,
        requestId,
      );
    } else {
      // LLM routing — use chatWithTools
      envelope = await dispatchViaLLM(
        turnRequest,
        turnId,
        request,
        requestId,
        budgetController.signal,
      );
    }

    // 7. Cache response
    setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, envelope);
    resolveInflight(envelope);

    const status = envelope.error ? getHttpStatusForError(envelope.error) : 200;
    return { envelope, httpStatus: status };
  } catch (error) {
    // Map unhandled errors to envelope
    const orchestratorError = extractOrchestratorError(error);

    const envelope = assembleEnvelope({
      turnId,
      assistantText: null,
      blocks: [],
      context: turnRequest.context,
      error: orchestratorError,
    });

    setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, envelope);
    resolveInflight(envelope);

    const status = getHttpStatusForError(orchestratorError);
    return { envelope, httpStatus: status };
  } finally {
    clearTimeout(budgetTimeout);
  }
}

// ============================================================================
// System Event Handling
// ============================================================================

async function handleSystemEvent(
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  request: FastifyRequest,
  requestId: string,
): Promise<TurnResult> {
  const event = turnRequest.system_event!;

  log.info({ event_type: event.type, request_id: requestId }, "Handling system event");

  switch (event.type) {
    case 'patch_accepted':
      // TODO(post-PoC): Wire PLoT /v1/validate-patch call here.
      // Full flow: UI sends patch_accepted → CEE calls PLoT validate-patch →
      // CEE returns validated graph_hash in envelope.
      // For PoC: UI calls PLoT validate-patch directly. CEE ack-only.
    case 'patch_dismissed':
    case 'feedback_submitted': {
      // No LLM call — log + return empty
      const envelope = assembleEnvelope({
        turnId,
        assistantText: null,
        blocks: [],
        context: turnRequest.context,
        turnPlan: buildTurnPlan(null, 'deterministic', false),
      });
      return { envelope, httpStatus: 200 };
    }

    case 'direct_graph_edit': {
      // Lightweight LLM acknowledgement
      const adapter = getAdapter('orchestrator');
      let text = 'Model updated.';
      try {
        const result = await adapter.chat(
          { system: 'Briefly acknowledge a graph edit made by the user.', userMessage: 'The user edited the graph directly.' },
          { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
        );
        text = result.content || text;
      } catch {
        // Fallback text is fine
      }

      const envelope = assembleEnvelope({
        turnId,
        assistantText: text,
        blocks: [],
        context: turnRequest.context,
        turnPlan: buildTurnPlan(null, 'deterministic', false),
      });
      return { envelope, httpStatus: 200 };
    }

    case 'direct_analysis_run': {
      // Route to run_analysis
      return dispatchTool('run_analysis', {}, turnRequest, turnId, request, requestId, 'deterministic');
    }

    default: {
      log.warn({ event_type: event.type }, "Unknown system event type");
      const envelope = assembleEnvelope({
        turnId,
        assistantText: null,
        blocks: [],
        context: turnRequest.context,
      });
      return { envelope, httpStatus: 200 };
    }
  }
}

// ============================================================================
// Deterministic Dispatch
// ============================================================================

async function dispatchDeterministic(
  tool: string,
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  request: FastifyRequest,
  requestId: string,
): Promise<OrchestratorResponseEnvelope> {
  const result = await dispatchTool(tool, {}, turnRequest, turnId, request, requestId, 'deterministic');
  return result.envelope;
}

// ============================================================================
// LLM Dispatch
// ============================================================================

async function dispatchViaLLM(
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  request: FastifyRequest,
  requestId: string,
  _abortSignal: AbortSignal,
): Promise<OrchestratorResponseEnvelope> {
  const adapter = getAdapter('orchestrator');

  if (!adapter.chatWithTools) {
    // Fallback: use plain chat if adapter doesn't support tools
    log.warn({ request_id: requestId }, "Adapter does not support chatWithTools, using plain chat");
    const result = await adapter.chat(
      {
        system: await assembleSystemPrompt(turnRequest.context),
        userMessage: turnRequest.message,
      },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
    );

    return assembleEnvelope({
      turnId,
      assistantText: result.content,
      blocks: [],
      context: turnRequest.context,
      turnPlan: buildTurnPlan(null, 'llm', false),
    });
  }

  // Full tool-calling flow
  const systemPrompt = await assembleSystemPrompt(turnRequest.context);
  const messages = assembleMessages(turnRequest.context, turnRequest.message);
  const toolDefs = assembleToolDefinitions(getToolDefinitions());

  const llmResult = await adapter.chatWithTools(
    {
      system: systemPrompt,
      messages,
      tools: toolDefs,
      tool_choice: { type: 'auto' },
    },
    { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
  );

  const parsed = parseLLMResponse(llmResult);
  const toolInvocation = getFirstToolInvocation(parsed);

  // Convert AI-authored XML blocks into ConversationBlock[]
  const xmlBlocks = convertExtractedBlocks(parsed.extracted_blocks, turnId);
  const suggestedActions = parsed.suggested_actions.length > 0 ? parsed.suggested_actions : undefined;

  if (!toolInvocation) {
    // Pure conversation — no tool call
    return assembleEnvelope({
      turnId,
      assistantText: parsed.assistant_text,
      blocks: xmlBlocks,
      suggestedActions,
      context: turnRequest.context,
      turnPlan: buildTurnPlan(null, 'llm', false),
    });
  }

  // Dispatch tool
  const toolResult = await dispatchTool(
    toolInvocation.name,
    toolInvocation.input,
    turnRequest,
    turnId,
    request,
    requestId,
    'llm',
  );

  // Merge LLM text with tool result
  if (parsed.assistant_text && !toolResult.envelope.assistant_text) {
    toolResult.envelope.assistant_text = parsed.assistant_text;
  }

  // Merge XML-extracted blocks and suggested actions with tool result
  if (xmlBlocks.length > 0) {
    toolResult.envelope.blocks = [...toolResult.envelope.blocks, ...xmlBlocks];
  }
  if (suggestedActions && !toolResult.envelope.suggested_actions) {
    toolResult.envelope.suggested_actions = suggestedActions;
  }

  return toolResult.envelope;
}

// ============================================================================
// Tool Dispatch
// ============================================================================

async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  request: FastifyRequest,
  requestId: string,
  routing: 'deterministic' | 'llm' = 'llm',
): Promise<TurnResult> {
  const startTime = Date.now();
  const isLongRunning = toolName === 'run_analysis' || toolName === 'draft_graph';

  try {
    let blocks: ConversationBlock[] = [];
    let assistantText: string | null = null;
    let analysisResponse = undefined;
    let toolLatencyMs: number | undefined;

    switch (toolName) {
      case 'run_analysis': {
        const client = getPlotClient();
        if (!client) {
          throw Object.assign(new Error('PLoT client not configured'), {
            orchestratorError: {
              code: 'TOOL_EXECUTION_FAILED' as const,
              message: 'Analysis service not configured. Set PLOT_BASE_URL.',
              tool: 'run_analysis',
              recoverable: false,
            },
          });
        }
        const result = await handleRunAnalysis(turnRequest.context, client, requestId, turnId);
        blocks = result.blocks;
        analysisResponse = result.analysisResponse;
        toolLatencyMs = result.latencyMs;
        break;
      }

      case 'draft_graph': {
        const brief = (toolInput.brief as string) || turnRequest.message;
        const result = await handleDraftGraph(brief, request, turnId);
        blocks = result.blocks;
        assistantText = result.assistantText;
        toolLatencyMs = result.latencyMs;
        break;
      }

      case 'generate_brief': {
        const result = handleGenerateBrief(turnRequest.context, turnId);
        blocks = result.blocks;
        assistantText = result.assistantText;
        break;
      }

      case 'edit_graph': {
        const editDesc = (toolInput.edit_description as string) || turnRequest.message;
        const adapter = getAdapter('orchestrator');
        const result = await handleEditGraph(turnRequest.context, editDesc, adapter, requestId, turnId);
        blocks = result.blocks;
        assistantText = result.assistantText;
        toolLatencyMs = result.latencyMs;
        break;
      }

      case 'explain_results': {
        const adapter = getAdapter('orchestrator');
        const focus = toolInput.focus as string | undefined;
        const result = await handleExplainResults(turnRequest.context, adapter, requestId, turnId, focus);
        blocks = result.blocks;
        assistantText = result.assistantText;
        toolLatencyMs = result.latencyMs;
        break;
      }

      case 'undo_patch': {
        const result = handleUndoPatch();
        blocks = result.blocks;
        assistantText = result.assistantText;
        break;
      }

      default: {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: `Unknown tool: ${toolName}`,
          tool: toolName,
          recoverable: false,
        };
        throw Object.assign(new Error(err.message), { orchestratorError: err });
      }
    }

    const envelope = assembleEnvelope({
      turnId,
      assistantText,
      blocks,
      context: turnRequest.context,
      analysisResponse,
      turnPlan: buildTurnPlan(toolName, routing, isLongRunning, toolLatencyMs),
    });

    log.info(
      { tool: toolName, elapsed_ms: Date.now() - startTime, blocks_count: blocks.length },
      "Tool dispatch completed",
    );

    return { envelope, httpStatus: 200 };
  } catch (error) {
    const orchestratorError = extractOrchestratorError(error, toolName);

    const envelope = assembleEnvelope({
      turnId,
      assistantText: null,
      blocks: [],
      context: turnRequest.context,
      error: orchestratorError,
      turnPlan: buildTurnPlan(toolName, routing, isLongRunning),
    });

    const status = getHttpStatusForError(orchestratorError);
    return { envelope, httpStatus: status };
  }
}

// ============================================================================
// XML Block Conversion
// ============================================================================

/**
 * Convert ExtractedBlock[] from the XML parser into ConversationBlock[].
 * Only commentary and review_card are allowed — other types are already
 * filtered by the parser.
 */
function convertExtractedBlocks(blocks: ExtractedBlock[], turnId: string): ConversationBlock[] {
  return blocks.map((block) => {
    if (block.type === 'commentary') {
      return createCommentaryBlock(
        block.content,
        turnId,
        'llm:xml',
      );
    }
    // review_card
    return createReviewCardBlock(
      {
        tone: block.tone ?? 'facilitator',
        title: block.title ?? '',
        content: block.content,
      },
      turnId,
    );
  });
}

// ============================================================================
// Error Extraction
// ============================================================================

function extractOrchestratorError(error: unknown, tool?: string): OrchestratorError {
  // Check for attached orchestratorError
  if (error && typeof error === 'object' && 'orchestratorError' in error) {
    return (error as { orchestratorError: OrchestratorError }).orchestratorError;
  }

  // Timeout detection
  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
    return {
      code: 'LLM_TIMEOUT',
      message: error.message,
      tool,
      recoverable: true,
      suggested_retry: 'Try again.',
    };
  }

  // Generic error
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    tool,
    recoverable: false,
  };
}
