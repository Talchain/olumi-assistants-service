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
import { AnalysisReadyPayload } from "../../schemas/analysis-ready.js";

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

  // Extract analysis_ready from pipeline response (present in V3 schema responses)
  const analysisReady = extractAnalysisReady(body);
  if (analysisReady) {
    patchData.analysis_ready = analysisReady;
  }

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

/**
 * Extract analysis_ready payload from pipeline response body.
 * Present when the unified pipeline produces a V3 schema response with
 * options, interventions, and goal_node_id.
 *
 * Sets status: 'ready' on every option (pipeline has resolved interventions
 * for full_draft, so this is always valid).
 *
 * Validates the constructed payload against AnalysisReadyPayload before returning.
 * Returns undefined (not a malformed payload) if validation fails.
 */
export function extractAnalysisReady(
  body: Record<string, unknown>,
): GraphPatchBlockData['analysis_ready'] | undefined {
  const ar = body.analysis_ready as Record<string, unknown> | undefined;
  if (!ar || typeof ar !== 'object') {
    log.info({ omission_reason: 'not_in_pipeline_body', body_keys: Object.keys(body) }, 'analysis_ready absent from pipeline body');
    return undefined;
  }

  const arKeys = Object.keys(ar);

  const goalNodeId = ar.goal_node_id;
  if (typeof goalNodeId !== 'string') {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'goal_node_id', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid goal_node_id');
    return undefined;
  }

  const status = ar.status;
  if (typeof status !== 'string') {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'status', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid status');
    return undefined;
  }

  const rawOptions = ar.options;
  if (!Array.isArray(rawOptions)) {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'options', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid options array');
    return undefined;
  }

  // Build options for the contract (outward contract uses option_id, not id)
  const options: Array<{ option_id: string; label: string; status: string; interventions: Record<string, number> }> = [];
  for (const opt of rawOptions) {
    if (!opt || typeof opt !== 'object') continue;
    const o = opt as Record<string, unknown>;
    // OptionForAnalysis schema uses `id`, not `option_id`
    const optionId = (o.id ?? o.option_id) as unknown;
    const label = o.label;
    const intv = o.interventions;
    if (typeof optionId !== 'string' || typeof label !== 'string') continue;
    if (!intv || typeof intv !== 'object') continue;

    // Flatten intervention values: { fac_id: 0.5 } or { fac_id: { value: 0.5 } }
    const flat: Record<string, number> = {};
    for (const [key, val] of Object.entries(intv as Record<string, unknown>)) {
      if (typeof val === 'number') {
        flat[key] = val;
      } else if (val && typeof val === 'object' && 'value' in val) {
        const v = (val as Record<string, unknown>).value;
        if (typeof v === 'number') flat[key] = v;
      }
    }

    options.push({ option_id: optionId, label: label as string, status: 'ready', interventions: flat });
  }

  if (options.length === 0) {
    log.warn({ omission_reason: 'contract_validation_failed', raw_option_count: rawOptions.length }, 'analysis_ready has no valid options after filtering');
    return undefined;
  }

  const payload = {
    options,
    goal_node_id: goalNodeId,
    status,
    blockers: Array.isArray(ar.blockers) ? ar.blockers : undefined,
    model_adjustments: Array.isArray(ar.model_adjustments) ? ar.model_adjustments : undefined,
    goal_threshold: typeof ar.goal_threshold === 'number' ? ar.goal_threshold : undefined,
  };

  // Validate against AnalysisReadyPayload contract before emitting.
  // The schema expects `id` on options (OptionForAnalysis), but the outward contract
  // uses `option_id`. Re-map for validation, then return the option_id version.
  const forValidation = {
    ...payload,
    options: payload.options.map(o => ({
      id: o.option_id,
      label: o.label,
      status: o.status,
      interventions: o.interventions,
    })),
  };

  const result = AnalysisReadyPayload.safeParse(forValidation);
  if (!result.success) {
    log.warn(
      {
        errors_flat: result.error.flatten(),
        error_paths: result.error.issues.slice(0, 3).map(i => ({ path: i.path, message: i.message })),
        body_keys: Object.keys(body),
        omission_reason: 'contract_validation_failed',
      },
      'analysis_ready failed contract validation, omitting from block',
    );
    return undefined;
  }

  return payload;
}
