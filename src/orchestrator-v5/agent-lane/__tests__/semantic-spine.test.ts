import { describe, it, expect } from 'vitest';
import capture from './fixtures/semantic-spine/paul-20261002.json';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { goalScopeMeaning, type GoalScope } from '../../../schemas/goal-scope.js';
import { goalScopeCheck, identityConflictsWithScope, reconciliationPending, refreshScopePending, scopeShareAnswerCanBind, scopeSourcesAreUserWords, assertNoScopedIdentityConflict, scopePendingResolved, scopeReadyToApprove } from '../goal-scope.js';
import { parsePendingAction, isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';
import { computeSurvivingPriorPendingsDetailed } from '../../commit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';

export const scope: GoalScope = { modelled: 'all revenue streams', alternative: 'Pro revenue only', extent: 'total', stated_in_brief: true,
  source: { quote: capture.statements[0]!.quote! }, component: { label: 'Pro', share: 0.3, rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers', basis: 'unknown', source: { quote: capture.statements[1]!.quote! } } };
const current = { value: 10000, unit: '£/month', source: scope.source };
const graph = () => structuredClone(capture.graph) as { nodes: Record<string, unknown>[]; edges: unknown[] };
const pa = (): PendingAction => reconciliationPending('scenario', { kind: 'reconcile_goal_scope', goal_id: 'mrr', goal_label: 'MRR', scope, current_level: current,
  expected: 'component_share', question: 'What share of current MRR comes from Pro?', ...(() => { const c = goalScopeCheck(graph(), 'mrr', scope, current); return { operands: c.operands, derivations: c.derivations }; })() }, 0);

describe('Paul 2 October: conversation to canonical goal meaning', () => {
  it('S1: consistent native figures produce no contradiction; no count is repaired', () => {
    const g = graph(); const count = g.nodes.find(n => n.id === 'pro_paying_subscribers')!;
    count.observed_state = { source: 'user_override', raw_value: 60, unit: 'subscribers', value: .12 };
    const check = goalScopeCheck(g, 'mrr', scope, { ...current, value: 9800 });
    expect(check.contradiction).toBe(false);
    expect(count.observed_state).toMatchObject({ raw_value: 60 });
  });
  it('S1: a component goal compares its own baseline with the product, without applying a whole-goal share', () => {
    const component: GoalScope = { ...scope, extent: 'component', component: { ...scope.component!, basis: 'same' } };
    const check = goalScopeCheck(graph(), 'mrr', component, { ...current, value: 14700 });
    expect(check).toMatchObject({ contradiction: false, comparable: true });
    expect(check.derivations.map(d => d.kind)).toEqual(['implied_count']);
    expect(check.derivations[0]!.value).toBe(300);
    expect(scopeReadyToApprove(component, check)).toBe(true);
    expect(goalScopeCheck(graph(), 'mrr', component, current).contradiction).toBe(true);
  });
  it('S2–S4: £10k total + 30% Pro + £49 + 300 yield one conditional issue, never a rewritten count', () => {
    const g = graph(); const before = structuredClone(g);
    const check = goalScopeCheck(g, 'mrr', scope, current);
    expect(check.contradiction).toBe(true);
    expect(check.derivations).toEqual([
      { kind: 'component_revenue', value: 3000, unit: '£/month', source: 'deterministic_derivation', conditional: true },
      { kind: 'implied_count', value: 3000 / 49, unit: 'subscribers', source: 'deterministic_derivation', conditional: true },
    ]);
    expect(g).toEqual(before);
    expect(identityConflictsWithScope(g.nodes.find(n => n.id === 'mrr')!, scope)).toBe(true);
  });
  it('S4: different currency or period cannot establish the product comparison', () => {
    for (const unit of ['USD per subscriber per month', '£ per subscriber per year']) {
      const g = graph(); const price = g.nodes.find(n => n.id === 'pro_plan_price')!;
      (price.observed_state as Record<string, unknown>).unit = unit;
      const check = goalScopeCheck(g, 'mrr', scope, current);
      expect(check.contradiction).toBe(false);
      expect(check.derivations.map(d => d.kind)).toEqual(['component_revenue']);
    }
  });
  it('S5: canonical parsing preserves scope; baseline stays only in observed_state', () => {
    const g = graph(); g.nodes.find(n => n.id === 'mrr')!.goal_scope = scope;
    expect(GraphV3.parse(g).nodes.find(n => n.id === 'mrr')!.goal_scope).toEqual(scope);
    expect(scope).not.toHaveProperty('current_level');
  });
  it('S5: a matching number in another currency or period cannot consume the baseline claim', () => {
    const resolvedScope: GoalScope = { ...scope, component: { ...scope.component!, basis: 'different' } };
    const g = graph(), goal = g.nodes.find(n => n.id === 'mrr')!;
    goal.goal_scope = resolvedScope; delete goal.nonlinear_identity;
    const action = { ...pa().action, kind: 'reconcile_goal_scope' as const, goal_id: 'mrr', goal_label: 'MRR', scope: resolvedScope,
      current_level: current, expected: 'approval' as const, question: 'Approve', operands: [], derivations: [] };
    goal.observed_state = { raw_value: 10000, unit: 'GBP/month', source: 'user_override' };
    expect(scopePendingResolved(action, g)).toBe(true);
    for (const unit of ['USD/month', 'GBP/year']) {
      goal.observed_state = { raw_value: 10000, unit, source: 'user_override' };
      expect(scopePendingResolved(action, g)).toBe(false);
    }
  });
  it('S6: issue survives JSON restart, unrelated revisions and exhausted answer TTL; the old share cannot bind', () => {
    const original = pa();
    const reloaded = parsePendingAction(JSON.parse(JSON.stringify(original)))!;
    expect(reloaded).toEqual(original);
  });
  it('S6: expiry retires answer binding, never the unresolved issue', () => {
    const original = { ...pa(), expires_at_turn_count: 0 };
    const restarted = parsePendingAction(JSON.parse(JSON.stringify(original)))!;
    expect(isPendingActionExpired(restarted, Date.now())).toBe(false);
    expect(scopeShareAnswerCanBind([restarted], 'mrr', Date.now())).toBe(false);
    expect(computeSurvivingPriorPendingsDetailed([restarted], [], [], 'unrelated-revision', Date.now()).survivors).toHaveLength(1);
    expect(refreshScopePending(restarted, graph())?.action.kind).toBe('reconcile_goal_scope');
  });
  it('S7: bare share requires exactly one recent scoped ask without a competing number referent', () => {
    const ask = { ...pa(), expires_at_iso: new Date(Date.now() + 10000).toISOString() };
    expect(scopeShareAnswerCanBind([ask], 'mrr')).toBe(true);
    const competitor: PendingAction = { ...ask, id: 'other', chip_id: 'other', action: { kind: 'set_factor_value', factor_id: 'pro_paying_subscribers', value: 0, operator: 'set' } };
    expect(scopeShareAnswerCanBind([ask, competitor], 'mrr')).toBe(false);
    expect(scopeShareAnswerCanBind([ask, { ...ask, id: 'another', chip_id: 'another' }], 'mrr')).toBe(false);
  });
  it('S7: provenance alone changes neither hash; resolved claim permissions change analysis identity', () => {
    const g = graph(); const goal = g.nodes.find(n => n.id === 'mrr')!;
    goal.goal_scope = scope; delete goal.nonlinear_identity;
    const oldAnalysis = computeAnalysisAffectingGraphHash(g as never), oldIdentity = computeGraphIdentityHash(g as never);
    goal.goal_scope = { ...scope, source: { quote: 'Another exact source reference', turn_id: 'turn-2' } };
    expect(computeAnalysisAffectingGraphHash(g as never)).toBe(oldAnalysis);
    expect(computeGraphIdentityHash(g as never)).toEqual(oldIdentity);
    goal.goal_scope = { ...scope, component: { ...scope.component!, share: .5 } };
    expect(computeAnalysisAffectingGraphHash(g as never)).not.toBe(oldAnalysis);
    expect(goalScopeMeaning(goal.goal_scope)).not.toHaveProperty('source');
  });
  it('S7: an operand id called goal_scope is data, never a scope carrier or provenance note', () => {
    const g = graph(); const option = g.nodes.find(n => n.kind === 'option')!;
    option.interventions = { goal_scope: .2 };
    const before = computeGraphIdentityHash(g as never);
    option.interventions = { goal_scope: .4 };
    expect(computeGraphIdentityHash(g as never)).not.toEqual(before);
  });
  it('S7: old quotation cannot license a changed scope or a changed basis', () => {
    expect(scopeSourcesAreUserWords({ ...scope, extent: 'component' }, '', scope)).toBe(false);
    expect(scopeSourcesAreUserWords({ ...scope, component: { ...scope.component!, basis: 'different' } }, '', scope)).toBe(false);
  });
  it('S7: shared write and identity confirmation reject a component product on a total goal', () => {
    const g = graph(); g.nodes.find(n => n.id === 'mrr')!.goal_scope = scope;
    expect(() => assertNoScopedIdentityConflict(g)).toThrow('component product');
    const reading = { outcome_id: 'mrr', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: 'Use these figures as total MRR.' };
    expect(applyIdentityConfirmEdit({ persistedGraph: g, ...reading, expected_graph_hash: computeAnalysisAffectingGraphHash(g as never)!, reading_token: identityConfirmReadingToken(reading) })).toMatchObject({ kind: 'refused', reason: 'goal_scope_conflict' });
  });
});
