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
import { ORCHESTRATOR_TURN_BUDGET_MS, ORCHESTRATOR_TIMEOUT_MS, ORCHESTRATOR_ACK_TIMEOUT_MS } from "../config/timeouts.js";
import { log } from "../utils/telemetry.js";
import { getAdapter } from "../adapters/llm/router.js";
import type {
  OrchestratorTurnRequest,
  OrchestratorResponseEnvelope,
  ConversationBlock,
  OrchestratorError,
  TurnPlan,
  ConversationContext,
  ConversationMessage,
  V2RunResponseEnvelope,
  GraphV3T,
} from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { getIdempotentResponse, setIdempotentResponse, getInflightRequest, registerInflightRequest } from "./idempotency.js";
import { classifyIntent } from "./intent-gate.js";
import type { ToolName } from "./intent-gate.js";
import { createPLoTClient } from "./plot-client.js";
import type { PLoTClient, ValidatePatchResult, PLoTClientRunOpts } from "./plot-client.js";
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
import { isProduction } from "../config/index.js";
import { assembleContext } from "./context-fabric/index.js";
import type {
  ContextFabricRoute as FabricRoute,
  DecisionStage as FabricDecisionStage,
  DecisionState,
  GraphSummary,
  AnalysisSummary,
  DriverSummary as FabricDriverSummary,
  ConversationTurn,
  AssembledContext,
} from "./context-fabric/types.js";

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

/** Test-only: reset singleton so next getPlotClient() re-reads createPLoTClient(). */
export function _resetPlotClient(): void {
  plotClient = undefined;
}

/** Prompt version identifier for Context Fabric. Bumped on prompt changes. */
const PROMPT_VERSION = 'v0.1.0-cee-fabric';

// ============================================================================
// Deterministic Routing Prerequisites
// ============================================================================

/**
 * Prerequisites for deterministic tool dispatch.
 * When a gate match occurs but prerequisites are not met, the turn
 * falls through to LLM so it can explain what's missing conversationally.
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
  const turnStartedAt = Date.now();
  const budgetController = new AbortController();
  const budgetTimeout = setTimeout(() => budgetController.abort(), ORCHESTRATOR_TURN_BUDGET_MS);
  const plotOpts: PLoTClientRunOpts = {
    turnSignal: budgetController.signal,
    turnStartedAt,
    turnBudgetMs: ORCHESTRATOR_TURN_BUDGET_MS,
  };

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
      const result = await handleSystemEvent(turnRequest, turnId, request, requestId, plotOpts);
      setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, result.envelope);
      resolveInflight(result.envelope);
      return result;
    }

    // 4. Intent gate
    const intent = classifyIntent(turnRequest.message);

    let prerequisitesMet = true;
    if (intent.routing === 'deterministic' && intent.tool) {
      const checkPrereq = DETERMINISTIC_PREREQUISITES[intent.tool];
      if (checkPrereq) {
        prerequisitesMet = checkPrereq(turnRequest.context);
      }
    }

    const actualRouting = (intent.routing === 'deterministic' && prerequisitesMet) ? 'deterministic' : 'llm';

    log.info(
      {
        request_id: requestId,
        normalised_message: intent.normalised_message,
        matched_pattern: intent.matched_pattern ?? null,
        routing: actualRouting,
        gate_routing: intent.routing,
        prerequisites_met: prerequisitesMet,
      },
      "Intent gate decision",
    );

    let envelope: OrchestratorResponseEnvelope;

    if (actualRouting === 'deterministic' && intent.tool) {
      // Deterministic routing — skip LLM tool selection
      envelope = await dispatchDeterministic(
        intent.tool,
        turnRequest,
        turnId,
        request,
        requestId,
        plotOpts,
      );
    } else {
      // LLM routing — use chatWithTools
      // (includes case where gate matched but prerequisites not met)
      envelope = await dispatchViaLLM(
        turnRequest,
        turnId,
        request,
        requestId,
        budgetController.signal,
        plotOpts,
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
  plotOpts?: PLoTClientRunOpts,
): Promise<TurnResult> {
  const event = turnRequest.system_event!;

  log.info({ event_type: event.type, request_id: requestId }, "Handling system event");

  switch (event.type) {
    case 'patch_accepted': {
      return handlePatchAccepted(turnRequest, turnId, requestId, plotOpts);
    }
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
      // Lightweight LLM acknowledgement — uses shorter ack timeout
      const adapter = getAdapter('orchestrator');
      let text = 'Model updated.';
      try {
        const result = await adapter.chat(
          { system: 'Briefly acknowledge a graph edit made by the user.', userMessage: 'The user edited the graph directly.' },
          { requestId, timeoutMs: ORCHESTRATOR_ACK_TIMEOUT_MS },
        );
        text = result.content || text;
      } catch {
        // Fallback text is fine — ack timeout is short by design
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
      return dispatchTool('run_analysis', {}, turnRequest, turnId, request, requestId, 'deterministic', undefined, plotOpts);
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
// patch_accepted → PLoT validate-patch
// ============================================================================

async function handlePatchAccepted(
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  requestId: string,
  plotOpts?: PLoTClientRunOpts,
): Promise<TurnResult> {
  const event = turnRequest.system_event!;
  const payload = event.payload;
  const warnings: string[] = [];
  let graphHash: string | undefined;

  const client = getPlotClient();

  if (client && turnRequest.context.graph) {
    try {
      // Build validate-patch payload: full graph + operations (if available in event payload)
      const plotPayload: Record<string, unknown> = {
        graph: turnRequest.context.graph,
        operations: Array.isArray(payload.operations) ? payload.operations : [],
        scenario_id: turnRequest.scenario_id,
      };

      const result: ValidatePatchResult = await client.validatePatch(plotPayload, requestId, plotOpts);

      if (result.kind === 'success') {
        graphHash = typeof result.data.graph_hash === 'string' ? result.data.graph_hash : undefined;
        log.info(
          { request_id: requestId, graph_hash: graphHash },
          "patch_accepted: PLoT validate-patch succeeded",
        );
      } else if (result.kind === 'feature_disabled') {
        warnings.push('PLoT validate-patch not available — graph_hash not computed');
        log.info({ request_id: requestId }, "patch_accepted: PLoT validate-patch FEATURE_DISABLED");
      } else {
        // Rejection — should not happen for patch_accepted but handle gracefully
        warnings.push(`PLoT validate-patch rejected: ${result.message ?? 'unknown reason'}`);
        log.warn(
          { request_id: requestId, code: result.code, message: result.message },
          "patch_accepted: PLoT validate-patch rejected (unexpected)",
        );
      }
    } catch (err) {
      // PLoT error — do not block the user
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`PLoT validate-patch failed: ${msg}`);
      log.warn(
        { request_id: requestId, error: msg },
        "patch_accepted: PLoT validate-patch error — proceeding with ack",
      );
    }
  } else if (!client) {
    warnings.push('PLoT client not configured — graph_hash not computed');
  }

  const envelope = assembleEnvelope({
    turnId,
    assistantText: null,
    blocks: [],
    context: turnRequest.context,
    turnPlan: buildTurnPlan(null, 'deterministic', false),
    graphHash,
  });

  // Surface warnings in the envelope's parse_warnings field (debug aid)
  if (warnings.length > 0) {
    envelope.parse_warnings = warnings;
  }

  return { envelope, httpStatus: 200 };
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
  plotOpts?: PLoTClientRunOpts,
): Promise<OrchestratorResponseEnvelope> {
  const result = await dispatchTool(tool, {}, turnRequest, turnId, request, requestId, 'deterministic', undefined, plotOpts);
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
  plotOpts?: PLoTClientRunOpts,
): Promise<OrchestratorResponseEnvelope> {
  const adapter = getAdapter('orchestrator');

  // ── Context Fabric (feature-flagged) ─────────────────────────────────────
  let fabricContext: AssembledContext | null = null;
  let contextHash: string | undefined;

  const fabricEnabled = process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED === 'true'
    || process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED === '1';

  if (fabricEnabled) {
    try {
      const state = extractDecisionState(turnRequest.context);
      const stage = toFabricStage(turnRequest.context.framing?.stage);
      const turns = toConversationTurns(turnRequest.context.messages);

      const assembled = assembleContext(
        PROMPT_VERSION,
        'CHAT' as FabricRoute,
        stage,
        state,
        turns,
        turnRequest.message,
        turnRequest.context.selected_elements,
      );

      if (assembled.full_context) {
        fabricContext = assembled;
        contextHash = assembled.context_hash;
        log.info(
          {
            request_id: requestId,
            profile: assembled.profile_used,
            estimated_tokens: assembled.estimated_tokens,
            within_budget: assembled.within_budget,
            truncation_applied: assembled.truncation_applied,
          },
          "Context Fabric assembled",
        );
      }
    } catch (err) {
      log.warn(
        { request_id: requestId, error: err instanceof Error ? err.message : String(err) },
        "Context Fabric assembly failed, falling back to simple prompt",
      );
    }
  }

  if (!adapter.chatWithTools) {
    // Fallback: use plain chat if adapter doesn't support tools
    log.warn({ request_id: requestId }, "Adapter does not support chatWithTools, using plain chat");
    const systemPrompt = fabricContext?.full_context || await assembleSystemPrompt(turnRequest.context);
    const result = await adapter.chat(
      { system: systemPrompt, userMessage: turnRequest.message },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
    );

    return assembleEnvelope({
      turnId,
      assistantText: result.content,
      blocks: [],
      context: turnRequest.context,
      turnPlan: buildTurnPlan(null, 'llm', false),
      contextHash,
    });
  }

  // Full tool-calling flow
  const systemPrompt = fabricContext?.full_context || await assembleSystemPrompt(turnRequest.context);
  const messages = fabricContext
    ? [{ role: 'user' as const, content: turnRequest.message }]
    : assembleMessages(turnRequest.context, turnRequest.message);
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

  // Log parse warnings for telemetry (parser is pure — logging happens here)
  if (parsed.parse_warnings.length > 0) {
    log.warn(
      { request_id: requestId, parse_warnings: parsed.parse_warnings },
      "XML envelope parse warnings",
    );
  }

  const includeDebug = !isProduction();

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
      diagnostics: parsed.diagnostics,
      parseWarnings: parsed.parse_warnings,
      includeDebug,
      contextHash,
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
    contextHash,
    plotOpts,
  );

  // Merge LLM text with tool result (null = no text, '' = empty text from parser fallback)
  if (parsed.assistant_text != null && toolResult.envelope.assistant_text == null) {
    toolResult.envelope.assistant_text = parsed.assistant_text;
  }

  // Merge XML-extracted blocks (server blocks first, then AI blocks) and suggested actions
  if (xmlBlocks.length > 0) {
    toolResult.envelope.blocks = [...toolResult.envelope.blocks, ...xmlBlocks];
  }
  if (suggestedActions && !toolResult.envelope.suggested_actions) {
    toolResult.envelope.suggested_actions = suggestedActions;
  }

  // Add debug fields to tool result envelope if applicable
  if (includeDebug) {
    if (parsed.diagnostics) {
      toolResult.envelope.diagnostics = parsed.diagnostics;
    }
    if (parsed.parse_warnings.length > 0) {
      toolResult.envelope.parse_warnings = parsed.parse_warnings;
    }
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
  contextHash?: string,
  plotOpts?: PLoTClientRunOpts,
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
        const result = await handleRunAnalysis(turnRequest.context, client, requestId, turnId, plotOpts);
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
        const result = await handleEditGraph(turnRequest.context, editDesc, adapter, requestId, turnId, { plotOpts });
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
      contextHash,
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
      contextHash,
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
// Context Fabric Helpers
// ============================================================================

/**
 * Map orchestrator 5-stage DecisionStage to Context Fabric 6-stage.
 * 'evaluate' → 'evaluate_pre' (pre-analysis default).
 */
function toFabricStage(stage?: string): FabricDecisionStage {
  switch (stage) {
    case 'frame':
    case 'ideate':
    case 'decide':
    case 'optimise':
      return stage;
    case 'evaluate':
      return 'evaluate_pre';
    case 'evaluate_pre':
    case 'evaluate_post':
      return stage as FabricDecisionStage;
    default:
      return 'frame';
  }
}

/**
 * Extract GraphSummary from a V3 graph for Context Fabric.
 */
function extractGraphSummary(graph: GraphV3T): GraphSummary {
  const goalNode = graph.nodes.find(n => n.kind === 'goal');
  const optionNodes = graph.nodes.filter(n => n.kind === 'option');
  const edgeParts = graph.edges.map(e =>
    `${e.from} -> ${e.to} (${e.strength.mean.toFixed(2)})`,
  );

  return {
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    goal_node_id: goalNode?.id ?? null,
    option_node_ids: optionNodes.map(n => n.id),
    compact_edges: edgeParts.join(', '),
  };
}

/**
 * Extract AnalysisSummary from a V2RunResponseEnvelope for Context Fabric.
 * Returns null if no valid results are available.
 */
function extractAnalysisSummary(response: V2RunResponseEnvelope): AnalysisSummary | null {
  const results = (response.results ?? []) as Array<Record<string, unknown>>;
  const sorted = results
    .filter(r => typeof r.win_probability === 'number')
    .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

  if (sorted.length === 0) return null;

  const winner = sorted[0];
  const winnerId = String(winner.option_id ?? winner.option_label ?? 'unknown');
  const winnerProb = winner.win_probability as number;
  const runnerUpProb = sorted.length > 1 ? (sorted[1].win_probability as number) : 0;

  const robustnessLevel = response.robustness?.level ?? 'unknown';

  const fragileEdges = (response.robustness?.fragile_edges ?? []) as Array<Record<string, unknown>>;
  const fragileEdgeIds = fragileEdges
    .map(e => typeof e === 'string' ? e : String(e.edge_id ?? ''))
    .filter(Boolean);

  const factors = (response.factor_sensitivity ?? []) as Array<Record<string, unknown>>;
  const topDrivers: FabricDriverSummary[] = factors.slice(0, 5).map(f => ({
    node_id: String(f.node_id ?? f.factor_id ?? f.label ?? 'unknown'),
    sensitivity: typeof f.elasticity === 'number' ? f.elasticity : 0,
    confidence: typeof f.confidence === 'string' ? f.confidence : 'medium',
  }));

  return {
    winner_id: winnerId,
    winner_probability: winnerProb,
    winning_margin: winnerProb - runnerUpProb,
    robustness_level: robustnessLevel,
    top_drivers: topDrivers,
    fragile_edge_ids: fragileEdgeIds,
  };
}

/**
 * Convert ConversationMessage[] to ConversationTurn[] for Context Fabric.
 */
function toConversationTurns(messages: ConversationMessage[]): ConversationTurn[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Build a DecisionState from ConversationContext for Context Fabric.
 */
function extractDecisionState(context: ConversationContext): DecisionState {
  const graphSummary = context.graph
    ? extractGraphSummary(context.graph as GraphV3T)
    : null;

  const analysisSummary = context.analysis_response
    ? extractAnalysisSummary(context.analysis_response as V2RunResponseEnvelope)
    : null;

  const stage = toFabricStage(context.framing?.stage);

  return {
    graph_summary: graphSummary,
    analysis_summary: analysisSummary,
    event_summary: context.event_log_summary ?? '',
    framing: context.framing
      ? {
          goal: context.framing.goal,
          constraints: Array.isArray(context.framing.constraints)
            ? context.framing.constraints.filter((c): c is string => typeof c === 'string')
            : undefined,
          stage,
        }
      : null,
    user_causal_claims: [],
    unresolved_questions: [],
  };
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
