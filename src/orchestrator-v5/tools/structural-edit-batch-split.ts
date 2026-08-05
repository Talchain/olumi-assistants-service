/**
 * ROADMAP 2.474 / AMENDMENT A3 — BATCH SPLITTING, NOT REFUSAL.
 *
 * ── THE WITNESSED DEFECT ────────────────────────────────────────────────────
 * The canonical headline sentence — "give each option its own driver" — was run
 * ten times on the deployed build (witness-2474-live-2026-08-05.md). It
 * produced a usable proposal TWICE. Probe C is the one to read: the tool DID
 * compose the edit — the server itself reported "3 node operations and 12 edge
 * operations" — and the whole batch was then thrown away on a cap the user
 * cannot see, with copy that named a limit but not a next step.
 *
 * Composing an edit and then discarding it is the worst of both worlds: the
 * user pays the latency of the model call and receives nothing to confirm.
 *
 * ── THE RULED SHAPE ─────────────────────────────────────────────────────────
 * "The cap becomes batch-splitting with disclosure (never silent truncation),
 * not refusal." So an over-cap batch becomes an ORDERED SEQUENCE OF PARTS, each
 * of which independently satisfies EVERY cap on the path. The caller proposes
 * the first part now and DISCLOSES the rest. Nothing is dropped, and nothing is
 * summarised away.
 *
 * ── ⚠ SPLITTING IS NOT DISCLOSED-PARTIAL (invariant A2, and the thing most
 *      likely to be broken by a later "simplification") ──────────────────────
 * A2 says one batch gets ONE governing verdict: a mixed batch holds WHOLE, a
 * reject applies NOTHING, and disclosed-partial cannot occur. Splitting must
 * not become disclosed-partial by the back door. The distinction is structural,
 * not a matter of copy:
 *
 *   DISCLOSED-PARTIAL (forbidden) — ONE batch reaches the gate, and SOME of its
 *     operations are applied while others are dropped. The verdict does not
 *     govern everything it was given.
 *   SPLITTING (this module) — part 1 reaches the gate and its verdict governs
 *     ALL of part 1. Parts 2..N are NEVER SUBMITTED at all: they are not
 *     applied, not rejected, not judged. They are disclosed as not-yet-proposed
 *     and offered as a next step.
 *
 * The test that keeps them distinguishable asserts exactly that: on a split
 * turn, precisely ONE operation array reaches `handleEditGraph`, it equals
 * `parts[0].operations` byte-for-byte, and every operation NOT in part 0
 * appears in NO submitted batch.
 *
 * ── ⚠ NEVER TRUNCATE — AND THE CONSERVATION CLAIM, STATED PRECISELY ────────
 * ⚠ THIS PARAGRAPH WAS WRONG WHEN FIRST WRITTEN, AND THE TEST CAUGHT IT. It
 * claimed "the concatenation of every part, in order, equals the input
 * operations, in order". That is FALSE and cannot be true of a
 * dependency-clustering splitter: grouping an operation with the create it
 * names is exactly what MOVES it relative to operations in another cluster.
 * The recorded claim is now the one the code actually provides:
 *
 *   1. MULTISET CONSERVATION — `parts.flatMap(p => p.indices)` sorted equals
 *      `[0 .. n-1]`. Every operation lands in exactly one part; none is
 *      dropped, none duplicated. This is the "never truncate" guarantee.
 *   2. LOCAL ORDER — within a part, indices are strictly increasing, so the
 *      model's own ordering is preserved wherever it still applies.
 *   3. CREATES LEAD — an operation naming a created id never sits in an
 *      earlier part than the `add_node` creating it (and within a part, never
 *      before it).
 *
 * Global order is NOT preserved, deliberately. It is asserted this precisely
 * rather than left to review because a truncating splitter and a correct one
 * are indistinguishable from the outside on the happy path, and a claim that
 * over-promises is the one nobody re-checks.
 *
 * ── THE CAPS ARE DERIVED, NEVER RESTATED (trap 12) ─────────────────────────
 * Four caps govern a batch on this path, and they are enforced in three
 * different modules. Every one of them is IMPORTED here, and the envelope
 * fan-out is counted with THE SAME PRODUCER the referee consumes, so a part
 * this module calls legal cannot be rejected by a number that drifted:
 *
 *   1. operation count   `config.cee.maxPatchOperations` (15)  — passed in
 *   2. node operations   `MAX_NODE_OPS` (4)                    — imported
 *   3. edge operations   `MAX_EDGE_OPS` (8)                    — imported
 *   4. envelope fan-out  `PROPOSAL_CAP` (8)                    — imported,
 *      counted via `editOperationsToCandidateEnvelopes`
 *
 * Where this module's count differs from the pipeline's it differs UPWARD:
 * `checkPatchBudget` runs after `stripNoOps` (which can only remove ops) and
 * its option-addition branch splits the edge budget into two independently
 * capped buckets (so it can admit MORE edges than the flat cap, never fewer).
 * A part legal here is therefore legal there. The safe direction is the one
 * where this module is stricter.
 */

import { PROPOSAL_CAP } from '../graph-management/types.js';
import {
  editOperationsToCandidateEnvelopes,
  type EditPatchOperationLike,
} from '../graph-management/adapters/edit-graph-producer.js';
import {
  MAX_NODE_OPS,
  MAX_EDGE_OPS,
} from '../../orchestrator/tools/patch-budget-limits.js';
import { createdNodeIdOf, referencedNodeIdsOf } from './structural-edit-references.js';

const NODE_OPS: ReadonlySet<string> = new Set(['add_node', 'remove_node', 'update_node']);
const EDGE_OPS: ReadonlySet<string> = new Set(['add_edge', 'remove_edge', 'update_edge']);

export interface StructuralEditSplitLimits {
  /** Pipeline operation cap per part (`config.cee.maxPatchOperations`). */
  readonly maxOperations: number;
  /** Node-operation budget per part (`MAX_NODE_OPS`). */
  readonly maxNodeOps: number;
  /** Edge-operation budget per part (`MAX_EDGE_OPS`). */
  readonly maxEdgeOps: number;
  /** Referee envelope cap per part (`PROPOSAL_CAP`). */
  readonly maxEnvelopes: number;
  /**
   * How many parts a request may become before it is honestly refused.
   *
   * DERIVED, not chosen: `ceil(maxOperations / maxNodeOps)` is the number of
   * parts a MAXIMAL batch needs under the tightest per-part cap — 15 node
   * operations at 4 per part is exactly 4 parts. A partition needing more than
   * that is not big-because-many-operations; it is big because a handful of
   * multi-field updates fan out, and telling the user "this is a bigger change
   * than I can propose, even in steps" is then the honest answer rather than
   * marching them through six confirmations.
   *
   * The floor of 2 keeps the capability from vanishing under a small configured
   * `maxPatchOperations`: whatever the caps are, a request that is too large for
   * one part is always allowed to become two.
   */
  readonly maxParts: number;
}

export function deriveSplitLimits(maxPatchOperations: number): StructuralEditSplitLimits {
  const maxOperations = Math.max(1, Math.floor(maxPatchOperations));
  return {
    maxOperations,
    maxNodeOps: MAX_NODE_OPS,
    maxEdgeOps: MAX_EDGE_OPS,
    maxEnvelopes: PROPOSAL_CAP,
    maxParts: Math.max(2, Math.ceil(maxOperations / MAX_NODE_OPS)),
  };
}

export interface StructuralEditPart {
  /** The operations of this part, in their ORIGINAL relative order. */
  readonly operations: readonly EditPatchOperationLike[];
  /**
   * The indices these operations occupied in the ORIGINAL batch. Callers use
   * these to slice a whole-batch description (`describeChangeset`) rather than
   * re-describing a part in isolation, which would lose the labels of nodes an
   * earlier part creates.
   */
  readonly indices: readonly number[];
  /** Envelope fan-out this part will produce at the referee. */
  readonly envelopeCount: number;
  /**
   * True when this part names a node id that an EARLIER part creates.
   *
   * Such a part cannot be proposed until the earlier one is CONFIRMED AND
   * APPLIED — until then the id is not in the persisted graph and the grounding
   * validator would (correctly) reject the part as ungrounded. The caller must
   * say so rather than implying the next step is available immediately.
   */
  readonly dependsOnEarlierPart: boolean;
}

export type StructuralEditPartitionFailure =
  /** A SINGLE operation is over a cap on its own — no partition can help. */
  | 'operation_exceeds_part'
  /** The partition is legal but needs more parts than `maxParts`. */
  | 'too_many_parts';

export type StructuralEditPartition =
  | { readonly ok: true; readonly parts: readonly StructuralEditPart[] }
  | {
      readonly ok: false;
      readonly failure: StructuralEditPartitionFailure;
      /** How many parts the request would have needed (>= 1). */
      readonly partsNeeded: number;
    };

interface Measurement {
  readonly operationCount: number;
  readonly nodeOps: number;
  readonly edgeOps: number;
  readonly envelopeCount: number;
}

/**
 * Measure a candidate part against every cap. The envelope count comes from THE
 * PRODUCER THE REFEREE CONSUMES — never from an op-count heuristic, because the
 * fan-out is per FIELD and a 5-operation batch of multi-field updates can
 * exceed 8 envelopes while looking small.
 */
export function measurePart(operations: readonly EditPatchOperationLike[]): Measurement {
  let nodeOps = 0;
  let edgeOps = 0;
  for (const op of operations) {
    if (NODE_OPS.has(op.op)) nodeOps += 1;
    else if (EDGE_OPS.has(op.op)) edgeOps += 1;
  }
  const envelopeCount = editOperationsToCandidateEnvelopes(operations, {
    base_graph_hash: 'preflight',
    scenario_id: 'preflight',
    turn_id: 'preflight',
    makeCandidateId: () => 'preflight',
  }).length;
  return { operationCount: operations.length, nodeOps, edgeOps, envelopeCount };
}

function fits(m: Measurement, limits: StructuralEditSplitLimits): boolean {
  return (
    m.operationCount <= limits.maxOperations &&
    m.nodeOps <= limits.maxNodeOps &&
    m.edgeOps <= limits.maxEdgeOps &&
    m.envelopeCount <= limits.maxEnvelopes
  );
}

/**
 * Group operation indices into DEPENDENCY CLUSTERS — a create and everything
 * that names what it creates, transitively.
 *
 * This is what makes the headline scenario split into INDEPENDENT proposals
 * rather than dependent ones. "Give each option its own driver" composes as
 * (add A, add B, add C, link A→X, link B→Y, link C→Z, …): clustering yields
 * {add A, its links}, {add B, its links}, {add C, its links}, each of which
 * links only to nodes ALREADY in the graph. Naive sequential packing would
 * instead put all three creates in part 1 and their links in part 2 — and part
 * 2 would then be ungrounded until part 1 was confirmed.
 */
function clusterIndices(operations: readonly EditPatchOperationLike[]): number[][] {
  const n = operations.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let cur = i;
    while (parent[cur] !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const createdBy = new Map<string, number>();
  operations.forEach((op, i) => {
    const created = createdNodeIdOf(op);
    // First writer wins: the grounding validator's G4 already rejects a batch
    // that creates the same id twice, so this only matters for totality.
    if (created !== null && !createdBy.has(created)) createdBy.set(created, i);
  });

  operations.forEach((op, i) => {
    for (const ref of referencedNodeIdsOf(op)) {
      const creator = createdBy.get(ref);
      if (creator !== undefined) union(i, creator);
    }
  });

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const bucket = byRoot.get(root);
    if (bucket === undefined) byRoot.set(root, [i]);
    else bucket.push(i);
  }
  // Cluster order = order of first appearance, so the emitted parts follow the
  // order the model composed in and the disclosure reads in that order too.
  return [...byRoot.values()].sort((a, b) => a[0]! - b[0]!);
}

/**
 * Partition a validated, GROUNDED batch into cap-legal parts.
 *
 * See the header for the three conservation properties this provides — and for
 * the one it does NOT (global order), which an earlier version of that header
 * wrongly claimed.
 */
export function partitionStructuralEditBatch(
  operations: readonly EditPatchOperationLike[],
  limits: StructuralEditSplitLimits,
): StructuralEditPartition {
  if (operations.length === 0) return { ok: true, parts: [] };

  // A single operation over a cap on its own cannot be helped by any partition
  // (e.g. an `update_node` writing nine fields = nine envelopes). Caught first
  // so the caller can say what actually happened instead of reporting a part
  // count that was never achievable.
  for (let i = 0; i < operations.length; i += 1) {
    if (!fits(measurePart([operations[i]!]), limits)) {
      return { ok: false, failure: 'operation_exceeds_part', partsNeeded: operations.length };
    }
  }

  // ⚠ THE ORDINARY PATH IS BYTE-IDENTICAL, AND THAT IS A REQUIREMENT.
  //
  // Clustering REORDERS (it moves an operation next to the create it names).
  // On a batch that fits in one proposal there is nothing to reorder FOR, and
  // reordering it anyway would change what the tool submits on every ordinary
  // turn — a behaviour change on the happy path that nobody asked for, in the
  // one place the live witness already proved sound. Caught by the positive
  // control, which compares the single part to the input operation-for-
  // operation.
  if (fits(measurePart(operations), limits)) {
    return {
      ok: true,
      parts: [
        {
          operations: [...operations],
          indices: operations.map((_, i) => i),
          envelopeCount: measurePart(operations).envelopeCount,
          dependsOnEarlierPart: false,
        },
      ],
    };
  }

  const clusters = clusterIndices(operations);
  const partIndexLists: number[][] = [];
  let current: number[] = [];
  const opsAt = (idx: readonly number[]): EditPatchOperationLike[] =>
    idx.map((i) => operations[i]!);

  const flush = (): void => {
    if (current.length > 0) {
      // ASCENDING within the part. Two clusters merged into one part arrive as
      // concatenated index runs, which is not ascending — and the model's own
      // ordering inside a proposal is worth keeping. Safe with respect to
      // "creates lead": the grounding validator only accepts a batch in which
      // an operation naming a batch-created id comes AFTER its `add_node`, so
      // ascending original order preserves that relation by construction.
      partIndexLists.push([...current].sort((a, b) => a - b));
      current = [];
    }
  };

  for (const cluster of clusters) {
    if (fits(measurePart(opsAt([...current, ...cluster])), limits)) {
      current = [...current, ...cluster];
      continue;
    }
    flush();
    if (fits(measurePart(opsAt(cluster)), limits)) {
      current = [...cluster];
      continue;
    }
    // The cluster is over a cap on its own. It must be broken, and breaking it
    // creates a DEPENDENT part — flagged, never hidden. Operations stay in
    // order, so a create always precedes anything naming it.
    for (const i of cluster) {
      if (!fits(measurePart(opsAt([...current, i])), limits)) flush();
      current.push(i);
    }
  }
  flush();

  if (partIndexLists.length > limits.maxParts) {
    return { ok: false, failure: 'too_many_parts', partsNeeded: partIndexLists.length };
  }

  // Dependency flags, computed against ids created STRICTLY EARLIER.
  const createdBefore = new Set<string>();
  const parts: StructuralEditPart[] = partIndexLists.map((indices) => {
    const ops = opsAt(indices);
    let dependsOnEarlierPart = false;
    for (const op of ops) {
      for (const ref of referencedNodeIdsOf(op)) {
        if (createdBefore.has(ref)) dependsOnEarlierPart = true;
      }
    }
    for (const op of ops) {
      const created = createdNodeIdOf(op);
      if (created !== null) createdBefore.add(created);
    }
    return {
      operations: ops,
      indices,
      envelopeCount: measurePart(ops).envelopeCount,
      dependsOnEarlierPart,
    };
  });

  return { ok: true, parts };
}
