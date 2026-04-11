/**
 * add_factor action — risk factor edge direction tests
 */

import { describe, it, expect } from "vitest";
import { addFactorAction } from "../../../../src/orchestrator/deterministic/actions/add-factor.js";
import type { DeterministicTurnContext, EntityEntry, EntityRegistry } from "../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeEntityRegistry(
  factors: Array<{ id: string; label: string; kind?: string }>,
): EntityRegistry {
  const nodes = new Map<string, EntityEntry>();
  for (const f of factors) {
    nodes.set(f.id, {
      id: f.id,
      label: f.label,
      kind: (f.kind ?? 'factor') as EntityEntry['kind'],
      aliases: [],
      is_action_target: true,
    });
  }
  nodes.set('goal_1', {
    id: 'goal_1',
    label: 'Maximise ROI',
    kind: 'goal',
    aliases: [],
    is_action_target: false,
  });
  return { nodes, edges: [], option_ids: [], goal_id: 'goal_1' };
}

function makeCtx(
  factors: Array<{ id: string; label: string; kind?: string }> = [],
): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: makeEntityRegistry(factors),
    graph_summary: {
      node_count: factors.length + 1,
      edge_count: 0,
      option_count: 0,
      option_labels: [],
      goal_label: 'Maximise ROI',
      missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: false,
      can_explain_results: false,
      can_edit_graph: true,
      can_compare_options: false,
      can_challenge: false,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: {
      high_uncertainty_factors: [],
      dominant_factor: null,
      close_call: false,
      default_value_count: 0,
      weak_edges: [],
    },
    conversation: {
      turn_count: 0,
      last_user_intent: null,
      recent_actions_taken: [],
      recent_actions_declined: [],
      pending_confirmation: null,
    },
    eligible_actions: ['add_factor'],
    disambiguation_hints: [],
    graph: { nodes: [], edges: [] } as unknown as GraphV3T,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'test',
    analysis_inputs: null,
  };
}

describe('add_factor — risk factor edge direction', () => {
  it('sets effect_direction to negative when kind is risk', async () => {
    const ctx = makeCtx();
    const result = await addFactorAction.execute(
      { label: 'Team Dynamics Risk', kind: 'risk' },
      ctx,
    );

    const addEdge = result.operations?.find((op) => op.op === 'add_edge');
    expect(addEdge).toBeDefined();
    expect(addEdge!.value.effect_direction).toBe('negative');
    // Strength mean stays positive — direction is carried by effect_direction
    expect(addEdge!.value.strength.mean).toBe(0.5);
  });

  it('sets effect_direction to positive when kind is factor (default)', async () => {
    const ctx = makeCtx();
    const result = await addFactorAction.execute(
      { label: 'Market Size' },
      ctx,
    );

    const addEdge = result.operations?.find((op) => op.op === 'add_edge');
    expect(addEdge).toBeDefined();
    expect(addEdge!.value.effect_direction).toBe('positive');
  });

  it('creates node with kind: risk and risk_ prefix', async () => {
    const ctx = makeCtx();
    const result = await addFactorAction.execute(
      { label: 'Customer Churn', kind: 'risk' },
      ctx,
    );

    const addNode = result.operations?.find((op) => op.op === 'add_node');
    expect(addNode).toBeDefined();
    expect(addNode!.value.kind).toBe('risk');
    expect(addNode!.path).toMatch(/^risk_/);
    expect(addNode!.value.id).toMatch(/^risk_/);
  });

  it('creates node with kind: factor and factor_ prefix when kind is omitted', async () => {
    const ctx = makeCtx();
    const result = await addFactorAction.execute(
      { label: 'Market Size' },
      ctx,
    );

    const addNode = result.operations?.find((op) => op.op === 'add_node');
    expect(addNode).toBeDefined();
    expect(addNode!.value.kind).toBe('factor');
    expect(addNode!.path).toMatch(/^factor_/);
  });

  it('uses "risk factor" in assistantText when kind is risk', async () => {
    const ctx = makeCtx();
    const result = await addFactorAction.execute(
      { label: 'Attrition', kind: 'risk' },
      ctx,
    );

    expect(result.assistantText).toContain('risk factor');
  });

  it('deduplicates across risk and factor kinds', async () => {
    const ctx = makeCtx([{ id: 'factor_team_dynamics', label: 'Team Dynamics', kind: 'factor' }]);
    const result = await addFactorAction.execute(
      { label: 'Team Dynamics', kind: 'risk' },
      ctx,
    );

    // Should detect existing and redirect to update, not create duplicate
    expect(result.operations?.some((op) => op.op === 'add_node')).toBeFalsy();
    expect(result.assistantText).toContain('already exists');
  });
});
