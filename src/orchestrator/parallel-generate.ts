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
import {
  getIdempotentResponse,
  setIdempotentResponse,
  getInflightRequest,
  registerInflightRequest,
} from "./idempotency.js";
import { getHttpStatusForError } from "./types.js";
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

/**
 * Build the coaching system prompt by appending stage/framing context
 * from the conversation context (same data Zone 2 uses in the simple
 * prompt assembly path). This gives the coaching LLM awareness of the
 * user's decision stage, goal, and constraints without pulling in the
 * full orchestrator prompt (which contains tool definitions).
 */
function buildCoachingPrompt(context: OrchestratorTurnRequest['context']): string {
  const sections: string[] = [PARALLEL_COACHING_INSTRUCTION];

  const stage = context.framing?.stage ?? 'frame';
  sections.push(`Current stage: ${stage}`);

  const goal = context.framing?.goal;
  if (goal) {
    sections.push(`Decision goal: ${goal}`);
  }

  const constraints = context.framing?.constraints;
  if (constraints && constraints.length > 0) {
    sections.push(`Constraints: ${constraints.join('; ')}`);
  }

  const options = context.framing?.options;
  if (options && options.length > 0) {
    sections.push(`Options under consideration: ${options.join('; ')}`);
  }

  return sections.join('\n');
}

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

  // Idempotency: return cached response if available
  const cached = getIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (cached) {
    log.info({ request_id: requestId, client_turn_id: turnRequest.client_turn_id }, "parallel_generate: idempotency cache hit");
    const status = cached.error ? getHttpStatusForError(cached.error) : 200;
    return { envelope: cached, httpStatus: status };
  }

  // Concurrent dedup: await in-flight request if one exists
  const inflightEnvelope = getInflightRequest(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (inflightEnvelope) {
    log.info({ request_id: requestId, client_turn_id: turnRequest.client_turn_id }, "parallel_generate: inflight dedup hit");
    const envelope = await inflightEnvelope;
    const status = envelope.error ? getHttpStatusForError(envelope.error) : 200;
    return { envelope, httpStatus: status };
  }

  // Register in-flight promise for concurrent dedup
  let resolveInflight!: (value: OrchestratorResponseEnvelope) => void;
  const inflightPromise = new Promise<OrchestratorResponseEnvelope>((resolve) => {
    resolveInflight = resolve;
  });
  registerInflightRequest(turnRequest.scenario_id, turnRequest.client_turn_id, inflightPromise);

  log.info(
    { request_id: requestId, brief_length: brief.length, turn_id: turnId },
    "parallel_generate: starting concurrent draft_graph + coaching",
  );

  try {
    // Fire both calls concurrently
    const [draftSettled, coachingSettled] = await Promise.allSettled([
      handleDraftGraph(brief, request, turnId),
      runCoachingCall(brief, turnRequest.context, requestId),
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
    let result: ParallelGenerateResult;

    if (draftResult && coachingText !== null) {
      result = assembleBothSucceeded(turnId, turnRequest, draftResult, coachingText);
    } else if (!draftResult && coachingText !== null) {
      result = assembleDraftFailed(turnId, turnRequest, coachingText, draftError);
    } else if (draftResult && coachingText === null) {
      result = assembleCoachingFailed(turnId, turnRequest, draftResult, coachingError, requestId);
    } else {
      result = assembleBothFailed(turnId, turnRequest, draftError, coachingError);
    }

    // Cache and resolve in-flight
    setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, result.envelope);
    resolveInflight(result.envelope);

    return result;
  } catch (error) {
    // Unexpected throw (e.g. assembleEnvelope/hashContext failure) —
    // build error envelope and always resolve in-flight to prevent hung waiters.
    log.error(
      { request_id: requestId, error: error instanceof Error ? error.message : String(error) },
      "parallel_generate: unexpected error",
    );

    const errorEnvelope = assembleEnvelope({
      turnId,
      assistantText: null,
      blocks: [],
      context: turnRequest.context,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'Parallel generation encountered an unexpected error.',
        tool: 'draft_graph',
        recoverable: true,
      },
    });

    setIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id, errorEnvelope);
    resolveInflight(errorEnvelope);

    return { httpStatus: 500, envelope: errorEnvelope };
  }
}

// ============================================================================
// Coaching LLM call (no tools)
// ============================================================================

async function runCoachingCall(
  brief: string,
  context: OrchestratorTurnRequest['context'],
  requestId: string,
): Promise<string> {
  const adapter = getAdapter('orchestrator');

  const result = await adapter.chat(
    {
      system: buildCoachingPrompt(context),
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
