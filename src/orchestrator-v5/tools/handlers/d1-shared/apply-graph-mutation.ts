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
import { D1HandlerError } from './errors.js';

export interface MutationResult {
  readonly mutatedGraph: GraphV3T;
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
 */
export function applyAndValidateMutation<TBefore, TAfter>(
  ingressGraph: unknown,
  mutator: (clone: GraphV3T) => { before: TBefore; after: TAfter },
): {
  readonly mutatedGraph: GraphV3T;
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
  const mutatedGraph = {
    ...ingressShape,
    nodes: postParse.data.nodes,
    edges: postParse.data.edges,
    ...(postParse.data.goal_constraints !== undefined
      ? { goal_constraints: postParse.data.goal_constraints }
      : {}),
  } as unknown as GraphV3T;

  return { mutatedGraph, before, after };
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
