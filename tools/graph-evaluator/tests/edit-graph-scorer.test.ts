import { describe, it, expect } from "vitest";
import { scoreEditGraph } from "../src/edit-graph-scorer.js";
import type { EditGraphFixture, ParsedGraph } from "../src/types.js";

// =============================================================================
// Minimal starting graph for tests
// =============================================================================

function minimalGraph(): ParsedGraph {
  return {
    nodes: [
      { id: "dec1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A", data: { interventions: { fac_ctrl: 0.8 } } },
      { id: "opt_b", kind: "option", label: "Option B", data: { interventions: { fac_ctrl: 0.2 } } },
      { id: "fac_ctrl", kind: "factor", label: "Controllable", category: "controllable" },
      { id: "fac_ext", kind: "factor", label: "External", category: "external" },
      { id: "out1", kind: "outcome", label: "Revenue" },
      { id: "risk1", kind: "risk", label: "Risk" },
      { id: "goal1", kind: "goal", label: "Goal" },
    ],
    edges: [
      { from: "dec1", to: "opt_a", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "dec1", to: "opt_b", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "opt_a", to: "fac_ctrl", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "opt_b", to: "fac_ctrl", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "fac_ctrl", to: "out1", strength: { mean: 0.6, std: 0.12 }, exists_probability: 0.9, effect_direction: "positive" },
      { from: "fac_ext", to: "risk1", strength: { mean: 0.4, std: 0.2 }, exists_probability: 0.75, effect_direction: "positive" },
      { from: "out1", to: "goal1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.95, effect_direction: "positive" },
      { from: "risk1", to: "goal1", strength: { mean: -0.3, std: 0.15 }, exists_probability: 0.85, effect_direction: "negative" },
    ],
  };
}

function makeFixture(overrides: Partial<EditGraphFixture> = {}): EditGraphFixture {
  return {
    id: "test",
    name: "Test fixture",
    description: "Test",
    graph: minimalGraph(),
    edit_instruction: "Test edit",
    expected: {
      has_operations: true,
      expected_op_types: ["add_node"],
      topology_must_hold: true,
      expect_rerun: true,
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("edit-graph-scorer", () => {
  it("scores a valid response correctly", () => {
    const fixture = makeFixture();
    const parsed = {
      operations: [
        {
          op_type: "add_node",
          path: "/nodes/fac_new",
          value: { id: "fac_new", kind: "factor", label: "New Factor", category: "external" },
          impact: "Adds uncertainty dimension",
          rationale: "Brief mentions market volatility",
        },
        {
          op_type: "add_edge",
          path: "/edges/fac_new->out1",
          value: { from: "fac_new", to: "out1", strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.7, effect_direction: "positive" },
          impact: "New factor influences revenue",
          rationale: "Market volatility affects revenue outcomes",
        },
      ],
      warnings: [],
      coaching: { summary: "Added market volatility factor.", rerun_recommended: true },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.valid_json).toBe(true);
    expect(result.correct_shape).toBe(true);
    expect(result.operation_types_correct).toBe(true);
    expect(result.topology_compliant).toBe(true);
    expect(result.has_impact_rationale).toBe(true);
    expect(result.correct_ordering).toBe(true);
    expect(result.coaching_present).toBe(true);
    expect(result.path_syntax_valid).toBe(true);
    expect(result.overall).toBeGreaterThan(0.9);
  });

  it("scores empty operations response correctly when expected", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: false,
        topology_must_hold: true,
        expect_warning_substrings: ["already"],
        expect_rerun: false,
      },
    });

    const parsed = {
      operations: [],
      warnings: ["The relationship already exists in the graph."],
      coaching: { summary: "No changes needed.", rerun_recommended: false },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.operation_types_correct).toBe(true);
    expect(result.empty_ops_handled).toBe(true);
    expect(result.coaching_present).toBe(true);
    expect(result.overall).toBeGreaterThan(0.8);
  });

  it("detects forbidden edge in operations", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["add_edge"],
        topology_must_hold: true,
        expect_rerun: true,
      },
    });

    const parsed = {
      operations: [
        {
          op_type: "add_edge",
          path: "/edges/fac_ctrl->goal1",
          value: { from: "fac_ctrl", to: "goal1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
          impact: "Direct factor to goal",
          rationale: "Shortcut path",
        },
      ],
      warnings: [],
      coaching: { summary: "Added direct path.", rerun_recommended: true },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.topology_compliant).toBe(false);
  });

  it("detects cycle-creating add_edge", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["add_edge"],
        topology_must_hold: true,
        expect_rerun: true,
      },
    });

    // out1 -> fac_ctrl creates a cycle: fac_ctrl -> out1 -> fac_ctrl
    const parsed = {
      operations: [
        {
          op_type: "add_edge",
          path: "/edges/out1->fac_ctrl",
          value: { from: "out1", to: "fac_ctrl", strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive" },
          impact: "Feedback loop",
          rationale: "Revenue feeds back to investment",
        },
      ],
      warnings: [],
      coaching: { summary: "Added feedback.", rerun_recommended: true },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.topology_compliant).toBe(false);
  });

  it("detects operation targeting nonexistent node", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["update_node"],
        topology_must_hold: true,
        expect_rerun: false,
      },
    });

    const parsed = {
      operations: [
        {
          op_type: "update_node",
          path: "/nodes/fac_nonexistent",
          value: { label: "New Label" },
          impact: "Renames factor",
          rationale: "User requested rename",
        },
      ],
      warnings: [],
      coaching: { summary: "Renamed.", rerun_recommended: false },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.topology_compliant).toBe(false);
  });

  it("detects self-loop in proposed edge", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["add_edge"],
        topology_must_hold: true,
        expect_rerun: true,
      },
    });

    const parsed = {
      operations: [
        {
          op_type: "add_edge",
          path: "/edges/out1->out1",
          value: { from: "out1", to: "out1", strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive" },
          impact: "Self-reinforcing",
          rationale: "Revenue amplifies",
        },
      ],
      warnings: [],
      coaching: { summary: "Self-loop.", rerun_recommended: true },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.topology_compliant).toBe(false);
  });

  it("returns zero score for null parsed response", () => {
    const fixture = makeFixture();
    const result = scoreEditGraph(fixture, null);
    expect(result.valid_json).toBe(false);
    expect(result.overall).toBe(0);
  });

  it("recognises remove_edge + add_edge as functional equivalent of update_edge", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["update_edge"],
        topology_must_hold: true,
        expect_rerun: true,
      },
    });

    // Model uses remove_edge + add_edge on same path instead of update_edge
    const parsed = {
      operations: [
        {
          op_type: "remove_edge",
          path: "/edges/fac_ctrl->out1",
          impact: "Remove old edge",
          rationale: "Replacing with stronger edge",
        },
        {
          op_type: "add_edge",
          path: "/edges/fac_ctrl->out1",
          value: { from: "fac_ctrl", to: "out1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 0.95, effect_direction: "positive" },
          impact: "Strengthened edge",
          rationale: "User requested stronger relationship",
        },
      ],
      warnings: [],
      coaching: { summary: "Strengthened the edge.", rerun_recommended: true },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.operation_types_correct).toBe(true);
  });

  it("recognises remove_node + add_node as functional equivalent of update_node", () => {
    const fixture = makeFixture({
      expected: {
        has_operations: true,
        expected_op_types: ["update_node"],
        topology_must_hold: true,
        expect_rerun: false,
      },
    });

    // Model uses remove_node + add_node on same id instead of update_node
    const parsed = {
      operations: [
        {
          op_type: "remove_node",
          path: "/nodes/fac_ctrl",
          impact: "Remove old node",
          rationale: "Replacing with renamed node",
        },
        {
          op_type: "add_node",
          path: "/nodes/fac_ctrl",
          value: { id: "fac_ctrl", kind: "factor", label: "Market Competition", category: "controllable" },
          impact: "Renamed node",
          rationale: "User requested rename",
        },
      ],
      warnings: [],
      coaching: { summary: "Renamed the factor.", rerun_recommended: false },
    };

    const result = scoreEditGraph(fixture, parsed as Record<string, unknown>);
    expect(result.operation_types_correct).toBe(true);
  });
});
