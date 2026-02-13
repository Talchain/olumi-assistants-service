/**
 * Stage 2: Normalise — STRP + risk coefficients (field transforms only)
 *
 * Source: Pipeline B lines 1107-1114 + Pipeline A lines 1561-1614
 * No simpleRepair in this stage — connectivity repair runs in Stage 3/4.
 */

import type { StageContext } from "../types.js";
import { reconcileStructuralTruth } from "../../../validators/structural-reconciliation.js";
import { normaliseRiskCoefficients } from "../../transforms/risk-normalisation.js";
import { log, emit } from "../../../utils/telemetry.js";

/**
 * Stage 2: Apply deterministic field transforms.
 * 1. Early STRP (Rules 1,2,4) — structural truth reconciliation
 * 2. Risk coefficient normalisation — flip positive risk→goal edges to negative
 * 3. Edge count invariant — verify no unaccounted edge loss
 */
export async function runStageNormalise(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "normalise" }, "Unified pipeline: Stage 2 (Normalise) started");

  const edgeCountBefore = ((ctx.graph as any).edges ?? []).length;

  // Step 1: Early STRP — structural truth reconciliation
  const strpResult = reconcileStructuralTruth(ctx.graph as any, {
    requestId: ctx.requestId,
  });
  ctx.graph = strpResult.graph as any;
  ctx.strpResult = strpResult;

  if (strpResult.mutations.length > 0) {
    log.info({
      requestId: ctx.requestId,
      mutation_count: strpResult.mutations.length,
      rules_triggered: [...new Set(strpResult.mutations.map((m: any) => m.rule))],
    }, "STRP mutations applied");
  }

  // Step 2: Risk coefficient normalisation
  const nodes = (ctx.graph as any).nodes ?? [];
  const edges = (ctx.graph as any).edges ?? [];

  const normResult = normaliseRiskCoefficients(nodes, edges);
  ctx.riskCoefficientCorrections = normResult.corrections;

  if (normResult.corrections.length > 0) {
    (ctx.graph as any).edges = normResult.edges;
    log.info({
      requestId: ctx.requestId,
      corrections_count: normResult.corrections.length,
    }, "Risk coefficient corrections applied");
  }

  // Step 3: Edge count invariant (change 3: allow STRP-recorded decreases)
  const edgeCountAfter = ((ctx.graph as any).edges ?? []).length;
  if (edgeCountAfter < edgeCountBefore) {
    // Count removal-type mutations from STRP
    const removalMutations = strpResult.mutations.filter(
      (m: any) => m.code === "edge_removed" || m.code === "constraint_edge_remapped",
    ).length;
    const unaccountedLoss = (edgeCountBefore - edgeCountAfter) - removalMutations;

    if (unaccountedLoss > 0) {
      log.error({
        event: "cee.stage2.edge_count_invariant_violated",
        requestId: ctx.requestId,
        edge_count_before: edgeCountBefore,
        edge_count_after: edgeCountAfter,
        strp_removals: removalMutations,
        unaccounted_loss: unaccountedLoss,
      }, `Stage 2 edge count invariant violated: ${unaccountedLoss} edge(s) lost without STRP record`);
      emit("cee.stage2.edge_count_invariant_violated", {
        edge_count_before: edgeCountBefore,
        edge_count_after: edgeCountAfter,
        strp_removals: removalMutations,
        unaccounted_loss: unaccountedLoss,
      });
    }
  }
}
