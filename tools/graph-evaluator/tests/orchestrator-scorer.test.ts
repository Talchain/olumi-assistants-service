import { describe, it, expect } from "vitest";
import { scoreOrchestrator } from "../src/orchestrator-scorer.js";
import type { OrchestratorFixture, TurnContext } from "../src/types.js";

// =============================================================================
// Fixture factory
// =============================================================================

function makeTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    scenario_id: "test",
    turn_id: "t1",
    stage: "evaluate",
    entities: {
      decisions: [],
      options: [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      factors: [
        { id: "fac_cost", label: "Implementation Cost", category: "observable" },
        { id: "fac_adoption", label: "User Adoption Rate", category: "observable" },
      ],
      outcomes: [],
      risks: [],
      goals: [{ id: "goal_rev", label: "Revenue" }],
      edges: [
        { from: "fac_cost", to: "goal_rev", strength_mean: 0.5, exists_probability: 0.9 },
      ],
      constraints: [],
    },
    graph: { node_count: 5, edge_count: 1, option_count: 2, missing_structural: [] },
    analysis: {
      status: "completed",
      staleness_reason: null,
      winner: { id: "opt_a", label: "Option A", probability: 0.55 },
      runner_up: { id: "opt_b", label: "Option B", probability: 0.45 },
      robustness_band: "fragile",
      top_drivers: [
        { id: "fac_cost", label: "Implementation Cost", sensitivity: 0.35 },
      ],
      fragile_edges: [],
      constraints_met: null,
    },
    capabilities: {
      can_run_analysis: true,
      can_explain_results: true,
      can_edit_graph: true,
      can_compare_options: true,
      can_generate_artefact: false,
      disabled_reasons: {},
    },
    blockers: [],
    signals: {
      high_uncertainty_factors: [],
      dominant_factor: null,
      close_call: true,
      missing_option_families: [],
      default_value_count: 0,
      weak_edges: [],
    },
    conversation: {
      turn_count: 1,
      last_user_intent: null,
      last_tool_used: null,
      recent_actions_taken: [],
      recent_actions_declined: [],
      pending_confirmation: null,
      last_failed_action: null,
    },
    eligible_actions: ["explain_result", "compare_options", "set_factor_value", "run_analysis"],
    ...overrides,
  };
}

function makeFixture(
  expectedOverrides: Partial<OrchestratorFixture["expected"]> = {},
  ctxOverrides: Partial<TurnContext> = {}
): OrchestratorFixture {
  return {
    id: "test",
    name: "Test",
    description: "Test",
    stage: "evaluate",
    user_message: "Test message",
    turn_context: makeTurnContext(ctxOverrides),
    expected: {
      expects_uncertainty_language: false,
      ...expectedOverrides,
    },
  };
}

const PERFECT_RESPONSE = JSON.stringify({
  text: "Option A leads at 55%, based on current assumptions. The key driver is Implementation Cost at 35% sensitivity. I recommend calibrating that value before committing.",
  insights: [
    {
      type: "assumption_risk",
      description: "Implementation Cost drives 35% of the outcome and may use a default value.",
      severity: "warning",
      target_id: "fac_cost",
    },
  ],
  recommended_actions: [
    {
      action_type: "set_factor_value",
      target_id: "fac_cost",
      parameters: {},
      priority: "high",
      rationale: "Top driver uses a potentially uncalibrated value",
    },
  ],
});

// =============================================================================
// Tests
// =============================================================================

describe("scoreOrchestrator", () => {
  it("returns 0 for null input", () => {
    const result = scoreOrchestrator(makeFixture(), null);
    expect(result.overall).toBe(0);
    expect(result.valid_json).toBe(false);
  });

  it("returns 0 for empty string", () => {
    const result = scoreOrchestrator(makeFixture(), "");
    expect(result.overall).toBe(0);
  });

  it("scores a well-formed JSON response highly", () => {
    const fixture = makeFixture();
    const result = scoreOrchestrator(fixture, PERFECT_RESPONSE);
    expect(result.valid_json).toBe(true);
    expect(result.text_quality).toBe(true);
    expect(result.insight_compliance).toBe(true);
    expect(result.action_eligibility).toBe(true);
    expect(result.banned_terms).toBe(true);
    expect(result.overall).toBeGreaterThan(0.9);
  });

  it("fails valid_json when response is not JSON", () => {
    const result = scoreOrchestrator(makeFixture(), "This is plain text, not JSON.");
    expect(result.valid_json).toBe(false);
    expect(result.overall).toBe(0);
  });

  it("fails valid_json when extra keys present", () => {
    const raw = JSON.stringify({
      text: "Hello.",
      insights: [],
      recommended_actions: [],
      extra_key: "should not be here",
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.valid_json).toBe(false);
  });

  it("detects banned terms in text", () => {
    const raw = JSON.stringify({
      text: "The canonical_state shows high factor_sensitivity values.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.banned_terms).toBe(false);
  });

  it("detects banned filler phrases", () => {
    const raw = JSON.stringify({
      text: "Great question! Option A leads at 55%.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.banned_terms).toBe(false);
  });

  it("passes banned terms when text is clean", () => {
    const raw = JSON.stringify({
      text: "Option A leads at 55%, based on your model assumptions.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.banned_terms).toBe(true);
  });

  it("uses word-boundary matching for short terms", () => {
    // "voi" should not match inside "avoids"
    const raw = JSON.stringify({
      text: "This approach avoids the main risk.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.banned_terms).toBe(true);
  });

  it("fails action_eligibility when action_type not in eligible_actions", () => {
    const raw = JSON.stringify({
      text: "Let me draft your model.",
      insights: [],
      recommended_actions: [
        {
          action_type: "draft_graph",
          priority: "high",
          rationale: "Need to build the model",
        },
      ],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.action_eligibility).toBe(false);
  });

  it("fails action_eligibility when target_id not in entities", () => {
    const raw = JSON.stringify({
      text: "Let me update the value.",
      insights: [],
      recommended_actions: [
        {
          action_type: "set_factor_value",
          target_id: "fac_nonexistent",
          priority: "high",
          rationale: "Update needed",
        },
      ],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.action_eligibility).toBe(false);
  });

  it("fails insight_compliance with more than 3 insights", () => {
    const raw = JSON.stringify({
      text: "Multiple observations.",
      insights: [
        { type: "assumption_risk", description: "A", severity: "info" },
        { type: "assumption_risk", description: "B", severity: "info" },
        { type: "assumption_risk", description: "C", severity: "info" },
        { type: "assumption_risk", description: "D", severity: "info" },
      ],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.insight_compliance).toBe(false);
  });

  it("fails insight_compliance with invalid type", () => {
    const raw = JSON.stringify({
      text: "An observation.",
      insights: [
        { type: "invalid_type", description: "Something", severity: "info" },
      ],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.insight_compliance).toBe(false);
  });

  it("checks forbidden phrases in text", () => {
    const raw = JSON.stringify({
      text: "It is definitely the best choice.",
      insights: [],
      recommended_actions: [],
    });
    const fixture = makeFixture({ forbidden_phrases: ["definitely"] });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.banned_terms).toBe(false);
  });

  it("checks must_contain substrings", () => {
    const raw = JSON.stringify({
      text: "Your goal and option space look well defined.",
      insights: [],
      recommended_actions: [],
    });
    const fixture = makeFixture({ must_contain: ["goal", "option"] });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.scenario_specific).toBe(true);
  });

  it("fails scenario_specific when must_contain missing", () => {
    const raw = JSON.stringify({
      text: "The analysis is complete.",
      insights: [],
      recommended_actions: [],
    });
    const fixture = makeFixture({ must_contain: ["churn"] });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.scenario_specific).toBe(false);
  });

  it("evaluates scenario_assertions correctly", () => {
    const raw = JSON.stringify({
      text: "You need at least two options. I recommend adding them.",
      insights: [],
      recommended_actions: [
        {
          action_type: "set_factor_value",
          priority: "high",
          rationale: "Calibrate the value",
        },
      ],
    });
    const fixture = makeFixture({
      scenario_assertions: [
        { description: "Must not recommend draft_graph", check: "action_type_absent", value: "draft_graph" },
        { description: "Must have at least one action", check: "min_actions", value: 1 },
      ],
    });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.scenario_specific).toBe(true);
  });

  it("text_quality fails on markdown headers", () => {
    const raw = JSON.stringify({
      text: "# Analysis Summary\nOption A leads.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.text_quality).toBe(false);
  });

  it("text_quality fails on em dashes", () => {
    const raw = JSON.stringify({
      text: "Option A leads \u2014 it captures more upside.",
      insights: [],
      recommended_actions: [],
    });
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.text_quality).toBe(false);
  });

  it("handles markdown-fenced JSON", () => {
    const raw = "```json\n" + JSON.stringify({
      text: "Option A leads at 55%.",
      insights: [],
      recommended_actions: [],
    }) + "\n```";
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.valid_json).toBe(true);
  });
});
