import { describe, it, expect } from "vitest";
import { detectUniformStrengths } from "../../src/cee/structure/index.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

describe("detectUniformStrengths", () => {
  describe("when graph is empty or invalid", () => {
    it("returns detected: false for undefined graph", () => {
      const result = detectUniformStrengths(undefined);
      expect(result.detected).toBe(false);
      expect(result.totalEdges).toBe(0);
    });

    it("returns detected: false for graph with no edges", () => {
      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges: [],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(false);
      expect(result.totalEdges).toBe(0);
    });
  });

  describe("when edges have varied strengths", () => {
    it("returns detected: false when <80% edges have default strength", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
          { id: "o2", kind: "option" },
        ],
        edges: [
          { id: "e1", from: "d1", to: "o1", strength_mean: 0.5 },  // default
          { id: "e2", from: "d1", to: "o2", strength_mean: 0.7 },  // varied
          { id: "e3", from: "o1", to: "o2", strength_mean: -0.3 }, // varied
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(false);
      expect(result.totalEdges).toBe(3);
      expect(result.defaultStrengthCount).toBe(1);
      expect(result.defaultStrengthPercentage).toBeCloseTo(0.333, 2);
    });

    it("returns detected: false when all edges have non-default strengths", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
        ],
        edges: [
          { id: "e1", from: "d1", to: "o1", strength_mean: 0.8 },
          { id: "e2", from: "d1", to: "o1", strength_mean: -0.6 },
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(false);
      expect(result.defaultStrengthCount).toBe(0);
    });
  });

  describe("when edges have uniform default strengths", () => {
    it("returns detected: true when all edges have strength_mean 0.5", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
          { id: "o2", kind: "option" },
        ],
        edges: [
          { id: "e1", from: "d1", to: "o1", strength_mean: 0.5 },
          { id: "e2", from: "d1", to: "o2", strength_mean: 0.5 },
          { id: "e3", from: "o1", to: "o2", strength_mean: 0.5 },
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(true);
      expect(result.totalEdges).toBe(3);
      expect(result.defaultStrengthCount).toBe(3);
      expect(result.defaultStrengthPercentage).toBe(1);
    });

    it("returns detected: true when >=80% edges have default strength", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
        ],
        edges: [
          { id: "e1", from: "d1", to: "o1", strength_mean: 0.5 },
          { id: "e2", from: "d1", to: "o1", strength_mean: 0.5 },
          { id: "e3", from: "d1", to: "o1", strength_mean: 0.5 },
          { id: "e4", from: "d1", to: "o1", strength_mean: 0.5 },
          { id: "e5", from: "d1", to: "o1", strength_mean: 0.7 }, // one varied
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(true);
      expect(result.defaultStrengthPercentage).toBe(0.8);
    });

    it("includes warning when uniform strengths detected", () => {
      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges: [
          { id: "e1", from: "n1", to: "n1", strength_mean: 0.5 },
          { id: "e2", from: "n1", to: "n1", strength_mean: 0.5 },
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("uniform_edge_strengths");
      expect(result.warning?.severity).toBe("medium");
      expect(result.warning?.edge_ids).toContain("e1");
      expect(result.warning?.edge_ids).toContain("e2");
      expect(result.warning?.explanation).toContain("100%");
    });
  });

  describe("legacy weight field fallback", () => {
    it("checks weight field when strength_mean is missing", () => {
      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges: [
          { id: "e1", from: "n1", to: "n1", weight: 0.5 },
          { id: "e2", from: "n1", to: "n1", weight: 0.5 },
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(true);
      expect(result.defaultStrengthCount).toBe(2);
    });

    it("prefers strength_mean over weight", () => {
      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges: [
          { id: "e1", from: "n1", to: "n1", strength_mean: 0.7, weight: 0.5 },
          { id: "e2", from: "n1", to: "n1", strength_mean: 0.8, weight: 0.5 },
        ],
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(false);
      expect(result.defaultStrengthCount).toBe(0);
    });
  });

  describe("custom threshold", () => {
    it("respects custom threshold parameter", () => {
      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges: [
          { id: "e1", from: "n1", to: "n1", strength_mean: 0.5 },
          { id: "e2", from: "n1", to: "n1", strength_mean: 0.7 },
        ],
      } as unknown as GraphV1;

      // With default 0.8 threshold: 50% < 80%, not detected
      const result1 = detectUniformStrengths(graph);
      expect(result1.detected).toBe(false);

      // With 0.5 threshold: 50% >= 50%, detected
      const result2 = detectUniformStrengths(graph, 0.5);
      expect(result2.detected).toBe(true);
    });
  });

  describe("edge ID collection in warning", () => {
    it("caps affected edge IDs at 10 for readability", () => {
      const edges = Array.from({ length: 15 }, (_, i) => ({
        id: `e${i}`,
        from: "n1",
        to: "n1",
        strength_mean: 0.5,
      }));

      const graph = {
        nodes: [{ id: "n1", kind: "decision" }],
        edges,
      } as unknown as GraphV1;

      const result = detectUniformStrengths(graph);
      expect(result.detected).toBe(true);
      expect(result.warning?.edge_ids?.length).toBeLessThanOrEqual(10);
    });
  });
});
