/**
 * Apply a structural mutation to a GraphV3-shaped subset of an ingress
 * graph and validate the result.
 *
 * Pattern: parse ingress → clone the parsed view → run mutator → re-parse
 * the mutated view → merge mutated structural fields (`nodes`, `edges`,
 * `goal_constraints`) back onto the FULL ingress shape so top-level
 * fields not declared on GraphV3 (e.g. `options`, `goal_node_id`,
 * `meta`, `coaching`, `causal_claims`, `topology_plan`,
 * `validation_warnings`, `schema_version`) survive into the persisted
 * mutatedGraph. Without this merge, every D1 mutation would silently
 * strip those fields from `scenarios.graph`.
 *
 * Per correction #6 (post-mutation graph validation): commits never
 * persist a graph that violates the canonical schema. Schema-violation
 * errors from `GraphV3.safeParse` are wrapped as
 * `D1HandlerError('GRAPH_INVARIANT_VIOLATED')` so the commit path can
 * distinguish "handler logic failed" from "handler produced an invalid
 * graph".
 */

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { log } from '../../../../utils/telemetry.js';
import { D1HandlerError } from './errors.js';

/**
 * The runtime shape of a graph returned by `applyAndValidateMutation`:
 * a `GraphV3T` (validated structural fields) intersected with a
 * passthrough record so callers can still read top-level ingress
 * fields like `options`, `goal_node_id`, `meta`, `coaching`,
 * `causal_claims`, `topology_plan`, `validation_warnings`,
 * `schema_version` that GraphV3 strips on parse.
 *
 * Type contract matches the runtime contract (A3.1 Task 2): the
 * helper does NOT return the GraphV3-narrowed projection, it returns
 * the merged ingress shape with mutated structural fields stamped in.
 * Callers and the commit layer treat it as `unknown` (CommitMetadata.graph
 * is `unknown`), so the wider intersection is structurally compatible
 * everywhere downstream.
 */
export type PersistedGraphV3T = GraphV3T & Record<string, unknown>;

export interface MutationResult {
  readonly mutatedGraph: PersistedGraphV3T;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/**
 * Deep-clone a graph for mutation. JSON round-trip is sufficient because
 * GraphV3T is JSON-serialisable; structuredClone would also work but
 * stringify keeps the dependency surface minimal.
 */
export function cloneGraph(graph: GraphV3T): GraphV3T {
  return JSON.parse(JSON.stringify(graph)) as GraphV3T;
}

/**
 * Run `mutator` against a GraphV3-shaped clone of `ingressGraph`,
 * validate the result, then merge the mutated structural fields back
 * onto the full ingress shape. The returned `mutatedGraph` has the
 * SAME top-level keys as the ingress, with mutated `nodes` / `edges` /
 * (optional) `goal_constraints` from the validated parse.
 *
 * The `ingressGraph` parameter is `unknown` so the executor can pass
 * the raw `invocation.graphForTurn` directly without first narrowing
 * to `GraphV3T` (the narrowing would lose the wider ingress shape we
 * want to preserve).
 *
 * The mutator receives a `GraphV3T`-narrowed clone and may throw —
 * typically a `D1HandlerError` for entity-not-found or kind-mismatch —
 * and that error propagates unchanged.
 *
 * @returns `mutatedGraph` shares NO object with `ingressGraph`. The merge is a
 *          shallow spread, so this is enforced by an explicit clone rather than
 *          being a property of the spread — see the comment at the composer.
 *          Callers may mutate the result freely.
 */
export function applyAndValidateMutation<TBefore, TAfter>(
  ingressGraph: unknown,
  mutator: (clone: GraphV3T) => { before: TBefore; after: TAfter },
): {
  readonly mutatedGraph: PersistedGraphV3T;
  readonly before: TBefore;
  readonly after: TAfter;
} {
  // 1. Parse the ingress to obtain a GraphV3-shaped working copy.
  //    The parsed output is a fresh object; mutating it does not
  //    affect the ingress.
  const ingressParse = GraphV3.safeParse(ingressGraph);
  if (!ingressParse.success) {
    throw new D1HandlerError(
      'GRAPH_INVARIANT_VIOLATED',
      'Ingress graph failed schema validation.',
      {
        details: {
          first_issue: ingressParse.error.issues[0]?.message,
          first_issue_path: ingressParse.error.issues[0]?.path.join('.'),
        },
      },
    );
  }
  const clone = JSON.parse(JSON.stringify(ingressParse.data)) as GraphV3T;
  const { before, after } = mutator(clone);

  // 2. Re-parse the mutated graph for post-mutation validation.
  const postParse = GraphV3.safeParse(clone);
  if (!postParse.success) {
    throw new D1HandlerError(
      'GRAPH_INVARIANT_VIOLATED',
      'Post-mutation graph failed schema validation.',
      {
        details: {
          first_issue: postParse.error.issues[0]?.message,
          first_issue_path: postParse.error.issues[0]?.path.join('.'),
        },
      },
    );
  }

  // 3. Merge the mutated structural fields onto the full ingress
  //    shape so top-level fields not declared on GraphV3 survive the
  //    round-trip into commit. Mirror of the post-handler hash-merge
  //    pattern in turn-executor.
  const ingressShape =
    ingressGraph !== null &&
    typeof ingressGraph === 'object' &&
    !Array.isArray(ingressGraph)
      ? (ingressGraph as Record<string, unknown>)
      : {};
  // ⭐ THE SPREAD IS SHALLOW, SO THE CLONE IS PART OF THE RETURN CONTRACT.
  // Without it `mutatedGraph.options` / `.meta` / every other top-level object
  // is THE SAME REFERENCE the caller's `ingressGraph` holds, and any later
  // in-place pass over the result (a prune does `delete bag[key]` and
  // `graph.meta[field] = kept`) rewrites the caller's graph underneath it. The
  // caller then derives a CAS expected-base hash from a graph that was never
  // persisted. See `mergeMutatedGraphForPersistence` below and the pin in
  // `system-events/__tests__/persist-merge-helpers-own-their-clone.test.ts`.
  const mutatedGraph = structuredClone({
    ...ingressShape,
    nodes: postParse.data.nodes,
    edges: postParse.data.edges,
    ...(postParse.data.goal_constraints !== undefined
      ? { goal_constraints: postParse.data.goal_constraints }
      : {}),
  }) as PersistedGraphV3T;

  return { mutatedGraph, before, after };
}

/**
 * V5-D1-SHAPE-01 — merge a D1 `mutated_graph` back onto the
 * server-authoritative persisted graph shape before persistence.
 *
 * Sibling of `mergeAppliedGraphForPersistence` (edit-graph-dispatch.ts,
 * V5-PERSIST-FIX-01 / PR #265), which fixed the identical corruption
 * class for `edit_graph` and explicitly flagged the D1 ingress-base
 * merge as the remaining gap. The bug: `applyAndValidateMutation`
 * (above) merges mutated structural fields back onto the INGRESS
 * top-level shape — but the DGAI wire echo carries only
 * `{nodes, edges}`, never `goal_node_id` / `options[]`, so a D1
 * mutation committed wholesale replaced the rich draft-persisted
 * `scenarios.graph` with a stripped shape — canonical state loss:
 * goal_node_id gone, options[] → 0 (scorecard J5c), top-level
 * metadata stripped, future turns inherit the lossy merge base, and
 * freshness/hash behaviour can spuriously diverge. (run_analysis may
 * still succeed — readiness re-derives goal/options from node kinds —
 * so this is corruption, not a guaranteed analysis outage.)
 *
 * Merge precedence (deliberate, per V5-D1-SHAPE-01):
 *   1. The PERSISTED `scenarios.graph` (pre-mutation, strict-read by
 *      the caller) is the base — NOT the ingress echo.
 *   2. `mutatedGraph` wins for what the D1 mutation actually changed:
 *      `nodes`, `edges`, and — unlike the edit_graph sibling —
 *      top-level `goal_constraints` when present (D1 `add_constraint`
 *      owns that field; no edit_graph operation writes it, which is
 *      exactly why #265 does NOT overlay it).
 *   3. Everything else top-level (`goal_node_id`, `options[]`, `meta`,
 *      `schema_version`, draft-pipeline fields, …) passes through from
 *      the base verbatim. Nothing is invented.
 *   4. No options[] deletion dedupe: no D1 mutation removes nodes
 *      (set_factor_value / add_constraint / adjust_edge_strength all
 *      mutate in place), so unlike #265 there is no provably-deleted
 *      option to drop — `options[]` survives byte-for-byte.
 *
 * Fallback to `mutatedGraph` as-is (the legacy ingress-shaped merge)
 * covers the two cases the caller legitimately passes — NOT a degraded
 * read. A degraded/unavailable persisted read FAILS CLOSED upstream at
 * the turn-executor STEP 7 commit site (the strict loader's throw maps
 * to STATE_COMMIT_FAILED; nothing is persisted), so "unavailable" is
 * deliberately absent here:
 *   - `persistedBase === null` — a GENUINELY-empty `scenarios.graph`
 *     (strict read succeeded, no graph stored). Nothing to lose; the
 *     ingress-shaped mutated graph is the first valid write.
 *   - non-null but structurally unusable (not an object / missing
 *     nodes+edges arrays) — malformed-but-READABLE persisted graph.
 *     Heal forward via the mutated graph (commit a valid shape) rather
 *     than fail closed, mirroring #265; logged at WARN, never silent.
 *
 * ⭐⭐ RETURN CONTRACT — THE RESULT ALIASES NOTHING THE CALLER PASSED IN.
 *
 * The composition is a SHALLOW spread, so without an explicit clone
 * `merged.options` / `merged.meta` and every other top-level object are
 * THE SAME OBJECT REFERENCES as `persistedBase`'s — and the
 * `persistedUsable === false` limb returns `mutatedGraph` itself. Any
 * later pass that mutates the result in place then rewrites the caller's
 * trusted base, and the three CAS-deriving call sites
 * (`structural-delete.ts`, `factor-value-edit.ts`, `edge-strength-edit.ts`)
 * derive their atomic-CAS expected base from exactly that object AFTER
 * this returns. In `structural_delete` that shipped as a P0: an expected
 * hash for a graph that was never persisted, so every subsequent delete
 * was refused permanently. Only ONE of the three call sites had a clone;
 * ownership therefore lives here, matching `exposeCandidate`
 * (`graph-management/candidate-graph.ts`). Pinned by
 * `system-events/__tests__/persist-merge-helpers-own-their-clone.test.ts`.
 * Cost measured: ~0.2ms against a ~988ms turn.
 *
 * @internal Exported for testing and for the turn-executor STEP 7
 * commit site (the single place a D1 `mutated_graph` reaches
 * persistence).
 * @returns A graph sharing no object with `mutatedGraph` or
 *          `persistedBase`. Callers may mutate it freely.
 */
export function mergeMutatedGraphForPersistence(args: {
  /** Handler-emitted post-mutation graph (ingress-shaped, validated). */
  readonly mutatedGraph: Record<string, unknown>;
  /**
   * Raw persisted `scenarios.graph` (pre-mutation), or null for a
   * GENUINELY-empty scenario. A degraded read never reaches here — it
   * fails closed at the STEP 7 commit site before this helper is called.
   */
  readonly persistedBase: unknown;
  readonly requestId: string;
  readonly scenarioId: string;
}): Record<string, unknown> {
  const { mutatedGraph, persistedBase, requestId, scenarioId } = args;
  const persistedUsable =
    persistedBase !== null &&
    persistedBase !== undefined &&
    typeof persistedBase === 'object' &&
    !Array.isArray(persistedBase) &&
    Array.isArray((persistedBase as Record<string, unknown>).nodes) &&
    Array.isArray((persistedBase as Record<string, unknown>).edges);
  // A non-null persisted base that is NOT usable = a malformed-but-readable
  // scenarios.graph. We heal forward via the mutated graph (see docstring)
  // but flag it loudly so the anomaly is never silent.
  const persistedMalformed =
    persistedBase !== null && persistedBase !== undefined && !persistedUsable;

  const merged: Record<string, unknown> = persistedUsable
    ? {
        ...(persistedBase as Record<string, unknown>),
        nodes: mutatedGraph.nodes,
        edges: mutatedGraph.edges,
        ...(mutatedGraph.goal_constraints !== undefined
          ? { goal_constraints: mutatedGraph.goal_constraints }
          : {}),
      }
    : mutatedGraph;

  const base = persistedUsable
    ? (persistedBase as Record<string, unknown>)
    : mutatedGraph;
  const logPayload = {
    event: 'v5.d1.persist_merge_back',
    request_id: requestId,
    scenario_id: scenarioId,
    base: persistedUsable
      ? 'persisted'
      : persistedMalformed
        ? 'mutated_fallback_malformed_base'
        : 'mutated_fallback_genuine_empty',
    base_has_goal_node_id: typeof base.goal_node_id === 'string',
    base_options_count: Array.isArray(base.options) ? base.options.length : null,
    mutated_node_count: Array.isArray(mutatedGraph.nodes)
      ? mutatedGraph.nodes.length
      : null,
    mutated_edge_count: Array.isArray(mutatedGraph.edges)
      ? mutatedGraph.edges.length
      : null,
  };
  if (persistedMalformed) {
    log.warn(
      logPayload,
      'V5 D1 — persisted scenarios.graph was non-null but structurally unusable; healing forward via the mutated ingress-shaped graph (no rich top-level fields recoverable from a malformed graph)',
    );
  } else {
    log.info(
      logPayload,
      'V5 D1 — mutated graph merged onto persisted graph shape for persistence',
    );
  }

  // ⭐ THE CLONE IS PART OF THE RETURN CONTRACT (see the docstring). Note it
  // covers BOTH limbs: the shallow spread aliases `persistedBase`'s top-level
  // objects, and the `persistedUsable === false` fallback returns
  // `mutatedGraph` ITSELF — the limb a reader skims past.
  return structuredClone(merged);
}

/**
 * Convenience wrapper: serialise an arbitrary value to a `Record<string,
 * unknown> | null` shape that the HandlerFact's `before`/`after` fields
 * accept. Numbers/strings/booleans are wrapped in `{ value }`. Objects
 * pass through. Null/undefined → null.
 */
export function toFactPayload(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value } as Record<string, unknown>;
}
