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
  TypedConversationBlock,
} from "./types.js";
import { extractBriefIntelligence } from "./brief-intelligence/extract.js";
import type { BriefIntelligence } from "../schemas/brief-intelligence.js";
import { formatBilForCoaching, formatBilForDraftGraph } from "./brief-intelligence/format.js";
import { config } from "../config/index.js";
import { assembleDskCoachingItems } from "./dsk-coaching/index.js";
import type { EvidenceGap } from "./dsk-coaching/index.js";
import type { DskCoachingItems } from "../schemas/dsk-coaching.js";
import type { GraphV3T } from "./types.js";
import { assembleFullPrompt } from "./prompt-zones/assemble.js";
import { validateAssembly } from "./prompt-zones/validate.js";
import { ZONE2_BLOCKS } from "./prompt-zones/zone2-blocks.js";
import type { TurnContext } from "./prompt-zones/zone2-blocks.js";
import { compactGraph } from "./context/graph-compact.js";
import { assembleAnalysisInputsSummary } from "./analysis-inputs/assemble.js";
import { callBriefSpecialist } from "./moe-spike/call-specialist.js";
import { compareSpikeWithBil } from "./moe-spike/compare.js";
import { persistSpikeComparison } from "./moe-spike/persist.js";

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

  // BIL extraction (deterministic, <50ms) — always runs; injection gated by flag
  const bilEnabled = config.features.bilEnabled;
  const bilMinLength = 50;
  const bil = bilEnabled && brief.trim().length >= bilMinLength
    ? extractBriefIntelligence(brief, null, turnRequest.context.framing?.stage ?? 'frame')
    : null;

  const coachingBilContext = bil ? formatBilForCoaching(bil) : undefined;
  const draftBilHeader = bil ? formatBilForDraftGraph(bil) : undefined;

  log.info(
    { request_id: requestId, brief_length: brief.length, turn_id: turnId, bil_enabled: bilEnabled, bil_extracted: bil !== null },
    "parallel_generate: starting concurrent draft_graph + coaching",
  );

  try {
    // Fire calls concurrently — spike is conditional on feature flag + BIL
    const moeSpikeEnabled = config.features.moeSpikeEnabled;
    const promises: [Promise<DraftGraphResult>, Promise<string>, ...Promise<unknown>[]] = [
      handleDraftGraph(brief, request, turnId, draftBilHeader ? { briefSignalsHeader: draftBilHeader } : undefined),
      runCoachingCall(brief, turnRequest.context, requestId, coachingBilContext),
    ];
    if (moeSpikeEnabled && bil) {
      promises.push(callBriefSpecialist(brief, requestId));
    }

    const settled = await Promise.allSettled(promises);
    const draftSettled = settled[0];
    const coachingSettled = settled[1];

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

    // MoE spike: compare with BIL, log metadata only, persist fire-and-forget
    if (moeSpikeEnabled && bil && settled.length > 2) {
      const spikeSettled = settled[2];
      if (spikeSettled.status === 'fulfilled') {
        const outcome = spikeSettled.value as Awaited<ReturnType<typeof callBriefSpecialist>>;
        if (outcome.ok) {
          const comparison = compareSpikeWithBil(outcome.result, bil, outcome.briefHash);
          log.info(
            {
              request_id: requestId,
              verdict: comparison.verdict,
              spike_bias_count: comparison.spike_bias_count,
              bil_bias_count: comparison.bil_bias_count,
              bias_agreed: comparison.bias_agreed.length,
              bias_spike_only: comparison.bias_spike_only.length,
              bias_bil_only: comparison.bias_bil_only.length,
              latency_ms: outcome.latencyMs,
            },
            'moe-spike: comparison complete',
          );
          // Fire-and-forget — never awaited, never on critical path
          persistSpikeComparison(comparison, outcome.result).catch(() => {});
        } else {
          log.warn(
            { request_id: requestId, error: outcome.error, latency_ms: outcome.latencyMs },
            'moe-spike: specialist call failed',
          );
        }
      } else {
        log.warn(
          { request_id: requestId, error: String(spikeSettled.reason) },
          'moe-spike: specialist call rejected',
        );
      }
    }

    // DSK coaching assembly (post-model: bias alerts + technique recommendations)
    const dskCoaching = bil
      ? assembleDskCoachingItems(
          bil,
          'post_model',
          extractEvidenceGapsFromGraph(bil, draftResult?.graphOutput ?? null),
          null, // dominantDriverId — not available from draft_graph pipeline
        )
      : undefined;

    // Assemble response based on which calls succeeded
    let result: ParallelGenerateResult;

    if (draftResult && coachingText !== null) {
      result = assembleBothSucceeded(turnId, turnRequest, draftResult, coachingText, dskCoaching);
    } else if (!draftResult && coachingText !== null) {
      result = assembleDraftFailed(turnId, turnRequest, coachingText, draftError, dskCoaching);
    } else if (draftResult && coachingText === null) {
      result = assembleCoachingFailed(turnId, turnRequest, draftResult, coachingError, requestId, dskCoaching);
    } else {
      result = assembleBothFailed(turnId, turnRequest, draftError, coachingError, dskCoaching);
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
  bilContext?: string,
): Promise<string> {
  const adapter = getAdapter('orchestrator');

  // Append BIL context to user message if provided
  const userMessage = bilContext ? `${brief}\n\n${bilContext}` : brief;

  let systemPrompt: string;

  if (config.features.zone2Registry) {
    // Zone 2 registry path: build TurnContext for parallel_coaching profile
    const graph = context.graph ?? null;
    const analysisResponse = context.analysis_response ?? null;
    const turnContext: TurnContext = {
      stage: context.framing?.stage ?? 'frame',
      goal: context.framing?.goal,
      constraints: context.framing?.constraints,
      options: context.framing?.options,
      graphCompact: graph ? compactGraph(graph) : null,
      analysisSummary: analysisResponse ? assembleAnalysisInputsSummary(analysisResponse) : null,
      eventLogSummary: context.event_log_summary ?? '',
      messages: context.messages ?? [],
      selectedElements: context.selected_elements ?? [],
      bilContext,
      bilEnabled: config.features.bilEnabled,
      hasGraph: graph != null,
      hasAnalysis: analysisResponse != null,
      generateModel: true,
    };
    const assembled = assembleFullPrompt(
      PARALLEL_COACHING_INSTRUCTION,
      'parallel-coaching-v1',
      turnContext,
      ZONE2_BLOCKS,
    );
    const strictPromptValidation = config.features.strictPromptValidation;
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, PARALLEL_COACHING_INSTRUCTION.length, strictPromptValidation);
    if (warnings.length > 0) {
      log.warn({ request_id: requestId, warnings: warnings.map((w) => w.code) }, 'Zone 2 validation warnings (parallel coaching)');
    }
    log.info(
      {
        request_id: requestId,
        profile: assembled.profile,
        reason: assembled.selection_reason,
        blocks: assembled.active_blocks.map((b) => `${b.name}@${b.version}`),
        chars: assembled.total_chars,
        trimmed: assembled.trimmed_blocks,
      },
      'Prompt assembled via Zone 2 registry (parallel coaching)',
    );
    systemPrompt = assembled.system_prompt;
  } else {
    systemPrompt = buildCoachingPrompt(context);
  }

  const result = await adapter.chat(
    {
      system: systemPrompt,
      userMessage,
      maxTokens: getMaxTokensFromConfig('orchestrator') ?? 16000,
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
  dskCoaching?: DskCoachingItems,
): ParallelGenerateResult {
  const blocks: TypedConversationBlock[] = [...draftResult.blocks];

  return {
    httpStatus: 200,
    envelope: assembleEnvelope({
      turnId,
      assistantText: coachingText,
      blocks,
      context: turnRequest.context,
      turnPlan: buildTurnPlan('draft_graph', 'deterministic', true, draftResult.latencyMs),
      dskCoaching,
    }),
  };
}

function assembleDraftFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  coachingText: string,
  draftError: unknown,
  dskCoaching?: DskCoachingItems,
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
      dskCoaching,
    }),
  };
}

function assembleCoachingFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  draftResult: DraftGraphResult,
  coachingError: unknown,
  requestId: string,
  dskCoaching?: DskCoachingItems,
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

  const blocks: TypedConversationBlock[] = [...draftResult.blocks];

  return {
    httpStatus: 200,
    envelope: assembleEnvelope({
      turnId,
      assistantText: fallbackParts.join('\n\n'),
      blocks,
      context: turnRequest.context,
      turnPlan: buildTurnPlan('draft_graph', 'deterministic', true, draftResult.latencyMs),
      dskCoaching,
    }),
  };
}

function assembleBothFailed(
  turnId: string,
  turnRequest: OrchestratorTurnRequest,
  draftError: unknown,
  coachingError: unknown,
  dskCoaching?: DskCoachingItems,
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
      dskCoaching,
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

// ============================================================================
// Evidence gap extraction
// ============================================================================

/**
 * Extract evidence gaps from BIL factors + optional graph.
 *
 * Source mapping:
 * - factor_id / factor_label: from BIL factor extraction (brief text)
 * - confidence: from graph node exists_probability if present, else BIL factor confidence
 * - has_observed_value: null (not available from draft_graph pipeline)
 * - is_quantitative: null (not available from draft_graph pipeline)
 * - voi: null (not available from draft_graph pipeline — requires run_analysis)
 *
 * When pipeline evidence_gaps become available on DraftGraphResult, prefer them
 * over this BIL-derived fallback.
 */
/** @internal Exported for testing only. */
export function extractEvidenceGapsFromGraph(
  bil: BriefIntelligence,
  graph: GraphV3T | null,
): EvidenceGap[] {
  if (bil.factors.length === 0) return [];

  // Build node lookup from graph (if available)
  const nodeMap = new Map<string, { confidence: number }>();
  if (graph && Array.isArray((graph as Record<string, unknown>).nodes)) {
    for (const node of (graph as Record<string, unknown[]>).nodes) {
      const n = node as Record<string, unknown>;
      const id = typeof n.id === 'string' ? n.id : undefined;
      const label = typeof n.label === 'string' ? n.label.toLowerCase() : undefined;
      const ep = typeof n.exists_probability === 'number' ? n.exists_probability : undefined;
      if (id && ep != null) {
        nodeMap.set(id, { confidence: ep });
        if (label) nodeMap.set(label, { confidence: ep });
      }
    }
  }

  return bil.factors.map((f): EvidenceGap => {
    // Try to match factor to graph node by label
    const graphNode = nodeMap.get(f.label.toLowerCase());
    return {
      factor_id: f.label.toLowerCase().replace(/\s+/g, '_'),
      factor_label: f.label,
      confidence: graphNode?.confidence ?? f.confidence,
      // Nullable — not available from draft_graph pipeline. Skip precedence rules 2-4 that need these.
      has_observed_value: null,
      is_quantitative: null,
      voi: null,
    };
  });
}
