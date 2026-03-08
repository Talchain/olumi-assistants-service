/**
 * Parallel Generate Model
 *
 * When generate_model: true, fires draft_graph and orchestrator coaching
 * concurrently via Promise.allSettled(), eliminating ~40s of sequential
 * latency (orchestrator selects tool → tool executes).
 *
 * Response is assembled from both results with graceful partial failure:
 * - Both succeed: coaching text + graph_patch block
 * - Draft fails, coaching succeeds: coaching text, no graph
 * - Coaching fails, draft succeeds: fallback text + graph_patch block
 * - Both fail: error envelope
 */

import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { log } from "../utils/telemetry.js";
import { getAdapter, getMaxTokensFromConfig } from "../adapters/llm/router.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../config/timeouts.js";
import { handleDraftGraph } from "./tools/draft-graph.js";
import type { DraftGraphResult } from "./tools/draft-graph.js";
import { assembleEnvelope, buildTurnPlan } from "./envelope.js";
import type {
  OrchestratorTurnRequest,
  OrchestratorResponseEnvelope,
  ConversationBlock,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface ParallelGenerateResult {
  envelope: OrchestratorResponseEnvelope;
  httpStatus: number;
}

// ============================================================================
// Coaching prompt (Zone 2 parallel context)
// ============================================================================

const PARALLEL_COACHING_INSTRUCTION = `This is a parallel generation turn. The user has submitted a decision brief and requested model generation. A causal model is being generated simultaneously by the draft_graph pipeline.

Your role on this turn:
- Assess the brief's framing quality
- Identify assumptions the user may not have stated
- Flag missing context that could improve the model
- Suggest what to explore once the model is ready
- Do NOT select or call any tools. The draft_graph tool is already executing.

Respond conversationally as a decision science coach reviewing their brief.`;

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute parallel generation: draft_graph + coaching LLM call concurrently.
 */
export async function handleParallelGenerate(
  turnRequest: OrchestratorTurnRequest,
  request: FastifyRequest,
  requestId: string,
): Promise<ParallelGenerateResult> {
  const turnId = randomUUID();
  const brief = turnRequest.message;

  if (!brief || brief.trim().length === 0) {
    return {
      httpStatus: 400,
      envelope: assembleEnvelope({
        turnId,
        assistantText: null,
        blocks: [],
        context: turnRequest.context,
        error: {
          code: 'INVALID_REQUEST',
          message: 'generate_model requires a non-empty message (the decision brief)',
          recoverable: false,
        },
      }),
    };
  }

  log.info(
    { request_id: requestId, brief_length: brief.length, turn_id: turnId },
    "parallel_generate: starting concurrent draft_graph + coaching",
  );

  // Fire both calls concurrently
  const [draftSettled, coachingSettled] = await Promise.allSettled([
    handleDraftGraph(brief, request, turnId),
    runCoachingCall(brief, requestId),
  ]);

  const draftResult = draftSettled.status === 'fulfilled' ? draftSettled.value : null;
  const draftError = draftSettled.status === 'rejected' ? draftSettled.reason : null;
  const coachingText = coachingSettled.status === 'fulfilled' ? coachingSettled.value : null;
  const coachingError = coachingSettled.status === 'rejected' ? coachingSettled.reason : null;

  log.info(
    {
      request_id: requestId,
      draft_ok: draftResult !== null,
      coaching_ok: coachingText !== null,
      draft_error: draftError ? String(draftError) : undefined,
      coaching_error: coachingError ? String(coachingError) : undefined,
    },
    "parallel_generate: both calls settled",
  );

  // Assemble response based on which calls succeeded
  if (draftResult && coachingText !== null) {
    return assembleBothSucceeded(turnId, turnRequest, draftResult, coachingText);
  }

  if (!draftResult && coachingText !== null) {
    return assembleDraftFailed(turnId, turnRequest, coachingText, draftError);
  }

  if (draftResult && coachingText === null) {
    return assembleCoachingFailed(turnId, turnRequest, draftResult, coachingError, requestId);
  }

  // Both failed
  return assembleBothFailed(turnId, turnRequest, draftError, coachingError);
}

// ============================================================================
// Coaching LLM call (no tools)
// ============================================================================

async function runCoachingCall(brief: string, requestId: string): Promise<string> {
  const adapter = getAdapter('orchestrator');

  const systemPrompt = PARALLEL_COACHING_INSTRUCTION;

  const result = await adapter.chat(
    {
      system: systemPrompt,
      userMessage: brief,
      maxTokens: getMaxTokensFromConfig('orchestrator'),
    },
    { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
  );

  return result.content;
}

// ============================================================================
// Response assembly variants
// ============================================================================

function assembleBothSucceeded(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  draftResult: DraftGraphResult,
  coachingText: string,
): ParallelGenerateResult {
  const blocks: ConversationBlock[] = [...draftResult.blocks];

  return {
    httpStatus: 200,
    envelope: assembleEnvelope({
      turnId,
      assistantText: coachingText,
      blocks,
      context: turnRequest.context,
      turnPlan: buildTurnPlan('draft_graph', 'deterministic', true, draftResult.latencyMs),
    }),
  };
}

function assembleDraftFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  coachingText: string,
  draftError: unknown,
): ParallelGenerateResult {
  const errorNote = "I wasn't able to generate the model this time. You can try again, or refine your brief based on my notes below.";
  const assistantText = `${errorNote}\n\n${coachingText}`;

  log.warn(
    { turn_id: turnId, error: draftError instanceof Error ? draftError.message : String(draftError) },
    "parallel_generate: draft_graph failed, returning coaching only",
  );

  return {
    httpStatus: 200,
    envelope: assembleEnvelope({
      turnId,
      assistantText,
      blocks: [],
      context: turnRequest.context,
      turnPlan: buildTurnPlan('draft_graph', 'deterministic', true),
    }),
  };
}

function assembleCoachingFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  draftResult: DraftGraphResult,
  coachingError: unknown,
  requestId: string,
): ParallelGenerateResult {
  log.warn(
    { request_id: requestId, error: coachingError instanceof Error ? coachingError.message : String(coachingError) },
    "parallel_generate: coaching LLM failed, using fallback text",
  );

  // Build fallback text from draft pipeline outputs
  const fallbackParts: string[] = [];
  fallbackParts.push("Your causal model has been generated. Here's what I found:");

  if (draftResult.assistantText) {
    fallbackParts.push(draftResult.assistantText);
  }

  if (draftResult.narrationHint) {
    fallbackParts.push(draftResult.narrationHint);
  }

  if (fallbackParts.length === 1) {
    fallbackParts.push("Review the model structure and let me know if you'd like to refine any factors or connections.");
  }

  const blocks: ConversationBlock[] = [...draftResult.blocks];

  return {
    httpStatus: 200,
    envelope: assembleEnvelope({
      turnId,
      assistantText: fallbackParts.join('\n\n'),
      blocks,
      context: turnRequest.context,
      turnPlan: buildTurnPlan('draft_graph', 'deterministic', true, draftResult.latencyMs),
    }),
  };
}

function assembleBothFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  draftError: unknown,
  coachingError: unknown,
): ParallelGenerateResult {
  log.error(
    {
      turn_id: turnId,
      draft_error: draftError instanceof Error ? draftError.message : String(draftError),
      coaching_error: coachingError instanceof Error ? coachingError.message : String(coachingError),
    },
    "parallel_generate: both calls failed",
  );

  return {
    httpStatus: 500,
    envelope: assembleEnvelope({
      turnId,
      assistantText: null,
      blocks: [],
      context: turnRequest.context,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'Both model generation and coaching failed. Please try again.',
        tool: 'draft_graph',
        recoverable: true,
        suggested_retry: 'Try generating the model again.',
      },
    }),
  };
}
