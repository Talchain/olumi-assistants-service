/**
 * ⭐ WHICH IDENTITIES THIS RUN EVALUATED, AS THE GRAPH DECLARES THEM (Science d5 #87 6009457214, #2644). A leaf: read by P5
 * (`target-testability.ts`), the licence's walk (`reachedGoalPaths`) and the Run's reading tail (`goal-reading-disclosure.ts`),
 * so none of them can disagree about which product the Run worked out.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The identity carriers THIS Run evaluated, as the graph declares them. An evaluation names its node, and ISL's also says
 * the operation and operand set it worked out; when it does, they must be the graph's own (an evaluation of another
 * declaration — the graph changed since — attests nothing). Shared by P5 and the licence's walk, so the two never disagree.
 */
export function evaluatedIdentityCarriers(nodes: readonly Rec[], identityEvaluations?: readonly unknown[]): Set<unknown> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return new Set((identityEvaluations ?? []).filter(isRec).filter((e) => {
    const identity = byId.get(e.node_id)?.nonlinear_identity;
    if (e.evaluated !== true || !isRec(identity)) return false;
    const declared: unknown[] = Array.isArray(identity.factor_ids) ? identity.factor_ids : [];
    const said = Array.isArray(e.factor_ids) ? e.factor_ids : undefined;
    return (e.operation === undefined || e.operation === identity.operation)
      && (said === undefined || (said.length === declared.length && said.every((f) => declared.includes(f))));
  }).map((e) => e.node_id));
}
