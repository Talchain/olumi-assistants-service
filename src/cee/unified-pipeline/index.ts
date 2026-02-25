/**
 * Unified Pipeline Orchestrator (CIL Phase 3B)
 *
 * Replaces the Pipeline A + Pipeline B nesting with a single 7-stage pipeline.
 * Each stage calls existing functions from their current locations — no logic rewrite.
 *
 * Stages:
 *  1.  Parse           — LLM draft + adapter normalisation
 *  2.  Normalise       — STRP + risk coefficients (field transforms only)
 *  3.  Enrich          — Factor enrichment (ONCE, try/catch wrapped for degenerate graphs)
 *  4.  Repair          — Validation + repair + goal merge + connectivity + clarifier
 *  4b. Threshold Sweep — Deterministic goal threshold hygiene (non-critical, try/catch wrapped)
 *  5.  Package         — Caps + warnings + quality + trace assembly
 *  6.  Boundary        — V3 transform + analysis_ready + model_adjustments
 *
 * Feature flag: CEE_UNIFIED_PIPELINE_ENABLED (default false)
 */

import type { FastifyRequest } from "fastify";
import type { StageContext, StageSnapshot, PlanAnnotationCheckpoint, UnifiedPipelineOpts, UnifiedPipelineResult, DraftInputWithCeeExtras } from "./types.js";
import { getRequestId, generateRequestId } from "../../utils/request-id.js";
import { computeResponseHash } from "../../utils/response-hash.js";
import { config } from "../../config/index.js";
import { createCorrectionCollector } from "../corrections.js";
import { log } from "../../utils/telemetry.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError, UpstreamNonJsonError, UpstreamHTTPError } from "../../adapters/llm/errors.js";
import { buildCeeErrorResponse } from "../validation/pipeline.js";

import { runStageParse } from "./stages/parse.js";
import { runStageNormalise } from "./stages/normalise.js";
import { runStageEnrich } from "./stages/enrich.js";
import { runStageRepair } from "./stages/repair/index.js";
import { runStagePackage } from "./stages/package.js";
import { runStageBoundary } from "./stages/boundary.js";
import { runStageThresholdSweep } from "./stages/threshold-sweep.js";

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

/**
 * Capture a lightweight snapshot of goal node state for observability.
 * Reads the goal node from ctx.graph and returns the 6 tracking fields.
 */
function captureStageSnapshot(ctx: StageContext): StageSnapshot {
  const nodes = (ctx.graph as any)?.nodes as Array<{ id: string; kind: string; [k: string]: unknown }> | undefined;
  const goalNode = nodes?.find((n) => n.kind === "goal");

  // Distinguish null (LLM explicitly set null) from undefined (field absent).
  // Previous `?? null` collapsed both to null, making forensic diagnosis ambiguous.
  const snap = (field: string): number | string | null | "absent" => {
    if (!goalNode) return "absent";
    if (!(field in goalNode)) return "absent";
    const v = goalNode[field];
    return v === undefined ? "absent" : (v as number | string | null);
  };

  return {
    goal_node_id: goalNode?.id ?? null,
    goal_threshold: snap("goal_threshold") as number | null | "absent",
    goal_threshold_raw: snap("goal_threshold_raw") as number | null | "absent",
    goal_threshold_unit: snap("goal_threshold_unit") as string | null | "absent",
    goal_threshold_cap: snap("goal_threshold_cap") as number | null | "absent",
    goal_constraints_count: Array.isArray(ctx.goalConstraints) ? ctx.goalConstraints.length : 0,
  };
}

/**
 * Capture plan annotation checkpoint after Stage 3 (Enrich).
 *
 * Extracts graph state, rationales, confidence, and context into a
 * deterministic snapshot for lineage tracking and future two-phase flows.
 *
 * INVARIANT: Each stage runs exactly once per request.
 * Parity tests verify: enrich.called_count === 1
 * This function is pure data extraction — it does NOT re-invoke any stage.
 */
function capturePlanAnnotation(ctx: StageContext): PlanAnnotationCheckpoint {
  // plan_id: generated once, stable for the request
  const planId = generateRequestId();

  // plan_hash: deterministic hash of graph state at Stage 3
  const planHash = computeResponseHash(ctx.graph);

  // Extract rationales from Stage 1 (Parse) — already populated on ctx
  const stage3Rationales: PlanAnnotationCheckpoint["stage3_rationales"] = Array.isArray(ctx.rationales)
    ? ctx.rationales.map((r: any) => ({
        node_id: typeof r?.node_id === "string" ? r.node_id : (typeof r?.id === "string" ? r.id : "unknown"),
        rationale: typeof r?.rationale === "string" ? r.rationale : (typeof r?.text === "string" ? r.text : String(r ?? "")),
      }))
    : [];

  // Confidence breakdown from existing context
  const overall = typeof ctx.confidence === "number" ? ctx.confidence : 0;

  // Structure confidence: proportion of nodes connected by at least one edge
  const nodes = Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes : [];
  const edges = Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges : [];
  const connectedIds = new Set<string>();
  for (const e of edges) {
    if (e.from) connectedIds.add(e.from);
    if (e.to) connectedIds.add(e.to);
  }
  const structure = nodes.length > 0 ? connectedIds.size / nodes.length : 0;

  // Parameters confidence: proportion of edges with defined strength_mean
  const edgesWithStrength = edges.filter((e: any) => typeof e.strength_mean === "number").length;
  const parameters = edges.length > 0 ? edgesWithStrength / edges.length : 0;

  // DEPRECATED: Remove after Stream D Review Pass ships.
  // Use context_hash from ContextPackV1 (provenance.context_hash) instead.
  // This v0 hash only covers brief + seed — ContextPackV1 covers all inputs.
  const contextHash = computeResponseHash({
    brief: ctx.input.brief,
    seed: (ctx.input as any).seed,
  });

  // Model and prompt version from LLM metadata (populated by Stage 1)
  const modelId = ctx.llmMeta?.model ?? ctx.draftAdapter?.model ?? "unknown";
  const promptVersion = ctx.llmMeta?.prompt_version ?? "unknown";

  return {
    plan_id: planId,
    plan_hash: planHash,
    stage3_rationales: stage3Rationales,
    confidence: {
      overall: Math.round(overall * 1000) / 1000,
      structure: Math.round(structure * 1000) / 1000,
      parameters: Math.round(parameters * 1000) / 1000,
    },
    open_questions: [],
    context_hash_v0: contextHash,
    model_id: modelId,
    prompt_version: promptVersion,
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

  // Upstream non-JSON: LLM returned unparseable content (e.g. nonsensical brief → garbage output)
  if (err instanceof UpstreamNonJsonError) {
    log.warn({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM returned non-JSON response");
    return {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_LLM_VALIDATION_FAILED", "LLM response could not be parsed — the brief may be too vague or nonsensical", {
        requestId: ctx.requestId,
        reason: "llm_non_json",
        recovery: {
          suggestion: "Provide a clearer, more specific decision brief.",
          hints: [
            "State the specific decision you are trying to make",
            "List 2-3 concrete options you are considering",
            "Describe what success looks like",
          ],
        },
      }),
    };
  }

  // Upstream HTTP error: LLM provider returned non-2xx
  if (err instanceof UpstreamHTTPError) {
    log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM upstream HTTP error");
    return {
      statusCode: 502,
      body: buildCeeErrorResponse("CEE_LLM_UPSTREAM_ERROR", "LLM provider returned an error", {
        requestId: ctx.requestId,
        retryable: true,
      }),
    };
  }

  // LLM schema validation failure or empty response: commonly happens with
  // nonsensical/incoherent briefs that produce degenerate or empty LLM output.
  //
  // COUPLING: Adapter error messages follow the convention "{provider}_{operation}_{failure}"
  // (e.g. "openai_response_invalid_schema", "anthropic_response_invalid_schema",
  // "openai_empty_response"). If adapter error messages change, update this pattern.
  // See: src/adapters/llm/openai.ts, src/adapters/llm/anthropic.ts
  const isLlmSchemaOrEmptyError =
    /^(?:openai|anthropic)_(?:response_invalid_schema|empty_response)/.test(err.message ?? "") ||
    err.message === "draft_graph_missing_result";

  if (isLlmSchemaOrEmptyError) {
    log.warn({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM response failed schema validation");
    return {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_LLM_VALIDATION_FAILED", "LLM produced a response that does not match the expected graph schema", {
        requestId: ctx.requestId,
        reason: "llm_schema_invalid",
        recovery: {
          suggestion: "Provide a clearer, more specific decision brief.",
          hints: [
            "State the specific decision you are trying to make",
            "List 2-3 concrete options you are considering",
            "Describe what success looks like",
          ],
        },
      }),
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
    ctx.stageSnapshots = { stage_1_parse: captureStageSnapshot(ctx) };

    // Stage 2: Normalise — STRP + risk coefficients
    await runStageNormalise(ctx);

    // Stage 3: Enrich — Factor enrichment (ONCE)
    // Defensive: degenerate graphs (empty nodes/edges from nonsensical briefs)
    // can crash enrichment. Catch and return structured error instead of 500.
    try {
      await runStageEnrich(ctx);
    } catch (enrichErr: any) {
      const nodeCount = Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes.length : 0;
      const edgeCount = Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges.length : 0;

      // Distinguish degenerate-graph crashes (user input problem → 400) from
      // genuine internal defects (server bug → still user-facing 400 for UX,
      // but logged at error-level with full stack for investigation).
      const isLikelyDegenerateGraph = nodeCount <= 2 || edgeCount === 0;
      const logLevel = isLikelyDegenerateGraph ? "warn" : "error";
      log[logLevel]({
        event: "cee.enrich.crashed",
        request_id: ctx.requestId,
        error: enrichErr?.message,
        stack: isLikelyDegenerateGraph ? undefined : enrichErr?.stack,
        node_count: nodeCount,
        edge_count: edgeCount,
        likely_degenerate: isLikelyDegenerateGraph,
      }, `Stage 3 (Enrich) crashed — ${isLikelyDegenerateGraph ? "degenerate graph" : "possible internal defect"}`);

      return {
        statusCode: 400,
        body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Unable to construct a valid decision model from this brief", {
          requestId: ctx.requestId,
          reason: "enrichment_failed",
          nodeCount,
          edgeCount,
          recovery: {
            suggestion: "Add more detail to your decision brief before drafting a model.",
            hints: [
              "State the specific decision you are trying to make",
              "List 2-3 concrete options you are considering",
              "Describe what success looks like",
            ],
          },
        }),
      };
    }
    ctx.stageSnapshots.stage_3_enrich = captureStageSnapshot(ctx);
    ctx.planAnnotation = capturePlanAnnotation(ctx);

    // Stage 4: Repair — Validation + goal merge + connectivity + clarifier
    await runStageRepair(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;
    ctx.stageSnapshots.stage_4_repair = captureStageSnapshot(ctx);

    // Stage 4b: Threshold Sweep — deterministic goal threshold hygiene
    // Non-critical: failing to strip thresholds must not crash the pipeline.
    try {
      await runStageThresholdSweep(ctx);
    } catch (sweepErr: any) {
      log.warn({
        event: "cee.threshold_sweep.failed",
        request_id: ctx.requestId,
        error: sweepErr?.message,
        stack: sweepErr?.stack,
      }, "Stage 4b (threshold sweep) failed — continuing without threshold stripping");
    }
    ctx.stageSnapshots.stage_4b_threshold_sweep = captureStageSnapshot(ctx);

    // Stage 5: Package — Quality + warnings + caps + trace
    await runStagePackage(ctx);
    if (ctx.earlyReturn) return ctx.earlyReturn;
    ctx.stageSnapshots.stage_5_package = captureStageSnapshot(ctx);

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
