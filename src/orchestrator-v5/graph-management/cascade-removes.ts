/**
 * Graph Management — cascade-redundant remove_edge elision (P0, 2026-08-16).
 *
 * THE DEFECT THIS CLOSES. `applyRemoveNode` (orchestrator/patch-applier.ts)
 * CASCADE-REMOVES every edge incident to the node it removes — that is its
 * documented contract, not an accident. So in a delete batch that removes the
 * node BEFORE its incident edges, each following `remove_edge` targets an edge
 * the cascade has already taken out, and `applyRemoveEdge` throws
 * `EDGE_NOT_FOUND`. On the CONFIRM path (`executeGmHeldResume`) that throw
 * resolves to `apply_failed`, and the whole confirmed deletion is refused —
 * a user's explicitly confirmed change silently never lands.
 *
 * WHY THE ELISION IS SEMANTICS-PRESERVING, not a suppression. The elided op
 * and the cascade ask for the SAME end state: that edge absent. The cascade
 * has already achieved it, so re-issuing the op cannot change the resulting
 * graph — it can only decide whether the applier throws. Nothing is removed
 * that the confirmed batch did not ask to remove, and nothing the batch asked
 * to remove survives. The end state is identical either way; only the fatality
 * differs.
 *
 * ⭐ WHAT THIS DELIBERATELY DOES NOT DO (CLAUDE.md trap 22b — a fix that
 * closes a gap must not open its inverse). It does NOT make `remove_edge`
 * tolerant of a missing edge in general. An edge that is absent for ANY OTHER
 * reason — never existed, already removed in an earlier turn, a typo'd path —
 * still reaches the applier and still throws, so the confirmed batch still
 * declines honestly. The ONLY ops elided are those a `remove_node` EARLIER IN
 * THE SAME BATCH provably cascaded. That is the discriminating line, and
 * `gm-confirm-resume-apply-p0.test.ts` case (b2) pins it: a non-cascade
 * un-appliable edge removal must still decline.
 *
 * ⚠⚠ LOAD-BEARING UPSTREAM DEPENDENCY — READ BEFORE RELAXING REFEREE R3.
 * This elision is sound ONLY because every `remove_edge` that reaches the
 * applier has already passed the referee's R3 referential-integrity check,
 * which REJECTS an edge that does not exist in the current graph
 * (`referee.ts` `referentialIntegrityBlocker`, remove_edge → `graphHasEdge`
 * → ENTITY_NOT_FOUND → verdict `rejected`, which `confirmationSatisfies`
 * declines). So by the time an op arrives here, "this edge is absent" can
 * only mean "a preceding remove_node in this batch cascaded it" — never
 * "it never existed". If R3 were ever relaxed from `rejected` to a HOLD for
 * remove_edge, a confirm would lift that hold and this elision would
 * silently swallow a phantom-edge op instead of declining the batch.
 * The coupling is pinned by `__tests__/cascade-removes.test.ts`
 * ("terminates at the referee, never reaching the applier").
 *
 * TOTAL: hostile/malformed op shapes are left VERBATIM for the applier to
 * judge, never elided on a guess. Never throws.
 */

import { parseEdgeTargetPath } from './adapters/edit-graph-producer.js';

/**
 * Structural mirror of the edit pipeline's `PatchOperation` — the same local
 * mirror `adapters/edit-graph-producer.ts` keeps, so this module stays inside
 * the graph-management import boundary (no `src/orchestrator/types.js`).
 */
export interface CascadeOpLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
  readonly old_value?: unknown;
}

export interface CascadeElisionResult<T extends CascadeOpLike> {
  /** The batch to hand the applier: input order, cascade-redundant ops removed. */
  readonly operations: readonly T[];
  /**
   * Paths of the elided `remove_edge` ops (diagnostics only). Empty on every
   * batch that carries no node-then-incident-edge ordering — the overwhelming
   * majority, which pass through byte-identical.
   */
  readonly elidedEdgePaths: readonly string[];
}

/** Best-effort string read; non-strings can never match a node id. */
function asPath(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Drop `remove_edge` operations whose target edge a `remove_node` EARLIER IN
 * THE SAME BATCH has already cascaded away.
 *
 * The scan is single-pass and order-sensitive, which is the whole point:
 *  - a `remove_node` adds its id to the cascaded set;
 *  - a `remove_edge` is elided ONLY when one of its endpoints is in that set,
 *    i.e. the cascade demonstrably preceded it;
 *  - an `add_node` re-introducing a removed id CLEARS it from the set, so a
 *    remove → re-add → remove-edge sequence is judged against the re-added
 *    node and left VERBATIM (the edge is genuinely expected to exist again);
 *  - every other op is passed through untouched.
 *
 * A `remove_edge` appearing BEFORE the `remove_node` is never elided — the
 * applier removes it directly and the cascade is then a no-op, which is
 * already the working order.
 */
export function elideCascadeRedundantRemoveEdges<T extends CascadeOpLike>(
  operations: readonly T[],
): CascadeElisionResult<T> {
  const kept: T[] = [];
  const elidedEdgePaths: string[] = [];
  /** Node ids a preceding remove_node has cascaded (minus any re-add). */
  const cascadedNodeIds = new Set<string>();

  for (const op of operations) {
    try {
      if (op.op === 'remove_node') {
        const id = asPath(op.path);
        if (id !== null) cascadedNodeIds.add(id);
        kept.push(op);
        continue;
      }
      if (op.op === 'add_node') {
        const id = asPath(op.path);
        // Re-adding the node does NOT restore the edges the cascade removed —
        // `applyAddNode` only pushes the node. So a later remove_edge naming
        // it would still fail at the applier, and eliding it would hide that.
        // Clearing the id here is the CONSERVATIVE choice: it stops this
        // module eliding anything once the id has been re-introduced, and
        // lets the applier judge the op on the graph as it actually stands.
        if (id !== null) cascadedNodeIds.delete(id);
        kept.push(op);
        continue;
      }
      if (op.op === 'remove_edge' && cascadedNodeIds.size > 0) {
        const path = asPath(op.path);
        const target = path === null ? null : parseEdgeTargetPath(path);
        // A malformed path is NOT elided — the applier must judge it.
        if (
          target !== null &&
          (cascadedNodeIds.has(target.from) || cascadedNodeIds.has(target.to))
        ) {
          elidedEdgePaths.push(path!);
          continue;
        }
      }
      kept.push(op);
    } catch {
      // TOTALITY: a hostile op shape is passed through, never dropped on a guess.
      kept.push(op);
    }
  }

  return { operations: kept, elidedEdgePaths };
}
