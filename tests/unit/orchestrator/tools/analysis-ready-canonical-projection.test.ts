import { describe, expect, it } from 'vitest';

import { buildAnalysisReadyPayload } from '../../../../src/cee/transforms/analysis-ready.js';
import type { GraphV3T, OptionV3T } from '../../../../src/schemas/cee-v3.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  computeStructuralReadiness,
} from '../../../../src/orchestrator/tools/analysis-ready-helper.js';
import { projectGraphForPersistence } from '../../../../src/orchestrator-v5/persisted-graph-projection.js';
import {
  buildReadinessRecoveryChip,
  projectReadinessRecovery,
} from '../../../../src/orchestrator-v5/coaching/readiness-recovery.js';
import { assessAnalysisReadiness } from '../../../../src/orchestrator-v5/tools/handlers/analysis-ready-core.js';

function intervention(factorId: string, value: number) {
  return {
    value,
    source: 'user_specified' as const,
    target_match: {
      node_id: factorId,
      match_type: 'exact_id' as const,
      confidence: 'high' as const,
    },
  };
}

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

function unreachableFactorFixture(): {
  graph: GraphV3T & { options: OptionV3T[]; goal_node_id: string };
  options: OptionV3T[];
} {
  const options: OptionV3T[] = [
    {
      id: 'opt_fast',
      label: 'Move quickly',
      status: 'ready',
      interventions: { fac_reach: intervention('fac_reach', 0.8) },
    },
    {
      id: 'opt_careful',
      label: 'Phase carefully',
      status: 'ready',
      interventions: { fac_reach: intervention('fac_reach', 0.4) },
    },
  ];
  const graph = {
    goal_node_id: 'goal_growth',
    nodes: [
      { id: 'goal_growth', kind: 'goal' as const, label: 'Sustainable growth' },
      { id: 'dec_route', kind: 'decision' as const, label: 'Choose a route' },
      {
        id: 'opt_fast',
        kind: 'option' as const,
        label: 'Move quickly',
        interventions: options[0]!.interventions,
      },
      {
        id: 'opt_careful',
        kind: 'option' as const,
        label: 'Phase carefully',
        interventions: options[1]!.interventions,
      },
      { id: 'fac_reach', kind: 'factor' as const, label: 'Customer reach', category: 'controllable' as const },
      {
        id: 'fac_capacity',
        kind: 'factor' as const,
        label: 'Delivery capacity',
        category: 'controllable' as const,
      },
    ],
    edges: [
      edge('dec_route', 'opt_fast'),
      edge('dec_route', 'opt_careful'),
      edge('opt_fast', 'fac_reach'),
      edge('opt_careful', 'fac_reach'),
      edge('fac_reach', 'goal_growth'),
      // Structurally connected to the goal, but unreachable from every option.
      edge('fac_capacity', 'goal_growth'),
    ],
    options,
  };
  return { graph, options };
}

describe('canonical persisted-graph readiness projection', () => {
  it('preserves producer needs_user_mapping before and after persistence for an unreachable controllable factor', () => {
    const { graph, options } = unreachableFactorFixture();
    const producer = buildAnalysisReadyPayload(options, graph.goal_node_id, graph, {
      requestId: 'canonical-pre-persist',
    });
    expect(producer.status).toBe('needs_user_mapping');
    expect(producer.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factor_id: 'fac_capacity',
          factor_label: 'Delivery capacity',
          blocker_type: 'missing_value',
        }),
      ]),
    );

    const persisted = projectGraphForPersistence(graph, {
      scenarioId: 'scenario-readiness',
      turnId: 'turn-readiness',
      source: 'test',
    });
    const projected = buildCanonicalAnalysisReadyFromGraph(persisted);
    expect(projected?.status).toBe('needs_user_mapping');
    expect(projected?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factor_id: 'fac_capacity', blocker_type: 'missing_value' }),
      ]),
    );

    const preRecovery = projectReadinessRecovery(producer, graph.nodes);
    const postRecovery = projectReadinessRecovery(projected, graph.nodes);
    expect(postRecovery).toEqual(preRecovery);
    expect(postRecovery.kind).toBe('map_option');
    expect(postRecovery.nextStep).toContain('which option changes which factor');
    expect(postRecovery.nextStep.toLowerCase()).not.toContain('missing effect value');
    expect(postRecovery.nextStep.toLowerCase()).not.toContain('run the analysis');

    const chip = buildReadinessRecoveryChip(projected, graph.nodes);
    expect(chip).toMatchObject({
      id: 'chip_prompt_map_factor_to_option',
      label: 'Map "Delivery capacity" to an option',
    });
    expect(chip).not.toHaveProperty('action_type');
    expect(chip?.message).not.toMatch(/\b\d+(?:\.\d+)?\b/);
  });

  it('kills the legacy whole-status discriminator: graph-only says ready while canonical producer and Run guard block', () => {
    const { graph } = unreachableFactorFixture();
    // Compatibility control only: this demonstrates why the legacy helper may
    // not own whole-status/Run admission.
    expect(computeStructuralReadiness(graph)?.status).toBe('ready');
    expect(buildCanonicalAnalysisReadyFromGraph(graph)?.status).toBe('needs_user_mapping');

    const guard = assessAnalysisReadiness(graph);
    expect(guard.status).toBe('unrecoverable');
    expect(guard.safeToAnalyse).toBe(false);
    expect(guard.reasonCodes).toContain('OPTIONS_NOT_CONFIGURED');
    expect(guard.nextStep).toContain('which option changes which factor');
  });
});
