/**
 * Stage 4 Substep 6: Late STRP (Rules 3,5 with goalConstraints context)
 *
 * Source: Pipeline B lines 1636-1644
 * Runs structural truth reconciliation with fillControllableData: true.
 * Stores result in ctx.constraintStrpResult (Stage 4 late STRP output).
 */

import type { StageContext } from "../../types.js";
import { reconcileStructuralTruth } from "../../../../validators/structural-reconciliation.js";

export function runLateStrp(ctx: StageContext): void {
  if (!ctx.graph) return;

  const result = reconcileStructuralTruth(ctx.graph as any, {
    goalConstraints: ctx.goalConstraints?.length ? ctx.goalConstraints : undefined,
    requestId: ctx.requestId,
    fillControllableData: true,
  });

  ctx.graph = result.graph as any;
  // constraintStrpResult holds the Stage 4 late STRP result (Rules 3,5)
  ctx.constraintStrpResult = result;

  if (result.goalConstraints) {
    ctx.goalConstraints = result.goalConstraints;
  }
}
