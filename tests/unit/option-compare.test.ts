import { describe, it, expect } from "vitest";
import { compareOptions, comparePair, compareMatrix } from "../../src/utils/option-compare.js";
import type { GraphT } from "../../src/schemas/graph.js";

describe("option-compare", () => {
  describe("compareOptions()", () => {
    it("should compare options with different labels", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "opt_2", kind: "option", label: "Option B" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = compareOptions(graph, ["opt_1", "opt_2"]);

      expect(result.option_ids).toEqual(["opt_1", "opt_2"]);
      expect(result.fields).toHaveLength(2); // label, body
      expect(result.fields[0].field).toBe("label");
      expect(result.fields[0].status).toBe("different");
      expect(result.fields[0].values).toEqual({
        opt_1: "Option A",
        opt_2: "Option B",
      });
    });

    it("should compare options with same labels", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Same Label" },
          { id: "opt_2", kind: "option", label: "Same Label" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = compareOptions(graph, ["opt_1", "opt_2"]);

      expect(result.fields[0].field).toBe("label");
      expect(result.fields[0].status).toBe("same");
    });

    it("should detect partial status when some options lack field", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A", body: "Description A" },
          { id: "opt_2", kind: "option", label: "Option B" }, // No body
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = compareOptions(graph, ["opt_1", "opt_2"]);

      const bodyField = result.fields.find(f => f.field === "body");
      expect(bodyField?.status).toBe("partial");
      expect(bodyField?.values).toEqual({
        opt_1: "Description A",
        opt_2: undefined,
      });
    });

    it("should count edges for each option", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "opt_2", kind: "option", label: "Option B" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          { from: "opt_1", to: "outcome_1" },
          { from: "opt_1", to: "opt_2" },
          { from: "opt_2", to: "outcome_1" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = compareOptions(graph, ["opt_1", "opt_2"]);

      expect(result.edges_from).toEqual({
        opt_1: 2,
        opt_2: 1,
      });
    });

    it("should throw error if less than 2 option IDs", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "opt_1", kind: "option", label: "Option A" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      expect(() => compareOptions(graph, ["opt_1"])).toThrow("compare_options_min_two");
    });

    it("should throw error if option not found", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "opt_1", kind: "option", label: "Option A" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      expect(() => compareOptions(graph, ["opt_1", "opt_999"])).toThrow("compare_options_not_found");
    });

    it("should throw error if node is not an option", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      expect(() => compareOptions(graph, ["opt_1", "goal_1"])).toThrow("compare_options_invalid_kind");
    });

    it("should handle 3+ options", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "A" },
          { id: "opt_2", kind: "option", label: "B" },
          { id: "opt_3", kind: "option", label: "C" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = compareOptions(graph, ["opt_1", "opt_2", "opt_3"]);

      expect(result.option_ids).toHaveLength(3);
      expect(result.fields[0].values).toHaveProperty("opt_1");
      expect(result.fields[0].values).toHaveProperty("opt_2");
      expect(result.fields[0].values).toHaveProperty("opt_3");
    });
  });

  describe("comparePair()", () => {
    it("should compare two options with similarity scores", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option Alpha", body: "Description A" },
          { id: "opt_2", kind: "option", label: "Option Beta", body: "Description B" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = comparePair(graph, "opt_1", "opt_2");

      expect(result.option_a.id).toBe("opt_1");
      expect(result.option_b.id).toBe("opt_2");
      expect(result.label_diff).toBe("different");
      expect(result.body_diff).toBe("different");
      expect(result.label_similarity).toBeGreaterThan(0);
      expect(result.label_similarity).toBeLessThan(1);
      expect(result.body_similarity).toBeGreaterThan(0);
    });

    it("should return 1.0 similarity for identical labels", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Same Label" },
          { id: "opt_2", kind: "option", label: "Same Label" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = comparePair(graph, "opt_1", "opt_2");

      expect(result.label_diff).toBe("same");
      expect(result.label_similarity).toBe(1.0);
    });

    it("should handle missing label field gracefully", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option" }, // No label
          { id: "opt_2", kind: "option", label: "Label B" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = comparePair(graph, "opt_1", "opt_2");

      expect(result.label_similarity).toBeUndefined(); // No similarity when one is missing
    });

    it("should throw error if option not found", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "opt_1", kind: "option", label: "A" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      expect(() => comparePair(graph, "opt_1", "opt_999")).toThrow("compare_pair_invalid");
    });
  });

  describe("compareMatrix()", () => {
    it("should generate similarity matrix for 3 options", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A", body: "Description A" },
          { id: "opt_2", kind: "option", label: "Option B", body: "Description B" },
          { id: "opt_3", kind: "option", label: "Option C", body: "Description C" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const matrix = compareMatrix(graph, ["opt_1", "opt_2", "opt_3"]);

      // Check diagonal (self-similarity = 1.0)
      expect(matrix.opt_1.opt_1).toBe(1.0);
      expect(matrix.opt_2.opt_2).toBe(1.0);
      expect(matrix.opt_3.opt_3).toBe(1.0);

      // Check off-diagonal (similarity < 1.0)
      expect(matrix.opt_1.opt_2).toBeGreaterThan(0);
      expect(matrix.opt_1.opt_2).toBeLessThan(1.0);
      expect(matrix.opt_2.opt_3).toBeGreaterThan(0);
      expect(matrix.opt_2.opt_3).toBeLessThan(1.0);
    });

    it("should be symmetric", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "opt_1", kind: "option", label: "A" },
          { id: "opt_2", kind: "option", label: "B" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const matrix = compareMatrix(graph, ["opt_1", "opt_2"]);

      // Symmetric: matrix[i][j] == matrix[j][i]
      expect(matrix.opt_1.opt_2).toBe(matrix.opt_2.opt_1);
    });

    it("should throw error if less than 2 options", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "opt_1", kind: "option", label: "A" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      expect(() => compareMatrix(graph, ["opt_1"])).toThrow("compare_matrix_min_two");
    });
  });
});
