/**
 * Run pre-built template operations through the SAME validate -> apply ->
 * topology-check pipeline that the LLM edit path uses.
 *
 * Returns an `EditGraphResult` so the V5 dispatcher
 * (edit-graph-dispatch.ts) can compose the wire response, derive
 * freshness, and commit through the same code paths regardless of
 * whether the operations came from a template or the LLM.
 *
 * Validation pipeline mirrors handleEditGraph:
 *   1. enforceStructuralEdgeDefaults
 *   2. validatePatchOperations (Zod + referential integrity)
 *   3. applyPatchOperations -> candidateGraph
 *   4. validateGraphStructure (with baseline-violation subtraction)
 *
 * On any validation/apply failure, returns a rejected EditGraphResult
 * with a friendly assistant_text + recovery chip from
 * `buildEditRejectionResponse`. The brief mandates the template never
 * produce an invalid graph; this is a safety net.
 */

import { buildAppliedChanges, enforceStructuralEdgeDefaults } from "../../../orchestrator/tools/edit-graph.js";
import { validatePatchOperations } from "../../../orchestrator/patch-validation.js";
import { applyPatchOperations, PatchApplyError } from "../../../orchestrator/patch-applier.js";
import {
  validateGraphStructure,
  type StructuralViolationCode,
} from "../../../orchestrator/graph-structure-validator.js";
import { buildEditRejectionResponse } from "../edit-rejection-text.js";
import { log } from "../../../utils/telemetry.js";
import type { EditGraphResult } from "../../../orchestrator/tools/edit-graph.js";
import type { AppliedChanges, ConversationContext, PatchOperation } from "../../../orchestrator/types.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

export interface ApplyTemplateParams {
  operations: PatchOperation[];
  context: ConversationContext;
  requestId: string;
  turnId: string;
  templateName: string;
  confirmationText: string;
}

export async function applyTemplateOperations(params: ApplyTemplateParams): Promise<EditGraphResult> {
  const startTime = Date.now();
  const { operations, context, requestId, turnId, templateName, confirmationText } = params;

  if (!context.graph) {
    return rejection('structural_validation', startTime, 'NO_GRAPH', requestId, turnId, templateName);
  }

  const baseGraph = context.graph as GraphV3T;
  const baselineViolationCounts = countViolations(validateGraphStructure(baseGraph).violations);

  const normalised = enforceStructuralEdgeDefaults(operations, baseGraph as unknown as { nodes: { id: string; kind?: string }[] });

  const validation = validatePatchOperations(
    normalised,
    baseGraph as unknown as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> },
  );
  if (!validation.valid) {
    log.warn(
      {
        request_id: requestId,
        turn_id: turnId,
        template: templateName,
        zod_errors: validation.zodErrors?.issues.length ?? 0,
        ref_errors: validation.referentialErrors?.length ?? 0,
      },
      'edit_graph template — Zod / referential validation failed',
    );
    return rejection('structural_validation', startTime, 'TEMPLATE_VALIDATION_FAILED', requestId, turnId, templateName);
  }

  let candidateGraph: GraphV3T;
  try {
    candidateGraph = applyPatchOperations(baseGraph, validation.operations as unknown as PatchOperation[]);
  } catch (err) {
    if (err instanceof PatchApplyError) {
      log.warn(
        { request_id: requestId, turn_id: turnId, template: templateName, code: err.code, error: err.message },
        'edit_graph template — patch apply failed',
      );
      return rejection('structural_validation', startTime, 'TEMPLATE_APPLY_FAILED', requestId, turnId, templateName);
    }
    throw err;
  }

  const structResultRaw = validateGraphStructure(candidateGraph);
  const remainingBaseline = new Map(baselineViolationCounts);
  const newViolations = structResultRaw.violations.filter((v) => {
    const count = remainingBaseline.get(v.code) ?? 0;
    if (count > 0) {
      remainingBaseline.set(v.code, count - 1);
      return false;
    }
    return true;
  });
  if (newViolations.length > 0) {
    log.warn(
      {
        request_id: requestId,
        turn_id: turnId,
        template: templateName,
        violation_codes: newViolations.map((v) => v.code),
      },
      'edit_graph template — post-mutation topology validation failed',
    );
    return rejection('structural_validation', startTime, 'TEMPLATE_TOPOLOGY_INVALID', requestId, turnId, templateName);
  }

  // V5 A4 Commit 5 — UX parity with the LLM success path:
  //   * appliedChanges receipt is built deterministically from the actual
  //     operations + post-edit graph (label resolution falls back to op.value
  //     for newly added nodes, which buildAppliedChanges handles).
  //   * "Re-run analysis" chip is appended ONLY when prior analysis exists
  //     (rerun_recommended === true). Without prior analysis, no chip — the
  //     graph hasn't been analysed yet, so re-running is meaningless.
  const hasExistingAnalysis = !!context.analysis_response;
  const appliedChanges = sanitiseReceiptLabels(
    buildAppliedChanges(
      validation.operations as unknown as PatchOperation[],
      candidateGraph,
      hasExistingAnalysis,
    ),
    validation.operations as unknown as PatchOperation[],
    candidateGraph,
  );

  const suggestedActions: EditGraphResult['suggestedActions'] = [];
  if (appliedChanges.rerun_recommended) {
    suggestedActions.push({
      label: 'Re-run analysis',
      prompt: 'run the analysis again',
      role: 'facilitator',
    });
  }

  return {
    blocks: [],
    assistantText: confirmationText,
    latencyMs: Date.now() - startTime,
    appliedGraph: candidateGraph,
    wasRejected: false,
    appliedChanges,
    ...(suggestedActions.length > 0 && { suggestedActions }),
  };
}

/**
 * V5 A4 Commit 6 — receipt label sanitisation.
 *
 * `buildAppliedChanges`'s label resolver walks `graph.nodes` looking for a
 * node whose `id === op.path`. Edge ops have `op.path` like
 * `from::to` which never matches a node, so the label falls back to the
 * raw path — leaking internal IDs into a user-facing field.
 *
 * For each edge op, replace `change.label` with the human-readable
 * "<fromLabel> -> <toLabel>" form derived from the operation's
 * `value.from` / `value.to`. element_ref retains the raw path so
 * downstream code can map back to the operation; only the user-visible
 * `label` field is rewritten.
 */
function sanitiseReceiptLabels(
  receipt: AppliedChanges,
  operations: PatchOperation[],
  graph: GraphV3T,
): AppliedChanges {
  const labelById = new Map<string, string>();
  for (const node of graph.nodes) {
    labelById.set(node.id, node.label ?? node.id);
  }
  const sanitisedChanges = receipt.changes.map((change, idx) => {
    const op = operations[idx];
    if (!op) return change;
    if (op.op !== 'add_edge' && op.op !== 'remove_edge' && op.op !== 'update_edge') {
      return change;
    }
    let fromId: string | undefined;
    let toId: string | undefined;
    if (op.value && typeof op.value === 'object') {
      const v = op.value as { from?: unknown; to?: unknown };
      if (typeof v.from === 'string') fromId = v.from;
      if (typeof v.to === 'string') toId = v.to;
    }
    if (!fromId || !toId) {
      const parts = op.path.split('::');
      fromId = fromId ?? parts[0];
      toId = toId ?? parts[1];
    }
    if (!fromId || !toId) return change;
    const fromLabel = labelById.get(fromId) ?? fromId;
    const toLabel = labelById.get(toId) ?? toId;
    return { ...change, label: `${fromLabel} -> ${toLabel}` };
  });
  return { ...receipt, changes: sanitisedChanges };
}

function rejection(
  reason: 'structural_validation' | 'parse_failure' | 'too_many_operations' | 'entity_not_found',
  startTime: number,
  _rejectionCode: string,
  _requestId: string,
  _turnId: string,
  _templateName: string,
): EditGraphResult {
  const built = buildEditRejectionResponse(reason);
  return {
    blocks: [],
    assistantText: built.assistantText,
    latencyMs: Date.now() - startTime,
    appliedGraph: null,
    wasRejected: true,
    suggestedActions: built.suggestedActions,
  };
}

function countViolations(
  violations: Array<{ code: StructuralViolationCode }>,
): Map<StructuralViolationCode, number> {
  const counts = new Map<StructuralViolationCode, number>();
  for (const v of violations) {
    counts.set(v.code, (counts.get(v.code) ?? 0) + 1);
  }
  return counts;
}
