import { describe, it, expect } from "vitest";
import {
  generatePreDecisionChecklist,
  __test_only,
} from "../../src/cee/validation/pre-decision-checks.js";
import type { GraphT as Graph } from "../../src/schemas/graph.js";

const { generateChecks, generateFramingNudges } = __test_only;

// Helper to create minimal graph
function createGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: {
      source: "assistant",
      roots: [],
      leaves: [],
      suggested_positions: {},
    },
    ...overrides,
  };
}

describe("CEE Pre-Decision Checks", () => {
  describe("generateChecks", () => {
    it("suggests more options when less than 3 exist", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Option 1" },
          { id: "opt2", kind: "option", label: "Option 2" },
        ],
      });
      const checks = generateChecks(graph, "Should we invest in marketing?");
      const optionsCheck = checks.find(c => c.id === "check_options_count");
      expect(optionsCheck).toBeDefined();
      expect(optionsCheck?.category).toBe("completeness");
    });

    it("does not suggest more options when 3+ exist", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Option 1" },
          { id: "opt2", kind: "option", label: "Option 2" },
          { id: "opt3", kind: "option", label: "Option 3" },
        ],
      });
      const checks = generateChecks(graph, "test brief");
      const optionsCheck = checks.find(c => c.id === "check_options_count");
      expect(optionsCheck).toBeUndefined();
    });

    it("prompts for risk identification when no risks exist", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Option 1" },
        ],
      });
      const checks = generateChecks(graph, "test brief");
      const risksCheck = checks.find(c => c.id === "check_risks_identified");
      expect(risksCheck).toBeDefined();
      expect(risksCheck?.category).toBe("completeness");
    });

    it("does not prompt for risks when risks exist", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Option 1" },
          { id: "risk1", kind: "risk", label: "Risk 1" },
        ],
      });
      const checks = generateChecks(graph, "test brief");
      const risksCheck = checks.find(c => c.id === "check_risks_identified");
      expect(risksCheck).toBeUndefined();
    });

    it("detects unbalanced analysis between options", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Preferred" },
          { id: "opt2", kind: "option", label: "Alternative" },
          { id: "r1", kind: "risk", label: "Risk 1" },
          { id: "r2", kind: "risk", label: "Risk 2" },
          { id: "r3", kind: "risk", label: "Risk 3" },
          { id: "r4", kind: "risk", label: "Risk 4" },
        ],
        edges: [
          { from: "opt1", to: "r1" },
          { from: "opt1", to: "r2" },
          { from: "opt1", to: "r3" },
          { from: "opt1", to: "r4" },
          // opt2 has no edges - unbalanced
        ],
      });
      const checks = generateChecks(graph, "test brief");
      const biasCheck = checks.find(c => c.id === "check_balanced_analysis");
      expect(biasCheck).toBeDefined();
      expect(biasCheck?.category).toBe("bias");
    });

    it("prompts for stakeholders when not mentioned", () => {
      const graph = createGraph();
      const checks = generateChecks(graph, "Should we change our pricing?");
      const stakeholdersCheck = checks.find(c => c.id === "check_stakeholders");
      expect(stakeholdersCheck).toBeDefined();
    });

    it("does not prompt for stakeholders when mentioned", () => {
      const graph = createGraph();
      const checks = generateChecks(graph, "How will this affect our customers and team?");
      const stakeholdersCheck = checks.find(c => c.id === "check_stakeholders");
      expect(stakeholdersCheck).toBeUndefined();
    });

    it("prompts for reversibility when actions exist", () => {
      const graph = createGraph({
        nodes: [
          { id: "act1", kind: "action", label: "Action 1" },
        ],
      });
      const checks = generateChecks(graph, "test brief");
      const reversibilityCheck = checks.find(c => c.id === "check_reversibility");
      expect(reversibilityCheck).toBeDefined();
      expect(reversibilityCheck?.category).toBe("reversibility");
    });

    it("prompts for scope when graph is complex", () => {
      const nodes = Array.from({ length: 25 }, (_, i) => ({
        id: `node${i}`,
        kind: "option" as const,
        label: `Node ${i}`,
      }));
      const edges = Array.from({ length: 35 }, (_, i) => ({
        from: `node${i % 25}`,
        to: `node${(i + 1) % 25}`,
      }));
      const graph = createGraph({ nodes, edges });
      const checks = generateChecks(graph, "test brief");
      const scopeCheck = checks.find(c => c.id === "check_scope_complexity");
      expect(scopeCheck).toBeDefined();
      expect(scopeCheck?.category).toBe("scope");
    });

    it("limits to 5 checks", () => {
      const graph = createGraph({
        nodes: [
          { id: "act1", kind: "action", label: "Action" },
        ],
      });
      const checks = generateChecks(graph, "urgent decision about stakeholder pricing");
      expect(checks.length).toBeLessThanOrEqual(5);
    });
  });

  describe("generateFramingNudges", () => {
    it("warns about anchoring when numbers present", () => {
      const graph = createGraph();
      const nudges = generateFramingNudges(graph, "Should we price at $50,000?");
      const anchoringNudge = nudges.find(n => n.type === "anchoring_warning");
      expect(anchoringNudge).toBeDefined();
      expect(anchoringNudge?.severity).toBe("info");
    });

    it("warns about time pressure", () => {
      const graph = createGraph();
      const nudges = generateFramingNudges(graph, "We need to decide immediately!");
      const timeNudge = nudges.find(n => n.type === "time_pressure");
      expect(timeNudge).toBeDefined();
      expect(timeNudge?.severity).toBe("warning");
    });

    it("warns about sunk cost language", () => {
      const graph = createGraph();
      const nudges = generateFramingNudges(graph, "We have already invested $1M in this project");
      const sunkCostNudge = nudges.find(n => n.type === "sunk_cost");
      expect(sunkCostNudge).toBeDefined();
      expect(sunkCostNudge?.severity).toBe("warning");
    });

    it("prompts about scope when many options", () => {
      const nodes = Array.from({ length: 7 }, (_, i) => ({
        id: `opt${i}`,
        kind: "option" as const,
        label: `Option ${i}`,
      }));
      const graph = createGraph({ nodes });
      const nudges = generateFramingNudges(graph, "test brief");
      const scopeNudge = nudges.find(n => n.type === "scope_prompt");
      expect(scopeNudge).toBeDefined();
    });

    it("prompts about status quo when mentioned", () => {
      const graph = createGraph();
      const nudges = generateFramingNudges(graph, "Should we continue with the current approach?");
      const statusQuoNudge = nudges.find(n => n.type === "alternatives_prompt");
      expect(statusQuoNudge).toBeDefined();
    });

    it("limits to 3 nudges", () => {
      const nodes = Array.from({ length: 7 }, (_, i) => ({
        id: `opt${i}`,
        kind: "option" as const,
        label: `Option ${i}`,
      }));
      const graph = createGraph({ nodes });
      const nudges = generateFramingNudges(
        graph,
        "We have already invested $50,000 and need to decide immediately on the current approach"
      );
      expect(nudges.length).toBeLessThanOrEqual(3);
    });
  });

  describe("generatePreDecisionChecklist", () => {
    it("returns both checks and framing_nudges", () => {
      const graph = createGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Option 1" },
        ],
      });
      const result = generatePreDecisionChecklist(graph, "Should we invest $100K immediately?");
      expect(result.checks).toBeDefined();
      expect(result.framing_nudges).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
      expect(Array.isArray(result.framing_nudges)).toBe(true);
    });

    it("all checks have required fields", () => {
      const graph = createGraph();
      const result = generatePreDecisionChecklist(graph, "test brief");
      result.checks.forEach(check => {
        expect(check.id).toBeTruthy();
        expect(check.category).toBeTruthy();
        expect(check.question).toBeTruthy();
        expect(check.why_it_matters).toBeTruthy();
      });
    });

    it("all nudges have required fields", () => {
      const graph = createGraph();
      const result = generatePreDecisionChecklist(
        graph,
        "We already invested $50K and need to decide urgently"
      );
      result.framing_nudges.forEach(nudge => {
        expect(nudge.id).toBeTruthy();
        expect(nudge.type).toBeTruthy();
        expect(nudge.message).toBeTruthy();
        expect(["info", "warning"]).toContain(nudge.severity);
      });
    });
  });
});
