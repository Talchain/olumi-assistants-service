/**
 * GRAPH-EDIT-TRANSACTION step 1 — THE PERSISTED FORM, DEFINED ONCE.
 *
 * THE DEFECT THIS CLOSES (design §3.2, CONFIRMED at the bytes on staging
 * `5afef510`). `edit-graph-dispatch.ts` computed the turn's advertised analysis
 * hash from `persistedPostEditGraph`, and only afterwards did `commitDirectAnswer`
 * run three passes that MUTATE fields that hash projects:
 *
 *   repairGraphForPersistence          → deletes duplicate observed-root `intercept`
 *   normaliseOptionInterventionContract → rewrites node/option `interventions`
 *   reconcileTopLevelOptionsFromNodes   → appends entries to top-level `options[]`
 *
 * `intercept`, node `interventions` and `options[]` are all inside
 * `computeAnalysisAffectingGraphHash`'s projection (`context/graph-hash.ts`
 * :222, :238, :143-145). Measured on the real modules, each pass on its own
 * moves the hash. So whenever any of the three fired, the hash the turn told
 * freshness, the pending's re-pin and the held-thread described a graph we did
 * NOT store.
 *
 * THE FIX IS ORDERING, NOT ARITHMETIC. The three passes are collected here as
 * the single definition of "the form in which a graph is persisted", so any
 * site that needs to reason about the persisted bytes — to hash them, to pin a
 * pending to them, to thread a hold against them — projects FIRST and derives
 * SECOND. There is no second hash implementation and no field list to keep in
 * sync: correctness comes from computing the hash on the projected graph.
 *
 * SAFE TO CALL MORE THAN ONCE. All three passes are idempotent and return the
 * ORIGINAL reference when they have nothing to do, so a graph already in
 * persisted form projects to itself byte-identically. The edit lane therefore
 * projects early (so its advertised hash is honest) and `commitDirectAnswer`
 * projects again at the chokepoint (so every OTHER lane is covered too) with no
 * double-application hazard.
 *
 * ORDER IS LOAD-BEARING: `reconcileTopLevelOptionsFromNodes` must run AFTER
 * `normaliseOptionInterventionContract` so a mirrored `options[]` entry copies
 * the already-canonical interventions bundle.
 */
import { repairGraphForPersistence } from './repair-graph-for-persistence.js';
import { normaliseOptionInterventionContract } from './normalise-option-interventions.js';
import { reconcileTopLevelOptionsFromNodes } from './reconcile-top-level-options.js';

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
 * Each pass is individually fail-open (a throw inside one returns its input
 * unchanged), so this composition cannot fail a commit on its own. A graph that
 * needs no repair is returned as the ORIGINAL reference.
 */
export function projectGraphForPersistence<T>(
  graph: T,
  ctx: PersistedGraphProjectionContext = {},
): T {
  if (graph === undefined || graph === null) return graph;
  const repaired = repairGraphForPersistence(graph, ctx);
  const normalised = normaliseOptionInterventionContract(repaired, ctx);
  return reconcileTopLevelOptionsFromNodes(normalised, ctx);
}
