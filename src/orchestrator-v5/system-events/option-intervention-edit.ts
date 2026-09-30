import { CANONICAL_ID_REGEX } from '../../cee/utils/id-normalizer.js';
import { isDeepStrictEqual } from 'node:util';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { z } from 'zod';
import { InterventionV3, TargetMatch } from '../../schemas/cee-v3.js';

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
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';
import { parseEditGraphResponse, buildAppliedChanges } from '../../orchestrator/tools/edit-graph.js';
import { validatePatchOperations } from '../../orchestrator/patch-validation.js';
import { applyPatchOperations } from '../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { identityConfirmBaseIsWritable, isEditableGraph, type EditableGraph } from './editable-graph.js';
import { commitDirectAnswer } from '../commit.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { buildOptionEffectRawOperation, linkedFactorsOf, formatOptionEffectWriteAck, readCommittedOptionEffect } from '../routing/option-effect-write.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { buildEditGraphHandlerFact } from '../handlers/edit-graph-fact-builder.js';
import { evaluateEditGraphMutations } from '../handlers/edit-graph-referee-gate.js';
import { threadHoldsThroughMutatingCommit } from '../handlers/hold-thread-through.js';
import type { FrameFreshness } from '../graph-management/types.js';
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../persisted-graph-projection.js';
import { interventionKeysFollowInterventions } from '../reindex-intervention-keys.js';
import { reconcileTopLevelOptionsFromNodes } from '../reconcile-top-level-options.js';
import { APPROVED_LEVEL_ADOPTION_SOURCE, approvedLevelSourceFor, runWithApprovedAdoption, runWithApprovedLinkAdoptions } from '../agent-lane/approved-adoption-context.js';
import { runWithStatedLinkBand } from '../agent-lane/stated-link-band-context.js';
import { factorUnitOf } from '../agent-lane/unit-conflict.js';
import type { IdentityRunUse } from '../compose/definitional-links.js';
import type { InfluenceBand } from '../format/influence-bands.js';
import { structuralEdgeValue } from '../routing/add-option-transaction.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { applyFactorValueEdit, type FactorValueEditResult } from './factor-value-edit.js';
import { applyEdgeStrengthEdit } from './edge-strength-edit.js';
import { applyLinkEffectEdit, type LinkEffectStatement } from './link-effect-edit.js';
import { applyIdentityConfirmEdit, identityConfirmPostimageIsScoped } from './identity-confirm-edit.js';
import { frameDefaultedLinks, groupResizedLinks, resizedLinksSentence } from '../../cee/magnitude/frame-defaulted-links.js';

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
  /**
   * ⭐ THE USER'S FIGURE, KEPT ON THE CELL (AI Conversation #70 5848429576): the level as they gave it and the range it
   * was normalised on. Without it a level on a factor with no range of its own (a NEW, value-less factor) is stored as a
   * bare model number and the figure is unrecoverable. It must normalise to `modelValue` exactly, or nothing is written.
   */
  readonly figure?: { readonly raw_value: number; readonly unit?: string; readonly cap: number };
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

// Derive the injected port from the canonical commit entrypoint. This module
// neither constructs a session store nor introduces another persistence API.
type OptionInterventionStore = NonNullable<Parameters<typeof commitDirectAnswer>[2]>;

/** One (option, factor) level this commit writes, with the cell's stamp when it is not the user's own. */
export type OptionLevelTarget = Pick<OptionInterventionEditInput, 'optionId' | 'factorId' | 'modelValue' | 'source' | 'figure'>;

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
  storedBefore: unknown,
  after: unknown,
  targets: readonly OptionLevelTarget[],
  addedLinks: readonly { readonly from: string; readonly to: string }[] = [],
): boolean {
  // The base with absence-equivalent drift removed (`normaliseAbsenceOnly`): not the writer's change.
  const before = normaliseAbsenceOnly(storedBefore);
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
  // The UI's index of the cells (`reindexInterventionKeys`) follows them: on a target option it may move exactly to
  // its re-derivation, and nowhere else. It is restored only when the new index is in step with the new cells.
  for (const optionId of new Set(targets.map(t => t.optionId))) {
    const oldNode = before.nodes.find(node => node.id === optionId)!;
    const newNode = after.nodes.find(node => node.id === optionId)!;
    const restoredNode = restored.nodes.find(node => node.id === optionId)!;
    if (Object.hasOwn(oldNode, 'interventionKeys') && Array.isArray(restoredNode.interventionKeys)
      && interventionKeysFollowInterventions(newNode)) {
      restoredNode.interventionKeys = structuredClone(oldNode.interventionKeys);
    }
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
      expectedGraphHash: input.expectedGraphHash, ...(target.source !== undefined ? { source: target.source } : {}),
      ...(target.figure !== undefined ? { figure: target.figure } : {}) });
    if (prepared.kind === 'refused') return refuse(prepared.reason, i);
    if (prepared.kind === 'unchanged') continue;
    written.push(target);
    levelOps.push(prepared.operation);
    if (prepared.linkOperation !== undefined) linkOps.push({ operation: prepared.linkOperation, target });
  }
  if (written.length === 0) return { kind: 'unchanged' };
  const before = input.persistedGraph;
  if (!isEditableGraph(before)) return refuse('canonical_graph_unavailable');
  // Only absence-equivalent drift may differ from the persisted form; the commit's projection removes it.
  if (!isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before))) {
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
/**
 * A factor value approved TOGETHER with option levels (one compound approval), in the user's own units — the figure
 * the user approved, never the model's 0–1 scale. The canonical value writer (`applyFactorValueEdit`) owns the
 * conversion, exactly as it does for an inspector edit.
 */
export interface ApprovedFactorValue {
  readonly factorId: string;
  readonly value: number;
  readonly unit?: string;
  /**
   * Olumi proposed this value and the user approved it: stamped as the user's ASSUMPTION through the writer's own
   * adoption authority (`runWithApprovedAdoption`), never as the user's own figure. It can only narrow the stamp.
   */
  readonly adopted?: boolean;
}
/**
 * A range for a factor that holds a bare amount and declares none — the one its figure (or the level read on it) was
 * normalised against. Applied AFTER the values, so a value and its range land in the same commit.
 */
export interface ApprovedFactorFrame {
  readonly factorId: string;
  readonly cap: number;
}
type ValueHandlerFact = Extract<FactorValueEditResult, { kind: 'mutated' }>['handlerFacts'][number];

/**
 * ⛔ ONLY THE DECLARED FACTORS' VALUES MAY CHANGE: on each declared factor, the members the canonical value writer owns
 * (`observed_state`, and the node's own `display_value`, `provenance` and `scale_frame` it restates with the value), and
 * the magnitude contract's own re-sizing of Olumi's links on it — nothing else anywhere in the graph: no other member,
 * node, edge, size, option or top-level field.
 */
const VALUE_WRITER_OWNED_NODE_MEMBERS = ['observed_state', 'display_value', 'provenance', 'scale_frame'] as const;
export function factorValuesPostimageIsScoped(storedBefore: unknown, after: unknown, factorIds: readonly string[]): boolean {
  // The base with absence-equivalent drift removed (`normaliseAbsenceOnly`): not the writer's change.
  const before = normaliseAbsenceOnly(storedBefore);
  if (!isEditableGraph(before) || !isEditableGraph(after)) return false;
  if (factorIds.length === 0 || new Set(factorIds).size !== factorIds.length) return false;
  const restored = structuredClone(after);
  for (const id of factorIds) {
    const was = before.nodes.filter(node => node.id === id);
    const now = restored.nodes.filter(node => node.id === id);
    if (was.length !== 1 || now.length !== 1 || was[0]!.kind !== 'factor') return false;
    const node = now[0]! as Record<string, unknown>;
    const prior = was[0]! as Record<string, unknown>;
    for (const member of VALUE_WRITER_OWNED_NODE_MEMBERS) {
      if (Object.hasOwn(prior, member)) node[member] = structuredClone(prior[member]);
      else delete node[member];
    }
  }
  /**
   * ⭐ OLUMI'S OWN LINKS FOLLOW THE LEVEL (MG #70 5849417275; #2033). The value writer re-sizes the Olumi-sized links on
   * a factor whose level moves. Each link after must be the link before (the writer left it) or EXACTLY the magnitude
   * contract's own re-derivation (`frameDefaultedLinks`) over the declared factors, on the levels the graph now holds.
   * That contract touches only Olumi's sizes, so a user's link, any other size and any link off these factors refuse.
   */
  if (restored.edges.length !== before.edges.length) return false;
  let rederived: unknown = { ...structuredClone(after), edges: structuredClone(before.edges) };
  for (const id of factorIds) rederived = frameDefaultedLinks(rederived, id).graph;
  const resized = (rederived as EditableGraph).edges;
  for (let i = 0; i < restored.edges.length; i += 1) {
    const now = restored.edges[i]!;
    const was = before.edges[i]!;
    if (now.from !== was.from || now.to !== was.to) return false;
    if (!isDeepStrictEqual(now, was) && !isDeepStrictEqual(now, resized[i])) return false;
  }
  restored.edges = structuredClone(before.edges);
  return isDeepStrictEqual(restored, before);
}

/**
 * ⭐ WHICH OF OLUMI'S LINKS THIS COMMIT RE-SIZED (P1-a, DL #70 5850069309; shape AI Quality 5850079041): exactly the
 * links that changed AND equal the magnitude contract's own re-derivation (`frameDefaultedLinks`) over the declared
 * factors — the same comparison the scope guard admits, never a bare graph diff, so a user's link can never appear.
 */
export function linksResizedByContract(before: unknown, after: unknown, factorIds: readonly string[]): { from: string; to: string }[] {
  if (!isEditableGraph(before) || !isEditableGraph(after) || before.edges.length !== after.edges.length) return [];
  let rederived: unknown = { ...structuredClone(after), edges: structuredClone(before.edges) };
  for (const id of factorIds) rederived = frameDefaultedLinks(rederived, id).graph;
  const resized = (rederived as EditableGraph).edges;
  const out: { from: string; to: string }[] = [];
  for (let i = 0; i < after.edges.length; i += 1) {
    const now = after.edges[i]!;
    if (!isDeepStrictEqual(now, before.edges[i]) && isDeepStrictEqual(now, resized[i])) out.push({ from: now.from, to: now.to });
  }
  return out;
}

/**
 * The approved values, applied IN MEMORY through the canonical value writer against ONE base, in order — the values
 * half of a compound approval, so that it commits in the SAME append as the levels. All or nothing: the first value
 * refused refuses the whole approval (`valueIndex` names it). No I/O beyond the writer's own (it writes nothing).
 */
async function applyApprovedFactorValues(
  before: EditableGraph,
  values: readonly ApprovedFactorValue[],
  frames: readonly ApprovedFactorFrame[],
  ctx: { readonly scenarioId: string; readonly turnId: string; readonly requestId: string; readonly stage: OlumiResponse['stage_indicator'] },
): Promise<
  | { readonly kind: 'applied'; readonly graph: EditableGraph; readonly handlerFacts: readonly ValueHandlerFact[]; readonly confirmations: readonly string[];
      readonly linksResized: readonly { from: string; to: string }[] }
  | { readonly kind: 'refused'; readonly reason: string; readonly valueIndex?: number; readonly frameIndex?: number }
> {
  const refuse = (reason: string, valueIndex: number) => ({ kind: 'refused' as const, reason, valueIndex });
  const refuseFrame = (reason: string, frameIndex: number) => ({ kind: 'refused' as const, reason, frameIndex });
  const seen = new Set<string>();
  // ⛔ A COPY, never the graph that was read (Canvas #70 5849242463): the frames below write in place, and a refused
  // approval must leave the read graph — and so the CAS base and the persisted model — exactly as it was.
  let working: unknown = structuredClone(before);
  const handlerFacts: ValueHandlerFact[] = [];
  const confirmations: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (seen.has(v.factorId)) return refuse('duplicate_value', i);
    seen.add(v.factorId);
    if (!Number.isFinite(v.value)) return refuse('value_invalid', i);
    const node = (working as EditableGraph).nodes.find(n => n.id === v.factorId);
    if (node === undefined || node.kind !== 'factor') return refuse('value_target_not_factor', i);
    const os = (node.observed_state ?? {}) as { cap?: unknown };
    const factorCap = typeof os.cap === 'number' && os.cap > 0 ? os.cap : undefined;
    const unit = v.unit !== undefined && v.unit.trim() !== '' ? v.unit.trim() : undefined;
    // The compound's own event, unchanged: on a capped factor the writer is handed the level AND the user's figure.
    // `intent: 'set'`: a figure the user approved is authorship even when it equals Olumi's (schemas 0.62.0; AIQ 5881494849).
    const event = { kind: 'factor_value_edit' as const, target_id: v.factorId, intent: 'set' as const,
      ...(factorCap !== undefined ? { value: v.value / factorCap, raw_value: v.value } : { value: v.value }),
      ...(unit !== undefined ? { unit } : {}) };
    const write = () => applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: ctx.turnId, scenario_id: ctx.scenarioId, stage: ctx.stage, event } as never,
      event: event as never, requestId: ctx.requestId, persistedGraph: working, priorFacts: [],
    });
    const res = v.adopted === true
      ? await runWithApprovedAdoption({ scenarioId: ctx.scenarioId, proposalId: ctx.turnId, targetId: v.factorId, rawValue: v.value }, write)
      : await write();
    if (res.kind !== 'mutated') return refuse(`value_${res.reason}`, i);
    working = res.mutatedGraph;
    handlerFacts.push(...res.handlerFacts);
    if (res.response.assistant_text) confirmations.push(res.response.assistant_text);
  }
  // ⭐ THE RANGES, IN THE SAME COMMIT: a factor holding a bare amount is read on the range the approval disclosed.
  const framedIds = new Set<string>();
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]!;
    if (framedIds.has(f.factorId)) return refuseFrame('duplicate_frame', i);
    framedIds.add(f.factorId);
    if (!Number.isFinite(f.cap) || !(f.cap > 0)) return refuseFrame('frame_invalid', i);
    const node = (working as EditableGraph).nodes.find(n => n.id === f.factorId) as (EditableGraph['nodes'][number] & { scale_frame?: unknown }) | undefined;
    if (node === undefined || node.kind !== 'factor') return refuseFrame('frame_target_not_factor', i);
    const os = (node.observed_state ?? {}) as Record<string, unknown>;
    const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
    // Only a bare amount with no range of its own: a factor that already declares one is never re-read on another.
    if (typeof raw !== 'number' || !Number.isFinite(raw) || typeof os.cap === 'number'
      || (typeof node.scale_frame === 'number' && node.scale_frame > 1)) return refuseFrame('frame_not_applicable', i);
    (node as Record<string, unknown>).observed_state = { ...os, value: raw / f.cap, raw_value: raw, cap: f.cap, declared_scale: 'unit_interval' };
  }
  // ⭐ A RANGE MOVES OLUMI'S LINKS TOO (MG #70 5849581652): the level a frame sets is a level like any other, so the
  // Olumi-sized links on that factor are re-derived on it — the same contract the value writer applies (#2033), and the
  // one the scope guard below re-derives over the values and frames together.
  for (const id of framedIds) working = frameDefaultedLinks(working, id).graph;
  const graph = projectGraphForPersistence(working);
  const touched = [...new Set([...values.map(v => v.factorId), ...frames.map(f => f.factorId)])];
  if (!isEditableGraph(graph) || !factorValuesPostimageIsScoped(before, graph, touched)) {
    return refuse('value_scope_mismatch', Math.max(0, values.length - 1));
  }
  return { kind: 'applied', graph, handlerFacts, confirmations, linksResized: linksResizedByContract(before, graph, touched) };
}

/**
 * ⭐ ONE LINK OF AN APPROVED SET OF LINK STRENGTHS (DL #72 5871594233; seam Canonical 5871633483, DL 5871661097). Paul's
 * production test (`64c5eccc`): four permissions recorded one link of eight. A set is written by the canonical link
 * writer (`applyEdgeStrengthEdit`, the canvas's own edit, with its expected-before tuple and its definitional-link
 * refusal) once per link, IN MEMORY, and committed as ONE append — all of them or none.
 */
export interface ApprovedLinkStrength {
  readonly from: string;
  readonly to: string;
  /** |mean| the link lands on: the band's midpoint (`set`), or the current |mean| kept (`confirm_current`). */
  readonly magnitude: number;
  readonly intent: 'set' | 'confirm_current';
  /**
   * The link as the approval saw it: any other mean, direction or REVIEW refuses the whole set. `reviewed_at` is the
   * link's `provenance.reviewed_by_user.at` (a confirm) when proposed, or null: a canvas confirm since then writes only
   * that stamp (#2257), which neither the mean nor the analysis hash can see.
   */
  readonly expected: { readonly mean: number; readonly effect_direction: 'positive' | 'negative'; readonly reviewed_at?: string | null };
  readonly band: InfluenceBand;
  /**
   * Olumi's band, adopted by the approval: stamped as Olumi's size (`olumi_estimate`), never the user's. Otherwise the
   * band the user named this turn, stamped as the canvas writer stamps it.
   */
  readonly adopted: boolean;
}

/**
 * ⭐ AN APPROVED USER-STATED LINK EFFECT (Canonical #72 5882780438 / 5882989451): ONE link sized from the user's own
 * words by the canonical writer (`applyLinkEffectEdit`). The revision it was prepared on is the batch's own base
 * (`expectedGraphHash`, the wire analysis hash); `edge_token` is every stored byte of the link at prepare time.
 */
export interface ApprovedLinkEffect {
  readonly from: string;
  readonly to: string;
  readonly effect: LinkEffectStatement;
  readonly edge_token: string;
  /** The user's verbatim words (1..400), carried on the receipt. */
  readonly quote: string;
  /** `linkEffectReadingToken` of the reading the approval card SHOWED; the writer refuses a write it does not match. */
  readonly reading_token: string;
}

/**
 * ⭐ AN APPROVED PRODUCT CONFIRMATION (DL #72 5887510885; Canonical 5887564539): "MRR = price × subscribers" recorded as
 * the user's own carrier on the quantity by the canonical writer (`applyIdentityConfirmEdit`). The revision it was issued
 * on is the batch's own base (`expectedGraphHash`).
 */
export interface ApprovedIdentityConfirm {
  readonly outcome_id: string;
  readonly factor_ids: readonly string[];
  /** The card's displayed sentence, bound into `reading_token`. */
  readonly words: string;
  /** `identityConfirmReadingToken` of the reading the approval card SHOWED; the writer refuses a write it does not match. */
  readonly reading_token: string;
}

/** The members of a link the canonical link writer owns: its size, direction and whose size it is. Nothing else. */
const LINK_WRITER_OWNED_EDGE_MEMBERS = ['strength', 'effect_direction', 'provenance', 'provenance_display', 'defaulted', 'exists_defaulted', 'std_defaulted'] as const;

/**
 * ⛔ ONLY THE DECLARED LINKS MAY CHANGE, and on each only what the link writer owns: no node, no other link, no edge
 * added or removed or re-ordered, no top-level field.
 */
export function linkStrengthsPostimageIsScoped(storedBefore: unknown, after: unknown, links: readonly { from: string; to: string }[]): boolean {
  const before = normaliseAbsenceOnly(storedBefore);
  if (!isEditableGraph(before) || !isEditableGraph(after) || links.length === 0) return false;
  if (new Set(links.map(l => `${l.from}::${l.to}`)).size !== links.length) return false;
  if (after.edges.length !== before.edges.length) return false;
  const restored = structuredClone(after);
  for (let i = 0; i < restored.edges.length; i += 1) {
    const now = restored.edges[i]! as Record<string, unknown> & { from: string; to: string };
    const was = before.edges[i]! as Record<string, unknown> & { from: string; to: string };
    if (now.from !== was.from || now.to !== was.to) return false;
    if (!links.some(l => l.from === was.from && l.to === was.to)) continue;
    for (const member of LINK_WRITER_OWNED_EDGE_MEMBERS) {
      if (Object.hasOwn(was, member)) now[member] = structuredClone(was[member]);
      else delete now[member];
    }
  }
  return isDeepStrictEqual(restored, before);
}

/**
 * The approved set, applied IN MEMORY through the canonical link writer against ONE base, in order. All or nothing:
 * the first link refused refuses the whole set (`linkIndex` names it). No I/O: the writer reads only the graph given.
 */
async function applyApprovedLinkStrengths(
  before: EditableGraph,
  links: readonly ApprovedLinkStrength[],
  ctx: { readonly scenarioId: string; readonly turnId: string; readonly requestId: string; readonly stage: OlumiResponse['stage_indicator'];
    readonly lastRunIdentityUse: IdentityRunUse | null },
): Promise<
  | { readonly kind: 'applied'; readonly graph: EditableGraph; readonly handlerFacts: readonly unknown[]; readonly confirmations: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string; readonly linkIndex: number }
> {
  const refuse = (reason: string, linkIndex: number) => ({ kind: 'refused' as const, reason, linkIndex });
  const seen = new Set<string>();
  let working: unknown = structuredClone(before);
  const handlerFacts: unknown[] = [];
  const confirmations: string[] = [];
  for (let i = 0; i < links.length; i += 1) {
    const l = links[i]!;
    const key = `${l.from}::${l.to}`;
    if (seen.has(key)) return refuse('duplicate_link', i);
    seen.add(key);
    if (!Number.isFinite(l.magnitude) || l.magnitude < 0 || l.magnitude > 1) return refuse('link_strength_invalid', i);
    // ⛔ B3 (DL CR on #2255): an estimate never goes over a strength that is the user's own AT WRITE TIME. The proposal
    // checked it, but a canvas confirm since then keeps the mean and direction (so expected-before passes) and changes
    // only provenance (outside the analysis hash). Checked on the graph being written, so the whole set refuses.
    const stored = (working as EditableGraph).edges.find(e => e.from === l.from && e.to === l.to) as
      { provenance?: { source?: unknown; reviewed_by_user?: { intent?: unknown; at?: unknown } }; defaulted?: unknown } | undefined;
    if (l.adopted && stored?.provenance?.source === 'user_specified' && stored.defaulted !== true) return refuse('link_became_users_own', i);
    // …and a link the user REVIEWED since the proposal (a canvas confirm writes only that stamp) is their settled view.
    const review = stored?.provenance?.reviewed_by_user;
    const reviewedAt = review?.intent === 'confirm' && typeof review.at === 'string' ? review.at : null;
    if (reviewedAt !== (l.expected.reviewed_at ?? null)) return refuse('link_reviewed_since', i);
    // Direction is kept: a reversal is the user's words on one link (`propose_link_strength`), never part of a set.
    const event = { kind: 'edge_strength_edit' as const, from: l.from, to: l.to, intent: l.intent, direction_intent: 'preserve' as const,
      magnitude: l.magnitude, expected: { mean: l.expected.mean, effect_direction: l.expected.effect_direction } };
    const write = () => applyEdgeStrengthEdit({
      payload: { kind: 'system_event', turn_id: ctx.turnId, scenario_id: ctx.scenarioId, stage: ctx.stage, event } as never,
      event: event as never, requestId: ctx.requestId, persistedGraph: working, lastRunIdentityUse: ctx.lastRunIdentityUse,
    });
    let res: Awaited<ReturnType<typeof applyEdgeStrengthEdit>>;
    try {
      res = l.adopted
        ? await runWithApprovedLinkAdoptions([{ scenarioId: ctx.scenarioId, proposalId: ctx.turnId, from: l.from, to: l.to, magnitude: l.magnitude, band: l.band }], write)
        : await runWithStatedLinkBand({ scenarioId: ctx.scenarioId, proposalId: ctx.turnId, from: l.from, to: l.to, band: l.band }, write);
    } catch {
      return refuse('canonical_graph_unavailable', i);
    }
    if (res.kind !== 'mutated') return refuse(`link_${res.reason}`, i);
    working = res.mutatedGraph;
    handlerFacts.push(...res.handlerFacts);
    if (res.response.assistant_text) confirmations.push(res.response.assistant_text);
  }
  const graph = projectGraphForPersistence(working);
  // No single link is to blame for a scope refusal, so none is named (-1 names none downstream).
  if (!isEditableGraph(graph) || !linkStrengthsPostimageIsScoped(before, graph, links)) return refuse('link_scope_mismatch', -1);
  return { kind: 'applied', graph, handlerFacts, confirmations };
}

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
    readonly targets: readonly Pick<OptionLevelTarget, 'optionId' | 'factorId' | 'modelValue' | 'figure'>[];
    /**
     * The links the APPROVED proposal declared (`from::to`). When given, the links this commit would add must be
     * exactly these, or nothing is written (`links_mismatch`): what was approved is what is written.
     */
    readonly expectedLinks?: readonly string[];
    /**
     * ⭐ A COMPOUND APPROVAL'S FACTOR VALUES (Canonical #70 5849037691): applied through the canonical value writer on
     * the SAME base, and written in the SAME append as the links and levels — one approval, one commit, one receipt.
     */
    readonly values?: readonly ApprovedFactorValue[];
    /** The ranges the approval attaches to factors holding a bare amount — in the SAME commit. */
    readonly frames?: readonly ApprovedFactorFrame[];
    /** ⭐ An approved set of link strengths: ONE append, alone (never with levels, values or ranges). */
    readonly linkStrengths?: readonly ApprovedLinkStrength[];
    /** ⭐ One approved user-stated link effect: ONE append, alone (never with a strength set, levels, values or ranges). */
    readonly linkEffect?: ApprovedLinkEffect;
    /** ⭐ One approved product confirmation: ONE append, alone (never with anything else). */
    readonly identityConfirm?: ApprovedIdentityConfirm;
    /** The last Run's use of each declared identity (`identityRunUseFromFacts`); null = no Run, a definition refuses. */
    readonly lastRunIdentityUse?: IdentityRunUse | null;
  };

/**
 * ⭐ N levels (and the links they need) as ONE commit: one append, one handler fact, one read-back, one receipt.
 * All or nothing — a refused target commits NOTHING — and a retry on the same turn id is the store's replay.
 */
export async function executeOptionInterventionBatch(input: OptionInterventionBatchExecutionInput, store: OptionInterventionStore): Promise<
  | { readonly kind: 'committed'; readonly response: OlumiResponse; readonly graph: unknown;
      readonly analysisGraphHash: string; readonly persistedRowId: string;
      /** The commit's own version receipt, verified to describe THIS turn and postimage (null: guest / no version). */
      readonly modelVersionReceipt?: Awaited<ReturnType<typeof commitDirectAnswer>>['modelVersionReceipt'];
      /** Olumi's own links this commit re-sized to fit a new level (P1-a); empty when none. */
      readonly linksResized?: readonly { from: string; to: string }[] }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string; readonly index?: number; readonly valueIndex?: number; readonly frameIndex?: number;
      readonly linkIndex?: number }
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
    return { optionId: t.optionId, factorId: t.factorId, modelValue: t.modelValue, ...(source !== undefined ? { source } : {}),
      ...(t.figure !== undefined ? { figure: t.figure } : {}) };
  });
  const { targets: _callerTargets, expectedLinks, values: _callerValues, frames: _callerFrames, linkStrengths: _callerLinks,
    linkEffect: _callerEffect, identityConfirm: _callerIdentity, lastRunIdentityUse: _callerRunUse, ...common } = input;
  // ⭐ THE VALUES FIRST, ON THE PERSISTED BASE, IN MEMORY — then the links and levels on the graph they produce, and ONE
  // append for all of it. The caller's base is checked against the PERSISTED model before anything is applied: the
  // levels are prepared on the post-value graph, so their own stale check can no longer see the caller's base.
  const values = input.values ?? [];
  const frames = input.frames ?? [];
  let levelBase: unknown = before;
  let levelBaseHash = input.expectedGraphHash;
  let valueFacts: readonly unknown[] = [];
  let valueConfirmations: readonly string[] = [];
  let linksResized: readonly { from: string; to: string }[] = [];
  if (values.length + frames.length > 0) {
    if (!isEditableGraph(before)
      || !isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before))) {
      return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    }
    if (computeAnalysisAffectingGraphHash(before) !== input.expectedGraphHash) return { kind: 'refused', reason: 'stale_graph' };
    const applied = await applyApprovedFactorValues(before, values, frames,
      { scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId, stage: input.stage });
    if (applied.kind === 'refused') {
      return { kind: 'refused', reason: applied.reason,
        ...(applied.valueIndex !== undefined ? { valueIndex: applied.valueIndex } : {}),
        ...(applied.frameIndex !== undefined ? { frameIndex: applied.frameIndex } : {}) };
    }
    const appliedHash = computeAnalysisAffectingGraphHash(applied.graph);
    if (!appliedHash) return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    levelBase = applied.graph;
    levelBaseHash = appliedHash;
    valueFacts = applied.handlerFacts;
    valueConfirmations = applied.confirmations;
    linksResized = applied.linksResized;
  }
  /**
   * ⭐ A SET OF LINK STRENGTHS (seam Canonical #72 5871633483): the values' own shape — applied in memory on the
   * persisted base, through the canonical link writer, then the ONE append and read-back below. Alone, so a set is
   * never half of a mixed approval, and checked in full before anything is sent.
   */
  const linkStrengths = input.linkStrengths ?? [];
  if (linkStrengths.length > 0) {
    if (targets.length + values.length + frames.length > 0 || (expectedLinks?.length ?? 0) > 0) {
      return { kind: 'refused', reason: 'link_strengths_not_alone' };
    }
    if (!isEditableGraph(before)
      || !isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before))) {
      return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    }
    if (computeAnalysisAffectingGraphHash(before) !== input.expectedGraphHash) return { kind: 'refused', reason: 'stale_graph' };
    const applied = await applyApprovedLinkStrengths(before, linkStrengths, { scenarioId: input.scenarioId, turnId: input.turnId,
      requestId: input.requestId, stage: input.stage, lastRunIdentityUse: input.lastRunIdentityUse ?? null });
    if (applied.kind === 'refused') return { kind: 'refused', reason: applied.reason, linkIndex: applied.linkIndex };
    const appliedHash = computeAnalysisAffectingGraphHash(applied.graph);
    if (!appliedHash) return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    levelBase = applied.graph;
    levelBaseHash = appliedHash;
    valueFacts = applied.handlerFacts;
    valueConfirmations = applied.confirmations;
  }
  /**
   * ⭐ ONE USER-STATED LINK EFFECT, the strength set's own shape: alone, on the persisted base, through the canonical
   * writer in memory, scoped to that one link, then the ONE append and read-back below. One per approval: a second
   * effect prepared on the same base would read `superseded` once the first moved the analysis revision.
   */
  const linkEffect = input.linkEffect;
  if (linkEffect !== undefined) {
    if (targets.length + values.length + frames.length + linkStrengths.length > 0 || (expectedLinks?.length ?? 0) > 0) {
      return { kind: 'refused', reason: 'link_effect_not_alone' };
    }
    if (!isEditableGraph(before)
      || !isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before))) {
      return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    }
    if (computeAnalysisAffectingGraphHash(before) !== input.expectedGraphHash) return { kind: 'refused', reason: 'stale_graph' };
    const written = applyLinkEffectEdit({ persistedGraph: before, from: linkEffect.from, to: linkEffect.to, effect: linkEffect.effect,
      expected: { graph_hash: input.expectedGraphHash, edge_token: linkEffect.edge_token }, quote: linkEffect.quote,
      reading_token: linkEffect.reading_token,
      lastRunIdentityUse: input.lastRunIdentityUse ?? null });
    if (written.kind === 'refused') return { kind: 'refused', reason: `link_${written.reason}`, linkIndex: 0 };
    const graph = projectGraphForPersistence(written.mutatedGraph);
    if (!isEditableGraph(graph) || !linkStrengthsPostimageIsScoped(before, graph, [{ from: linkEffect.from, to: linkEffect.to }])) {
      return { kind: 'refused', reason: 'link_scope_mismatch' };
    }
    const appliedHash = computeAnalysisAffectingGraphHash(graph);
    if (!appliedHash) return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    const labelOfBefore = (id: string): string => String(before.nodes.find(node => node.id === id)?.label ?? id);
    levelBase = graph;
    levelBaseHash = appliedHash;
    valueFacts = written.handlerFacts;
    valueConfirmations = [`"${labelOfBefore(linkEffect.from)}" → "${labelOfBefore(linkEffect.to)}" now carries the size you stated${
      written.statement !== undefined ? `: ${written.statement}` : ''}.`];
  }
  /**
   * ⭐ ONE PRODUCT CONFIRMATION, the link effect's own shape: alone, on the persisted base, through the canonical writer
   * in memory, scoped to that one carrier, then the ONE append and read-back below.
   */
  const identityConfirm = input.identityConfirm;
  if (identityConfirm !== undefined) {
    if (targets.length + values.length + frames.length + linkStrengths.length > 0 || linkEffect !== undefined
      || (expectedLinks?.length ?? 0) > 0) {
      return { kind: 'refused', reason: 'identity_confirm_not_alone' };
    }
    if (!identityConfirmBaseIsWritable(before)) {
      return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    }
    if (computeAnalysisAffectingGraphHash(before) !== input.expectedGraphHash) return { kind: 'refused', reason: 'stale_graph' };
    const written = applyIdentityConfirmEdit({ persistedGraph: before, outcome_id: identityConfirm.outcome_id,
      factor_ids: identityConfirm.factor_ids, words: identityConfirm.words, reading_token: identityConfirm.reading_token,
      expected_graph_hash: input.expectedGraphHash });
    if (written.kind === 'refused') return { kind: 'refused', reason: `identity_${written.reason}` };
    const graph = projectGraphForPersistence(written.mutatedGraph);
    if (!isEditableGraph(graph) || !identityConfirmPostimageIsScoped(before, graph, identityConfirm.outcome_id)) {
      return { kind: 'refused', reason: 'identity_scope_mismatch' };
    }
    const appliedHash = computeAnalysisAffectingGraphHash(graph);
    if (!appliedHash) return { kind: 'refused', reason: 'canonical_graph_unavailable' };
    const labelOfBefore = (id: string): string => String(before.nodes.find(node => node.id === id)?.label ?? id);
    levelBase = graph;
    levelBaseHash = appliedHash;
    valueFacts = written.handlerFacts;
    // AIQ 5887805333 (a): the committed row keeps the card's own words and that they were confirmed on the card — the
    // audit truth that the identity was not in the brief (the `edit_graph` receipt is strict and carries no words).
    valueConfirmations = [`Recorded as yours: "${labelOfBefore(identityConfirm.outcome_id)}" is ${
      identityConfirm.factor_ids.map(id => `"${labelOfBefore(id)}"`).join(' times ')}, as you confirmed on the card: “${
      identityConfirm.words.trim()}”`];
  }
  const effectCount = (linkEffect !== undefined ? 1 : 0) + (identityConfirm !== undefined ? 1 : 0);
  const valuesChanged = values.length + frames.length + linkStrengths.length + effectCount > 0 && !isDeepStrictEqual(levelBase, before);
  // ⭐ A VALUES-ONLY APPROVAL IS ONE COMMIT TOO (Canonical #70 5850018984): Olumi's starting point is usually values
  // with no level, and wrote each value as its own commit. With no level to prepare, the values (and their ranges)
  // are the whole plan: the same writer, adoption authority, scope guard, ONE append and ONE read-back.
  const candidate = targets.length === 0 && values.length + frames.length + linkStrengths.length + effectCount > 0
    ? ({ kind: 'unchanged' } as const)
    : applyOptionInterventionBatch({ ...common, expectedGraphHash: levelBaseHash, persistedGraph: levelBase, targets });
  if (candidate.kind === 'refused') return candidate;
  if (candidate.kind === 'unchanged' && !valuesChanged) return candidate;
  // Every level already held (a compound whose values alone change): the values commit on their own, still ONE append.
  const plan = candidate.kind === 'candidate'
    ? { graph: candidate.graph, operations: candidate.operations, analysisGraphHash: candidate.analysisGraphHash,
      targetsWritten: candidate.targetsWritten, handlerFacts: [...valueFacts, candidate.handlerFact] as unknown[] }
    : { graph: levelBase as EditableGraph, operations: [] as PatchOperation[], analysisGraphHash: levelBaseHash,
      targetsWritten: [] as OptionLevelTarget[], handlerFacts: [...valueFacts] as unknown[] };
  if (expectedLinks !== undefined) {
    const adding = plan.operations.filter(o => o.op === 'add_edge').map(o => o.path).sort();
    if (!isDeepStrictEqual(adding, [...new Set(expectedLinks)].sort())) return { kind: 'refused', reason: 'links_mismatch' };
  }
  const labelOf = (id: string): string => String(plan.graph.nodes.find(node => node.id === id)?.label ?? id);
  const holds = threadHoldsThroughMutatingCommit({ priorPendingActions: pendings,
    graphAfterCommit: plan.graph, graphHashAfterCommit: plan.analysisGraphHash,
    appliedOperations: plan.operations, nowMs: Date.now(),
    scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId });
  const linked = new Set(plan.operations.filter(o => o.op === 'add_edge').map(o => o.path));
  // P1-a: one line naming Olumi's own links this commit re-sized, labels read from the committed graph.
  const resizedLine = groupResizedLinks(linksResized, [...values.map(v => v.factorId), ...frames.map(f => f.factorId)], labelOf)
    .map(resizedLinksSentence);
  const acknowledgment = [...valueConfirmations, ...resizedLine, ...plan.targetsWritten.map(t => formatOptionEffectWriteAck({ optionLabel: labelOf(t.optionId),
    factorLabel: labelOf(t.factorId), committedValue: t.modelValue,
    ...((f) => (f !== undefined ? { committedFigure: f } : {}))(committedFigureOf(plan.graph, t.optionId, t.factorId, t.modelValue)) })
    + (linked.has(`${t.optionId}::${t.factorId}`) ? ` ${labelOf(t.optionId)} is now linked to ${labelOf(t.factorId)}, in the same change.` : ''))]
    .join(' ');
  const response: OlumiResponse = { response_version: 2,
    assistant_text: holds.notice ? `${acknowledgment}\n\n${holds.notice}` : acknowledgment,
    blocks: [], suggested_actions: [], insights: [], stage_indicator: input.stage };
  let committed: Awaited<ReturnType<typeof commitDirectAnswer>>;
  try {
    committed = await commitDirectAnswer(response, {
      scenario_id: input.scenarioId, turn_id: input.turnId, request_hash: input.requestHash,
      turn_class: 'direct_answer', handler_id: null, llm_calls_used: 0, duration_ms: 0,
      handler_facts: plan.handlerFacts as never, graph: plan.graph, contentGraph: plan.graph,
      baseGraphForInvariants: before, ...computeExpectedGraphCasHashes(before),
      graph_hash: plan.analysisGraphHash, priorPendingActions: holds.threaded,
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
    if (!committed.graphPersisted || !isDeepStrictEqual(reloaded, plan.graph)
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
    // Every fact this ONE commit wrote (the values' and the levels'), bound to its row — matched as a multiset by
    // DEEP equality, never by serialised strings: the store reads facts back from JSONB, which re-orders keys
    // (AI Conversation #70 5849290342; the 25 Sep JSONB class).
    const unmatched = [...plan.handlerFacts];
    const everyFactIsOurs = facts.every(f => {
      const at = unmatched.findIndex(expected => isDeepStrictEqual(f.fact, expected));
      if (at < 0) return false;
      unmatched.splice(at, 1);
      return true;
    });
    if (facts.length !== plan.handlerFacts.length || facts.some(f => f.turn_id !== committed.persisted_row_id)
      || !everyFactIsOurs || unmatched.length !== 0) {
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
      analysisGraphHash: plan.analysisGraphHash, persistedRowId: committed.persisted_row_id,
      modelVersionReceipt: receipt, linksResized };
  } catch {
    return { kind: 'unverified', reason: 'canonical_readback_failed', commitAttempted: true };
  }
}

/**
 * The level read on the range the factor DECLARES (`observed_state.cap`, else `scale_frame`): the frame every level on it
 * was normalised by, and the one the canvas card reads to show it. Nothing when the factor declares no range, when its
 * own value is not read on that range, or when a figure already on the cell was read on a different one — a figure is
 * never invented.
 */
function figureOnFactorRange(
  graph: unknown,
  factor: { readonly id?: unknown; readonly observed_state?: unknown; readonly scale_frame?: unknown },
  existing: unknown,
  modelValue: number,
): { raw_value: number; unit?: string; cap: number } | undefined {
  const os = (factor.observed_state ?? {}) as { cap?: unknown; value?: unknown; raw_value?: unknown };
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const cap = positive(os.cap) ? os.cap : positive(factor.scale_frame) ? factor.scale_frame : undefined;
  if (cap === undefined) return undefined;
  const readOn = (raw: unknown, value: unknown): boolean =>
    typeof raw !== 'number' || typeof value !== 'number' || Math.abs(raw / cap - value) <= 1e-9;
  const cell = (existing ?? {}) as { value?: unknown; raw_value?: unknown; unit?: unknown };
  if (!readOn(os.raw_value, os.value) || !readOn(cell.raw_value, cell.value)) return undefined;
  const raw = Number((modelValue * cap).toPrecision(12));
  if (!Number.isFinite(raw) || Math.abs(raw / cap - modelValue) > 1e-9) return undefined;
  const unit = typeof cell.unit === 'string' && cell.unit.trim() !== '' ? cell.unit.trim() : factorUnitOf(graph, factor)?.trim();
  return { raw_value: raw, cap, ...(unit !== undefined && unit !== '' ? { unit } : {}) };
}

/** The user's figure on a committed cell, read back from the committed graph (never from the request). */
function committedFigureOf(graph: unknown, optionId: string, factorId: string, modelValue: number): { raw_value: number; unit: string } | undefined {
  const option = ((graph as { nodes?: unknown } | null)?.nodes as Record<string, unknown>[] | undefined)?.find((n) => n?.id === optionId);
  const c = option === undefined ? undefined : mergeInterventionSourceObjects(option)[factorId] as
    { value?: unknown; raw_value?: unknown; unit?: unknown } | undefined;
  return c !== undefined && c.value === modelValue && typeof c.raw_value === 'number' && Number.isFinite(c.raw_value)
    && typeof c.unit === 'string' && c.unit.trim() !== '' ? { raw_value: c.raw_value, unit: c.unit } : undefined;
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
  const figure = input.figure;
  if (figure !== undefined && (!Number.isFinite(figure.raw_value) || !Number.isFinite(figure.cap) || !(figure.cap > 0)
    || (figure.unit !== undefined && (typeof figure.unit !== 'string' || figure.unit.trim() === ''))
    || Math.abs(figure.raw_value / figure.cap - input.modelValue) > 1e-9)) {
    return refuse('level_frame_mismatch');
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
  const built = buildOptionEffectRawOperation({
    optionId: option.id, optionLabel: option.label,
    factorId: factor.id, factorLabel: factor.label, value: input.modelValue,
  });
  // ⛔ THE CANVAS EDIT KEEPS THE USER'S FIGURE (DL #75 5902916137 (3); P0 partner 5902892060; served W4 run2 on `f074916`):
  // the card sends the level on the model scale and shows it on the factor's own range ("£57" = 0.285 of 200). Written
  // bare, the £57 left the model and the reply said "an effect value of 0.285". That same reading is kept on the cell.
  const levelFigure = figure ?? figureOnFactorRange(graph, factor, existing, input.modelValue);
  // The user's figure rides on the SAME cell write: the encoder carries `raw_value` / `unit` / `cap` onto the cell
  // (`cap` only when it reproduces the level, which the check above has already required).
  const operation = levelFigure === undefined ? built : { ...built, value: { ...(built.value as Record<string, unknown>),
    raw_value: levelFigure.raw_value, cap: levelFigure.cap, ...(levelFigure.unit !== undefined ? { unit: levelFigure.unit.trim() } : {}) } };
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
