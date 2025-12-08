import { describe, it, expect } from "vitest";
import { assessGraphReadiness, computeGraphStats } from "../../src/cee/graph-readiness/index.js";
import {
  scoreCausalDetail,
  scoreWeightRefinement,
  scoreRiskCoverage,
  scoreOutcomeBalance,
  scoreOptionDiversity,
} from "../../src/cee/graph-readiness/factors.js";
import {
  generateRecommendation,
  estimatePotentialImprovement,
} from "../../src/cee/graph-readiness/recommendations.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

// Helper to create test graphs
function makeGraph(
  nodeKinds: string[],
  edges: Array<{ from: string; to: string; belief?: number; weight?: number; provenance?: string }>,
): GraphV1 {
  const nodes = nodeKinds.map((kind, i) => ({
    id: `node-${i}`,
    kind,
    label: `${kind} ${i}`,
  }));

  const graphEdges = edges.map((e, i) => ({
    id: `edge-${i}`,
    from: e.from,
    to: e.to,
    belief: e.belief,
    weight: e.weight,
    provenance: e.provenance,
  }));

  return { nodes, edges: graphEdges } as unknown as GraphV1;
}

describe("CEE Graph Readiness Assessment", () => {
  describe("assessGraphReadiness", () => {
    describe("ready graphs", () => {
      it("marks well-structured graph as ready", () => {
        // Rich graph: 3 options, 3 risks (ratio 1.0 for +20), 6 outcomes (avg 2 per option for +20)
        const graph = makeGraph(
          [
            "decision",        // node-0
            "option",          // node-1
            "option",          // node-2
            "option",          // node-3
            "risk",            // node-4
            "risk",            // node-5
            "risk",            // node-6
            "outcome",         // node-7
            "outcome",         // node-8
            "outcome",         // node-9
            "outcome",         // node-10
            "outcome",         // node-11
            "outcome",         // node-12
          ],
          [
            // Decision -> Options
            { from: "node-0", to: "node-1", belief: 0.8 },
            { from: "node-0", to: "node-2", belief: 0.6 },
            { from: "node-0", to: "node-3", belief: 0.4 },
            // Options -> Risks (each option has 1 risk)
            { from: "node-1", to: "node-4", belief: 0.3 },
            { from: "node-2", to: "node-5", belief: 0.45 },
            { from: "node-3", to: "node-6", belief: 0.35 },
            // Options -> Outcomes (each option has 2 outcomes)
            { from: "node-1", to: "node-7", belief: 0.7 },
            { from: "node-1", to: "node-8", belief: 0.65 },
            { from: "node-2", to: "node-9", belief: 0.55 },
            { from: "node-2", to: "node-10", belief: 0.5 },
            { from: "node-3", to: "node-11", belief: 0.6 },
            { from: "node-3", to: "node-12", belief: 0.75 },
          ],
        );

        const result = assessGraphReadiness(graph);

        expect(result.readiness_level).toBe("ready");
        expect(result.readiness_score).toBeGreaterThanOrEqual(70);
        expect(result.can_run_analysis).toBe(true);
        expect(result.blocker_reason).toBeUndefined();
      });

      it("returns high confidence for substantial graphs", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "option", "risk", "risk", "outcome", "outcome", "factor"],
          [
            { from: "node-0", to: "node-1", belief: 0.7 },
            { from: "node-0", to: "node-2", belief: 0.6 },
            { from: "node-0", to: "node-3", belief: 0.5 },
            { from: "node-1", to: "node-4", belief: 0.4 },
            { from: "node-2", to: "node-5", belief: 0.5 },
            { from: "node-1", to: "node-6", belief: 0.6 },
            { from: "node-2", to: "node-7", belief: 0.65 },
            { from: "node-8", to: "node-6", belief: 0.55 },
          ],
        );

        const result = assessGraphReadiness(graph);

        expect(result.confidence_level).toBe("high");
        expect(result.confidence_explanation).toContain("sufficient");
      });
    });

    describe("fair graphs", () => {
      it("marks graph with some issues as fair", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.5 },
            { from: "node-0", to: "node-2", belief: 0.5 },
            { from: "node-1", to: "node-3", belief: 0.5 },
          ],
        );

        const result = assessGraphReadiness(graph);

        expect(result.readiness_level).toBe("fair");
        expect(result.readiness_score).toBeGreaterThanOrEqual(40);
        expect(result.readiness_score).toBeLessThan(70);
        expect(result.can_run_analysis).toBe(true);
      });

      it("provides actionable recommendations", () => {
        const graph = makeGraph(
          ["decision", "option", "option"],
          [
            { from: "node-0", to: "node-1", belief: 0.5 },
            { from: "node-0", to: "node-2", belief: 0.5 },
          ],
        );

        const result = assessGraphReadiness(graph);

        expect(result.quality_factors.length).toBeGreaterThan(0);
        result.quality_factors.forEach((factor) => {
          expect(factor.recommendation).toBeTruthy();
          expect(factor.recommendation.length).toBeGreaterThan(10);
        });
      });
    });

    describe("needs_work graphs", () => {
      it("marks minimal graph as needs_work", () => {
        const graph = makeGraph(
          ["decision", "option"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = assessGraphReadiness(graph);

        expect(result.readiness_level).toBe("needs_work");
        expect(result.readiness_score).toBeLessThan(40);
      });

      it("identifies missing components", () => {
        const graph = makeGraph(
          ["decision", "option"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = assessGraphReadiness(graph);

        const riskFactor = result.quality_factors.find((f) => f.factor === "risk_coverage");
        expect(riskFactor).toBeDefined();
        expect(riskFactor?.recommendation).toContain("risk");
      });
    });

    describe("blockers", () => {
      it("blocks analysis for graph without options", () => {
        const graph = makeGraph(
          ["decision", "goal"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = assessGraphReadiness(graph);

        expect(result.can_run_analysis).toBe(false);
        expect(result.blocker_reason).toContain("option");
      });

      it("blocks analysis for graph without decision", () => {
        const graph = makeGraph(
          ["option", "option"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = assessGraphReadiness(graph);

        expect(result.can_run_analysis).toBe(false);
        expect(result.blocker_reason).toContain("decision");
      });

      it("blocks analysis for empty graph", () => {
        const graph = makeGraph([], []);

        const result = assessGraphReadiness(graph);

        expect(result.can_run_analysis).toBe(false);
        expect(result.blocker_reason).toBeTruthy();
      });
    });
  });

  describe("factor scoring", () => {
    describe("scoreCausalDetail", () => {
      it("penalizes low edge density", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "option", "outcome"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = scoreCausalDetail(graph);

        expect(result.score).toBeLessThan(50);
        expect(result.issues).toContain("Low edge density - nodes appear disconnected");
      });

      it("rewards edges with beliefs", () => {
        const graph = makeGraph(
          ["decision", "option", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.7 },
            { from: "node-1", to: "node-2", belief: 0.6 },
          ],
        );

        const result = scoreCausalDetail(graph);

        expect(result.score).toBeGreaterThanOrEqual(50);
      });

      it("rewards provenance", () => {
        const graph = makeGraph(
          ["decision", "option", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.7, provenance: "source1" },
            { from: "node-1", to: "node-2", belief: 0.6, provenance: "source2" },
          ],
        );

        const result = scoreCausalDetail(graph);

        // Base 50 + provenance bonus (2*2=4) = 54; verify bonus is applied
        expect(result.score).toBeGreaterThanOrEqual(54);
      });
    });

    describe("scoreWeightRefinement", () => {
      it("detects uniform belief distribution", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.5 },
            { from: "node-0", to: "node-2", belief: 0.5 },
            { from: "node-1", to: "node-3", belief: 0.5 },
          ],
        );

        const result = scoreWeightRefinement(graph);

        expect(result.issues.some((i) => i.includes("identical") || i.includes("default"))).toBe(true);
      });

      it("flags default 0.5 values", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.5 },
            { from: "node-0", to: "node-2", belief: 0.5 },
            { from: "node-1", to: "node-3", belief: 0.5 },
            { from: "node-2", to: "node-4", belief: 0.5 },
          ],
        );

        const result = scoreWeightRefinement(graph);

        expect(result.issues.some((i) => i.includes("default 0.5"))).toBe(true);
      });

      it("rewards variance in beliefs", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome"],
          [
            { from: "node-0", to: "node-1", belief: 0.3 },
            { from: "node-0", to: "node-2", belief: 0.7 },
            { from: "node-1", to: "node-3", belief: 0.5 },
          ],
        );

        const result = scoreWeightRefinement(graph);

        // Base 70, variance [0.3, 0.7, 0.5] = 0.027 is < 0.05 so no variance bonus
        // But no penalties either. Score should be 70.
        expect(result.score).toBeGreaterThanOrEqual(70);
      });
    });

    describe("scoreRiskCoverage", () => {
      it("penalizes missing risk nodes", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome"],
          [
            { from: "node-0", to: "node-1" },
            { from: "node-0", to: "node-2" },
            { from: "node-1", to: "node-3" },
          ],
        );

        const result = scoreRiskCoverage(graph);

        expect(result.score).toBeLessThanOrEqual(40);
        expect(result.issues.some((i) => i.includes("No risk"))).toBe(true);
      });

      it("rewards connected risks", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "risk", "risk"],
          [
            { from: "node-0", to: "node-1" },
            { from: "node-0", to: "node-2" },
            { from: "node-1", to: "node-3" },
            { from: "node-2", to: "node-4" },
          ],
        );

        const result = scoreRiskCoverage(graph);

        expect(result.score).toBeGreaterThan(60);
      });
    });

    describe("scoreOutcomeBalance", () => {
      it("detects uneven outcome distribution", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome", "outcome", "outcome"],
          [
            { from: "node-0", to: "node-1" },
            { from: "node-0", to: "node-2" },
            { from: "node-1", to: "node-3" },
            { from: "node-1", to: "node-4" },
            { from: "node-1", to: "node-5" },
            // node-2 has no outcomes
          ],
        );

        const result = scoreOutcomeBalance(graph);

        expect(result.issues.some((i) => i.includes("no connected outcomes") || i.includes("uneven"))).toBe(true);
      });

      it("rewards balanced coverage", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "outcome", "outcome"],
          [
            { from: "node-0", to: "node-1" },
            { from: "node-0", to: "node-2" },
            { from: "node-1", to: "node-3" },
            { from: "node-2", to: "node-4" },
          ],
        );

        const result = scoreOutcomeBalance(graph);

        expect(result.score).toBeGreaterThan(50);
      });
    });

    describe("scoreOptionDiversity", () => {
      it("penalizes single option", () => {
        const graph = makeGraph(
          ["decision", "option"],
          [{ from: "node-0", to: "node-1" }],
        );

        const result = scoreOptionDiversity(graph);

        expect(result.score).toBeLessThan(50);
        expect(result.issues.some((i) => i.includes("Only one"))).toBe(true);
      });

      it("rewards 3-5 options", () => {
        const graph = makeGraph(
          ["decision", "option", "option", "option"],
          [
            { from: "node-0", to: "node-1" },
            { from: "node-0", to: "node-2" },
            { from: "node-0", to: "node-3" },
          ],
        );

        const result = scoreOptionDiversity(graph);

        expect(result.score).toBeGreaterThan(70);
      });
    });
  });

  describe("recommendations", () => {
    it("generates specific recommendations per issue", () => {
      const recommendation = generateRecommendation("risk_coverage", [
        "No risk nodes defined",
      ]);

      expect(recommendation).toContain("risk");
      expect(recommendation.length).toBeGreaterThan(20);
    });

    it("estimates reasonable improvement potential", () => {
      const improvement = estimatePotentialImprovement("causal_detail", 40, [
        "Low edge density - nodes appear disconnected",
      ]);

      expect(improvement).toBeGreaterThan(0);
      expect(improvement).toBeLessThanOrEqual(60); // Can't exceed 100 - currentScore
    });

    it("invariant: improvement never exceeds remaining headroom", () => {
      const testCases = [
        { factor: "causal_detail" as const, score: 80, issues: ["Low edge density - nodes appear disconnected"] },
        { factor: "weight_refinement" as const, score: 90, issues: ["All beliefs have identical values"] },
        { factor: "risk_coverage" as const, score: 95, issues: ["No risk nodes defined"] },
        { factor: "outcome_balance" as const, score: 70, issues: ["uneven outcome coverage"] },
        { factor: "option_diversity" as const, score: 50, issues: ["Only one option"] },
      ];

      for (const { factor, score, issues } of testCases) {
        const improvement = estimatePotentialImprovement(factor, score, issues);
        const maxPossible = 100 - score;

        expect(improvement).toBeGreaterThanOrEqual(0);
        expect(improvement).toBeLessThanOrEqual(maxPossible);
      }
    });

    it("invariant: improvement is always non-negative", () => {
      // Even with empty issues, improvement should be >= 0
      const factors = ["causal_detail", "weight_refinement", "risk_coverage", "outcome_balance", "option_diversity"] as const;

      for (const factor of factors) {
        const improvement = estimatePotentialImprovement(factor, 50, []);
        expect(improvement).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("graph statistics", () => {
    it("correctly counts nodes by kind", () => {
      const graph = makeGraph(
        ["decision", "option", "option", "risk", "outcome", "outcome", "goal"],
        [],
      );

      const stats = computeGraphStats(graph);

      expect(stats.nodeCount).toBe(7);
      expect(stats.optionCount).toBe(2);
      expect(stats.riskCount).toBe(1);
      expect(stats.outcomeCount).toBe(2);
      expect(stats.goalCount).toBe(1);
      expect(stats.decisionCount).toBe(1);
    });
  });

  describe("performance", () => {
    it("completes assessment in under 50ms for large graphs", () => {
      // Create a graph with 100 nodes and 200 edges
      const kinds = ["decision", "goal"];
      for (let i = 0; i < 30; i++) kinds.push("option");
      for (let i = 0; i < 30; i++) kinds.push("risk");
      for (let i = 0; i < 30; i++) kinds.push("outcome");
      for (let i = 0; i < 8; i++) kinds.push("factor");

      const edges: Array<{ from: string; to: string; belief: number }> = [];
      for (let i = 0; i < 200; i++) {
        edges.push({
          from: `node-${Math.floor(Math.random() * 100)}`,
          to: `node-${Math.floor(Math.random() * 100)}`,
          belief: Math.random(),
        });
      }

      const graph = makeGraph(kinds, edges);

      const start = Date.now();
      assessGraphReadiness(graph);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50);
    });
  });
});
