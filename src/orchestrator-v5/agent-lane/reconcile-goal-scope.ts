import { GoalScopeSchema, type GoalScope, type GoalScopeReconciliation } from '../../schemas/goal-scope.js';
import { figureTheUserWrote, figureTheUserWroteFor } from './stated-by-user.js';
import { goalScopeCheck, scopeQuestion, reconciliationPending, scopeOf, scopeShareAnswerCanBind, scopeSourcesAreUserWords, scopeReconciliationKey, scopeReadyToApprove, nodesOf } from './goal-scope.js';
import { proposeGoalCurrentLevel, type GoalLevelRead } from './goal-current-level.js';
import type { ProposalStore } from './proposal.js';
import type { PendingAction } from '../session/pending-action.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';

export interface ReconcileGoalScopeArgs {
  goal_label: string;
  scope?: unknown;
  current_level?: { value: number; unit: string; quote: string };
  component_share?: number;
  component_basis?: 'same' | 'different';
  count_basis?: string;
  source_quote?: string;
}
export async function reconcileGoalScope(deps: { readGraph: (id: string) => Promise<GoalLevelRead | null>; readPending: () => Promise<readonly PendingAction[]>; proposals: ProposalStore },
  ctx: AgentToolContext, args: ReconcileGoalScopeArgs): Promise<ToolResult> {
  const fail = (refusal: string, detail: string): ToolResult => ({ ok: false, mutated: false, refusal, detail });
  const graph = await deps.readGraph(ctx.scenario_id);
  if (!graph) return fail('model_unavailable', 'The current model could not be read. Nothing was recorded.');
  const goals = graph.nodes.filter(n => n.kind === 'goal' && n.label === args.goal_label);
  if (goals.length !== 1) return fail('goal_ambiguous', 'Name the existing goal exactly. Nothing was recorded.');
  const goal = goals[0]!; const pendings = await deps.readPending();
  const previous = pendings.find(p => p.action.kind === 'reconcile_goal_scope' && p.action.goal_id === goal.id);
  const prior = previous?.action.kind === 'reconcile_goal_scope' ? previous.action : undefined;
  const words = ctx.user_turn_text ?? ctx.user_text ?? '';
  let scope: GoalScope | undefined = args.scope === undefined ? prior?.scope ?? scopeOf((goal as Record<string, unknown>).goal_scope) : scopeOf(args.scope);
  if (!scope) return fail('scope_unresolved', prior?.question ?? 'State whether this goal covers the whole metric or a component. Nothing was recorded.');
  if (args.component_share !== undefined || args.component_basis !== undefined || args.count_basis !== undefined) {
    if (!scope.component || !args.source_quote || !words.includes(args.source_quote)) return fail('source_not_stated', 'Use the user’s exact words for this component. Nothing was recorded.');
    const explicitlyNamed = args.source_quote.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(scope.component.label.toLowerCase())
      && figureTheUserWroteFor(args.component_share ?? 0, '%', args.source_quote, { target: [scope.component.label], others: [goal.label], strict: true });
    if (args.component_share !== undefined && (!explicitlyNamed && !scopeShareAnswerCanBind(pendings, goal.id)
      || !figureTheUserWrote(args.component_share, '%', args.source_quote))) {
      if (!prior) return fail('share_not_bound', 'Name the component this share describes.');
      const action = { ...prior, expected: 'component_share' as const, question: `What share of the current ${goal.label} comes from ${scope.component.label}?` };
      return { ok: true, mutated: false, refusal: 'share_not_bound', pending_action: reconciliationPending(ctx.scenario_id, action), reconciliation: action, detail: action.question };
    }
    scope = { ...scope, component: { ...scope.component,
      ...(args.component_share !== undefined ? { share: args.component_share } : {}),
      ...(args.component_basis !== undefined ? { basis: args.component_basis } : {}),
      ...(args.count_basis !== undefined ? { count_basis: args.count_basis } : {}),
      ...(args.component_share !== undefined ? { source: { quote: args.source_quote } } : {}),
      ...(args.component_basis !== undefined || args.count_basis !== undefined ? { basis_source: { quote: args.source_quote } } : {}) } };
  }
  if (!GoalScopeSchema.safeParse(scope).success || !scopeSourcesAreUserWords(scope, words, prior?.scope ?? scopeOf((goal as Record<string, unknown>).goal_scope))) {
    return fail('scope_not_grounded', 'The scope or share is not bound to the user’s own words. Nothing was recorded.');
  }
  if (scope.component?.share !== undefined && scope.component.share !== (prior?.scope ?? scopeOf((goal as Record<string, unknown>).goal_scope))?.component?.share && args.component_share === undefined) {
    const quote = scope.component.source.quote;
    const explicitlyNamed = quote.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(scope.component.label.toLowerCase())
      && figureTheUserWroteFor(scope.component.share, '%', quote, { target: [scope.component.label], others: [goal.label], strict: true });
    if (!explicitlyNamed && !scopeShareAnswerCanBind(pendings, goal.id)) return fail('share_not_bound', 'Name which component this share describes, or answer its fresh scoped question. Nothing was recorded.');
  }
  if (scope.component && (scope.component.rate_id === scope.component.count_id || ![scope.component.rate_id, scope.component.count_id].every(id => nodesOf(graph.raw).some(n => n.id === id && n.kind === 'factor')))) {
    return fail('scope_operand_missing', 'The scoped rate and count must refer to existing model factors. Nothing was recorded.');
  }
  let current = prior?.current_level;
  if (args.current_level) {
    const c = args.current_level;
    if (!words.includes(c.quote) || !figureTheUserWrote(c.value, c.unit, c.quote)) return fail('level_not_stated', 'The current level must be the user’s stated figure in their units. Nothing was recorded.');
    current = { value: c.value, unit: c.unit, source: { quote: c.quote } };
  }
  if (scope.extent === 'total' && !scope.component && (goal.nonlinear_identity as {operation?: string} | undefined)?.operation === 'product') return fail('scope_operand_missing', 'Identify the modelled component’s rate and count before reconciling this total goal. Nothing was prepared.');
  const check = goalScopeCheck(graph.raw, goal.id, scope, current);
  const expected = scope.extent === 'total' && scope.component && scope.component.share === undefined ? 'component_share' : !scopeReadyToApprove(scope, check) ? 'billing_basis' : 'approval';
  const action: GoalScopeReconciliation = { kind: 'reconcile_goal_scope', goal_id: goal.id, goal_label: goal.label, scope,
    ...(current ? { current_level: current } : {}), expected, question: scopeQuestion(goal.label, scope, check),
    operands: check.operands, derivations: check.derivations };
  const pending = reconciliationPending(ctx.scenario_id, action);
  // A clarification records claims on the existing pending carrier. The baseline remains the existing approved writer's value.
  if (expected !== 'approval') return { ok: true, mutated: false, pending_action: pending, reconciliation: action, conditional_derivations: check.derivations, detail: action.question };
  if (!current) return { ok: true, mutated: false, pending_action: pending, reconciliation: action,
    detail: 'The scope question is retained. State the goal’s current level to prepare its existing baseline card.' };
  const groundedWords = [words, current.source.quote, scope.source.quote, scope.component?.source.quote ?? '', scope.component?.basis_source?.quote ?? ''].join('\n');
  const proposal = await proposeGoalCurrentLevel({ readGraph: async () => graph, proposals: deps.proposals },
    { ...ctx, user_text: groundedWords }, { goal_label: goal.label, value: current.value, unit: current.unit, user_stated: true, goal_scope: scope, reconciliation_key: scopeReconciliationKey(action) });
  return { ...proposal, pending_action: pending, reconciliation: action, conditional_derivations: check.derivations,
    note: 'These operands are retained claims until approved, and the arithmetic is conditional and derived. Never replace the stated count with the implied count. '
      + (check.contradiction ? action.question : 'Approve only the exact scope and baseline reading on the card.') };
}
