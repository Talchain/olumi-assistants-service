/**
 * Source-of-truth contract test for POST_ANALYSIS_EXPLANATION_ACTIONS.
 *
 * Pins the membership of the policy set and verifies that the public
 * predicate exported from tool-builder consumes the same set, so a future
 * maintainer can't silently re-define it in a third location.
 */

import { describe, it, expect } from "vitest";
import { POST_ANALYSIS_EXPLANATION_ACTIONS } from "../../../../src/orchestrator/deterministic/post-analysis-policy.js";
import { isExplanationChipSuppressedByAnalysis } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import type { DeterministicTurnContext, AnalysisSummary } from "../../../../src/orchestrator/deterministic/types.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

const EXPECTED_MEMBERS: readonly ActionName[] = [
  'explain_result',
  'compare_options',
  'what_would_flip',
];

function makeAnalysisSummary(): AnalysisSummary {
  return {
    winner: 'option_a',
    winner_probability: 0.65,
    runner_up: 'option_b',
    runner_up_probability: 0.35,
    robustness_band: 'moderate',
    top_drivers: [],
    fragile_edge_count: 0,
    fragile_edges: [],
    factor_sensitivity: [],
    edge_e_values: [],
    conditional_winners: [],
    inference_warnings: [],
    constraints_met: true,
    constraint_tensions: [],
  };
}

function makeCtx(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 3, edge_count: 2, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Goal', missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
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

describe("POST_ANALYSIS_EXPLANATION_ACTIONS (policy module)", () => {
  it("pins exact membership of the explanation-suppression set", () => {
    expect(POST_ANALYSIS_EXPLANATION_ACTIONS.size).toBe(EXPECTED_MEMBERS.length);
    for (const member of EXPECTED_MEMBERS) {
      expect(POST_ANALYSIS_EXPLANATION_ACTIONS.has(member)).toBe(true);
    }
  });

  it("does NOT contain run_analysis (run_analysis is suppressed by a separate staleness rule, not this policy)", () => {
    expect(POST_ANALYSIS_EXPLANATION_ACTIONS.has('run_analysis')).toBe(false);
  });
});

describe("isExplanationChipSuppressedByAnalysis (tool-builder predicate)", () => {
  it("uses the same set as POST_ANALYSIS_EXPLANATION_ACTIONS — every member is suppressed when analysis is present", () => {
    const ctxWithAnalysis = makeCtx({ analysis_summary: makeAnalysisSummary() });
    for (const member of POST_ANALYSIS_EXPLANATION_ACTIONS) {
      expect(isExplanationChipSuppressedByAnalysis(member, ctxWithAnalysis)).toBe(true);
    }
  });

  it("returns false for members of the set when analysis is absent", () => {
    const ctxNoAnalysis = makeCtx({ analysis_summary: null });
    for (const member of POST_ANALYSIS_EXPLANATION_ACTIONS) {
      expect(isExplanationChipSuppressedByAnalysis(member, ctxNoAnalysis)).toBe(false);
    }
  });

  it("returns false for non-members even when analysis is present", () => {
    const ctxWithAnalysis = makeCtx({ analysis_summary: makeAnalysisSummary() });
    const nonMembers: ActionName[] = ['run_analysis', 'add_factor', 'set_factor_value', 'challenge_assumption'];
    for (const action of nonMembers) {
      expect(isExplanationChipSuppressedByAnalysis(action, ctxWithAnalysis)).toBe(false);
    }
  });
});
