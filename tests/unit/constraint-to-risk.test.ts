import { describe, it, expect } from "vitest";
import {
  constraintToRiskNode,
  constraintsToRiskNodes,
  findRelatedFactor,
  type ExtractedConstraint,
} from "../../src/cee/constraint-extraction/index.js";

describe("Constraint to Risk Node Converter", () => {
  const createConstraint = (
    label: string,
    operator: "max" | "min",
    threshold: number,
    unit: string
  ): ExtractedConstraint => ({
    label,
    operator,
    threshold,
    unit,
    sourceQuote: `Constraint: ${label} ${operator} ${threshold}${unit}`,
    confidence: 0.85,
  });

  describe("constraintToRiskNode", () => {
    it("converts max constraint to risk of exceeding", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const result = constraintToRiskNode(constraint, 0);

      expect(result.node.kind).toBe("risk");
      expect(result.node.label).toContain("exceeding");
      expect(result.node.label).toContain("$500K");
      expect(result.node.label).toContain("budget");
    });

    it("converts min constraint to risk of falling below", () => {
      const constraint = createConstraint("NPS", "min", 40, "points");
      const result = constraintToRiskNode(constraint, 0);

      expect(result.node.kind).toBe("risk");
      expect(result.node.label).toContain("falling below");
      expect(result.node.label).toContain("40 points");
    });

    it("formats large currency values correctly", () => {
      const constraint = createConstraint("Revenue", "min", 1000000, "$");
      const result = constraintToRiskNode(constraint, 0);

      expect(result.node.label).toContain("$1.0M");
    });

    it("formats percentage values correctly", () => {
      const constraint = createConstraint("Margin", "min", 0.4, "%");
      const result = constraintToRiskNode(constraint, 0);

      expect(result.node.label).toContain("40%");
    });

    it("generates unique node IDs", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const result1 = constraintToRiskNode(constraint, 0);
      const result2 = constraintToRiskNode(constraint, 1);

      expect(result1.node.id).not.toBe(result2.node.id);
      expect(result1.node.id).toContain("risk_constraint");
      expect(result1.node.id).toContain("budget");
    });

    it("respects custom node ID prefix", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const result = constraintToRiskNode(constraint, 0, {
        nodeIdPrefix: "custom_risk",
      });

      expect(result.node.id).toContain("custom_risk");
    });

    it("creates edge when related factor ID provided", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const result = constraintToRiskNode(constraint, 0, {
        relatedFactorId: "factor_budget_0",
      });

      expect(result.edge).toBeDefined();
      expect(result.edge?.from).toBe("factor_budget_0");
      expect(result.edge?.to).toBe(result.node.id);
      expect(result.edge?.weight).toBe(0.8);
    });

    it("uses custom edge weight", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const result = constraintToRiskNode(constraint, 0, {
        relatedFactorId: "factor_budget_0",
        edgeWeight: 0.5,
      });

      expect(result.edge?.weight).toBe(0.5);
    });

    it("sets edge belief from constraint confidence", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      constraint.confidence = 0.9;
      const result = constraintToRiskNode(constraint, 0, {
        relatedFactorId: "factor_budget_0",
      });

      expect(result.edge?.belief).toBe(0.9);
    });

    it("truncates body to 200 characters", () => {
      const constraint = createConstraint(
        "Very Long Constraint Label That Goes On And On",
        "max",
        500000,
        "$"
      );
      const result = constraintToRiskNode(constraint, 0);

      expect(result.node.body?.length).toBeLessThanOrEqual(200);
    });
  });

  describe("constraintsToRiskNodes", () => {
    it("converts multiple constraints", () => {
      const constraints = [
        createConstraint("Budget", "max", 500000, "$"),
        createConstraint("NPS", "min", 40, "points"),
        createConstraint("Churn", "max", 0.05, "%"),
      ];

      const result = constraintsToRiskNodes(constraints);

      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.every((n) => n.kind === "risk")).toBe(true);
    });

    it("creates edges when factor ID map provided", () => {
      const constraints = [
        createConstraint("Budget", "max", 500000, "$"),
        createConstraint("NPS", "min", 40, "points"),
      ];
      const factorIdMap = new Map([
        ["budget", "factor_budget_0"],
        ["nps", "factor_nps_0"],
      ]);

      const result = constraintsToRiskNodes(constraints, factorIdMap);

      expect(result.edges).toHaveLength(2);
    });

    it("handles partial factor ID map", () => {
      const constraints = [
        createConstraint("Budget", "max", 500000, "$"),
        createConstraint("NPS", "min", 40, "points"),
      ];
      const factorIdMap = new Map([["budget", "factor_budget_0"]]);

      const result = constraintsToRiskNodes(constraints, factorIdMap);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it("returns empty arrays for empty input", () => {
      const result = constraintsToRiskNodes([]);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe("findRelatedFactor", () => {
    const factorLabels = new Map([
      ["budget", "factor_budget_0"],
      ["annual recurring revenue", "factor_arr_0"],
      ["customer acquisition cost", "factor_cac_0"],
    ]);

    it("finds exact match", () => {
      const constraint = createConstraint("Budget", "max", 500000, "$");
      const factorId = findRelatedFactor(constraint, factorLabels);

      expect(factorId).toBe("factor_budget_0");
    });

    it("finds partial match - factor contains constraint", () => {
      const constraint = createConstraint("Recurring Revenue", "min", 1000000, "$");
      const factorId = findRelatedFactor(constraint, factorLabels);

      expect(factorId).toBe("factor_arr_0");
    });

    it("finds match by keyword", () => {
      const constraint = createConstraint("Acquisition Cost Limit", "max", 500, "$");
      const factorId = findRelatedFactor(constraint, factorLabels);

      expect(factorId).toBe("factor_cac_0");
    });

    it("returns undefined for no match", () => {
      const constraint = createConstraint("Timeline", "max", 6, "months");
      const factorId = findRelatedFactor(constraint, factorLabels);

      expect(factorId).toBeUndefined();
    });

    it("is case insensitive", () => {
      const constraint = createConstraint("BUDGET", "max", 500000, "$");
      const factorId = findRelatedFactor(constraint, factorLabels);

      expect(factorId).toBe("factor_budget_0");
    });
  });
});
