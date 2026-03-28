/**
 * Stage 6: Boundary — V3/V2/V1 transform + analysis_ready + model_adjustments
 *
 * Source: Route handler lines 453-524
 * This is the final stage — it produces the HTTP response body.
 * The route handler MUST NOT post-process the response.
 */

import type { StageContext } from "../types.js";
import { transformResponseToV3, validateStrictModeV3 } from "../../transforms/schema-v3.js";
import { transformResponseToV2 } from "../../transforms/schema-v2.js";
import { mapMutationsToAdjustments, extractConstraintDropBlockers } from "../../transforms/analysis-ready.js";
import { CEEGraphResponseV3 } from "../../../schemas/cee-v3.js";
import { extractZodIssues } from "../../../schemas/llmExtraction.js";
import { log, emit, TelemetryEvents } from "../../../utils/telemetry.js";
import { config } from "../../../config/index.js";
import { getRuntimeEnv } from "../../../config/env-resolver.js";
import { runGraphDataIntegrityChecks } from "../../transforms/graph-data-integrity.js";

export async function runStageBoundary(ctx: StageContext): Promise<void> {
  log.info({ requestId: ctx.requestId, stage: "boundary" }, "Unified pipeline: Stage 6 (Boundary) started");

  if (!ctx.ceeResponse) {
    // Stage 5 didn't produce a response (early return already handled)
    return;
  }

  const schemaVersion = ctx.opts.schemaVersion;

  if (schemaVersion === "v3") {
    // V3 transform
    const v3Body = transformResponseToV3(ctx.ceeResponse as any, {
      brief: ctx.input.brief,
      requestId: ctx.requestId,
      strictMode: ctx.opts.strictMode,
      includeDebug: ctx.opts.includeDebug,
    });

    // ── Graph data integrity checks (post-V3-transform, pre-validation) ─────
    // Runs two deterministic corrections:
    // 1. Factor scale consistency: assert value ≈ raw_value/cap (or raw_value/100 for "%").
    //    Corrects observed_state.value and matching analysis_ready.options interventions.
    // 2. Edge field defaults: ensure exists_probability and effect_direction are present.
    //    Structural edges default to 1.0/"positive"; causal to 0.8/sign-inferred.
    // Mutations are logged in trace.pipeline.repair_summary.graph_data_integrity.
    const integrityRepairs = runGraphDataIntegrityChecks(v3Body, ctx.requestId);
    if (
      integrityRepairs.scale_consistency_repairs.length > 0 ||
      integrityRepairs.edge_field_repairs.length > 0 ||
      integrityRepairs.intercept_population_repairs.length > 0
    ) {
      // Attach to pipeline trace so debug bundles capture the corrections.
      const pipelineTrace = (v3Body as any)?.trace?.pipeline;
      if (pipelineTrace && typeof pipelineTrace === "object") {
        const repairSummary = (pipelineTrace as any).repair_summary;
        if (repairSummary && typeof repairSummary === "object") {
          (repairSummary as any).graph_data_integrity = integrityRepairs;
        } else {
          (pipelineTrace as any).repair_summary = { graph_data_integrity: integrityRepairs };
        }
      }
    }

    // Surface STRP/repair mutations as model_adjustments (match route handler lines 500-519)
    const v1Trace = (ctx.ceeResponse as any).trace;
    const strpMutations = v1Trace?.strp?.mutations;
    const graphCorrections = v1Trace?.corrections;
    if (v3Body.analysis_ready && (strpMutations?.length || graphCorrections?.length)) {
      // Build nodeLabels from v3Body.nodes (ROOT level, not v3Body.graph)
      const nodeLabels = new Map<string, string>();
      const graphNodes = (v3Body as any)?.nodes;
      if (Array.isArray(graphNodes)) {
        for (const node of graphNodes) {
          if (node?.id && node?.label) {
            nodeLabels.set(node.id, node.label);
          }
        }
      }
      const adjustments = mapMutationsToAdjustments(strpMutations, graphCorrections, nodeLabels);
      if (adjustments.length > 0) {
        v3Body.analysis_ready.model_adjustments = adjustments;
      }
    }

    // Append deterministic sweep reclassifications as model_adjustments.
    // Only UNREACHABLE_FACTOR_RECLASSIFIED repairs are user-visible — other codes
    // (NAN_VALUE, SIGN_MISMATCH, etc.) are mechanical fixes the user doesn't need to review.
    // Expand REPAIR_CODE_TO_ADJUSTMENT intentionally when new user-visible repairs are added.
    if (v3Body.analysis_ready) {
      const REPAIR_CODE_TO_ADJUSTMENT: Record<string, "category_reclassified"> = {
        UNREACHABLE_FACTOR_RECLASSIFIED: "category_reclassified",
      };

      const repairAdjustments = (ctx.deterministicRepairs ?? [])
        .filter((r) => r.code in REPAIR_CODE_TO_ADJUSTMENT)
        .map((r) => {
          // Extract node_id from path format "nodes[fac_x].category"
          const nodeIdMatch = r.path.match(/^nodes\[([^\]]+)\]/);
          return {
            code: REPAIR_CODE_TO_ADJUSTMENT[r.code],
            node_id: nodeIdMatch?.[1],
            field: r.path,
            reason: r.action,
            source: "deterministic_sweep" as const,
          };
        });

      if (!v3Body.analysis_ready.model_adjustments) {
        v3Body.analysis_ready.model_adjustments = [];
      }
      v3Body.analysis_ready.model_adjustments.push(...repairAdjustments);
    }

    // Attach bias_findings to analysis_ready (from V1 payload → analysis_ready block)
    if (v3Body.analysis_ready) {
      const v1BiasFindings = (ctx.ceeResponse as any)?.bias_findings;
      (v3Body.analysis_ready as any).bias_findings = Array.isArray(v1BiasFindings)
        ? v1BiasFindings
        : [];
    }

    // Surface STRP constraint drops as blockers
    if (v3Body.analysis_ready && strpMutations?.length) {
      const constraintBlockers = extractConstraintDropBlockers(strpMutations);
      if (constraintBlockers.length > 0) {
        if (!v3Body.analysis_ready.blockers) v3Body.analysis_ready.blockers = [];
        v3Body.analysis_ready.blockers.push(...constraintBlockers);
      }
    }

    // Strict mode validation (Track 1 soft gate — log and continue)
    if (ctx.opts.strictMode) {
      try {
        validateStrictModeV3(v3Body);
      } catch (err) {
        const errMsg = (err as Error).message;
        log.warn({
          event: "pipeline.soft_gate_degraded",
          stage: "boundary_strict_mode",
          error: errMsg,
          request_id: ctx.requestId,
        }, "V3 strict mode validation failed — continuing with graph (soft gate)");

        // Emit telemetry event (still useful for monitoring)
        emit(TelemetryEvents.CeeBoundaryBlocked, {
          request_id: ctx.requestId,
          error_code: "CEE_V3_STRICT_MODE_DEGRADED",
          error_message: errMsg,
          validation_issues: [],
          graph_hash: (v3Body as any)?.meta?.graph_hash,
        });

        ctx.pipelineOutcome.warnings.push({
          stage: 'boundary_strict_mode',
          error: errMsg,
          degraded: true,
        });
        // Continue — do NOT null the graph or return blocked response
      }
    }

    // Belt-and-suspenders: validate V3 output before returning.
    // Track 1 (progressive degradation): V3 validation failures log a warning
    // and pass through the graph rather than returning a blocked response.
    // A valid graph must never be discarded by schema validation failures.
    const parseResult = CEEGraphResponseV3.safeParse(v3Body);
    if (!parseResult.success) {
      const runtimeEnv = getRuntimeEnv();
      const allowInvalid = config.cee.boundaryAllowInvalid;

      const validationIssues = extractZodIssues(parseResult.error, 5);
      const errMsg = `V3 schema validation failed: ${parseResult.error.issues.length} issues`;

      // Dev escape hatch: allow invalid graphs in local/test if explicitly enabled
      // (Config-level enforcement already prevents this flag from being true in staging/prod)
      if (allowInvalid) {
        log.warn({
          event: "cee.boundary.output_validation_failed",
          error_count: parseResult.error.issues.length,
          first_issues: extractZodIssues(parseResult.error, 3),
          request_id: ctx.requestId,
          dev_override_active: true,
          runtime_env: runtimeEnv,
        }, "V3 output failed schema validation (bypassed via CEE_BOUNDARY_ALLOW_INVALID)");
        ctx.finalResponse = v3Body;
        return;
      }

      // Soft gate (Track 1): log, record warning, pass through graph
      log.warn({
        event: "pipeline.soft_gate_degraded",
        stage: "boundary_v3_validation",
        error_count: parseResult.error.issues.length,
        first_issues: extractZodIssues(parseResult.error, 3),
        request_id: ctx.requestId,
        runtime_env: runtimeEnv,
      }, "V3 output failed schema validation — continuing with graph (soft gate)");

      // Emit telemetry event (still useful for monitoring)
      emit(TelemetryEvents.CeeBoundaryBlocked, {
        request_id: ctx.requestId,
        error_code: "CEE_V3_VALIDATION_DEGRADED",
        error_message: errMsg,
        validation_issues: validationIssues,
        graph_hash: (v3Body as any)?.meta?.graph_hash,
      });

      ctx.pipelineOutcome.warnings.push({
        stage: 'boundary_v3_validation',
        error: errMsg,
        degraded: true,
      });
    }

    ctx.finalResponse = v3Body;
  } else if (schemaVersion === "v2") {
    ctx.finalResponse = transformResponseToV2(ctx.ceeResponse as any);
  } else {
    // V1 pass through
    ctx.finalResponse = ctx.ceeResponse;
  }
}
