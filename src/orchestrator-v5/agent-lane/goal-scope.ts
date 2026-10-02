import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { GoalScopeSchema, goalScopeMeaning, type GoalScope, type GoalScopeReconciliation } from '../../schemas/goal-scope.js';
import { RECONCILIATION_TOLERANCE, unitsCompose } from './reconciling-product.js';
import { figureTheUserWrote } from './stated-by-user.js';
import type { PendingAction } from '../session/pending-action.js';
import { isPendingActionExpired, PENDING_KIND_CLAIMS_BARE_NUMBER } from '../session/pending-action.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const nodesOf = (g: unknown): Rec[] => rec(g) && Array.isArray(g.nodes) ? g.nodes.filter(rec) : [];
export const scopeOf = (v: unknown): GoalScope | undefined => { const p = GoalScopeSchema.safeParse(v); return p.success ? p.data : undefined; };
const native = (n: Rec | undefined): { value: number; unit: string; source: string } | undefined => {
  const os = rec(n?.observed_state) ? n.observed_state : undefined;
  if (!os || typeof os.raw_value !== 'number' || !Number.isFinite(os.raw_value) || typeof os.unit !== 'string'
    || classifyValueSource(os.source) !== 'user_stated') return undefined;
  return { value: os.raw_value, unit: os.unit, source: String(os.source) };
};

/** A component product is not the whole metric. No labels or quotations are parsed to infer that relationship. */
export function identityConflictsWithScope(goal: Rec, scope = scopeOf(goal.goal_scope)): boolean {
  const c = scope?.component; const identity = rec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  return c !== undefined && ((scope?.extent === 'total' && (c.share === undefined || c.share < 1)) || c.basis === 'different')
    && identity?.operation === 'product' && Array.isArray(identity.factor_ids) && identity.factor_ids.length === 2
    && [c.rate_id, c.count_id].every(id => (identity.factor_ids as unknown[]).includes(id));
}

/** The same check is used before proposing and before saving. It never repairs an operand. */
export function goalScopeCheck(graph: unknown, goalId: string, scope: GoalScope,
  current?: GoalScopeReconciliation['current_level']): Pick<GoalScopeReconciliation, 'operands' | 'derivations'> & { contradiction: boolean; comparable: boolean } {
  const ns = nodesOf(graph), goal = ns.find(n => n.id === goalId);
  const total = current ? { value: current.value, unit: current.unit, source: 'user_stated_claim' } : native(goal);
  const c = scope.component; const rateNode = ns.find(n => n.id === c?.rate_id), countNode = ns.find(n => n.id === c?.count_id);
  const rate = native(rateNode), count = native(countNode);
  const operands = [total && { id: goalId, ...total }, rate && { id: c!.rate_id, ...rate }, count && { id: c!.count_id, ...count }]
    .filter((v): v is NonNullable<typeof v> => v !== undefined);
  const derivations: GoalScopeReconciliation['derivations'] = [];
  if (!total || !c || c.share === undefined || scope.extent !== 'total') return { operands, derivations, contradiction: false, comparable: false };
  const revenue = total.value * c.share;
  if (!Number.isFinite(revenue)) return { operands, derivations, contradiction: false, comparable: false };
  derivations.push({ kind: 'component_revenue', value: revenue, unit: total.unit, source: 'deterministic_derivation', conditional: true });
  // The estate's own currency / period / denominator check, never a pricing-specific parser.
  const compose = rate && count && unitsCompose(total.unit, String(goal?.label ?? ''),
    { unit: rate.unit, label: String(rateNode?.label ?? '') }, { unit: count.unit, label: String(countNode?.label ?? '') });
  if (!rate || rate.value <= 0 || !count || !(compose?.kind === 'proof' || compose?.kind === 'confirm' && c.basis === 'same')) return { operands, derivations, contradiction: false, comparable: false };
  const implied = revenue / rate.value;
  if (Number.isFinite(implied)) derivations.push({ kind: 'implied_count', value: implied, unit: count.unit, source: 'deterministic_derivation', conditional: true });
  const product = rate.value * count.value;
  return { operands, derivations, comparable: true, contradiction: c.basis !== 'different' && Number.isFinite(product)
    && Math.abs(revenue - product) > RECONCILIATION_TOLERANCE * Math.max(Math.abs(revenue), 1) };
}

export function scopeQuestion(label: string, scope: GoalScope, check: ReturnType<typeof goalScopeCheck>): string {
  const revenue = check.derivations.find(d => d.kind === 'component_revenue'), count = check.derivations.find(d => d.kind === 'implied_count');
  if (check.contradiction && revenue && count) return `If these figures describe the same monthly billing basis, ${scope.component!.label} would contribute ${revenue.value} ${revenue.unit}, implying about ${Number(count.value.toPrecision(3))} ${count.unit}. The stated count is ${check.operands.find(o => o.id === scope.component!.count_id)!.value}. Does that count refer to a different population, or do the revenue and price use a different billing basis?`;
  if (!scope.component) return `Approve the current level and resolved scope of ${label} on the displayed card.`;
  if (scope.component.share === undefined) return `What share of the current ${label} comes from ${scope.component?.label ?? 'the modelled component'}?`;
  return `Do ${scope.component.label}'s revenue share, price and count describe the same population and billing period?`;
}

export function reconciliationPending(scenarioId: string, action: GoalScopeReconciliation, now = Date.now()): PendingAction {
  return { id: randomUUID(), scenario_id: scenarioId, chip_id: `goal-scope:${action.goal_id}`, action,
    preconditions: { target_entity_ids: [action.goal_id] }, expires_at_turn_count: 12,
    expires_at_iso: new Date(now + 30 * 60 * 1000).toISOString(), emitted_at_iso: new Date(now).toISOString() };
}

export function scopeShareAnswerCanBind(prior: readonly PendingAction[], goalId: string, now = Date.now()): boolean {
  const asks = prior.filter(p => p.action.kind === 'reconcile_goal_scope');
  return asks.length === 1 && asks[0]!.action.kind === 'reconcile_goal_scope' && asks[0]!.action.goal_id === goalId
    && asks[0]!.action.expected === 'component_share' && asks[0]!.expires_at_turn_count > 0 && Date.parse(asks[0]!.expires_at_iso) >= now
    && !prior.some(p => p.action.kind !== 'reconcile_goal_scope' && !isPendingActionExpired(p, now) && PENDING_KIND_CLAIMS_BARE_NUMBER[p.action.kind]);
}

export function scopeSourcesAreUserWords(scope: GoalScope, words: string, prior?: GoalScope): boolean {
  const written = (quote: string, old?: string) => words.includes(quote) || quote === old;
  if (!written(scope.source.quote, prior?.source.quote)) return false;
  if (prior && ['modelled', 'alternative', 'extent'].some(k => scope[k as 'extent'] !== prior[k as 'extent']) && !words.includes(scope.source.quote)) return false;
  const c = scope.component;
  if (!c) return true;
  if (!written(c.source.quote, prior?.component?.source.quote)) return false;
  if (prior?.component && ['label', 'rate_id', 'count_id'].some(k => c[k as 'label'] !== prior.component![k as 'label']) && !words.includes(c.source.quote)) return false;
  if (c.basis !== 'unknown' && (c.basis !== prior?.component?.basis || c.count_basis !== prior?.component?.count_basis) && (!c.basis_source || !words.includes(c.basis_source.quote))) return false;
  if (c.share !== undefined && c.share !== prior?.component?.share && !figureTheUserWrote(c.share, '%', c.source.quote)) return false;
  return true;
}

export function scopePendingResolved(action: GoalScopeReconciliation, graph: unknown): boolean {
  if (!rec(graph) || !Array.isArray(graph.nodes)) return false;
  const goal = nodesOf(graph).find(n => n.id === action.goal_id);
  if (!goal) return true; // The referent was explicitly removed; never bind an answer to another node.
  if (!action.scope || !scopeOf(goal.goal_scope) || stableStringify(goalScopeMeaning(goal.goal_scope)) !== stableStringify(goalScopeMeaning(action.scope))) return false;
  if (identityConflictsWithScope(goal, action.scope)) return false;
  if (action.current_level && native(goal)?.value !== action.current_level.value) return false;
  const check = goalScopeCheck(graph, action.goal_id, action.scope, action.current_level);
  return scopeReadyToApprove(action.scope, check);
}

/** Refresh operands after a canvas write; retain the original user claims, never promote the derived count. */
export function refreshScopePending(pa: PendingAction, graph: unknown): PendingAction | undefined {
  if (pa.action.kind !== 'reconcile_goal_scope') return pa;
  if (scopePendingResolved(pa.action, graph)) return undefined;
  if (!pa.action.scope) return pa;
  const check = goalScopeCheck(graph, pa.action.goal_id, pa.action.scope, pa.action.current_level);
  return { ...pa, action: { ...pa.action, operands: check.operands, derivations: check.derivations,
    ...(!scopeReadyToApprove(pa.action.scope, check) && pa.action.scope.component?.share !== undefined ? { expected: 'billing_basis' as const, question: scopeQuestion(pa.action.goal_label, pa.action.scope, check) } : {}) } };
}

export class GoalScopeIdentityConflict extends Error {
  readonly code = 'GOAL_SCOPE_IDENTITY_CONFLICT';
  constructor() { super('A component product cannot define the total goal. Approve the displayed scope and identity correction first.'); this.name = 'GoalScopeIdentityConflict'; }
}
export function assertNoScopedIdentityConflict(graph: unknown): void {
  if (nodesOf(graph).some(n => n.kind === 'goal' && identityConflictsWithScope(n))) {
    throw new GoalScopeIdentityConflict();
  }
}

export const SCOPE_APPROVE_PREFIX = 'Yes, record this goal reading: ';

/** One issue per goal, outside graph identity. Canvas edits refresh operands, never their authorship. */
export function scopeIssuesAfterWrite(prior: readonly PendingAction[], graph: unknown, scenarioId: string): PendingAction[] {
  const kept = prior.flatMap(p => { const r = refreshScopePending(p, graph); return r ? [r] : []; });
  for (const goal of nodesOf(graph).filter(n => n.kind === 'goal')) {
    const scope = scopeOf(goal.goal_scope);
    if (!scope || kept.some(p => p.action.kind === 'reconcile_goal_scope' && p.action.goal_id === goal.id)) continue;
    const check = goalScopeCheck(graph, String(goal.id), scope);
    if (scopeReadyToApprove(scope, check)) continue;
    kept.unshift(reconciliationPending(scenarioId, { kind: 'reconcile_goal_scope', goal_id: String(goal.id), goal_label: String(goal.label),
      scope, expected: 'billing_basis', question: scopeQuestion(String(goal.label), scope, check), operands: check.operands, derivations: check.derivations }));
  }
  return kept;
}

export function scopeClaimGate(state: unknown, issues: readonly unknown[]): unknown {
  if (issues.length === 0 || !rec(state)) return state;
  return { ...state, leader_claim: { ...(rec(state.leader_claim) ? state.leader_claim : {}), permitted: false, withheld_reason: 'goal_scope_unresolved' } };
}

/** Approval revision of this one issue; provenance-only edits cannot invalidate it. */
export function scopeReconciliationKey(action: GoalScopeReconciliation): string {
  return createHash('sha256').update(stableStringify({ goal_id: action.goal_id, scope: goalScopeMeaning(action.scope),
    current_level: action.current_level ? { value: action.current_level.value, unit: action.current_level.unit } : null,
    operands: action.operands.map(({ id, value, unit }) => ({ id, value, unit })) })).digest('hex');
}

/** A pending reading cannot license a silent baseline fit or a new confirmation of its rejected product. */
export function assertNoPendingScopeAmendment(graph: unknown, base: unknown, prior: readonly PendingAction[]): void {
  for (const p of prior) {
    const action = p.action;
    if (action.kind !== 'reconcile_goal_scope' || !action.scope) continue;
    const after = nodesOf(graph).find(n => n.id === action.goal_id);
    const before = nodesOf(base).find(n => n.id === action.goal_id);
    if (!after || !before || !identityConflictsWithScope(after, action.scope)) continue;
    if (stableStringify(after.observed_state) !== stableStringify(before.observed_state)
      || stableStringify(after.nonlinear_identity) !== stableStringify(before.nonlinear_identity)) throw new GoalScopeIdentityConflict();
  }
}

export function scopeReadyToApprove(scope: GoalScope, check: ReturnType<typeof goalScopeCheck>): boolean {
  const c = scope.component;
  return !check.contradiction && (!c || c.share !== undefined && (c.basis === 'different' || c.basis === 'same' && check.comparable));
}
