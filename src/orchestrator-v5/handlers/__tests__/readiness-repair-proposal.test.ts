import { describe, expect, it } from 'vitest';

import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { assessAnalysisReadiness } from '../../tools/handlers/analysis-ready-core.js';
import {
  buildReadinessRepairOffer,
  executeReadinessRepair,
  readReadinessRepairResume,
} from '../readiness-repair-proposal.js';

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
    expect(assessment.blockingIssues[0]?.code).toBe('UNREACHABLE_CONTROLLABLE_FACTOR');
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
    expect(assessment.blockingIssues[0]?.code).toBe('NO_CAP_UNRECOVERABLE');
    expect(assessment.repairProposal).toBeNull();
    expect(assessAnalysisReadiness(graph).nextStep).toContain('real bound');
  });
});

describe('multi-blocker repair proposal', () => {
  function multiBlockerGraph(): Dict {
    const graph = baseGraph();
    const optionA = node(graph, 'opt_a');
    delete optionA.interventions;
    optionA.data = {
      interventions: { fac_cost: { raw_value: 40, unit: '£' } },
    };
    (graph.nodes as Dict[]).push({
      id: 'fac_capacity',
      kind: 'factor',
      label: 'Delivery capacity',
      category: 'controllable',
    });
    (graph.edges as Dict[]).push(edge('fac_capacity', 'goal_1'));
    graph.nodes = (graph.nodes as Dict[]).filter((candidate) => candidate.id !== 'dec_1');
    graph.edges = (graph.edges as Dict[]).filter((candidate) => candidate.from !== 'dec_1');
    return graph;
  }

  it('contains every safe change and every unresolved human input, with zero pre-review mutation', () => {
    const graph = multiBlockerGraph();
    const before = JSON.stringify(graph);
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const proposal = assessment.repairProposal;
    expect(proposal).not.toBeNull();
    expect(proposal?.complete).toBe(true);
    expect(proposal?.changes.map((change) => change.option_id)).toEqual(['opt_a']);
    expect(proposal?.unresolved_inputs.length).toBe(assessment.blockingIssues.length);
    expect(assessment.analysisReady?.readiness_issues?.map((issue) => issue.issue_id))
      .toEqual(proposal?.issue_ids);
    expect(proposal?.unresolved_inputs.every((input) => !/\b(?:0\.5|50%)\b/.test(input.prompt))).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);

    const offer = buildReadinessRepairOffer({
      assessment,
      currentGraphHash: 'hash_at_review',
      scenarioId: 'scenario_1',
    });
    expect(offer).not.toBeNull();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('confirmation builds one candidate, reassesses it, and preserves unresolved judgement', () => {
    const graph = multiBlockerGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const offer = buildReadinessRepairOffer({
      assessment,
      currentGraphHash: 'hash_at_review',
      scenarioId: 'scenario_1',
    })!;
    const read = readReadinessRepairResume(offer.pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;

    const outcome = executeReadinessRepair({
      proposal: read.proposal,
      currentGraph: graph,
      hasExistingAnalysis: false,
    });
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const repaired = outcome.mutatedGraph as Dict;
    expect((node(repaired, 'opt_a').interventions as Dict).fac_cost).toMatchObject({
      value: 0.4,
      raw_value: 40,
      unit: '£',
    });
    expect((node(repaired, 'opt_a').data as Dict | undefined)?.interventions).toBeUndefined();
    expect(outcome.assessmentAfter.blockingIssues.length).toBeGreaterThanOrEqual(2);
    expect(node(repaired, 'fac_capacity').value).toBeUndefined();
  });

  it('applies several safe carrier changes together in the one reassessed candidate', () => {
    const graph = multiBlockerGraph();
    const optionB = node(graph, 'opt_b');
    delete optionB.interventions;
    optionB['data/interventions/fac_cost'] = { raw_value: 60, unit: '£' };
    const before = JSON.stringify(graph);
    const proposal = assessCanonicalAnalysisReadiness(graph).repairProposal!;
    expect(proposal.changes.map((change) => change.option_id)).toEqual(['opt_a', 'opt_b']);

    const outcome = executeReadinessRepair({
      proposal,
      currentGraph: graph,
      hasExistingAnalysis: false,
    });
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const repaired = outcome.mutatedGraph as Dict;
    expect((node(repaired, 'opt_a').interventions as Dict).fac_cost).toMatchObject({ value: 0.4 });
    expect((node(repaired, 'opt_b').interventions as Dict).fac_cost).toMatchObject({ value: 0.6 });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('accepts a JSONB-style key reordering without weakening exact proposal equality', () => {
    const graph = multiBlockerGraph();
    const proposal = assessCanonicalAnalysisReadiness(graph).repairProposal!;
    const reordered = {
      unresolved_inputs: proposal.unresolved_inputs.map((input) => ({
        prompt: input.prompt,
        kind: input.kind,
        issue_id: input.issue_id,
        ...(input.factor_id ? { factor_id: input.factor_id } : {}),
        ...(input.option_id ? { option_id: input.option_id } : {}),
      })),
      changes: proposal.changes.map((change) => ({
        description: change.description,
        option_label: change.option_label,
        option_id: change.option_id,
        kind: change.kind,
        change_id: change.change_id,
      })),
      issue_ids: [...proposal.issue_ids],
      complete: true as const,
      proposal_version: 'readiness_repair_v1' as const,
    };
    expect(executeReadinessRepair({
      proposal: reordered,
      currentGraph: graph,
      hasExistingAnalysis: false,
    }).status).toBe('executed');
  });

  it('a dropped issue/input mutant is rejected and produces no candidate', () => {
    const graph = multiBlockerGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const proposal = assessment.repairProposal!;
    const mutant = {
      ...proposal,
      unresolved_inputs: proposal.unresolved_inputs.slice(1),
    };
    const outcome = executeReadinessRepair({
      proposal: mutant,
      currentGraph: graph,
      hasExistingAnalysis: false,
    });
    expect(outcome).toEqual({ status: 'invalid', reason: 'proposal_mismatch' });
    expect(node(graph, 'opt_a').interventions).toBeUndefined();
  });
});
