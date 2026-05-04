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

import { enforceStructuralEdgeDefaults } from "../../../orchestrator/tools/edit-graph.js";
import { validatePatchOperations } from "../../../orchestrator/patch-validation.js";
import { applyPatchOperations, PatchApplyError } from "../../../orchestrator/patch-applier.js";
import {
  validateGraphStructure,
  type StructuralViolationCode,
} from "../../../orchestrator/graph-structure-validator.js";
import { buildEditRejectionResponse } from "../edit-rejection-text.js";
import { log } from "../../../utils/telemetry.js";
import type { EditGraphResult } from "../../../orchestrator/tools/edit-graph.js";
import type { ConversationContext, PatchOperation } from "../../../orchestrator/types.js";
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

  return {
    blocks: [],
    assistantText: confirmationText,
    latencyMs: Date.now() - startTime,
    appliedGraph: candidateGraph,
    wasRejected: false,
    suggestedActions: [],
  };
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
