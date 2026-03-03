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
import type { ConversationBlock, GraphPatchBlockData, PatchOperation, OrchestratorError, GraphV3T } from "../types.js";
import { createGraphPatchBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

/** CEEStructuralWarningV1 shape (from generated OpenAPI) */
export interface CEEDraftWarning {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'blocker';
  affected_node_ids?: string[];
  affected_edge_ids?: string[];
  explanation?: string;
  fix_hint?: string;
  /** Legacy fields */
  node_ids?: string[];
  edge_ids?: string[];
}

export interface DraftGraphResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** Coaching context for Phase 3 LLM narration (coaching.summary + strengthen_items) */
  narrationHint?: string;
  /** Structured draft warnings from the pipeline (CEEStructuralWarningV1[]) */
  draftWarnings: CEEDraftWarning[];
  /** The drafted graph, for post-draft structural analysis */
  graphOutput: GraphV3T | null;
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
    auto_apply: true,
  };

  // Extract coaching summary for narration hint (brief: include in assistantText)
  const coachingSummary = extractCoachingSummary(body);

  // Extract validation warnings if present (plain strings for assistantText / validation_warnings)
  const warnings = extractWarnings(body);
  if (warnings.length > 0) {
    patchData.validation_warnings = warnings;
  }

  // Extract structured draft warnings for guidance generation
  const draftWarnings = extractStructuredWarnings(body);

  // Build narration_hint from coaching data (for Phase 3 LLM context)
  const narrationHint = coachingSummary ?? undefined;

  // Build assistantText: warnings take priority; coaching summary used as narration hint only
  let assistantText: string | null = null;
  if (warnings.length > 0) {
    assistantText = `The draft graph has ${warnings.length} validation warning${warnings.length > 1 ? 's' : ''}:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
  }

  // Extract the graph output for post-draft structural analysis
  const graphOutput = isGraphV3(graph) ? graph as GraphV3T : null;

  const block = createGraphPatchBlock(patchData, turnId);

  log.info(
    {
      elapsed_ms: latencyMs,
      operations_count: operations.length,
      warnings_count: warnings.length,
      structured_warnings_count: draftWarnings.length,
      has_coaching: coachingSummary !== null,
    },
    "draft_graph completed",
  );

  return {
    blocks: [block],
    assistantText,
    latencyMs,
    narrationHint,
    draftWarnings,
    graphOutput,
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
 * Check if an unknown value is a GraphV3T-compatible object (has nodes and edges arrays).
 */
function isGraphV3(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  return Array.isArray(g.nodes) && Array.isArray(g.edges);
}

/**
 * Extract structured draft warnings (CEEStructuralWarningV1[]) from pipeline response body.
 * Reads body.draft_warnings — an array of typed warning objects.
 */
function extractStructuredWarnings(body: Record<string, unknown>): CEEDraftWarning[] {
  const raw = body.draft_warnings;
  if (!Array.isArray(raw)) return [];

  const warnings: CEEDraftWarning[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const obj = w as Record<string, unknown>;
    if (typeof obj.id !== 'string' || typeof obj.severity !== 'string') continue;
    warnings.push({
      id: obj.id,
      severity: obj.severity as CEEDraftWarning['severity'],
      affected_node_ids: Array.isArray(obj.affected_node_ids) ? obj.affected_node_ids.filter((x): x is string => typeof x === 'string') : undefined,
      affected_edge_ids: Array.isArray(obj.affected_edge_ids) ? obj.affected_edge_ids.filter((x): x is string => typeof x === 'string') : undefined,
      explanation: typeof obj.explanation === 'string' ? obj.explanation : undefined,
      fix_hint: typeof obj.fix_hint === 'string' ? obj.fix_hint : undefined,
      node_ids: Array.isArray(obj.node_ids) ? obj.node_ids.filter((x): x is string => typeof x === 'string') : undefined,
      edge_ids: Array.isArray(obj.edge_ids) ? obj.edge_ids.filter((x): x is string => typeof x === 'string') : undefined,
    });
  }
  return warnings;
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

/**
 * Extract coaching summary and strengthen_items from pipeline response body.
 * Returns a formatted narration hint string, or null if coaching data is absent.
 */
function extractCoachingSummary(body: Record<string, unknown>): string | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;

  const parts: string[] = [];

  const summary = coaching.summary;
  if (typeof summary === 'string' && summary.length > 0) {
    parts.push(summary);
  }

  const strengthen = coaching.strengthen_items;
  if (Array.isArray(strengthen) && strengthen.length > 0) {
    const items = strengthen
      .filter((item): item is string => typeof item === 'string')
      .map((item) => `- ${item}`);
    if (items.length > 0) {
      parts.push('Strengthen: ' + items.join(', '));
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
