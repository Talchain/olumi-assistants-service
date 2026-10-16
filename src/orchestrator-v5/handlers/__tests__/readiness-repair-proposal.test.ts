import { describe,expect,it } from 'vitest';

import {
assessCanonicalAnalysisReadiness,
buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { assessAnalysisReadiness } from '../../tools/handlers/analysis-ready-core.js';


type Dict = Record<string, unknown>;

function edge(from: string, to: string): Dict {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

function baseGraph(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Grow responsibly' },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      {
        id: 'fac_cost',
        kind: 'factor',
        label: 'Annual cost',
        category: 'controllable',
        observed_state: { value: 0.4, unit: '£', cap: 100 },
      },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Option A',
        interventions: {
          fac_cost: { value: 0.4, source: 'user_specified' },
        },
      },
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Option B',
        interventions: {
          fac_cost: { value: 0.6, source: 'user_specified' },
        },
      },
    ],
    edges: [
      edge('dec_1', 'opt_a'),
      edge('dec_1', 'opt_b'),
      edge('opt_a', 'fac_cost'),
      edge('opt_b', 'fac_cost'),
      edge('fac_cost', 'goal_1'),
    ],
  };
}

function node(graph: Dict, id: string): Dict {
  return (graph.nodes as Dict[]).find((candidate) => candidate.id === id)!;
}

describe('canonical readiness authority', () => {
  it('drives wire and Run admission from the same exhaustive structural record', () => {
    const graph = baseGraph();
    graph.nodes = (graph.nodes as Dict[]).filter((candidate) => candidate.id !== 'opt_b');
    graph.edges = (graph.edges as Dict[]).filter(
      (candidate) => candidate.from !== 'opt_b' && candidate.to !== 'opt_b',
    );

    const assessment = assessCanonicalAnalysisReadiness(graph);
    const wire = buildCanonicalAnalysisReadyFromGraph(graph);
    const run = assessAnalysisReadiness(graph);

    expect(assessment.blockingIssues.map((issue) => issue.code)).toContain('FEWER_THAN_TWO_OPTIONS');
    expect(wire?.status).toBe('blocked');
    expect(wire?.blocked_reason).toBe('FEWER_THAN_TWO_OPTIONS');
    expect(run.safeToAnalyse).toBe(false);
    expect(run.reasonCodes).toContain('FEWER_THAN_TWO_OPTIONS');
  });

  it('blocks the no-decision contradiction on both surfaces', () => {
    const graph = baseGraph();
    graph.nodes = (graph.nodes as Dict[]).filter((candidate) => candidate.id !== 'dec_1');
    graph.edges = (graph.edges as Dict[]).filter((candidate) => candidate.from !== 'dec_1');
    expect(buildCanonicalAnalysisReadyFromGraph(graph)?.status).toBe('blocked');
    expect(assessAnalysisReadiness(graph).reasonCodes).toContain('NO_DECISION');
  });

  it('blocks a missing goal on both surfaces instead of dropping the wire status', () => {
    const graph = baseGraph();
    graph.nodes = (graph.nodes as Dict[]).filter((candidate) => candidate.id !== 'goal_1');
    graph.edges = (graph.edges as Dict[]).filter((candidate) => candidate.to !== 'goal_1');
    expect(buildCanonicalAnalysisReadyFromGraph(graph)).toMatchObject({
      status: 'blocked',
      blocked_reason: 'NO_GOAL',
      goal_node_id: '',
    });
    expect(assessAnalysisReadiness(graph).reasonCodes).toContain('NO_GOAL');
  });

  it('keeps a genuine one-blocker flow targeted and emits no multi proposal', () => {
    const graph = baseGraph();
    (graph.nodes as Dict[]).push({
      id: 'fac_capacity',
      kind: 'factor',
      label: 'Delivery capacity',
      category: 'controllable',
    });
    (graph.edges as Dict[]).push(edge('fac_capacity', 'goal_1'));
    const assessment = assessCanonicalAnalysisReadiness(graph);
    expect(assessment.blockingIssues).toHaveLength(1);
    expect(assessment.blockingIssues[0]?.code).toBe('MISSING_FACTOR_LEVEL');
    expect(assessment.repairProposal).toBeNull();
    expect(assessAnalysisReadiness(graph).nextStep).toContain('Delivery capacity');
  });

  it('does not double-count one unencodable option as a multi-blocker state', () => {
    const graph = baseGraph();
    const optionA = node(graph, 'opt_a');
    delete optionA.interventions;
    optionA.data = {
      interventions: { fac_cost: { raw_value: 40, unit: '£' } },
    };
    const cost = node(graph, 'fac_cost');
    cost.observed_state = { value: 0.4, unit: '£' };

    const assessment = assessCanonicalAnalysisReadiness(graph);
    expect(assessment.blockingIssues).toHaveLength(1);
    expect(assessment.blockingIssues[0]).toMatchObject({
      code: 'NO_CAP_UNRECOVERABLE',
      option_id: 'opt_a',
      factor_id: 'fac_cost',
    });
    expect(assessment.repairProposal).toBeNull();
    expect(assessAnalysisReadiness(graph).nextStep).toContain('real bound');
  });

  it('preserves two missing factor inputs on the same option as two blockers', () => {
    const graph = baseGraph();
    const optionA = node(graph, 'opt_a');
    delete optionA.interventions;
    const optionB = node(graph, 'opt_b');
    optionB.interventions = {
      ...(optionB.interventions as Dict),
      fac_quality: { value: 0.7, source: 'user_specified' },
    };
    (graph.nodes as Dict[]).push({
      id: 'fac_quality',
      kind: 'factor',
      label: 'Delivery quality',
      category: 'controllable',
      // A status-quo level, as `fac_cost` has in the base graph. The two missing inputs this row is about are
      // OPTION values; since #2164 an unvalued goal root would add a third, factor-scoped `MISSING_FACTOR_LEVEL`.
      observed_state: { value: 0.5 },
    });
    (graph.edges as Dict[]).push(
      edge('opt_a', 'fac_quality'),
      edge('opt_b', 'fac_quality'),
      edge('fac_quality', 'goal_1'),
    );

    const assessment = assessCanonicalAnalysisReadiness(graph);
    expect(assessment.blockingIssues).toHaveLength(2);
    expect(assessment.blockingIssues.map((issue) => ({
      code: issue.code,
      option_id: issue.option_id,
      factor_id: issue.factor_id,
    }))).toEqual([
      { code: 'MISSING_OPTION_VALUE', option_id: 'opt_a', factor_id: 'fac_cost' },
      { code: 'MISSING_OPTION_VALUE', option_id: 'opt_a', factor_id: 'fac_quality' },
    ]);
    expect(assessment.repairProposal?.unresolved_inputs).toHaveLength(2);
    expect(assessment.repairProposal?.unresolved_inputs.map((input) => input.factor_id))
      .toEqual(['fac_cost', 'fac_quality']);
  });
});
