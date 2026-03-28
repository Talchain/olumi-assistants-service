/**
 * Chip Assembler Tests
 */

import { describe, it, expect } from "vitest";
import { buildChipsFromRecommendations } from "../../../../src/orchestrator/deterministic/chip-assembler.js";
import type { DeterministicTurnContext, LLMRecommendedAction } from "../../../../src/orchestrator/deterministic/types.js";

function makeContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 5, edge_count: 4, option_count: 2, option_labels: [], goal_label: null, missing_structural: false },
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: true },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['explain_result', 'compare_options', 'run_analysis', 'challenge_assumption'],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    ...overrides,
  };
}

describe('buildChipsFromRecommendations', () => {
  it('builds chips from valid recommendations', () => {
    const recs: LLMRecommendedAction[] = [
      { action_type: 'explain_result', rationale: 'Show the results' },
      { action_type: 'compare_options', rationale: 'Compare side by side' },
    ];
    const ctx = makeContext();
    const chips = buildChipsFromRecommendations(recs, ctx);

    expect(chips).toHaveLength(2);
    expect(chips[0].label).toBeDefined();
    expect(chips[0].prompt).toBeDefined();
    expect(chips[0].role).toBeDefined();
  });

  it('filters out invalid action types', () => {
    const recs: LLMRecommendedAction[] = [
      { action_type: 'not_a_real_action' },
      { action_type: 'explain_result' },
    ];
    const ctx = makeContext();
    const chips = buildChipsFromRecommendations(recs, ctx);

    expect(chips).toHaveLength(1);
    expect(chips[0].label).toContain('Explain');
  });

  it('filters out actions not in eligible_actions', () => {
    const recs: LLMRecommendedAction[] = [
      { action_type: 'generate_artefact' }, // not in eligible_actions
      { action_type: 'explain_result' },
    ];
    const ctx = makeContext({ eligible_actions: ['explain_result'] });
    const chips = buildChipsFromRecommendations(recs, ctx);

    expect(chips).toHaveLength(1);
  });

  it('suppresses recently taken actions', () => {
    const recs: LLMRecommendedAction[] = [
      { action_type: 'explain_result' },
    ];
    const ctx = makeContext({
      conversation: {
        turn_count: 3,
        last_user_intent: null,
        recent_actions_taken: ['explain_result'],
        recent_actions_declined: [],
        pending_confirmation: null,
      },
    });
    const chips = buildChipsFromRecommendations(recs, ctx);

    expect(chips).toHaveLength(0);
  });

  it('caps at 3 chips', () => {
    const recs: LLMRecommendedAction[] = [
      { action_type: 'explain_result' },
      { action_type: 'compare_options' },
      { action_type: 'run_analysis' },
      { action_type: 'challenge_assumption' },
    ];
    const ctx = makeContext();
    const chips = buildChipsFromRecommendations(recs, ctx);

    expect(chips).toHaveLength(3);
  });
});
