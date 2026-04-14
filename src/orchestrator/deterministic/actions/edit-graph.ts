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
  OrchestratorError,
  PatchOperation,
  TypedConversationBlock,
} from "../../types.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";
import type { EditGraphResult } from "../../tools/edit-graph.js";
import { log } from "../../../utils/telemetry.js";
import { flattenInterventions } from "../../utils/flatten-interventions.js";

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

/**
 * Snapshot per-option intervention maps by passing the graph through
 * computeStructuralReadiness and running each option's intervention record
 * through the shared flattenInterventions normaliser. This is the canonical
 * intervention payload — what analysis_ready exposes to downstream consumers
 * — so detection tracks real intervention loss (including value-only
 * removals), not just inbound-edge count proxies.
 *
 * Returns Map<option_id, flat Record<factor_id, number>>. Options whose
 * interventions can't be flattened (malformed values) are skipped with a
 * warning; detection is advisory, so we degrade rather than throw.
 */
export function snapshotOptionInterventions(
  graph: GraphV3T | null,
  computeReadiness: (g: GraphV3T) => { options: Array<{ option_id: string; interventions: Record<string, number> }> } | undefined,
): Map<string, Record<string, number>> {
  const snapshots = new Map<string, Record<string, number>>();
  if (!graph) return snapshots;
  const ready = computeReadiness(graph);
  if (!ready) return snapshots;
  for (const opt of ready.options) {
    try {
      snapshots.set(opt.option_id, flattenInterventions(opt.interventions, opt.option_id, 0));
    } catch (err) {
      log.warn(
        { err, option_id: opt.option_id },
        'v4.edit_graph_snapshot_flatten_failed',
      );
      snapshots.set(opt.option_id, {});
    }
  }
  return snapshots;
}

/** Extract the id an add_node op creates. */
function addNodeId(op: PatchOperation): string | null {
  if (op.op !== 'add_node') return null;
  if (typeof op.path === 'string' && op.path.length > 0) return op.path;
  if (op.value && typeof op.value === 'object') {
    const id = (op.value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Extract the id an remove_node op removes. */
function removeNodeId(op: PatchOperation): string | null {
  if (op.op !== 'remove_node') return null;
  if (typeof op.path === 'string' && op.path.length > 0) return op.path;
  return null;
}

/**
 * Validate every add_edge op sequentially against a rolling id set: each
 * add_edge may reference base-graph nodes and nodes created by EARLIER
 * operations in the same patch, not later ones. The V2 patch-applier runs
 * operations in order, so an edge referencing a not-yet-added node would
 * fail at apply time. Validation must match apply semantics.
 */
export function validateEdgeEndpoints(
  baseGraph: GraphV3T | null,
  operations: PatchOperation[],
): { kept: PatchOperation[]; stripped: PatchOperation[] } {
  const rollingIds = new Set<string>();
  for (const n of baseGraph?.nodes ?? []) rollingIds.add(n.id);

  const kept: PatchOperation[] = [];
  const stripped: PatchOperation[] = [];

  for (const op of operations) {
    if (op.op === 'add_edge' && op.value && typeof op.value === 'object') {
      const from = (op.value as { from?: unknown }).from;
      const to = (op.value as { to?: unknown }).to;
      const fromOk = typeof from === 'string' && rollingIds.has(from);
      const toOk = typeof to === 'string' && rollingIds.has(to);
      if (!fromOk || !toOk) {
        stripped.push(op);
        continue;
      }
      kept.push(op);
      continue;
    }

    // Mutate the rolling id set AFTER the op's own endpoint check.
    kept.push(op);
    const added = addNodeId(op);
    if (added) rollingIds.add(added);
    const removed = removeNodeId(op);
    if (removed) rollingIds.delete(removed);
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
    const id = addNodeId(op);
    if (id) ids.push(id);
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
    const { computeStructuralReadiness } = await import("../../tools/analysis-ready-helper.js");

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

    // Snapshot canonical per-option intervention maps BEFORE edit (detect-only,
    // no auto-restore in v1). Uses computeStructuralReadiness + shared
    // flattenInterventions so detection reflects the payload analysis_ready
    // exposes, not an inbound-edge-count proxy.
    const preSnapshots = snapshotOptionInterventions(ctx.graph, computeStructuralReadiness);

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
      // V2 handleEditGraph attaches .orchestratorError to thrown errors
      // (missing graph, LLM failure, parse failure, etc.). Mirror
      // run-analysis.ts: branch on orchestratorError.code to produce
      // structured failure codes and friendlier user text instead of a
      // single generic EDIT_GRAPH_HANDLER_ERROR, so telemetry and the
      // eventual UI can distinguish recoverable vs fatal outcomes.
      const orchestratorErr = (err as { orchestratorError?: OrchestratorError }).orchestratorError;
      if (orchestratorErr) {
        log.error(
          { err, turn_id: ctx.turn_id, error_code: orchestratorErr.code },
          'v4.edit_graph_orchestrator_error',
        );
        const userMessage = friendlyEditGraphError(orchestratorErr);
        return {
          blocks: [],
          assistantText: userMessage,
          guidance_items: [],
          failure: {
            code: `EDIT_GRAPH_${orchestratorErr.code}`,
            message: orchestratorErr.message,
            user_message: userMessage,
            recovery_hint: orchestratorErr.recoverable
              ? 'Try rephrasing the edit.'
              : undefined,
          },
        };
      }

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

    // PLoT-certified path: when V2 ran PLoT and returned a non-null
    // applied_graph without rejection, the patch has already cleared
    // Zod + referential + structural + semantic validation. Re-running our
    // belt-and-braces checks here risks wrongly stripping a valid op
    // (operations represent the LLM proposal; PLoT's applied_graph may
    // reflect silent repairs not re-applied to the operations array), which
    // would leave `operations` inconsistent with `applied_graph`.
    //
    // The hardening layers act as a SAFETY NET for the PLoT-not-configured
    // case (dev/test) — we still run them when applied_graph is null.
    const plotCertified = result.appliedGraph != null;

    // ── Edge endpoint validation (safety net for non-certified path) ─────
    if (!plotCertified) {
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
    }

    // ── Orphan check (safety net for non-certified path) ─────────────────
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

    if (!plotCertified && addedNodeIds.length > 0 && appliedGraphPreview) {
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
      const postSnapshots = snapshotOptionInterventions(appliedGraphPreview, computeStructuralReadiness);
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
      const lostForUntouched: Array<{ option_id: string; lost_factors: string[] }> = [];
      for (const [optionId, before] of preSnapshots.entries()) {
        if (directlyTouchedOptionIds.has(optionId)) continue;
        const after = postSnapshots.get(optionId) ?? {};
        const lostFactors: string[] = [];
        for (const factorId of Object.keys(before)) {
          if (!(factorId in after)) lostFactors.push(factorId);
        }
        if (lostFactors.length > 0) {
          lostForUntouched.push({ option_id: optionId, lost_factors: lostFactors });
        }
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

    // Strip the V2 graph_patch block: pipeline-v4's envelope assembler
    // re-emits a graph_patch from the returned `operations` array (which is
    // the HARDENED set — invalid-edge ops already stripped). Keeping the
    // inbound V2 block would cause double-emission of graph_patch, and the
    // response-normaliser dedup keeps the first block (V2's pre-hardening
    // operations), which would leak un-hardened patches to the UI.
    const nonPatchBlocks = result.blocks.filter((b) => b.block_type !== 'graph_patch');

    return {
      blocks: nonPatchBlocks,
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

function friendlyEditGraphError(err: OrchestratorError): string {
  switch (err.code) {
    case 'TOOL_EXECUTION_FAILED':
      return "I couldn't apply that edit. Could you try rephrasing it?";
    case 'MISSING_GRAPH_STATE':
      return 'There is no decision model to edit yet. Build one first.';
    case 'LLM_TIMEOUT':
      return 'The edit took too long. Your model is unchanged; try again.';
    case 'VALIDATION_REJECTED':
      return "I couldn't validate that edit. Describe the change more concretely.";
    default:
      return "I couldn't apply that edit. Could you try rephrasing it?";
  }
}

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
