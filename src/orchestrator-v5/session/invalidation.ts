/**
 * Cache invalidation primitives for V5 session store (slice B).
 *
 * `InvalidationScope` is an INTERNAL type, distinct from the wire-level
 * `GraphInvalidationSchema` in @talchain/schemas/orchestrator. The wire
 * schema is for cross-service invalidation triggers (PLoT → CEE); this
 * type is how CEE's own cache layer describes what to evict. Slice B has
 * no cross-service wire crossings; Slice C+ may add a mapper at that
 * boundary.
 *
 * Slice B precision limit: scoped invalidations (`factor` / `edge`)
 * currently evict the same entries as `structural` because handler facts
 * — the only source of per-turn factor/edge-reference metadata — are not
 * yet emitted (Slice C work). This is pessimistic but correct; Slice C
 * will refine to evict only turns whose facts reference the scoped target.
 */

export type InvalidationScope =
  | { readonly kind: 'factor'; readonly factorId: string }
  | { readonly kind: 'edge'; readonly edgeId: string }
  | { readonly kind: 'structural' };

export interface InvalidationResult {
  readonly scope: InvalidationScope;
  readonly entries_invalidated: readonly string[]; // turn_ids
}

export function describeScope(scope: InvalidationScope): string {
  switch (scope.kind) {
    case 'factor':
      return `factor:${scope.factorId}`;
    case 'edge':
      return `edge:${scope.edgeId}`;
    case 'structural':
      return 'structural';
  }
}
