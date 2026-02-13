/**
 * Stage 4 Substep 9: Clarifier (last graph-modifying step)
 *
 * Source: Pipeline A lines 2250-2302
 * Integrates multi-turn clarifier if enabled.
 *
 * Quality computed here ONLY as clarifier precondition input.
 * Stage 5 (Package) is the canonical quality/warnings assembly.
 * Do not remove Stage 5's quality computation.
 */

import type { StageContext } from "../../types.js";
import { integrateClarifier } from "../../../validation/pipeline.js";
import { computeQuality } from "../../../quality/index.js";
import { normaliseCeeGraphVersionAndProvenance } from "../../../transforms/graph-normalisation.js";
import { normaliseDecisionBranchBeliefs } from "../../../structure/index.js";
import { config } from "../../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

export async function runClarifier(ctx: StageContext): Promise<void> {
  if (!config.cee.clarifierEnabled) return;
  if (!ctx.graph) return;

  // Compute quality as clarifier precondition (Gap 3 fix)
  ctx.quality = computeQuality({
    graph: ctx.graph,
    confidence: ctx.confidence ?? 0.7,
    engineIssueCount: 0,
    ceeIssues: [],
  });

  try {
    const preClarifierGraph = ctx.graph;

    const result = await integrateClarifier(
      ctx.input as any,
      ctx.graph,
      ctx.quality,
      ctx.requestId,
      preClarifierGraph,
    );

    ctx.clarifierResult = result;

    if (result.refinedGraph) {
      let refinedGraph = normaliseCeeGraphVersionAndProvenance(result.refinedGraph);
      refinedGraph = normaliseDecisionBranchBeliefs(refinedGraph);
      if (refinedGraph) {
        ctx.graph = refinedGraph;
      }
    }
  } catch (error) {
    log.warn(
      { error, request_id: ctx.requestId },
      "Clarifier integration failed, continuing without clarification",
    );

    emit(TelemetryEvents.CeeClarifierFailed, {
      request_id: ctx.requestId,
      error_message: error instanceof Error ? error.message : String(error),
      error_type: error instanceof Error ? error.name : "unknown",
      graph_nodes: Array.isArray((ctx.graph as any).nodes) ? (ctx.graph as any).nodes.length : 0,
      graph_edges: Array.isArray((ctx.graph as any).edges) ? (ctx.graph as any).edges.length : 0,
      fallback_to_no_clarifier: true,
    });
  }
}
