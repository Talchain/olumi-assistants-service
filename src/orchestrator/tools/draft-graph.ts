/**
 * draft_graph Tool Handler
 *
 * Wraps the existing unified pipeline — does NOT modify it.
 * Calls runUnifiedPipeline() as a function call (same process, not HTTP).
 *
 * Output: GraphPatchBlock (patch_type: 'full_draft', status: 'proposed').
 * Extracts validation_warnings into assistant_text.
 */

import type { FastifyRequest } from "fastify";
import { log } from "../../utils/telemetry.js";
import { runUnifiedPipeline } from "../../cee/unified-pipeline/index.js";
import type { DraftInputWithCeeExtras, UnifiedPipelineOpts } from "../../cee/unified-pipeline/types.js";
import type { ConversationBlock, GraphPatchBlockData, PatchOperation, OrchestratorError } from "../types.js";
import { createGraphPatchBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface DraftGraphResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the draft_graph tool.
 *
 * @param brief - User's decision brief text (min 30 chars)
 * @param request - Fastify request (needed by unified pipeline)
 * @param turnId - Turn ID for block provenance
 * @returns Graph patch block + optional assistant text with warnings
 */
export async function handleDraftGraph(
  brief: string,
  request: FastifyRequest,
  turnId: string,
): Promise<DraftGraphResult> {
  const startTime = Date.now();

  // Build pipeline input
  const input: DraftInputWithCeeExtras = {
    brief,
  };

  const opts: UnifiedPipelineOpts = {
    schemaVersion: 'v3',
  };

  log.info({ brief_length: brief.length, turn_id: turnId }, "draft_graph: starting unified pipeline");

  let pipelineResult;
  try {
    pipelineResult = await runUnifiedPipeline(input, { brief }, request, opts);
  } catch (error) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Draft graph failed: ${error instanceof Error ? error.message : String(error)}`,
      tool: 'draft_graph',
      recoverable: true,
      suggested_retry: 'Try drafting the graph again.',
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
  }

  const latencyMs = Date.now() - startTime;

  // Check for pipeline error responses (non-200 status)
  if (pipelineResult.statusCode !== 200) {
    const body = pipelineResult.body as Record<string, unknown>;
    const message = (body?.error as string) || `Pipeline returned status ${pipelineResult.statusCode}`;
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Draft graph failed: ${message}`,
      tool: 'draft_graph',
      recoverable: pipelineResult.statusCode >= 500,
      suggested_retry: pipelineResult.statusCode >= 500 ? 'Try drafting the graph again.' : undefined,
    };
    throw Object.assign(new Error(message), { orchestratorError: err });
  }

  // Extract graph from pipeline response
  const body = pipelineResult.body as Record<string, unknown>;
  const graph = body.graph ?? body;

  // Build full_draft patch: all nodes and edges as add operations
  const operations = buildFullDraftOps(graph);

  const patchData: GraphPatchBlockData = {
    patch_type: 'full_draft',
    operations,
    status: 'proposed',
  };

  // Extract validation warnings if present
  const warnings = extractWarnings(body);
  let assistantText: string | null = null;
  if (warnings.length > 0) {
    patchData.validation_warnings = warnings;
    assistantText = `The draft graph has ${warnings.length} validation warning${warnings.length > 1 ? 's' : ''}:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
  }

  const block = createGraphPatchBlock(patchData, turnId);

  log.info(
    { elapsed_ms: latencyMs, operations_count: operations.length, warnings_count: warnings.length },
    "draft_graph completed",
  );

  return {
    blocks: [block],
    assistantText,
    latencyMs,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build PatchOperation[] for a full draft (add_node + add_edge for all elements).
 */
function buildFullDraftOps(graph: unknown): PatchOperation[] {
  const ops: PatchOperation[] = [];
  const g = graph as Record<string, unknown>;

  // Add nodes
  const nodes = g.nodes as unknown[] | undefined;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const nodeId = (node as Record<string, unknown>).id as string;
      ops.push({
        op: 'add_node',
        path: `/nodes/${nodeId}`,
        value: node,
      });
    }
  }

  // Add edges
  const edges = g.edges as unknown[] | undefined;
  if (Array.isArray(edges)) {
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i] as Record<string, unknown>;
      const from = edge.from as string;
      const to = edge.to as string;
      ops.push({
        op: 'add_edge',
        path: `/edges/${from}->${to}`,
        value: edge,
      });
    }
  }

  return ops;
}

/**
 * Extract validation warnings from pipeline response body.
 */
function extractWarnings(body: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  // Pipeline may include validation_warnings at top level
  const topLevel = body.validation_warnings;
  if (Array.isArray(topLevel)) {
    for (const w of topLevel) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  // Pipeline may include warnings in debug section
  const debug = body.debug as Record<string, unknown> | undefined;
  if (debug?.warnings && Array.isArray(debug.warnings)) {
    for (const w of debug.warnings) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  return warnings;
}
