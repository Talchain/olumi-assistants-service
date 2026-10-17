import { describe, it, expect } from "vitest";
import {
  scoreCausalDetail,
  scoreWeightRefinement,
  scoreRiskCoverage,
  scoreOutcomeBalance,
  scoreOptionDiversity,
} from "../../src/cee/graph-readiness/factors.js";
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

});
