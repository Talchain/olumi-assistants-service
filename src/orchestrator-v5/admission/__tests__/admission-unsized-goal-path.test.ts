import { describe, expect, it } from 'vitest';

import { unsizedLeaderGoalPaths } from '../../agent-lane/goal-certainty.js';
import { resolveAnalysisAdmission } from '../analysis-admission.js';

const OPTION_IDS = ['opt_a', 'opt_b'];

/** Adapted from analysis-admission.test.ts's private admissibleGraph helper. */
function hiringGraph(magnitude: 'olumi_placeholder' | 'user_stated' = 'olumi_placeholder') {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Hiring approach' },
      { id: 'goal_1', kind: 'goal', label: 'Improve delivery' },
      {
        id: 'fac_cost', kind: 'factor', label: 'Hiring cost',
        observed_state: { value: 0, source: 'user_edited' },
      },
      {
        id: 'fac_productivity', kind: 'factor', label: 'Productivity',
        observed_state: { value: 1, source: 'cee_inference' },
      },
      {
        id: 'opt_a', kind: 'option', label: 'Hire',
        interventions: { fac_cost: { value: 20000, source: 'brief_extraction' } },
      },
      {
        id: 'opt_b', kind: 'option', label: 'Hold hiring',
        interventions: { fac_cost: { value: 0, source: 'brief_extraction' } },
      },
    ],
    edges: [
      {
        from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.01 },
        exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.01 },
        exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'fac_cost', to: 'fac_productivity', strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9, effect_direction: 'positive', defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude },
      },
      {
        from: 'fac_productivity', to: 'goal_1', strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', magnitude: 'user_stated' as const },
      },
      {
        from: 'opt_a', to: 'fac_cost', strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
      {
        from: 'opt_b', to: 'fac_cost', strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  };
}

describe('admission honours the unsized leader goal-path licence', () => {
  it('caps a Run 3-shaped hiring comparison despite its user-sized cost (RED on base)', () => {
    const graph = hiringGraph();
    expect(unsizedLeaderGoalPaths(graph, OPTION_IDS)).toEqual([
      { option_id: 'opt_a', links: [{ from: 'fac_cost', to: 'fac_productivity' }] },
    ]);
    const verdict = resolveAnalysisAdmission(graph);
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.semantic_quality_sufficient).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('quantified_provisional');
  });

  it('permits a leader when the same hiring link is user-sized', () => {
    const graph = hiringGraph('user_stated');
    expect(unsizedLeaderGoalPaths(graph, OPTION_IDS)).toEqual([]);
    const verdict = resolveAnalysisAdmission(graph);
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.semantic_quality_sufficient).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('comparative_leader');
  });

  it('follows the shared predicate when sized and unsized paths both reach the goal', () => {
    const graph = hiringGraph();
    graph.edges.push({
      from: 'fac_cost', to: 'goal_1', strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'user_stated' },
    });
    const goalPaths = unsizedLeaderGoalPaths(graph, OPTION_IDS);
    const verdict = resolveAnalysisAdmission(graph);
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.semantic_quality_sufficient).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe(
      goalPaths.length > 0 ? 'quantified_provisional' : 'comparative_leader',
    );
  });
});
