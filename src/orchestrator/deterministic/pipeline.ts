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
import { createProposalBlock } from "../blocks/factory.js";

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
          return assembleDeterministicResponse({
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
          });
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
            return assembleDeterministicResponse({
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
          // For chip clicks, return error instead of silently falling through to LLM
          if (chipParams) {
            return assembleDeterministicResponse({
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
            });
          }
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
      text: "I couldn't process that request. Try rephrasing or use one of the suggested actions.",
      insights: [],
      recommended_actions: [],
    };
  }
}

