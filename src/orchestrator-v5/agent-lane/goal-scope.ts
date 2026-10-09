import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { GOAL_SCOPE_UNRESOLVED_REASON, GoalScopeSchema, goalScopeMeaning, type GoalScope, type GoalScopeReconciliation } from '../../schemas/goal-scope.js';
import { RECONCILIATION_TOLERANCE, unitsCompose, sameUnit, readMoneyTotal } from './reconciling-product.js';
import { figureTheUserWrote } from './stated-by-user.js';
import type { AdmittedModel, CandidateModel } from './admit-model.js';
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
  current?: GoalScopeReconciliation['current_level']): Pick<GoalScopeReconciliation, 'operands' | 'derivations'> & { contradiction: boolean; comparable: boolean; referencesValid: boolean } {
  const ns = nodesOf(graph), goal = ns.find(n => n.id === goalId);
  const total = current ? { value: current.value, unit: current.unit, source: 'user_stated_claim' } : native(goal);
  const c = scope.component; const rateNode = ns.find(n => n.id === c?.rate_id), countNode = ns.find(n => n.id === c?.count_id);
  const referencesValid = !c || c.rate_id !== c.count_id && rateNode?.kind === 'factor' && countNode?.kind === 'factor';
  const rate = native(rateNode), count = native(countNode);
  const operands = [total && { id: goalId, ...total }, rate && { id: c!.rate_id, ...rate }, count && { id: c!.count_id, ...count }]
    .filter((v): v is NonNullable<typeof v> => v !== undefined);
  const derivations: GoalScopeReconciliation['derivations'] = [];
  if (!referencesValid || !total || !c || scope.extent === 'total' && c.share === undefined) return { operands, derivations, referencesValid, contradiction: false, comparable: false };
  const revenue = scope.extent === 'total' ? total.value * c.share! : total.value;
  if (!Number.isFinite(revenue)) return { operands, derivations, referencesValid, contradiction: false, comparable: false };
  if (scope.extent === 'total') derivations.push({ kind: 'component_revenue', value: revenue, unit: total.unit, source: 'deterministic_derivation', conditional: true });
  // The estate's own currency / period / denominator check, never a pricing-specific parser.
  const compose = rate && count && unitsCompose(total.unit, String(goal?.label ?? ''),
    { unit: rate.unit, label: String(rateNode?.label ?? '') }, { unit: count.unit, label: String(countNode?.label ?? '') });
  if (!rate || rate.value <= 0 || !count || !(compose?.kind === 'proof' || compose?.kind === 'confirm' && c.basis === 'same')) return { operands, derivations, referencesValid, contradiction: false, comparable: false };
  const implied = revenue / rate.value;
  if (Number.isFinite(implied)) derivations.push({ kind: 'implied_count', value: implied, unit: count.unit, source: 'deterministic_derivation', conditional: true });
  const product = rate.value * count.value;
  return { operands, derivations, referencesValid, comparable: true, contradiction: c.basis !== 'different' && Number.isFinite(product)
    && Math.abs(revenue - product) > RECONCILIATION_TOLERANCE * Math.max(Math.abs(revenue), 1) };
}

export function scopeQuestion(label: string, scope: GoalScope, check: ReturnType<typeof goalScopeCheck>): string {
  if (!check.referencesValid) return `A factor referenced by ${label}'s saved scope was removed or changed kind. Which existing rate and count should this scope use?`;
  const revenue = check.derivations.find(d => d.kind === 'component_revenue') ?? (scope.extent === 'component' ? check.operands[0] : undefined), count = check.derivations.find(d => d.kind === 'implied_count');
  if (check.contradiction && revenue && count) return `If these figures describe the same monthly billing basis, ${scope.component!.label} would contribute ${revenue.value} ${revenue.unit}, implying about ${Number(count.value.toPrecision(3))} ${count.unit}. The stated count is ${check.operands.find(o => o.id === scope.component!.count_id)!.value}. Does that count refer to a different population, or do the revenue and price use a different billing basis?`;
  if (!scope.component) return `Approve the current level and resolved scope of ${label} on the displayed card.`;
  if (scope.extent === 'total' && scope.component.share === undefined) return `What share of the current ${label} comes from ${scope.component?.label ?? 'the modelled component'}?`;
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
  if (action.current_level) {
    const recorded = native(goal), claimed = action.current_level;
    const a = readMoneyTotal(recorded?.unit, String(goal.label)), b = readMoneyTotal(claimed.unit, String(goal.label));
    if (!recorded || recorded.value !== claimed.value || !(sameUnit(recorded.unit, claimed.unit)
      || a && b && a.code === b.code && a.period === b.period)) return false;
  }
  const check = goalScopeCheck(graph, action.goal_id, action.scope, action.current_level);
  return scopeReadyToApprove(action.scope, check);
}

/**
 * ⭐ AN UNTYPED SCOPE QUESTION NEVER BLOCKS (Science d5 #87 6006584860 / 6006646752; DL ruling 6 Oct). The drafter's
 * `goal.scope` question with no typed scope (`build-model.ts`: `expected: 'scope'`, no `scope`) reads the goal as the
 * TOTAL: it may be asked once, and it never gates the Run, the licence or a write. A typed scope that cannot be recorded
 * (a named component or share) still blocks, exactly as before.
 */
export function scopeIssueBlocks(action: { readonly kind: string; readonly scope?: unknown; readonly expected?: string }): boolean {
  return action.kind === 'reconcile_goal_scope' && !(action.expected === 'scope' && action.scope === undefined);
}

/** A label's content words (Science d5 U1 reading): lower-case words, fillers dropped, a trailing plural "s" folded. */
const SCOPE_FILLER_WORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'on', 'to', 'our', 'its', 'their', 'per', 'by']);
const contentWordsOf = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/)
  .filter(w => w !== '' && !SCOPE_FILLER_WORDS.has(w)).map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)));

/**
 * ⭐ WHAT AN UNTYPED SCOPE QUESTION STILL OWES THE USER (Science d5 #87 6006584860 / 6006646752). The goal reads as the
 * TOTAL; the reading is said only where it is material: a non-baseline option's path enters the goal through a node no
 * baseline path reaches (a tier, segment or source that counts only under the total; a hold at a zero level is no path). Not said for an option whose own
 * path carries a `user_stated` edge whose `source_quote` names the goal's quantity (every content word of its label): the
 * user put that component in the goal themselves ("Each starter subscriber adds £49 a month to monthly recurring revenue").
 * Returns the components to name, in edge order, deduplicated; empty means nothing is said. PURE.
 */
export function untypedScopeComponents(graph: unknown, goalId: string): readonly string[] {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return [];
  const nodes = graph.nodes.filter(rec), edges = graph.edges.filter(rec);
  const byId = new Map(nodes.map(n => [String(n.id), n] as const));
  const goal = byId.get(goalId);
  if (!goal || typeof goal.label !== 'string') return [];
  const goalWords = contentWordsOf(goal.label);
  const out = new Map<string, string[]>();
  for (const e of edges) if (typeof e.from === 'string' && typeof e.to === 'string' && byId.get(e.to)?.kind !== 'option') out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>(); const queue = [...(out.get(start) ?? [])];
    while (queue.length > 0) { const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id); queue.push(...(out.get(id) ?? [])); }
    return seen;
  };
  const options = nodes.filter(n => n.kind === 'option' && typeof n.id === 'string');
  // MEASURED on served 21ef54cc T1b: the status quo is wired to every factor an option touches ("carrying on as now"), so a
  // plain reach finds no component at all. A status-quo hold at a ZERO starting level in a non-% unit that an option moves
  // off zero is a part the option CREATES (Starter subscribers 0 → 150): it is not a baseline path. A 0 % change ("Price
  // rise") is, and so is a zero no option sets ("outages 0"; Science d5 #87 6007088716).
  const createdByOption = (factorId: string): boolean => options.some(o => o.is_baseline !== true && rec(o.interventions)
    && rec(o.interventions[factorId]) && typeof o.interventions[factorId].value === 'number' && o.interventions[factorId].value !== 0);
  const baselineHolds = (optionId: string): string[] => (out.get(optionId) ?? []).filter(to => {
    const s = byId.get(to)?.observed_state;
    return !(rec(s) && s.value === 0 && typeof s.unit === 'string' && s.unit.trim() !== '%' && createdByOption(to));
  });
  const baselineReach = new Set(options.filter(o => o.is_baseline === true)
    .flatMap(o => baselineHolds(String(o.id)).flatMap(h => [h, ...reach(h)])));
  // ⭐ A part is one an option CREATES (Science d5 #87 6007341975 (2): "an option creates a segment that counts only under
  // the total"): the entry must come from a factor that starts at zero (non-%) and that an option moves off zero. Served CI
  // on 0b8aa563: with no status-quo option, "Pro plan price" (£49 today) and "Perceived value" were named as tiers.
  const created = nodes.filter(n => typeof n.id === 'string' && rec(n.observed_state) && n.observed_state.value === 0
    && typeof n.observed_state.unit === 'string' && n.observed_state.unit.trim() !== '%' && createdByOption(String(n.id)))
    .map(n => String(n.id));
  const fromCreated = new Set(created.flatMap(id => [id, ...reach(id)]));
  const reachesGoal = (id: string): boolean => id === goalId || reach(id).has(goalId);
  const components: string[] = [];
  for (const option of options.filter(o => o.is_baseline !== true)) {
    const id = String(option.id), reached = reach(id);
    if (!reached.has(goalId)) continue;
    // A part ADDS to the total; a cost or strain the option brings ("Support capacity strain", negative) is an effect, not a tier
    // (Science d5 #87 6007341975 (1)).
    const entries = edges.filter(e => e.to === goalId && typeof e.from === 'string' && reached.has(e.from) && !baselineReach.has(e.from)
      && e.effect_direction !== 'negative' && fromCreated.has(String(e.from)))
      .map(e => String(e.from));
    if (entries.length === 0) continue;
    const onPath = edges.filter(e => typeof e.from === 'string' && typeof e.to === 'string' && (e.from === id || reached.has(e.from)) && reachesGoal(e.to));
    const userPlaced = onPath.some(e => {
      const p = rec(e.provenance) ? e.provenance : {};
      if (p.magnitude !== 'user_stated' || typeof p.source_quote !== 'string') return false;
      const quoteWords = contentWordsOf(p.source_quote);
      return goalWords.size > 0 && [...goalWords].every(w => quoteWords.has(w));
    });
    if (userPlaced) continue;
    for (const entry of entries) { const label = byId.get(entry)?.label; if (typeof label === 'string' && !components.includes(label)) components.push(label); }
  }
  return components;
}

/**
 * The declaration's `modelled` is the scope this model measures (GoalScopeDeclaration), so an admitted
 * identity ON its goal binds the operand quantities to that declared reading. Identity membership is
 * held as node ids; no population is inferred from an operand's label. A plain-total reading makes
 * that declaration material even when no option creates a new component (`untypedScopeComponents`).
 */
export function goalIdentityScopeIsMaterial(
  readsAsTotal: boolean,
  candidate: Pick<CandidateModel, 'goal'>,
  admitted: Pick<AdmittedModel, 'nodes'>,
): boolean {
  if (!readsAsTotal || !candidate.goal.scope?.modelled.trim()) return false;
  const goal = admitted.nodes.find(n => n.kind === 'goal');
  const identity = goal?.nonlinear_identity;
  if (!identity || new Set(identity.factor_ids).size < 2) return false;
  return identity.factor_ids.every(id => admitted.nodes.some(n => n.id === id && n.id !== goal!.id
    && (n.kind === 'factor' || n.kind === 'outcome' || n.kind === 'goal')));
}

/** Science d5's words, verbatim; several components by the list rule (three named, then " and N more"). */
export function untypedScopeDisclosure(goalLabel: string, components: readonly string[]): string {
  const named = components.slice(0, 3).map(c => `‘${c}’`);
  const more = components.length - named.length;
  const list = more > 0 ? `${named.join(', ')} and ${more} more`
    : named.length < 2 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `I’ve read your goal, ‘${goalLabel}’, as the total across every tier, including ${list}. If you meant only part of it, say which.`;
}

/** Refresh operands after a canvas write; retain the original user claims, never promote the derived count. */
export function refreshScopePending(pa: PendingAction, graph: unknown): PendingAction | undefined {
  if (pa.action.kind !== 'reconcile_goal_scope') return pa;
  if (scopePendingResolved(pa.action, graph)) return undefined;
  if (!pa.action.scope) return pa;
  const check = goalScopeCheck(graph, pa.action.goal_id, pa.action.scope, pa.action.current_level);
  return { ...pa, action: { ...pa.action, operands: check.operands, derivations: check.derivations,
    ...(!scopeReadyToApprove(pa.action.scope, check) && (pa.action.scope.extent === 'component' || pa.action.scope.component?.share !== undefined) ? { expected: 'billing_basis' as const, question: scopeQuestion(pa.action.goal_label, pa.action.scope, check) } : {}) } };
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
export const scopeWithdrawalWords = (goalId: string): string => `Withdraw this unresolved goal reading: ${goalId}`;

/** One issue per goal, outside graph identity. Canvas edits refresh operands, never their authorship. */
export function scopeIssuesAfterWrite(prior: readonly PendingAction[], graph: unknown, scenarioId: string): PendingAction[] {
  const kept = prior.flatMap(p => { const r = refreshScopePending(p, graph); return r ? [r] : []; });
  for (const goal of nodesOf(graph).filter(n => n.kind === 'goal')) {
    const scope = scopeOf(goal.goal_scope);
    // Only a BLOCKING issue already held for this goal stands in for the typed one (`scopeIssueBlocks`).
    if (!scope || kept.some(p => p.action.kind === 'reconcile_goal_scope' && p.action.goal_id === goal.id && scopeIssueBlocks(p.action))) continue;
    const check = goalScopeCheck(graph, String(goal.id), scope);
    if (scopeReadyToApprove(scope, check)) continue;
    // A typed scope that cannot be recorded supersedes the drafter's untyped question for the same goal (Codex buddy r1 P1):
    // the retained untyped one never blocks, so keeping it in place of the typed issue would clear the claim.
    for (let i = kept.length - 1; i >= 0; i--) {
      const a = kept[i]!.action;
      if (a.kind === 'reconcile_goal_scope' && a.goal_id === goal.id) kept.splice(i, 1);
    }
    kept.unshift(reconciliationPending(scenarioId, { kind: 'reconcile_goal_scope', goal_id: String(goal.id), goal_label: String(goal.label),
      scope, expected: 'billing_basis', question: scopeQuestion(String(goal.label), scope, check), operands: check.operands, derivations: check.derivations }));
  }
  return kept;
}

export function scopeClaimGate<T>(state: T, issues: readonly unknown[]): T {
  if (issues.length === 0 || !rec(state)) return state;
  return { ...state, leader_claim: { ...(rec(state.leader_claim) ? state.leader_claim : {}), permitted: false, withheld_reason: GOAL_SCOPE_UNRESOLVED_REASON } } as T;
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
  return check.referencesValid && !check.contradiction && (!c || (scope.extent === 'component' || c.share !== undefined) && (c.basis === 'different' || c.basis === 'same' && check.comparable));
}

/** Recording a known total never answers the independent question of what the component count means. */
export function scopeCanRecord(scope: GoalScope, check: ReturnType<typeof goalScopeCheck>): boolean {
  return scopeReadyToApprove(scope, check) || check.referencesValid && scope.extent === 'total'
    && scope.component?.share !== undefined && scope.component.share < 1;
}
