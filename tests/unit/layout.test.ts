/**
 * Deterministic Layout Algorithm Tests
 *
 * Verifies topology-aware positioning, determinism, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { generateDeterministicLayout, generateLegacyLayout } from "../../src/utils/layout.js";
import type { NodeT, EdgeT } from "../../src/schemas/graph.js";

describe("generateDeterministicLayout", () => {
  it("should handle empty graph", () => {
    const positions = generateDeterministicLayout([], [], []);
    expect(positions).toEqual({});
  });

  it("should position single node at origin layer", () => {
    const nodes: NodeT[] = [{ id: "goal_1", kind: "goal", label: "Root Goal" }];
    const positions = generateDeterministicLayout(nodes, [], ["goal_1"]);

    expect(positions).toHaveProperty("goal_1");
    expect(positions.goal_1.y).toBe(80); // START_Y
    expect(positions.goal_1.x).toBeGreaterThan(0);
  });

  it("should layer nodes based on edges (parent-child hierarchy)", () => {
    const nodes: NodeT[] = [
      { id: "goal_1", kind: "goal", label: "Root" },
      { id: "decision_1", kind: "decision", label: "Choose" },
      { id: "option_1", kind: "option", label: "Option A" },
    ];

    const edges: EdgeT[] = [
      { from: "goal_1", to: "decision_1" },
      { from: "decision_1", to: "option_1" },
    ];

    const positions = generateDeterministicLayout(nodes, edges, ["goal_1"]);

    // Verify vertical layering (y-coordinates should increase down the hierarchy)
    expect(positions.goal_1.y).toBeLessThan(positions.decision_1.y);
    expect(positions.decision_1.y).toBeLessThan(positions.option_1.y);

    // Verify layer spacing (LAYER_HEIGHT = 150)
    expect(positions.decision_1.y - positions.goal_1.y).toBe(150);
    expect(positions.option_1.y - positions.decision_1.y).toBe(150);
  });

  it("should be deterministic (same input yields same output)", () => {
    const nodes: NodeT[] = [
      { id: "b", kind: "goal" },
      { id: "a", kind: "decision" },
      { id: "c", kind: "option" },
    ];

    const edges: EdgeT[] = [
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ];

    const roots = ["a", "b"];

    const positions1 = generateDeterministicLayout(nodes, edges, roots);
    const positions2 = generateDeterministicLayout(nodes, edges, roots);

    expect(positions1).toEqual(positions2);
  });

  it("should sort nodes alphabetically within same layer", () => {
    const nodes: NodeT[] = [
      { id: "goal_3", kind: "goal" },
      { id: "goal_1", kind: "goal" },
      { id: "goal_2", kind: "goal" },
    ];

    const edges: EdgeT[] = [];
    const roots = ["goal_3", "goal_1", "goal_2"];

    const positions = generateDeterministicLayout(nodes, edges, roots);

    // All should be on same layer (y = 80)
    expect(positions.goal_1.y).toBe(80);
    expect(positions.goal_2.y).toBe(80);
    expect(positions.goal_3.y).toBe(80);

    // Sorted alphabetically, so x-coordinates should be: goal_1 < goal_2 < goal_3
    expect(positions.goal_1.x).toBeLessThan(positions.goal_2.x);
    expect(positions.goal_2.x).toBeLessThan(positions.goal_3.x);
  });

  it("should handle multiple roots on same layer", () => {
    const nodes: NodeT[] = [
      { id: "goal_a", kind: "goal" },
      { id: "goal_b", kind: "goal" },
    ];

    const edges: EdgeT[] = [];
    const roots = ["goal_a", "goal_b"];

    const positions = generateDeterministicLayout(nodes, edges, roots);

    // Both roots on layer 0
    expect(positions.goal_a.y).toBe(80);
    expect(positions.goal_b.y).toBe(80);

    // Horizontally separated
    expect(Math.abs(positions.goal_a.x - positions.goal_b.x)).toBeGreaterThan(100);
  });

  it("should handle diamond pattern (multiple paths to same node)", () => {
    const nodes: NodeT[] = [
      { id: "root", kind: "goal" },
      { id: "left", kind: "decision" },
      { id: "right", kind: "decision" },
      { id: "leaf", kind: "outcome" },
    ];

    const edges: EdgeT[] = [
      { from: "root", to: "left" },
      { from: "root", to: "right" },
      { from: "left", to: "leaf" },
      { from: "right", to: "leaf" },
    ];

    const positions = generateDeterministicLayout(nodes, edges, ["root"]);

    // Verify layers (longest path determines layer)
    expect(positions.root.y).toBe(80); // Layer 0
    expect(positions.left.y).toBe(230); // Layer 1
    expect(positions.right.y).toBe(230); // Layer 1
    expect(positions.leaf.y).toBe(380); // Layer 2 (longest path = 2 hops)
  });

  it("should handle disconnected nodes (assign to final layer)", () => {
    const nodes: NodeT[] = [
      { id: "connected", kind: "goal" },
      { id: "orphan", kind: "goal" },
    ];

    const edges: EdgeT[] = [];
    const roots = ["connected"];

    const positions = generateDeterministicLayout(nodes, edges, roots);

    // Connected node at layer 0
    expect(positions.connected.y).toBe(80);

    // Disconnected node pushed to layer 1 (max + 1)
    expect(positions.orphan.y).toBe(230);
  });

  it("should handle graphs with no roots specified (find roots automatically)", () => {
    const nodes: NodeT[] = [
      { id: "goal_1", kind: "goal" },
      { id: "decision_1", kind: "decision" },
    ];

    const edges: EdgeT[] = [{ from: "goal_1", to: "decision_1" }];

    // Empty roots - should auto-detect goal_1
    const positions = generateDeterministicLayout(nodes, edges, []);

    expect(positions.goal_1.y).toBe(80); // Layer 0 (auto-detected root)
    expect(positions.decision_1.y).toBe(230); // Layer 1
  });

  it("should center nodes horizontally within canvas", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "goal" },
      { id: "b", kind: "goal" },
      { id: "c", kind: "goal" },
    ];

    const positions = generateDeterministicLayout(nodes, [], ["a", "b", "c"]);

    // All should be on same layer
    expect(positions.a.y).toBe(positions.b.y);
    expect(positions.b.y).toBe(positions.c.y);

    // Should be centered around canvas midpoint (CANVAS_WIDTH = 800)
    const midX = (positions.a.x + positions.b.x + positions.c.x) / 3;
    expect(midX).toBeGreaterThan(300);
    expect(midX).toBeLessThan(500); // Roughly centered
  });

  it("should handle complex graph (6 nodes, 8 edges)", () => {
    const nodes: NodeT[] = [
      { id: "goal", kind: "goal" },
      { id: "dec_1", kind: "decision" },
      { id: "dec_2", kind: "decision" },
      { id: "opt_1", kind: "option" },
      { id: "opt_2", kind: "option" },
      { id: "outcome", kind: "outcome" },
    ];

    const edges: EdgeT[] = [
      { from: "goal", to: "dec_1" },
      { from: "goal", to: "dec_2" },
      { from: "dec_1", to: "opt_1" },
      { from: "dec_1", to: "opt_2" },
      { from: "dec_2", to: "opt_1" },
      { from: "dec_2", to: "opt_2" },
      { from: "opt_1", to: "outcome" },
      { from: "opt_2", to: "outcome" },
    ];

    const positions = generateDeterministicLayout(nodes, edges, ["goal"]);

    // Verify 4 distinct layers
    expect(positions.goal.y).toBe(80);
    expect(positions.dec_1.y).toBe(230);
    expect(positions.dec_2.y).toBe(230);
    expect(positions.opt_1.y).toBe(380);
    expect(positions.opt_2.y).toBe(380);
    expect(positions.outcome.y).toBe(530);

    // Verify all nodes have positions
    expect(Object.keys(positions)).toHaveLength(6);
  });

  it("should handle longest path determination correctly", () => {
    const nodes: NodeT[] = [
      { id: "root", kind: "goal" },
      { id: "mid", kind: "decision" },
      { id: "leaf", kind: "outcome" },
    ];

    const edges: EdgeT[] = [
      { from: "root", to: "mid" },
      { from: "mid", to: "leaf" },
      { from: "root", to: "leaf" }, // Shortcut edge
    ];

    const positions = generateDeterministicLayout(nodes, edges, ["root"]);

    // Leaf should be at layer 2 (longest path = 2 hops via mid)
    expect(positions.root.y).toBe(80); // Layer 0
    expect(positions.mid.y).toBe(230); // Layer 1
    expect(positions.leaf.y).toBe(380); // Layer 2 (not layer 1 from shortcut)
  });

  it("should handle self-loops gracefully (defensive coding)", () => {
    const nodes: NodeT[] = [
      { id: "node_1", kind: "goal" },
      { id: "node_2", kind: "decision" },
    ];

    const edges: EdgeT[] = [
      { from: "node_1", to: "node_1" }, // Self-loop
      { from: "node_1", to: "node_2" },
    ];

    // Should not crash or infinite loop
    const positions = generateDeterministicLayout(nodes, edges, ["node_1"]);

    expect(positions).toHaveProperty("node_1");
    expect(positions).toHaveProperty("node_2");
    expect(positions.node_1.y).toBeLessThanOrEqual(positions.node_2.y);
  });

  it("should maintain x-position spacing between nodes in same layer", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "goal" },
      { id: "b", kind: "goal" },
      { id: "c", kind: "goal" },
      { id: "d", kind: "goal" },
    ];

    const positions = generateDeterministicLayout(nodes, [], ["a", "b", "c", "d"]);

    // All on same layer
    expect(positions.a.y).toBe(positions.b.y);

    // Evenly spaced (NODE_WIDTH = 180)
    expect(positions.b.x - positions.a.x).toBe(180);
    expect(positions.c.x - positions.b.x).toBe(180);
    expect(positions.d.x - positions.c.x).toBe(180);
  });

  it("should work with real decision graph fixture", () => {
    const nodes: NodeT[] = [
      { id: "goal_1", kind: "goal", label: "Migrate to cloud" },
      { id: "decision_1", kind: "decision", label: "Choose provider" },
      { id: "option_1", kind: "option", label: "AWS" },
      { id: "option_2", kind: "option", label: "Azure" },
      { id: "option_3", kind: "option", label: "GCP" },
      { id: "outcome_1", kind: "outcome", label: "Lower costs" },
      { id: "risk_1", kind: "risk", label: "Vendor lock-in" },
    ];

    const edges: EdgeT[] = [
      { from: "goal_1", to: "decision_1" },
      { from: "decision_1", to: "option_1" },
      { from: "decision_1", to: "option_2" },
      { from: "decision_1", to: "option_3" },
      { from: "option_1", to: "outcome_1" },
      { from: "option_2", to: "outcome_1" },
      { from: "option_3", to: "outcome_1" },
      { from: "option_1", to: "risk_1" },
    ];

    const positions = generateDeterministicLayout(nodes, edges, ["goal_1"]);

    // Verify all nodes positioned
    expect(Object.keys(positions)).toHaveLength(7);

    // Verify hierarchical ordering
    expect(positions.goal_1.y).toBe(80); // Layer 0
    expect(positions.decision_1.y).toBe(230); // Layer 1
    expect(positions.option_1.y).toBe(380); // Layer 2
    expect(positions.outcome_1.y).toBe(530); // Layer 3
    expect(positions.risk_1.y).toBe(530); // Layer 3

    // Options should be alphabetically sorted horizontally
    expect(positions.option_1.x).toBeLessThan(positions.option_2.x);
    expect(positions.option_2.x).toBeLessThan(positions.option_3.x);
  });
});

describe("generateLegacyLayout", () => {
  it("should maintain backward compatibility (kind-based positioning)", () => {
    const nodes: NodeT[] = [
      { id: "goal_1", kind: "goal" },
      { id: "decision_1", kind: "decision" },
      { id: "option_1", kind: "option" },
    ];

    const positions = generateLegacyLayout(nodes);

    // Legacy fixed positions
    expect(positions.goal_1).toEqual({ x: 400, y: 50 });
    expect(positions.decision_1).toEqual({ x: 400, y: 200 });
    expect(positions.option_1).toEqual({ x: 200, y: 350 });
  });

  it("should handle all node kinds", () => {
    const nodes: NodeT[] = [
      { id: "goal_1", kind: "goal" },
      { id: "decision_1", kind: "decision" },
      { id: "option_1", kind: "option" },
      { id: "outcome_1", kind: "outcome" },
      { id: "risk_1", kind: "risk" },
      { id: "action_1", kind: "action" },
    ];

    const positions = generateLegacyLayout(nodes);

    expect(positions).toHaveProperty("goal_1");
    expect(positions).toHaveProperty("decision_1");
    expect(positions).toHaveProperty("option_1");
    expect(positions).toHaveProperty("outcome_1");
    expect(positions).toHaveProperty("risk_1");
    expect(positions).toHaveProperty("action_1");

    // Verify vertical ordering by kind
    expect(positions.goal_1.y).toBeLessThan(positions.decision_1.y);
    expect(positions.decision_1.y).toBeLessThan(positions.option_1.y);
    expect(positions.option_1.y).toBeLessThan(positions.outcome_1.y);
    expect(positions.outcome_1.y).toBeLessThan(positions.risk_1.y);
    expect(positions.risk_1.y).toBeLessThan(positions.action_1.y);
  });
});
