import { CANONICAL_ID_REGEX } from '../../cee/utils/id-normalizer.js';
import { isDeepStrictEqual } from 'node:util';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { z } from 'zod';
import { GraphV3, InterventionV3, TargetMatch, type GraphV3T } from '../../schemas/cee-v3.js';

/**
 * ⭐⭐ WHAT THIS WRITER NEEDS TO READ OFF AN EXISTING ENTRY — deliberately NOT
 * the producer's `InterventionV3`.
 *
 * `InterventionV3` is the shape the encoder EMITS, and it requires
 * `target_match`. Using it to VALIDATE stored state made every brief-extracted
 * option uneditable: real persisted entries look like
 * `{ value: 1, source: 'brief_extraction', display_value: 'Very high (1)' }`,
 * so the parse failed on a field the writing path never wrote (witnessed
 * 2026-09-09 10:25, request `6ec75b90`, 422 `invalid_existing_intervention`).
 *
 * A producer schema is not a reader contract. This declares only what is
 * actually consumed here — the value being replaced, and the stated target when
 * one exists — and keeps `.passthrough()` so every other persisted field
 * survives untouched.
 *
 * ⚠ `target_match` OPTIONAL HERE IS NOT A WEAKENING, and the encoder is the
 * proof: `encode-option-interventions.ts:165-175` already treats a missing
 * `target_match` as ordinary and synthesises `{node_id: fac, match_type:
 * 'exact_id'}` from the canonical KEY. The write path has always held that the
 * key is the identity; only this read disagreed. A target that IS stated is
 * still checked, and a mismatch still refuses.
 */
const ExistingInterventionRead = z.object({
  value: z.number().finite(),
  // ⚠ `source` STAYS REQUIRED, AND IS DERIVED FROM THE PRODUCER RATHER THAN
  // RE-SPELLED. Relaxing the whole read to admit a missing `target_match` also
  // dropped this check, and a stored `source` OUTSIDE the producer's three-member
  // enum — the legacy override spelling — began passing and being overwritten
  // with `user_specified`. That is precisely the "silently replacing existing
  // provenance with user authority" this writer must refuse, and an existing
  // test names it. The witnessed 422 was about `target_match` alone; nothing
  // about it licensed widening `source`.
  //
  // ⚠⚠ AND THE LEGACY SPELLING IS NOT WRITTEN OUT HERE ON PURPOSE.
  // `no-brief-derived-user-override.writers.test.ts` scans every src/ file for
  // that literal and REDs on any file outside its reviewed manifest — a
  // whole-file substring scan, so a mere mention trips it. This module has no
  // write path for that stamp, so the honest answer is to keep the literal out
  // rather than to enter a non-writer into a guard that exists to enumerate
  // writers. Widening the manifest for a comment would have weakened it.
  source: InterventionV3.shape.source,
  target_match: TargetMatch.optional(),
}).passthrough();
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
import { APPROVED_LEVEL_ADOPTION_SOURCE, approvedLevelSourceFor } from '../agent-lane/approved-adoption-context.js';
import { structuralEdgeValue } from '../routing/add-option-transaction.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';

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
  /**
   * The cell's stamp when it is NOT the user's own level: an approved adoption of Olumi's
   * proposed level (`approvedLevelSourceFor`). Absent → `user_specified`, the inspector's
   * stamp. Never from a wire field: `executeOptionInterventionEdit` derives it server-side.
   */
  readonly source?: typeof APPROVED_LEVEL_ADOPTION_SOURCE;
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

/** One (option, factor) level this commit writes, with the cell's stamp when it is not the user's own. */
export type OptionLevelTarget = Pick<OptionInterventionEditInput, 'optionId' | 'factorId' | 'modelValue' | 'source'>;

/**
 * Compare to the original persisted bytes, not two independently normalised
 * graphs. Only the selected cell and its existing canonical mirror may change.
 * The restored graph is a comparison specimen, never a second write producer.
 */
export function optionInterventionPostimageIsScoped(
  before: unknown,
  after: unknown,
  target: OptionLevelTarget,
  /** The ONE option → factor topology link this same commit adds (a level brings its link); nothing else may add it. */
  addedLink?: { readonly from: string; readonly to: string },
): boolean {
  return optionInterventionBatchPostimageIsScoped(before, after, [target], addedLink !== undefined ? [addedLink] : []);
}

/**
 * ⭐ THE SAME GUARD FOR A WHOLE APPROVED BATCH (one user operation → ONE commit, ChatGPT #70 5847200462): every
 * selected cell, each declared option → factor link and the options mirror may change — nothing else, and no cell
 * or link the batch did not declare.
 */
export function optionInterventionBatchPostimageIsScoped(
  before: unknown,
  after: unknown,
  targets: readonly OptionLevelTarget[],
  addedLinks: readonly { readonly from: string; readonly to: string }[] = [],
): boolean {
  if (!isEditableGraph(before) || !isEditableGraph(after)) return false;
  if (!isDeepStrictEqual(projectGraphForPersistence(before), before)) return false;
  if (targets.length === 0 || new Set(targets.map(t => `${t.optionId}::${t.factorId}`)).size !== targets.length) return false;
  const restored = structuredClone(after);
  // Derive the options[] mirror through its existing owner, never a copied
  // list of status/raw-intervention/provenance reconciliation rules.
  const specimen = structuredClone(before);
  const newContainers = new Set<string>();
  for (const target of targets) {
    const oldNodes = before.nodes.filter(node => node.id === target.optionId);
    const newNodes = after.nodes.filter(node => node.id === target.optionId);
    if (oldNodes.length !== 1 || newNodes.length !== 1) return false;
    const oldNode = oldNodes[0]!;
    const newNode = newNodes[0]!;
    const entry = InterventionV3.safeParse(newNode.interventions?.[target.factorId]);
    if (!entry.success || entry.data.value !== target.modelValue
      || entry.data.source !== (target.source ?? 'user_specified') || entry.data.target_match.node_id !== target.factorId) return false;
    const restoredNode = restored.nodes.find(node => node.id === target.optionId)!;
    if (oldNode.interventions === undefined) {
      // A new container may hold only this batch's cells, never unrelated invented cells (checked once all are removed).
      newContainers.add(target.optionId);
      delete restoredNode.interventions![target.factorId];
    } else if (Object.hasOwn(oldNode.interventions, target.factorId)) {
      restoredNode.interventions![target.factorId] = structuredClone(oldNode.interventions[target.factorId]);
    } else {
      delete restoredNode.interventions![target.factorId];
    }
    const specimenNode = specimen.nodes.find(node => node.id === target.optionId)!;
    specimenNode.interventions = { ...specimenNode.interventions,
      [target.factorId]: structuredClone(newNode.interventions![target.factorId]) };
  }
  for (const optionId of newContainers) {
    const restoredNode = restored.nodes.find(node => node.id === optionId)!;
    if (Object.keys(restoredNode.interventions ?? {}).length !== 0) return false;
    delete restoredNode.interventions;
  }
  for (const addedLink of addedLinks) {
    // Exactly one new edge for exactly a declared pair, absent before, with the topology constants and its level's source.
    const owner = targets.find(t => t.optionId === addedLink.from && t.factorId === addedLink.to);
    const isLink = (e: { from: string; to: string }) => e.from === addedLink.from && e.to === addedLink.to;
    const added = restored.edges.filter(isLink);
    const link = added[0] as (typeof added)[number] & { provenance?: { source?: unknown } } | undefined;
    if (owner === undefined || before.edges.some(isLink) || added.length !== 1 || link === undefined
      || link.strength.mean !== STRUCTURAL_EDGE_DEFAULTS.strength.mean
      || link.exists_probability !== STRUCTURAL_EDGE_DEFAULTS.exists_probability
      || link.provenance?.source !== (owner.source ?? 'user_specified')) return false;
    restored.edges = restored.edges.filter(e => !isLink(e));
  }
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
  /** This commit also added the option → factor link(s) the level(s) need. */
  readonly linkAdded: boolean;
  readonly linksAdded: number;
  /** The targets this commit writes (a target the model already holds exactly is left out). */
  readonly targetsWritten: readonly OptionLevelTarget[];
};

/** The whole approved batch: N levels on existing options, against ONE base revision. */
export type OptionInterventionBatchTransactionInput =
  Omit<OptionInterventionTransactionInput, 'optionId' | 'factorId' | 'modelValue' | 'source'> & {
    readonly targets: readonly OptionLevelTarget[];
  };

/** Existing edit machinery prepares the candidate; this function does no I/O. */
export function applyOptionInterventionEdit(input: OptionInterventionTransactionInput):
  | OptionInterventionCandidate
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string } {
  const { optionId, factorId, modelValue, source, ...rest } = input;
  const result = applyOptionInterventionBatch({ ...rest,
    targets: [{ optionId, factorId, modelValue, ...(source !== undefined ? { source } : {}) }] });
  return result.kind === 'refused' ? { kind: 'refused', reason: result.reason } : result;
}

/**
 * ⭐ ONE USER OPERATION → ONE ATOMIC COMMIT (ChatGPT #70 5847200462, Runtime 5847274522). N levels — each with the
 * option → factor link it needs — prepared against ONE base revision and written as ONE validate → referee → apply →
 * scope-guard candidate. ALL OR NOTHING: any target refused refuses the whole batch (`index` names it), so no half of
 * an approved request is ever committed. No I/O.
 */
export function applyOptionInterventionBatch(input: OptionInterventionBatchTransactionInput):
  | OptionInterventionCandidate
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string; readonly index?: number } {
  const refuse = (reason: string, index?: number) => ({ kind: 'refused' as const, reason, ...(index !== undefined ? { index } : {}) });
  if (input.targets.length === 0) return refuse('no_targets');
  if (new Set(input.targets.map(t => `${t.optionId}::${t.factorId}`)).size !== input.targets.length) return refuse('duplicate_target');
  const written: OptionLevelTarget[] = [];
  const levelOps: Record<string, unknown>[] = [];
  const linkOps: { readonly operation: Record<string, unknown>; readonly target: OptionLevelTarget }[] = [];
  for (let i = 0; i < input.targets.length; i += 1) {
    const target = input.targets[i]!;
    const prepared = prepareOptionInterventionEdit({ persistedGraph: input.persistedGraph,
      optionId: target.optionId, factorId: target.factorId, modelValue: target.modelValue,
      expectedGraphHash: input.expectedGraphHash, ...(target.source !== undefined ? { source: target.source } : {}) });
    if (prepared.kind === 'refused') return refuse(prepared.reason, i);
    if (prepared.kind === 'unchanged') continue;
    written.push(target);
    levelOps.push(prepared.operation);
    if (prepared.linkOperation !== undefined) linkOps.push({ operation: prepared.linkOperation, target });
  }
  if (written.length === 0) return { kind: 'unchanged' };
  const before = input.persistedGraph;
  if (!isEditableGraph(before)) return refuse('canonical_graph_unavailable');
  if (!isDeepStrictEqual(projectGraphForPersistence(before), before)) {
    return refuse('unrelated_canonical_repair_required');
  }
  try {
    // ⭐ A level brings its link: every link FIRST, then every level, in this ONE validate → apply → commit.
    const rawOps = [...linkOps.map(l => l.operation), ...levelOps];
    const raw = parseEditGraphResponse(JSON.stringify({ operations: rawOps,
      removed_edges: [], warnings: [], coaching: null })).operations;
    const validated = validatePatchOperations(raw, before);
    if (!validated.valid || validated.operations.length !== rawOps.length) return refuse('operation_invalid');
    const operations = validated.operations;
    // The links are exactly the leading `add_edge`s, one per declared pair. They are NOT refereed: each is the
    // topology link its level implies (the product's own link writer, `structural_add_edge`, is not refereed either),
    // and `optionInterventionBatchPostimageIsScoped` below pins each to one topology edge with its level's source.
    for (let i = 0; i < linkOps.length; i += 1) {
      const t = linkOps[i]!.target;
      if (operations[i]?.op !== 'add_edge' || operations[i]?.path !== `${t.optionId}::${t.factorId}`) return refuse('operation_invalid');
    }
    const levelOperations = operations.slice(linkOps.length);
    const decision = evaluateEditGraphMutations({ mode: 'live', operations: levelOperations,
      currentGraph: before, currentGraphHash: input.expectedGraphHash,
      baseGraphHash: input.expectedGraphHash, freshness: input.freshness,
      scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId });
    if (decision.blockApply || decision.governing !== 'proceed') return refuse(`mutation_${decision.governing}`);
    const applied = applyPatchOperations(before, operations);
    const encoded = encodeOptionInterventionsForEdit(applied, new Set(written.map(t => t.optionId)));
    if (encoded.unresolvedOptionIds.length > 0) return refuse('intervention_encoding_unavailable');
    const graph = projectGraphForPersistence(mergeAppliedGraphForPersistence({
      appliedGraph: encoded.graph, persistedBase: before, ingressBase: before,
      scenarioId: input.scenarioId, requestId: input.requestId,
    }));
    const addedLinks = linkOps.map(l => ({ from: l.target.optionId, to: l.target.factorId }));
    if (!isEditableGraph(graph) || !optionInterventionBatchPostimageIsScoped(before, graph, written, addedLinks)) {
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
    return { kind: 'candidate', graph, operations, handlerFact, analysisGraphHash,
      linkAdded: linkOps.length > 0, linksAdded: linkOps.length, targetsWritten: written };
  } catch {
    return refuse('mutation_preparation_failed');
  }
}

/** `source` is not an input here: it is derived below from the server-internal adoption context. */
export type OptionInterventionExecutionInput = Omit<OptionInterventionTransactionInput, 'persistedGraph' | 'source'> & {
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
  const { optionId, factorId, modelValue, ...rest } = input;
  const outcome = await executeOptionInterventionBatch({ ...rest, targets: [{ optionId, factorId, modelValue }] }, store);
  return outcome.kind === 'refused' ? { kind: 'refused', reason: outcome.reason } : outcome;
}

/** The whole approved batch; each cell's stamp is derived server-side, never taken from the caller. */
export type OptionInterventionBatchExecutionInput =
  Omit<OptionInterventionExecutionInput, 'optionId' | 'factorId' | 'modelValue'> & {
    readonly targets: readonly Pick<OptionLevelTarget, 'optionId' | 'factorId' | 'modelValue'>[];
    /**
     * The links the APPROVED proposal declared (`from::to`). When given, the links this commit would add must be
     * exactly these, or nothing is written (`links_mismatch`): what was approved is what is written.
     */
    readonly expectedLinks?: readonly string[];
  };

/**
 * ⭐ N levels (and the links they need) as ONE commit: one append, one handler fact, one read-back, one receipt.
 * All or nothing — a refused target commits NOTHING — and a retry on the same turn id is the store's replay.
 */
export async function executeOptionInterventionBatch(input: OptionInterventionBatchExecutionInput, store: OptionInterventionStore): Promise<
  | { readonly kind: 'committed'; readonly response: OlumiResponse; readonly graph: unknown;
      readonly analysisGraphHash: string; readonly persistedRowId: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string; readonly index?: number }
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
  // ⭐ Whose level this is: Olumi's, when THIS write is the approved adoption the Agent's verified
  // proposal names (same scenario, option, factor, value); otherwise the inspector's `user_specified`.
  // Set LAST and unconditionally: a `source` a caller slipped onto the input is overwritten, never kept.
  const targets: OptionLevelTarget[] = input.targets.map(t => {
    const source = approvedLevelSourceFor(input.scenarioId, t.optionId, t.factorId, t.modelValue);
    return { optionId: t.optionId, factorId: t.factorId, modelValue: t.modelValue, ...(source !== undefined ? { source } : {}) };
  });
  const { targets: _callerTargets, expectedLinks, ...common } = input;
  const candidate = applyOptionInterventionBatch({ ...common, persistedGraph: before, targets });
  if (candidate.kind !== 'candidate') return candidate;
  if (expectedLinks !== undefined) {
    const adding = candidate.operations.filter(o => o.op === 'add_edge').map(o => o.path).sort();
    if (!isDeepStrictEqual(adding, [...new Set(expectedLinks)].sort())) return { kind: 'refused', reason: 'links_mismatch' };
  }
  const labelOf = (id: string): string => String(candidate.graph.nodes.find(node => node.id === id)?.label ?? id);
  const holds = threadHoldsThroughMutatingCommit({ priorPendingActions: pendings,
    graphAfterCommit: candidate.graph, graphHashAfterCommit: candidate.analysisGraphHash,
    appliedOperations: candidate.operations, nowMs: Date.now(),
    scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId });
  const linked = new Set(candidate.operations.filter(o => o.op === 'add_edge').map(o => o.path));
  const acknowledgment = candidate.targetsWritten.map(t => formatOptionEffectWriteAck({ optionLabel: labelOf(t.optionId),
    factorLabel: labelOf(t.factorId), committedValue: t.modelValue })
    + (linked.has(`${t.optionId}::${t.factorId}`) ? ` ${labelOf(t.optionId)} is now linked to ${labelOf(t.factorId)}, in the same change.` : ''))
    .join(' ');
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
      || input.targets.some(t => readCommittedOptionEffect(reloaded, t.optionId, t.factorId) !== t.modelValue)) {
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
  | { readonly kind: 'prepared'; readonly operation: Record<string, unknown>; readonly linkOperation?: Record<string, unknown> }
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
  //
  // ⭐ A LEVEL BRINGS ITS LINK (DL #70 5847137399: one user operation → one approval → ONE atomic commit). An option
  // not yet linked to this factor gets the option → factor TOPOLOGY link in this same commit, stamped with the
  // level's own source (#1992), so a refusal or a concurrent edit can never leave a link without its level.
  // Still refused: a pair already joined another way (a reversed edge — a forward one beside it would be a cycle),
  // and an orphan cell on an unlinked factor (never silently re-stamped).
  let linkOperation: Record<string, unknown> | undefined;
  if (!linkedFactorsOf(graph, option.id).some(linked => linked.id === factor.id)) {
    const joined = graph.edges.some(e => (e.from === option.id && e.to === factor.id) || (e.from === factor.id && e.to === option.id));
    const orphanCell = option.interventions !== undefined && option.interventions !== null
      && typeof option.interventions === 'object' && Object.hasOwn(option.interventions, factor.id);
    if (joined || orphanCell) return refuse('unresolved_effect_relationship');
    linkOperation = {
      op: 'add_edge', path: `${option.id}::${factor.id}`,
      value: structuralEdgeValue(option.id, factor.id, input.source ?? 'user_specified'),
      old_value: null, impact: 'moderate',
      rationale: `Links ${option.label} to ${factor.label}, which the level set on it needs.`,
    };
  }
  const withLink = linkOperation !== undefined ? { linkOperation } : {};

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
    /**
     * ⭐⭐⭐ THIS READ USED THE PRODUCER'S SCHEMA AS A READER CONTRACT, AND THAT
     * IS WHAT WALLED THE FIRST MANUAL SAVE.
     *
     * WITNESSED 2026-09-09 10:25 UTC, request `6ec75b90`: an ordinary restored
     * example, a valid write base (`206a2073d0976287` from the real graph read),
     * no chat and no analysis — and the Save returned 422
     * `system_event_refused_no_write` / `invalid_existing_intervention`. Nothing
     * was written. The user typed a number into a mounted control and the system
     * refused it.
     *
     * The cause is one line: `InterventionV3.safeParse(existing)`.
     * `InterventionV3.target_match` is REQUIRED (`schemas/cee-v3.ts:454`), and
     * the graph the estate actually persists does not carry it — the restored
     * entry read back was
     * `{ value: 1, source: 'brief_extraction', display_value: 'Very high (1)' }`.
     * So the parse failed on a field the WRITING path never produces, and every
     * option in every brief-extracted example was uneditable.
     *
     * ⚠ THE GUARD'S PURPOSE IS ANTI-RETARGETING, AND IT IS KEPT. What it must
     * establish is that the entry being overwritten really addresses THIS
     * factor. `target_match` is one way to know that — it is not the only one,
     * and it is absent from real data. The canonical KEY is the other, and it
     * has ALREADY been established four lines above: `mergeInterventionSourceObjects`
     * proved this entry is the canonical source for `factor.id`, refusing
     * otherwise. Demanding `target_match` on top adds nothing about retargeting
     * and rejects legitimate stored state.
     *
     * So the requirement is narrowed to what the writer actually needs and what
     * the data can attest:
     *   · `value` must be a finite number — it is the thing being compared and
     *     replaced, and without it there is no no-op check;
     *   · `target_match`, WHEN PRESENT, must still name this factor. A stated
     *     mismatch is still a refusal, unchanged.
     *
     * ⚠ THIS IS NOT A BYPASS. Nothing downstream is relaxed: the referee, the
     * scope check, the postimage hash verification and the commit guard are
     * untouched, and a genuinely unreadable entry still refuses below.
     */
    const entry = ExistingInterventionRead.safeParse(existing);
    if (!entry.success) {
      return refuse('invalid_existing_intervention');
    }
    const statedTarget = entry.data.target_match?.node_id;
    if (statedTarget !== undefined && statedTarget !== factor.id) {
      return refuse('invalid_existing_intervention');
    }
    // This adapter records changed values, not adoption/confirmation. A repeat
    // must not turn the old AI estimate into a new user-authored measurement.
    if (entry.data.value === input.modelValue) return { kind: 'unchanged' };
  }
  const operation = buildOptionEffectRawOperation({
    optionId: option.id, optionLabel: option.label,
    factorId: factor.id, factorLabel: factor.label, value: input.modelValue,
  });
  if (input.source === undefined) return { kind: 'prepared', operation, ...withLink };
  // An adopted Olumi level: the encoder PRESERVES this member (`PRESERVED_INTERVENTION_SOURCES`)
  // instead of defaulting the cell to `user_specified`, and the rationale says whose it is.
  return {
    kind: 'prepared',
    operation: {
      ...operation,
      value: { ...(operation.value as Record<string, unknown>), source: input.source },
      rationale: `Records the level Olumi proposed, and the user approved, for ${option.label} on ${factor.label}.`,
    },
    ...withLink,
  };
}
