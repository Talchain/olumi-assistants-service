/**
 * Validation Pipeline — Orchestrator
 *
 * Coordinates the full two-pass validation sequence:
 *   1. Extract minimal graph structure (no parameter values) for Pass 2.
 *   2. Call o4-mini (Pass 2) to independently estimate parameters.
 *   3. Apply enforcement lints to Pass 2 output.
 *   4. Compute per-parameter bias offsets (Pass 1 − Pass 2 median).
 *   5. Apply bias correction to linted Pass 2 estimates.
 *   6. Compare each Pass 1/Pass 2 pair → ValidationMetadata.
 *   7. Attach ValidationMetadata to graph edges in-place.
 *   8. Attach GraphValidationSummary to ctx.graph.validation_summary.
 *
 * All failures are logged and propagated — the caller (unified-pipeline/index.ts)
 * is responsible for catching errors and continuing gracefully.
 *
 * Source of truth: validation_comparison_spec_v1_4.md.
 */

import { log } from '../../utils/telemetry.js';
import { VALIDATION_PIPELINE_TIMEOUT_MS } from '../../config/timeouts.js';
import type { StageContext } from '../unified-pipeline/types.js';
import type { EdgeV3T, NodeV3T } from '../../schemas/cee-v3.js';
import type { GraphValidationSummary, LintEntry, ValidationMetadata } from './types.js';

import { extractGraphStructureForPass2, isStructuralEdge } from './utils.js';
import { callValidateGraph } from './validate-graph.js';
import { runEnforcementLints } from './enforcement-lints.js';
import { computeBiasOffsets, applyBiasCorrection } from './bias-correction.js';
import { compareEdge, buildMissingPass2Metadata } from './comparison.js';
import { computeDistancesToGoal, edgeDistanceToGoal } from './topology-utils.js';

// ============================================================================
// Graph shape used within the validation pipeline
// ============================================================================

/**
 * Typed view of ctx.graph that the validation pipeline operates on.
 * ctx.graph is typed as GraphV1 (OpenAPI-generated) which lacks V3-specific
 * fields. This interface provides typed access without unsafe casts in the
 * main pipeline logic. The narrowing happens once in `extractGraphFromCtx`.
 */
interface ValidationPipelineGraph {
  nodes: NodeV3T[];
  edges: EdgeV3T[];
  validation_summary?: GraphValidationSummary;
}

/** Safely extract typed node/edge arrays from ctx.graph. */
function extractGraphFromCtx(ctx: StageContext): ValidationPipelineGraph {
  const graph = ctx.graph as Record<string, unknown> | undefined;
  const nodes: NodeV3T[] = Array.isArray(graph?.nodes) ? graph.nodes as NodeV3T[] : [];
  const edges: EdgeV3T[] = Array.isArray(graph?.edges) ? graph.edges as EdgeV3T[] : [];
  return { nodes, edges };
}

/** Write validation_summary back to the graph object. */
function attachSummaryToGraph(ctx: StageContext, summary: GraphValidationSummary): void {
  const graph = ctx.graph as Record<string, unknown> | undefined;
  if (graph) {
    graph.validation_summary = summary;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Runs the full validation pipeline against the current graph in ctx.
 *
 * On success: attaches ValidationMetadata to each causal edge in ctx.graph
 *             and sets ctx.validationSummary + ctx.graph.validation_summary.
 *
 * On failure: throws — caller must catch and continue without metadata.
 */
export async function runValidationPipeline(ctx: StageContext): Promise<void> {
  const startMs = Date.now();
  const requestId = ctx.requestId;

  const vpGraph = extractGraphFromCtx(ctx);
  const rawNodes = vpGraph.nodes;
  const rawEdges = vpGraph.edges;

  // ── 1. Extract minimal graph structure for Pass 2 ─────────────────────────
  const { nodes: p2Nodes, edges: p2Edges } = extractGraphStructureForPass2(
    rawNodes,
    rawEdges,
  );

  log.info(
    {
      event: 'cee.validation_pipeline.started',
      request_id: requestId,
      edge_count: p2Edges.length,
      node_count: p2Nodes.length,
    },
    'cee.validation_pipeline.started',
  );

  // ── 2. Call o4-mini (Pass 2) ──────────────────────────────────────────────
  const pass2StartMs = Date.now();

  log.debug(
    {
      event: 'cee.validation_pipeline.pass2_sent',
      request_id: requestId,
      edge_count: p2Edges.length,
    },
    'cee.validation_pipeline.pass2_sent',
  );

  // Use effectiveBrief (not input.brief) so Pass 2 sees the same brief
  // that Pass 1 used to produce the graph — including refinement context.
  const pass2Response = await callValidateGraph(
    ctx.effectiveBrief,
    p2Nodes,
    p2Edges,
    {
      requestId,
      timeoutMs: VALIDATION_PIPELINE_TIMEOUT_MS,
    },
  );
  const pass2LatencyMs = Date.now() - pass2StartMs;

  log.info(
    {
      event: 'cee.validation_pipeline.pass2_received',
      request_id: requestId,
      edge_count: pass2Response.edges.length,
      latency_ms: pass2LatencyMs,
    },
    'cee.validation_pipeline.pass2_received',
  );

  // ── 3. Enforcement lints ──────────────────────────────────────────────────
  const { edges: lintedEdges, lintLog } = runEnforcementLints(pass2Response.edges);

  // ── 4. Compute bias offsets ───────────────────────────────────────────────
  const causalEdges = rawEdges.filter(
    (e) => !e.edge_type || e.edge_type === 'directed',
  );
  const { offsets: biasOffsets, warnings: biasWarnings } = computeBiasOffsets(
    causalEdges,
    lintedEdges,
  );

  for (const warning of biasWarnings) {
    log.warn({ request_id: requestId, warning }, 'cee.validation_pipeline.bias_warning');
  }

  // ── 5. Apply bias correction ──────────────────────────────────────────────
  const adjustedEdges = applyBiasCorrection(lintedEdges, biasOffsets);

  // ── 6. Build lookup tables ────────────────────────────────────────────────
  const adjustedByKey = new Map<string, typeof adjustedEdges[0]>();
  const lintedByKey = new Map<string, typeof lintedEdges[0]>();
  for (let i = 0; i < adjustedEdges.length; i++) {
    const key = edgeKey(adjustedEdges[i].from, adjustedEdges[i].to);
    adjustedByKey.set(key, adjustedEdges[i]);
    lintedByKey.set(key, lintedEdges[i]);
  }

  const lintsByEdge = new Map<string, LintEntry[]>();
  for (const entry of lintLog) {
    const existing = lintsByEdge.get(entry.edge_key) ?? [];
    existing.push(entry);
    lintsByEdge.set(entry.edge_key, existing);
  }

  // ── 7. Compute distances to goal ──────────────────────────────────────────
  const goalNode = rawNodes.find((n) => n.kind === 'goal');
  const goalNodeId = goalNode ? goalNode.id : '';
  const nodeIds = rawNodes.map((n) => n.id);
  const distances = computeDistancesToGoal(nodeIds, rawEdges, goalNodeId);

  // ── 8. Compare and attach ValidationMetadata to each causal edge ────────
  let contestedCount = 0;
  const lintCorrectionCount = lintLog.length;

  for (const edge of rawEdges) {
    // Skip structural and bidirected edges — they were not sent to Pass 2.
    if (edge.edge_type === 'bidirected') continue;
    if (isStructuralEdge(edge)) continue;

    const key = edgeKey(edge.from, edge.to);
    const p2Adjusted = adjustedByKey.get(key);
    const p2Linted = lintedByKey.get(key);
    const edgeLintLog = lintsByEdge.get(key) ?? [];
    const distToGoal = edgeDistanceToGoal(distances, edge.to);

    let metadata: ValidationMetadata;

    if (p2Adjusted && p2Linted) {
      metadata = compareEdge(edge, p2Linted, p2Adjusted, edgeLintLog, distToGoal);
      metadata.bias_correction = {
        strength_mean_offset: biasOffsets.strength_mean,
        strength_std_offset: biasOffsets.strength_std,
        exists_probability_offset: biasOffsets.exists_probability,
      };
    } else {
      metadata = buildMissingPass2Metadata(edge, distToGoal);
    }

    if (metadata.status === 'contested') contestedCount++;

    // Attach to the edge in-place (passthrough schema preserves it).
    edge.validation = metadata;
  }

  log.debug(
    {
      event: 'cee.validation_pipeline.comparison_complete',
      request_id: requestId,
      contested_count: contestedCount,
      edge_count: adjustedEdges.length,
    },
    'cee.validation_pipeline.comparison_complete',
  );

  // ── 9. Graph-level validation summary ────────────────────────────────────
  const totalLatencyMs = Date.now() - startMs;
  const summary: GraphValidationSummary = {
    model_notes: pass2Response.model_notes,
    total_edges_validated: adjustedEdges.length,
    contested_count: contestedCount,
    bias_offsets: biasOffsets,
    pass2_latency_ms: pass2LatencyMs,
    total_pipeline_latency_ms: totalLatencyMs,
    lint_corrections: lintCorrectionCount,
  };
  // Attach to graph object (serialised into the response via passthrough).
  attachSummaryToGraph(ctx, summary);
  // Mirror on ctx for trace/telemetry access in later stages.
  ctx.validationSummary = summary;

  log.info(
    {
      event: 'cee.validation_pipeline.metadata_attached',
      request_id: requestId,
      edge_count: adjustedEdges.length,
      contested_count: contestedCount,
      latency_ms: totalLatencyMs,
      pass2_latency_ms: pass2LatencyMs,
      lint_corrections: lintCorrectionCount,
    },
    'cee.validation_pipeline.metadata_attached',
  );
}

// ============================================================================
// Private helpers
// ============================================================================

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}
