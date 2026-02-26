/**
 * Stage 4 Substep 6: Late STRP (Rules 3,5 with goalConstraints context)
 *
 * Source: Pipeline B lines 1636-1644
 * Runs structural truth reconciliation with fillControllableData: true.
 * Stores result in ctx.constraintStrpResult (Stage 4 late STRP output).
 */

import type { StageContext } from "../../types.js";
import { reconcileStructuralTruth } from "../../../../validators/structural-reconciliation.js";
import { recordFieldDeletions } from "../../utils/field-deletion-audit.js";

export function runLateStrp(ctx: StageContext): void {
  if (!ctx.graph) return;

  // Build nodeLabels map for label-based fuzzy matching in Rule 3
  const nodeLabels = new Map<string, string>();
  for (const node of (ctx.graph as any).nodes) {
    if (node.label) nodeLabels.set(node.id, node.label);
  }

  const result = reconcileStructuralTruth(ctx.graph as any, {
    goalConstraints: ctx.goalConstraints?.length ? ctx.goalConstraints : undefined,
    requestId: ctx.requestId,
    fillControllableData: true,
    nodeLabels,
  });

  ctx.graph = result.graph as any;
  // constraintStrpResult holds the Stage 4 late STRP result (Rules 3,5)
  ctx.constraintStrpResult = result;

  // Collect field deletion events from late STRP
  if (result.fieldDeletions?.length > 0) {
    recordFieldDeletions(ctx, 'structural-reconciliation', result.fieldDeletions);
  }

  if (result.goalConstraints) {
    ctx.goalConstraints = result.goalConstraints;
  }
}
