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
import { log } from "../../../utils/telemetry.js";
import { isAdminAuthorized } from "../../validation/pipeline.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../constants/versions.js";

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

    // Append deterministic repair adjustments to model_adjustments (never overwrite)
    if (v3Body.analysis_ready && ctx.deterministicRepairs && ctx.deterministicRepairs.length > 0) {
      const repairAdjustments = ctx.deterministicRepairs.map((r) => ({
        code: "deterministic_repair" as const,
        field: r.path,
        reason: r.action,
      }));
      if (!v3Body.analysis_ready.model_adjustments) {
        v3Body.analysis_ready.model_adjustments = [];
      }
      v3Body.analysis_ready.model_adjustments.push(...repairAdjustments as any[]);
    }

    // Surface STRP constraint drops as blockers
    if (v3Body.analysis_ready && strpMutations?.length) {
      const constraintBlockers = extractConstraintDropBlockers(strpMutations);
      if (constraintBlockers.length > 0) {
        if (!v3Body.analysis_ready.blockers) v3Body.analysis_ready.blockers = [];
        v3Body.analysis_ready.blockers.push(...constraintBlockers);
      }
    }

    // Strict mode validation (match route handler lines 531-549)
    if (ctx.opts.strictMode) {
      try {
        validateStrictModeV3(v3Body);
      } catch (err) {
        log.warn({
          request_id: ctx.requestId,
          error: (err as Error).message,
        }, "V3 strict mode validation failed");

        // Sweep trace for 422 debugging — use CEETraceMeta shape (request_id + details)
        const sweepTrace = ctx.repairTrace?.deterministic_sweep as Record<string, unknown> | undefined;
        const traceDetails: Record<string, unknown> = {
          deterministic_sweep_ran: sweepTrace?.sweep_ran ?? false,
          deterministic_sweep_version: sweepTrace?.sweep_version ?? DETERMINISTIC_SWEEP_VERSION,
          last_phase: "boundary_strict_mode",
          llm_repair_called: ctx.orchestratorRepairUsed ?? false,
          llm_repair_timeout_ms: ctx.repairTimeoutMs,
        };

        // Full repair_summary behind admin key
        if (ctx.request && isAdminAuthorized(ctx.request)) {
          traceDetails.repair_summary = ctx.repairTrace;
        }

        ctx.earlyReturn = {
          statusCode: 422,
          body: {
            error: {
              code: "CEE_V3_VALIDATION_FAILED",
              message: (err as Error).message,
              validation_warnings: (v3Body as any).validation_warnings,
              trace: {
                request_id: ctx.requestId,
                correlation_id: ctx.requestId,
                details: traceDetails,
              },
            },
          },
        };
        return;
      }
    }

    // Belt-and-suspenders: validate V3 output before returning.
    // Logs diagnostic details before the opaque downstream structural_parse error.
    const parseResult = CEEGraphResponseV3.safeParse(v3Body);
    if (!parseResult.success) {
      log.error({
        event: "cee.boundary.output_validation_failed",
        error_count: parseResult.error.issues.length,
        first_issues: extractZodIssues(parseResult.error, 3),
        request_id: ctx.requestId,
      }, "V3 output failed CEEGraphResponseV3 schema validation (non-blocking)");
    }

    ctx.finalResponse = v3Body;
  } else if (schemaVersion === "v2") {
    ctx.finalResponse = transformResponseToV2(ctx.ceeResponse as any);
  } else {
    // V1 pass through
    ctx.finalResponse = ctx.ceeResponse;
  }
}
