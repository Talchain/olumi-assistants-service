import { statementOrigin } from '../../cee/provenance/provenance-of.js';
import type { InputClaim } from '../../schemas/assist.js';
import { GoalScopeReadingSchema, GoalScopeSchema, type GoalScopeReading as GoalScope, type GoalScopeReconciliation } from '../../schemas/goal-scope.js';
import { goalScopeCheck, scopeQuestion, reconciliationPending, scopeOf, scopeOfGoal, scopeSourcesAreUserWords, scopeReconciliationKey, scopeReadyToApprove, scopeCanRecord, nodesOf } from './goal-scope.js';
import { proposeGoalCurrentLevel, type GoalLevelRead } from './goal-current-level.js';
import type { ProposalStore } from './proposal.js';
import type { PendingAction } from '../session/pending-action.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';

export interface ReconcileGoalScopeArgs {
  goal_label: string;
  user_stated?: boolean;
  basis?: string;
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
  let scope: GoalScope | undefined = args.scope === undefined ? prior?.scope ?? scopeOfGoal(goal) : scopeOf(args.scope);
  if (!scope) return fail('scope_unresolved', prior?.question ?? 'State whether this goal covers the whole metric or a component. Nothing was recorded.');
  if (args.component_share !== undefined || args.component_basis !== undefined || args.count_basis !== undefined) {
    if (!scope.component) return fail('scope_operand_missing', 'Name the component before supplying its share or basis.');
    if (args.component_share !== undefined && (!Number.isFinite(args.component_share) || args.component_share < 0 || args.component_share > 1)) return fail('invalid_share', 'A component share must be a finite fraction from zero to one.');
    scope = { ...scope, component: { ...scope.component,
      ...(args.component_share !== undefined ? { share: args.component_share } : {}),
      ...(args.component_basis !== undefined ? { basis: args.component_basis } : {}),
      ...(args.count_basis !== undefined ? { count_basis: args.count_basis } : {}),
      ...(args.component_share !== undefined ? { source: { quote: args.source_quote ?? args.basis ?? '' } } : {}),
      ...(args.component_basis !== undefined || args.count_basis !== undefined ? { basis_source: { quote: args.source_quote ?? args.basis ?? '' } } : {}) } };
  }
  if (!GoalScopeReadingSchema.safeParse(scope).success) return fail('invalid_scope', 'The scope must have valid ids, kinds and a finite share from zero to one.');
  const previousScope = prior?.scope ?? scopeOfGoal(goal);
  const wordsVerified = scopeSourcesAreUserWords(scope, ctx.user_text ?? words, previousScope?.stated_in_brief ? previousScope : undefined);
  const origin = statementOrigin(wordsVerified, [scope.source.quote, scope.component?.source.quote, scope.component?.basis_source?.quote]
    .some(q => !!q && (ctx.unverified_user_text ?? '').includes(q)), ctx.user_text_complete, args.user_stated === false || scope.stated_in_brief === false);
  const claim: InputClaim = { origin, basis: args.basis ?? '', source_quote: [scope.source.quote, scope.component?.source.quote, scope.component?.basis_source?.quote].filter(Boolean).join('\n') };
  if (origin === 'unknown') return { ok: false, mutated: false, refusal: 'origin_unknown', input_claim: claim, scope,
    detail: 'The scope source is unknown. Its words and proposed reading are retained here; provide the original source or a new Olumi reading.' };
  scope = { ...scope, stated_in_brief: origin === 'human' };
  if (scope.component && (scope.component.rate_id === scope.component.count_id || ![scope.component.rate_id, scope.component.count_id].every(id => nodesOf(graph.raw).some(n => n.id === id && n.kind === 'factor')))) {
    return fail('scope_operand_missing', 'The scoped rate and count must refer to existing model factors. Nothing was recorded.');
  }
  let current = prior?.current_level;
  if (args.current_level) {
    const c = args.current_level;
    if (!Number.isFinite(c.value) || !c.unit.trim()) return fail('invalid_current_level', 'The current level needs a finite value and its physical unit.');
    current = { value: c.value, unit: c.unit, source: { quote: c.quote } };
  }
  if (scope.extent === 'total' && !scope.component && (goal.nonlinear_identity as {operation?: string} | undefined)?.operation === 'product') return fail('scope_operand_missing', 'Identify the modelled component’s rate and count before reconciling this total goal. Nothing was prepared.');
  const check = goalScopeCheck(graph.raw, goal.id, scope, current);
  const expected = scope.extent === 'total' && scope.component && scope.component.share === undefined ? 'component_share' : !scopeReadyToApprove(scope, check) ? 'billing_basis' : 'approval';
  const action: GoalScopeReconciliation = { kind: 'reconcile_goal_scope', goal_id: goal.id, goal_label: goal.label, ...(scope.stated_in_brief ? { scope: GoalScopeSchema.parse(scope) } : {}),
    ...(current ? { current_level: current } : {}), expected, question: scopeQuestion(goal.label, scope, check),
    operands: check.operands, derivations: check.derivations };
  const pending = reconciliationPending(ctx.scenario_id, action);
  // A clarification records claims on the existing pending carrier. The baseline remains the existing approved writer's value.
  if (!scopeCanRecord(scope, check)) return { ok: true, mutated: false, pending_action: pending, reconciliation: action, conditional_derivations: check.derivations, detail: action.question };
  if (!current) return { ok: true, mutated: false, pending_action: pending, reconciliation: action,
    detail: 'The scope question is retained. State the goal’s current level to prepare its existing baseline card.' };

  const proposal = await proposeGoalCurrentLevel({ readGraph: async () => graph, proposals: deps.proposals },
    ctx, { goal_label: goal.label, value: current.value, unit: current.unit, user_stated: args.user_stated !== false, source_quote: current.source.quote, basis: args.basis, goal_scope: scope, scope_claim: claim, ...(scope.stated_in_brief ? { reconciliation_key: scopeReconciliationKey(action) } : {}) });
  return { ...proposal, ...(scope.stated_in_brief ? { pending_action: pending } : {}), reconciliation: action, scope_input: { scope, claim }, conditional_derivations: check.derivations,
    note: 'These operands are retained claims until approved, and the arithmetic is conditional and derived. Never replace the stated count with the implied count. '
      + (check.contradiction ? action.question : 'Approve only the exact scope and baseline reading on the card.') };
}
