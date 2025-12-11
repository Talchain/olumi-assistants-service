/**
 * Tests for Hybrid Bias Detection Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectBiasesHybrid,
  detectBiasesHybridSync,
  __test_only,
} from "../../src/cee/bias/hybrid-detector.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

const {
  detectAnchoringBias,
  detectConfirmationBias,
  detectOverconfidenceBiasEnhanced,
  detectIllusionOfControlEnhanced,
  getDebiasingSuggestion,
  DEBIASING_SUGGESTIONS,
} = __test_only;

// Helper to create test graphs
function createTestGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  edges: Array<{ from: string; to: string; weight?: number; belief?: number }> = [],
): GraphV1 {
  return {
    version: "1.0",
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      weight: e.weight ?? 1.0,
      belief: e.belief ?? 0.7,
    })),
  } as unknown as GraphV1;
}

describe("detectAnchoringBias", () => {
  it("returns null when fewer than 3 options", () => {
    const graph = createTestGraph([
      { id: "o1", kind: "option", label: "Option 1" },
      { id: "o2", kind: "option", label: "Option 2" },
    ]);
    const result = detectAnchoringBias(graph);
    expect(result).toBeNull();
  });

  it("returns null when no edges", () => {
    const graph = createTestGraph([
      { id: "o1", kind: "option", label: "Option 1" },
      { id: "o2", kind: "option", label: "Option 2" },
      { id: "o3", kind: "option", label: "Option 3" },
    ]);
    const result = detectAnchoringBias(graph);
    expect(result).toBeNull();
  });

  it("detects anchoring when first option has disproportionate edges", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "First Option" },
        { id: "o2", kind: "option", label: "Second Option" },
        { id: "o3", kind: "option", label: "Third Option" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
        { id: "out4", kind: "outcome", label: "Outcome 4" },
      ],
      [
        // First option has 4 edges
        { from: "o1", to: "out1" },
        { from: "o1", to: "out2" },
        { from: "o1", to: "out3" },
        { from: "o1", to: "out4" },
        // Second and third options have 1 edge each
        { from: "o2", to: "out1" },
        { from: "o3", to: "out1" },
      ],
    );

    const result = detectAnchoringBias(graph);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("ANCHORING");
    expect(result?.explanation).toContain("First Option");
  });

  it("returns null when edges are evenly distributed", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "o2", kind: "option", label: "Option 2" },
        { id: "o3", kind: "option", label: "Option 3" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
      ],
      [
        { from: "o1", to: "out1" },
        { from: "o1", to: "out2" },
        { from: "o2", to: "out1" },
        { from: "o2", to: "out2" },
        { from: "o3", to: "out1" },
        { from: "o3", to: "out2" },
      ],
    );

    const result = detectAnchoringBias(graph);
    expect(result).toBeNull();
  });
});

describe("detectConfirmationBias", () => {
  it("returns null when fewer than 2 options", () => {
    const graph = createTestGraph([
      { id: "o1", kind: "option", label: "Only Option" },
    ]);
    const result = detectConfirmationBias(graph);
    expect(result).toBeNull();
  });

  it("detects confirmation bias when one option has only positive outcomes", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Favored Option" },
        { id: "o2", kind: "option", label: "Alternative" },
        { id: "out1", kind: "outcome", label: "Success and growth" },
        { id: "out2", kind: "outcome", label: "Benefit increase" },
        { id: "r1", kind: "risk", label: "Risk of failure" },
      ],
      [
        // Favored option has only positive outcomes
        { from: "o1", to: "out1" },
        { from: "o1", to: "out2" },
        // Alternative has risks
        { from: "o2", to: "r1" },
      ],
    );

    const result = detectConfirmationBias(graph);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("CONFIRMATION_BIAS");
    expect(result?.explanation).toContain("Favored Option");
  });

  it("returns null when all options have balanced evidence", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "o2", kind: "option", label: "Option 2" },
        { id: "out1", kind: "outcome", label: "Good outcome" },
        { id: "r1", kind: "risk", label: "Risk" },
      ],
      [
        { from: "o1", to: "out1" },
        { from: "o1", to: "r1" },
        { from: "o2", to: "out1" },
        { from: "o2", to: "r1" },
      ],
    );

    const result = detectConfirmationBias(graph);
    expect(result).toBeNull();
  });
});

describe("detectOverconfidenceBiasEnhanced", () => {
  it("returns null when no edges with beliefs", () => {
    const graph = createTestGraph([
      { id: "o1", kind: "option", label: "Option 1" },
    ]);
    const result = detectOverconfidenceBiasEnhanced(graph);
    expect(result).toBeNull();
  });

  it("returns null when fewer than 3 edges with beliefs", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
      ],
      [
        { from: "o1", to: "out1", belief: 0.9 },
      ],
    );
    const result = detectOverconfidenceBiasEnhanced(graph);
    expect(result).toBeNull();
  });

  it("detects overconfidence when all beliefs > 0.8", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
      ],
      [
        { from: "o1", to: "out1", belief: 0.85 },
        { from: "o1", to: "out2", belief: 0.90 },
        { from: "o1", to: "out3", belief: 0.88 },
      ],
    );

    const result = detectOverconfidenceBiasEnhanced(graph);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("OVERCONFIDENCE");
    expect(result?.explanation).toContain("above 80%");
  });

  it("sets high severity when average belief >= 0.9", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
      ],
      [
        { from: "o1", to: "out1", belief: 0.95 },
        { from: "o1", to: "out2", belief: 0.92 },
        { from: "o1", to: "out3", belief: 0.91 },
      ],
    );

    const result = detectOverconfidenceBiasEnhanced(graph);
    expect(result?.severity).toBe("high");
  });

  it("returns null when some beliefs are below threshold", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
      ],
      [
        { from: "o1", to: "out1", belief: 0.9 },
        { from: "o1", to: "out2", belief: 0.5 }, // Below threshold
        { from: "o1", to: "out3", belief: 0.85 },
      ],
    );

    const result = detectOverconfidenceBiasEnhanced(graph);
    expect(result).toBeNull();
  });
});

describe("detectIllusionOfControlEnhanced", () => {
  it("returns null when fewer than 3 actions", () => {
    const graph = createTestGraph([
      { id: "a1", kind: "action", label: "Action 1" },
      { id: "a2", kind: "action", label: "Action 2" },
    ]);
    const result = detectIllusionOfControlEnhanced(graph);
    expect(result).toBeNull();
  });

  it("detects illusion of control when many actions but no factors", () => {
    const graph = createTestGraph([
      { id: "a1", kind: "action", label: "Action 1" },
      { id: "a2", kind: "action", label: "Action 2" },
      { id: "a3", kind: "action", label: "Action 3" },
      { id: "a4", kind: "action", label: "Action 4" },
    ]);

    const result = detectIllusionOfControlEnhanced(graph);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("ILLUSION_OF_CONTROL");
    expect(result?.explanation).toContain("4 controllable actions");
    expect(result?.explanation).toContain("0 external factors");
  });

  it("returns null when sufficient factors exist", () => {
    const graph = createTestGraph([
      { id: "a1", kind: "action", label: "Action 1" },
      { id: "a2", kind: "action", label: "Action 2" },
      { id: "a3", kind: "action", label: "Action 3" },
      { id: "f1", kind: "factor", label: "Market conditions" },
      { id: "f2", kind: "factor", label: "Competitor response" },
    ]);

    const result = detectIllusionOfControlEnhanced(graph);
    expect(result).toBeNull();
  });
});

describe("getDebiasingSuggestion", () => {
  it("returns suggestion for ANCHORING", () => {
    const suggestion = getDebiasingSuggestion("ANCHORING");
    expect(suggestion).toBeDefined();
    expect(suggestion?.headline).toContain("first option");
    expect(suggestion?.steps.length).toBeGreaterThan(0);
  });

  it("returns suggestion for CONFIRMATION_BIAS", () => {
    const suggestion = getDebiasingSuggestion("CONFIRMATION_BIAS");
    expect(suggestion).toBeDefined();
    expect(suggestion?.headline).toContain("Evidence");
    expect(suggestion?.steps.length).toBeGreaterThan(0);
    // Should include actionable debiasing steps
    expect(suggestion?.steps.some((s) => s.includes("fail") || s.includes("devil"))).toBe(true);
  });

  it("returns suggestion for OVERCONFIDENCE", () => {
    const suggestion = getDebiasingSuggestion("OVERCONFIDENCE");
    expect(suggestion).toBeDefined();
    expect(suggestion?.headline).toContain("Certainty");
  });

  it("returns suggestion for ILLUSION_OF_CONTROL", () => {
    const suggestion = getDebiasingSuggestion("ILLUSION_OF_CONTROL");
    expect(suggestion).toBeDefined();
    expect(suggestion?.headline).toContain("External factors");
  });

  it("returns undefined for unknown bias", () => {
    const suggestion = getDebiasingSuggestion("UNKNOWN_BIAS");
    expect(suggestion).toBeUndefined();
  });
});

describe("DEBIASING_SUGGESTIONS", () => {
  it("provides actionable steps for each bias type", () => {
    for (const [code, suggestion] of Object.entries(DEBIASING_SUGGESTIONS)) {
      expect(suggestion.headline).toBeTruthy();
      expect(suggestion.explanation).toBeTruthy();
      expect(suggestion.steps.length).toBeGreaterThan(0);

      // Each step should be actionable (start with a verb or specific instruction)
      for (const step of suggestion.steps) {
        expect(step.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("detectBiasesHybridSync", () => {
  it("runs all rule-based detectors", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "First Option" },
        { id: "o2", kind: "option", label: "Second" },
        { id: "o3", kind: "option", label: "Third" },
        { id: "out1", kind: "outcome", label: "Success" },
        { id: "out2", kind: "outcome", label: "More success" },
        { id: "out3", kind: "outcome", label: "Even more" },
        { id: "out4", kind: "outcome", label: "Still more" },
      ],
      [
        // Anchoring pattern - first option has way more edges
        { from: "o1", to: "out1" },
        { from: "o1", to: "out2" },
        { from: "o1", to: "out3" },
        { from: "o1", to: "out4" },
        { from: "o2", to: "out1" },
        { from: "o3", to: "out1" },
      ],
    );

    const result = detectBiasesHybridSync({ graph });

    expect(result.llm_used).toBe(false);
    expect(result.llm_detected_count).toBe(0);
    expect(result.rule_based_count).toBeGreaterThan(0);
    expect(result.findings.length).toBe(result.rule_based_count);
  });

  it("returns empty findings for clean graph", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "o2", kind: "option", label: "Option 2" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "r1", kind: "risk", label: "Risk 1" },
        { id: "f1", kind: "factor", label: "Factor 1" },
      ],
      [
        // Balanced evidence
        { from: "o1", to: "out1", belief: 0.6 },
        { from: "o1", to: "r1", belief: 0.5 },
        { from: "o2", to: "out1", belief: 0.7 },
        { from: "o2", to: "r1", belief: 0.4 },
      ],
    );

    const result = detectBiasesHybridSync({ graph });
    expect(result.findings.length).toBe(0);
  });
});

describe("detectBiasesHybrid", () => {
  it("returns same results as sync version when LLM disabled", async () => {
    const graph = createTestGraph(
      [
        { id: "a1", kind: "action", label: "Action 1" },
        { id: "a2", kind: "action", label: "Action 2" },
        { id: "a3", kind: "action", label: "Action 3" },
        { id: "a4", kind: "action", label: "Action 4" },
      ],
    );

    const syncResult = detectBiasesHybridSync({ graph });
    const asyncResult = await detectBiasesHybrid({ graph });

    expect(asyncResult.llm_used).toBe(false); // LLM disabled by default
    expect(asyncResult.findings.length).toBe(syncResult.findings.length);
    expect(asyncResult.rule_based_count).toBe(syncResult.rule_based_count);
  });

  it("includes brief in context when provided", async () => {
    const graph = createTestGraph([
      { id: "o1", kind: "option", label: "Option 1" },
    ]);

    // Should not throw even with brief provided
    const result = await detectBiasesHybrid({
      graph,
      brief: "Should we launch the new product?",
    });

    expect(result).toBeDefined();
    expect(result.findings).toBeDefined();
  });
});

describe("integration: bias findings have debiasing steps", () => {
  it("anchoring finding includes micro_intervention steps", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "First Option" },
        { id: "o2", kind: "option", label: "Second" },
        { id: "o3", kind: "option", label: "Third" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
        { id: "out4", kind: "outcome", label: "Outcome 4" },
      ],
      [
        { from: "o1", to: "out1" },
        { from: "o1", to: "out2" },
        { from: "o1", to: "out3" },
        { from: "o1", to: "out4" },
        { from: "o2", to: "out1" },
        { from: "o3", to: "out1" },
      ],
    );

    const result = detectBiasesHybridSync({ graph });
    const anchoringFinding = result.findings.find(
      (f) => (f as any).code === "ANCHORING",
    );

    expect(anchoringFinding).toBeDefined();
    expect((anchoringFinding as any).micro_intervention).toBeDefined();
    expect((anchoringFinding as any).micro_intervention.steps.length).toBeGreaterThan(0);
  });

  it("overconfidence finding includes mechanism explanation", () => {
    const graph = createTestGraph(
      [
        { id: "o1", kind: "option", label: "Option 1" },
        { id: "out1", kind: "outcome", label: "Outcome 1" },
        { id: "out2", kind: "outcome", label: "Outcome 2" },
        { id: "out3", kind: "outcome", label: "Outcome 3" },
      ],
      [
        { from: "o1", to: "out1", belief: 0.85 },
        { from: "o1", to: "out2", belief: 0.90 },
        { from: "o1", to: "out3", belief: 0.88 },
      ],
    );

    const result = detectBiasesHybridSync({ graph });
    const overconfidenceFinding = result.findings.find(
      (f) => (f as any).code === "OVERCONFIDENCE",
    );

    expect(overconfidenceFinding).toBeDefined();
    expect((overconfidenceFinding as any).mechanism).toBeDefined();
    expect((overconfidenceFinding as any).mechanism).toContain("certainty");
  });
});
