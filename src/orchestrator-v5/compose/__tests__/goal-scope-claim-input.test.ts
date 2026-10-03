import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { goalScopeClaimInput, readGoalScopeClaimInput } from '../goal-scope-claim-input.js';
import { reconciliationPending, scopeShareAnswerCanBind } from '../../agent-lane/goal-scope.js';
import { composeAnalysisStateV1 } from '../analysis-state-v1.js';
import { selectCanonicalAnalysisState } from '../../context/canonical-analysis-state.js';
import { pickLatestRawRobustness } from '../../coaching/pick-raw-robustness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { FROM, PRIOR, savedRun } from '../../model-management/__tests__/version-result-fixtures.js';
import { claimPermissionsFrom } from '../../agent-lane/first-analysis.js';

const hash = (PRIOR as unknown as { result: { graph_hash_at_run: string } }).result.graph_hash_at_run;
const pending = () => reconciliationPending(FROM.scenario_id, {
  kind: 'reconcile_goal_scope', goal_id: 'n_revenue', goal_label: 'Revenue',
  declared_scope: { modelled: 'all revenue', alternative: 'one stream', stated_in_brief: true },
  question: 'Which revenue scope should this model represent?', expected: 'scope', operands: [], derivations: [],
}, 0);
const state = (input: Awaited<ReturnType<typeof readGoalScopeClaimInput>>) => {
  const readiness = buildCanonicalAnalysisReadyFromGraph(FROM.graph);
  return composeAnalysisStateV1({
    canonical: selectCanonicalAnalysisState({ priorFacts: [PRIOR], currentGraphHash: hash,
      currentGraph: FROM.graph, readiness, priorFactsReadOk: true }),
    runFactBinding: { scenarioId: FROM.scenario_id, selectedResult: (PRIOR as unknown as { result: unknown }).result },
    readiness, mayNameLeadingOption: true, rawRobustness: pickLatestRawRobustness([PRIOR]),
    goalScopeClaimInput: input,
  })!;
};

describe('canonical scope input before claim composition', () => {
  it('distinguishes failed reads from an attested empty row, without inventing questions', async () => {
    const clear = await readGoalScopeClaimInput(FROM.graph, async () => []);
    const unavailable = await readGoalScopeClaimInput(FROM.graph, async () => { throw new Error('read unavailable'); });
    expect(clear).toStrictEqual({ status: 'clear', issues: [] });
    expect(unavailable).toStrictEqual({ status: 'unavailable', issues: [] });
    expect(state(clear).leader_claim.permitted).toBe(true);
    expect(state(unavailable).leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
  });
  it('retains an expired answer binding as an open issue on this canonical goal', () => {
    const action = pending();
    expect(scopeShareAnswerCanBind([action], 'n_revenue', Date.now())).toBe(false);
    const original = JSON.stringify([action, FROM.graph]);
    const input = goalScopeClaimInput([action], FROM.graph);
    expect(input.status).toBe('unresolved');
    expect(input.issues).toHaveLength(1);
    expect(state(input).leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
    expect(JSON.stringify([action, FROM.graph])).toBe(original);
  });
  it('does not bind an old scope issue to a different or removed goal', () => {
    const graph = structuredClone(FROM.graph) as { nodes: { id: string }[] };
    graph.nodes = graph.nodes.filter(n => n.id !== 'n_revenue');
    expect(goalScopeClaimInput([pending()], graph)).toStrictEqual({ status: 'clear', issues: [] });
  });
  it('preserves a current unscoped positive and its recorded Run identity', () => {
    const current = state(goalScopeClaimInput([], FROM.graph));
    expect(current.run_state.kind).toBe('complete_current');
    expect(current.leader_claim.permitted).toBe(true);
  });
  it.each(['clear', 'unresolved', 'unavailable'] as const)(
    'retains both the newer degraded Run and %s scope permission in the common consumer', async (scope) => {
      const priorResult = (PRIOR as unknown as { result: Record<string, unknown> }).result;
      const prior = RunAnalysisHandlerFactSchema.parse({ ...PRIOR, fact_version: 1,
        result: { ...priorResult, leading_option_id: 'opt-a', summary: 'Synthetic prior success.' } });
      const raw = savedRun(FROM, 'newer-partial', '2026-10-02T02:00:00.000Z');
      const rawResult = (raw as unknown as { result: Record<string, unknown> }).result;
      const newer = RunAnalysisHandlerFactSchema.parse({ ...raw, fact_version: 1,
        result: { ...rawResult, leading_option_id: 'opt-a', summary: 'Synthetic newer partial.',
          enrichment: { ...(rawResult.enrichment as Record<string, unknown>), analysis_status: 'partial' },
          constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'not_applicable' } } });
      const facts = [newer, prior];
      const readiness = buildCanonicalAnalysisReadyFromGraph(FROM.graph);
      const canonical = selectCanonicalAnalysisState({ priorFacts: facts, currentGraphHash: hash,
        currentGraph: FROM.graph, readiness, priorFactsReadOk: true });
      const input = scope === 'unavailable'
        ? await readGoalScopeClaimInput(FROM.graph, async () => { throw new Error('strict read unavailable'); })
        : goalScopeClaimInput(scope === 'clear' ? [] : [pending()], FROM.graph);
      const composed = composeAnalysisStateV1({ canonical,
        runFactBinding: { scenarioId: FROM.scenario_id, selectedResult: prior.result },
        readiness, mayNameLeadingOption: true, rawRobustness: pickLatestRawRobustness(facts),
        goalScopeClaimInput: input })!;
      const permissions = claimPermissionsFrom(composed, undefined);
      expect(canonical.contradictions).toContain('fact_status_success_but_degraded_newer');
      // Existing contract keeps the selected successful result current while
      // recording the newer degraded Run in the selector's contradictions.
      expect(composed.run_state.kind).toBe('complete_current');
      expect(composed.leader_claim.permitted).toBe(false);
      expect(permissions.leader_may_be_named).toBe(false);
      expect(permissions.total_goal_claims_allowed).toBe(scope === 'clear' ? undefined : false);
      expect(permissions.exploratory_work_allowed).toBe(scope === 'clear' ? undefined : true);
      expect(composed.leader_claim.withheld_reason).toBe(scope === 'clear'
        ? 'analysis_leader_withheld' : 'goal_scope_unresolved');
    },
  );
});
