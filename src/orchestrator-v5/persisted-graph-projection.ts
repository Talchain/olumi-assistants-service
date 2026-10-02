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
 *
 * `reindexInterventionKeys` runs after every pass that can change a node's
 * `interventions`, so the UI's index of them is never stored stale (#2084
 * review: a delete left it naming a deleted factor, and the reload proof
 * declined the Run). See `reindex-intervention-keys.ts`.
 *
 * `dropNullOptionalGraphFields` runs LAST: a `null` on a schema-optional key
 * makes the stored bytes unreadable by every strict `GraphV3` reader (served
 * 26 Sep 2026: one UI register poisoned a scenario, and every later canvas edit
 * returned 500). It is last so a pass that gives a `null` a MEANING runs first —
 * `normaliseOptionInterventionContract` turns `interventions: null` into `{}`
 * (P0-A) — and only a `null` nothing else claimed is dropped as absence.
 * See `drop-null-optional-fields.ts`.
 */
import { dropNullOptionalGraphFields } from './drop-null-optional-fields.js';
import { repairGraphForPersistence } from './repair-graph-for-persistence.js';
import { normaliseOptionInterventionContract } from './normalise-option-interventions.js';
import { reconcileTopLevelOptionsFromNodes } from './reconcile-top-level-options.js';
import { reindexInterventionKeys } from './reindex-intervention-keys.js';
import { refuseInadmissibleInterventionRanges } from './intervention-range.js';
import { log } from '../utils/telemetry.js';

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
/**
 * ⭐ THE BASE A STORED-BYTES GUARD COMPARES AGAINST: the stored graph with only ABSENCE-EQUIVALENT drift removed
 * (#2084 review, Runtime 5855308269). Two passes of the persisted form change bytes without changing any fact:
 * a `null` the schema reads as absence (`dropNullOptionalGraphFields`) and the UI's derived `interventionKeys`
 * index brought into step with its cells (`reindexInterventionKeys`). Staging already stores both kinds of legacy
 * bytes, so a guard that demanded the raw bytes be a fixed point refused writes the base committed. Every OTHER
 * pass (intercept repair, intervention promotion, options mirror) is a real repair and still refuses.
 */
export function normaliseAbsenceOnly<T>(graph: T): T {
  return dropNullOptionalGraphFields(reindexInterventionKeys(graph));
}

/**
 * TEMPORAL writer rule (R3 #75 5914230653 (2)): a stated range that is malformed or does not contain its option's value
 * is REFUSED at the persisted form, so no lane can store one (`intervention-range.ts`). Runs after the intervention
 * promotion (so a lifted `data.interventions` cell is covered) and before the options mirror (so a mirrored entry
 * copies the admitted bundle). Fail-open like its siblings; logs ids and reasons only, never magnitudes.
 */
function admitInterventionRanges<T>(graph: T, ctx: PersistedGraphProjectionContext): T {
  try {
    const { graph: admitted, refused } = refuseInadmissibleInterventionRanges(graph);
    if (refused.length > 0) {
      log.info(
        {
          event: 'v5.graph_persist.intervention_range_refused',
          scenario_id: ctx.scenarioId,
          turn_id: ctx.turnId,
          source: ctx.source,
          refused,
        },
        '[persist] refused a stated range that is malformed or does not contain its option\'s value (ids + reasons only)',
      );
    }
    return admitted;
  } catch {
    return graph;
  }
}

export function projectGraphForPersistence<T>(
  graph: T,
  ctx: PersistedGraphProjectionContext = {},
): T {
  if (graph === undefined || graph === null) return graph;
  const repaired = repairGraphForPersistence(graph, ctx);
  const normalised = normaliseOptionInterventionContract(repaired, ctx);
  const admitted = admitInterventionRanges(normalised, ctx);
  const reconciled = reconcileTopLevelOptionsFromNodes(admitted, ctx);
  const reindexed = reindexInterventionKeys(reconciled);
  return dropNullOptionalGraphFields(reindexed, ctx);
}
