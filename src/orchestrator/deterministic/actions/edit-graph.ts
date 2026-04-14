/**
 * edit_graph V4 action — thin adapter around V2 handleEditGraph.
 *
 * The V2 handler is battle-tested: PLoT integration, patch validation,
 * structural checks, proposal-language guard, per-op metadata, retries.
 * This adapter:
 *   1. Builds a ConversationContext from DeterministicTurnContext + turnRequest.
 *   2. Resolves adapter + PLoT client.
 *   3. Calls handleEditGraph.
 *   4. Remaps EditGraphResult → ActionResult, applying V4 hardening layers:
 *        - ID sanitisation in assistantText
 *        - Edge endpoint validation (includes add_node-created ids)
 *        - Orphan check on fully-applied preview graph
 *        - Intervention preservation snapshot/detect/log (no auto-restore)
 *        - Matching-artefact honesty guard
 *        - Unsupported-capability fallback
 *
 * v1 scope: ideate only. requires_confirmation=false. pendingProposal and
 * pendingClarification are treated distinctly: clarification becomes an
 * assistantText question; proposal is deferred to the unsupported-capability
 * fallback (v1 does not run V2's confirmation flow).
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, ActionFailure } from "../types.js";
import type {
  ConversationContext,
  GraphPatchBlockData,
  PatchOperation,
  TypedConversationBlock,
} from "../../types.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";
import type { EditGraphResult } from "../../tools/edit-graph.js";
import { log } from "../../../utils/telemetry.js";

const STRUCTURAL_INTENT_RE =
  /\b(connect|disconnect|fix|wire|link|rewire|add.*connection|remove.*connection|isn'?t connected|not connected|missing connection)\b/i;

/**
 * Exported for use by tool-builder: returns true if the user's raw message
 * implies a structural edit. Tool-builder uses this to suppress
 * adjust_edge_strength from the resolved LLM tool set, biasing toward
 * edit_graph without hard-coding the choice.
 */
export function messageImpliesStructuralEdit(message: string | null | undefined): boolean {
  if (!message) return false;
  return STRUCTURAL_INTENT_RE.test(message);
}

/** Extracted for testing — snapshot option-intervention counts by option id. */
export function snapshotOptionInterventionCounts(
  graph: GraphV3T | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!graph) return counts;
  for (const node of graph.nodes ?? []) {
    if (node.kind !== 'option') continue;
    // Count inbound edges from factors to this option (interventions).
    const inbound = (graph.edges ?? []).filter((e) => e.to === node.id).length;
    counts.set(node.id, inbound);
  }
  return counts;
}

/**
 * Validate every add_edge op against the post-patch node set. Returns the
 * operations that passed and the list of stripped ones (for telemetry /
 * failure escalation).
 */
export function validateEdgeEndpoints(
  baseGraph: GraphV3T | null,
  operations: PatchOperation[],
): { kept: PatchOperation[]; stripped: PatchOperation[] } {
  const existingIds = new Set<string>();
  for (const n of baseGraph?.nodes ?? []) existingIds.add(n.id);

  // Include node ids created by earlier operations in the same patch so an
  // edge to a just-added node isn't stripped.
  for (const op of operations) {
    if (op.op === 'add_node' && typeof op.path === 'string' && op.path.length > 0) {
      existingIds.add(op.path);
    } else if (op.op === 'add_node' && op.value && typeof op.value === 'object') {
      const id = (op.value as { id?: unknown }).id;
      if (typeof id === 'string') existingIds.add(id);
    }
  }

  const kept: PatchOperation[] = [];
  const stripped: PatchOperation[] = [];
  for (const op of operations) {
    if (op.op === 'add_edge' && op.value && typeof op.value === 'object') {
      const from = (op.value as { from?: unknown }).from;
      const to = (op.value as { to?: unknown }).to;
      const fromOk = typeof from === 'string' && existingIds.has(from);
      const toOk = typeof to === 'string' && existingIds.has(to);
      if (!fromOk || !toOk) {
        stripped.push(op);
        continue;
      }
    }
    kept.push(op);
  }
  return { kept, stripped };
}

/**
 * Sanitise node IDs (fac_*, opt_*, risk_*, goal_*, dec_*, out_*) in the
 * assistant text by replacing them with the corresponding node's label.
 * Falls back to "that element" when no match is found.
 */
export function sanitiseNodeIdsInText(text: string, graph: GraphV3T | null): string {
  if (!text || !graph) return text;
  const idToLabel = new Map<string, string>();
  for (const n of graph.nodes ?? []) {
    if (typeof n.id === 'string' && typeof n.label === 'string') {
      idToLabel.set(n.id, n.label);
    }
  }
  return text.replace(/\b(fac|opt|risk|goal|dec|out)_[a-z0-9_]+/g, (match) => {
    const label = idToLabel.get(match);
    return label ?? 'that element';
  });
}

/**
 * Honesty guard: if the assistant says it performed a structural change but
 * the returned operations are calibration-only (update_edge weight/belief
 * only), rewrite the text. Prevents overclaiming.
 */
export function detectCalibrationOnlyArtefact(
  text: string,
  operations: PatchOperation[],
): boolean {
  if (!text || operations.length === 0) return false;
  const structuralLanguage = /\b(connecting|adding|removing|rewiring|connected|added|removed|rewired)\b/i;
  if (!structuralLanguage.test(text)) return false;
  return operations.every((op) => op.op === 'update_edge');
}

/**
 * Orphan check: list ids added this patch that have no incident edge in the
 * fully-applied preview graph.
 */
export function findOrphans(
  appliedGraph: GraphV3T,
  addedNodeIds: string[],
): string[] {
  const orphans: string[] = [];
  for (const id of addedNodeIds) {
    const incident = (appliedGraph.edges ?? []).some(
      (e) => e.from === id || e.to === id,
    );
    if (!incident) orphans.push(id);
  }
  return orphans;
}

/** Extract add_node ids from a list of operations. */
function extractAddedNodeIds(operations: PatchOperation[]): string[] {
  const ids: string[] = [];
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    if (typeof op.path === 'string' && op.path.length > 0) {
      ids.push(op.path);
    } else if (op.value && typeof op.value === 'object') {
      const id = (op.value as { id?: unknown }).id;
      if (typeof id === 'string') ids.push(id);
    }
  }
  return ids;
}

function liftGraphPatchBlockData(
  blocks: TypedConversationBlock[],
): GraphPatchBlockData | null {
  for (const block of blocks) {
    if (block.block_type === 'graph_patch') {
      return block.data;
    }
  }
  return null;
}

export const editGraphAction: ActionDefinition = {
  action_type: 'edit_graph',
  description:
    'Make a free-form structural edit to the decision model (add/remove/connect/rename nodes and edges). Use when the narrow structural actions do not cover the request.',
  stage_eligibility: new Set(['ideate']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'moderate',
  reversible: true,
  surface: 'proposal_card',
  role: 'facilitator',
  cooldown: 'none',
  input_schema: {
    type: 'object',
    properties: {
      edit_description: {
        type: 'string',
        description: 'Natural language description of the edit to make to the graph.',
      },
    },
    required: ['edit_description'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const editDescription = typeof params.edit_description === 'string' ? params.edit_description : '';
    if (!editDescription.trim()) {
      return unsupportedFallback();
    }

    const { handleEditGraph } = await import("../../tools/edit-graph.js");
    const { createPLoTClient } = await import("../../plot-client.js");
    const { getAdapter } = await import("../../../adapters/llm/router.js");
    const { generatePostDraftGuidance } = await import("../../guidance/post-draft.js");

    const adapter = getAdapter('edit_graph');
    const plotClient = createPLoTClient();

    const context: ConversationContext = {
      graph: ctx.graph,
      analysis_response: ctx.analysis,
      framing: ctx.stage ? { stage: ctx.stage } : null,
      messages: ctx.messages ?? [],
      scenario_id: ctx.scenario_id,
      analysis_inputs: ctx.analysis_inputs ?? undefined,
      ...(ctx.conversational_state ? { conversational_state: ctx.conversational_state } : {}),
    };

    const requestId = `v4-edit-${ctx.turn_id}`;

    // Snapshot intervention counts BEFORE edit (detect-only, no auto-restore in v1).
    const preCounts = snapshotOptionInterventionCounts(ctx.graph);

    let result: EditGraphResult;
    try {
      result = await handleEditGraph(
        context,
        editDescription,
        adapter,
        requestId,
        ctx.turn_id,
        { plotClient, invocationInput: params },
      );
    } catch (err) {
      log.error(
        { err, turn_id: ctx.turn_id },
        'v4.edit_graph_handler_threw',
      );
      return {
        blocks: [],
        assistantText: "I couldn't apply that edit. Could you try rephrasing it?",
        guidance_items: [],
        failure: {
          code: 'EDIT_GRAPH_HANDLER_ERROR',
          message: err instanceof Error ? err.message : String(err),
          user_message: "I couldn't apply that edit. Could you try rephrasing it?",
        },
      };
    }

    // ── Pending clarification: surface as assistantText question ─────────
    if (result.pendingClarification) {
      const text = extractClarificationText(result);
      return {
        blocks: [],
        assistantText: sanitiseNodeIdsInText(text, ctx.graph),
        guidance_items: [],
      };
    }

    // ── Pending proposal: v1 defers proposal flow → unsupported fallback ─
    if (result.pendingProposal) {
      log.info(
        { turn_id: ctx.turn_id },
        'v4.edit_graph_proposal_deferred',
      );
      return unsupportedFallback();
    }

    // ── Rejection (PLoT hard-reject, structural reject) ──────────────────
    if (result.wasRejected) {
      const userMessage = result.assistantText?.trim() || "I couldn't apply that edit to the model.";
      const sanitised = sanitiseNodeIdsInText(userMessage, ctx.graph);
      return {
        blocks: [],
        assistantText: sanitised,
        guidance_items: [],
        failure: {
          code: 'EDIT_GRAPH_REJECTED',
          message: result.assistantText ?? 'rejected',
          user_message: sanitised,
          recovery_hint: 'Try rephrasing the edit, or describe the change more concretely.',
        },
      };
    }

    // ── Lift operations / applied_graph_hash from the graph_patch block ──
    const blockData = liftGraphPatchBlockData(result.blocks);
    let operations: PatchOperation[] = blockData?.operations ?? [];
    const appliedGraphHash = blockData?.applied_graph_hash;

    // ── Edge endpoint validation ─────────────────────────────────────────
    const { kept, stripped } = validateEdgeEndpoints(ctx.graph, operations);
    if (stripped.length > 0) {
      log.warn(
        { turn_id: ctx.turn_id, stripped_count: stripped.length },
        'v4.edit_graph_invalid_edge_rejected',
      );
      operations = kept;
      if (operations.length === 0) {
        return {
          blocks: [],
          assistantText: "I couldn't place an edge between those nodes — one of them doesn't exist in the current model.",
          guidance_items: [],
          failure: {
            code: 'EDIT_GRAPH_INVALID_EDGE',
            message: `Stripped ${stripped.length} add_edge operation(s) referencing unknown endpoints.`,
            user_message: "I couldn't place an edge between those nodes — one of them doesn't exist in the current model.",
            recovery_hint: 'Name the specific existing factors or options to connect.',
          },
        };
      }
    }

    // ── Orphan check on fully-applied preview graph ──────────────────────
    const addedNodeIds = extractAddedNodeIds(operations);
    let appliedGraphPreview: GraphV3T | null = result.appliedGraph;
    if (!appliedGraphPreview && ctx.graph && operations.length > 0) {
      try {
        const { applyPatchOperations } = await import("../../patch-applier.js");
        appliedGraphPreview = applyPatchOperations(ctx.graph, operations);
      } catch (err) {
        log.warn(
          { err, turn_id: ctx.turn_id },
          'v4.edit_graph_preview_apply_failed',
        );
        appliedGraphPreview = null;
      }
    }

    if (addedNodeIds.length > 0 && appliedGraphPreview) {
      const orphans = findOrphans(appliedGraphPreview, addedNodeIds);
      if (orphans.length > 0) {
        log.warn(
          { turn_id: ctx.turn_id, orphans },
          'v4.edit_graph_orphan_rejected',
        );
        return {
          blocks: [],
          assistantText:
            'The change would create a disconnected element. Please specify how it connects to the rest of the model.',
          guidance_items: [],
          failure: {
            code: 'EDIT_GRAPH_ORPHAN',
            message: `Orphaned new nodes: ${orphans.join(', ')}`,
            user_message:
              'The change would create a disconnected element. Please specify how it connects to the rest of the model.',
            recovery_hint: 'Describe the factor it influences or is influenced by.',
          },
        };
      }
    }

    // ── Intervention preservation: detect only (no auto-restore) ─────────
    if (appliedGraphPreview) {
      const postCounts = snapshotOptionInterventionCounts(appliedGraphPreview);
      const directlyTouchedOptionIds = new Set<string>();
      for (const op of operations) {
        if (typeof op.path === 'string' && op.path.startsWith('opt_')) {
          directlyTouchedOptionIds.add(op.path);
        }
        if (op.value && typeof op.value === 'object') {
          const maybeId = (op.value as { id?: unknown }).id;
          if (typeof maybeId === 'string' && maybeId.startsWith('opt_')) {
            directlyTouchedOptionIds.add(maybeId);
          }
        }
      }
      const lostForUntouched: string[] = [];
      for (const [optionId, beforeCount] of preCounts.entries()) {
        if (directlyTouchedOptionIds.has(optionId)) continue;
        const afterCount = postCounts.get(optionId) ?? 0;
        if (afterCount < beforeCount) lostForUntouched.push(optionId);
      }
      if (lostForUntouched.length > 0) {
        log.warn(
          {
            turn_id: ctx.turn_id,
            options_with_lost_interventions: lostForUntouched,
          },
          'v4.edit_graph_intervention_loss_detected',
        );
      }
    }

    // ── Matching-artefact honesty guard ──────────────────────────────────
    let assistantText = result.assistantText ?? '';
    if (detectCalibrationOnlyArtefact(assistantText, operations)) {
      log.info({ turn_id: ctx.turn_id }, 'v4.edit_graph_honesty_guard_triggered');
      assistantText =
        "I adjusted the strength of an existing connection but couldn't make the structural change you asked for. Could you describe exactly what you'd like to connect or modify?";
    }

    // ── ID sanitisation in the final user-facing text ────────────────────
    assistantText = sanitiseNodeIdsInText(assistantText, ctx.graph);

    // ── Unsupported-capability fallback ──────────────────────────────────
    if (
      result.blocks.length === 0
      && !assistantText.trim()
      && operations.length === 0
    ) {
      return unsupportedFallback();
    }

    // ── Post-edit guidance ───────────────────────────────────────────────
    const guidanceItems =
      result.appliedGraph && !result.wasRejected
        ? generatePostDraftGuidance(result.appliedGraph, [], context.framing ?? null)
        : [];

    return {
      blocks: result.blocks,
      assistantText: assistantText || null,
      guidance_items: guidanceItems,
      operations: operations.length > 0 ? operations : undefined,
      applied_graph_hash: appliedGraphHash,
      applied_graph: result.appliedGraph ?? undefined,
      analysis_ready: blockData?.analysis_ready,
    };
  },

  chipLabel(rec) {
    const desc = (rec.parameters?.edit_description as string | undefined)?.slice(0, 40);
    return desc ? `Edit model: ${desc}` : 'Edit model';
  },
  chipPrompt(rec) {
    const desc = (rec.parameters?.edit_description as string | undefined) ?? '';
    return desc || 'Edit the model';
  },
};

function extractClarificationText(result: EditGraphResult): string {
  const pc = result.pendingClarification as unknown as { question?: unknown; prompt?: unknown } | undefined;
  if (pc && typeof pc.question === 'string') return pc.question;
  if (pc && typeof pc.prompt === 'string') return pc.prompt;
  return result.assistantText?.trim() || 'Could you clarify which element you mean?';
}

function unsupportedFallback(): ActionResult {
  return {
    blocks: [],
    assistantText:
      "I wasn't able to make that change to the model. Could you describe specifically what you'd like to add, remove, or connect?",
    guidance_items: [],
  };
}
