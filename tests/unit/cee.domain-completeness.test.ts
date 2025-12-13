/**
 * Tests for Domain-Specific Completeness Templates
 */

import { describe, it, expect } from "vitest";
import {
  checkDomainCompleteness,
  detectDomain,
} from "../../src/cee/graph-readiness/domain-completeness.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

// Helper to create minimal test graphs
function createTestGraph(nodes: Array<{ id: string; kind: string; label: string }>): GraphV1 {
  return {
    version: "1.0",
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
    })),
    edges: [],
  } as unknown as GraphV1;
}

describe("detectDomain", () => {
  it("detects product launch domain from brief", () => {
    const result = detectDomain("We are planning to launch a new product next quarter");
    expect(result.domain).toBe("product_launch");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects pricing domain from brief", () => {
    const result = detectDomain("Should we increase our subscription pricing by 20%?");
    expect(result.domain).toBe("pricing");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects hiring domain from brief", () => {
    const result = detectDomain("We need to hire 3 new engineers for the team");
    expect(result.domain).toBe("hiring");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects investment domain from brief", () => {
    const result = detectDomain("Should we invest in Series B funding for this startup?");
    expect(result.domain).toBe("investment");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns general domain when no keywords match", () => {
    const result = detectDomain("We need to make a decision about something");
    expect(result.domain).toBe("general");
    expect(result.confidence).toBe(0);
  });

  it("detects domain from graph node labels", () => {
    const graph = createTestGraph([
      { id: "1", kind: "decision", label: "Launch timing decision" },
      { id: "2", kind: "option", label: "Launch in Q1" },
      { id: "3", kind: "risk", label: "Competition response" },
    ]);
    const result = detectDomain(undefined, graph);
    expect(result.domain).toBe("product_launch");
  });

  it("combines brief and graph for stronger detection", () => {
    const graph = createTestGraph([
      { id: "1", kind: "factor", label: "Market timing" },
    ]);
    const result = detectDomain("product release", graph);
    expect(result.domain).toBe("product_launch");
    expect(result.confidence).toBeGreaterThanOrEqual(0.33);
  });
});

describe("checkDomainCompleteness", () => {
  describe("product launch domain", () => {
    it("identifies missing critical factors", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Launch decision" },
        { id: "2", kind: "option", label: "Launch now" },
      ]);
      const result = checkDomainCompleteness(graph, "product launch strategy");

      expect(result.detected_domain).toBe("product_launch");
      expect(result.missing_factors.length).toBeGreaterThan(0);
      expect(result.missing_factors.some((f) => f.importance === "critical")).toBe(true);
    });

    it("recognizes competition factor when present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Launch decision" },
        { id: "2", kind: "option", label: "Launch now" },
        { id: "3", kind: "risk", label: "Competitor response risk" },
      ]);
      const result = checkDomainCompleteness(graph, "product launch");

      expect(result.factors_found).toContain("competition");
    });

    it("recognizes timing factor when present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Launch timing" },
        { id: "2", kind: "factor", label: "Market timing window" },
      ]);
      const result = checkDomainCompleteness(graph, "product launch");

      expect(result.factors_found).toContain("timing");
    });

    it("returns comprehensive summary when all factors present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Launch decision" },
        { id: "2", kind: "factor", label: "Competition analysis" },
        { id: "3", kind: "factor", label: "Market timing" },
        { id: "4", kind: "factor", label: "Resource allocation" },
        { id: "5", kind: "factor", label: "Product-market fit assessment" },
        { id: "6", kind: "factor", label: "Product readiness" },
        { id: "7", kind: "factor", label: "Customer support capacity" },
      ]);
      const result = checkDomainCompleteness(graph, "product launch");

      expect(result.completeness_score).toBeGreaterThanOrEqual(80);
      expect(result.summary).toContain("comprehensive");
    });
  });

  describe("pricing domain", () => {
    it("identifies missing pricing factors", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Pricing decision" },
        { id: "2", kind: "option", label: "Increase by 10%" },
      ]);
      const result = checkDomainCompleteness(graph, "subscription pricing change");

      expect(result.detected_domain).toBe("pricing");
      expect(result.missing_factors.some((f) => f.name === "elasticity")).toBe(true);
    });

    it("recognizes cost factor when present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Price point" },
        { id: "2", kind: "factor", label: "COGS and margin analysis" },
      ]);
      const result = checkDomainCompleteness(graph, "pricing strategy");

      expect(result.factors_found).toContain("cost");
    });
  });

  describe("hiring domain", () => {
    it("identifies missing hiring factors", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Hiring decision" },
        { id: "2", kind: "option", label: "Hire senior engineer" },
      ]);
      const result = checkDomainCompleteness(graph, "team expansion hiring");

      expect(result.detected_domain).toBe("hiring");
      expect(result.missing_factors.some((f) => f.name === "capacity")).toBe(true);
    });

    it("recognizes culture fit factor when present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "New hire" },
        { id: "2", kind: "factor", label: "Team culture fit assessment" },
      ]);
      const result = checkDomainCompleteness(graph, "hiring new talent");

      expect(result.factors_found).toContain("culture");
    });
  });

  describe("investment domain", () => {
    it("identifies missing investment factors", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Investment decision" },
        { id: "2", kind: "option", label: "Invest $1M" },
      ]);
      const result = checkDomainCompleteness(graph, "Series A investment");

      expect(result.detected_domain).toBe("investment");
      expect(result.missing_factors.some((f) => f.name === "roi")).toBe(true);
    });

    it("recognizes ROI and timeline factors when present", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Capital allocation" },
        { id: "2", kind: "factor", label: "Expected ROI analysis" },
        { id: "3", kind: "factor", label: "Investment horizon timeline" },
      ]);
      const result = checkDomainCompleteness(graph, "portfolio investment");

      expect(result.factors_found).toContain("roi");
      expect(result.factors_found).toContain("timeline");
    });
  });

  describe("general domain", () => {
    it("returns neutral result for general domain", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Some decision" },
        { id: "2", kind: "option", label: "Option A" },
      ]);
      const result = checkDomainCompleteness(graph, "Should we do this thing?");

      expect(result.detected_domain).toBe("general");
      expect(result.completeness_score).toBe(100);
      expect(result.missing_factors).toHaveLength(0);
    });
  });

  describe("suggestions", () => {
    it("generates actionable suggestions for missing factors", () => {
      const graph = createTestGraph([
        { id: "1", kind: "decision", label: "Launch decision" },
      ]);
      const result = checkDomainCompleteness(graph, "product launch");

      const criticalMissing = result.missing_factors.filter((f) => f.importance === "critical");
      expect(criticalMissing.length).toBeGreaterThan(0);

      for (const missing of criticalMissing) {
        expect(missing.suggestion).toContain("Important:");
        expect(missing.rationale.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("integration with assessGraphReadiness", () => {
  it("includes domain completeness in assessment", async () => {
    // Import dynamically to ensure fresh module
    const { assessGraphReadiness } = await import("../../src/cee/graph-readiness/index.js");

    const graph = createTestGraph([
      { id: "d1", kind: "decision", label: "Launch decision" },
      { id: "o1", kind: "option", label: "Launch in Q1" },
      { id: "o2", kind: "option", label: "Launch in Q2" },
      { id: "out1", kind: "outcome", label: "Market share gain" },
      { id: "g1", kind: "goal", label: "Increase revenue" },
    ]);

    // Add edges to satisfy minimum requirements
    (graph as any).edges = [
      { from: "d1", to: "o1", belief: 0.7, weight: 1.0 },
      { from: "d1", to: "o2", belief: 0.7, weight: 1.0 },
      { from: "o1", to: "out1", belief: 0.6, weight: 1.0 },
      { from: "out1", to: "g1", belief: 0.7, weight: 1.0 },
    ];

    const result = assessGraphReadiness(graph, { brief: "product launch strategy" });

    expect(result.domain_completeness).toBeDefined();
    expect(result.domain_completeness?.detected_domain).toBe("product_launch");
    expect(result.domain_completeness?.missing_factors.length).toBeGreaterThan(0);
  });
});
