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
import { fuzzyMatchNodeId } from "../../../../validators/structural-reconciliation.js";
import { log } from "../../../../utils/telemetry.js";

export function runCompoundGoals(ctx: StageContext): void {
  if (!ctx.graph) return;

  const compoundGoalResult = extractCompoundGoals(ctx.effectiveBrief, { includeProxies: false });

  if (compoundGoalResult.constraints.length === 0) return;

  ctx.goalConstraints = toGoalConstraints(compoundGoalResult.constraints);

  const constraintNodes = generateConstraintNodes(compoundGoalResult.constraints);
  const constraintEdges = generateConstraintEdges(compoundGoalResult.constraints);

  const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; label?: string }>;
  const existingNodeIds = new Set(graphNodes.map((n) => n.id));
  const existingNodeIdList = [...existingNodeIds];

  // Build label map for label-based fuzzy matching fallback
  const nodeLabels = new Map<string, string>();
  for (const n of graphNodes) {
    if (n.label) nodeLabels.set(n.id, n.label);
  }

  let fuzzyRemapCount = 0;
  const rawEdges = constraintEdgesToGraphEdges(constraintEdges);

  const edgesToAdd = rawEdges.filter((e: any) => {
    // Exact match — keep as-is
    if (existingNodeIds.has(e.to)) return true;

    // Fuzzy match — remap target
    const match = fuzzyMatchNodeId(e.to, existingNodeIdList, nodeLabels);
    if (match) {
      log.info({
        event: "cee.compound_goal.fuzzy_remap",
        request_id: ctx.requestId,
        original_target: e.to,
        remapped_target: match,
      }, `Constraint edge target fuzzy-remapped: ${e.to} → ${match}`);
      e.to = match;
      fuzzyRemapCount++;
      return true;
    }

    return false;
  });

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
    constraint_edges_fuzzy_remapped: fuzzyRemapCount,
    constraints_skipped_no_target: skippedCount,
    is_compound: compoundGoalResult.isCompound,
  }, "Compound goal constraints integrated into graph");
}
