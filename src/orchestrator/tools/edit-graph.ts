/**
 * edit_graph Tool Handler
 *
 * Flow: graph + edit description → LLM call → normalise → validate → PatchOperation[]
 *
 * Orchestrator calls as function (same process).
 * Output: GraphPatchBlock (patch_type: 'edit', status: 'proposed').
 *
 * Canonical-only: Reject ops with belief, belief_exists, confidence.
 * Map legacy → canonical, log telemetry.
 *
 * NOTE: This handler's LLM call + validation pipeline may need refinement
 * once we investigate clean stage reuse. If clean reuse isn't apparent,
 * escalate to Paul immediately rather than spending days refactoring.
 */

import { log } from "../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import type { ConversationBlock, ConversationContext, GraphPatchBlockData, PatchOperation, OrchestratorError } from "../types.js";
import { createGraphPatchBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface EditGraphResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
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
 * @returns GraphPatchBlock with edit operations
 */
export async function handleEditGraph(
  context: ConversationContext,
  editDescription: string,
  adapter: LLMAdapter,
  requestId: string,
  turnId: string,
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

  const systemPrompt = buildEditPrompt(context.graph);

  const opts: CallOpts = {
    requestId,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  };

  let chatResult;
  try {
    chatResult = await adapter.chat(
      {
        system: systemPrompt,
        userMessage: editDescription,
      },
      opts,
    );
  } catch (error) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Edit graph LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      tool: 'edit_graph',
      recoverable: true,
      suggested_retry: 'Try describing the edit again.',
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
  }

  const latencyMs = Date.now() - startTime;

  // Parse operations from LLM response
  let operations: PatchOperation[];
  try {
    operations = parseOperations(chatResult.content);
  } catch (error) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Failed to parse edit operations from LLM response: ${error instanceof Error ? error.message : String(error)}`,
      tool: 'edit_graph',
      recoverable: true,
      suggested_retry: 'Try describing the edit more clearly.',
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
  }

  // Sanitise: remove legacy fields
  operations = sanitiseOperations(operations);

  const patchData: GraphPatchBlockData = {
    patch_type: 'edit',
    operations,
    status: 'proposed',
  };

  const block = createGraphPatchBlock(patchData, turnId);

  log.info(
    { elapsed_ms: latencyMs, operations_count: operations.length },
    "edit_graph completed",
  );

  return {
    blocks: [block],
    assistantText: null,
    latencyMs,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildEditPrompt(graph: unknown): string {
  return [
    'You are editing a causal decision graph. The current graph is:',
    '',
    '```json',
    JSON.stringify(graph, null, 2).substring(0, 8000), // Truncate for context window
    '```',
    '',
    'Based on the user\'s edit request, produce a JSON array of patch operations.',
    'Each operation has: { "op": "<operation>", "path": "<path>", "value": <value>, "old_value": <old_value> }',
    '',
    'Valid operations: add_node, remove_node, update_node, add_edge, remove_edge, update_edge',
    '',
    'Rules:',
    '- Use the canonical edge format with strength.mean, strength.std, exists_probability.',
    '- Do NOT use legacy fields: belief, belief_exists, confidence.',
    '- Paths should reference node IDs and edge from→to pairs.',
    '- For updates, include old_value for the field being changed.',
    '',
    'Respond ONLY with a JSON array of operations. No explanation.',
  ].join('\n');
}

/**
 * Parse PatchOperation[] from LLM response text.
 * Expects JSON array of operation objects.
 */
function parseOperations(text: string): PatchOperation[] {
  // Extract JSON array from response (may be wrapped in markdown)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON array found in LLM response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown[];

  if (!Array.isArray(parsed)) {
    throw new Error('Parsed response is not an array');
  }

  return parsed.map((item, i) => {
    const op = item as Record<string, unknown>;
    if (!op.op || !op.path) {
      throw new Error(`Operation at index ${i} missing required fields (op, path)`);
    }
    return {
      op: op.op as PatchOperation['op'],
      path: op.path as string,
      value: op.value,
      old_value: op.old_value,
    };
  });
}
