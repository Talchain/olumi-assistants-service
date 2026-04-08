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

  // ====================================================================
  // Stage-aware chip filtering
  // ====================================================================

  describe("stage-aware filtering", () => {
    it("frame stage: filters out compare_options, preserves add_factor", () => {
      const ctx = makeTurnContext({
        stage: 'frame',
        analysis_summary: null,
        eligible_actions: ['compare_options', 'add_factor'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx);
      const names = chips.map((c) => c.action_type);
      expect(names).not.toContain('compare_options');
      // Positive assertion: graph-building chip survives in frame
      expect(names).toContain('add_factor');
    });

    it("ideate stage: filters out explain_result, preserves add_factor", () => {
      const ctx = makeTurnContext({
        stage: 'ideate',
        eligible_actions: ['explain_result', 'add_factor', 'set_factor_value'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx);
      const names = chips.map((c) => c.action_type);
      expect(names).not.toContain('explain_result');
      expect(names).toContain('add_factor');
    });

    it("evaluate stage: filters out add_factor, preserves explain_result", () => {
      const ctx = makeTurnContext({
        stage: 'evaluate',
        eligible_actions: ['add_factor', 'explain_result'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx);
      const names = chips.map((c) => c.action_type);
      expect(names).not.toContain('add_factor');
      expect(names).toContain('explain_result');
    });

    it("decide stage: filters out add_factor, preserves compare_options", () => {
      const ctx = makeTurnContext({
        stage: 'decide',
        eligible_actions: ['add_factor', 'compare_options', 'set_factor_value'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx);
      const names = chips.map((c) => c.action_type);
      expect(names).not.toContain('add_factor');
      expect(names).not.toContain('set_factor_value');
      expect(names).toContain('compare_options');
    });

    it("unknown stage skips filtering (passes everything through)", () => {
      const ctx = makeTurnContext({
        // optimise has no entry in STAGE_ALLOWED_ACTIONS — filter is skipped
        stage: 'optimise' as never,
        eligible_actions: ['explain_result', 'add_factor'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx);
      const names = chips.map((c) => c.action_type);
      expect(names).toContain('explain_result');
      expect(names).toContain('add_factor');
    });
  });

  // ====================================================================
  // Deferred actions (compound action acknowledgement)
  // ====================================================================

  describe("deferred actions (compound action acknowledgement)", () => {
    it("no deferred actions: chip list is unchanged", () => {
      const ctx = makeTurnContext();
      const before = buildDeterministicChips(ctx, null, []);
      const after = buildDeterministicChips(ctx);
      expect(before.map((c) => c.action_type)).toEqual(after.map((c) => c.action_type));
    });

    it("one deferred action surfaces as the top chip", () => {
      const ctx = makeTurnContext({
        stage: 'evaluate',
        eligible_actions: ['explain_result', 'compare_options'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx, 'explain_result', ['what_would_flip'] as ActionName[]);
      expect(chips[0].action_type).toBe('what_would_flip');
    });

    it("only the first deferred action is promoted (MAX_DEFERRED_CHIPS = 1)", () => {
      const ctx = makeTurnContext({
        stage: 'evaluate',
        eligible_actions: ['compare_options'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx, 'explain_result', ['what_would_flip', 'challenge_assumption'] as ActionName[]);
      const names = chips.map((c) => c.action_type);
      // First deferred promoted to slot 0
      expect(names[0]).toBe('what_would_flip');
      // Second deferred NOT promoted (cap = 1); slot filled by proactive chip
      expect(names).not.toContain('challenge_assumption');
      // Total chip count still ≤ 3
      expect(chips.length).toBeLessThanOrEqual(3);
    });

    it("deferred action that was already executed this turn is not promoted", () => {
      const ctx = makeTurnContext({
        stage: 'evaluate',
        eligible_actions: ['explain_result', 'compare_options'] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx, 'explain_result', ['explain_result'] as ActionName[]);
      const names = chips.map((c) => c.action_type);
      expect(names).not.toContain('explain_result');
    });

    it("deferred action overrides stage filter (LLM intent wins)", () => {
      const ctx = makeTurnContext({
        stage: 'frame',
        analysis_summary: null,
        eligible_actions: [] as ActionName[],
      });
      const chips = buildDeterministicChips(ctx, null, ['compare_options'] as ActionName[]);
      const names = chips.map((c) => c.action_type);
      expect(names).toContain('compare_options');
    });
  });
});
