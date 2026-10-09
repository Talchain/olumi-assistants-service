import { isDeepStrictEqual } from 'node:util';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { horizonSteadyAttested, horizonBasisMetricKey } from './horizon-basis.js';

type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Only the consumed, card-only proposal supplies this member to the existing approved batch door. */
export interface ApprovedGoalSteady {
  readonly goal_id: string;
  readonly months: number;
}

export function applyGoalSteadyEdit(persistedGraph: unknown, approved: ApprovedGoalSteady, scenarioId: string):
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string } {
  if (!record(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  const goals = persistedGraph.nodes.filter((n): n is Rec => record(n) && n.id === approved.goal_id && n.kind === 'goal');
  if (goals.length !== 1) return { kind: 'refused', reason: 'goal_not_found' };
  const goal = goals[0]!;
  if (!Number.isInteger(approved.months) || approved.months <= 0 || approved.months !== goal.goal_horizon_months) {
    return { kind: 'refused', reason: 'goal_month_changed' };
  }
  if (horizonSteadyAttested(persistedGraph, scenarioId)) return { kind: 'unchanged' };
  const graph = structuredClone(persistedGraph);
  const written = (graph.nodes as Rec[]).find(n => n.id === approved.goal_id)!;
  // Stamp authorship here, never copy a producer's source from the operation.
  written.horizon_basis = { basis: 'steady_attested', source: 'user_stated',
    bound_months: approved.months, metric: horizonBasisMetricKey(goal, scenarioId) };
  const label = String(goal.label ?? 'the goal');
  const fact = EditGraphHandlerFactSchema.parse({ fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: { edit_kind: 'parameter_update', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: 'goal', label: label.slice(0, 120) }],
      graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never),
      graph_hash_after: computeAnalysisAffectingGraphHash(graph as never),
      safe_summary: 'Recorded your steady-state judgement', impact: 'low', rerun_recommended: true } });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: `Recorded as your judgement: ‘${label}’ stays about the same over ${approved.months} months unless you act. Then run the analysis again.` };
}

/** No unrelated graph bytes may move in this approval. */
export function goalSteadyPostimageIsScoped(before: unknown, after: unknown, approved: ApprovedGoalSteady, scenarioId: string): boolean {
  const expected = applyGoalSteadyEdit(before, approved, scenarioId);
  return expected.kind !== 'refused'
    && isDeepStrictEqual(expected.kind === 'mutated' ? expected.mutatedGraph : before, after);
}
