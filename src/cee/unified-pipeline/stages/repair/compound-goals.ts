/**
 * Stage 4 Substep 5: Compound goals
 *
 * Source: Pipeline B lines 1578-1628
 * Extracts compound goals from brief, generates constraint nodes/edges,
 * filters to only those with valid targets, and adds to graph.
 */

import type { StageContext } from "../../types.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  generateConstraintNodes,
  generateConstraintEdges,
  constraintNodesToGraphNodes,
  constraintEdgesToGraphEdges,
} from "../../../compound-goal/index.js";
import { log } from "../../../../utils/telemetry.js";

export function runCompoundGoals(ctx: StageContext): void {
  if (!ctx.graph) return;

  const compoundGoalResult = extractCompoundGoals(ctx.effectiveBrief, { includeProxies: false });

  if (compoundGoalResult.constraints.length === 0) return;

  ctx.goalConstraints = toGoalConstraints(compoundGoalResult.constraints);

  const constraintNodes = generateConstraintNodes(compoundGoalResult.constraints);
  const constraintEdges = generateConstraintEdges(compoundGoalResult.constraints);

  const existingNodeIds = new Set((ctx.graph as any).nodes.map((n: any) => n.id));

  const edgesToAdd = constraintEdgesToGraphEdges(constraintEdges).filter(
    (e: any) => existingNodeIds.has(e.to),
  );

  const constraintIdsWithValidTargets = new Set(edgesToAdd.map((e: any) => e.from));

  const nodesToAdd = constraintNodesToGraphNodes(constraintNodes).filter(
    (n: any) => constraintIdsWithValidTargets.has(n.id) && !existingNodeIds.has(n.id),
  );

  const skippedCount = constraintNodes.length - nodesToAdd.length;

  ctx.graph = {
    ...(ctx.graph as any),
    nodes: [...(ctx.graph as any).nodes, ...nodesToAdd],
    edges: [...(ctx.graph as any).edges, ...edgesToAdd],
  } as any;

  log.info({
    event: "cee.compound_goal.integrated",
    request_id: ctx.requestId,
    constraint_count: ctx.goalConstraints.length,
    constraint_nodes_added: nodesToAdd.length,
    constraint_edges_added: edgesToAdd.length,
    constraints_skipped_no_target: skippedCount,
    is_compound: compoundGoalResult.isCompound,
  }, "Compound goal constraints integrated into graph");
}
