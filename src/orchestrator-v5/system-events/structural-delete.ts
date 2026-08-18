/**
 * `structural_delete` (schemas 0.48.0) — the DURABLE removal adapter.
 *
 * THE DEFECT THIS CLOSES, in the founder's words: *"Every time I try to re-run
 * the analysis, it fails because it keeps adding the option that I deleted
 * back."* Root cause was transport, not logic: no UI→CEE vocabulary had a
 * removal verb, so `direct_graph_edit` carried the notification, dispatch
 * classified it `'ack_and_commit'` (a turn row, NO graph write), and the next
 * turn's `loadPersistedGraphStrict` read a graph that still had the option.
 * `mergeAppliedGraph` then re-added it — correctly, because absent-locally means
 * "just added, save debounced" and no delete record existed to consult.
 *
 * This module is an ADAPTER, not a second graph writer. It resolves the removal
 * against the server's own persisted graph and routes it through the canonical
 * `remove_node` / `remove_edge` PatchOperation train that the coach edit tool
 * already uses (`applyPatchOperations`, whose `applyRemoveNode` owns the
 * incident-edge cascade). Persistence and compare-and-swap stay owned by
 * `dispatch.ts` → `commitDirectAnswer`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TRUSTED BASE IS THE SERVER'S OWN READ — do not "optimise" this by
 * accepting a client graph.
 *
 * `session/store.ts` states the rule for the whole estate: the expected base
 * "must derive ONLY from a server-side persisted read … NEVER from
 * request-supplied `graph_state` — that may be the very graph being written, and
 * a CAS that validates the write against itself always matches." For a DELETE
 * the consequence is sharper than for an edit: if the client supplied the base,
 * a stale or hostile client could delete nodes the server holds and the server
 * would have no independent view to refuse against. So the wire carries INTENT
 * (which ids) plus an ASSERTION (`base_graph_hash`), never structure, and every
 * id below is resolved against `persistedGraph`.
 *
 * WHY THE COMMIT IS ATOMIC — do not split this into per-target turns.
 *
 * Removing a node necessarily removes its incident edges. A partial apply leaves
 * DANGLING EDGES — edges whose endpoint no longer exists — which violates
 * referential integrity and will fail or silently mis-analyse downstream. That
 * is strictly worse than not applying at all, because the model is now
 * incoherent rather than merely unchanged. So this module produces ONE candidate
 * graph for ONE commit, asserts the no-dangling-edge postcondition on the
 * projected bytes before returning, and refuses wholesale on any resolution
 * failure. Fanning the event out into N single-delete turns reintroduces the
 * dangling window by construction.
 *
 * WHICH HASH THE STALE GATE COMPARES — derived, not chosen.
 *
 * `base_graph_hash` is documented as "the canonical graph hash the client last
 * read". The only graph hash CEE ever puts on the wire is the ANALYSIS-AFFECTING
 * hash (`computeAnalysisAffectingGraphHash`, 16-hex) — stamped as
 * `OlumiResponse.graph_hash` and as `freshness.current_graph_hash`. The 64-hex
 * IDENTITY hash (`computeGraphIdentityHash`) has no wire emitter at all, so a
 * client cannot hold one; comparing against it would be a gate that can never
 * match — an affordance terminating in refusal (P8). The identity hash remains
 * the right expected base for the SERVER-DERIVED atomic RPC CAS, which is
 * threaded separately in `dispatch.ts`. Two CAS layers, two hashes, two
 * producers — see `graph-cas-conflict.ts`.
 */

import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { elideCascadeRedundantRemoveEdges } from '../graph-management/cascade-removes.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyPatchOperations, PatchApplyError } from '../../orchestrator/patch-applier.js';
import type { PatchOperation } from '../../orchestrator/types.js';

type StructuralDeleteEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'structural_delete' }
>;

/** `safe_summary` is capped at 80 chars by `EditGraphResultSchema`. */
const SAFE_SUMMARY_MAX_CHARS = 80;
/** `affected_entities` is capped at 8 by `EditGraphResultSchema`. */
const AFFECTED_ENTITIES_MAX = 8;

/**
 * A recoverable canonical-state divergence. The route maps this to HTTP 409 +
 * `GRAPH_DIVERGED` with the estate's existing reason code as the category, so a
 * client can refresh and reconfirm rather than guess. No graph or turn row is
 * written for this outcome.
 */
export interface StructuralDeleteBaseHashConflict {
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  /** The hash the server actually holds — makes the refresh a bounded action. */
  readonly expected_base_graph_hash: string | null;
}

/**
 * A non-null persisted graph that fails GraphV3 is CORRUPTION, not absence.
 * Dispatch maps this throw to a retryable 500 with no append, so the corrupt row
 * stays authoritative and no friendly "no saved model" refusal hides the defect.
 */
export class InvalidPersistedDeleteGraphError extends Error {
  constructor() {
    super('structural_delete persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedDeleteGraphError';
  }
}

export type StructuralDeleteResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      /** The projected graph to persist (full ingress shape, not the GraphV3 subset). */
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      /** GraphV3 view of `mutatedGraph` — the adapter's own readback. */
      readonly graph: GraphV3T;
      /** The trusted server-read base, for the atomic CAS expected hashes. */
      readonly baseGraph: unknown;
      /** Removals actually applied, for telemetry and the receipt. */
      readonly removedNodeIds: readonly string[];
      readonly removedEdgePairs: readonly string[];
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      /** Present ONLY for a stale base hash → 409, never a committed transcript. */
      readonly baseHashConflict?: StructuralDeleteBaseHashConflict;
    };

export interface ApplyStructuralDeleteParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: StructuralDeleteEvent;
  readonly requestId: string;
  /** Raw graph from the STRICT server-side persisted-graph read. Never client-supplied. */
  readonly persistedGraph: unknown;
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  baseHashConflict?: StructuralDeleteBaseHashConflict,
): StructuralDeleteResult {
  return {
    kind: 'refused',
    reason,
    ...(baseHashConflict !== undefined ? { baseHashConflict } : {}),
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
  };
}

/** Canonical edge path for the PatchOperation train (`applyRemoveEdge` parses `::`). */
function edgePath(from: string, to: string): string {
  return `${from}::${to}`;
}

/**
 * Human label for a node, resolved from the BASE graph.
 *
 * ⚠ THE BASE, NOT THE COMMITTED GRAPH — and this is load-bearing, not a detail.
 * The whole point of this event is that the node is GONE from the committed
 * bytes, so a label resolved post-delete would always be missing and the
 * confirmation would fall back to naming a raw id. A raw id in user-facing prose
 * is exactly what the egress id-leak scrub exists to prevent, and that scrub
 * resolves ids against the POST-commit graph — where this node no longer is.
 */
function nodeLabel(graph: GraphV3T, id: string): string {
  // ⚠ `||`, NOT `??` — and this is a measured defect, not a style choice.
  // `NodeV3.label` is a bare `z.string()` with no minimum (`cee-v3.ts:147`),
  // while the receipt's `affected_entities[].label` is `z.string().min(1)` in
  // 0.48.0. A nullish `??` lets an EMPTY-STRING label through, the fact then
  // fails its own contract, and the fail-closed branch refuses the deletion with
  // no recovery offered — so a node with an empty label could NEVER be deleted
  // and the user repeats forever (P8). The estate already treats empty labels as
  // real: `reconcile-top-level-options.ts` guards `node.label.length > 0`.
  return graph.nodes.find((n) => n.id === id)?.label || id;
}

/** Node kind for the fact's `affected_entities`, from the base graph. */
function nodeKind(graph: GraphV3T, id: string): GraphV3T['nodes'][number]['kind'] | 'factor' {
  return graph.nodes.find((n) => n.id === id)?.kind ?? 'factor';
}

/**
 * Truthful confirmation copy.
 *
 * THE TRUST DEFECT THIS REPLACES: the delete path returned HTTP 200 with an
 * EMPTY `assistant_text` — the product silently accepting a deletion it had not
 * performed and saying nothing at all. That is both an ungrounded implicit claim
 * of success (P5) and an affordance the system could not honour (P8).
 *
 * The copy therefore states EXACTLY what was removed, in labels, counting only
 * removals that actually landed. It deliberately avoids the words the egress
 * sanitiser flags as internal vocabulary (`node`, `operation`, `patch`), saying
 * "option"/"factor" and "connection" instead — the same words the canvas uses.
 */
function buildConfirmationText(
  baseGraph: GraphV3T,
  removedNodeIds: readonly string[],
  removedEdgeCount: number,
): string {
  const labels = removedNodeIds.map((id) => `'${nodeLabel(baseGraph, id)}'`);
  const parts: string[] = [];
  if (labels.length === 1) {
    parts.push(`Removed ${labels[0]} from your model`);
  } else if (labels.length > 1) {
    const head = labels.slice(0, -1).join(', ');
    parts.push(`Removed ${head} and ${labels[labels.length - 1]} from your model`);
  } else {
    parts.push('Updated your model');
  }
  if (removedEdgeCount === 1) {
    parts.push(', along with 1 connection');
  } else if (removedEdgeCount > 1) {
    parts.push(`, along with ${removedEdgeCount} connections`);
  }
  parts.push('. That change is saved, so it stays removed when you re-run.');
  return parts.join('');
}

/** `safe_summary` for the fact: ≤80 chars, display-safe, never a raw id. */
function buildSafeSummary(
  baseGraph: GraphV3T,
  removedNodeIds: readonly string[],
  removedEdgeCount: number,
): string {
  const summary =
    removedNodeIds.length === 1
      ? `Removed ${nodeLabel(baseGraph, removedNodeIds[0]!)}`
      : removedNodeIds.length > 1
        ? `Removed ${removedNodeIds.length} items from the model`
        : `Removed ${removedEdgeCount} connection${removedEdgeCount === 1 ? '' : 's'}`;
  return summary.length > SAFE_SUMMARY_MAX_CHARS
    ? summary.slice(0, SAFE_SUMMARY_MAX_CHARS)
    : summary;
}

/**
 * Every surviving edge's endpoints still exist.
 *
 * This is the ATOMICITY postcondition made checkable. The cascade in
 * `applyRemoveNode` is what should guarantee it, but a guard is correct at the
 * seam it guards and the defect lives one seam past it: the projection
 * (`projectGraphForPersistence`) runs AFTER the applier and repairs, normalises
 * and reconciles the graph, so the bytes that would land are not the bytes the
 * applier produced. This asserts the property on the PROJECTED bytes — the ones
 * the store will actually receive.
 */
export function hasDanglingEdge(graph: GraphV3T): boolean {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return graph.edges.some((e) => !ids.has(e.from) || !ids.has(e.to));
}

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Delete every key naming a removed node from an intervention-shaped record. */
function pruneInterventionKeys(
  holder: Record<string, unknown>,
  field: 'interventions' | 'raw_interventions',
  removed: ReadonlySet<string>,
): number {
  const bag = holder[field];
  if (!isDict(bag)) return 0;
  let pruned = 0;
  for (const key of Object.keys(bag)) {
    if (removed.has(key)) {
      delete bag[key];
      pruned += 1;
    }
  }
  return pruned;
}

/**
 * Remove every reference to a deleted node from the fields that carry node ids
 * BY VALUE rather than by structure.
 *
 * ⭐ WHY THIS IS NOT TIDINESS — an orphaned intervention TURNS A WORKING ANALYSIS
 * INTO A REFUSAL. Derived end to end, by execution, not by argument:
 *
 *  1. CEE does not filter interventions to existing nodes. `run-analysis.ts:687`
 *     spreads `requestProjection.perOption[index]` onto the wire wholesale.
 *  2. Deleting a factor's NODE removes its cap from `buildFactorScaleMap`, so the
 *     canonical persisted intervention shape `{value: 0.4, raw_value: 40000}`
 *     projects to **40000** instead of **0.4** — measured against the real
 *     modules, a 100,000× change, because the cap that anchored it is gone.
 *  3. That strands a raw magnitude beside unit-scale siblings, so the request
 *     projection reports `mixedUnresolved: true` where it reported `false` with
 *     the cap in place (measured: the identical payload flips purely on the
 *     node's presence).
 *  4. `decideAnalysisScaleBlock` turns that into
 *     `{blocked: true, reason_code: 'mixed_scale_unresolved'}`, and
 *     `run-analysis.ts:565-580` throws `HandlerInvocationFailedError` with
 *     `cause_kind: 'analysis_not_ready', retryable: false`.
 *
 * ⚠ STATE THIS PRECISELY — the first version of this comment said the request
 * reaches PLoT and "EVERY OTHER factor's value reaching ISL changes too". That
 * is the WEAKER and mostly UNREACHABLE claim: on the canonical shape CEE never
 * calls PLoT at all, because the scale block fires first. An adversarial
 * verifier enumerated 3 orphan shapes × 4 sibling shapes and found the
 * reach-PLoT-and-re-scale path live in only ONE of the twelve cells.
 * **The true and more damning outcome is the refusal**: the user deletes a
 * factor and an analysis that would have run correctly now refuses, non
 * retryably, naming a factor that is no longer in their model.
 *
 * Pruning here is the intervention-level twin of the edge cascade — a delete
 * must not leave references to what it removed.
 *
 * Mutates a structuredClone the caller owns. Never throws.
 */
export function pruneDanglingNodeReferences(
  graph: Record<string, unknown>,
  removedNodeIds: ReadonlySet<string>,
): { readonly interventionsPruned: number; readonly metaIdsPruned: number } {
  let interventionsPruned = 0;
  let metaIdsPruned = 0;

  // Option-KIND nodes carry `interventions` (cee-v3.ts:199).
  if (Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isDict(node)) continue;
      interventionsPruned += pruneInterventionKeys(node, 'interventions', removedNodeIds);
      interventionsPruned += pruneInterventionKeys(node, 'raw_interventions', removedNodeIds);
    }
  }

  // The top-level `options[]` mirror carries the SAME keys (cee-v3.ts:405) and is
  // the surface live CEE readers prefer — pruning only the nodes would leave the
  // two views disagreeing, which is the defect this PR already fixed once.
  if (Array.isArray(graph.options)) {
    for (const option of graph.options) {
      if (!isDict(option)) continue;
      interventionsPruned += pruneInterventionKeys(option, 'interventions', removedNodeIds);
      interventionsPruned += pruneInterventionKeys(option, 'raw_interventions', removedNodeIds);
    }
  }

  // `meta.roots` / `meta.leaves` are plain id arrays (cee-v3.ts:516-518).
  if (isDict(graph.meta)) {
    for (const field of ['roots', 'leaves'] as const) {
      const list = graph.meta[field];
      if (!Array.isArray(list)) continue;
      const kept = list.filter((id) => !(typeof id === 'string' && removedNodeIds.has(id)));
      metaIdsPruned += list.length - kept.length;
      if (kept.length !== list.length) graph.meta[field] = kept;
    }
  }

  return { interventionsPruned, metaIdsPruned };
}

/**
 * Any SURVIVING reference to a removed node, or null when the graph is clean.
 *
 * The postcondition twin of the prune above, asserted on the PROJECTED bytes —
 * the projection runs after the prune and could reintroduce a reference.
 *
 * `goal_node_id` is deliberately NOT auto-repaired. Every other field here holds
 * a reference that becomes meaningless once its node is gone, so dropping it
 * restores coherence; the goal is the model's whole point, and silently choosing
 * a different one — or blanking it — would be the system deciding something the
 * user never asked for. Refusing is the honest answer.
 */
export function findOrphanedNodeReference(
  graph: Record<string, unknown>,
  removedNodeIds: ReadonlySet<string>,
): string | null {
  const goalNodeId = graph.goal_node_id;
  if (typeof goalNodeId === 'string' && removedNodeIds.has(goalNodeId)) {
    return 'goal_node_id';
  }
  const scan = (holder: unknown, where: string): string | null => {
    if (!isDict(holder)) return null;
    for (const field of ['interventions', 'raw_interventions'] as const) {
      const bag = holder[field];
      if (!isDict(bag)) continue;
      for (const key of Object.keys(bag)) {
        if (removedNodeIds.has(key)) return `${where}.${field}`;
      }
    }
    return null;
  };
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    const hit = scan(node, 'nodes[]');
    if (hit !== null) return hit;
  }
  for (const option of Array.isArray(graph.options) ? graph.options : []) {
    const hit = scan(option, 'options[]');
    if (hit !== null) return hit;
  }
  // `meta.roots` / `meta.leaves` are pruned above, so this rung has nothing to
  // catch TODAY. It exists because the prune and the postcondition must cover
  // the SAME field set: a postcondition narrower than its prune silently stops
  // guarding the moment someone refactors the prune, and the gap reads as green.
  // Cheap, derived from the same two field names, and it fails loud on drift.
  if (isDict(graph.meta)) {
    for (const field of ['roots', 'leaves'] as const) {
      const list = graph.meta[field];
      if (!Array.isArray(list)) continue;
      if (list.some((id) => typeof id === 'string' && removedNodeIds.has(id))) {
        return `meta.${field}`;
      }
    }
  }
  return null;
}

export function applyStructuralDelete(
  params: ApplyStructuralDeleteParams,
): StructuralDeleteResult {
  const { payload, event, requestId, persistedGraph } = params;

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info(
      {
        event: 'v5.system_event.structural_delete.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_delete — no persisted model; refusing without a graph write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no saved model I can safely change yet, so I haven't removed anything.`,
    );
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.persisted_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_delete — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedDeleteGraphError();
  }
  const baseGraph = graphParse.data;

  // ── 2. THE STALE GATE, before anything is resolved ───────────────────────
  // A delete applied to a graph the user was not looking at removes something
  // they never selected: ids drift as the model is edited. The contract makes
  // this non-optional ("absent, null and empty are all forbidden") and requires
  // a refusal rather than a best-effort subset.
  const currentBaseHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info(
      {
        event: 'v5.system_event.structural_delete.base_hash_diverged',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        // Hashes are non-secret content digests and are the whole diagnostic.
        client_base_graph_hash: event.base_graph_hash,
        server_base_graph_hash: currentBaseHash,
      },
      'structural_delete — client base hash diverged from the persisted graph; refusing the removal',
    );
    return refuse(
      payload,
      BASE_HASH_DIVERGED,
      `The model has changed since you deleted that, so I haven't removed anything. Reload it and delete again — otherwise I could remove something you didn't pick.`,
      {
        recovery_action: 'refresh_and_reconfirm',
        conflict_category: BASE_HASH_DIVERGED,
        expected_base_graph_hash: currentBaseHash,
      },
    );
  }

  // ── 3. resolve targets against the server's graph, or refuse ─────────────
  // Wholesale, never partial: a delete the server can only half-honour is the
  // dangling-edge hazard, and "I removed some of that" is not an outcome the
  // user asked for. Duplicates in the persisted graph are refused rather than
  // arbitrarily disambiguated — the same rule `edge_strength_edit` applies.
  //
  // ⚠ ONE DELIBERATE HOLE, stated because an earlier version of this comment
  // claimed "EVERY target" and that was FALSE. An edge sharing an endpoint with
  // a node being removed in the SAME event is NOT resolved: the cascade is about
  // to take it regardless, so requiring it to exist first would refuse the
  // ordinary select-a-node-and-its-edges gesture. The cost is that a MALFORMED
  // half of such a pair rides through unchecked — `{from: 'o-launch',
  // to: 'no-such-node'}` alongside removing `o-launch` commits silently, because
  // the cascade already achieved the end state the op asked for. The end state
  // is correct; the unresolvable id is simply not reported. Narrowing that
  // further means resolving each pair against the POST-cascade graph, which is a
  // separate change — it is a reporting gap, not a correctness one.
  const nodeIdsInGraph = new Set(baseGraph.nodes.map((n) => n.id));
  const missingNodeIds = event.removed_node_ids.filter((id) => !nodeIdsInGraph.has(id));
  if (missingNodeIds.length > 0) {
    log.info(
      {
        event: 'v5.system_event.structural_delete.node_target_not_found',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        missing_count: missingNodeIds.length,
      },
      'structural_delete — a named node is not in the persisted model; refusing the whole removal',
    );
    return refuse(
      payload,
      'node_target_not_found',
      `I couldn't find everything you deleted in the saved model, so I haven't removed anything. Reload it and try again.`,
    );
  }

  const edgeMatchCount = (from: string, to: string): number =>
    baseGraph.edges.filter((e) => e.from === from && e.to === to).length;
  // An edge the client named that a node removal in THIS SAME event will cascade
  // away is not "missing" — it is already accounted for. Resolve edge presence
  // against the pre-delete graph, and let the cascade elision below handle the
  // ordering.
  //
  // ⚠ WHAT THIS EXEMPTION COSTS, stated precisely — an earlier version of this
  // line said "anything else is genuinely absent", which is FALSE. The exemption
  // is keyed on EITHER endpoint being removed, so only the OTHER half of the pair
  // goes unchecked: `{from: 'o-launch', to: 'no-such-node'}` alongside removing
  // `o-launch` is accepted and commits, because the cascade already delivers the
  // end state that op asked for. The resulting graph is correct; what is lost is
  // the REPORT that one named id was unresolvable. Tightening this means
  // resolving each pair against the post-cascade graph — a separate change.
  const removedNodeIdSet = new Set(event.removed_node_ids);
  const unresolvableEdges = event.removed_edges.filter(
    (e) =>
      !removedNodeIdSet.has(e.from) &&
      !removedNodeIdSet.has(e.to) &&
      edgeMatchCount(e.from, e.to) !== 1,
  );
  if (unresolvableEdges.length > 0) {
    log.info(
      {
        event: 'v5.system_event.structural_delete.edge_target_unresolvable',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        unresolvable_count: unresolvableEdges.length,
      },
      'structural_delete — a named connection is absent or duplicated in the persisted model; refusing the whole removal',
    );
    return refuse(
      payload,
      'edge_target_unresolvable',
      `I couldn't match every connection you deleted to the saved model, so I haven't removed anything. Reload it and try again.`,
    );
  }

  // ── 4. the canonical PatchOperation train ────────────────────────────────
  // Nodes first, then edges: `applyRemoveNode` cascades incident edges, so a
  // client that enumerated both a node and its own incident edge would otherwise
  // hit `EDGE_NOT_FOUND` on the second op. `elideCascadeRedundantRemoveEdges`
  // (graph-management, P0 2026-08-16) drops exactly those redundant ops and
  // NOTHING else — an edge absent for any other reason still reaches the applier
  // and still throws, which is why step 3 above resolves rather than tolerates.
  const operations: PatchOperation[] = [
    ...event.removed_node_ids.map((id) => ({ op: 'remove_node' as const, path: id })),
    ...event.removed_edges.map((e) => ({
      op: 'remove_edge' as const,
      path: edgePath(e.from, e.to),
    })),
  ] as PatchOperation[];
  const elided = elideCascadeRedundantRemoveEdges(operations);

  let candidate: GraphV3T;
  try {
    candidate = applyPatchOperations(baseGraph, elided.operations as PatchOperation[]);
  } catch (err) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.apply_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        code: err instanceof PatchApplyError ? err.code : 'unknown',
      },
      'structural_delete — canonical applier refused the batch; nothing written',
    );
    return refuse(
      payload,
      err instanceof PatchApplyError ? err.code : 'apply_failed',
      `I couldn't apply that deletion to the saved model, so I haven't removed anything. Reload it and try again.`,
    );
  }

  // ── 5. put the rest of the graph back — AND prune the deleted option ─────
  // `applyPatchOperations` deliberately returns ONLY `{nodes, edges}` (it clones
  // exactly those two keys). Persisting that verbatim would silently strip
  // `goal_node_id`, `options`, `meta`, `coaching`, `causal_claims` and every
  // other top-level field — un-analysabling the scenario on the very turn the
  // user edited it.
  //
  // ⚠ WHY `mergeAppliedGraphForPersistence` AND NOT ITS NEAR-IDENTICAL TWIN
  // `mergeMutatedGraphForPersistence` — measured, and it is the difference
  // between fixing this P0 and reproducing it one field over.
  //
  // GraphV3 carries options in TWO places: option-KIND entries in `nodes[]` and
  // a top-level `options[]` array, and live CEE readers prefer `options[]` (the
  // ContextPack projection among them). The D1 twin merges `nodes`/`edges` only,
  // so a deleted option's `options[]` entry SURVIVES — the node goes and the
  // canonical option surface still lists it. That is this very defect wearing a
  // different field name.
  //
  // `reconcile-top-level-options.ts` names the owner of the removal explicitly:
  // *"It never modifies or removes an existing entry: deletion of a removed
  // option's entry stays owned by `mergeAppliedGraphForPersistence`"* — whose
  // precedence rule 4 drops exactly the entries provably deleted by THIS change
  // (id was a base node, node absent from the applied graph) and preserves every
  // other entry byte-for-byte. Proven at the bytes: with the D1 twin, projecting
  // a one-option deletion left `options` = [o-launch, o-wait] while `nodes` held
  // only o-wait.
  //
  // `ingressBase` is a fallback the helper reads ONLY when `persistedBase` is
  // structurally unusable — unreachable here, because a malformed persisted graph
  // has already thrown `InvalidPersistedDeleteGraphError` above. It is fed the
  // SAME trusted server read, PARSED into the type rather than cast into it, so
  // the trusted-base rule holds on both arguments and no `as unknown as` double
  // cast is introduced (the forbidden-boundary containment ratchet reds on one,
  // and it is right to: a cast here would assert a shape nobody checked).
  const ingressParse = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingressParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.ingress_projection_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: ingressParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_delete — trusted base could not be projected for the persist merge; refusing the write',
    );
    return refuse(
      payload,
      'ingress_projection_failed',
      `I couldn't save that deletion safely, so I haven't removed anything.`,
    );
  }
  // ⚠⚠ THE CLONE IS THE P0 FIX — DO NOT REMOVE IT, AND DO NOT "OPTIMISE" IT INTO
  // A SHALLOW COPY. It is the difference between a user being able to delete
  // more than one thing per scenario and not.
  //
  // `mergeAppliedGraphForPersistence` composes the candidate with a SHALLOW
  // spread — `{...base, nodes, edges}` — so ONLY `nodes` and `edges` are fresh.
  // `merged.meta`, `merged.options` and every other top-level object/array are
  // THE SAME OBJECT REFERENCES the trusted base holds. `pruneDanglingNodeReferences`
  // below mutates IN PLACE (`delete bag[key]`, `graph.meta[field] = kept`), so
  // without this clone it writes THROUGH the spread and rewrites `persistedGraph`
  // — the very read this module's header calls the trusted base.
  //
  // WHY THAT WAS A P0 AND NOT AN AESTHETIC POINT: `dispatch.ts` derives the
  // atomic-CAS expected base from `result.baseGraph` (i.e. `persistedGraph`)
  // AFTER this adapter returns. A mutated base yields an expected hash for a
  // graph that WAS NEVER PERSISTED, so it can never equal the stamped
  // `scenarios.graph_identity_hash`, and `append_turn_atomic_v3/v4` raises OLGC1
  // → 409 GRAPH_DIVERGED / `rpc_cas_conflict` on every subsequent delete, at
  // rest, forever. Measured on real staging graphs: the base moved on 47/150,
  // and on those the CAS would fire against a divergence this code manufactured.
  // The two other post-adapter readers of `persistedGraph` in `dispatch.ts` —
  // `contentGraph` and the advertised `currentAnalysisHash` — were reading the
  // same corrupted bytes.
  //
  // ⚠ THE CAS ITSELF IS CORRECT AND IS NOT RELAXED. The column agreed with
  // `computeExpectedGraphCasHashes(scenarios.graph)` on 976/976 live rows: the
  // stored value was right and the DERIVATION was wrong. A genuinely stale base
  // must still be refused — pinned by the opposite-direction twin in
  // `structural-delete-trusted-base-purity.test.ts`.
  //
  // Cloning the MERGE RESULT (not the base) is the tightest containment: the
  // merge is measured pure (0/150), so one clone covers the prune and every
  // projection pass without changing any shared helper other lanes own.
  // `structuredClone` is used rather than a JSON round-trip because it is not
  // silently lossy on `undefined`/`NaN`; the value is wire-originated JSON, so
  // no unclonable types can reach it.
  //
  // ⭐ THE CLONE MOVED INTO THE HELPER, AND THIS CALL SITE NO LONGER PERFORMS
  // ONE. Everything above still describes the hazard exactly — it is why the
  // helper now owns it. The clone was here at ONE of the THREE call sites that
  // derive an atomic-CAS expected base from `persistedGraph`;
  // `factor-value-edit.ts` and `edge-strength-edit.ts` reach the sibling helper
  // with the same aliasing and had no clone at all, latent only because neither
  // runs a structural prune today. A guard that sits one seam away from the
  // thing it guards protects the seat it happens to occupy and no other, so
  // `mergeAppliedGraphForPersistence` now returns a graph that aliases nothing
  // — see its return contract, and the three-shape reproduction in
  // `__tests__/persist-merge-helpers-own-their-clone.test.ts`. Cloning again
  // here would be a second copy of a guarantee, which is how two authorities
  // for one concept start.
  const merged = mergeAppliedGraphForPersistence({
    appliedGraph: candidate,
    persistedBase: persistedGraph,
    ingressBase: ingressParse.data,
    requestId,
    scenarioId: payload.scenario_id,
  });

  // ── 5b. drop references to what we just removed ──────────────────────────
  // The merge fixes the two STRUCTURAL surfaces (nodes/edges and the top-level
  // `options[]` roster). It does not touch fields that name a node BY VALUE —
  // interventions keyed on a factor id, `meta.roots`/`meta.leaves`. Those are
  // not cosmetic: an orphaned intervention re-scales the WHOLE analysis (see
  // `pruneDanglingNodeReferences`). Same principle as the edge cascade, one
  // field-class over.
  const removedIdSet = new Set(event.removed_node_ids);
  const pruneCounts = pruneDanglingNodeReferences(merged, removedIdSet);
  if (pruneCounts.interventionsPruned > 0 || pruneCounts.metaIdsPruned > 0) {
    log.info(
      {
        event: 'v5.system_event.structural_delete.dangling_refs_pruned',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        interventions_pruned: pruneCounts.interventionsPruned,
        meta_ids_pruned: pruneCounts.metaIdsPruned,
      },
      'structural_delete — dropped references to the removed nodes',
    );
  }
  // Project here for the same reason `edge_strength_edit` does: the commit
  // chokepoint applies this same idempotent function on the way to the store, so
  // projecting now makes this adapter's readback and hashes describe those
  // eventual bytes exactly rather than a pre-projection copy.
  const projectedGraph = projectGraphForPersistence(merged, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
    turnClass: 'handler',
    source: 'structural_delete',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  if (!projectedParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.projected_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: projectedParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_delete — post-delete graph failed validation; refusing the write',
    );
    return refuse(
      payload,
      'projected_graph_invalid',
      `I couldn't save that deletion safely, so I haven't removed anything.`,
    );
  }

  // ── 6. the atomicity postcondition, on the bytes that would land ─────────
  if (hasDanglingEdge(projectedParse.data)) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.dangling_edge',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_delete — post-delete graph would carry a dangling connection; refusing the write',
    );
    return refuse(
      payload,
      'dangling_edge',
      `I couldn't remove that cleanly without leaving the model inconsistent, so I haven't changed anything.`,
    );
  }

  // ── 6b. no SURVIVING reference to a removed node, on the projected bytes ──
  const orphanedRef = findOrphanedNodeReference(
    projectedGraph as Record<string, unknown>,
    removedIdSet,
  );
  if (orphanedRef !== null) {
    log.error(
      {
        event: 'v5.system_event.structural_delete.orphaned_node_reference',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        orphaned_reference: orphanedRef,
      },
      'structural_delete — post-delete graph would still reference a removed node; refusing the write',
    );
    return refuse(
      payload,
      'orphaned_node_reference',
      orphanedRef === 'goal_node_id'
        ? `That's the outcome the whole model is measured against, so removing it would leave nothing to compare options on. I haven't changed anything — tell me what you'd like to measure instead and I'll change it with you.`
        : `I couldn't remove that cleanly without leaving the model inconsistent, so I haven't changed anything.`,
    );
  }

  // ── 6c. THE WRITE MUST BE DESCRIBABLE — decided BEFORE it happens ─────────
  // ⚠ THIS GUARD'S POSITION IS THE WHOLE POINT. It used to live AFTER the
  // commit, inside the receipt check, where it could only ever MISREPORT an
  // irreversible write: an adversarial review measured a select-all delete on a
  // graph with no `goal_node_id` landing atomically (`nodes 0` persisted) and
  // the route then answering `500 · retryable: true`. The user's model was gone
  // and the product invited them to retry. A guard placed after an irreversible
  // write is not a guard.
  //
  // WHY REFUSE rather than accept a null hash as a valid receipt (the other
  // option, considered and rejected): the analysis hash is the spine of every
  // downstream promise — the wire `graph_hash`, freshness, the CAS expected
  // base, and the committed-bytes readback below all key off a non-null value.
  // Accepting null would mean committing a state we cannot describe to the user
  // or to the next turn, and threading "no hash" through all four would be a
  // widening far beyond this lane.
  //
  // AND IT COSTS ALMOST NOTHING, measured rather than assumed:
  // `computeAnalysisAffectingGraphHash` returns null ONLY when
  // `nodes.length === 0 && edges.length === 0 && !Array.isArray(options) &&
  // goalNodeId === undefined` (`context/graph-hash.ts:126-133`). Any real
  // decision model carries a goal, and 6b above already refuses deleting it, so
  // the only shape reaching here is "delete everything from a graph that never
  // had a goal or an options roster". That is refused truthfully, BEFORE the
  // write, instead of being wiped and reported as a retryable failure.
  const postDeleteHash = computeAnalysisAffectingGraphHash(
    projectedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (postDeleteHash === null) {
    log.warn(
      {
        event: 'v5.system_event.structural_delete.unhashable_result',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_delete — the post-delete graph has no analysis hash; refusing BEFORE the write rather than committing a state we cannot describe',
    );
    return refuse(
      payload,
      'unhashable_result',
      `Removing all of that would leave nothing for me to work with, so I haven't changed anything. Delete what you don't need and keep at least one thing to measure.`,
    );
  }

  // ── 7. what actually went, measured from the graphs ──────────────────────
  // DERIVED from base-vs-projected, never copied from the request. The client
  // says what it wants removed; only the graphs can say what left.
  const survivingNodeIds = new Set(projectedParse.data.nodes.map((n) => n.id));
  const removedNodeIds = baseGraph.nodes
    .map((n) => n.id)
    .filter((id) => !survivingNodeIds.has(id));
  const survivingEdgePairs = new Set(
    projectedParse.data.edges.map((e) => edgePath(e.from, e.to)),
  );
  const removedEdgePairs = baseGraph.edges
    .map((e) => edgePath(e.from, e.to))
    .filter((pair) => !survivingEdgePairs.has(pair));

  // A request that resolved cleanly but changed nothing is a no-op, and the
  // contract already refuses the empty-arrays shape at the boundary. Reaching
  // here means the graphs disagree with the request, so say so rather than
  // committing a turn that claims a removal.
  if (removedNodeIds.length === 0 && removedEdgePairs.length === 0) {
    log.warn(
      {
        event: 'v5.system_event.structural_delete.no_effect',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_delete — resolved batch changed nothing; refusing rather than claiming a removal',
    );
    return refuse(
      payload,
      'no_effect',
      `That was already removed from the saved model, so there was nothing for me to change.`,
    );
  }

  // ── 8. the receipt ───────────────────────────────────────────────────────
  // The canonical structural-mutation fact. `edit_kind: 'structural'` is the
  // schema's own vocabulary for exactly this class; `graph_patch` cannot carry a
  // delete at all (its `operation` is a closed three-value enum and its
  // `target_id` is singular, while a delete is inherently a batch), so the
  // authoritative UI-facing receipt is the `draft_graph` applied-graph field
  // that `dispatch.ts` stamps from the COMMITTED bytes.
  const affectedEntities = removedNodeIds
    .slice(0, AFFECTED_ENTITIES_MAX)
    .map((id) => ({ kind: nodeKind(baseGraph, id), label: nodeLabel(baseGraph, id) }));
  const fact = {
    fact_type: 'edit_graph' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      edit_kind: 'structural' as const,
      status: 'applied' as const,
      operations_count: elided.operations.length,
      affected_entities: affectedEntities,
      graph_hash_before: currentBaseHash,
      graph_hash_after: postDeleteHash,
      safe_summary: buildSafeSummary(baseGraph, removedNodeIds, removedEdgePairs.length),
      // A structural removal always changes the analysis-affecting projection,
      // so any prior analysis is out of date by construction.
      impact: 'high' as const,
      rerun_recommended: true,
    },
  };
  const factCheck = EditGraphHandlerFactSchema.safeParse(fact);
  if (!factCheck.success) {
    // Fail CLOSED. Committing the removal without its receipt would leave the
    // graph changed and the transcript unable to say what changed — the
    // empty-acknowledgement defect one level down.
    log.error(
      {
        event: 'v5.system_event.structural_delete.fact_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        parse_error: factCheck.error.message,
      },
      'structural_delete — receipt failed its own contract; refusing the commit (fail closed)',
    );
    return refuse(
      payload,
      'fact_invalid',
      `I couldn't record that deletion properly, so I haven't changed the model.`,
    );
  }

  return {
    kind: 'mutated',
    response: {
      response_version: 2,
      assistant_text: buildConfirmationText(
        baseGraph,
        removedNodeIds,
        removedEdgePairs.length,
      ),
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
    mutatedGraph: projectedGraph,
    handlerFacts: [factCheck.data],
    graph: projectedParse.data,
    baseGraph: persistedGraph,
    removedNodeIds,
    removedEdgePairs,
  };
}
