/**
 * LEAF module (no imports): the confirmed ceiling-stock carrier of a graph, by the exact id shape the typed postimage
 * writes. It lives apart from `ceiling-stock.ts` so the admission reader (`admission/target-testability.ts`) never pulls
 * the recogniser's heavy graph (config, stated-by-user, goal-horizon-detail) into a module-init cycle: a static import
 * of `goal-horizon-detail` there made `config` load before test-hoisted mocks (TDZ), failing four route suites.
 */
type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Only this extension's confirmed carrier may exclude retained surplus paths. */
export function isConfirmedCeilingStockCarrier(goal: Rec, carrier: Rec, h: number): boolean {
  return carrier.id === `${goal.id}_ceiling_stock_at_month_${h}`
    && carrier.nonlinear_identity?.operation === 'accumulation'
    && carrier.nonlinear_identity.stated_in_brief === true;
}

/** The ONE confirmed ceiling-stock reading (goal unary sum AND carrier both stated_in_brief, exact carrier id, held H), else null. */
export function confirmedCeilingStockOf(graph: unknown): { readonly goalId: string; readonly carrierId: string } | null {
  if (!rec(graph) || !Array.isArray(graph.nodes)) return null;
  const nodes: Rec[] = graph.nodes.filter(rec);
  const goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1 || typeof goals[0]!.id !== 'string') return null;
  const goal = goals[0]!;
  const identity = goal.nonlinear_identity;
  if (!rec(identity) || identity.operation !== 'sum' || identity.stated_in_brief !== true
    || !Array.isArray(identity.factor_ids) || identity.factor_ids.length !== 1) return null;
  const carrier = nodes.find(n => n.id === identity.factor_ids[0]);
  const month = carrier?.nonlinear_identity?.horizon_months;
  if (carrier === undefined || typeof month !== 'number' || !Number.isInteger(month) || goal.goal_horizon_months !== month
    || [goal, carrier].some(n => n.analysis_participation === 'retained_excluded')
    || !isConfirmedCeilingStockCarrier(goal, carrier, month)) return null;
  return { goalId: goal.id, carrierId: String(carrier.id) };
}

/** Graph-only carry authority for a schema-validated pending. Yes separately reattests the user's brief. */
export function ceilingStockPendingOfferable(graph: unknown, pending: unknown): boolean {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !rec(pending) || !rec(pending.transformation)) return false;
  const nodes: Rec[] = graph.nodes.filter(rec), goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1 || goals[0]!.id !== pending.goal_id
    || goals[0]!.nonlinear_identity != null
    || goals[0]!.goal_horizon_months !== pending.horizon_months
    || nodes.some(n => n.id === pending.transformation.carrier_id || n.id === pending.transformation.zero_id)) return false;
  return [pending.stock, pending.flow, pending.ceiling].every(q => {
    if (!rec(q)) return false;
    const matches = nodes.filter(n => n.id === q.id), n = matches[0];
    return matches.length === 1 && n?.kind === 'factor'
      && n.observed_state?.raw_value === q.raw_value && n.observed_state?.unit === q.unit;
  });
}
