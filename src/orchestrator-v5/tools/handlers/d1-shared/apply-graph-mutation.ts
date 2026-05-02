/**
 * Apply a structural mutation to GraphV3T and validate the result.
 *
 * Pattern: clone → mutate → Zod-parse the result. Failed parses raise
 * `D1HandlerError('GRAPH_INVARIANT_VIOLATED')` so an invalid post-mutation
 * graph never reaches commit.
 *
 * Per correction #6 (post-mutation graph validation): every D1 handler
 * routes through this helper so commits cannot persist a graph that
 * violates the canonical schema.
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
 * Run `mutator` against a clone of `graph`, parse the result through
 * `GraphV3.parse`, return the validated graph.
 *
 * The mutator may throw — typically a `D1HandlerError` for entity-not-found
 * or kind-mismatch — and that error propagates unchanged. Schema-violation
 * errors from `GraphV3.parse` are wrapped as
 * `D1HandlerError('GRAPH_INVARIANT_VIOLATED')` so the commit path can
 * distinguish "handler logic failed" from "handler produced an invalid
 * graph".
 */
export function applyAndValidateMutation<TBefore, TAfter>(
  graph: GraphV3T,
  mutator: (clone: GraphV3T) => { before: TBefore; after: TAfter },
): {
  readonly mutatedGraph: GraphV3T;
  readonly before: TBefore;
  readonly after: TAfter;
} {
  const clone = cloneGraph(graph);
  const { before, after } = mutator(clone);

  const parsed = GraphV3.safeParse(clone);
  if (!parsed.success) {
    throw new D1HandlerError(
      'GRAPH_INVARIANT_VIOLATED',
      'Post-mutation graph failed schema validation.',
      {
        details: {
          first_issue: parsed.error.issues[0]?.message,
          first_issue_path: parsed.error.issues[0]?.path.join('.'),
        },
      },
    );
  }

  return { mutatedGraph: parsed.data, before, after };
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
