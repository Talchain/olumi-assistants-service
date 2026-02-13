/**
 * Stage 4 Substep 3: Edge ID stabilisation
 *
 * Source: Pipeline B line 1450
 * Assigns deterministic edge IDs before goal merge changes from/to fields.
 */

import type { StageContext } from "../../types.js";
import { enforceStableEdgeIds } from "../../../../utils/graph-determinism.js";

export function runEdgeStabilisation(ctx: StageContext): void {
  if (!ctx.graph) return;
  ctx.graph = enforceStableEdgeIds(ctx.graph as any) as any;
}
