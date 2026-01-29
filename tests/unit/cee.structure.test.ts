import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import {
  detectStructuralWarnings,
  normaliseDecisionBranchBeliefs,
  validateGraphSizeLimits,
  enforceSingleGoal,
  fixMissingOutcomeEdgeBeliefs,
  validateAndFixGraph,
  fixNonCanonicalStructuralEdges,
  type GraphFixOptions,
  type StructuralMeta,
} from "../../src/cee/structure/index.js";

function makeGraph(partial: Partial<GraphV1>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    ...(partial as any),
  } as GraphV1;
}

describe("detectStructuralWarnings", () => {
  it("returns empty result when graph is undefined", () => {
    const result = detectStructuralWarnings(undefined, undefined);
    expect(result.warnings).toEqual([]);
    expect(result.uncertainNodeIds).toEqual([]);
  });

  it("emits no_outcome_node when graph has no outcome nodes", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "d1", kind: "decision" } as any,
        { id: "o1", kind: "option" } as any,
      ],
      edges: [],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "no_outcome_node");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("medium");
    expect(Array.isArray(w?.node_ids)).toBe(true);
    expect(w?.edge_ids).toEqual([]);
    expect(uncertainNodeIds.length).toBeGreaterThan(0);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["g1", "d1", "o1"]));
  });

  it("emits orphan_node for nodes with no incident edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", kind: "goal" } as any,
        { id: "b", kind: "option" } as any,
        { id: "c", kind: "risk" } as any,
      ],
      edges: [
        { from: "a", to: "b" } as any,
      ],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "orphan_node");
    expect(w).toBeDefined();
    expect(w?.node_ids).toEqual(["c"]);
    expect(w?.edge_ids).toEqual([]);
    expect(uncertainNodeIds).toContain("c");
  });

  it("emits cycle_detected when structural meta reports cycles", () => {
    const graph = makeGraph({
      nodes: [
        { id: "n1", kind: "decision" } as any,
        { id: "n2", kind: "option" } as any,
      ],
      edges: [],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, {
      had_cycles: true,
      cycle_node_ids: ["n1", "n2"],
    });

    const w = warnings.find((x) => x.id === "cycle_detected");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("high");
    expect(w?.node_ids).toEqual(["n1", "n2"]);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
  });

  it("emits decision_after_outcome for backwards edges from outcome to decision/option", () => {
    const graph = makeGraph({
      nodes: [
        { id: "out1", kind: "outcome" } as any,
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
      edges: [
        { id: "e1", from: "out1", to: "dec1" } as any,
        { id: "e2", from: "out1", to: "opt1" } as any,
      ],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "decision_after_outcome");
    expect(w).toBeDefined();
    expect(w?.node_ids).toEqual(expect.arrayContaining(["out1", "dec1", "opt1"]));
    expect(w?.edge_ids).toEqual(["e1", "e2"]);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["out1", "dec1", "opt1"]));
  });

  it("does NOT emit decision_after_outcome for valid outcome→goal edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "out1", kind: "outcome" } as any,
        { id: "out2", kind: "outcome" } as any,
        { id: "goal1", kind: "goal" } as any,
      ],
      edges: [
        { id: "e1", from: "out1", to: "goal1" } as any,
        { id: "e2", from: "out2", to: "goal1" } as any,
      ],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    // outcome→goal is VALID V4 topology - goals aggregate outcomes
    const w = warnings.find((x) => x.id === "decision_after_outcome");
    expect(w).toBeUndefined();
    expect(uncertainNodeIds).not.toContain("out1");
    expect(uncertainNodeIds).not.toContain("goal1");
  });
});

describe("normaliseDecisionBranchBeliefs", () => {
  it("renormalises decision-to-option beliefs when their sum differs significantly from 1", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal" } as any,
        { id: "dec_1", kind: "decision" } as any,
        { id: "opt_1", kind: "option" } as any,
        { id: "opt_2", kind: "option" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.7 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.7 } as any,
      ],
    });

    const normalised = normaliseDecisionBranchBeliefs(graph);
    expect(normalised).toBeDefined();

    const edges = (normalised as GraphV1).edges as any[];
    const decisionEdges = edges.filter(
      (e) => e.from === "dec_1" && (e.to === "opt_1" || e.to === "opt_2"),
    );
    const sum = decisionEdges.reduce((acc, e) => acc + (typeof e.belief === "number" ? e.belief : 0), 0);
    expect(sum).toBeCloseTo(1, 4);
    for (const edge of decisionEdges) {
      expect(edge.belief).toBeGreaterThan(0);
      expect(edge.belief).toBeLessThan(1);
    }
  });

  it("leaves beliefs unchanged when branches are already normalised", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal" } as any,
        { id: "dec_1", kind: "decision" } as any,
        { id: "opt_1", kind: "option" } as any,
        { id: "opt_2", kind: "option" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.6 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.4 } as any,
      ],
    });

    const originalBeliefs = (graph.edges as any[]).map((e) => e.belief);
    const normalised = normaliseDecisionBranchBeliefs(graph) as GraphV1;
    const newBeliefs = (normalised.edges as any[]).map((e) => e.belief);
    expect(newBeliefs).toEqual(originalBeliefs);
  });
});

describe("validateGraphSizeLimits", () => {
  it("returns valid for graph within limits", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "d1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "d1" } as any,
      ],
    });

    const result = validateGraphSizeLimits(graph);
    expect(result.valid).toBe(true);
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it("returns valid for undefined graph", () => {
    const result = validateGraphSizeLimits(undefined);
    expect(result.valid).toBe(true);
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });

  it("returns invalid when nodes exceed limit", () => {
    // Create graph with 51 nodes (exceeds default limit of 50)
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`,
      kind: "option",
    }));
    const graph = makeGraph({ nodes: nodes as any });

    const result = validateGraphSizeLimits(graph);
    expect(result.valid).toBe(false);
    expect(result.nodeCount).toBe(51);
    expect(result.error).toContain("node limit");
  });

  it("returns invalid when edges exceed limit", () => {
    // Create graph with 201 edges (exceeds default limit of 200)
    const nodes = [{ id: "a", kind: "decision" }, { id: "b", kind: "option" }];
    const edges = Array.from({ length: 201 }, (_, i) => ({
      id: `e${i}`,
      from: "a",
      to: "b",
    }));
    const graph = makeGraph({ nodes: nodes as any, edges: edges as any });

    const result = validateGraphSizeLimits(graph);
    expect(result.valid).toBe(false);
    expect(result.edgeCount).toBe(201);
    expect(result.error).toContain("edge limit");
  });
});

describe("enforceSingleGoal", () => {
  it("returns unchanged graph when there is exactly one goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Primary Goal" } as any,
        { id: "d1", kind: "decision" } as any,
      ],
      edges: [{ from: "g1", to: "d1" } as any],
    });

    const result = enforceSingleGoal(graph);
    expect(result).toBeDefined();
    expect(result!.hadMultipleGoals).toBe(false);
    expect(result!.originalGoalCount).toBe(1);
    expect(result!.graph).toBe(graph); // Same reference
  });

  it("merges multiple goals into compound goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Increase Revenue" } as any,
        { id: "g2", kind: "goal", label: "Reduce Churn" } as any,
        { id: "d1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "d1" } as any,
        { from: "g2", to: "d1" } as any,
      ],
    });

    const result = enforceSingleGoal(graph);
    expect(result).toBeDefined();
    expect(result!.hadMultipleGoals).toBe(true);
    expect(result!.originalGoalCount).toBe(2);
    expect(result!.mergedGoalIds).toEqual(["g1", "g2"]);

    // Verify merged graph
    const nodes = result!.graph.nodes as any[];
    const goalNodes = nodes.filter((n) => n.kind === "goal");
    expect(goalNodes).toHaveLength(1);
    expect(goalNodes[0].label).toContain("Compound Goal");
    expect(goalNodes[0].label).toContain("Increase Revenue");
    expect(goalNodes[0].label).toContain("Reduce Churn");
  });

  it("redirects edges from removed goals to primary goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "d1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "d1" } as any,
        { from: "g2", to: "d1" } as any,
      ],
    });

    const result = enforceSingleGoal(graph);
    const edges = result!.graph.edges as any[];

    // All edges should now reference g1 (primary goal)
    const toD1 = edges.filter((e) => e.to === "d1");
    expect(toD1.every((e) => e.from === "g1")).toBe(true);
  });

  it("deduplicates edges after goal merge", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "d1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "d1" } as any,
        { from: "g2", to: "d1" } as any, // Will become duplicate after merge
      ],
    });

    const result = enforceSingleGoal(graph);
    const edges = result!.graph.edges as any[];

    // Should deduplicate to single edge
    const g1ToD1 = edges.filter((e) => e.from === "g1" && e.to === "d1");
    expect(g1ToD1).toHaveLength(1);
  });

  it("returns undefined for undefined graph", () => {
    const result = enforceSingleGoal(undefined);
    expect(result).toBeUndefined();
  });
});

describe("fixMissingOutcomeEdgeBeliefs", () => {
  it("adds default belief to option→outcome edges missing belief", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "out1" } as any, // No belief
      ],
    });

    const result = fixMissingOutcomeEdgeBeliefs(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(1);
    expect(result!.fixedEdgeIds).toContain("e1");

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.belief).toBe(0.5);
  });

  it("does not modify edges that already have beliefs", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "out1", belief: 0.8 } as any,
      ],
    });

    const result = fixMissingOutcomeEdgeBeliefs(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(0);
    expect(result!.graph).toBe(graph); // Same reference (unchanged)

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.belief).toBe(0.8);
  });

  it("only fixes option→outcome edges, not other edge types", () => {
    const graph = makeGraph({
      nodes: [
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "dec1", to: "opt1" } as any, // decision→option (should not fix)
        { id: "e2", from: "opt1", to: "out1" } as any, // option→outcome (should fix)
      ],
    });

    const result = fixMissingOutcomeEdgeBeliefs(graph);
    expect(result!.fixedEdgeCount).toBe(1);
    expect(result!.fixedEdgeIds).toEqual(["e2"]);

    const edges = result!.graph.edges as any[];
    const decToOpt = edges.find((e) => e.id === "e1");
    const optToOut = edges.find((e) => e.id === "e2");

    expect(decToOpt.belief).toBeUndefined(); // Not fixed
    expect(optToOut.belief).toBe(0.5); // Fixed
  });

  it("uses custom default belief when provided", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "out1" } as any,
      ],
    });

    const result = fixMissingOutcomeEdgeBeliefs(graph, 0.7);
    const edge = (result!.graph.edges as any[])[0];
    expect(edge.belief).toBe(0.7);
  });
});

describe("validateAndFixGraph", () => {
  it("returns invalid for undefined graph", () => {
    const result = validateAndFixGraph(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid graph structure");
    expect(result.graph).toBeUndefined();
  });

  it("returns invalid when graph exceeds size limits", () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`,
      kind: "option",
    }));
    const graph = makeGraph({ nodes: nodes as any });

    const result = validateAndFixGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("node limit");
    expect(result.graph).toBeUndefined();
  });

  it("applies all fixes in correct order", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any, // Will be merged
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "opt2", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "g1", to: "dec1" } as any,
        { id: "e2", from: "g2", to: "dec1" } as any,
        { id: "e3", from: "dec1", to: "opt1", belief: 0.6 } as any,
        { id: "e4", from: "dec1", to: "opt2", belief: 0.6 } as any, // Sum > 1, will normalize
        { id: "e5", from: "opt1", to: "out1" } as any, // Missing belief, will add 0.5
      ],
    });

    const result = validateAndFixGraph(graph);

    expect(result.valid).toBe(true);
    expect(result.fixes.singleGoalApplied).toBe(true);
    expect(result.fixes.outcomeBeliefsFilled).toBe(1);
    expect(result.fixes.decisionBranchesNormalized).toBe(true);

    // Verify single goal
    const goalNodes = (result.graph!.nodes as any[]).filter((n) => n.kind === "goal");
    expect(goalNodes).toHaveLength(1);
    expect(goalNodes[0].label).toContain("Compound Goal");

    // Verify decision branch normalization
    const decisionEdges = (result.graph!.edges as any[]).filter(
      (e) => e.from === "dec1" && (e.to === "opt1" || e.to === "opt2")
    );
    const sum = decisionEdges.reduce((acc, e) => acc + (e.belief || 0), 0);
    expect(sum).toBeCloseTo(1, 2);

    // Verify outcome belief filled
    const optToOut = (result.graph!.edges as any[]).find(
      (e) => e.from === "opt1" && e.to === "out1"
    );
    expect(optToOut.belief).toBe(0.5);
  });

  it("returns structural warnings after fixes", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "orphan", kind: "risk" } as any, // Orphan node
      ],
      edges: [
        { from: "g1", to: "dec1" } as any,
        { from: "dec1", to: "opt1" } as any,
      ],
    });

    const result = validateAndFixGraph(graph);
    expect(result.valid).toBe(true);

    // Should include warning about orphan node
    const orphanWarning = result.warnings.find((w) => w.id === "orphan_node");
    expect(orphanWarning).toBeDefined();
    expect(orphanWarning!.node_ids).toContain("orphan");
  });

  it("passes StructuralMeta to detectStructuralWarnings for cycle_detected", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "dec1" } as any,
      ],
    });

    const meta: StructuralMeta = {
      had_cycles: true,
      cycle_node_ids: ["dec1"],
    };

    const result = validateAndFixGraph(graph, meta);
    expect(result.valid).toBe(true);

    // Should include cycle_detected warning from meta
    const cycleWarning = result.warnings.find((w) => w.id === "cycle_detected");
    expect(cycleWarning).toBeDefined();
    expect(cycleWarning!.node_ids).toContain("dec1");
  });

  it("respects options to disable single goal enforcement", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "dec1" } as any,
        { from: "g2", to: "dec1" } as any,
      ],
    });

    const options: GraphFixOptions = {
      enforceSingleGoal: false,
    };

    const result = validateAndFixGraph(graph, undefined, options);
    expect(result.valid).toBe(true);
    expect(result.fixes.singleGoalApplied).toBe(false);

    // Should still have 2 goal nodes
    const goalNodes = (result.graph!.nodes as any[]).filter((n) => n.kind === "goal");
    expect(goalNodes).toHaveLength(2);
  });

  it("respects options to disable outcome belief fill", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "out1" } as any, // No belief
      ],
    });

    const options: GraphFixOptions = {
      fillOutcomeBeliefs: false,
    };

    const result = validateAndFixGraph(graph, undefined, options);
    expect(result.valid).toBe(true);
    expect(result.fixes.outcomeBeliefsFilled).toBe(0);

    // Edge should not have belief added
    const edge = (result.graph!.edges as any[])[0];
    expect(edge.belief).toBeUndefined();
  });

  it("uses custom default belief when provided", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "out1" } as any,
      ],
    });

    const options: GraphFixOptions = {
      defaultOutcomeBelief: 0.75,
    };

    const result = validateAndFixGraph(graph, undefined, options);
    const edge = (result.graph!.edges as any[])[0];
    expect(edge.belief).toBe(0.75);
  });

  it("skips size limit check when disabled", () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`,
      kind: "option",
    }));
    const graph = makeGraph({ nodes: nodes as any });

    const options: GraphFixOptions = {
      checkSizeLimits: false,
    };

    const result = validateAndFixGraph(graph, undefined, options);
    expect(result.valid).toBe(true); // Would fail with default options
    expect(result.graph).toBeDefined();
  });
});

describe("enforceSingleGoal edge deduplication", () => {
  it("prefers edges with provenance over edges without", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { id: "e1", from: "g1", to: "dec1" } as any, // No provenance
        { id: "e2", from: "g2", to: "dec1", provenance: { source: "doc.pdf", quote: "Important finding" } } as any,
      ],
    });

    const result = enforceSingleGoal(graph);
    expect(result!.hadMultipleGoals).toBe(true);

    // After merge, the edge with provenance should be kept
    const edges = result!.graph.edges as any[];
    const keptEdge = edges.find((e) => e.to === "dec1");
    expect(keptEdge.provenance?.source).toBe("doc.pdf");
    expect(keptEdge.provenance?.quote).toBe("Important finding");
  });

  it("updates meta.roots after goal merge", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { from: "g1", to: "dec1" } as any,
        { from: "g2", to: "dec1" } as any,
      ],
      meta: { roots: ["g1", "g2"], leaves: ["dec1"], suggested_positions: {}, source: "assistant" },
    });

    const result = enforceSingleGoal(graph);
    const meta = (result!.graph as any).meta;
    expect(meta.roots).toEqual(["g1"]); // Only primary goal
  });

  it("normalizes beliefs on edges leaving compound goal to 1.0", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { id: "e1", from: "g1", to: "dec1", belief: 0.9 } as any,
        { id: "e2", from: "g2", to: "dec1", belief: 0.1 } as any,
      ],
    });

    const result = enforceSingleGoal(graph);
    expect(result!.hadMultipleGoals).toBe(true);

    // After merge, the compound goal's outgoing edge should have belief = 1.0
    const edges = result!.graph.edges as any[];
    const goalToDecision = edges.find((e) => e.from === "g1" && e.to === "dec1");
    expect(goalToDecision).toBeDefined();
    expect(goalToDecision.belief).toBe(1.0);
  });

  it("preserves provenance while normalizing belief to 1.0", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal", label: "Goal 1" } as any,
        { id: "g2", kind: "goal", label: "Goal 2" } as any,
        { id: "dec1", kind: "decision" } as any,
      ],
      edges: [
        { id: "e1", from: "g1", to: "dec1", belief: 0.6 } as any,
        { id: "e2", from: "g2", to: "dec1", belief: 0.4, provenance: { source: "doc.pdf", quote: "Key insight" } } as any,
      ],
    });

    const result = enforceSingleGoal(graph);
    const edges = result!.graph.edges as any[];
    const goalToDecision = edges.find((e) => e.to === "dec1");

    // Should keep provenance AND normalize belief to 1.0
    expect(goalToDecision.provenance?.source).toBe("doc.pdf");
    expect(goalToDecision.belief).toBe(1.0);
  });
});

describe("fixNonCanonicalStructuralEdges", () => {
  it("returns undefined for undefined graph", () => {
    const result = fixNonCanonicalStructuralEdges(undefined);
    expect(result).toBeUndefined();
  });

  it("fixes option->factor edge with non-canonical std", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.8, strength_std: 0.15, belief_exists: 0.9 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(1);
    expect(result!.fixedEdgeIds).toContain("e1");

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.strength_mean).toBe(1.0);
    expect(edge.strength_std).toBe(0.01);
    expect(edge.belief_exists).toBe(1.0);
  });

  it("fixes option->factor edge with non-canonical mean", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.5 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(1);

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.strength_mean).toBe(1.0);
  });

  it("fixes option->factor edge with non-canonical belief_exists", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 1, belief_exists: 0.8 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(1);

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.belief_exists).toBe(1.0);
  });

  it("does not modify already canonical option->factor edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        // All canonical values including effect_direction
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(0);
    expect(result!.graph).toBe(graph); // Same reference when no changes
  });

  it("only fixes option->factor edges, not other edge types", () => {
    const graph = makeGraph({
      nodes: [
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
        { id: "out1", kind: "outcome" } as any,
      ],
      edges: [
        { id: "e1", from: "dec1", to: "opt1", strength_mean: 0.5 } as any, // decision->option (should NOT fix)
        { id: "e2", from: "opt1", to: "fac1", strength_mean: 0.5 } as any, // option->factor (SHOULD fix)
        { id: "e3", from: "fac1", to: "out1", strength_mean: 0.5 } as any, // factor->outcome (should NOT fix)
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(1);
    expect(result!.fixedEdgeIds).toEqual(["e2"]);

    const edges = result!.graph.edges as any[];
    const decToOpt = edges.find((e) => e.id === "e1");
    const optToFac = edges.find((e) => e.id === "e2");
    const facToOut = edges.find((e) => e.id === "e3");

    // Only option->factor should be fixed
    expect(decToOpt.strength_mean).toBe(0.5); // Not fixed
    expect(optToFac.strength_mean).toBe(1.0); // Fixed
    expect(facToOut.strength_mean).toBe(0.5); // Not fixed
  });

  it("fixes multiple option->factor edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "opt2", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.8 } as any,
        { id: "e2", from: "opt2", to: "fac1", strength_mean: 0.7 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.fixedEdgeCount).toBe(2);
    expect(result!.fixedEdgeIds).toEqual(["e1", "e2"]);

    const edges = result!.graph.edges as any[];
    for (const edge of edges) {
      expect(edge.strength_mean).toBe(1.0);
    }
  });

  it("sets direction to positive for fixed edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.5, effect_direction: "negative" } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();

    const edge = (result!.graph.edges as any[])[0];
    expect(edge.effect_direction).toBe("positive");
  });

  // T3: Repair record tests
  it("returns empty repairs array when no changes needed", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        // All canonical values including effect_direction
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.repairs).toEqual([]);
  });

  it("returns repair records for each field changed", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.8 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.repairs.length).toBeGreaterThan(0);

    // Should have records for mean, std, and prob
    const meanRepair = result!.repairs.find((r) => r.field === "strength.mean");
    const stdRepair = result!.repairs.find((r) => r.field === "strength.std");
    const probRepair = result!.repairs.find((r) => r.field === "exists_probability");

    expect(meanRepair).toBeDefined();
    expect(meanRepair!.from_value).toBe(0.5);
    expect(meanRepair!.to_value).toBe(1.0);
    expect(meanRepair!.action).toBe("normalised");

    expect(stdRepair).toBeDefined();
    expect(stdRepair!.from_value).toBe(0.15);
    expect(stdRepair!.to_value).toBe(0.01);

    expect(probRepair).toBeDefined();
    expect(probRepair!.from_value).toBe(0.8);
    expect(probRepair!.to_value).toBe(1.0);
  });

  it("uses real edge.id in repair records (not from->to concatenation)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "my-real-edge-id", from: "opt1", to: "fac1", strength_mean: 0.5 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.repairs.length).toBeGreaterThan(0);

    // All repair records should use the real edge.id
    for (const repair of result!.repairs) {
      expect(repair.edge_id).toBe("my-real-edge-id");
      expect(repair.edge_from).toBe("opt1");
      expect(repair.edge_to).toBe("fac1");
    }
  });

  it("uses 'defaulted' action for undefined values", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        // No strength_std defined (undefined)
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 1.0, belief_exists: 1.0 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();

    const stdRepair = result!.repairs.find((r) => r.field === "strength.std");
    expect(stdRepair).toBeDefined();
    expect(stdRepair!.from_value).toBeNull(); // undefined represented as null
    expect(stdRepair!.action).toBe("defaulted");
    expect(stdRepair!.to_value).toBe(0.01);
  });

  it("tracks effect_direction repair when not positive", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "negative" } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();

    const dirRepair = result!.repairs.find((r) => r.field === "effect_direction");
    expect(dirRepair).toBeDefined();
    expect(dirRepair!.from_value).toBe("negative");
    expect(dirRepair!.to_value).toBe("positive");
    expect(dirRepair!.action).toBe("normalised");
  });

  it("repair records match PLoT repairs_applied[] schema shape", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt1", kind: "option" } as any,
        { id: "fac1", kind: "factor" } as any,
      ],
      edges: [
        { id: "e1", from: "opt1", to: "fac1", strength_mean: 0.5 } as any,
      ],
    });

    const result = fixNonCanonicalStructuralEdges(graph);
    expect(result).toBeDefined();
    expect(result!.repairs.length).toBeGreaterThan(0);

    // Verify each repair record has all required PLoT fields
    for (const repair of result!.repairs) {
      expect(typeof repair.field).toBe("string");
      expect(["clamped", "defaulted", "normalised"]).toContain(repair.action);
      expect(repair.from_value === null || typeof repair.from_value === "number" || typeof repair.from_value === "string").toBe(true);
      expect(typeof repair.to_value === "number" || typeof repair.to_value === "string").toBe(true);
      expect(typeof repair.reason).toBe("string");
      expect(typeof repair.edge_id).toBe("string");
      expect(typeof repair.edge_from).toBe("string");
      expect(typeof repair.edge_to).toBe("string");
    }
  });
});
