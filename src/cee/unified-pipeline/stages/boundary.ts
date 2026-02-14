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
import { log } from "../../../utils/telemetry.js";

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
        ctx.earlyReturn = {
          statusCode: 422,
          body: {
            error: {
              code: "CEE_V3_VALIDATION_FAILED",
              message: (err as Error).message,
              validation_warnings: (v3Body as any).validation_warnings,
            },
          },
        };
        return;
      }
    }

    ctx.finalResponse = v3Body;
  } else if (schemaVersion === "v2") {
    ctx.finalResponse = transformResponseToV2(ctx.ceeResponse as any);
  } else {
    // V1 pass through
    ctx.finalResponse = ctx.ceeResponse;
  }
}
