/**
 * GRAPH-EDIT-TRANSACTION step 1 — THE PERSISTED FORM, DEFINED ONCE.
 *
 * THE DEFECT THIS CLOSES (design §3.2, CONFIRMED at the bytes on staging
 * `5afef510`). `edit-graph-dispatch.ts` computed the turn's advertised analysis
 * hash from `persistedPostEditGraph`, and only afterwards did `commitDirectAnswer`
 * run persistence passes that MUTATE fields that hash projects:
 *
 *   repairGraphForPersistence          → deletes duplicate observed-root `intercept`
 *   normaliseOptionInterventionContract → rewrites node/option `interventions`
 *   canonicaliseCommittedGraphHashCarriers → owns canonical []/null absence
 *   reconcileTopLevelOptionsFromNodes   → appends entries to top-level `options[]`
 *
 * `intercept`, node `interventions` and `options[]` are all inside
 * `computeAnalysisAffectingGraphHash`'s projection (`context/graph-hash.ts`
 * :222, :238, :143-145). Measured on the real modules, each pass on its own
 * moves the hash. So whenever one of the original three fired, the hash the turn told
 * freshness, the pending's re-pin and the held-thread described a graph we did
 * NOT store.
 *
 * THE FIX IS ORDERING, NOT ARITHMETIC. The passes are collected here as
 * the single definition of "the form in which a graph is persisted", so any
 * site that needs to reason about the persisted bytes — to hash them, to pin a
 * pending to them, to thread a hold against them — projects FIRST and derives
 * SECOND. There is no second hash implementation and no field list to keep in
 * sync: correctness comes from computing the hash on the projected graph.
 *
 * SAFE TO CALL MORE THAN ONCE. Every pass is idempotent and returns the
 * ORIGINAL reference when they have nothing to do, so a graph already in
 * persisted form projects to itself byte-identically. The edit lane therefore
 * projects early (so its advertised hash is honest) and `commitDirectAnswer`
 * projects again at the chokepoint (so every OTHER lane is covered too) with no
 * double-application hazard.
 *
 * ORDER IS LOAD-BEARING: carrier canonicalisation runs after intervention
 * normalisation and before `reconcileTopLevelOptionsFromNodes`. It establishes
 * an own `options: []` on a legacy partial graph, then reconciliation can mirror
 * option nodes into that canonical array using already-normalised bundles.
 */
import { repairGraphForPersistence } from './repair-graph-for-persistence.js';
import { normaliseOptionInterventionContract } from './normalise-option-interventions.js';
import { reconcileTopLevelOptionsFromNodes } from './reconcile-top-level-options.js';

type Dict = Record<string, unknown>;

function isRecord(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function deriveUnambiguousGoalIdentity(nodes: readonly unknown[]): string | null | undefined {
  const goalIds: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node) || node.kind !== 'goal') continue;
    if (typeof node.id !== 'string' || node.id.length === 0) continue;
    goalIds.push(node.id);
  }
  if (goalIds.length === 0) return null;
  if (goalIds.length === 1) return goalIds[0];
  // Multiple goal nodes cannot determine the singular canonical goal identity.
  // Preserve omission so the receipt barrier fails closed; never choose one.
  return undefined;
}

/**
 * Author explicit canonical carrier absence before the atomic append.
 *
 * This is the producer-side compatibility barrier for legacy partial graphs.
 * It is intentionally inside the persisted projection—not the post-commit
 * receipt builder—so `CommitResult.persistedGraph`, `append.graph`, and the
 * receipt all carry the same own keys. A missing goal id is derived only when
 * the node set makes the answer unambiguous (one goal → its id, no goals →
 * null); multiple goals remain omitted and therefore cannot yield a success
 * receipt. Present values, including explicit null/[], are never rewritten.
 */
export function canonicaliseCommittedGraphHashCarriers<T>(graph: T): T {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return graph;
  }

  const needsOptions = !hasOwn(graph, 'options') || graph.options === undefined;
  const needsGoalConstraints =
    !hasOwn(graph, 'goal_constraints') || graph.goal_constraints === undefined;
  const needsGoalNodeId =
    !hasOwn(graph, 'goal_node_id') || graph.goal_node_id === undefined;
  const goalNodeId = needsGoalNodeId
    ? deriveUnambiguousGoalIdentity(graph.nodes)
    : undefined;

  if (
    !needsOptions &&
    !needsGoalConstraints &&
    (!needsGoalNodeId || goalNodeId === undefined)
  ) {
    return graph;
  }

  return {
    ...graph,
    ...(needsOptions ? { options: [] } : {}),
    ...(needsGoalNodeId && goalNodeId !== undefined
      ? { goal_node_id: goalNodeId }
      : {}),
    ...(needsGoalConstraints ? { goal_constraints: [] } : {}),
  } as T;
}

export interface PersistedGraphProjectionContext {
  readonly scenarioId?: string;
  readonly turnId?: string;
  readonly turnClass?: string;
  /** Originating handler id (e.g. `edit_graph`) — non-sensitive. */
  readonly source?: string;
}

/**
 * Return the graph in the exact form it will be written to `scenarios.graph`.
 *
 * The repair/normalisation/reconciliation passes are individually fail-open.
 * Carrier canonicalisation is a non-throwing shallow copy and refuses to guess
 * an ambiguous goal. A graph already in canonical persisted form is returned
 * as the ORIGINAL reference.
 */
export function projectGraphForPersistence<T>(
  graph: T,
  ctx: PersistedGraphProjectionContext = {},
): T {
  if (graph === undefined || graph === null) return graph;
  const repaired = repairGraphForPersistence(graph, ctx);
  const normalised = normaliseOptionInterventionContract(repaired, ctx);
  const withCanonicalCarriers = canonicaliseCommittedGraphHashCarriers(normalised);
  return reconcileTopLevelOptionsFromNodes(withCanonicalCarriers, ctx);
}
