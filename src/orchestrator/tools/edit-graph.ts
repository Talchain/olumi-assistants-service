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
import { getMaxTokensFromConfig } from "../../adapters/llm/router.js";
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
import { applyPatchOperations, PatchApplyError } from "../patch-applier.js";
import { validateGraphStructure, VIOLATION_MESSAGES } from "../graph-structure-validator.js";
import { buildPatchRejectionEnvelope, type PatchRejectionContext } from "../patch-rejection-helper.js";
import { computeStructuralReadiness } from "./analysis-ready-helper.js";

// ============================================================================
// Types
// ============================================================================

export interface EditGraphResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** The applied graph from PLoT (post-edit), or null if rejected / PLoT not configured. */
  appliedGraph: GraphV3T | null;
  /** True if the edit was rejected (structural or semantic). */
  wasRejected: boolean;
  /** Suggested actions (e.g. "Re-run analysis" when rerun_recommended). */
  suggestedActions?: Array<{ label: string; prompt: string; role: 'facilitator' | 'challenger' }>;
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
// Edit Graph LLM Result Types (v2 prompt output shape)
// ============================================================================

/** Per-operation metadata from the v2 prompt (not part of canonical PatchOperation). */
export interface EditGraphOperationMeta {
  impact: 'low' | 'moderate' | 'high';
  rationale: string;
}

/** Advisory metadata for edges removed as a consequence of node removal. */
export interface RemovedEdgeInfo {
  from: string;
  to: string;
  reason: string;
}

/** Coaching output from the v2 prompt. */
export interface EditGraphCoaching {
  summary: string;
  rerun_recommended: boolean;
}

/** Parsed result from the v2 edit_graph LLM response. */
export interface EditGraphLLMResult {
  operations: Array<PatchOperation & { impact?: string; rationale?: string }>;
  removed_edges: RemovedEdgeInfo[];
  warnings: string[];
  coaching: EditGraphCoaching | null;
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
          maxTokens: getMaxTokensFromConfig('edit_graph'),
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

    // Parse operations from LLM response (v2 object or legacy array)
    let llmResult: EditGraphLLMResult;
    try {
      llmResult = parseEditGraphResponse(chatResult.content);
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

    // Handle empty operations (no-op: conflict, forbidden edge, already-satisfied)
    if (llmResult.operations.length === 0) {
      const latencyMs = Date.now() - startTime;

      // Build assistant text: warnings first, then coaching.summary
      const parts: string[] = [];
      if (llmResult.warnings.length > 0) {
        parts.push(llmResult.warnings.join(' '));
      }
      if (llmResult.coaching?.summary) {
        parts.push(llmResult.coaching.summary);
      }
      const assistantText = parts.join('\n\n') || 'No changes were needed for this request.';

      log.info(
        { request_id: requestId, attempt, warnings: llmResult.warnings.length, has_coaching: !!llmResult.coaching },
        "edit_graph returned empty operations (no-op)",
      );

      return {
        blocks: [],
        assistantText,
        latencyMs,
        appliedGraph: null,
        wasRejected: false,
      };
    }

    // Strip impact/rationale from operations for the validation pipeline
    const { operations: strippedOps, meta: operationMeta } = stripOperationMeta(llmResult.operations);
    const rawOps: unknown[] = strippedOps;
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

    // Step 1.5: Strip no-ops and enforce complexity budget (cf-v11.1)
    const strippedForBudget = stripNoOps(operations);

    if (config.cee.patchBudgetEnabled) {
      const budgetResult = checkPatchBudget(strippedForBudget);
      if (!budgetResult.allowed) {
        log.warn(
          { request_id: requestId, attempt, node_ops: budgetResult.nodeOps, edge_ops: budgetResult.edgeOps },
          'edit_graph rejected — complexity budget exceeded',
        );
        const rejectionCtx: PatchRejectionContext = {
          reason: 'budget_exceeded',
          detail: 'Consider breaking this into smaller steps, or rebuilding the model from an updated brief.',
          node_ops: budgetResult.nodeOps,
          edge_ops: budgetResult.edgeOps,
          suggested_actions: [
            { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
            { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
          ],
        };
        const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
        return {
          blocks: [],
          assistantText: envelope.assistant_text,
          latencyMs: Date.now() - startTime,
          appliedGraph: null,
          wasRejected: true,
          suggestedActions: envelope.suggested_actions?.map((a) => ({ label: a.label, prompt: a.prompt, role: a.role })),
        };
      }
    }

    // Step 1.6: Pre-validation — apply patch to candidate graph and validate structure
    let candidateGraph: GraphV3T | undefined;

    if (config.cee.patchPreValidationEnabled) {
      try {
        candidateGraph = applyPatchOperations(context.graph as GraphV3T, operations);
      } catch (applyErr) {
        if (applyErr instanceof PatchApplyError) {
          log.warn(
            { request_id: requestId, attempt, code: applyErr.code, error: applyErr.message },
            'edit_graph rejected — patch apply error',
          );
          const rejectionCtx: PatchRejectionContext = {
            reason: 'structural_violation',
            detail: 'Try a different approach to the change.',
            violations: [applyErr.message],
            suggested_actions: [
              { role: 'facilitator', label: 'Simplify the change', prompt: 'Try a simpler version of this change.' },
            ],
          };
          const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
          return {
            blocks: [],
            assistantText: envelope.assistant_text,
            latencyMs: Date.now() - startTime,
            appliedGraph: null,
            wasRejected: true,
            suggestedActions: envelope.suggested_actions?.map((a) => ({ label: a.label, prompt: a.prompt, role: a.role })),
          };
        }
        throw applyErr;
      }

      const structResult = validateGraphStructure(candidateGraph);
      if (!structResult.valid) {
        const translatedViolations = structResult.violations.map(
          (v) => VIOLATION_MESSAGES[v.code] ?? v.detail,
        );
        log.warn(
          { request_id: requestId, attempt, violations: structResult.violations.map((v) => v.code) },
          'edit_graph rejected — structural validation failed',
        );
        const rejectionCtx: PatchRejectionContext = {
          reason: 'structural_violation',
          detail: 'Consider simplifying the change or approaching it differently.',
          violations: translatedViolations,
          suggested_actions: [
            { role: 'facilitator', label: 'Simplify the change', prompt: 'Try a simpler version of this change.' },
            { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
          ],
        };
        const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
        return {
          blocks: [],
          assistantText: envelope.assistant_text,
          latencyMs: Date.now() - startTime,
          appliedGraph: null,
          wasRejected: true,
          suggestedActions: envelope.suggested_actions?.map((a) => ({ label: a.label, prompt: a.prompt, role: a.role })),
        };
      }
    }

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

    // Collect validation warnings: LLM warnings + PLoT warnings + skip notice
    if (llmResult.warnings.length > 0) {
      allWarnings.push(...llmResult.warnings);
    }
    if (plotWarnings) {
      allWarnings.push(...plotWarnings);
    }
    if (!plotClient) {
      allWarnings.push('PLOT_VALIDATION_SKIPPED: PLoT was unavailable — this patch has not been canonically validated');
    }

    // Compute analysis_ready from post-patch graph (single candidate graph flow)
    const readinessGraph = appliedGraph ?? candidateGraph;
    const analysisReady = readinessGraph ? computeStructuralReadiness(readinessGraph) : undefined;

    const patchData: GraphPatchBlockData = {
      patch_type: 'edit',
      operations,
      status: 'proposed',
      auto_apply: false,
      base_graph_hash: baseGraphHash,
      ...(appliedGraph && { applied_graph: appliedGraph }),
      ...(appliedGraphHash && { applied_graph_hash: appliedGraphHash }),
      ...(repairsApplied && repairsApplied.length > 0 && { repairs_applied: repairsApplied }),
      ...(allWarnings.length > 0 && { validation_warnings: allWarnings }),
      ...(analysisReady && { analysis_ready: analysisReady }),
    };

    const block = createGraphPatchBlock(patchData, turnId);

    // Store per-operation metadata and removed_edges in block debug payload
    // (not part of GraphPatchBlockData — attached to provenance for observability)
    const debugMeta: Record<string, unknown> = {};
    if (operationMeta.some(m => m.impact !== 'low' || m.rationale !== '')) {
      debugMeta.operation_meta = operationMeta;
    }
    if (llmResult.removed_edges.length > 0) {
      debugMeta.removed_edges = llmResult.removed_edges;
    }
    if (Object.keys(debugMeta).length > 0) {
      // Attach to block's provenance as _meta (non-contractual debug field)
      (block.provenance as unknown as Record<string, unknown>)._meta = debugMeta;
    }

    log.info(
      {
        elapsed_ms: latencyMs,
        operations_count: operations.length,
        attempts: attempt,
        plot_validated: !!plotClient,
        repairs_applied: repairsApplied?.length ?? 0,
        applied_graph_hash: appliedGraphHash,
        has_coaching: !!llmResult.coaching,
        rerun_recommended: llmResult.coaching?.rerun_recommended ?? false,
        ...(promptMeta && {
          prompt_source: promptMeta.source,
          prompt_version: promptMeta.prompt_version,
        }),
      },
      "edit_graph completed",
    );

    // Build assistant text: coaching.summary preferred, warnings appended
    let assistantText: string | null = null;
    const textParts: string[] = [];

    if (llmResult.coaching?.summary) {
      textParts.push(llmResult.coaching.summary);
    }
    if (repairsApplied && repairsApplied.length > 0) {
      const repairSummary = repairsApplied
        .map(r => `- ${r.message}`)
        .join('\n');
      textParts.push(`PLoT applied ${repairsApplied.length} repair(s) to ensure semantic consistency:\n${repairSummary}`);
    }
    if (llmResult.warnings.length > 0) {
      textParts.push(`Note: ${llmResult.warnings.join(' ')}`);
    }

    if (textParts.length > 0) {
      assistantText = textParts.join('\n\n');
    }

    // Build suggested actions: "Re-run analysis" chip when rerun_recommended
    const suggestedActions: EditGraphResult['suggestedActions'] = [];
    if (llmResult.coaching?.rerun_recommended) {
      suggestedActions.push({
        label: 'Re-run analysis',
        prompt: 'run the analysis again',
        role: 'facilitator',
      });
    }

    return {
      blocks: [block],
      assistantText,
      latencyMs,
      appliedGraph: appliedGraph ?? null,
      wasRejected: false,
      ...(suggestedActions.length > 0 && { suggestedActions }),
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
    appliedGraph: null,
    wasRejected: true,
  };
}

// ============================================================================
// Path Normalisation
// ============================================================================

/**
 * Normalise v2 prompt paths to the format expected by the patch validation pipeline.
 *
 * v2 prompt format → pipeline format:
 * - `/nodes/fac_x` → `fac_x`
 * - `/nodes/fac_x/label` → `fac_x` (field stored separately for update ops)
 * - `/edges/fac_a->out_b` → `fac_a::out_b`
 * - `/edges/fac_a->out_b/strength.mean` → `fac_a::out_b` (field stored separately)
 * - Already-normalised paths (no `/` prefix) pass through unchanged.
 */
function normalisePath(path: string): { path: string; field?: string } {
  // Already in pipeline format (no leading /)
  if (!path.startsWith('/')) {
    return { path };
  }

  // /edges/<from>-><to>[/<field>]
  const edgeMatch = path.match(/^\/edges\/([^/]+)->([^/]+)(?:\/(.+))?$/);
  if (edgeMatch) {
    return {
      path: `${edgeMatch[1]}::${edgeMatch[2]}`,
      field: edgeMatch[3],
    };
  }

  // /nodes/<id>[/<field>]
  const nodeMatch = path.match(/^\/nodes\/([^/]+)(?:\/(.+))?$/);
  if (nodeMatch) {
    return {
      path: nodeMatch[1],
      field: nodeMatch[2],
    };
  }

  // Unrecognised — pass through as-is
  return { path };
}

// ============================================================================
// Response Parsing (v2 object + legacy array)
// ============================================================================

/**
 * Extract JSON from LLM response text. Handles:
 * - Plain JSON (no wrapper)
 * - Markdown fenced code blocks (```json ... ```)
 * - Mixed text with embedded JSON
 */
function extractJson(text: string): unknown {
  // Strip markdown fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Try parsing the cleaned text directly
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to regex extraction
  }

  // Try to extract a JSON object
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  // Try to extract a JSON array (legacy format)
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return JSON.parse(arrayMatch[0]);
  }

  throw new Error('No valid JSON found in LLM response');
}

/**
 * Parse the LLM response into an EditGraphLLMResult.
 *
 * Supports two formats:
 * 1. **v2 object**: `{ operations, removed_edges, warnings, coaching }`
 * 2. **Legacy array**: `[{ op, path, value, ... }, ...]` — backward compat with metric logging.
 *
 * Path normalisation is applied to all operations (v2 paths → pipeline paths).
 */
export function parseEditGraphResponse(text: string): EditGraphLLMResult {
  const parsed = extractJson(text);

  // Legacy array format detection
  if (Array.isArray(parsed)) {
    log.info(
      { format: 'legacy_array', operations_count: parsed.length },
      'edit_graph.legacy_array_response',
    );
    const normalised = (parsed as Array<Record<string, unknown>>).map(normaliseOperation);
    return {
      operations: normalised,
      removed_edges: [],
      warnings: [],
      coaching: null,
    };
  }

  // v2 object format
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Validate required field
    if (!Array.isArray(obj.operations)) {
      throw new Error('v2 response missing required "operations" array');
    }

    const operations = (obj.operations as Array<Record<string, unknown>>).map(normaliseOperation);

    const removed_edges: RemovedEdgeInfo[] = Array.isArray(obj.removed_edges)
      ? (obj.removed_edges as RemovedEdgeInfo[])
      : [];

    const warnings: string[] = Array.isArray(obj.warnings)
      ? (obj.warnings as string[])
      : [];

    let coaching: EditGraphCoaching | null = null;
    if (obj.coaching && typeof obj.coaching === 'object') {
      const c = obj.coaching as Record<string, unknown>;
      coaching = {
        summary: typeof c.summary === 'string' ? c.summary : '',
        rerun_recommended: c.rerun_recommended === true,
      };
    }

    return { operations, removed_edges, warnings, coaching };
  }

  throw new Error('LLM response is neither an array nor an object');
}

/**
 * Normalise edge value: if `strength` is a nested object `{ mean, std }`,
 * flatten to `strength_mean` / `strength_std` for the Zod schema.
 * Preserves all other fields.
 */
function normaliseEdgeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;

  // Check for nested strength: { mean, std }
  if (v.strength && typeof v.strength === 'object') {
    const s = v.strength as Record<string, unknown>;
    const { strength, ...rest } = v;
    return {
      ...rest,
      ...(s.mean !== undefined && { strength_mean: s.mean }),
      ...(s.std !== undefined && { strength_std: s.std }),
    };
  }

  return value;
}

/**
 * Normalise a single raw operation from the LLM:
 * - Convert v2 paths to pipeline format
 * - Flatten nested strength objects to strength_mean/strength_std
 * - Preserve impact/rationale as extra fields (stripped later)
 */
function normaliseOperation(raw: Record<string, unknown>): PatchOperation & { impact?: string; rationale?: string } {
  const { path: normalisedPath, field } = normalisePath(String(raw.path ?? ''));

  // Normalise edge values (add_edge, update_edge) for nested strength format
  const isEdgeOp = raw.op === 'add_edge' || raw.op === 'update_edge';
  let value = isEdgeOp ? normaliseEdgeValue(raw.value) : raw.value;
  let oldValue = raw.old_value;

  // For field-level update ops (path had /field suffix), wrap scalar value into { field: value }
  // so the Zod update schemas (which expect a record) validate correctly.
  if (field && (raw.op === 'update_node' || raw.op === 'update_edge')) {
    if (value !== undefined && (typeof value !== 'object' || value === null)) {
      value = { [field]: value };
    }
    if (oldValue !== undefined && (typeof oldValue !== 'object' || oldValue === null)) {
      oldValue = { [field]: oldValue };
    }
  }

  return {
    op: raw.op as PatchOperation['op'],
    path: normalisedPath,
    ...(value !== undefined && { value }),
    ...(oldValue !== undefined && { old_value: oldValue }),
    ...(typeof raw.impact === 'string' && { impact: raw.impact }),
    ...(typeof raw.rationale === 'string' && { rationale: raw.rationale }),
  };
}

/**
 * Strip impact and rationale from operations, returning clean PatchOperations
 * and a parallel array of per-operation metadata.
 */
function stripOperationMeta(
  ops: Array<PatchOperation & { impact?: string; rationale?: string }>,
): { operations: PatchOperation[]; meta: EditGraphOperationMeta[] } {
  const operations: PatchOperation[] = [];
  const meta: EditGraphOperationMeta[] = [];

  for (const op of ops) {
    const { impact, rationale, ...cleanOp } = op as PatchOperation & { impact?: string; rationale?: string };
    operations.push(cleanOp);
    meta.push({
      impact: (impact as EditGraphOperationMeta['impact']) ?? 'low',
      rationale: rationale ?? '',
    });
  }

  return { operations, meta };
}

// ============================================================================
// Patch Budget (cf-v11.1)
// ============================================================================

const MAX_NODE_OPS = 3;
const MAX_EDGE_OPS = 4;

interface PatchBudgetResult {
  allowed: boolean;
  nodeOps: number;
  edgeOps: number;
}

/**
 * Check whether a set of operations fits within the complexity budget.
 *
 * Classification:
 * - add_node, remove_node, update_node → node op
 * - add_edge, remove_edge, update_edge → edge op
 *
 * Implicit edge removals from remove_node do NOT count.
 */
export function checkPatchBudget(operations: PatchOperation[]): PatchBudgetResult {
  let nodeOps = 0;
  let edgeOps = 0;

  for (const op of operations) {
    switch (op.op) {
      case 'add_node':
      case 'remove_node':
      case 'update_node':
        nodeOps++;
        break;
      case 'add_edge':
      case 'remove_edge':
      case 'update_edge':
        edgeOps++;
        break;
    }
  }

  return {
    allowed: nodeOps <= MAX_NODE_OPS && edgeOps <= MAX_EDGE_OPS,
    nodeOps,
    edgeOps,
  };
}

/**
 * Remove no-op operations (where value deeply equals old_value).
 *
 * Uses recursive structural equality — not JSON.stringify (key order is not guaranteed).
 * Operations without old_value are kept (safe default).
 */
export function stripNoOps(operations: PatchOperation[]): PatchOperation[] {
  return operations.filter((op) => {
    if (op.old_value === undefined) return true;
    if (op.value === undefined) return true;
    return !deepEqual(op.value, op.old_value);
  });
}

/**
 * Simple recursive structural equality for JSON-compatible values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}
