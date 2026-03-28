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
import type { FastifyRequest } from "fastify";
import type { OrchestratorTurnRequest } from "../types.js";
import type { DeterministicPipelineResult, LLMJsonResponse, ActionResult } from "./types.js";
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

// ============================================================================
// Intent → Action Mapping
// ============================================================================

/**
 * Map legacy tool names from intent gate to deterministic action names.
 */
const TOOL_TO_ACTION: Record<string, ActionName> = {
  run_analysis: 'run_analysis',
  explain_results: 'explain_result',
  edit_graph: 'set_factor_value', // default — resolved by entity/intent analysis
  run_exercise: 'run_premortem', // default exercise
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
  const turnContext = computeTurnContext(turnRequest);

  log.info({
    request_id: requestId,
    stage: turnContext.stage,
    eligible_actions: turnContext.eligible_actions,
    node_count: turnContext.graph_summary.node_count,
    has_analysis: turnContext.analysis_summary != null,
  }, 'deterministic.turn_context_computed');

  // ── Check pending confirmation ────────────────────────────────────────────
  const confirmResult = handlePendingConfirmation(turnRequest.message, turnContext);
  if (confirmResult.handled) {
    emit('deterministic.confirmation.handled', {
      request_id: requestId,
      confirmed: !confirmResult.cleared,
    });
    return assembleDeterministicResponse({
      turnContext,
      llmResponse: null,
      actionResult: confirmResult.actionResult ?? null,
      turnId,
      routing: 'deterministic',
      selectedAction: null,
      executedActions: [],
    });
  }

  // ── Intent classification ────────────────────────────────────────────────
  const intentResult = classifyIntent(turnRequest.message);
  let directAction: ActionName | null = null;

  if (intentResult.routing === 'deterministic' && intentResult.tool) {
    const mapped = TOOL_TO_ACTION[intentResult.tool];
    if (mapped && turnContext.eligible_actions.includes(mapped)) {
      directAction = mapped;
    }
  }

  // ── Direct action dispatch (chip click or deterministic match) ───────────
  if (directAction) {
    const actionDef = ACTION_CATALOGUE.get(directAction);
    if (actionDef) {
      const prereqError = actionDef.prerequisite_checks(turnContext);
      if (!prereqError) {
        try {
          const actionResult = await actionDef.execute(
            extractParams(turnRequest.message, directAction),
            turnContext,
          );

          // For confirmable actions, store proposal instead of emitting ops
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
              affected_elements: proposal.affected_elements,
            });
            // Return without operations — proposal is pending
            return assembleDeterministicResponse({
              turnContext,
              llmResponse: null,
              actionResult: { ...actionResult, operations: undefined },
              turnId,
              routing: 'deterministic',
              selectedAction: directAction,
              executedActions: [],
            });
          }

          emit('deterministic.action.executed', {
            request_id: requestId,
            action: directAction,
            routing: 'deterministic',
          });

          // For actions needing LLM narrative, do a quick LLM call
          let llmResponse: LLMJsonResponse | null = null;
          if (!actionResult.assistantText) {
            llmResponse = await callLLM(turnContext, turnRequest.message, requestId);
          }

          return assembleDeterministicResponse({
            turnContext,
            llmResponse,
            actionResult,
            turnId,
            routing: 'deterministic',
            selectedAction: directAction,
            executedActions: [directAction],
          });
        } catch (err) {
          log.error({ request_id: requestId, action: directAction, err }, 'deterministic.action.failed');
        }
      }
    }
  }

  // ── Full LLM call (free text) ────────────────────────────────────────────
  const llmStart = Date.now();
  const llmResponse = await callLLM(turnContext, turnRequest.message, requestId);
  const llmLatencyMs = Date.now() - llmStart;

  // Execute recommended actions that are read-only or have clear intent
  let actionResult: ActionResult | null = null;
  const executedActions: string[] = [];

  if (llmResponse && llmResponse.recommended_actions.length > 0) {
    const firstRec = llmResponse.recommended_actions[0];
    if (isValidAction(firstRec.action_type)) {
      const actionName = firstRec.action_type as ActionName;
      const actionDef = ACTION_CATALOGUE.get(actionName);

      // Only auto-execute read-only actions (none risk)
      if (actionDef && actionDef.execution_risk === 'none' && turnContext.eligible_actions.includes(actionName)) {
        const prereqError = actionDef.prerequisite_checks(turnContext);
        if (!prereqError) {
          try {
            // Merge target_id into parameters so action handlers can access it
            const mergedParams = {
              ...(firstRec.parameters ?? {}),
              ...(firstRec.target_id ? { target_id: firstRec.target_id } : {}),
            };
            actionResult = await actionDef.execute(
              mergedParams,
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

  return assembleDeterministicResponse({
    turnContext,
    llmResponse,
    actionResult,
    turnId,
    routing: 'llm',
    selectedAction: executedActions[0] ?? null,
    executedActions,
    llmLatencyMs,
  });
}

// ============================================================================
// LLM Call
// ============================================================================

async function callLLM(
  turnContext: import("./types.js").DeterministicTurnContext,
  userMessage: string,
  requestId: string,
): Promise<LLMJsonResponse | null> {
  try {
    const adapter = getAdapter('orchestrator');
    const systemPrompt = buildDeterministicPrompt(turnContext);

    const response = await adapter.chat(
      {
        system: systemPrompt,
        userMessage,
        maxTokens: 2048,
        temperature: 0.3,
        responseFormat: 'json_object',
      },
      {
        requestId,
        timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
      },
    );

    const content = response.content;

    const parseResult = parseLLMJsonResponse(content);

    if (parseResult.warnings.length > 0) {
      log.warn({ request_id: requestId, warnings: parseResult.warnings }, 'deterministic.llm_parse_warnings');
    }

    return parseResult.response;
  } catch (err) {
    log.error({ request_id: requestId, err }, 'deterministic.llm_call.failed');
    return {
      text: "I'm processing your request. Could you tell me more about what you'd like to do?",
      insights: [],
      recommended_actions: [],
    };
  }
}

// ============================================================================
// Parameter Extraction
// ============================================================================

/**
 * Extract action parameters from user message for deterministic dispatch.
 * Lightweight — complex extraction happens in action handlers via entity resolution.
 */
function extractParams(message: string, action: ActionName): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Extract numeric values
  const numberMatch = message.match(/\b(\d+(?:\.\d+)?)\b/);
  if (numberMatch) {
    if (action === 'set_factor_value') params.value = parseFloat(numberMatch[1]);
    if (action === 'set_goal_target') params.threshold = parseFloat(numberMatch[1]);
    if (action === 'adjust_edge_strength') params.strength_mean = parseFloat(numberMatch[1]);
  }

  // Extract target references — everything after key prepositions
  const targetMatch = message.match(/(?:for|on|of|to|about|called)\s+['"]?([^'",.!?]+)/i);
  if (targetMatch) {
    params.target_id = targetMatch[1].trim();
  }

  return params;
}
