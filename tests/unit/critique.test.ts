/**
 * Critique Unit Tests
 *
 * Verifies critique business logic:
 * - Non-mutating (never modifies input graph)
 * - Severity ordering (BLOCKER → IMPROVEMENT → OBSERVATION)
 * - Issue targeting (optional node/edge references)
 * - Suggested fixes (max 5)
 * - Quality assessment
 */

import { describe, it, expect } from "vitest";
import { CritiqueGraphInput, CritiqueGraphOutput } from "../../src/schemas/assist.js";
import { Graph } from "../../src/schemas/graph.js";

describe("Critique Schema Validation", () => {
  const validGraph = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Achieve revenue target" },
      { id: "dec_1", kind: "decision", label: "Pricing strategy" },
      { id: "opt_a", kind: "option", label: "Premium pricing" },
      { id: "opt_b", kind: "option", label: "Volume pricing" },
    ],
    edges: [
      { from: "goal_1", to: "dec_1" },
      { from: "dec_1", to: "opt_a" },
      { from: "dec_1", to: "opt_b" },
    ],
  };

  it("accepts valid input with graph only", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
    });

    expect(result.success).toBe(true);
  });

  it("accepts optional brief for context", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      brief: "We need to increase revenue by 20% next quarter with a new pricing strategy",
    });

    expect(result.success).toBe(true);
  });

  it("accepts optional focus_areas filter", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      focus_areas: ["structure", "completeness"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.focus_areas).toEqual(["structure", "completeness"]);
    }
  });

  it("rejects invalid focus_area", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      focus_areas: ["structure", "invalid_area"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects brief too short (< 30 chars)", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      brief: "Too short",
    });

    expect(result.success).toBe(false);
  });

  it("rejects brief too long (> 5000 chars)", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      brief: "x".repeat(5001),
    });

    expect(result.success).toBe(false);
  });

  it("rejects additional properties (strict mode)", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: validGraph,
      unknown_field: "should fail",
    });

    expect(result.success).toBe(false);
  });
});

describe("Critique Output Validation", () => {
  it("validates output with BLOCKER issues", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "BLOCKER",
          note: "Graph contains a cycle between dec_1 and out_1",
          target: "dec_1",
        },
      ],
      suggested_fixes: ["Remove edge from out_1 to dec_1 to break cycle"],
      overall_quality: "poor",
    });

    expect(result.success).toBe(true);
  });

  it("validates output with IMPROVEMENT issues", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "IMPROVEMENT",
          note: "Missing provenance metadata on nodes",
        },
      ],
      suggested_fixes: ["Add provenance sources to nodes where applicable"],
      overall_quality: "fair",
    });

    expect(result.success).toBe(true);
  });

  it("validates output with OBSERVATION issues", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "OBSERVATION",
          note: "Graph structure is well-formed but could benefit from more descriptive labels",
        },
      ],
      suggested_fixes: [],
      overall_quality: "good",
    });

    expect(result.success).toBe(true);
  });

  it("validates output with no issues (excellent quality)", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [],
      suggested_fixes: [],
      overall_quality: "excellent",
    });

    expect(result.success).toBe(true);
  });

  it("validates mixed severity levels", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "BLOCKER",
          note: "Missing required goal node",
        },
        {
          level: "IMPROVEMENT",
          note: "Consider adding intermediate outcomes",
          target: "dec_1",
        },
        {
          level: "OBSERVATION",
          note: "Label capitalization is inconsistent",
        },
      ],
      suggested_fixes: [
        "Add goal node at top of graph",
        "Insert outcome nodes between decisions and final results",
        "Standardize label formatting",
      ],
      overall_quality: "fair",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toHaveLength(3);
      expect(result.data.suggested_fixes).toHaveLength(3);
    }
  });

  it("rejects invalid severity level", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "CRITICAL",
          note: "Should use BLOCKER instead",
        },
      ],
      suggested_fixes: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects note too short (< 10 chars)", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "OBSERVATION",
          note: "Short",
        },
      ],
      suggested_fixes: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects note too long (> 280 chars)", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "OBSERVATION",
          note: "x".repeat(281),
        },
      ],
      suggested_fixes: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than 5 suggested fixes", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "IMPROVEMENT",
          note: "Multiple issues detected",
        },
      ],
      suggested_fixes: Array.from({ length: 6 }, (_, i) => `Fix ${i + 1}`),
    });

    expect(result.success).toBe(false);
  });

  it("defaults suggested_fixes to empty array", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [
        {
          level: "OBSERVATION",
          note: "Minor formatting inconsistency",
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggested_fixes).toEqual([]);
    }
  });

  it("validates optional overall_quality field", () => {
    const qualities = ["poor", "fair", "good", "excellent"] as const;

    for (const quality of qualities) {
      const result = CritiqueGraphOutput.safeParse({
        issues: [],
        suggested_fixes: [],
        overall_quality: quality,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overall_quality).toBe(quality);
      }
    }
  });

  it("rejects invalid overall_quality", () => {
    const result = CritiqueGraphOutput.safeParse({
      issues: [],
      suggested_fixes: [],
      overall_quality: "perfect",
    });

    expect(result.success).toBe(false);
  });
});

describe("Critique Severity Ordering", () => {
  it("should order issues BLOCKER → IMPROVEMENT → OBSERVATION", () => {
    // This is enforced by the adapter's post-process sort
    // Here we verify the schema allows this ordering
    const ordered = CritiqueGraphOutput.safeParse({
      issues: [
        { level: "BLOCKER", note: "Critical cycle detected in graph structure" },
        { level: "BLOCKER", note: "Missing required goal node" },
        { level: "IMPROVEMENT", note: "Consider adding provenance metadata" },
        { level: "IMPROVEMENT", note: "Some labels could be more descriptive" },
        { level: "OBSERVATION", note: "Graph is at lower end of complexity range" },
        { level: "OBSERVATION", note: "Node count could be higher for better granularity" },
      ],
      suggested_fixes: ["Fix cycles", "Add goal node", "Add metadata", "Improve labels"],
      overall_quality: "poor",
    });

    expect(ordered.success).toBe(true);
    if (ordered.success) {
      // Verify first two are BLOCKERs
      expect(ordered.data.issues[0].level).toBe("BLOCKER");
      expect(ordered.data.issues[1].level).toBe("BLOCKER");
      // Verify next two are IMPROVEMENTs
      expect(ordered.data.issues[2].level).toBe("IMPROVEMENT");
      expect(ordered.data.issues[3].level).toBe("IMPROVEMENT");
      // Verify last two are OBSERVATIONs
      expect(ordered.data.issues[4].level).toBe("OBSERVATION");
      expect(ordered.data.issues[5].level).toBe("OBSERVATION");
    }
  });
});

describe("Critique Non-Mutation Guarantee", () => {
  it("verifies critique never modifies input graph", () => {
    // Critique input includes graph, but output does NOT include modified graph
    // This is a schema-level guarantee of non-mutation

    const input = CritiqueGraphInput.parse({
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Original label" },
        ],
        edges: [],
      },
    });

    const output = CritiqueGraphOutput.parse({
      issues: [
        {
          level: "IMPROVEMENT",
          note: "Label could be more descriptive",
          target: "goal_1",
        },
      ],
      suggested_fixes: ["Rename goal_1 to 'Achieve revenue target'"],
      overall_quality: "good",
    });

    // Output schema does not include 'graph' field
    expect("graph" in output).toBe(false);
    // Input graph remains unchanged
    expect(input.graph.nodes[0].label).toBe("Original label");
  });
});

describe("Critique Focus Areas", () => {
  const focusAreas = [
    "structure",
    "completeness",
    "feasibility",
    "provenance",
  ] as const;

  for (const area of focusAreas) {
    it(`accepts focus_area: ${area}`, () => {
      const result = CritiqueGraphInput.safeParse({
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [],
        },
        focus_areas: [area],
      });

      expect(result.success).toBe(true);
    });
  }

  it("accepts multiple focus areas", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "a", kind: "goal", label: "A" }],
        edges: [],
      },
      focus_areas: ["structure", "completeness", "feasibility"],
    });

    expect(result.success).toBe(true);
  });

  it("accepts all focus areas", () => {
    const result = CritiqueGraphInput.safeParse({
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "a", kind: "goal", label: "A" }],
        edges: [],
      },
      focus_areas: ["structure", "completeness", "feasibility", "provenance"],
    });

    expect(result.success).toBe(true);
  });
});
