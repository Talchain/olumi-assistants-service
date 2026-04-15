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

  // Constraints were already remapped against the final graph by compound-goals.
  // Re-running Rule 3 here re-normalises against node IDs that may have shifted
  // during intermediate repairs, and any miss zeroes ctx.goalConstraints to [].
  // Skip by omitting goalConstraints; Rules 1,2,4,5 still run.
  const result = reconcileStructuralTruth(ctx.graph as any, {
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

  // Belt-and-braces: even with goalConstraints omitted above, guard any future
  // path where result.goalConstraints is defined-but-empty against clobbering
  // a good array from compound-goals.
  if (result.goalConstraints && result.goalConstraints.length > 0) {
    ctx.goalConstraints = result.goalConstraints;
  } else if (
    result.goalConstraints &&
    result.goalConstraints.length === 0 &&
    ctx.goalConstraints &&
    ctx.goalConstraints.length > 0
  ) {
    log.info({
      event: 'cee.late_strp.constraint_overwrite_prevented',
      request_id: ctx.requestId,
      existing_count: ctx.goalConstraints.length,
      strp_count: result.goalConstraints.length,
    }, 'Prevented late-STRP from overwriting non-empty goalConstraints with []');
  }
}
