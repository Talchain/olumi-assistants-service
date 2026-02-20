/**
 * Stage 4 Substep 5: Compound goals
 *
 * Source: Pipeline B lines 1578-1628
 * Extracts compound goals from brief, remaps constraint targets against
 * actual graph nodes, and emits goal_constraints[] for the response.
 *
 * Constraint data lives only in goal_constraints[] — constraints are metadata,
 * not causal factors, so they must NOT be emitted as graph nodes or edges
 * (F.6: CEE generates, PLoT computes, UI displays).
 */

import type { StageContext } from "../../types.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
  remapConstraintTargets,
} from "../../../compound-goal/index.js";
import { log } from "../../../../utils/telemetry.js";

export function runCompoundGoals(ctx: StageContext): void {
  if (!ctx.graph) return;

  const compoundGoalResult = extractCompoundGoals(ctx.effectiveBrief, { includeProxies: false });

  if (compoundGoalResult.constraints.length === 0) return;

  const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; kind?: string; label?: string }>;
  const existingNodeIds = new Set(graphNodes.map((n) => n.id));
  const existingNodeIdList = [...existingNodeIds];

  // Build label map for label-based fuzzy matching fallback
  const nodeLabels = new Map<string, string>();
  for (const n of graphNodes) {
    if (n.label) nodeLabels.set(n.id, n.label);
  }

  // Find goal node ID for temporal constraint binding
  const goalNode = graphNodes.find((n) => n.kind === "goal");
  const goalNodeId = goalNode?.id;

  // Remap constraint targets against actual graph nodes BEFORE generating
  // goal_constraints. This fixes the root cause: the regex extractor invents IDs
  // from brief text that don't match LLM-generated node IDs.
  const remapResult = remapConstraintTargets(
    compoundGoalResult.constraints,
    existingNodeIdList,
    nodeLabels,
    ctx.requestId,
    goalNodeId,
  );
  const validConstraints = remapResult.constraints;

  if (validConstraints.length === 0) {
    log.info({
      event: "cee.compound_goal.all_dropped",
      request_id: ctx.requestId,
      original_count: compoundGoalResult.constraints.length,
    }, "All constraints dropped after remapping — skipping graph integration");
    return;
  }

  const normalised = normaliseConstraintUnits(validConstraints);
  ctx.goalConstraints = toGoalConstraints(normalised);

  log.info({
    event: "cee.compound_goal.integrated",
    request_id: ctx.requestId,
    constraint_count: ctx.goalConstraints.length,
    constraints_remapped: remapResult.remapped,
    constraints_rejected_junk: remapResult.rejected_junk,
    constraints_rejected_no_match: remapResult.rejected_no_match,
    is_compound: compoundGoalResult.isCompound,
  }, "Compound goal constraints emitted to goal_constraints[]");
}
