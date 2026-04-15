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
import { log } from "../../../../utils/telemetry.js";

export function runLateStrp(ctx: StageContext): void {
  if (!ctx.graph) return;

  // Build nodeLabels map for label-based fuzzy matching in Rule 3
  const nodeLabels = new Map<string, string>();
  for (const node of (ctx.graph as any).nodes) {
    if (node.label) nodeLabels.set(node.id, node.label);
  }

  // Pass goalConstraints through so Rule 3b (constraint direction heuristic)
  // and Rule 3 diagnostic mutations still surface in ctx.constraintStrpResult
  // — package.ts promotes CONSTRAINT_DIRECTION_HEURISTIC into validation_issues.
  const priorConstraints = ctx.goalConstraints;
  const result = reconcileStructuralTruth(ctx.graph as any, {
    goalConstraints: priorConstraints?.length ? priorConstraints : undefined,
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

  // Only adopt STRP's normalised constraints when they are non-empty. Rule 3
  // re-runs target normalisation against the current graph; a miss produces []
  // which used to clobber the good array emitted by compound-goals, causing
  // schema-v3 (length > 0 gate) to drop goal_constraints from the response.
  if (result.goalConstraints && result.goalConstraints.length > 0) {
    ctx.goalConstraints = result.goalConstraints;
  } else if (
    result.goalConstraints &&
    result.goalConstraints.length === 0 &&
    priorConstraints &&
    priorConstraints.length > 0
  ) {
    log.info({
      event: 'cee.late_strp.constraint_overwrite_prevented',
      request_id: ctx.requestId,
      existing_count: priorConstraints.length,
      strp_count: result.goalConstraints.length,
    }, 'Prevented late-STRP from overwriting non-empty goalConstraints with []');
  }
}
