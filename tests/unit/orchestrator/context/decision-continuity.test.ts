import { describe, it, expect } from "vitest";
import { buildDecisionContinuity } from "../../../../src/orchestrator/context/decision-continuity.js";
import type { DecisionContinuityInput } from "../../../../src/orchestrator/context/decision-continuity.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../../../src/orchestrator/context/analysis-compact.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeMinimalInput(overrides?: Partial<DecisionContinuityInput>): DecisionContinuityInput {
  return { ...overrides };
}

function makeCompactGraph(): GraphV3Compact {
  return {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Achieve £20k MRR", source: "user" },
      { id: "opt_a", kind: "option", label: "Increase Price to £59", source: "user" },
      { id: "opt_b", kind: "option", label: "Keep Price at £49 (Status Quo)", source: "user" },
      { id: "factor_1", kind: "factor", label: "Churn Rate", source: "assumption", value: 0.05 },
      { id: "factor_2", kind: "factor", label: "New Customer Acquisition", source: "system" },
    ],
    edges: [
      { from: "opt_a", to: "factor_1", strength: 0.8, exists: 0.9 },
      { from: "factor_1", to: "goal_1", strength: 0.7, exists: 0.4 }, // low exists → uncertain
      { from: "factor_2", to: "goal_1", strength: 0.6, exists: 0.85 },
    ],
    _node_count: 5,
    _edge_count: 3,
  };
}

function makeAnalysisSummary(): AnalysisResponseSummary {
  return {
    winner: { option_id: "opt_a", option_label: "Increase Price to £59", win_probability: 0.65 },
    options: [
      { option_id: "opt_a", option_label: "Increase Price to £59", win_probability: 0.65, outcome_mean: 0.6 },
      { option_id: "opt_b", option_label: "Keep Price at £49", win_probability: 0.35, outcome_mean: 0.3 },
    ],
    top_drivers: [
      { factor_id: "f1", factor_label: "Pro Plan Price Level", sensitivity: 0.8, direction: "positive" },
      { factor_id: "f2", factor_label: "New Customer Acquisition Rate", sensitivity: 0.6, direction: "positive" },
      { factor_id: "f3", factor_label: "Churn Response to Price Increase", sensitivity: 0.4, direction: "negative" },
      { factor_id: "f4", factor_label: "Market Elasticity", sensitivity: 0.2, direction: "negative" },
    ],
    robustness_level: "moderate",
    fragile_edge_count: 1,
    analysis_status: "ok",
  };
}

// ============================================================================
// Tests: minimal context (no graph, no analysis)
// ============================================================================

describe("buildDecisionContinuity — minimal context", () => {
  it("returns valid object without throwing when context is empty", () => {
    const result = buildDecisionContinuity(makeMinimalInput());
    expect(result).toBeDefined();
    expect(result.goal).toBeNull();
    expect(result.options).toEqual([]);
    expect(result.constraints).toEqual([]);
    expect(result.top_drivers).toEqual([]);
    expect(result.top_uncertainties).toEqual([]);
    expect(result.last_patch_summary).toBeNull();
    expect(result.active_proposal).toBeNull();
    expect(result.assumption_count).toBe(0);
  });

  it("uses framing.stage when present", () => {
    const result = buildDecisionContinuity(makeMinimalInput({
      framing: { stage: "evaluate" },
    }));
    expect(result.stage).toBe("evaluate");
  });

  it("defaults stage to 'explore' when framing absent", () => {
    const result = buildDecisionContinuity(makeMinimalInput());
    expect(result.stage).toBe("explore");
  });

  it("returns analysis_status 'none' with no analysis", () => {
    const result = buildDecisionContinuity(makeMinimalInput());
    expect(result.analysis_status).toBe("none");
  });

  it("uses framing.goal when no graph present", () => {
    const result = buildDecisionContinuity(makeMinimalInput({
      framing: { stage: "explore", goal: "Grow MRR to £50k" },
    }));
    expect(result.goal).toBe("Grow MRR to £50k");
  });

  it("uses framing.options when no graph present", () => {
    const result = buildDecisionContinuity(makeMinimalInput({
      framing: { stage: "explore", options: ["Option A", "Option B"] },
    }));
    expect(result.options).toEqual(["Option A", "Option B"]);
  });
});

// ============================================================================
// Tests: rich context (graph + analysis + constraints)
// ============================================================================

describe("buildDecisionContinuity — rich context", () => {
  it("derives goal from graph goal node label", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      analysis_response: makeAnalysisSummary(),
      framing: { stage: "evaluate", goal: "Different goal from framing" },
    });
    // Graph goal node takes precedence
    expect(result.goal).toBe("Achieve £20k MRR");
  });

  it("derives options from graph option nodes", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
    });
    expect(result.options).toContain("Increase Price to £59");
    expect(result.options).toContain("Keep Price at £49 (Status Quo)");
  });

  it("derives top_drivers from analysis (top 3)", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      analysis_response: makeAnalysisSummary(),
    });
    expect(result.top_drivers).toHaveLength(3);
    expect(result.top_drivers[0]).toBe("Pro Plan Price Level");
    expect(result.top_drivers[1]).toBe("New Customer Acquisition Rate");
    expect(result.top_drivers[2]).toBe("Churn Response to Price Increase");
  });

  it("derives top_uncertainties from edges with low exists_probability", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
    });
    // factor_1 has an edge with exists=0.4 (lowest) → should appear in uncertainties
    expect(result.top_uncertainties).toContain("Churn Rate");
  });

  it("counts assumption nodes correctly", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
    });
    // Only factor_1 has source=assumption
    expect(result.assumption_count).toBe(1);
  });

  it("derives constraints from framing.constraints", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      framing: { stage: "evaluate", constraints: ["Max churn < 5%", "Revenue > £15k"] },
    });
    expect(result.constraints).toEqual(["Max churn < 5%", "Revenue > £15k"]);
  });

  it("derives constraints from conversational_state.stated_constraints when framing absent", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      conversational_state: {
        stated_constraints: [
          { label: "Constraint from state A" },
          { label: "Constraint from state B" },
        ],
      },
    });
    expect(result.constraints).toEqual(["Constraint from state A", "Constraint from state B"]);
  });
});

// ============================================================================
// Tests: analysis_status
// ============================================================================

describe("buildDecisionContinuity — analysis_status", () => {
  it("returns 'none' when analysis_response is absent", () => {
    const result = buildDecisionContinuity({
      graph: { hash: "abc123" },
    });
    expect(result.analysis_status).toBe("none");
  });

  it("returns 'stale' when graph hash differs from analysis source hash", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      analysis_response: makeAnalysisSummary(),
      graph: { hash: "current_hash" },
      analysis: { graph_hash: "old_hash" },
    });
    expect(result.analysis_status).toBe("stale");
  });

  it("returns 'current' when hashes match", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      analysis_response: makeAnalysisSummary(),
      graph: { hash: "same_hash" },
      analysis: { graph_hash: "same_hash" },
    });
    expect(result.analysis_status).toBe("current");
  });

  it("returns 'current' when comparison is not possible (no hashes)", () => {
    const result = buildDecisionContinuity({
      graph_compact: makeCompactGraph(),
      analysis_response: makeAnalysisSummary(),
      graph: { someField: "no hash here" },
      analysis: { someOtherField: "no graph_hash" },
    });
    // Graceful default — cannot compare → current
    expect(result.analysis_status).toBe("current");
  });
});

// ============================================================================
// Tests: last_patch_summary and active_proposal
// ============================================================================

describe("buildDecisionContinuity — patch summary and proposal", () => {
  it("extracts last_patch_summary from most recent graph_patch block", () => {
    const result = buildDecisionContinuity({
      conversation_history: [
        {
          role: "assistant",
          blocks: [{ type: "graph_patch", data: { summary: "Added churn factor node" } }],
        },
        {
          role: "user",
          content: "What does this mean?",
        },
      ],
    });
    expect(result.last_patch_summary).toBe("Added churn factor node");
  });

  it("returns null for last_patch_summary when no graph_patch blocks", () => {
    const result = buildDecisionContinuity({
      conversation_history: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });
    expect(result.last_patch_summary).toBeNull();
  });

  it("derives active_proposal from pending_proposal", () => {
    const result = buildDecisionContinuity({
      conversational_state: {
        stated_constraints: [],
        pending_proposal: { original_edit_request: "Raise price to £59" },
      },
    });
    expect(result.active_proposal).toBe("Raise price to £59");
  });

  it("derives active_proposal from pending_clarification when no proposal", () => {
    const result = buildDecisionContinuity({
      conversational_state: {
        stated_constraints: [],
        pending_clarification: { original_edit_request: "Update the churn factor" },
      },
    });
    expect(result.active_proposal).toBe("Update the churn factor");
  });
});
