import { CANONICAL_ID_REGEX } from '../../cee/utils/id-normalizer.js';
import { isDeepStrictEqual } from 'node:util';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { GraphV3, InterventionV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { assertIngressGraphNumericBounds, floorGraphSigmaForCompute } from '../../validators/numeric-bounds.js';
import { parseEditGraphResponse, buildAppliedChanges } from '../../orchestrator/tools/edit-graph.js';
import { validatePatchOperations } from '../../orchestrator/patch-validation.js';
import { applyPatchOperations } from '../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { commitDirectAnswer } from '../commit.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { buildOptionEffectRawOperation, linkedFactorsOf, formatOptionEffectWriteAck, readCommittedOptionEffect } from '../routing/option-effect-write.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { buildEditGraphHandlerFact } from '../handlers/edit-graph-fact-builder.js';
import { evaluateEditGraphMutations } from '../handlers/edit-graph-referee-gate.js';
import { threadHoldsThroughMutatingCommit } from '../handlers/hold-thread-through.js';
import type { FrameFreshness } from '../graph-management/types.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { reconcileTopLevelOptionsFromNodes } from '../reconcile-top-level-options.js';

/**
 * Internal preparation for an explicit option→factor edit. This is NOT a wire
 * schema and cannot admit a system event. The shared event still needs its
 * declared contract. Preparation composes the existing intervention operation;
 * it does not write, commit, infer a unit, or grant constraint-edit authority.
 */
export interface OptionInterventionEditInput {
  readonly persistedGraph: unknown;
  readonly optionId: string;
  readonly factorId: string;
  /** Already on the model scale; raw-unit conversion is not licensed here. */
  readonly modelValue: number;
  readonly expectedGraphHash: string;
}

/** Internal server invocation only: no member is added to the .50 wire union. */
export interface OptionInterventionTransactionInput extends OptionInterventionEditInput {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  /** Server-derived analysis context; neither value grants mutation authority. */
  readonly freshness: FrameFreshness;
  readonly hasExistingAnalysis: boolean;
}

type EditableGraph = GraphV3T & Record<string, unknown>;
// Derive the injected port from the canonical commit entrypoint. This module
// neither constructs a session store nor introduces another persistence API.
type OptionInterventionStore = NonNullable<Parameters<typeof commitDirectAnswer>[2]>;

// Same check-only sigma projection used by commit and model-version receipts.
// This narrows the raw object; it NEVER returns the floored/parsed copy.
function isEditableGraph(value: unknown): value is EditableGraph {
  const ingress = GraphStateIngressSchema.safeParse(value);
  return ingress.success && assertIngressGraphNumericBounds(ingress.data).ok
    && GraphV3.passthrough().safeParse(floorGraphSigmaForCompute(value).graph).success;
}

/**
 * Compare to the original persisted bytes, not two independently normalised
 * graphs. Only the selected cell and its existing canonical mirror may change.
 * The restored graph is a comparison specimen, never a second write producer.
 */
export function optionInterventionPostimageIsScoped(
  before: unknown,
  after: unknown,
  target: Pick<OptionInterventionEditInput, 'optionId' | 'factorId' | 'modelValue'>,
): boolean {
  if (!isEditableGraph(before) || !isEditableGraph(after)) return false;
  if (!isDeepStrictEqual(projectGraphForPersistence(before), before)) return false;
  const oldNodes = before.nodes.filter(node => node.id === target.optionId);
  const newNodes = after.nodes.filter(node => node.id === target.optionId);
  if (oldNodes.length !== 1 || newNodes.length !== 1) return false;
  const oldNode = oldNodes[0]!;
  const newNode = newNodes[0]!;
  const entry = InterventionV3.safeParse(newNode.interventions?.[target.factorId]);
  if (!entry.success || entry.data.value !== target.modelValue
    || entry.data.source !== 'user_specified' || entry.data.target_match.node_id !== target.factorId) return false;

  const restored = structuredClone(after);
  const restoredNode = restored.nodes.find(node => node.id === target.optionId)!;
  if (oldNode.interventions === undefined) {
    // A new container may contain this one cell, not unrelated invented cells.
    if (Object.keys(restoredNode.interventions ?? {}).length !== 1) return false;
    delete restoredNode.interventions;
  } else if (Object.hasOwn(oldNode.interventions, target.factorId)) {
    restoredNode.interventions![target.factorId] = structuredClone(oldNode.interventions[target.factorId]);
  } else {
    delete restoredNode.interventions![target.factorId];
  }

  // Derive the options[] mirror through its existing owner, never a copied
  // list of status/raw-intervention/provenance reconciliation rules.
  const specimen = structuredClone(before);
  const specimenNode = specimen.nodes.find(node => node.id === target.optionId)!;
  specimenNode.interventions = { ...specimenNode.interventions,
    [target.factorId]: structuredClone(newNode.interventions![target.factorId]) };
  const expectedMirror = reconcileTopLevelOptionsFromNodes(specimen);
  if (!isDeepStrictEqual(after.options, expectedMirror.options)) return false;
  if (Object.hasOwn(before, 'options')) restored.options = structuredClone(before.options);
  else delete restored.options;
  return isDeepStrictEqual(restored, before);
}

export type OptionInterventionCandidate = {
  readonly kind: 'candidate';
  readonly graph: EditableGraph;
  readonly operations: PatchOperation[];
  readonly handlerFact: NonNullable<ReturnType<typeof buildEditGraphHandlerFact>>;
  readonly analysisGraphHash: string;
};

/** Existing edit machinery prepares the candidate; this function does no I/O. */
export function applyOptionInterventionEdit(input: OptionInterventionTransactionInput):
  | OptionInterventionCandidate
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string } {
  const prepared = prepareOptionInterventionEdit(input);
  if (prepared.kind !== 'prepared') return prepared;
  const refuse = (reason: string) => ({ kind: 'refused' as const, reason });
  const before = input.persistedGraph;
  if (!isEditableGraph(before)) return refuse('canonical_graph_unavailable');
  if (!isDeepStrictEqual(projectGraphForPersistence(before), before)) {
    return refuse('unrelated_canonical_repair_required');
  }
  try {
    const raw = parseEditGraphResponse(JSON.stringify({ operations: [prepared.operation],
      removed_edges: [], warnings: [], coaching: null })).operations;
    const validated = validatePatchOperations(raw, before);
    if (!validated.valid || validated.operations.length !== 1) return refuse('operation_invalid');
    const operations = validated.operations;
    const decision = evaluateEditGraphMutations({ mode: 'live', operations,
      currentGraph: before, currentGraphHash: input.expectedGraphHash,
      baseGraphHash: input.expectedGraphHash, freshness: input.freshness,
      scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId });
    if (decision.blockApply || decision.governing !== 'proceed') return refuse(`mutation_${decision.governing}`);
    const applied = applyPatchOperations(before, operations);
    const encoded = encodeOptionInterventionsForEdit(applied, new Set([input.optionId]));
    if (encoded.unresolvedOptionIds.length > 0) return refuse('intervention_encoding_unavailable');
    const graph = projectGraphForPersistence(mergeAppliedGraphForPersistence({
      appliedGraph: encoded.graph, persistedBase: before, ingressBase: before,
      scenarioId: input.scenarioId, requestId: input.requestId,
    }));
    if (!isEditableGraph(graph) || !optionInterventionPostimageIsScoped(before, graph, input)) {
      return refuse('mutation_scope_mismatch');
    }
    const analysisGraphHash = computeAnalysisAffectingGraphHash(graph);
    if (!analysisGraphHash || analysisGraphHash === input.expectedGraphHash) return refuse('effect_not_changed');
    const appliedChanges = buildAppliedChanges(operations, graph, input.hasExistingAnalysis, before);
    const handlerFact = buildEditGraphHandlerFact({
      editResult: { blocks: [], assistantText: appliedChanges.summary, latencyMs: 0,
        wasRejected: false, operations, appliedGraph: graph, appliedChanges },
      preEditGraph: before, hasExistingAnalysis: input.hasExistingAnalysis,
    });
    if (handlerFact === null) return refuse('mutation_fact_unavailable');
    return { kind: 'candidate', graph, operations, handlerFact, analysisGraphHash };
  } catch {
    return refuse('mutation_preparation_failed');
  }
}

export type OptionInterventionExecutionInput = Omit<OptionInterventionTransactionInput, 'persistedGraph'> & {
  readonly stage: OlumiResponse['stage_indicator'];
  /** Existing caller request digest: informational, NOT the idempotency key. */
  readonly requestHash: string;
};

/**
 * Isolated server handler. The caller must supply an already-authorised,
 * scenario-bound store and invocation. This does not admit a public event,
 * authenticate an actor, confirm an estimate or adopt a normative target.
 */
export async function executeOptionInterventionEdit(input: OptionInterventionExecutionInput, store: OptionInterventionStore): Promise<
  | { readonly kind: 'committed'; readonly response: OlumiResponse; readonly graph: unknown;
      readonly analysisGraphHash: string; readonly persistedRowId: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unverified'; readonly reason: string; readonly commitAttempted: boolean }
> {
  let before: unknown;
  let pendings: Awaited<ReturnType<OptionInterventionStore['readMostRecentPendingActions']>>;
  try {
    before = await store.loadGraph(input.scenarioId);
    pendings = await store.readMostRecentPendingActions(input.scenarioId, { validation: 'strict' });
  } catch {
    return { kind: 'unverified', reason: 'canonical_read_failed', commitAttempted: false };
  }
  const candidate = applyOptionInterventionEdit({ ...input, persistedGraph: before });
  if (candidate.kind !== 'candidate') return candidate;
  const option = candidate.graph.nodes.find(node => node.id === input.optionId)!;
  const factor = candidate.graph.nodes.find(node => node.id === input.factorId)!;
  const holds = threadHoldsThroughMutatingCommit({ priorPendingActions: pendings,
    graphAfterCommit: candidate.graph, graphHashAfterCommit: candidate.analysisGraphHash,
    appliedOperations: candidate.operations, nowMs: Date.now(),
    scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId });
  const acknowledgment = formatOptionEffectWriteAck({ optionLabel: option.label,
    factorLabel: factor.label, committedValue: input.modelValue });
  const response: OlumiResponse = { response_version: 2,
    assistant_text: holds.notice ? `${acknowledgment}\n\n${holds.notice}` : acknowledgment,
    blocks: [], suggested_actions: [], insights: [], stage_indicator: input.stage };
  let committed: Awaited<ReturnType<typeof commitDirectAnswer>>;
  try {
    committed = await commitDirectAnswer(response, {
      scenario_id: input.scenarioId, turn_id: input.turnId, request_hash: input.requestHash,
      turn_class: 'direct_answer', handler_id: null, llm_calls_used: 0, duration_ms: 0,
      handler_facts: [candidate.handlerFact], graph: candidate.graph, contentGraph: candidate.graph,
      baseGraphForInvariants: before, ...computeExpectedGraphCasHashes(before),
      graph_hash: candidate.analysisGraphHash, priorPendingActions: holds.threaded,
    }, store);
  } catch {
    // A transport error need not prove rollback. No Applied response or claim
    // of "nothing changed" escapes; retry/readback must settle that question.
    return { kind: 'unverified', reason: 'commit_not_confirmed', commitAttempted: true };
  }
  try {
    const reloaded = await store.loadGraph(input.scenarioId);
    // CommitResult.persistedGraph is projected INPUT, not DB readback. A
    // duplicate turn may return an older row without applying new request bytes.
    if (!committed.graphPersisted || !isDeepStrictEqual(reloaded, candidate.graph)
      || readCommittedOptionEffect(reloaded, input.optionId, input.factorId) !== input.modelValue) {
      return { kind: 'unverified', reason: 'committed_graph_mismatch', commitAttempted: true };
    }
    // The graph answers "what is saved now?", not "what did this turn
    // commit?". A duplicate key can return an old parent even when another
    // turn has since produced the requested current graph. Bind the existing
    // parent and its atomic fact before returning this invocation's response.
    const parents = (await store.readRecent(input.scenarioId))
      .filter(row => row.id === committed.persisted_row_id);
    const parent = parents[0];
    if (parents.length !== 1 || parent?.scenario_id !== input.scenarioId
      || parent.turn_id !== input.turnId || parent.request_hash !== input.requestHash
      || typeof store.readFactsWithTurnFor !== 'function') {
      return { kind: 'unverified', reason: 'committed_turn_unverified', commitAttempted: true };
    }
    const facts = await store.readFactsWithTurnFor([committed.persisted_row_id]);
    if (facts.length !== 1 || facts[0]?.turn_id !== committed.persisted_row_id
      || !isDeepStrictEqual(facts[0].fact, candidate.handlerFact)) {
      return { kind: 'unverified', reason: 'committed_fact_unverified', commitAttempted: true };
    }
    // Guest/no-version success is valid. If a version receipt exists, it
    // must describe this very turn and postimage, not an older replay row.
    const receipt = committed.modelVersionReceipt;
    if (receipt !== null && (receipt.source_turn_id !== input.turnId
      || !isDeepStrictEqual(receipt.graph, reloaded))) {
      return { kind: 'unverified', reason: 'committed_receipt_mismatch', commitAttempted: true };
    }
    return { kind: 'committed', response: committed.response, graph: reloaded,
      analysisGraphHash: candidate.analysisGraphHash, persistedRowId: committed.persisted_row_id };
  } catch {
    return { kind: 'unverified', reason: 'canonical_readback_failed', commitAttempted: true };
  }
}

export function prepareOptionInterventionEdit(input: OptionInterventionEditInput):
  | { readonly kind: 'prepared'; readonly operation: Record<string, unknown> }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string } {
  const refuse = (reason: string) => ({ kind: 'refused' as const, reason });
  if (!Number.isFinite(input.modelValue) || input.modelValue < 0 || input.modelValue > 1) {
    return refuse('invalid_model_value');
  }
  if (!CANONICAL_ID_REGEX.test(input.optionId) || !CANONICAL_ID_REGEX.test(input.factorId)) {
    return refuse('invalid_identity');
  }

  // Validate the persisted ingress representation without repairing it. Strict
  // GraphV3 rejects sanctioned legacy sigma values; flooring them here would
  // change the very analysis identity this edit must check and preserve.
  const parsed = GraphStateIngressSchema.safeParse(input.persistedGraph);
  if (!parsed.success || !assertIngressGraphNumericBounds(parsed.data).ok) {
    return refuse('canonical_graph_unavailable');
  }
  const graph = parsed.data;
  if (!input.expectedGraphHash || computeAnalysisAffectingGraphHash(graph) !== input.expectedGraphHash) {
    return refuse('stale_graph');
  }
  const options = graph.nodes.filter(node => node.id === input.optionId);
  const factors = graph.nodes.filter(node => node.id === input.factorId);
  const option = options[0];
  const factor = factors[0];
  if (options.length !== 1 || factors.length !== 1 || option?.kind !== 'option' || factor?.kind !== 'factor'
    || typeof option.label !== 'string' || typeof factor.label !== 'string') {
    return refuse('unresolved_identity');
  }
  // Reuse the conversational writer's identity-link question, not a new
  // topology/science admission policy. Unique endpoint identity is checked
  // above; the established reader owns which factor IDs an option addresses.
  if (!linkedFactorsOf(graph, option.id).some(linked => linked.id === factor.id)) {
    return refuse('unresolved_effect_relationship');
  }

  const interventions = option.interventions;
  if (interventions !== undefined && (interventions === null || typeof interventions !== 'object'
    || Array.isArray(interventions))) return refuse('invalid_existing_intervention');
  const existing = interventions && Object.hasOwn(interventions, factor.id)
    ? (interventions as Record<string, unknown>)[factor.id] : undefined;
  // A canonical key alone is not read authority: existing consumers may select
  // a newer nested/slash-keyed carrier. Do not manufacture a no-op from its
  // stale top-level mirror or silently promote a legacy carrier here.
  if (mergeInterventionSourceObjects(option)[factor.id] !== existing) {
    return refuse('noncanonical_intervention_source');
  }
  if (existing !== undefined) {
    const entry = InterventionV3.safeParse(existing);
    if (!entry.success || entry.data.target_match.node_id !== factor.id) {
      return refuse('invalid_existing_intervention');
    }
    // This adapter records changed values, not adoption/confirmation. A repeat
    // must not turn the old AI estimate into a new user-authored measurement.
    if (entry.data.value === input.modelValue) return { kind: 'unchanged' };
  }
  return {
    kind: 'prepared',
    operation: buildOptionEffectRawOperation({
      optionId: option.id, optionLabel: option.label,
      factorId: factor.id, factorLabel: factor.label, value: input.modelValue,
    }),
  };
}
