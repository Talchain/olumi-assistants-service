/**
 * add_factor action — label-based deduplication tests
 */

import { describe, it, expect } from "vitest";
import { addFactorAction } from "../../../../src/orchestrator/deterministic/actions/add-factor.js";
import type { DeterministicTurnContext, EntityEntry, EntityRegistry } from "../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeEntityRegistry(factors: Array<{ id: string; label: string }>): EntityRegistry {
  const nodes = new Map<string, EntityEntry>();
  for (const f of factors) {
    nodes.set(f.id, {
      id: f.id,
      label: f.label,
      kind: 'factor',
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

function makeCtx(factors: Array<{ id: string; label: string }>): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: makeEntityRegistry(factors),
    graph_summary: { node_count: factors.length + 1, edge_count: 0, option_count: 0, option_labels: [], goal_label: 'Maximise ROI', missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: false, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
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

describe('add_factor — label deduplication', () => {
  it('detects existing factor with exact label match and returns update response', async () => {
    const ctx = makeCtx([{ id: 'fac_ad_spend', label: 'Advertising Budget' }]);
    const result = await addFactorAction.execute(
      { label: 'Advertising Budget', value: 300000, unit: 'GBP' },
      ctx,
    );

    // Should NOT create a new node
    expect(result.operations?.some((op) => op.op === 'add_node')).toBeFalsy();
    // Should update existing node
    expect(result.operations?.some((op) => op.op === 'update_node' && op.path === 'fac_ad_spend')).toBe(true);
    expect(result.assistantText).toContain('Advertising Budget');
    expect(result.assistantText).toContain('update');
  });

  it('creates new node when label is genuinely new (regression)', async () => {
    const ctx = makeCtx([{ id: 'fac_ad_spend', label: 'Advertising Budget' }]);
    const result = await addFactorAction.execute(
      { label: 'Customer Acquisition Cost' },
      ctx,
    );

    expect(result.operations?.some((op) => op.op === 'add_node')).toBe(true);
    expect(result.assistantText).toContain('Customer Acquisition Cost');
  });

  it('matches case-insensitively: "advertising budget" matches "Advertising Budget"', async () => {
    const ctx = makeCtx([{ id: 'fac_ad_spend', label: 'Advertising Budget' }]);
    const result = await addFactorAction.execute(
      { label: 'advertising budget', value: 200000 },
      ctx,
    );

    expect(result.operations?.some((op) => op.op === 'add_node')).toBeFalsy();
    expect(result.operations?.some((op) => op.op === 'update_node')).toBe(true);
  });

  it('normalises whitespace: "Advertising  Budget" matches "Advertising Budget"', async () => {
    const ctx = makeCtx([{ id: 'fac_ad_spend', label: 'Advertising Budget' }]);
    const result = await addFactorAction.execute(
      { label: 'Advertising  Budget', value: 150000 },
      ctx,
    );

    expect(result.operations?.some((op) => op.op === 'add_node')).toBeFalsy();
    expect(result.operations?.some((op) => op.op === 'update_node')).toBe(true);
  });

  it('returns guidance text without operations when match found but no value provided', async () => {
    const ctx = makeCtx([{ id: 'fac_ad_spend', label: 'Advertising Budget' }]);
    const result = await addFactorAction.execute(
      { label: 'Advertising Budget' },
      ctx,
    );

    expect(result.operations).toBeUndefined();
    expect(result.assistantText).toContain('already exists');
  });
});
