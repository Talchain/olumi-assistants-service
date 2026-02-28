/**
 * edit_graph Tool Handler
 *
 * Flow: graph + edit description → LLM call → sanitise → Zod validate →
 *       referential integrity → PLoT validate-patch → repair loop → GraphPatchBlock
 *
 * Orchestrator calls as function (same process).
 * Output: GraphPatchBlock (patch_type: 'edit', status: 'proposed' | 'rejected').
 *
 * Canonical-only: Reject ops with belief, belief_exists, confidence.
 * Map legacy → canonical, log telemetry.
 *
 * CEE is the structural gatekeeper (Zod schema + referential integrity).
 * PLoT is the semantic judge (validate-patch endpoint).
 * CEE never normalises values — no STRP, no strength clamping.
 *
 * PLoT failure policy:
 * - When PLoT is configured (plotClient !== null): PLoT failure is a hard reject.
 *   CEE must not propose semantically unvalidated patches.
 * - When PLoT is not configured (plotClient === null): skip semantic gate entirely.
 *   This is the dev/test path only.
 *
 * "No silent semantics": PLoT repairs are surfaced as repairs_applied on the block,
 * never silently rewritten into the operations array.
 */

import { createHash } from "node:crypto";
import { log } from "../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import { config } from "../../config/index.js";
import { getSystemPrompt, getSystemPromptMeta } from "../../adapters/llm/prompt-loader.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import type {
  ConversationBlock,
  ConversationContext,
  GraphPatchBlockData,
  GraphV3T,
  PatchOperation,
  OrchestratorError,
  RepairEntry,
} from "../types.js";
import type { PLoTClient, ValidatePatchResult, PLoTClientRunOpts } from "../plot-client.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { serialiseEditContextForLLM } from "../context/serialise.js";
import {
  validatePatchOperations,
  formatPatchValidationErrors,
  type PatchValidationResult,
} from "../patch-validation.js";

// ============================================================================
// Types
// ============================================================================

export interface EditGraphResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
}

export interface EditGraphOpts {
  /** PLoT client for semantic validation. If null, PLoT gate is skipped (dev/test only). */
  plotClient?: PLoTClient | null;
  /** Max repair retries on structural/PLoT failure. Defaults to config.cee.maxRepairRetries. */
  maxRetries?: number;
  /** Turn budget opts forwarded to PLoT client for budget-aware retry. */
  plotOpts?: PLoTClientRunOpts;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of operations per patch. Configurable via MAX_PATCH_OPERATIONS env var, default 15. */
function getMaxPatchOperations(): number {
  return config.cee.maxPatchOperations;
}

// ============================================================================
// Legacy Field Detection
// ============================================================================

const LEGACY_FIELDS = new Set(['belief', 'belief_exists', 'confidence']);

/**
 * Check operations for legacy fields and log telemetry.
 * Returns cleaned operations with legacy fields removed.
 */
function sanitiseOperations(operations: PatchOperation[]): PatchOperation[] {
  let legacyCount = 0;

  const cleaned = operations.map((op) => {
    if (op.value && typeof op.value === 'object') {
      const value = { ...(op.value as Record<string, unknown>) };
      let modified = false;

      for (const field of LEGACY_FIELDS) {
        if (field in value) {
          delete value[field];
          legacyCount++;
          modified = true;
        }
      }

      if (modified) {
        return { ...op, value };
      }
    }
    return op;
  });

  if (legacyCount > 0) {
    log.info(
      { legacy_fields_removed: legacyCount },
      "edit_graph: removed legacy fields from operations",
    );
  }

  return cleaned;
}

// ============================================================================
// Populate old_value for undo data capture
// ============================================================================

/**
 * Populate `old_value` on update/remove operations by looking up the current
 * state from the graph. Enables undo and audit trail.
 *
 * - remove_node: old_value = full node object
 * - update_node: old_value = { fields being changed with current values }
 * - remove_edge: old_value = full edge object
 * - update_edge: old_value = { fields being changed with current values }
 *
 * Does NOT overwrite old_value if the LLM already provided it.
 */
function populateOldValues(
  operations: PatchOperation[],
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
): PatchOperation[] {
  const nodeMap = new Map(
    graph.nodes.map((n) => [n.id as string, n]),
  );
  const edgeMap = new Map(
    graph.edges.map((e) => [`${e.from}::${e.to}`, e]),
  );

  return operations.map((op) => {
    // Skip if old_value is already set
    if (op.old_value !== undefined) return op;

    switch (op.op) {
      case 'remove_node': {
        const node = nodeMap.get(op.path);
        if (node) return { ...op, old_value: node };
        break;
      }
      case 'update_node': {
        const node = nodeMap.get(op.path);
        if (node && op.value && typeof op.value === 'object') {
          const prev: Record<string, unknown> = {};
          for (const key of Object.keys(op.value as Record<string, unknown>)) {
            if (key in node) prev[key] = node[key];
          }
          if (Object.keys(prev).length > 0) return { ...op, old_value: prev };
        }
        break;
      }
      case 'remove_edge': {
        const edge = edgeMap.get(op.path);
        if (edge) return { ...op, old_value: edge };
        break;
      }
      case 'update_edge': {
        const edge = edgeMap.get(op.path);
        if (edge && op.value && typeof op.value === 'object') {
          const prev: Record<string, unknown> = {};
          for (const key of Object.keys(op.value as Record<string, unknown>)) {
            if (key in edge) prev[key] = edge[key];
          }
          if (Object.keys(prev).length > 0) return { ...op, old_value: prev };
        }
        break;
      }
      default:
        break;
    }

    return op;
  });
}

// ============================================================================
// PLoT Field Mapping
// ============================================================================

/**
 * Map CEE PatchOperation[] to PLoT's expected field names.
 * CEE uses `old_value`; PLoT uses `previous`.
 */
function mapOpsForPlot(ops: PatchOperation[]): Record<string, unknown>[] {
  return ops.map(op => {
    const mapped: Record<string, unknown> = {
      op: op.op,
      path: op.path,
    };
    if (op.value !== undefined) mapped.value = op.value;
    if (op.old_value !== undefined) mapped.previous = op.old_value;
    return mapped;
  });
}

// ============================================================================
// Graph Hash
// ============================================================================

/**
 * Compute a short SHA-256 hash of the input graph for optimistic concurrency audit trail.
 */
function computeGraphHash(graph: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(graph))
    .digest('hex')
    .substring(0, 16);
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the edit_graph tool.
 *
 * @param context - Conversation context (must have graph)
 * @param editDescription - Natural language description of the edit
 * @param adapter - LLM adapter for generating edit operations
 * @param requestId - Request ID for tracing
 * @param turnId - Turn ID for block provenance
 * @param opts - Optional PLoT client and retry configuration
 * @returns GraphPatchBlock with edit operations
 */
export async function handleEditGraph(
  context: ConversationContext,
  editDescription: string,
  adapter: LLMAdapter,
  requestId: string,
  turnId: string,
  opts?: EditGraphOpts,
): Promise<EditGraphResult> {
  if (!context.graph) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Cannot edit graph: no graph in context. Draft a graph first.',
      tool: 'edit_graph',
      recoverable: false,
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  const startTime = Date.now();
  const maxRetries = opts?.maxRetries ?? config.cee.maxRepairRetries;
  const plotClient = opts?.plotClient ?? null;
  const baseGraphHash = computeGraphHash(context.graph);

  // Load system prompt from prompt store (3-tier: cache → Supabase → hardcoded default)
  const systemPrompt = await getSystemPrompt('edit_graph');

  // Capture prompt metadata for telemetry/debugging
  let promptMeta: ReturnType<typeof getSystemPromptMeta> | undefined;
  try {
    promptMeta = getSystemPromptMeta('edit_graph');
  } catch {
    // Non-fatal — metadata is for observability only
  }

  if (promptMeta) {
    log.info(
      {
        request_id: requestId,
        prompt_source: promptMeta.source,
        prompt_version: promptMeta.prompt_version,
        prompt_hash: promptMeta.prompt_hash,
        cache_status: promptMeta.cache_status,
      },
      "edit_graph prompt loaded",
    );
  }

  // Build context section for LLM (edit compact graph + framing + analysis + selected elements)
  const contextSection = serialiseEditContextForLLM(context);

  // Combine system prompt with serialised context
  const fullSystemPrompt = `${systemPrompt}\n\n${contextSection}`;

  const callOpts: CallOpts = {
    requestId,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  };

  // ---- Attempt loop: LLM call → validate → PLoT → repair ----
  const totalAttempts = maxRetries + 1;
  let lastValidationResult: PatchValidationResult | undefined;
  let lastPlotErrors: string | undefined;
  let lastRawOps: unknown[] | undefined;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const isRepair = attempt > 1;

    // Build the user message
    let userMessage: string;
    if (!isRepair) {
      userMessage = editDescription;
    } else {
      // Repair: include previous errors
      const errorSummary = lastValidationResult && !lastValidationResult.valid
        ? formatPatchValidationErrors(lastValidationResult)
        : lastPlotErrors ?? 'Unknown validation failure';

      userMessage = [
        `Attempt ${attempt} of ${totalAttempts}. Fix the following errors:`,
        '',
        '## Validation Errors',
        errorSummary,
        '',
        '## Original Edit Request',
        editDescription,
        '',
        '## Previous (Invalid) Operations',
        JSON.stringify(lastRawOps ?? [], null, 2),
      ].join('\n');
    }

    // LLM call
    let chatResult;
    try {
      chatResult = await adapter.chat(
        {
          system: isRepair
            ? (await getSystemPrompt('repair_edit_graph')) + '\n\n' + contextSection
            : fullSystemPrompt,
          userMessage,
        },
        callOpts,
      );
    } catch (error) {
      // On last attempt, propagate LLM error
      if (attempt === totalAttempts) {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: `Edit graph LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
          tool: 'edit_graph',
          recoverable: true,
          suggested_retry: 'Try describing the edit again.',
        };
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
      }
      log.warn(
        { request_id: requestId, attempt, error: error instanceof Error ? error.message : String(error) },
        "edit_graph LLM call failed, will retry",
      );
      continue;
    }

    // Parse operations from LLM response
    let rawOps: unknown[];
    try {
      rawOps = parseRawOperations(chatResult.content);
    } catch (error) {
      if (attempt === totalAttempts) {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: `Failed to parse edit operations from LLM response: ${error instanceof Error ? error.message : String(error)}`,
          tool: 'edit_graph',
          recoverable: true,
          suggested_retry: 'Try describing the edit more clearly.',
        };
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
      }
      log.warn(
        { request_id: requestId, attempt, error: error instanceof Error ? error.message : String(error) },
        "edit_graph parse failed, will retry",
      );
      lastRawOps = [];
      lastValidationResult = { valid: false, operations: [], zodErrors: undefined, referentialErrors: [{ index: 0, op: 'unknown', path: '', message: error instanceof Error ? error.message : String(error) }] };
      continue;
    }

    lastRawOps = rawOps;

    // Guard: reject oversized operation arrays before expensive validation
    const maxOps = getMaxPatchOperations();
    if (rawOps.length > maxOps) {
      const msg = `Patch contains ${rawOps.length} operations (max ${maxOps}). Reduce the scope of the edit.`;
      log.warn(
        { request_id: requestId, attempt, operations_count: rawOps.length, max: maxOps },
        "edit_graph rejected — too many operations",
      );
      if (attempt === totalAttempts) {
        return buildRejectionResult(msg, rawOps as PatchOperation[], baseGraphHash, turnId, startTime, 'MAX_OPERATIONS_EXCEEDED', undefined, attempt);
      }
      lastValidationResult = { valid: false, operations: [], referentialErrors: [{ index: 0, op: 'batch', path: '', message: msg }] };
      continue;
    }

    // Step 1: Zod schema validation + referential integrity
    const graph = context.graph as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
    const validationResult = validatePatchOperations(rawOps, graph);
    lastValidationResult = validationResult;

    if (!validationResult.valid) {
      log.warn(
        {
          request_id: requestId,
          attempt,
          zod_errors: validationResult.zodErrors?.issues.length ?? 0,
          ref_errors: validationResult.referentialErrors?.length ?? 0,
        },
        "edit_graph structural validation failed",
      );

      if (attempt === totalAttempts) {
        // All attempts exhausted — return rejection block
        return buildRejectionResult(
          `Structural validation failed after ${totalAttempts} attempts: ${formatPatchValidationErrors(validationResult)}`,
          rawOps as PatchOperation[],
          baseGraphHash,
          turnId,
          startTime,
          'STRUCTURAL_VALIDATION_FAILED',
          undefined,
          attempt,
        );
      }
      continue;
    }

    // Sanitise: remove legacy fields
    let operations = sanitiseOperations(validationResult.operations as PatchOperation[]);

    // Populate old_value for undo data capture (before PLoT submission)
    operations = populateOldValues(
      operations,
      context.graph as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
    );

    // Step 2: PLoT semantic validation (if client configured)
    let repairsApplied: RepairEntry[] | undefined;
    let appliedGraph: GraphV3T | undefined;
    let appliedGraphHash: string | undefined;
    let plotWarnings: string[] | undefined;
    const allWarnings: string[] = [];

    if (plotClient) {
      try {
        const plotPayload: Record<string, unknown> = {
          graph: context.graph,
          operations: mapOpsForPlot(operations),
          scenario_id: context.scenario_id,
          base_graph_hash: baseGraphHash,
        };

        const plotResult: ValidatePatchResult = await plotClient.validatePatch(plotPayload, requestId, opts?.plotOpts);

        // FEATURE_DISABLED (501) → skip semantic validation with warning (same as PLoT not configured)
        if (plotResult.kind === 'feature_disabled') {
          log.info(
            { request_id: requestId, attempt },
            "edit_graph PLoT validate-patch FEATURE_DISABLED — skipping semantic validation",
          );
          allWarnings.push('PLOT_VALIDATION_SKIPPED: PLoT validate-patch not available — semantic validation skipped');
          // Fall through to success path (no semantic gate)
        } else if (plotResult.kind === 'rejection') {
          // 422 structured rejection — patch is semantically invalid
          const reason = plotResult.message ?? 'Semantic validation rejected by PLoT';
          const plotCode = plotResult.code;
          const plotViolations = plotResult.violations;

          log.warn(
            { request_id: requestId, attempt, reason, plot_code: plotCode },
            "edit_graph PLoT rejected patch",
          );

          if (attempt === totalAttempts) {
            return buildRejectionResult(
              reason,
              operations,
              baseGraphHash,
              turnId,
              startTime,
              'PLOT_SEMANTIC_REJECTED',
              { plot_code: plotCode, plot_violations: plotViolations },
              attempt,
            );
          }

          lastPlotErrors = reason;
          lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: reason }] };
          continue;
        } else {
          // Success — extract response fields
          const plotResponse = plotResult.data;

          // Check verdict field for backwards compatibility with older PLoT versions
          const verdict = plotResponse.verdict as string | undefined;
          if (verdict === 'rejected') {
            const reason = (plotResponse.reason as string) ?? 'Semantic validation rejected by PLoT';
            const plotCode = typeof plotResponse.code === 'string' ? plotResponse.code : undefined;
            const plotViolations = Array.isArray(plotResponse.violations) ? plotResponse.violations : undefined;

            log.warn(
              { request_id: requestId, attempt, verdict, reason, plot_code: plotCode },
              "edit_graph PLoT rejected patch (verdict field)",
            );

            if (attempt === totalAttempts) {
              return buildRejectionResult(
                reason,
                operations,
                baseGraphHash,
                turnId,
                startTime,
                'PLOT_SEMANTIC_REJECTED',
                { plot_code: plotCode, plot_violations: plotViolations },
                attempt,
              );
            }

            lastPlotErrors = reason;
            lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: reason }] };
            continue;
          }

          // Capture PLoT repairs (surfaced as-is, never rewritten into operations)
          if (plotResponse.repairs_applied && Array.isArray(plotResponse.repairs_applied) && plotResponse.repairs_applied.length > 0) {
            repairsApplied = plotResponse.repairs_applied as RepairEntry[];
            log.info(
              { request_id: requestId, repairs_count: repairsApplied.length },
              "edit_graph PLoT applied repairs",
            );
          }

          // Capture applied_graph and its hash from PLoT response
          if (plotResponse.applied_graph && typeof plotResponse.applied_graph === 'object') {
            appliedGraph = plotResponse.applied_graph as GraphV3T;
            // Prefer PLoT's canonical hash; fall back to local computation
            appliedGraphHash = typeof plotResponse.graph_hash === 'string'
              ? plotResponse.graph_hash
              : computeGraphHash(appliedGraph);
            log.info(
              { request_id: requestId, applied_graph_hash: appliedGraphHash, hash_source: typeof plotResponse.graph_hash === 'string' ? 'plot' : 'local' },
              "edit_graph PLoT returned applied graph",
            );
          }

          // Surface PLoT warnings in block data
          if (plotResponse.warnings && Array.isArray(plotResponse.warnings) && plotResponse.warnings.length > 0) {
            plotWarnings = plotResponse.warnings.map((w: unknown) =>
              typeof w === 'string' ? w : typeof w === 'object' && w !== null && 'message' in w ? String((w as { message: unknown }).message) : JSON.stringify(w),
            );
          }
        }
      } catch (plotError) {
        // PLoT configured but failed — hard reject (CEE must not propose semantically unvalidated patches)
        const errorMessage = plotError instanceof Error ? plotError.message : String(plotError);

        log.error(
          {
            request_id: requestId,
            attempt,
            error: errorMessage,
          },
          "edit_graph PLoT validation failed — rejecting patch (semantic gate required)",
        );

        if (attempt === totalAttempts) {
          return buildRejectionResult(
            `PLoT semantic validation unavailable: ${errorMessage}`,
            operations,
            baseGraphHash,
            turnId,
            startTime,
            'PLOT_UNAVAILABLE',
            undefined,
            attempt,
          );
        }

        lastPlotErrors = `PLoT unavailable: ${errorMessage}`;
        lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: `PLoT unavailable: ${errorMessage}` }] };
        continue;
      }
    }

    // ---- Success: build block ----
    const latencyMs = Date.now() - startTime;

    // Collect validation warnings: PLoT warnings + skip notice
    if (plotWarnings) {
      allWarnings.push(...plotWarnings);
    }
    if (!plotClient) {
      allWarnings.push('PLOT_VALIDATION_SKIPPED: PLoT was unavailable — this patch has not been canonically validated');
    }

    const patchData: GraphPatchBlockData = {
      patch_type: 'edit',
      operations,
      status: 'proposed',
      base_graph_hash: baseGraphHash,
      ...(appliedGraph && { applied_graph: appliedGraph }),
      ...(appliedGraphHash && { applied_graph_hash: appliedGraphHash }),
      ...(repairsApplied && repairsApplied.length > 0 && { repairs_applied: repairsApplied }),
      ...(allWarnings.length > 0 && { validation_warnings: allWarnings }),
    };

    const block = createGraphPatchBlock(patchData, turnId);

    log.info(
      {
        elapsed_ms: latencyMs,
        operations_count: operations.length,
        attempts: attempt,
        plot_validated: !!plotClient,
        repairs_applied: repairsApplied?.length ?? 0,
        applied_graph_hash: appliedGraphHash,
        ...(promptMeta && {
          prompt_source: promptMeta.source,
          prompt_version: promptMeta.prompt_version,
        }),
      },
      "edit_graph completed",
    );

    // Build assistant text: narrate only if PLoT repairs materially differ
    let assistantText: string | null = null;
    if (repairsApplied && repairsApplied.length > 0) {
      const repairSummary = repairsApplied
        .map(r => `- ${r.message}`)
        .join('\n');
      assistantText = `I've proposed the graph edits you requested. PLoT applied ${repairsApplied.length} repair(s) to ensure semantic consistency:\n${repairSummary}`;
    }

    return {
      blocks: [block],
      assistantText,
      latencyMs,
    };
  }

  // Should never reach here — final attempt returns rejection or throws
  const err: OrchestratorError = {
    code: 'TOOL_EXECUTION_FAILED',
    message: 'Edit graph exhausted all attempts without resolution.',
    tool: 'edit_graph',
    recoverable: true,
    suggested_retry: 'Try describing the edit again.',
  };
  throw Object.assign(new Error(err.message), { orchestratorError: err });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a rejection result when all repair attempts are exhausted.
 */
function buildRejectionResult(
  reason: string,
  operations: PatchOperation[],
  baseGraphHash: string,
  turnId: string,
  startTime: number,
  code?: string,
  plotDetails?: { plot_code?: string; plot_violations?: unknown[] },
  attempts?: number,
): EditGraphResult {
  const patchData: GraphPatchBlockData = {
    patch_type: 'edit',
    operations,
    status: 'rejected',
    base_graph_hash: baseGraphHash,
    rejection: {
      reason,
      ...(code && { code }),
      ...(plotDetails?.plot_code && { plot_code: plotDetails.plot_code }),
      ...(plotDetails?.plot_violations && plotDetails.plot_violations.length > 0 && { plot_violations: plotDetails.plot_violations }),
      ...(attempts != null && { attempts }),
    },
  };

  const block = createGraphPatchBlock(patchData, turnId);
  const latencyMs = Date.now() - startTime;

  log.warn(
    { elapsed_ms: latencyMs, reason },
    "edit_graph rejected — all attempts exhausted",
  );

  return {
    blocks: [block],
    assistantText: `I wasn't able to produce valid graph edits. ${reason}`,
    latencyMs,
  };
}

/**
 * Parse raw operation objects from LLM response text.
 * Expects JSON array of operation objects, possibly wrapped in markdown.
 */
function parseRawOperations(text: string): unknown[] {
  // Extract JSON array from response (may be wrapped in markdown)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON array found in LLM response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Parsed response is not an array');
  }

  return parsed;
}
