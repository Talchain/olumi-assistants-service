/**
 * Stage 4 Substep 4: Goal merge (single call)
 *
 * Source: Pipeline B line 1454
 * Calls validateAndFixGraph once — eliminates Pipeline A's duplicate at line 1270.
 * Captures nodeRenames only when goals are actually merged (improvement #1).
 *
 * ── ⭐⭐ WHY THIS STAGE NOW READS THE CONSTRAINT EXTRACTOR ──────────────────
 * When the model states several objectives, this substep decides which one
 * every causal chain terminates at. It decided by ARRAY POSITION, and measured
 * on deployed staging (2026-08-29, build `f18d941`, 12 fresh guest draws of the
 * founder's verbatim brief) that promoted the user's BUDGET CEILING to the
 * objective in **2 of 12** drafts.
 *
 * ⚠ AND THE REASON THE DISCRIMINATOR HAS TO BE FETCHED HERE RATHER THAN READ
 * OFF THE GRAPH: `goal_constraints[]` DOES NOT EXIST YET AT THIS POINT.
 * Derived at `../index.ts` — substep 4 is `runGoalMerge`, substep 5 is
 * `runCompoundGoals`, so the array this discriminator is about is minted one
 * substep LATER. Reading `graph.goal_constraints` here would have found nothing
 * and the guard would have been a silent no-op with a plausible cause, which is
 * the hardest kind of dead guard to doubt.
 *
 * So the SAME producer is called on the SAME `effectiveBrief`, and only its
 * source spans are read. `extractCompoundGoals` is pure and side-effect free;
 * substep 5 still owns minting, and nothing here writes a constraint. One
 * authority, consulted twice — not two authorities that can drift.
 */

import type { StageContext } from "../../types.js";
import { validateAndFixGraph } from "../../../structure/index.js";
import { extractCompoundGoals } from "../../../compound-goal/extractor.js";
import { config } from "../../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

/**
 * The spans an independent extractor read as numeric limits over this brief.
 *
 * Failure is swallowed DELIBERATELY and narrowly: an empty list restores the
 * exact pre-existing selection, so a throw here degrades to today's behaviour
 * rather than failing a draft. Substep 5 runs the same extractor a moment later
 * and owns reporting anything that goes wrong with it.
 */
export function constraintSourceQuotesForBrief(brief: string | undefined): string[] {
  if (typeof brief !== "string" || brief.trim().length === 0) return [];
  try {
    return extractCompoundGoals(brief, { includeProxies: false })
      .constraints.map((c) => c.sourceQuote)
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0);
  } catch {
    return [];
  }
}

export function runGoalMerge(ctx: StageContext): void {
  if (!ctx.graph) return;

  const constraintSourceQuotes = constraintSourceQuotesForBrief(ctx.effectiveBrief);

  const graphValidation = validateAndFixGraph(ctx.graph as any, ctx.structuralMeta, {
    enforceSingleGoal: config.cee.enforceSingleGoal,
    checkSizeLimits: false,
    constraintSourceQuotes,
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
    constraint_spans_considered: constraintSourceQuotes.length,
    outcome_beliefs_filled: graphValidation.fixes.outcomeBeliefsFilled,
    correlation_id: ctx.requestId,
  }, "Pipeline stage: Goal merge and validation fixes complete");
}
