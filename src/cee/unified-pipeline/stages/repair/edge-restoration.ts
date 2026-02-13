/**
 * Stage 4 Substep 7: Edge field restoration (RISK-06 fix)
 *
 * Restores V4 edge fields from the stash created in Stage 1,
 * using nodeRenames from goal merge for stash lookup reversal.
 * Writes restoration count to ctx.repairTrace for parity assertions.
 */

import type { StageContext } from "../../types.js";
import { restoreEdgeFields } from "../../edge-identity.js";
import { log } from "../../../../utils/telemetry.js";

export function runEdgeRestoration(ctx: StageContext): void {
  if (!ctx.graph || !ctx.edgeFieldStash) return;

  // Pass nodeRenames for stash lookup reversal after goal merge
  const result = restoreEdgeFields(
    (ctx.graph as any).edges,
    ctx.edgeFieldStash,
    ctx.nodeRenames,
  );

  ctx.graph = { ...(ctx.graph as any), edges: result.edges } as any;

  // Write to trace for parity test assertions (improvement #4)
  ctx.repairTrace = {
    ...ctx.repairTrace,
    edge_restore: { restoredCount: result.restoredCount },
  };

  if (result.restoredCount > 0) {
    log.warn({
      event: "cee.v4_edge_stash.restored",
      restored: result.restoredCount,
      total: (ctx.graph as any).edges.length,
      correlation_id: ctx.requestId,
    }, `V4 edge stash safety net: restored ${result.restoredCount}/${(ctx.graph as any).edges.length} edges`);
  } else if ((ctx.graph as any).edges.length > 0) {
    log.debug({
      event: "cee.v4_edge_stash.noop",
      total: (ctx.graph as any).edges.length,
      correlation_id: ctx.requestId,
    }, "V4 edge stash safety net: no restoration needed");
  }
}
