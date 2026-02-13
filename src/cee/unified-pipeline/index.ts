/**
 * Unified Pipeline Orchestrator (CIL Phase 3B)
 *
 * Replaces the Pipeline A + Pipeline B nesting with a single 6-stage pipeline.
 * Each stage calls existing functions from their current locations — no logic rewrite.
 *
 * Stages:
 *  1. Parse     — LLM draft + adapter normalisation
 *  2. Normalise — STRP + risk coefficients (field transforms only)
 *  3. Enrich    — Factor enrichment (ONCE)
 *  4. Repair    — Validation + repair + goal merge + connectivity + clarifier
 *  5. Package   — Caps + warnings + quality + trace assembly
 *  6. Boundary  — V3 transform + analysis_ready + model_adjustments
 *
 * Feature flag: CEE_UNIFIED_PIPELINE_ENABLED (default false)
 */

import type { FastifyRequest } from "fastify";
import type { StageContext, UnifiedPipelineOpts, UnifiedPipelineResult, DraftInputWithCeeExtras } from "./types.js";
import { getRequestId } from "../../utils/request-id.js";
import { config } from "../../config/index.js";
import { createCorrectionCollector } from "../corrections.js";
import { log } from "../../utils/telemetry.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError } from "../../adapters/llm/errors.js";
import { buildCeeErrorResponse } from "../validation/pipeline.js";

import { runStageParse } from "./stages/parse.js";
import { runStageNormalise } from "./stages/normalise.js";
import { runStageEnrich } from "./stages/enrich.js";
import { runStageRepair } from "./stages/repair/index.js";
import { runStagePackage } from "./stages/package.js";
import { runStageBoundary } from "./stages/boundary.js";

function buildInitialContext(
  input: DraftInputWithCeeExtras,
  rawBody: unknown,
  request: FastifyRequest,
  opts: UnifiedPipelineOpts,
): StageContext {
  return {
    // Inputs
    input,
    rawBody,
    request,
    requestId: getRequestId(request),
    opts,
    start: opts.requestStartMs ?? Date.now(),

    // Mutable graph
    graph: undefined,

    // Stage 1 outputs
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: undefined,
    confidence: undefined,
    clarifierStatus: undefined,
    effectiveBrief: input.brief,
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,

    // Stage 2 outputs
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],

    // Stage 3 outputs
    enrichmentResult: undefined,
    hadCycles: false,

    // Stage 4 outputs
    nodeRenames: new Map(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    repairCost: 0,
    repairFallbackReason: undefined,
    clarifierResult: undefined,
    structuralMeta: undefined,
    validationSummary: undefined,

    // Stage 5 outputs
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,

    // Stage 6 outputs
    finalResponse: undefined,

    // Cross-cutting
    collector: createCorrectionCollector(),
    pipelineCheckpoints: [],
    checkpointsEnabled: config.cee.pipelineCheckpointsEnabled,
  };
}

function buildRawOutputResponse(ctx: StageContext): UnifiedPipelineResult {
  return {
    statusCode: 200,
    body: {
      graph: ctx.graph,
      rationales: ctx.rationales,
      confidence: ctx.confidence,
    },
  };
}

function mapPipelineError(error: unknown, ctx: StageContext): UnifiedPipelineResult {
  const err = error instanceof Error ? error : new Error(String(error));

  if (err instanceof LLMTimeoutError) {
    log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM timeout");
    return {
      statusCode: 504,
      body: buildCeeErrorResponse("CEE_TIMEOUT", err.message, { requestId: ctx.requestId, retryable: true }),
    };
  }

  if (err instanceof RequestBudgetExceededError) {
    log.warn({ error: err, requestId: ctx.requestId }, "Unified pipeline: budget exceeded");
    return {
      statusCode: 429,
      body: buildCeeErrorResponse("CEE_RATE_LIMIT", err.message, { requestId: ctx.requestId }),
    };
  }

  if (err instanceof ClientDisconnectError) {
    log.info({ error: err, requestId: ctx.requestId }, "Unified pipeline: client disconnect");
    return {
      statusCode: 499,
      body: buildCeeErrorResponse("CEE_INTERNAL_ERROR", "Client disconnected", { requestId: ctx.requestId }),
    };
  }

  log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: unexpected error");
  return {
    statusCode: 500,
    body: buildCeeErrorResponse("CEE_INTERNAL_ERROR", "Internal pipeline error", { requestId: ctx.requestId }),
  };
}

export async function runUnifiedPipeline(
  input: DraftInputWithCeeExtras,
  rawBody: unknown,
  request: FastifyRequest,
  opts: UnifiedPipelineOpts,
): Promise<UnifiedPipelineResult> {
  const ctx = buildInitialContext(input, rawBody, request, opts);

  try {
    // Stage 1: Parse — LLM draft + adapter normalisation
    await runStageParse(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;
    if (ctx.opts.rawOutput) return buildRawOutputResponse(ctx);

    // Stage 2: Normalise — STRP + risk coefficients
    await runStageNormalise(ctx);

    // Stage 3: Enrich — Factor enrichment (ONCE)
    await runStageEnrich(ctx);

    // Stage 4: Repair — Validation + goal merge + connectivity + clarifier
    await runStageRepair(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;

    // Stage 5: Package — Quality + warnings + caps + trace
    await runStagePackage(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;

    // Stage 6: Boundary — V3/V2/V1 transform
    await runStageBoundary(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;

    // Defensive guard — all stages wired, so this should never fire
    if (ctx.finalResponse === undefined) {
      log.error({ requestId: ctx.requestId }, "Unified pipeline: no finalResponse after all stages completed");
      return {
        statusCode: 501,
        body: buildCeeErrorResponse("CEE_SERVICE_UNAVAILABLE", "Unified pipeline stages not yet wired", {
          requestId: ctx.requestId,
          reason: "incomplete_wiring",
        }),
      };
    }

    return {
      statusCode: 200,
      body: ctx.finalResponse,
    };
  } catch (error) {
    return mapPipelineError(error, ctx);
  }
}
