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
  remapConstraintTargets,
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

  const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; label?: string }>;
  const existingNodeIds = new Set(graphNodes.map((n) => n.id));
  const existingNodeIdList = [...existingNodeIds];

  // Build label map for label-based fuzzy matching fallback
  const nodeLabels = new Map<string, string>();
  for (const n of graphNodes) {
    if (n.label) nodeLabels.set(n.id, n.label);
  }

  // Remap constraint targets against actual graph nodes BEFORE generating
  // nodes/edges. This fixes the root cause: the regex extractor invents IDs
  // from brief text that don't match LLM-generated node IDs.
  const remapResult = remapConstraintTargets(
    compoundGoalResult.constraints,
    existingNodeIdList,
    nodeLabels,
    ctx.requestId,
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

  ctx.goalConstraints = toGoalConstraints(validConstraints);

  const constraintNodes = generateConstraintNodes(validConstraints);
  const constraintEdges = generateConstraintEdges(validConstraints);

  const rawEdges = constraintEdgesToGraphEdges(constraintEdges);

  // After remapping, all edge targets should exist in the graph.
  // Filter is retained as a safety net but should be a no-op.
  const edgesToAdd = rawEdges.filter((e: any) => existingNodeIds.has(e.to));

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
    constraints_remapped: remapResult.remapped,
    constraints_rejected_junk: remapResult.rejected_junk,
    constraints_rejected_no_match: remapResult.rejected_no_match,
    constraints_skipped_no_target: skippedCount,
    is_compound: compoundGoalResult.isCompound,
  }, "Compound goal constraints integrated into graph");
}
