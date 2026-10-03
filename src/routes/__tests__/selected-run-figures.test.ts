import { describe, expect, it } from 'vitest';
import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import served from './fixtures/r8r9-run2-figures.json';
import limitsEstimate from '../../orchestrator-v5/agent-lane/__tests__/fixtures/pj-c10-063347Z-limits-estimate-only.json';
import nextMove from '../../orchestrator-v5/coaching/__tests__/fixtures/paul-run-08bf9a1f-next-move.json';
import provisionalLeader from '../../orchestrator-v5/admission/__tests__/fixtures/served-provisional-leader.bc09bb1.json';
import { projectSelectedRunFigures, readSelectedGoalFigureContext, type SelectedRunFiguresInput } from '../selected-run-figures.js';
import { claimPermissionsFrom } from '../../orchestrator-v5/agent-lane/first-analysis.js';
import type { PermittedAnalysisMode } from '../../orchestrator-v5/admission/analysis-admission.js';

const permissions = (mode: PermittedAnalysisMode, leaderClaim = { permitted: true, separation: 'separated' }) =>
  claimPermissionsFrom({ leader_claim: leaderClaim }, { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } }, { requested: true });

const input = (): SelectedRunFiguresInput => ({
  scenarioId: served.scenario_id,
  runState: served.run_state as AnalysisStateV1['run_state'],
  selectedGoal: readSelectedGoalFigureContext(served.selected_goal, 'mrr'),
  claimPermissions: permissions('comparative_leader'),
  currentResult: served.current_result as unknown as OlumiResponse['blocks'][number],
  selectedFact: served.selected_fact,
});

describe('figures from one selected saved Run', () => {
  it.each([
    ['C10 limits estimate', limitsEstimate.graph, limitsEstimate.analysis_state, limitsEstimate.analysis_result, 0.7568403768808017],
    ['Paul next move', nextMove.draft_graph, nextMove.analysis_state, nextMove.analysis_result, 0.17343337714669882],
    ['provisional leader', provisionalLeader.draft_graph, provisionalLeader.analysis_state, provisionalLeader.analysis_result_block, 0.11554022571459747],
  ] as const)('withholds the normalized outcome mean in served %s rather than labelling it as currency',
    (_label, graph, state, result, firstMean) => {
      const selectedGoal = readSelectedGoalFigureContext(graph, graph.nodes.find((node) => node.kind === 'goal')!.id);
      // These served goals pass the existing unit/frame gate. That is not
      // evidence that their outcome scores are expressed in the goal's unit.
      expect(selectedGoal).not.toBeNull();
      expect(result.enrichment.option_comparison[0]!.outcome.mean).toBe(firstMean);
      expect(projectSelectedRunFigures({
        scenarioId: 'served-scale-regression',
        runState: state.run_state as AnalysisStateV1['run_state'],
        selectedGoal,
        claimPermissions: claimPermissionsFrom(state, undefined, { requested: true }),
        currentResult: result as unknown as OlumiResponse['blocks'][number],
        selectedFact: {
          graph_hash_at_run: result.computed_against_hash,
          computed_at: state.run_state.computed_at,
        },
      })).toEqual([]);
    });

  it('keeps the attested conditional projection on its selected Run and withholds the untyped mean', () => {
    const figures = projectSelectedRunFigures(input());
    expect(figures).toEqual([
      { option_id: 'raise_pro_price_to_59', value: 91836.73469387756, measure: 'projected_if_held',
        goal_node_id: 'mrr', unit: '£/month', goal_frame: 'level',
        run_hash: 'e7d843f951477155', computed_at: '2026-09-30T11:02:22.019Z',
        condition: { kind: 'if_held', operand_id: 'paying_subscribers' },
        claim_permissions: { may_present_value: true, may_name_as_leader: true,
          may_present_without_if_held: false, may_claim_goal_certainty: false },
        attested_copy: served.selected_fact.goal_certainty[0].say },
    ]);
    expect(figures).not.toContainEqual(expect.objectContaining({ measure: 'probability', value: 1 }));
  });

  it('withholds the conditional figure on a unit-only edit that the Run hash does not detect', () => {
    const graph = structuredClone(served.selected_goal);
    graph.nodes[0]!.goal_threshold_unit = 'USD/month';
    expect(readSelectedGoalFigureContext(graph, 'mrr')).toBeNull();
    expect(projectSelectedRunFigures({ ...input(), selectedGoal: readSelectedGoalFigureContext(graph, 'mrr') })).toEqual([]);
  });

  it('retains the same Run attestation after public transport removes its unearned chance', () => {
    const currentResult = structuredClone(served.current_result);
    delete (currentResult.enrichment.option_comparison[0]! as { probability_of_goal?: number }).probability_of_goal;
    expect(projectSelectedRunFigures({ ...input(), currentResult: currentResult as unknown as OlumiResponse['blocks'][number] }))
      .toEqual(projectSelectedRunFigures(input()));
  });

  it('withholds an absent-chance conditional with duplicate stored decisions', () => {
    const currentResult = structuredClone(served.current_result);
    delete (currentResult.enrichment.option_comparison[0]! as { probability_of_goal?: number }).probability_of_goal;
    const duplicated = { ...served.selected_fact, goal_certainty: [
      ...served.selected_fact.goal_certainty, served.selected_fact.goal_certainty[0],
    ] };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: duplicated,
      currentResult: currentResult as unknown as OlumiResponse['blocks'][number] })).toEqual([]);
  });

  it.each(['goal_probability', 'goalProbability'])('withholds a contrary %s transport alias', (alias) => {
    const currentResult = structuredClone(served.current_result);
    const option = currentResult.enrichment.option_comparison[0]! as Record<string, unknown>;
    delete option.probability_of_goal;
    option[alias] = 0;
    expect(projectSelectedRunFigures({ ...input(),
      currentResult: currentResult as unknown as OlumiResponse['blocks'][number] })).toEqual([]);
  });

  it('withholds figures without a hash-bound goal unit or an explicit level frame', () => {
    const graph = structuredClone(served.selected_goal);
    delete (graph.nodes[0]!.observed_state as { unit?: string }).unit;
    expect(readSelectedGoalFigureContext(graph, 'mrr')).toBeNull();
    graph.nodes[0]!.observed_state.unit = '£/month';
    graph.nodes[0]!.goal_threshold_frame = 'delta';
    expect(readSelectedGoalFigureContext(graph, 'mrr')).toBeNull();
  });

  it('a withheld common leader permission keeps the conditional figure without a leader claim', () => {
    const figures = projectSelectedRunFigures({ ...input(), claimPermissions: permissions('comparative_leader', { permitted: false, separation: 'separated' }) });
    expect(figures).toHaveLength(1);
    expect(figures.every((figure) => figure.claim_permissions.may_name_as_leader === false)).toBe(true);
  });

  it('an exploratory current Run keeps its conditional figure but cannot grant a leader claim from the leader stamp alone', () => {
    const figures = projectSelectedRunFigures({ ...input(), claimPermissions: permissions('exploratory') });
    expect(figures).toHaveLength(1);
    expect(figures[0]!.claim_permissions.may_name_as_leader).toBe(false);
    expect(figures[0]!.claim_permissions).not.toHaveProperty('provisional');
  });

  it('a permitted separable provisional Run carries the existing authority\'s provisional mark on its leader figure', () => {
    const figures = projectSelectedRunFigures({ ...input(), claimPermissions: permissions('quantified_provisional') });
    expect(figures).toHaveLength(1);
    expect(figures[0]!.claim_permissions).toMatchObject({ may_name_as_leader: true, provisional: true });
  });

  it('does not present a non-computed option as a selected Run figure', () => {
    const currentResult = structuredClone(served.current_result);
    currentResult.enrichment.option_comparison[0]!.status = 'excluded';
    expect(projectSelectedRunFigures({ ...input(), currentResult: currentResult as unknown as OlumiResponse['blocks'][number] })).toEqual([]);
  });

  it.each([
    ['stale', { kind: 'complete_stale', computed_at: served.run_state.computed_at, cause: 'graph_changed' }],
    ['never run', { kind: 'never_run' }],
    ['degraded', { kind: 'unknown_degraded', cause: 'store_unreadable' }],
    ['unreadable', null],
  ] as const)('%s exposes no current figure', (_label, runState) => {
    expect(projectSelectedRunFigures({ ...input(), runState: runState as AnalysisStateV1['run_state'] | null })).toEqual([]);
  });

  it('does not attach a certainty row from a different Run with the same hash', () => {
    const other = { ...served.selected_fact, computed_at: '2026-09-30T11:03:22.019Z' };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: other })).toEqual([]);
  });

  it('exposes no figures when the current block is unbound or its hash disagrees with the selected fact', () => {
    expect(projectSelectedRunFigures({ ...input(), currentResult: null })).toEqual([]);
    const other = { ...served.selected_fact, graph_hash_at_run: '0123456789abcdef' };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: other })).toEqual([]);
  });

  it('withholds a conditional value when its stored certainty decision is missing or disagrees', () => {
    const missing = { ...served.selected_fact, goal_certainty: undefined };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: missing })).toEqual([]);
    const contradicted = { ...served.selected_fact, goal_certainty: [
      { ...served.selected_fact.goal_certainty[0], probability_of_goal: 0 },
    ] };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: contradicted })).toEqual([]);
  });
});
