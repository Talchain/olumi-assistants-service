/**
 * Tests for the deterministic chip builder v4.
 * Chips must be fully deterministic — no LLM input.
 */

import { describe, it, expect } from "vitest";
import { buildDeterministicChips } from "../../../../src/orchestrator/deterministic/chip-builder-v4.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 3, edge_count: 2, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Success', missing_structural: [] },
    analysis_summary: { winner: 'A', winner_probability: 0.65, runner_up: 'B', runner_up_probability: 0.35, robustness_band: 'moderate', top_drivers: [], fragile_edge_count: 0, fragile_edges: [], factor_sensitivity: [], edge_e_values: [], conditional_winners: [], inference_warnings: [], constraints_met: true, constraint_tensions: [] },
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['run_analysis', 'explain_result', 'compare_options', 'set_factor_value', 'challenge_assumption'],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
    ...overrides,
  };
}

describe("buildDeterministicChips", () => {
  it("returns chips from eligible_actions without LLM input", () => {
    const ctx = makeTurnContext();
    const chips = buildDeterministicChips(ctx);

    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    for (const chip of chips) {
      expect(chip).toHaveProperty('label');
      expect(chip).toHaveProperty('prompt');
      expect(chip).toHaveProperty('role');
      expect(chip).toHaveProperty('action_type');
    }
  });

  it("caps at 3 chips", () => {
    const ctx = makeTurnContext({
      eligible_actions: ['run_analysis', 'explain_result', 'compare_options', 'set_factor_value', 'challenge_assumption', 'what_would_flip'],
    });
    const chips = buildDeterministicChips(ctx);
    expect(chips.length).toBe(3);
  });

  it("excludes generate_artefact and draft_graph", () => {
    const ctx = makeTurnContext({
      eligible_actions: ['generate_artefact', 'draft_graph', 'run_analysis'],
    });
    const chips = buildDeterministicChips(ctx);

    const names = chips.map((c) => c.action_type);
    expect(names).not.toContain('generate_artefact');
    expect(names).not.toContain('draft_graph');
    expect(names).toContain('run_analysis');
  });

  it("excludes recently executed actions", () => {
    const ctx = makeTurnContext({
      conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: ['run_analysis'], recent_actions_declined: [], pending_confirmation: null },
    });
    const chips = buildDeterministicChips(ctx);

    const names = chips.map((c) => c.action_type);
    expect(names).not.toContain('run_analysis');
  });

  it("excludes the just-executed action", () => {
    const ctx = makeTurnContext();
    const chips = buildDeterministicChips(ctx, 'explain_result');

    const names = chips.map((c) => c.action_type);
    expect(names).not.toContain('explain_result');
  });

  it("returns empty array when no eligible actions", () => {
    const ctx = makeTurnContext({ eligible_actions: [] });
    const chips = buildDeterministicChips(ctx);
    expect(chips).toEqual([]);
  });

  it("boosts run_analysis when no analysis exists", () => {
    const ctx = makeTurnContext({
      analysis_summary: null,
      eligible_actions: ['set_factor_value', 'run_analysis', 'add_factor'],
    });
    const chips = buildDeterministicChips(ctx);

    // run_analysis should be first chip due to boost
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it("boosts what_would_flip on close call signal", () => {
    const ctx = makeTurnContext({
      signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: true, default_value_count: 0, weak_edges: [] },
      eligible_actions: ['set_factor_value', 'what_would_flip', 'compare_options'],
    });
    const chips = buildDeterministicChips(ctx);

    const names = chips.map((c) => c.action_type);
    expect(names).toContain('what_would_flip');
  });

  // ====================================================================
  // Task 3: run_analysis chip suppression post-analysis
  // ====================================================================

  it("deprioritises run_analysis when analysis is complete (can_explain_results: true)", () => {
    const ctx = makeTurnContext({
      capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: false },
      eligible_actions: ['run_analysis', 'explain_result', 'compare_options', 'what_would_flip', 'challenge_assumption'] as ActionName[],
    });
    const chips = buildDeterministicChips(ctx);

    const top3 = chips.map((c) => c.action_type);
    // run_analysis should NOT be in top 3 post-analysis
    expect(top3).not.toContain('run_analysis');
    // explain_result, compare_options, what_would_flip should be present
    expect(top3).toContain('explain_result');
    expect(top3).toContain('compare_options');
  });

  it("post-analysis chips include explain_result, compare_options, what_would_flip", () => {
    const ctx = makeTurnContext({
      capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: false },
      eligible_actions: ['run_analysis', 'explain_result', 'compare_options', 'what_would_flip', 'challenge_assumption', 'set_factor_value'] as ActionName[],
    });
    const chips = buildDeterministicChips(ctx);

    const top3 = chips.map((c) => c.action_type);
    expect(top3).toContain('explain_result');
    expect(top3).toContain('compare_options');
    expect(top3).toContain('what_would_flip');
  });

  it("pre-analysis chips still include run_analysis (regression)", () => {
    const ctx = makeTurnContext({
      analysis_summary: null,
      capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
      eligible_actions: ['run_analysis', 'set_factor_value', 'add_factor'] as ActionName[],
    });
    const chips = buildDeterministicChips(ctx);

    const top3 = chips.map((c) => c.action_type);
    expect(top3).toContain('run_analysis');
    // Should be first due to boost when !analysis_summary
    expect(top3[0]).toBe('run_analysis');
  });

  it("stale analysis (model changed) still shows run_analysis", () => {
    // Stale = analysis_summary is null (model changed since last analysis) but can_explain is false
    const ctx = makeTurnContext({
      analysis_summary: null,
      capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
      eligible_actions: ['run_analysis', 'set_factor_value', 'add_factor'] as ActionName[],
    });
    const chips = buildDeterministicChips(ctx);

    expect(chips[0].action_type).toBe('run_analysis');
  });
});
