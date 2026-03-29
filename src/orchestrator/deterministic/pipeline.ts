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
            llmCallMeta = await callLLM(turnContext, turnRequest.message, requestId);
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
  const llmCallResult = await callLLM(turnContext, turnRequest.message, requestId);
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
}

async function callLLM(
  turnContext: DeterministicTurnContext,
  userMessage: string,
  requestId: string,
): Promise<LLMCallResult | null> {
  try {
    const adapter = getAdapter('orchestrator');
    const systemPrompt = buildDeterministicPrompt(turnContext);

    // JSON-forcing suffix: aligns with v30.5 prompt evaluation.
    // Redundant when responseFormat: 'json_object' is honoured, but harmless.
    const effectiveMessage = userMessage + '\n\nRespond with valid JSON only.';

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

    const content = response.content;

    const parseResult = parseLLMJsonResponse(content);

    if (parseResult.warnings.length > 0) {
      log.warn({ request_id: requestId, warnings: parseResult.warnings }, 'deterministic.llm_parse_warnings');
    }

    // Emit structured json_fallback event when non-native extraction used
    if (parseResult.extraction_method !== 'native') {
      emit('deterministic.json_fallback', {
        method: parseResult.extraction_method,
        scenario_id: turnContext.scenario_id,
        turn_id: requestId,
      });
    }

    return {
      response: parseResult.response,
      extraction_method: parseResult.extraction_method,
      prompt_char_count: systemPrompt.length,
    };
  } catch (err) {
    log.error({ request_id: requestId, err }, 'deterministic.llm_call.failed');
    return null;
  }
}

