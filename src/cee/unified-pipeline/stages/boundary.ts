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
import { isAdminAuthorized } from "../../validation/pipeline.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../constants/versions.js";
import { config } from "../../../config/index.js";
import { getRuntimeEnv } from "../../../config/env-resolver.js";

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

    // Surface STRP constraint drops as blockers
    if (v3Body.analysis_ready && strpMutations?.length) {
      const constraintBlockers = extractConstraintDropBlockers(strpMutations);
      if (constraintBlockers.length > 0) {
        if (!v3Body.analysis_ready.blockers) v3Body.analysis_ready.blockers = [];
        v3Body.analysis_ready.blockers.push(...constraintBlockers);
      }
    }

    // Strict mode validation (Stream F: return blocked response instead of 422)
    if (ctx.opts.strictMode) {
      try {
        validateStrictModeV3(v3Body);
      } catch (err) {
        log.error({
          event: "cee.boundary.strict_mode_failed",
          request_id: ctx.requestId,
          error: (err as Error).message,
        }, "V3 strict mode validation failed");

        // Emit telemetry event
        emit(TelemetryEvents.CeeBoundaryBlocked, {
          request_id: ctx.requestId,
          error_code: "CEE_V3_STRICT_MODE_FAILED",
          error_message: (err as Error).message,
          validation_issues: [],
          graph_hash: (v3Body as any)?.meta?.graph_hash,
        });

        /**
         * TRACE PRESERVATION CONTRACT:
         * - When upstream response includes trace fields → preserve them in blocked response
         * - When upstream response omits trace → pipeline may add minimal trace for observability
         * - Custom fields (correlation_id, etc.) are passed through unchanged
         */

        // Return backward-compatible blocked response
        // CONTRACT: Blocked responses ALWAYS return graph: null (never omitted).
        // Schema allows omission for legacy compatibility, but production code
        // must use explicit null for consistent downstream consumption.
        const blockedResponse: any = {
          ...v3Body,
          meta: (ctx.ceeResponse as any)?.meta || v3Body.meta,
          trace: (ctx.ceeResponse as any)?.trace || v3Body.trace,
          graph: null, // CANONICAL: always explicit null, never omitted
          nodes: [],
          edges: [],
          analysis_ready: {
            options: [],
            goal_node_id: (v3Body as any)?.goal_node_id || "",
            status: "blocked",
            blockers: [
              {
                code: "strict_mode_validation_failure",
                severity: "error",
                message: (err as Error).message,
                details: {
                  deterministic_sweep_ran: (ctx.repairTrace?.deterministic_sweep as Record<string, unknown> | undefined)?.sweep_ran ?? false,
                  deterministic_sweep_version: DETERMINISTIC_SWEEP_VERSION,
                  llm_repair_called: ctx.orchestratorRepairUsed ?? false,
                },
              },
            ],
          },
        };

        ctx.finalResponse = blockedResponse;
        return;
      }
    }

    // Belt-and-suspenders: validate V3 output before returning.
    // Stream F: V3 validation failures return blocked status (no invalid graph)
    const parseResult = CEEGraphResponseV3.safeParse(v3Body);
    if (!parseResult.success) {
      const runtimeEnv = getRuntimeEnv();
      const allowInvalid = config.cee.boundaryAllowInvalid;

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

      // Default behavior: return blocked status with validation errors
      log.error({
        event: "cee.boundary.output_validation_failed",
        error_count: parseResult.error.issues.length,
        first_issues: extractZodIssues(parseResult.error, 3),
        request_id: ctx.requestId,
      }, "V3 output failed CEEGraphResponseV3 schema validation");

      // Emit telemetry event
      const validationIssues = extractZodIssues(parseResult.error, 5);
      emit(TelemetryEvents.CeeBoundaryBlocked, {
        request_id: ctx.requestId,
        error_code: "CEE_V3_VALIDATION_FAILED",
        error_message: `V3 schema validation failed: ${parseResult.error.issues.length} issues`,
        validation_issues: validationIssues,
        graph_hash: (v3Body as any)?.meta?.graph_hash,
      });

      // Return backward-compatible blocked response
      // Preserve existing envelope (including meta, trace from original response), set analysis_ready.status to blocked
      // CONTRACT: Blocked responses ALWAYS return graph: null (never omitted).
      // Schema allows omission for legacy compatibility, but production code
      // must use explicit null for consistent downstream consumption.
      const blockedResponse: any = {
        ...v3Body,
        meta: (ctx.ceeResponse as any)?.meta || v3Body.meta, // Preserve meta from original response
        trace: (ctx.ceeResponse as any)?.trace || v3Body.trace, // Preserve trace from original response
        graph: null, // CANONICAL: always explicit null, never omitted
        nodes: [], // Empty nodes array (V3 format)
        edges: [], // Empty edges array (V3 format)
        analysis_ready: {
          options: [],
          goal_node_id: (v3Body as any)?.goal_node_id || "",
          status: "blocked",
          blockers: [
            {
              code: "validation_failure",
              severity: "error",
              message: `V3 schema validation failed: ${parseResult.error.issues.length} issues`,
              details: validationIssues,
            },
          ],
        },
      };

      ctx.finalResponse = blockedResponse;
      return;
    }

    ctx.finalResponse = v3Body;
  } else if (schemaVersion === "v2") {
    ctx.finalResponse = transformResponseToV2(ctx.ceeResponse as any);
  } else {
    // V1 pass through
    ctx.finalResponse = ctx.ceeResponse;
  }
}
