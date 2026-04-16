/**
 * Fix 4: verify that operation-emitting handlers produce structured facts
 * for response-composer routing. Each handler must emit auto_apply: false
 * (operations in V4 are always emitted as proposals) and proposal-language
 * assistantText.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { adjustEdgeStrengthAction } from '../../../../../src/orchestrator/deterministic/actions/adjust-edge-strength.js';
import { addConstraintAction } from '../../../../../src/orchestrator/deterministic/actions/add-constraint.js';
import { setGoalTargetAction } from '../../../../../src/orchestrator/deterministic/actions/set-goal-target.js';
import type { DeterministicTurnContext } from '../../../../../src/orchestrator/deterministic/types.js';
import type { GraphV3T } from '../../../../../src/schemas/cee-v3.js';

// ============================================================================
// Shared fixture
// ============================================================================

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
      { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      { id: 'fac_quality', kind: 'factor', label: 'Quality' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
    ],
    edges: [
      { from: 'fac_cost', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_quality', to: 'goal_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

function makeCtx(): DeterministicTurnContext {
  const graph = makeGraph();
  return {
    stage: 'ideate',
    entities: {
      nodes: new Map([
        ['fac_cost', { id: 'fac_cost', label: 'Cost', kind: 'factor', aliases: [] }],
        ['fac_quality', { id: 'fac_quality', label: 'Quality', kind: 'factor', aliases: [] }],
        ['goal_1', { id: 'goal_1', label: 'Revenue', kind: 'goal', aliases: [] }],
      ]),
      edges: graph.edges.map(e => ({
        from: (e as { from: string }).from,
        to: (e as { to: string }).to,
        strength_mean: 0.5,
        strength_std: 0.1,
      })),
      option_ids: ['opt_a'],
      goal_id: 'goal_1',
    },
    graph_summary: { node_count: 4, edge_count: 2, option_count: 1, option_labels: ['Option A'], goal_label: 'Revenue', missing_structural: [] },
    analysis_summary: null,
    capabilities: {} as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 2, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  } as unknown as DeterministicTurnContext;
}

// ============================================================================
// adjust_edge_strength
// ============================================================================

describe('adjust_edge_strength — handler fact', () => {
  it('emits fact with action: edge_adjusted and auto_apply: false', async () => {
    const ctx = makeCtx();
    const result = await adjustEdgeStrengthAction.execute(
      { from: 'fac_cost', to: 'goal_1', strength_mean: 0.9 },
      ctx,
    );
    expect(result.fact).toBeDefined();
    expect(result.fact!.action).toBe('edge_adjusted');
    expect(result.fact!.auto_apply).toBe(false);
  });

  it('assistantText uses proposal language', async () => {
    const ctx = makeCtx();
    const result = await adjustEdgeStrengthAction.execute(
      { from: 'fac_cost', to: 'goal_1', strength_mean: 0.9 },
      ctx,
    );
    expect(result.assistantText).toContain('would');
    expect(result.assistantText).not.toMatch(/\bAdjusted\b/);
  });
});

// ============================================================================
// add_constraint
// ============================================================================

describe('add_constraint — handler fact', () => {
  it('emits fact with action: constraint_added and auto_apply: false', async () => {
    const ctx = makeCtx();
    const result = await addConstraintAction.execute(
      { target_id: 'fac_cost', threshold: 0.5, label: 'Cost cap' },
      ctx,
    );
    expect(result.fact).toBeDefined();
    expect(result.fact!.action).toBe('constraint_added');
    expect(result.fact!.auto_apply).toBe(false);
    expect(result.fact!.entities_affected[0].id).toBe('fac_cost');
  });

  it('assistantText uses proposal language', async () => {
    const ctx = makeCtx();
    const result = await addConstraintAction.execute(
      { target_id: 'fac_cost', threshold: 0.5, label: 'Cost cap' },
      ctx,
    );
    expect(result.assistantText).toContain('would');
    expect(result.assistantText).not.toMatch(/\bAdded\b/);
  });
});

// ============================================================================
// set_goal_target
// ============================================================================

describe('set_goal_target — handler fact', () => {
  it('emits fact with action: goal_target_set and auto_apply: false', async () => {
    const ctx = makeCtx();
    const result = await setGoalTargetAction.execute(
      { threshold: 0.8 },
      ctx,
    );
    expect(result.fact).toBeDefined();
    expect(result.fact!.action).toBe('goal_target_set');
    expect(result.fact!.auto_apply).toBe(false);
    expect(result.fact!.data?.target).toBe(0.8);
  });

  it('assistantText uses proposal language', async () => {
    const ctx = makeCtx();
    const result = await setGoalTargetAction.execute(
      { threshold: 0.8 },
      ctx,
    );
    expect(result.assistantText).toContain('would');
    expect(result.assistantText).not.toMatch(/\bUpdated\b/);
  });
});
