/**
 * ⭐ WHICH IDENTITIES THIS RUN EVALUATED, AS THE GRAPH DECLARES THEM (Science d5 #87 6009457214, #2644). A leaf: read by P5
 * (`target-testability.ts`), the licence's walk (`reachedGoalPaths`) and the Run's reading tail (`goal-reading-disclosure.ts`),
 * so none of them can disagree about which product the Run worked out.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const GOAL_LEVEL_FROM_IDENTITY_INPUTS = 'GOAL_LEVEL_FROM_IDENTITY_INPUTS';

/** The existing product-carrier reader, shared with admission's structural sign checks. */
export function readProductIdentityCarrier(n: Rec): {
  readonly operation: 'product'; readonly factor_ids: readonly string[]; readonly stated_in_brief: boolean;
} | null {
  const c = n.nonlinear_identity as { operation?: unknown; factor_ids?: unknown; stated_in_brief?: unknown } | undefined;
  if (c === null || typeof c !== 'object' || c.operation !== 'product' || typeof c.stated_in_brief !== 'boolean') return null;
  if (!Array.isArray(c.factor_ids) || c.factor_ids.length < 2 || !c.factor_ids.every((f) => typeof f === 'string' && f !== '')) return null;
  return { operation: 'product', factor_ids: c.factor_ids as string[], stated_in_brief: c.stated_in_brief };
}

/** This Run derived the selected goal's baseline from identity inputs, identified only by typed carriers. */
export function goalBaselineFromIdentityInputs(
  nodes: readonly Rec[], goalId: unknown, identityEvaluations?: readonly unknown[], inferenceWarnings?: readonly unknown[],
): boolean {
  if ((identityEvaluations ?? []).some(e => isRec(e) && e.node_id === goalId && e.level_source === 'identity_inputs'
    && evaluatedIdentityCarriers(nodes, [e]).has(goalId))) return true;
  return (inferenceWarnings ?? []).some(w => {
    if (!isRec(w) || w.code !== GOAL_LEVEL_FROM_IDENTITY_INPUTS) return false;
    if (w.node_id !== undefined) return w.node_id === goalId;
    if (w.field !== undefined) return w.field === `nodes[${String(goalId)}].nonlinear_identity`;
    // The existing warning reader falls back to the goal when no id is carried. Ambiguous goals attest nothing.
    return nodes.filter(n => n.kind === 'goal').length === 1 && nodes.some(n => n.kind === 'goal' && n.id === goalId);
  });
}

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
      // The SAME operand set: no repeats, and each side holds every operand of the other (Codex buddy r1 F4: [price, price]).
      && (said === undefined || (new Set(said).size === said.length && said.length === declared.length
        && said.every((f) => declared.includes(f)) && declared.every((f) => said.includes(f))));
  }).map((e) => e.node_id));
}

/** The shared goal-walk rule: only a declared operand into a stated or Run-evaluated identity is exact. */
export function exactIdentityOperandLinks(
  nodes: readonly Rec[], edges: readonly Rec[], identityEvaluations?: readonly unknown[],
  /** Limits require this Run's attestation; the existing goal-walk caller retains its declared-identity rule. */
  mode: 'stated_or_evaluated' | 'evaluated_only' = 'stated_or_evaluated',
): Set<Rec> {
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const evaluated = evaluatedIdentityCarriers(nodes, identityEvaluations);
  return new Set(edges.filter(e => {
    const to = byId.get(e.to);
    const identity = isRec(to?.nonlinear_identity) ? to.nonlinear_identity : undefined;
    return identity !== undefined && ((mode === 'stated_or_evaluated' && identity.stated_in_brief !== false) || evaluated.has(to?.id))
      && Array.isArray(identity.factor_ids) && identity.factor_ids.includes(e.from);
  }));
}
