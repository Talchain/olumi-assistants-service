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
 *  4.  Repair          — Validation + repair + goal merge + connectivity
 *  4b. Threshold Sweep — Deterministic goal threshold hygiene (non-critical, try/catch wrapped)
 *  5.  Package         — Caps + warnings + quality + trace assembly
 *  6.  Boundary        — V3 transform + analysis_ready + model_adjustments
 *
 * Always-on (CEE_UNIFIED_PIPELINE_ENABLED retired — legacy Pipeline A+B removed)
 */

import type { FastifyRequest } from "fastify";
import type { StageContext, StageSnapshot, PlanAnnotationCheckpoint, UnifiedPipelineOpts, UnifiedPipelineResult, DraftInputWithCeeExtras, PipelineOutcome, PipelineStageEvent } from "./types.js";
import { getRequestId, generateRequestId } from "../../utils/request-id.js";
import { computeResponseHash } from "../../utils/response-hash.js";
import { config } from "../../config/index.js";
import { createCorrectionCollector } from "../corrections.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError, UpstreamNonJsonError, UpstreamHTTPError } from "../../adapters/llm/errors.js";
import { isDemandNotBriefFailure } from "../../adapters/llm/draft-budget.js";
import { buildCeeErrorResponse } from "../validation/pipeline.js";
import { buildLlmMetadataProjection } from "./llm-metadata-projection.js";
import type { DraftGraphTimings } from "../../orchestrator-v5/telemetry/turn-timings.js";

import { runStageParse } from "./stages/parse.js";
import { runStageNormalise } from "./stages/normalise.js";
import { runStageEnrich } from "./stages/enrich.js";
import { runStageRepair } from "./stages/repair/index.js";
import { runStageCoachingPass } from "./stages/coaching-pass.js";
import { runStagePackage } from "./stages/package.js";
import { runStageBoundary } from "./stages/boundary.js";
import { runStageThresholdSweep } from "./stages/threshold-sweep.js";
import { runValidationPipeline } from "../validation-pipeline/index.js";
import { projectGraphForStagedFrame } from "./staged-graph-projection.js";

/**
 * Stamp coaching_status 'complete' at a terminal exit UNLESS the coaching pass
 * already owns a terminal marker: 'skipped_budget' (Lane C2, budget skip) or
 * 'failed_degraded' (draft-F3, ran-and-errored). Consolidates the two identical
 * preserve-guards at the pipeline's fallback + main exits (simplification F6,
 * 2026-07-24) so a marker can never be clobbered on only one path.
 */
export function markCoachingCompleteUnlessTerminal(outcome: PipelineOutcome): void {
  if (
    outcome.coaching_status !== 'skipped_budget' &&
    outcome.coaching_status !== 'failed_degraded'
  ) {
    outcome.coaching_status = 'complete';
  }
}

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

    // Pipeline outcome (Track 1: progressive degradation)
    pipelineOutcome: {
      graph_drafted: false,
      graph_structurally_valid: false,
      deterministic_sweep_violations: 0,
      verification_status: 'skipped',
      validation_status: 'skipped',
      enrichment_status: 'skipped',
      coaching_status: 'partial',
      warnings: [],
      rescue_score: 0,
      factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
      edge_strength_unique_count: 0,
      llm_repair: { triggered: false, outcome: 'skipped', fallback_reason: null, attempts: 0 },
      repair_provenance: [],
    },
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

/**
 * Decision rule for whether a Stage 2 (Normalise) exception is safe to
 * degrade-and-continue. ONLY error classes whose recovery is explicitly
 * backstopped by Stage 4 (Repair) post-conditions belong here.
 *
 * Initial allowlist: EMPTY. Stage 4 covers CATEGORY_MISMATCH and
 * SIGN_MISMATCH structurally, but the throw shape that exposes them via
 * Stage 2 is not enumerated by existing tests, so we cannot assert safe
 * degrade for any class without that proof. Adding entries here requires
 * a paired test fixture proving the Stage 4 backstop holds for that
 * class — the contract suite lives in
 * `tests/unit/cee.unified-pipeline.graceful-degradation.test.ts`
 * (`describe("isKnownSafeNormaliseError allowlist")` + the "Stage 2
 * throws ..." pipeline-level cases).
 *
 * The default path (typed-fail) is the conservative choice — a typed
 * recoverable error is strictly better than a silently-damaged graph
 * reaching Stage 3+.
 */
export function isKnownSafeNormaliseError(_err: unknown): boolean {
  // Allowlist intentionally empty for the initial typed-fail-by-default
  // ship. Each addition must be paired with a regression test proving the
  // Stage 4 backstop covers the error class.
  return false;
}

function mapPipelineError(error: unknown, ctx: StageContext): UnifiedPipelineResult {
  const err = error instanceof Error ? error : new Error(String(error));

  // Merge LLM metadata into error response bodies so that diagnostic trace
  // can record the LLM call even when the pipeline errors after the LLM responded.
  // ctx.llmMeta is populated by Stage 1 (Parse) before downstream stages fail.
  // Uses shallow merge to preserve request_id/correlation_id from buildCeeErrorResponse.
  function withLlmTrace(base: Record<string, unknown>): Record<string, unknown> {
    if (!ctx.llmMeta) return base;
    const baseTrace = (base.trace ?? {}) as Record<string, unknown>;
    const basePipeline = (baseTrace.pipeline ?? {}) as Record<string, unknown>;
    return {
      ...base,
      trace: {
        ...baseTrace,
        pipeline: {
          ...basePipeline,
          // ONE projection, shared with the success surface in stages/package.ts.
          // This list used to be a SIX-key hand-written subset of the success
          // surface's fifteen, so a failed draft's response omitted `max_tokens`
          // (the cap that caused the truncation) and `runaway_abort_count` (the
          // aborts that starved it) — the two fields a truncation diagnosis
          // actually needs. See llm-metadata-projection.ts.
          llm_metadata: buildLlmMetadataProjection(ctx.llmMeta, ctx.draftAdapter?.model),
        },
      },
    };
  }

  if (err instanceof LLMTimeoutError) {
    log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM timeout");
    return {
      statusCode: 504,
      body: withLlmTrace(buildCeeErrorResponse("CEE_TIMEOUT", err.message, { requestId: ctx.requestId, retryable: true })),
    };
  }

  if (err instanceof RequestBudgetExceededError) {
    log.warn({ error: err, requestId: ctx.requestId }, "Unified pipeline: budget exceeded");
    // CEE_BUDGET_EXCEEDED, not CEE_RATE_LIMIT: the error carries
    // budgetMs/elapsedMs — this is an elapsed-time DEADLINE breach, not a
    // throttle and not a spend cap. Sharing CEE_RATE_LIMIT here is what made
    // the 2026-07-20 draft-timeout investigation read these 429s as throttling.
    return {
      statusCode: 429,
      body: withLlmTrace(buildCeeErrorResponse("CEE_BUDGET_EXCEEDED", err.message, { requestId: ctx.requestId })),
    };
  }

  if (err instanceof ClientDisconnectError) {
    log.info({ error: err, requestId: ctx.requestId }, "Unified pipeline: client disconnect");
    return {
      statusCode: 499,
      body: withLlmTrace(buildCeeErrorResponse("CEE_INTERNAL_ERROR", "Client disconnected", { requestId: ctx.requestId })),
    };
  }

  // Demand-vs-brief classification (S-AUDIT-2026-07-20 probe, aggravator 1;
  // GENERALISED F1, 2026-07-25). A draft that outgrew CEE's token/time budget is
  // a demand-exceeds-budget failure, not a vague-brief failure, and the two need
  // OPPOSITE recovery copy: asking such a user to be "more specific" increases
  // output-token demand and steers them back into the exact failure. Message-
  // prefix matching cannot carry this (the truncation note breaks the anchored
  // `^anthropic_response_invalid_schema` regex below), so the classification is
  // structural.
  //
  // ⚠ WHY THIS IS NO LONGER AN INLINE PROPERTY READ. It used to be
  // `err.truncated_at_max_tokens === true` — a flag every adapter throw site had
  // to REMEMBER to attach. The `skipped_unaffordable_final` route (the runaway-
  // abort budget running out) did not attach it, so an entirely CEE-side failure
  // was served as `reason: llm_non_json`, `retryable: false`, "Provide a
  // clearer, more specific decision brief" — the cruel inversion this very
  // comment block warns about, committed by the branch below it. #682's fourth
  // abort trigger raised the rate of it. `isDemandNotBriefFailure` DERIVES the
  // answer from the canonical `_llm_meta` every failure route already builds
  // (`buildFailedCallLlmMeta`), so a future throw site cannot silently opt out.
  const demandNotBriefFailure = isDemandNotBriefFailure(err);
  // HONEST COPY (2026-07-23 firefight, CORRECTED 2026-07-25).
  //
  // The failure is the draft outgrowing the token/time budget, NOT a bad brief.
  // Do NOT tell the user to "simplify" or "be more specific" — a vaguer brief
  // gives the model less to anchor on, so it INFERS more factors and options,
  // produces a LARGER graph, and is MORE likely to truncate again (the cruel
  // inversion; see the firefight RCA). That part of the 2026-07-23 copy stands.
  //
  // ⚠ WHAT WAS WITHDRAWN: the lead hint used to read "Retrying the same brief
  // usually succeeds". It was measured on 2026-07-24 and it is FALSE — the
  // identical brief was retried 18 times against staging and succeeded 0 times,
  // each attempt costing the user ~90s and real provider spend. Copy that
  // invites an unbounded retry loop is worse than no copy: it is the product
  // lying about its own recovery odds. The word "usually" was never measured;
  // it was inferred from the failure being *classified* transient.
  //
  // Retry is still offered — `retryable: true` is correct, a truncation is not a
  // client input error — but it is offered ONCE and honestly bounded. The
  // reliable lever is scope narrowing, which genuinely shrinks the graph the
  // model commits to; it is not the cruel inversion because it removes
  // DECISIONS and OPTIONS, not DETAIL.
  const truncationRecovery = {
    suggestion:
      "The draft grew past the time budget and was cut off before it finished, so nothing was saved.",
    hints: [
      "One retry is worth trying — but if it fails the same way again, more retries will not help",
      "Narrowing the scope reliably fixes it: one decision at a time, with fewer options",
      "A very broad brief with many options takes longer to draft",
    ],
  };

  // The copy for the OTHER class: output that genuinely could not be parsed or
  // validated, with no truncation and no runaway abort behind it. Hoisted
  // alongside `truncationRecovery` because it was written out twice below and
  // the two copies had to be kept in step by hand.
  const vagueBriefRecovery = {
    suggestion: "Provide a clearer, more specific decision brief.",
    hints: [
      "State the specific decision you are trying to make",
      "List 2-3 concrete options you are considering",
      "Describe what success looks like",
    ],
  };

  /**
   * ⭐ THE RECOVERY CONTRACT, STATED ONCE for both 400 routes.
   *
   * `buildCeeErrorResponse` ends with `retryable: options.retryable ?? false`,
   * so an OMITTED `retryable` is NOT a missing field on the wire — it is an
   * explicit "do not retry". The old `...(flag ? { retryable: true } : {})`
   * spread therefore told every runaway-aborted user not to retry a failure
   * where one retry is the honest lever. Passing it unconditionally makes both
   * answers deliberate.
   *
   * The demand class deliberately keeps ONE reason string rather than minting a
   * second value: `route-v2.ts:mapDraftGraphPipelineReason` derives the V5 turn
   * surface's retryable from `reason` alone, and a new value would need a new
   * hand-maintained branch over there to be treated the same way (trap 12).
   * Keeping the string means the V5 surface is fixed by this change too.
   *
   * @param briefFailureReason the reason to use when the failure really is the
   *   brief — the only thing that differs between the two routes.
   */
  const recoveryContract = (briefFailureReason: string) => ({
    reason: demandNotBriefFailure ? "llm_truncated_max_tokens" : briefFailureReason,
    retryable: demandNotBriefFailure,
    recovery: demandNotBriefFailure ? truncationRecovery : vagueBriefRecovery,
  });

  // Upstream non-JSON: LLM returned unparseable content — either a draft that
  // outgrew CEE's budget (classified above) or garbage output from a
  // nonsensical brief.
  if (err instanceof UpstreamNonJsonError) {
    // Both facts logged: the derived VERDICT that now selects the copy, and the
    // raw adapter flag under its original key so existing log queries built on
    // `truncated_at_max_tokens` keep resolving instead of silently returning
    // nothing. They are different facts, not two copies of one.
    log.warn({ error: err, requestId: ctx.requestId, demand_not_brief_failure: demandNotBriefFailure, truncated_at_max_tokens: (err as { truncated_at_max_tokens?: unknown }).truncated_at_max_tokens === true }, "Unified pipeline: LLM returned non-JSON response");
    return {
      statusCode: 400,
      body: withLlmTrace(buildCeeErrorResponse(
        "CEE_LLM_VALIDATION_FAILED",
        demandNotBriefFailure
          ? "The draft needed more output tokens than the request budget affords and was truncated"
          : "LLM response could not be parsed — the brief may be too vague or nonsensical",
        {
          requestId: ctx.requestId,
          ...recoveryContract("llm_non_json"),
        },
      )),
    };
  }

  // Upstream HTTP error: LLM provider returned non-2xx
  if (err instanceof UpstreamHTTPError) {
    log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: LLM upstream HTTP error");
    return {
      statusCode: 502,
      body: withLlmTrace(buildCeeErrorResponse("CEE_LLM_UPSTREAM_ERROR", "LLM provider returned an error", {
        requestId: ctx.requestId,
        retryable: true,
      })),
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

  // `demandNotBriefFailure` joins the condition because the adapter PREFIXES
  // the schema-invalid message with the truncation note, which breaks the
  // anchored regex above — pre-flag, a truncated-then-schema-invalid draft
  // fell through to the untyped 500 below with no recovery at all.
  //
  // ⚠ 2026-07-25: broadened from the raw truncation flag to the derived
  // classifier. A draft that CEE runaway-aborted and that then failed to parse
  // or validate matched neither the anchored regex nor the flag, so it landed on
  // the untyped 500 — `retryable: false` with `recovery` absent entirely, which
  // is the worst shape this estate ships. It now lands here with honest copy.
  if (isLlmSchemaOrEmptyError || demandNotBriefFailure) {
    log.warn({ error: err, requestId: ctx.requestId, demand_not_brief_failure: demandNotBriefFailure, truncated_at_max_tokens: (err as { truncated_at_max_tokens?: unknown }).truncated_at_max_tokens === true }, "Unified pipeline: LLM response failed schema validation");
    return {
      statusCode: 400,
      body: withLlmTrace(buildCeeErrorResponse(
        "CEE_LLM_VALIDATION_FAILED",
        demandNotBriefFailure
          ? "The draft needed more output tokens than the request budget affords and was truncated"
          : "LLM produced a response that does not match the expected graph schema",
        {
          requestId: ctx.requestId,
          ...recoveryContract("llm_schema_invalid"),
        },
      )),
    };
  }

  log.error({ error: err, requestId: ctx.requestId }, "Unified pipeline: unexpected error");
  return {
    statusCode: 500,
    body: withLlmTrace(buildCeeErrorResponse("CEE_INTERNAL_ERROR", "Internal pipeline error", { requestId: ctx.requestId })),
  };
}

/**
 * Infer provenance source category from a repair violation code.
 * Used to populate repair_provenance[].source without retrofitting every fix function.
 */
function inferProvenanceSource(code: string): 'structure' | 'brief_extraction' | 'fallback_default' {
  const STRUCTURAL_CODES = new Set([
    "CATEGORY_MISMATCH", "SIGN_MISMATCH", "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
    "INVALID_EDGE_REF", "GOAL_HAS_OUTGOING", "DECISION_HAS_INCOMING",
    "INVALID_EDGE_TYPE", "CYCLE_DETECTED", "FORBIDDEN_EDGE_AUTO_FIXED",
    "FACTOR_GOAL_EDGE_SPLIT", "NODE_LIMIT_EXCEEDED", "EDGE_LIMIT_EXCEEDED",
    "GOAL_THRESHOLD_STRIPPED_NO_RAW", "GOAL_THRESHOLD_POSSIBLY_INFERRED",
    "STATUS_QUO_FACTOR_WIRED", "STATUS_QUO_WIRED", "STATUS_QUO_NO_TARGETS",
    "STATUS_QUO_STILL_INVALID", "DISCONNECTED_OBSERVABLE_PRUNED",
    "UNREACHABLE_FACTOR_RETAINED", "UNREACHABLE_FACTOR_WIRED_TO_GOAL",
    "UNREACHABLE_FACTOR_RECLASSIFIED", "COMPLEXITY_CAP_PRUNE",
    "INVALID_INTERVENTION_REF",
  ]);
  const DEFAULT_CODES = new Set([
    "CONTROLLABLE_MISSING_DATA", "OBSERVABLE_MISSING_DATA", "NAN_VALUE",
    "EXTERNAL_HAS_DATA", "OBSERVABLE_EXTRA_DATA",
  ]);
  if (STRUCTURAL_CODES.has(code)) return 'structure';
  if (DEFAULT_CODES.has(code)) return 'fallback_default';
  return 'structure'; // conservative default for any unrecognized codes
}

/**
 * Attach _pipeline_outcome to any response body (success or error).
 * Safe for non-object bodies (returns body unchanged).
 */
function attachPipelineOutcome(body: unknown, outcome: PipelineOutcome): unknown {
  if (body && typeof body === "object") {
    (body as Record<string, unknown>)._pipeline_outcome = outcome;
  }
  return body;
}

/**
 * Fix 4 (observability): attach `_timings.draft_graph` to a draft_graph
 * response body. Both the telemetry emit and the response-envelope
 * mutation are gated by `config.cee.timingDebugEnabled` — default-OFF
 * production runs do not emit the event or mutate the body. Safe for
 * non-object bodies.
 */
function attachDraftGraphTimings(
  body: unknown,
  timings: DraftGraphTimings,
  requestId: string,
): unknown {
  // Gate: either the original V5_TIMING_DEBUG operator flag OR the new
  // CEE_DIAGNOSTIC_TRACE_ENABLED flag. When the diagnostic trace is on,
  // V5 reads the unified-pipeline substage timings via this body field
  // to populate `_diagnostic_trace.benchmarking.substage_timings`. The
  // wire emission of `_timings` itself still requires the two-gate
  // model in route-v2 (`V5_TIMING_DEBUG` + `X-Olumi-Debug: timings`),
  // so this relaxation only changes IN-MEMORY availability — the wire
  // surface contract is unchanged.
  if (!config.cee.timingDebugEnabled && !config.features.diagnosticTraceEnabled) {
    return body;
  }
  emit(TelemetryEvents.CeeUnifiedPipelineStageTimings, {
    request_id: requestId,
    ...timings,
  });
  if (body && typeof body === "object") {
    const existing = (body as Record<string, unknown>)._timings;
    const next = existing && typeof existing === "object"
      ? { ...(existing as Record<string, unknown>), draft_graph: timings }
      : { draft_graph: timings };
    (body as Record<string, unknown>)._timings = next;
  }
  return body;
}

/**
 * Fire the staged-emission seam (ROADMAP 1.204 M1).
 *
 * THREE PROPERTIES MAKE THE STAGED ROUTE'S OUTPUT BYTE-EQUIVALENT TO THE
 * BUFFERED ROUTE'S BY CONSTRUCTION, and each is enforced here rather than
 * asserted downstream:
 *
 *  1. **No-op when unwired.** Every pre-existing caller omits `onStage`, so the
 *     pipeline they run is the one that ran before this seam existed.
 *  2. **Pure observer.** The emitter returns `void`; nothing it does can reach
 *     `ctx`, the response body, or the stage order.
 *  3. **Cannot fail or stall the draft.** Throws are swallowed (a dead SSE
 *     socket must degrade to a plain buffered completion, never a corrupt half
 *     state), and the call is synchronous and un-awaited so a slow consumer
 *     cannot add latency to the very wall this work exists to shorten.
 */
function emitStageEvent(ctx: StageContext, event: PipelineStageEvent): void {
  const emitter = ctx.opts.onStage;
  if (!emitter) return;
  try {
    emitter(event);
  } catch (err) {
    // Deliberately swallowed — see property 3 above.
    log.debug(
      { err, request_id: ctx.requestId, stage_event: event.kind },
      "staged-emission consumer threw; draft continues unaffected",
    );
  }
}

/**
 * Helper: if earlyReturn is set, attach pipeline outcome and return it.
 * Avoids TS control-flow narrowing issues with repeated earlyReturn checks.
 */
function drainEarlyReturn(ctx: StageContext): UnifiedPipelineResult | undefined {
  const er = ctx.earlyReturn;
  if (!er) return undefined;
  attachPipelineOutcome(er.body, ctx.pipelineOutcome);
  return er;
}

export async function runUnifiedPipeline(
  input: DraftInputWithCeeExtras,
  rawBody: unknown,
  request: FastifyRequest,
  opts: UnifiedPipelineOpts,
): Promise<UnifiedPipelineResult> {
  const ctx = buildInitialContext(input, rawBody, request, opts);

  // Fix 4: per-stage wall clock for draft_graph. Every timer site is
  // gated on `config.cee.timingDebugEnabled` — default-OFF production
  // pays zero `Date.now()` calls, no `timings` allocation, and no body
  // mutation. When enabled, stage deltas roll up into `_timings.draft_graph`
  // on the response body and a `cee.unified_pipeline.stage_timings`
  // telemetry event fires once per draft. The earlier round of review
  // fixes gated the telemetry emit + body mutation; this round eliminates
  // the residual stage-timer overhead too so the OFF story is consistent
  // across V5 turn + run_analysis + draft_graph.
  // Gate: original V5_TIMING_DEBUG operator flag OR CEE_DIAGNOSTIC_TRACE_ENABLED.
  // See `attachDraftGraphTimings` for the wire-surface contract; this
  // controls IN-MEMORY substage capture only, not wire emission of
  // `_timings`. The V5 diagnostic trace reads the captured numbers via
  // `DraftGraphResult.draftGraphTimings` and surfaces them under
  // `_diagnostic_trace.benchmarking.substage_timings` when the diagnostic
  // flag is on.
  const timingsEnabled = config.cee.timingDebugEnabled || config.features.diagnosticTraceEnabled;
  const stageStart: () => number = timingsEnabled
    ? () => Date.now()
    : () => 0;
  const stageElapsed: (t0: number) => number = timingsEnabled
    ? (t0) => Date.now() - t0
    : () => 0;
  const timings: DraftGraphTimings = {};
  const finalise = (body: unknown): unknown => {
    if (!timingsEnabled) return body;
    timings.total_ms = Date.now() - ctx.start;
    // Repair split: parse_llm_ms comes from llmMeta provider latency.
    // repair_llm_ms / repair_deterministic_ms split via the LLM-repair
    // flag on pipelineOutcome (set after Stage 4 finishes). The total
    // repair_ms is captured in the stage timer below; the LLM portion is
    // derived after the fact from the outcome.
    const llmRepair = ctx.pipelineOutcome.llm_repair;
    timings.repair_fired = llmRepair.triggered;
    timings.repair_attempts = llmRepair.attempts;
    timings.repair_reason = llmRepair.fallback_reason;
    if (typeof ctx.llmMeta?.provider_latency_ms === "number") {
      timings.parse_llm_ms = ctx.llmMeta.provider_latency_ms;
    }
    return attachDraftGraphTimings(body, timings, ctx.requestId);
  };

  try {
    // Stage 1: Parse — LLM draft + adapter normalisation
    const t1 = stageStart();
    await runStageParse(ctx);
    timings.parse_ms = stageElapsed(t1);
    { const er = drainEarlyReturn(ctx); if (er) { finalise(er.body); return er; } }
    if (ctx.opts.rawOutput) {
      const rawResult = buildRawOutputResponse(ctx);
      attachPipelineOutcome(rawResult.body, ctx.pipelineOutcome);
      finalise(rawResult.body);
      return rawResult;
    }

    // Graph was drafted successfully
    ctx.pipelineOutcome.graph_drafted = true;
    ctx.stageSnapshots = { stage_1_parse: captureStageSnapshot(ctx) };

    // Stage 2: Normalise — STRP + risk coefficients
    //
    // Typed-fail-by-default wrap. Stage 2 was previously unguarded, so any
    // unwrapped TypeError/ZodError from reconcileStructuralTruth or
    // normaliseRiskCoefficients would surface as opaque CEE_INTERNAL_ERROR
    // (500) and the route boundary would collapse it to
    // draft_graph_pipeline_threw. The wrap routes unknown error classes to
    // mapPipelineError via an anthropic_response_invalid_schema-prefixed
    // throw (matches the isLlmSchemaOrEmptyError regex → 400
    // CEE_LLM_VALIDATION_FAILED). The safe-degrade allowlist is initially
    // empty — Stage 4 backstop coverage must be proven per-class before
    // adding entries (see isKnownSafeNormaliseError below).
    const t2 = stageStart();
    try {
      await runStageNormalise(ctx);
    } catch (normErr: any) {
      const errMessage: string = typeof normErr?.message === 'string' ? normErr.message : 'unknown';
      if (isKnownSafeNormaliseError(normErr)) {
        log.warn({
          event: "pipeline.soft_gate_degraded",
          stage: "normalise",
          error: errMessage,
          request_id: ctx.requestId,
        }, "Stage 2 (Normalise) threw a known-safe error — continuing with raw LLM graph");
        ctx.pipelineOutcome.warnings.push({
          stage: 'normalise',
          error: errMessage,
          degraded: true,
        });
      } else {
        // Unknown class → surface as a typed pipeline error so the route
        // boundary can emit a recoverable category, not opaque 500.
        log.error({
          event: "cee.normalise.crashed",
          request_id: ctx.requestId,
          error: errMessage,
          stack: normErr?.stack,
        }, "Stage 2 (Normalise) crashed — surfacing as typed pipeline error");
        timings.normalise_ms = stageElapsed(t2);
        throw new Error(`anthropic_response_invalid_schema: normalise stage threw on LLM graph — ${errMessage}`);
      }
    }
    timings.normalise_ms = stageElapsed(t2);

    // Stage 3: Enrich — Factor enrichment (ONCE)
    // Defensive: degenerate graphs (empty nodes/edges from nonsensical briefs)
    // can crash enrichment. Catch and return structured error instead of 500.
    const t3 = stageStart();
    try {
      await runStageEnrich(ctx);
      ctx.pipelineOutcome.enrichment_status = 'complete';
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

      ctx.pipelineOutcome.enrichment_status = 'partial';
      const errorBody = buildCeeErrorResponse("CEE_GRAPH_INVALID", "Unable to construct a valid decision model from this brief", {
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
      });
      timings.enrich_ms = stageElapsed(t3);
      attachPipelineOutcome(errorBody, ctx.pipelineOutcome);
      finalise(errorBody);
      return { statusCode: 400, body: errorBody };
    }
    timings.enrich_ms = stageElapsed(t3);
    ctx.stageSnapshots.stage_3_enrich = captureStageSnapshot(ctx);
    ctx.planAnnotation = capturePlanAnnotation(ctx);

    // Stage 4: Repair — Validation + goal merge + connectivity
    const t4 = stageStart();
    await runStageRepair(ctx);
    timings.repair_ms = stageElapsed(t4);

    // Update sweep violations count and diagnostic metrics from repair trace
    const sweepTrace = ctx.repairTrace?.deterministic_sweep as Record<string, unknown> | undefined;
    const bucketSummary = sweepTrace?.bucket_summary as Record<string, number> | undefined;
    if (bucketSummary) {
      ctx.pipelineOutcome.deterministic_sweep_violations =
        (bucketSummary.A ?? 0) + (bucketSummary.B ?? 0) + (bucketSummary.C ?? 0);
    }

    // Rescue score (computed inside deterministic sweep)
    if (typeof sweepTrace?.rescue_score === "number") {
      ctx.pipelineOutcome.rescue_score = sweepTrace.rescue_score;
    }

    // LLM repair outcome
    ctx.pipelineOutcome.llm_repair = {
      triggered: ctx.llmRepairNeeded ?? false,
      outcome: ctx.llmRepairNeeded
        ? (ctx.repairFallbackReason ? 'rejected' : 'accepted')
        : 'skipped',
      fallback_reason: ctx.repairFallbackReason ?? null,
      attempts: ctx.llmRepairNeeded ? 1 : 0,
    };

    // Factor value coverage + edge strength unique count (computed from graph)
    if (ctx.graph) {
      const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; kind: string; data?: any }>;
      const graphEdges = (ctx.graph as any).edges as Array<{ from: string; to: string; strength_mean?: number }>;

      // Factor value coverage (three-tier):
      //   explicit: extractionType is "explicit" or "observed" (real data from brief or environment)
      //   inferred_with_evidence: extractionType is "inferred" but value differs from 0.5 default
      //   fallback_default: no extractionType, or inferred with default 0.5
      const factors = graphNodes.filter((n) => n.kind === "factor");
      let explicit = 0, inferredWithEvidence = 0, fallbackDefault = 0;
      for (const f of factors) {
        const et = f.data?.extractionType;
        if (et === "explicit" || et === "observed") explicit++;
        else if (et === "inferred" && f.data?.value !== 0.5) inferredWithEvidence++;
        else fallbackDefault++;
      }
      ctx.pipelineOutcome.factor_value_coverage = {
        total: factors.length,
        explicit,
        inferred_with_evidence: inferredWithEvidence,
        fallback_default: fallbackDefault,
      };

      // Edge strength unique count (exclude structural edges)
      const nodeKindMap = new Map<string, string>();
      for (const n of graphNodes) nodeKindMap.set(n.id, n.kind);
      const strengths = new Set<number>();
      for (const e of graphEdges) {
        const fk = nodeKindMap.get(e.from);
        const tk = nodeKindMap.get(e.to);
        if ((fk === "decision" && tk === "option") || (fk === "option" && tk === "factor")) continue;
        if (e.strength_mean !== undefined) strengths.add(Math.round(e.strength_mean * 1000) / 1000);
      }
      ctx.pipelineOutcome.edge_strength_unique_count = strengths.size;
    }

    // Repair provenance — map from deterministicRepairs
    ctx.pipelineOutcome.repair_provenance = (ctx.deterministicRepairs ?? []).map((r) => ({
      rule: r.code,
      code: r.code,
      node_or_edge_id: r.path,
      field: "graph",
      before: null,
      after: null,
      source: inferProvenanceSource(r.code),
    }));

    { const er = drainEarlyReturn(ctx); if (er) { finalise(er.body); return er; } }

    // Graph survived repair — structurally valid
    ctx.pipelineOutcome.graph_structurally_valid = true;
    ctx.stageSnapshots.stage_4_repair = captureStageSnapshot(ctx);

    // Validation pipeline (Pass 2) — fired immediately after Repair, runs
    // concurrently with Stage 4b. Uses catch() so Stage 4b is never blocked
    // by validation errors. Awaited before Stage 5 so metadata is ready.
    const tValidation = stageStart();
    let validationPromise: Promise<void>;
    if (config.cee.validationPipelineEnabled) {
      validationPromise = runValidationPipeline(ctx).then(() => {
        ctx.pipelineOutcome.validation_status = 'passed';
      }).catch((err: unknown) => {
        const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'));
        const isParse = err instanceof Error && err.message.includes('parse_error');
        log.warn(
          {
            event: "cee.validation_pipeline.failed",
            request_id: ctx.requestId,
            error: err instanceof Error ? err.message : String(err),
            error_type: isTimeout ? 'timeout' : isParse ? 'parse_error' : 'api_error',
          },
          "cee.validation_pipeline.failed",
        );
        ctx.pipelineOutcome.validation_status = 'failed_degraded';
        ctx.pipelineOutcome.warnings.push({
          stage: 'validation_pipeline',
          error: err instanceof Error ? err.message : String(err),
          degraded: true,
        });
      });
    } else {
      log.debug(
        { event: "cee.validation_pipeline.skipped", request_id: ctx.requestId },
        "cee.validation_pipeline.skipped",
      );
      validationPromise = Promise.resolve();
    }

    // Stage 4b: Threshold Sweep — deterministic goal threshold hygiene
    // Non-critical: failing to strip thresholds must not crash the pipeline.
    const t4b = stageStart();
    try {
      await runStageThresholdSweep(ctx);
    } catch (sweepErr: any) {
      log.warn({
        event: "cee.threshold_sweep.failed",
        request_id: ctx.requestId,
        error: sweepErr?.message,
        stack: sweepErr?.stack,
      }, "Stage 4b (threshold sweep) failed — continuing without threshold stripping");
      ctx.pipelineOutcome.warnings.push({
        stage: 'threshold_sweep',
        error: sweepErr?.message ?? 'unknown',
        degraded: true,
      });
    }
    timings.threshold_sweep_ms = stageElapsed(t4b);
    ctx.stageSnapshots.stage_4b_threshold_sweep = captureStageSnapshot(ctx);

    // Await Pass 2 before Stage 5 (Package) so validation metadata is present
    // on edges when the response is assembled.
    await validationPromise;
    timings.validation_pipeline_ms = stageElapsed(tValidation);

    // ── GRAPH_READY (ROADMAP 1.204 M1) ────────────────────────────────────
    // The graph is repaired and validated HERE, and the ~20 s coaching pass has
    // not started — this is the point the 28 Jul live probe measured at ~33 s of
    // a ~53 s draft. Emitting here is what turns one silent blob into staged
    // delivery, and it needs NO reordering: the split the design asked for
    // already exists in the current stage order.
    //
    // ⚠ The design's Q3 CEE-1 also said "reorder coaching after package+
    // boundary". That is REFUTED and deliberately NOT done: Stage 5 (Package)
    // is a CONSUMER of the coaching pass's output (package.ts reads
    // ctx.coaching / ctx.causalClaims — enforceCoachingContract,
    // validateCausalClaims, narrowCoachingForResponse), as coaching-pass.ts's
    // own header states. Reordering would make Package emit canonical-empty
    // coaching, changing the BUFFERED route's response bytes — breaking both
    // "the buffered route stays byte-identical" and the equivalence pin.
    //
    // Claim-safety: `ctx.coaching` and `ctx.causalClaims` are still undefined at
    // this line, so this frame cannot carry a leader designation, a
    // recommendation, or any analysis claim. Structure only, by construction.
    //
    // ⚠ The graph is projected into the NEGOTIATED SCHEMA VOCABULARY before it
    // goes on the wire. Emitting the raw V1 `ctx.graph` here would be a silent
    // lane-killer: `parseSchemaVersion` defaults to "v3", and the V3 transform
    // REWRITES node ids and labels — so the client would key the ~33 s graph by
    // one set of ids and the ~53 s terminal frame by another, and reconciliation
    // would fail. See staged-graph-projection.ts for the full argument.
    if (ctx.opts.onStage) {
      emitStageEvent(ctx, {
        kind: "GRAPH_READY",
        graph: projectGraphForStagedFrame(ctx.graph, ctx.opts.schemaVersion, ctx.requestId),
        schema_version: ctx.opts.schemaVersion,
        elapsed_ms: Date.now() - ctx.start,
      });
    }

    // Stage 4.5: Post-draft coaching pass (v12, lean-draft contract 1.197).
    // The lean draft call emits STRUCTURE ONLY; coaching + causal_claims are
    // re-produced here from the FINAL (repaired) structure in a bounded,
    // STRICTLY NON-FATAL LLM call and attached to ctx for Stage 5 to package.
    // A failure leaves ctx.coaching undefined → Stage 5 emits canonical-empty,
    // exactly as a draft that produced no coaching. Never fails the draft.
    const tCoaching = stageStart();
    await runStageCoachingPass(ctx);
    timings.coaching_pass_ms = stageElapsed(tCoaching);

    // ── COACHING_READY (ROADMAP 1.204 M1) ─────────────────────────────────
    // The ~19.8 s coaching tax has settled — the ~53 s point. Carries the
    // STATUS only; the coaching prose itself rides the terminal COMPLETE frame
    // (the byte-identical buffered body), so coaching reaches the client
    // through exactly one path and one shape. `coaching_status` is not final
    // until Stage 5/6 stamp it, so this reports the pass's own outcome —
    // 'complete' here means the PASS settled, and the terminal frame remains
    // the authority on the finished draft.
    if (ctx.opts.onStage) {
      emitStageEvent(ctx, {
        kind: "COACHING_READY",
        coaching_status: ctx.pipelineOutcome.coaching_status,
        elapsed_ms: Date.now() - ctx.start,
      });
    }

    // Stage 5: Package — Quality + warnings + caps + trace
    // Soft gate: both the verification pipeline inside Package and the
    // Package stage itself must not discard a structurally valid graph.
    const t5 = stageStart();
    try {
      await runStagePackage(ctx);
    } catch (packageErr: any) {
      log.warn({
        event: "pipeline.soft_gate_degraded",
        stage: "package",
        error: packageErr?.message,
        request_id: ctx.requestId,
      }, "Stage 5 (Package) threw — degrading to graph-only response (soft gate)");
      ctx.pipelineOutcome.warnings.push({
        stage: 'package',
        error: packageErr?.message ?? 'unknown',
        degraded: true,
      });
      // F7 (2026-07-24): a Stage 5 PACKAGE failure is NOT a coaching failure.
      // Coaching may have succeeded and an unrelated packaging op (bias payload,
      // schema transform) threw. coaching_status stays owned by the coaching
      // path — stamp its real terminal status here (complete when it succeeded,
      // or its preserved skipped_budget / failed_degraded marker); the package
      // degradation is already signalled by the stage:'package' warning above.
      markCoachingCompleteUnlessTerminal(ctx.pipelineOutcome);
      timings.package_ms = stageElapsed(t5);
      // Return the structurally valid graph without packaging
      const fallback = { graph: ctx.graph, rationales: ctx.rationales, confidence: ctx.confidence };
      attachPipelineOutcome(fallback, ctx.pipelineOutcome);
      finalise(fallback);
      return { statusCode: 200, body: fallback };
    }
    timings.package_ms = stageElapsed(t5);
    { const er = drainEarlyReturn(ctx); if (er) { finalise(er.body); return er; } }
    ctx.stageSnapshots.stage_5_package = captureStageSnapshot(ctx);

    // Stage 6: Boundary — V3/V2/V1 transform
    // Soft gate: boundary transform failure must not discard a packaged response.
    const t6 = stageStart();
    try {
      await runStageBoundary(ctx);
    } catch (boundaryErr: any) {
      log.warn({
        event: "pipeline.soft_gate_degraded",
        stage: "boundary",
        error: boundaryErr?.message,
        request_id: ctx.requestId,
      }, "Stage 6 (Boundary) threw — returning packaged V1 response (soft gate)");
      ctx.pipelineOutcome.warnings.push({
        stage: 'boundary',
        error: boundaryErr?.message ?? 'unknown',
        degraded: true,
      });
      timings.boundary_ms = stageElapsed(t6);
      // Return the packaged V1 response without boundary transform
      const fallback = ctx.ceeResponse ?? { graph: ctx.graph, rationales: ctx.rationales, confidence: ctx.confidence };
      // Preserve a coaching-pass terminal marker (skipped_budget / failed_degraded)
      // on this fallback path; else stamp 'complete'.
      markCoachingCompleteUnlessTerminal(ctx.pipelineOutcome);
      attachPipelineOutcome(fallback, ctx.pipelineOutcome);
      finalise(fallback);
      return { statusCode: 200, body: fallback };
    }
    timings.boundary_ms = stageElapsed(t6);
    { const er = drainEarlyReturn(ctx); if (er) { finalise(er.body); return er; } }

    // Defensive guard — all stages wired, so this should never fire
    if (ctx.finalResponse === undefined) {
      log.error({ requestId: ctx.requestId }, "Unified pipeline: no finalResponse after all stages completed");
      const errorBody = buildCeeErrorResponse("CEE_SERVICE_UNAVAILABLE", "Unified pipeline stages not yet wired", {
        requestId: ctx.requestId,
        reason: "incomplete_wiring",
      });
      attachPipelineOutcome(errorBody, ctx.pipelineOutcome);
      finalise(errorBody);
      return { statusCode: 501, body: errorBody };
    }

    // Coaching status: if we got here with a response, coaching passed — UNLESS
    // the post-draft coaching pass owns a terminal marker (skipped_budget /
    // failed_degraded), which must survive to the response body so probes and
    // A2's async-ingest lane can distinguish it from a genuinely-complete pass.
    markCoachingCompleteUnlessTerminal(ctx.pipelineOutcome);

    attachPipelineOutcome(ctx.finalResponse, ctx.pipelineOutcome);
    finalise(ctx.finalResponse);
    return {
      statusCode: 200,
      body: ctx.finalResponse,
    };
  } catch (error) {
    // Pre-sweep failures (Stage 1-3) or unexpected errors still map to error responses.
    // Post-sweep failures are caught by the stage-level try/catch above.
    const result = mapPipelineError(error, ctx);
    attachPipelineOutcome(result.body, ctx.pipelineOutcome);
    finalise(result.body);
    return result;
  }
}
