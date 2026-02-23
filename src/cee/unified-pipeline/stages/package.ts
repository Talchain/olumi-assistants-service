/**
 * Stage 5: Package — Caps + warnings + quality + trace assembly
 *
 * Source: Pipeline A lines 2553-3222
 *
 * GRAPH FROZEN INVARIANT: Stage 5 must not mutate ctx.graph.
 * A runtime check enforces this in non-production environments.
 * If any function called here modifies the graph, that's a bug
 * in the extraction — do not accommodate it, flag it.
 */

import type { StageContext } from "../types.js";
import { config, isProduction } from "../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../utils/telemetry.js";
import { inferArchetype } from "../../archetypes/index.js";
import { computeQuality } from "../../quality/index.js";
import { sortBiasFindings } from "../../bias/index.js";
import { applyResponseCaps } from "../../transforms/response-caps.js";
import { ceeAnyTruncated, buildCeeGuidance } from "../../guidance/index.js";
import {
  detectStructuralWarnings,
  detectUniformStrengths,
  detectStrengthClustering,
  detectSameLeverOptions,
  detectMissingBaseline,
  detectGoalNoBaselineValue,
  detectZeroExternalFactors,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from "../../structure/index.js";
import { verificationPipeline } from "../../verification/index.js";
import { CEEDraftGraphResponseV1Schema } from "../../../schemas/ceeResponses.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";
import {
  captureCheckpoint,
  applyCheckpointSizeGuard,
  assembleCeeProvenance,
} from "../../pipeline-checkpoints.js";
import { buildLLMRawTrace } from "../../llm-output-store.js";
import { SERVICE_VERSION } from "../../../version.js";

/**
 * Derive a single status_quo_action enum from the sweep trace.
 * "wired" = edges were added, "droppable" = unfixable, "none" = no status quo issue detected.
 */
function deriveStatusQuoAction(
  sweepTrace: Record<string, unknown> | undefined,
): "wired" | "droppable" | "none" {
  const sq = (sweepTrace as any)?.status_quo;
  if (!sq) return "none";
  if (sq.fixed) return "wired";
  if (sq.marked_droppable) return "droppable";
  return "none";
}

export async function runStagePackage(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "package" }, "Unified pipeline: Stage 5 (Package) started");

  // ── Graph frozen invariant (runtime enforcement) ─────────────────────────
  const graphSnapshot = !isProduction() ? JSON.stringify(ctx.graph) : undefined;

  // ── Compute allStrpMutations once — used in Steps 5 and 14 ──────────────
  const allStrpMutations = [
    ...(ctx.strpResult?.mutations ?? []),
    ...(ctx.constraintStrpResult?.mutations ?? []),
  ];

  const validationIssues: any[] = [];

  // ── Step 1: Archetype inference (gated) ──────────────────────────────────
  if (config.cee.draftArchetypesEnabled && ctx.graph) {
    const { archetype, issues: archetypeIssues } = inferArchetype({
      hint: (ctx.input as any).archetype_hint,
      brief: ctx.input.brief,
      graph: ctx.graph as any,
      engineConfidence: ctx.confidence,
    });
    ctx.archetype = archetype;
    if (Array.isArray(archetypeIssues) && archetypeIssues.length > 0) {
      validationIssues.push(...archetypeIssues);
    }
  } else {
    // Fallback: generic archetype from hint (match pipeline.ts:2237-2248)
    ctx.archetype = (ctx.input as any).archetype_hint
      ? { decision_type: (ctx.input as any).archetype_hint, match: "fuzzy" as const, confidence: ctx.confidence }
      : { decision_type: "generic", match: "generic" as const, confidence: ctx.confidence };
  }

  // ── Step 2: Quality computation (canonical) ──────────────────────────────
  // Canonical quality — substep 9's was a clarifier precondition only
  ctx.quality = computeQuality({
    graph: ctx.graph!,
    confidence: ctx.confidence ?? 0.7,
    engineIssueCount: 0,
    ceeIssues: validationIssues,
  });

  // ── Step 2b: STATUS_QUO_ABSENT coaching injection ─────────────────────────
  // If no option has a status-quo-like label, inject a coaching strengthen_item
  // so the user is prompted to add a baseline comparator.
  // Patterns aligned with detectMissingBaseline() in structure/index.ts.
  {
    const STATUS_QUO_PATTERNS: RegExp[] = [
      /status\s*quo/i,
      /do\s*nothing/i,
      /no\s*action/i,
      /no\s*change/i,
      /baseline/i,
      /current/i,
      /as\s*is/i,
    ];
    const nodes = ((ctx.graph as any).nodes ?? []) as Array<{ id: string; kind: string; label?: string; data?: any }>;
    const options = nodes.filter((n) => n.kind === "option");
    const hasStatusQuo = options.some((opt) => {
      if (opt.data?.is_status_quo === true) return true;
      const text = `${opt.id} ${opt.label ?? ""}`;
      return STATUS_QUO_PATTERNS.some((p) => p.test(text));
    });

    if (!hasStatusQuo && options.length > 0) {
      const coaching = (ctx.coaching ?? { summary: "", strengthen_items: [] }) as {
        summary: string;
        strengthen_items: Array<Record<string, unknown>>;
      };
      if (!Array.isArray(coaching.strengthen_items)) {
        coaching.strengthen_items = [];
      }
      const alreadyPresent = coaching.strengthen_items.some(
        (item) => item.id === "str_status_quo",
      );
      if (!alreadyPresent) {
        coaching.strengthen_items.push({
          id: "str_status_quo",
          label: "Add baseline option",
          detail: "No status quo option detected — add one to measure improvement. If one of your existing options is the baseline (e.g. 'Continue as-is', 'Maintain current approach'), rename it to make the baseline intent explicit.",
          action_type: "add_option",
          bias_category: "framing",
        });
        ctx.coaching = coaching;
      }
    }
  }

  // ── Step 3: Validate causal claims against post-STRP graph (Phase 2B) ────
  // Claims are validated here (not earlier) because node ID validation must
  // run against the post-repair graph — STRP may remove nodes.
  // Track whether the LLM emitted causal_claims at all (for provenance).
  // undefined = LLM didn't emit → omit from response.
  // CausalClaim[] (possibly empty) = LLM emitted → include in response.
  const llmEmittedCausalClaims = ctx.causalClaims !== undefined;
  let validatedCausalClaims: import("../../../schemas/causal-claims.js").CausalClaim[] = [];
  const causalClaimsWarnings: any[] = [];

  if (llmEmittedCausalClaims) {
    const graphNodeIds = new Set<string>(
      Array.isArray((ctx.graph as any)?.nodes)
        ? (ctx.graph as any).nodes.map((n: any) => n.id as string)
        : [],
    );
    const { validateCausalClaims } = await import("../../transforms/causal-claims-validation.js");
    const result = validateCausalClaims(ctx.causalClaims, graphNodeIds);
    validatedCausalClaims = result.claims;
    causalClaimsWarnings.push(...result.warnings);
  }
  if (causalClaimsWarnings.length > 0) {
    validationIssues.push(...causalClaimsWarnings);
  }

  // ── Step 3b: Build payload + sort bias findings ─────────────────────────
  const payload: Record<string, unknown> = {
    graph: ctx.graph,
    rationales: ctx.rationales,
    confidence: ctx.confidence,
    goal_constraints: ctx.goalConstraints,
    // Coaching passthrough from LLM output (undefined if not present)
    ...(ctx.coaching ? { coaching: ctx.coaching } : {}),
    // Causal claims passthrough (Phase 2B):
    //   LLM didn't emit → omit field (absent provenance)
    //   LLM emitted but all dropped → causal_claims: [] (emptied provenance)
    //   LLM emitted valid claims → causal_claims: [...] (normal)
    ...(llmEmittedCausalClaims ? { causal_claims: validatedCausalClaims } : {}),
  };

  if (Array.isArray((payload as any).bias_findings)) {
    (payload as any).bias_findings = sortBiasFindings((payload as any).bias_findings, ctx.input.seed);
  }

  // ── Step 4: Apply response caps ──────────────────────────────────────────
  const { cappedPayload, limits } = applyResponseCaps(payload);

  // ── Step 5: (STRP trace merged onto trace variable in Step 9b below) ─────

  // ── Step 6: Structural warnings ──────────────────────────────────────────
  let draftWarnings: any[] | undefined;
  let confidenceFlags: Record<string, unknown> | undefined;

  if (config.cee.draftStructuralWarningsEnabled) {
    const structural = detectStructuralWarnings(ctx.graph as any, ctx.structuralMeta);
    if (structural.warnings.length > 0) {
      draftWarnings = structural.warnings;
    }

    const anyTruncated = ceeAnyTruncated(limits);
    const uncertainNodes =
      structural.uncertainNodeIds.length > 0 ? structural.uncertainNodeIds : undefined;
    const simplificationApplied = Boolean(
      anyTruncated ||
        (ctx.structuralMeta && ((ctx.structuralMeta as any).had_cycles || (ctx.structuralMeta as any).had_pruned_nodes)),
    );

    if (uncertainNodes || simplificationApplied) {
      confidenceFlags = {
        ...(uncertainNodes ? { uncertain_nodes: uncertainNodes } : {}),
        ...(simplificationApplied ? { simplification_applied: true } : {}),
      };
    }
  }

  // Uniform strengths (always run, not gated)
  const uniformResult = detectUniformStrengths(ctx.graph as any);
  if (uniformResult.detected && uniformResult.warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push(uniformResult.warning);
  }

  // Pre-analysis quality detectors
  const strengthClust = detectStrengthClustering(ctx.graph as any);
  if (strengthClust.detected && (strengthClust as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((strengthClust as any).warning);
  }

  const sameLever = detectSameLeverOptions(ctx.graph as any);
  if (sameLever.detected && (sameLever as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((sameLever as any).warning);
  }

  const missingBaselineResult = detectMissingBaseline(ctx.graph as any);
  if (missingBaselineResult.detected && (missingBaselineResult as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((missingBaselineResult as any).warning);
  }

  const goalNoValue = detectGoalNoBaselineValue(ctx.graph as any);
  if (goalNoValue.detected && (goalNoValue as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((goalNoValue as any).warning);
  }

  const zeroExternal = detectZeroExternalFactors(ctx.graph as any);
  if (zeroExternal.detected && zeroExternal.warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push(zeroExternal.warning);
  }

  const goalConn = checkGoalConnectivity(ctx.graph as any);
  if (goalConn.status === "none" && (goalConn as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((goalConn as any).warning);
  }

  const modelQualityFactors = computeModelQualityFactors(ctx.graph as any);
  const goalConnectivity = {
    status: goalConn.status,
    disconnected_options: (goalConn as any).disconnectedOptions,
    weak_paths: (goalConn as any).weakPaths,
  };

  ctx.draftWarnings = draftWarnings ?? [];

  // ── Step 7: Intervention hints extraction (inline) ───────────────────────
  const interventionHints: any[] = [];
  if (ctx.graph && Array.isArray((ctx.graph as any).nodes)) {
    for (const node of (ctx.graph as any).nodes) {
      if (node?.kind !== "option") continue;
      const rawInterventions = (node?.data as any)?.interventions;
      const interventionValues = Array.isArray(rawInterventions)
        ? rawInterventions
        : rawInterventions && typeof rawInterventions === "object"
          ? Object.values(rawInterventions)
          : [];
      for (const interv of interventionValues as any[]) {
        const targetId = interv?.target_match?.node_id ?? interv?.target;
        if (!targetId) continue;
        interventionHints.push({
          option_id: node.id,
          target_node_id: targetId,
          unit: interv?.unit,
          factor_type: interv?.factor_type ?? "unknown",
          extracted_range: interv?.range
            ? { min: interv.range.min, max: interv.range.max, source: interv?.range_source ?? "default" }
            : undefined,
          source: interv?.source ?? "ai",
        });
      }
    }
  }

  // ── Step 8: Build CEE guidance ───────────────────────────────────────────
  const guidance = buildCeeGuidance({
    quality: ctx.quality!,
    validationIssues,
    limits,
  });

  // ── Step 9: Build initial trace (CEETraceMeta) ───────────────────────────
  const trace: any = {
    request_id: ctx.requestId,
    correlation_id: ctx.requestId,
    engine: {
      provider: ctx.draftAdapter?.name,
      model: ctx.draftAdapter?.model,
      version: SERVICE_VERSION,
    },
    ...(ctx.llmMeta
      ? {
          prompt_version: ctx.llmMeta.prompt_version,
          prompt_hash: ctx.llmMeta.prompt_hash,
          model: ctx.llmMeta.model ?? ctx.draftAdapter?.model,
          temperature: ctx.llmMeta.temperature,
          token_usage: ctx.llmMeta.token_usage,
          finish_reason: ctx.llmMeta.finish_reason,
        }
      : {}),
  };

  // ── Step 9b: Merge STRP trace onto trace variable ─────────────────────────
  // Must be on the trace object itself (not cappedPayload.trace) because
  // Step 11 overrides cappedPayload.trace with the explicit trace property.
  // Stage 6 reads trace.strp.mutations for model_adjustments.
  if (allStrpMutations.length > 0) {
    trace.strp = {
      mutation_count: allStrpMutations.length,
      rules_triggered: [...new Set(allStrpMutations.map((m: any) => m.rule))],
      mutations: allStrpMutations,
    };
  }

  // ── Step 9c: Merge deterministic repair summary onto trace ──────────────
  {
    const sweepTrace = (ctx.repairTrace as any)?.deterministic_sweep;
    const repairs = ctx.deterministicRepairs ?? [];
    trace.repair_summary = {
      // Sweep execution proof — consumers should gate on deterministic_sweep_ran
      // before reading bucket_summary (null = sweep didn't run, {0,0,0} = ran with zero violations).
      deterministic_sweep_ran: sweepTrace?.sweep_ran ?? false,
      deterministic_sweep_version: sweepTrace?.sweep_version ?? "unknown",
      bucket_summary: sweepTrace ? (sweepTrace.bucket_summary ?? null) : null,
      status_quo_action: deriveStatusQuoAction(sweepTrace),
      llm_repair_needed: ctx.llmRepairNeeded ?? false,
      // Existing fields
      deterministic_repairs_count: repairs.length,
      deterministic_repairs: repairs,
      unreachable_factors: sweepTrace?.unreachable_factors ?? { reclassified: [], marked_droppable: [] },
      status_quo: sweepTrace?.status_quo ?? { fixed: false, marked_droppable: false },
      llm_repair_called: ctx.llmRepairNeeded ?? false,
      llm_repair_brief_included: ctx.llmRepairBriefIncluded ?? false,
      llm_repair_skipped_reason: ctx.llmRepairNeeded === false ? "deterministic_sweep_sufficient" : undefined,
      remaining_violations_count: ctx.remainingViolations?.length ?? 0,
      remaining_violation_codes: [...new Set((ctx.remainingViolations ?? []).map((v) => v.code))],
      edge_format_detected: ctx.detectedEdgeFormat ?? "NONE",
      graph_delta: sweepTrace?.graph_delta ?? {
        nodes_before: 0,
        nodes_after: Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes.length : 0,
        edges_before: 0,
        edges_after: Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges.length : 0,
      },
    };
  }

  // ── Step 10: Clarifier status ────────────────────────────────────────────
  let clarifierStatus: string | undefined;
  if (!ctx.clarifierResult?.clarifier) {
    clarifierStatus = ctx.clarifierResult?.convergenceStatus ?? "complete";
  }

  // ── Step 11: Assemble V1 response ────────────────────────────────────────
  const ceeResponse: any = {
    ...cappedPayload,
    trace,
    quality: ctx.quality,
    validation_issues: validationIssues.length ? validationIssues : undefined,
    archetype: ctx.archetype,
    seed: ctx.input.seed,
    response_hash: (cappedPayload as any).response_hash,
    response_limits: limits,
    draft_warnings: draftWarnings,
    confidence_flags: confidenceFlags,
    guidance,
    clarifier: ctx.clarifierResult?.clarifier,
    clarifier_status: clarifierStatus,
    goal_connectivity: goalConnectivity,
    model_quality_factors: modelQualityFactors,
    intervention_hints: interventionHints.length > 0 ? interventionHints : undefined,
  };

  // ── Step 12: Pipeline checkpoint (post_stabilisation) ────────────────────
  if (ctx.checkpointsEnabled) {
    ctx.pipelineCheckpoints.push(captureCheckpoint("post_stabilisation", (cappedPayload as any).graph));
  }

  // ── Step 13: Verification pipeline ───────────────────────────────────────
  let verifiedResponse: any;
  try {
    const { response } = await verificationPipeline.verify(
      ceeResponse,
      CEEDraftGraphResponseV1Schema,
      { endpoint: "draft-graph", requiresEngineValidation: false, requestId: ctx.requestId },
    );
    verifiedResponse = response;

    if (ctx.checkpointsEnabled) {
      ctx.pipelineCheckpoints.push(captureCheckpoint("pre_boundary", (verifiedResponse as any).graph));
    }
  } catch (error) {
    log.warn({ error, request_id: ctx.requestId }, "Verification pipeline failed");
    ctx.earlyReturn = {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_GRAPH_INVALID", error instanceof Error ? error.message : "verification failed", {
        requestId: ctx.requestId,
      }),
    };
    return;
  }

  // ── Step 14: Pipeline trace assembly ─────────────────────────────────────
  const totalDurationMs = Date.now() - ctx.start;
  const pipelineTrace: Record<string, unknown> = {
    status: "success",
    total_duration_ms: totalDurationMs,
    llm_call_count: 1,
    llm_quality: {
      risk_coefficient_corrections: ctx.riskCoefficientCorrections.length,
      corrections: ctx.riskCoefficientCorrections.length > 0 ? ctx.riskCoefficientCorrections : undefined,
    },
    llm_metadata: ctx.llmMeta
      ? {
          model: ctx.llmMeta.model ?? ctx.draftAdapter?.model,
          prompt_version: ctx.llmMeta.prompt_version,
          prompt_hash: ctx.llmMeta.prompt_hash,
          duration_ms: ctx.llmMeta.provider_latency_ms,
          finish_reason: ctx.llmMeta.finish_reason,
          response_chars: ctx.llmMeta.raw_llm_text?.length,
          token_usage: ctx.llmMeta.token_usage,
          temperature: ctx.llmMeta.temperature,
          max_tokens: ctx.llmMeta.max_tokens,
          seed: ctx.llmMeta.seed,
          reasoning_effort: ctx.llmMeta.reasoning_effort,
          instance_id: ctx.llmMeta.instance_id,
          cache_age_ms: ctx.llmMeta.cache_age_ms,
          cache_status: ctx.llmMeta.cache_status,
          use_staging_mode: ctx.llmMeta.use_staging_mode,
        }
      : { model: ctx.draftAdapter?.model },
    validation_summary: ctx.validationSummary,
    transforms: ctx.transforms.length > 0 ? ctx.transforms : undefined,
    corrections: ctx.collector.hasCorrections() ? ctx.collector.getCorrections() : undefined,
    corrections_summary: ctx.collector.hasCorrections() ? ctx.collector.getSummary() : undefined,
  };

  // Enrichment trace (from Stage 3)
  if (ctx.enrichmentTrace) {
    pipelineTrace.enrich = { ...ctx.enrichmentTrace, source: "unified_pipeline" };
  }

  // STRP trace (merged early + late — reusing allStrpMutations from Step 5)
  if (allStrpMutations.length > 0) {
    pipelineTrace.strp = {
      mutation_count: allStrpMutations.length,
      rules_triggered: [...new Set(allStrpMutations.map((m: any) => m.rule))],
      mutations: allStrpMutations,
    };
  }

  // Repair trace (from Stage 4)
  if (ctx.repairTrace) {
    pipelineTrace.repair = ctx.repairTrace;
  }

  // Deterministic repair summary for observability.
  // Must live on pipelineTrace (not the pre-verification trace object) because
  // Zod's intersection parse in Step 13 may strip unknown keys from the trace.
  // The V3 transform reads from trace.pipeline.repair_summary.
  pipelineTrace.repair_summary = trace.repair_summary;

  // Threshold sweep trace (from Stage 4b)
  if (ctx.thresholdSweepTrace) {
    pipelineTrace.threshold_sweep = ctx.thresholdSweepTrace;
  }

  // Stage snapshots (goal_threshold field tracking across pipeline stages)
  if (ctx.stageSnapshots) {
    pipelineTrace.stage_snapshots = ctx.stageSnapshots;
  }

  // Plan annotation checkpoint (captured after Stage 3 — Enrich)
  if (ctx.planAnnotation) {
    pipelineTrace.plan_annotation = ctx.planAnnotation;
  }

  // Final graph summary
  const nodeCount = Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes.length : 0;
  const edgeCount = Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges.length : 0;
  pipelineTrace.final_graph = {
    node_count: nodeCount,
    edge_count: edgeCount,
    node_kinds: Array.isArray((ctx.graph as any)?.nodes)
      ? [...new Set((ctx.graph as any).nodes.map((n: any) => n?.kind).filter(Boolean))]
      : [],
  };

  // Pipeline checkpoints
  if (ctx.checkpointsEnabled) {
    const adapterCheckpoints = Array.isArray(ctx.llmMeta?.pipeline_checkpoints)
      ? (ctx.llmMeta.pipeline_checkpoints as any[])
      : [];
    const allCheckpoints = [...adapterCheckpoints, ...ctx.pipelineCheckpoints];
    pipelineTrace.pipeline_checkpoints = applyCheckpointSizeGuard(allCheckpoints);
    pipelineTrace.pipeline_checkpoints_meta = {
      enabled: true,
      adapter_count: adapterCheckpoints.length,
      pipeline_count: ctx.pipelineCheckpoints.length,
      total_count: allCheckpoints.length,
    };
  }

  // Provenance
  pipelineTrace.cee_provenance = assembleCeeProvenance({
    pipelinePath: "unified",
    model: ctx.llmMeta?.model ?? ctx.draftAdapter?.model ?? "unknown",
    promptVersion: ctx.llmMeta?.prompt_version,
    promptSource: ctx.llmMeta?.prompt_source,
    promptStoreVersion: ctx.llmMeta?.prompt_store_version,
    modelOverrideActive: Boolean(process.env.CEE_DRAFT_MODEL),
    planId: ctx.planAnnotation?.plan_id,
    planHash: ctx.planAnnotation?.plan_hash,
  });

  // LLM raw trace
  if (ctx.llmMeta?.raw_llm_text) {
    pipelineTrace.llm_raw = buildLLMRawTrace(ctx.requestId, ctx.llmMeta.raw_llm_text, ctx.graph as any, {
      model: ctx.llmMeta.model ?? ctx.draftAdapter?.model,
      promptVersion: ctx.llmMeta.prompt_version,
      storeOutput: true,
    });
  }

  // Unsafe additions
  if (ctx.opts.unsafeCaptureEnabled && ctx.llmMeta) {
    pipelineTrace.unsafe = { raw_output_preview: ctx.llmMeta.raw_output_preview };
  }

  // Attach pipeline trace to verified response
  verifiedResponse.trace = { ...verifiedResponse.trace, pipeline: pipelineTrace } as any;

  // ── Step 15: Graph frozen invariant check ────────────────────────────────
  if (graphSnapshot !== undefined && JSON.stringify(ctx.graph) !== graphSnapshot) {
    throw new Error("Stage 5 invariant violation: graph mutated during Package stage");
  }

  // ── Step 16: Populate ctx outputs ────────────────────────────────────────
  ctx.ceeResponse = verifiedResponse;
  ctx.pipelineTrace = pipelineTrace;
}
