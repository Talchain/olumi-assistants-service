/**
 * Stage 4 Substep 4: Goal merge (single call)
 *
 * Source: Pipeline B line 1454
 * Calls validateAndFixGraph once — eliminates Pipeline A's duplicate at line 1270.
 * Captures nodeRenames only when goals are actually merged (improvement #1).
 */

import type { StageContext } from "../../types.js";
import { validateAndFixGraph } from "../../../structure/index.js";
import { config } from "../../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

export function runGoalMerge(ctx: StageContext): void {
  if (!ctx.graph) return;

  const graphValidation = validateAndFixGraph(ctx.graph as any, ctx.structuralMeta, {
    enforceSingleGoal: config.cee.enforceSingleGoal,
    checkSizeLimits: false,
  });

  if (graphValidation.graph) {
    ctx.graph = graphValidation.graph as any;
  }

  // Only populate nodeRenames when goals were actually merged
  if (graphValidation.fixes.nodeRenames) {
    ctx.nodeRenames = graphValidation.fixes.nodeRenames;
  }

  if (graphValidation.fixes.singleGoalApplied) {
    emit(TelemetryEvents.CeeGraphGoalsMerged, {
      original_goal_count: graphValidation.fixes.originalGoalCount,
      merged_goal_ids: graphValidation.fixes.mergedGoalIds,
    });
  }

  log.info({
    stage: "4_goal_merge_and_fix",
    node_count: (ctx.graph as any)?.nodes?.length,
    edge_count: (ctx.graph as any)?.edges?.length,
    single_goal_applied: graphValidation.fixes.singleGoalApplied,
    original_goal_count: graphValidation.fixes.originalGoalCount,
    outcome_beliefs_filled: graphValidation.fixes.outcomeBeliefsFilled,
    correlation_id: ctx.requestId,
  }, "Pipeline stage: Goal merge and validation fixes complete");
}
