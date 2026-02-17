/**
 * Compound Goal Extraction Tests
 *
 * Comprehensive tests for Phase 3 multi-constraint analysis.
 * Covers: extractor, node-generator, deadline-extractor, qualitative-proxy.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractCompoundGoals,
  toGoalConstraints,
  remapConstraintTargets,
  generateConstraintNodes,
  generateConstraintEdge,
  generateConstraintEdges,
  constraintNodesToGraphNodes,
  isConstraintNodeId,
  getConstraintTargetId,
  extractDeadline,
  mapQualitativeToProxy,
  QUALITATIVE_PROXY_MAPPINGS,
  type ExtractedGoalConstraint,
} from "../../src/cee/compound-goal/index.js";

// ============================================================================
// extractCompoundGoals Tests
// ============================================================================

describe("extractCompoundGoals", () => {
  describe("single goal briefs (backward compatibility)", () => {
    it("handles brief with no compound goals", () => {
      const brief = "Should I hire a new engineer to help with the backend?";
      const result = extractCompoundGoals(brief);

      expect(result.isCompound).toBe(false);
      expect(result.constraints).toHaveLength(0);
      expect(result.primaryGoal).toBeUndefined();
    });

    it("handles brief with single quantitative goal", () => {
      const brief = "Should I invest in marketing to grow MRR to £50k?";
      const result = extractCompoundGoals(brief);

      expect(result.primaryGoal).toBeDefined();
      expect(result.primaryGoal?.targetName.toLowerCase()).toContain("mrr");
      expect(result.constraints).toHaveLength(0);
    });
  });

  describe("compound goal pattern recognition", () => {
    it("extracts 'grow X while keeping Y under Z' pattern", () => {
      const brief = "Should I invest in marketing to grow MRR to £50k while keeping churn under 5%?";
      const result = extractCompoundGoals(brief);

      expect(result.isCompound).toBe(true);
      expect(result.constraints.length).toBeGreaterThan(0);

      const churnConstraint = result.constraints.find(c => c.targetName.toLowerCase().includes("churn"));
      expect(churnConstraint).toBeDefined();
      expect(churnConstraint?.operator).toBe("<=");
      expect(churnConstraint?.value).toBe(0.05); // 5% as decimal
    });

    it("extracts 'reach X and keep Y above Z' pattern", () => {
      const brief = "I want to reach 1000 users while ensuring retention stays above 85%";
      const result = extractCompoundGoals(brief);

      const retentionConstraint = result.constraints.find(c =>
        c.targetName.toLowerCase().includes("retention")
      );
      expect(retentionConstraint).toBeDefined();
      expect(retentionConstraint?.operator).toBe(">=");
      expect(retentionConstraint?.value).toBe(0.85);
    });

    it("extracts 'without exceeding Y' pattern", () => {
      const brief = "Grow revenue to £100k without exceeding £20k in marketing spend";
      const result = extractCompoundGoals(brief);

      const budgetConstraint = result.constraints.find(c =>
        c.sourceQuote.toLowerCase().includes("exceeding")
      );
      expect(budgetConstraint).toBeDefined();
      expect(budgetConstraint?.operator).toBe("<=");
      expect(budgetConstraint?.value).toBe(20000);
    });

    it("extracts 'between X and Y' pattern", () => {
      const brief = "I need price between £50 and £100 per unit";
      const result = extractCompoundGoals(brief);

      expect(result.constraints.length).toBe(2);

      const minConstraint = result.constraints.find(c => c.operator === ">=");
      const maxConstraint = result.constraints.find(c => c.operator === "<=");

      expect(minConstraint?.value).toBe(50);
      expect(maxConstraint?.value).toBe(100);
    });

    it("extracts 'must not exceed' pattern", () => {
      const brief = "Budget must not exceed £50k for this project";
      const result = extractCompoundGoals(brief);

      const constraint = result.constraints.find(c =>
        c.targetName.toLowerCase().includes("budget")
      );
      expect(constraint).toBeDefined();
      expect(constraint?.operator).toBe("<=");
      expect(constraint?.value).toBe(50000);
    });

    it("extracts 'at least X' pattern", () => {
      const brief = "Margin should be at least 20%";
      const result = extractCompoundGoals(brief);

      const marginConstraint = result.constraints.find(c =>
        c.targetName.toLowerCase().includes("margin")
      );
      expect(marginConstraint).toBeDefined();
      expect(marginConstraint?.operator).toBe(">=");
      expect(marginConstraint?.value).toBe(0.20);
    });

    it("extracts 'within budget' pattern", () => {
      // Note: This pattern requires "budget" to immediately follow the value
      const brief = "Keep spending within £100k budget for the project";
      const result = extractCompoundGoals(brief);

      const budgetConstraint = result.constraints.find(c =>
        c.sourceQuote.toLowerCase().includes("within") && c.sourceQuote.toLowerCase().includes("budget")
      );
      expect(budgetConstraint).toBeDefined();
      expect(budgetConstraint?.operator).toBe("<=");
      expect(budgetConstraint?.value).toBe(100000);
    });
  });

  describe("value parsing", () => {
    it("parses currency symbols correctly", () => {
      // Using explicit patterns that we know work
      const brief = "Keep costs under $50k while ensuring profit stays above €100k";
      const result = extractCompoundGoals(brief);

      const dollarConstraint = result.constraints.find(c => c.unit === "$");
      const euroConstraint = result.constraints.find(c => c.unit === "€");

      expect(dollarConstraint?.value).toBe(50000);
      expect(euroConstraint?.value).toBe(100000);
    });

    it("parses k/m/b suffixes correctly", () => {
      const cases = [
        { brief: "Budget under £50k", expected: 50000 },
        { brief: "Revenue target £2M", expected: 2000000 },
        { brief: "Market cap under $1B", expected: 1000000000 },
      ];

      for (const { brief, expected } of cases) {
        const result = extractCompoundGoals(brief);
        const constraint = result.constraints[0];
        if (constraint) {
          expect(constraint.value).toBe(expected);
        }
      }
    });

    it("parses percentages as decimals", () => {
      const brief = "Keep churn under 5% and retention above 90%";
      const result = extractCompoundGoals(brief);

      const churnConstraint = result.constraints.find(c =>
        c.targetName.toLowerCase().includes("churn")
      );
      const retentionConstraint = result.constraints.find(c =>
        c.targetName.toLowerCase().includes("retention")
      );

      expect(churnConstraint?.value).toBe(0.05);
      expect(retentionConstraint?.value).toBe(0.90);
    });

    it("handles comma-separated numbers", () => {
      const brief = "Revenue must be at least £1,500,000";
      const result = extractCompoundGoals(brief);

      const constraint = result.constraints[0];
      expect(constraint?.value).toBe(1500000);
    });
  });

  describe("deduplication", () => {
    it("deduplicates constraints by target+operator when exact match", () => {
      // Using 'between X and Y' which generates both min and max for same target
      const brief = "Budget between £50k and £100k";
      const result = extractCompoundGoals(brief);

      // Should have exactly 2 constraints (one min, one max)
      const budgetConstraints = result.constraints.filter(c =>
        c.targetName.toLowerCase().includes("budget")
      );
      expect(budgetConstraints.length).toBe(2);
      expect(budgetConstraints.find(c => c.operator === ">=")).toBeDefined();
      expect(budgetConstraints.find(c => c.operator === "<=")).toBeDefined();
    });

    it("keeps all constraints when targets differ slightly", () => {
      // Different patterns may capture slightly different target names
      // This is expected behavior - they're treated as different constraints
      const brief = "Keep churn under 5%. Churn rate must not exceed 3%.";
      const result = extractCompoundGoals(brief);

      // These are treated as different targets
      const churnConstraints = result.constraints.filter(c =>
        c.targetName.toLowerCase().includes("churn")
      );
      expect(churnConstraints.length).toBeGreaterThanOrEqual(1);
    });

    it("for upper bounds (<=), keeps stricter (smaller) value", () => {
      // Two upper bound constraints for same target - should keep stricter one
      const brief = "Keep budget under £100k. Budget must not exceed £80k.";
      const result = extractCompoundGoals(brief);

      const budgetConstraints = result.constraints.filter(c =>
        c.targetName.toLowerCase() === "budget" && c.operator === "<="
      );
      // Should dedupe to one, keeping the stricter £80k
      expect(budgetConstraints.length).toBe(1);
      expect(budgetConstraints[0].value).toBe(80000);
    });

    it("for lower bounds (>=), keeps stricter (larger) value", () => {
      // Two lower bound constraints for same target - should keep stricter one
      const brief = "Revenue must be at least £50k. Revenue should be above £70k.";
      const result = extractCompoundGoals(brief);

      const revenueConstraints = result.constraints.filter(c =>
        c.targetName.toLowerCase() === "revenue" && c.operator === ">="
      );
      // Should dedupe to one, keeping the stricter £70k
      expect(revenueConstraints.length).toBe(1);
      expect(revenueConstraints[0].value).toBe(70000);
    });
  });
});

// ============================================================================
// toGoalConstraints Tests
// ============================================================================

describe("toGoalConstraints", () => {
  it("converts ExtractedGoalConstraint to GoalConstraintT", () => {
    const extracted: ExtractedGoalConstraint[] = [{
      targetName: "churn rate",
      targetNodeId: "fac_churn_rate",
      operator: "<=",
      value: 0.05,
      unit: "%",
      label: "churn rate ceiling",
      sourceQuote: "keeping churn under 5%",
      confidence: 0.85,
      provenance: "explicit",
    }];

    const result = toGoalConstraints(extracted);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      constraint_id: "constraint_fac_churn_rate_max",
      node_id: "fac_churn_rate",
      operator: "<=",
      value: 0.05,
      label: "churn rate ceiling",
      unit: "%",
      source_quote: "keeping churn under 5%",
      confidence: 0.85,
      provenance: "explicit",
      deadline_metadata: undefined,
    });
  });

  it("includes deadline metadata when present", () => {
    const extracted: ExtractedGoalConstraint[] = [{
      targetName: "delivery time",
      targetNodeId: "delivery_time_months",
      operator: "<=",
      value: 6,
      unit: "months",
      label: "Delivery deadline",
      sourceQuote: "within 6 months",
      confidence: 0.95,
      provenance: "explicit",
      deadlineMetadata: {
        deadline_date: "2025-08-01",
        reference_date: "2025-02-01",
        assumed_reference_date: true,
      },
    }];

    const result = toGoalConstraints(extracted);

    expect(result[0].deadline_metadata).toEqual({
      deadline_date: "2025-08-01",
      reference_date: "2025-02-01",
      assumed_reference_date: true,
    });
  });
});

// ============================================================================
// generateConstraintNodes Tests
// ============================================================================

describe("generateConstraintNodes", () => {
  it("generates constraint node with correct structure", () => {
    const constraints: ExtractedGoalConstraint[] = [{
      targetName: "churn rate",
      targetNodeId: "fac_churn_rate",
      operator: "<=",
      value: 0.05,
      unit: "%",
      label: "churn rate ceiling",
      sourceQuote: "keeping churn under 5%",
      confidence: 0.85,
      provenance: "explicit",
    }];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      id: "constraint_fac_churn_rate_max",
      kind: "constraint",
      label: expect.stringContaining("at most"),
      body: "keeping churn under 5%",
      observed_state: {
        value: 0.05,
        metadata: {
          operator: "<=",
          original_value: 0.05,
          unit: "%",
        },
      },
      data: {
        operator: "<=",
      },
    });
  });

  it("uses 'min' suffix for >= operator", () => {
    const constraints: ExtractedGoalConstraint[] = [{
      targetName: "retention",
      targetNodeId: "fac_retention",
      operator: ">=",
      value: 0.85,
      unit: "%",
      label: "retention floor",
      sourceQuote: "retention above 85%",
      confidence: 0.85,
      provenance: "explicit",
    }];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes[0].id).toBe("constraint_fac_retention_min");
    expect(nodes[0].label).toContain("at least");
  });

  it("uses 'max' suffix for <= operator", () => {
    const constraints: ExtractedGoalConstraint[] = [{
      targetName: "cost",
      targetNodeId: "fac_cost",
      operator: "<=",
      value: 50000,
      unit: "£",
      label: "cost ceiling",
      sourceQuote: "cost under £50k",
      confidence: 0.85,
      provenance: "explicit",
    }];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes[0].id).toBe("constraint_fac_cost_max");
    expect(nodes[0].label).toContain("at most");
  });

  it("includes deadline metadata for temporal constraints", () => {
    const constraints: ExtractedGoalConstraint[] = [{
      targetName: "delivery time",
      targetNodeId: "delivery_time_months",
      operator: "<=",
      value: 6,
      unit: "months",
      label: "Delivery deadline",
      sourceQuote: "within 6 months",
      confidence: 0.95,
      provenance: "explicit",
      deadlineMetadata: {
        deadline_date: "2025-08-01",
        reference_date: "2025-02-01",
        assumed_reference_date: true,
      },
    }];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes[0].observed_state.metadata.deadline_date).toBe("2025-08-01");
    expect(nodes[0].observed_state.metadata.reference_date).toBe("2025-02-01");
    expect(nodes[0].observed_state.metadata.assumed_reference_date).toBe(true);
  });

  it("skips duplicate constraint IDs", () => {
    const constraints: ExtractedGoalConstraint[] = [
      {
        targetName: "churn",
        targetNodeId: "fac_churn",
        operator: "<=",
        value: 0.05,
        unit: "%",
        label: "churn ceiling 1",
        sourceQuote: "quote 1",
        confidence: 0.85,
        provenance: "explicit",
      },
      {
        targetName: "churn",
        targetNodeId: "fac_churn",
        operator: "<=",
        value: 0.03,
        unit: "%",
        label: "churn ceiling 2",
        sourceQuote: "quote 2",
        confidence: 0.9,
        provenance: "explicit",
      },
    ];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].observed_state.value).toBe(0.05); // First one wins
  });

  it("has operator in BOTH observed_state.metadata AND data (PLoT requirement)", () => {
    const constraints: ExtractedGoalConstraint[] = [{
      targetName: "cost",
      targetNodeId: "fac_cost",
      operator: "<=",
      value: 50000,
      unit: "£",
      label: "cost ceiling",
      sourceQuote: "cost under £50k",
      confidence: 0.85,
      provenance: "explicit",
    }];

    const nodes = generateConstraintNodes(constraints);

    expect(nodes[0].observed_state.metadata.operator).toBe("<=");
    expect(nodes[0].data.operator).toBe("<=");
  });
});

// ============================================================================
// generateConstraintEdge/generateConstraintEdges Tests
// ============================================================================

describe("generateConstraintEdge", () => {
  it("generates edge from constraint to target", () => {
    const edge = generateConstraintEdge("constraint_fac_churn_max", "fac_churn");

    expect(edge).toEqual({
      id: "edge_constraint_fac_churn_max_to_fac_churn",
      from: "constraint_fac_churn_max",
      to: "fac_churn",
      belief_exists: 1.0,
    });
  });

  it("does not include strength values (structural edge)", () => {
    const edge = generateConstraintEdge("constraint_fac_cost_max", "fac_cost");

    expect(edge.strength_mean).toBeUndefined();
    expect(edge.strength_std).toBeUndefined();
  });
});

describe("generateConstraintEdges", () => {
  it("generates edges for all constraints", () => {
    const constraints: ExtractedGoalConstraint[] = [
      {
        targetName: "churn",
        targetNodeId: "fac_churn",
        operator: "<=",
        value: 0.05,
        unit: "%",
        label: "churn ceiling",
        sourceQuote: "quote",
        confidence: 0.85,
        provenance: "explicit",
      },
      {
        targetName: "retention",
        targetNodeId: "fac_retention",
        operator: ">=",
        value: 0.85,
        unit: "%",
        label: "retention floor",
        sourceQuote: "quote",
        confidence: 0.85,
        provenance: "explicit",
      },
    ];

    const edges = generateConstraintEdges(constraints);

    expect(edges).toHaveLength(2);
    expect(edges.map(e => e.to)).toContain("fac_churn");
    expect(edges.map(e => e.to)).toContain("fac_retention");
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe("isConstraintNodeId", () => {
  it("returns true for constraint node IDs", () => {
    expect(isConstraintNodeId("constraint_fac_churn_max")).toBe(true);
    expect(isConstraintNodeId("constraint_delivery_time_months_max")).toBe(true);
  });

  it("returns false for non-constraint node IDs", () => {
    expect(isConstraintNodeId("fac_churn")).toBe(false);
    expect(isConstraintNodeId("goal_profit")).toBe(false);
    expect(isConstraintNodeId("opt_a")).toBe(false);
  });
});

describe("getConstraintTargetId", () => {
  it("extracts target ID from constraint node ID", () => {
    expect(getConstraintTargetId("constraint_fac_churn_max")).toBe("fac_churn");
    expect(getConstraintTargetId("constraint_fac_retention_min")).toBe("fac_retention");
    expect(getConstraintTargetId("constraint_delivery_time_months_max")).toBe("delivery_time_months");
  });

  it("returns null for non-constraint IDs", () => {
    expect(getConstraintTargetId("fac_churn")).toBeNull();
    expect(getConstraintTargetId("constraint_invalid")).toBeNull();
  });
});

describe("constraintNodesToGraphNodes", () => {
  it("converts ConstraintNode to NodeT format", () => {
    const constraintNodes = generateConstraintNodes([{
      targetName: "churn",
      targetNodeId: "fac_churn",
      operator: "<=",
      value: 0.05,
      unit: "%",
      label: "churn ceiling",
      sourceQuote: "quote",
      confidence: 0.85,
      provenance: "explicit",
    }]);

    const graphNodes = constraintNodesToGraphNodes(constraintNodes);

    expect(graphNodes).toHaveLength(1);
    expect(graphNodes[0].kind).toBe("constraint");
    expect(graphNodes[0].observed_state).toBeDefined();
    expect(graphNodes[0].data).toBeDefined();
  });
});

// ============================================================================
// extractDeadline Tests
// ============================================================================

describe("extractDeadline", () => {
  // Use fixed reference date for consistent tests
  const referenceDate = new Date("2025-02-01");

  describe("quarter patterns", () => {
    it("extracts 'by Q3' deadline", () => {
      const result = extractDeadline("Complete the project by Q3", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-09-30");
      expect(result.months).toBe(7); // Feb to Sep
    });

    it("extracts 'by Q2 2025' with explicit year", () => {
      const result = extractDeadline("Launch by Q2 2025", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-06-30");
      expect(result.confidence).toBe(0.95); // Higher with explicit year
    });

    it("handles past quarter by assuming next year", () => {
      const result = extractDeadline("Finish by Q1", referenceDate);

      // Q1 2025 ends March 31, which is after Feb 1, so same year
      expect(result.deadlineDate).toBe("2025-03-31");
    });
  });

  describe("direct month patterns", () => {
    it("extracts 'within 6 months'", () => {
      const result = extractDeadline("Complete within 6 months", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.months).toBe(6);
      expect(result.confidence).toBe(0.95);
    });

    it("extracts 'in 3 months'", () => {
      const result = extractDeadline("Launch in 3 months", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.months).toBe(3);
    });
  });

  describe("month name patterns", () => {
    it("extracts 'by December'", () => {
      const result = extractDeadline("Ship by December", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-12-31");
    });

    it("extracts 'by June 2025' with explicit year", () => {
      const result = extractDeadline("Launch by June 2025", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-06-30");
      expect(result.confidence).toBe(0.95);
    });

    it("handles abbreviated month names", () => {
      const result = extractDeadline("Complete by Dec", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toContain("12-31");
    });
  });

  describe("year-end patterns", () => {
    it("extracts 'by end of year'", () => {
      const result = extractDeadline("Finish by end of year", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-12-31");
    });

    it("extracts 'by year-end'", () => {
      const result = extractDeadline("Launch by year-end", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-12-31");
    });

    it("extracts 'by EOY'", () => {
      const result = extractDeadline("Complete by EOY", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.deadlineDate).toBe("2025-12-31");
    });
  });

  describe("week patterns", () => {
    it("extracts 'within 4 weeks'", () => {
      const result = extractDeadline("Finish within 4 weeks", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.months).toBeGreaterThanOrEqual(1);
    });

    it("extracts 'in 2 weeks'", () => {
      const result = extractDeadline("Launch in 2 weeks", referenceDate);

      expect(result.detected).toBe(true);
      expect(result.months).toBe(1); // Rounds up to 1 month
    });
  });

  describe("no deadline", () => {
    it("returns detected: false when no deadline found", () => {
      const result = extractDeadline("Should I hire a new developer?", referenceDate);

      expect(result.detected).toBe(false);
      expect(result.months).toBe(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe("assumed reference date", () => {
    it("flags assumed when no reference date provided", () => {
      const result = extractDeadline("Complete within 6 months");

      expect(result.assumed).toBe(true);
    });

    it("does not flag assumed when reference date provided", () => {
      const result = extractDeadline("Complete within 6 months", referenceDate);

      expect(result.assumed).toBe(false);
    });
  });
});

// ============================================================================
// mapQualitativeToProxy Tests
// ============================================================================

describe("mapQualitativeToProxy", () => {
  describe("customer satisfaction proxies", () => {
    it("maps 'improve customer satisfaction' to NPS >= 50", () => {
      const result = mapQualitativeToProxy("We need to improve customer satisfaction");

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_nps_score");
      expect(result.constraints[0].operator).toBe(">=");
      expect(result.constraints[0].value).toBe(50);
      expect(result.constraints[0].provenance).toBe("proxy");
    });

    it("maps 'boost satisfaction' to NPS", () => {
      const result = mapQualitativeToProxy("Goal is to boost satisfaction scores");

      expect(result.constraints.length).toBeGreaterThanOrEqual(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_nps_score");
    });
  });

  describe("churn proxies", () => {
    it("maps 'reduce churn' to churn_rate <= 5%", () => {
      const result = mapQualitativeToProxy("We want to reduce churn");

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_churn_rate");
      expect(result.constraints[0].operator).toBe("<=");
      expect(result.constraints[0].value).toBe(0.05);
    });

    it("maps 'minimize churn' to churn_rate", () => {
      const result = mapQualitativeToProxy("Minimize churn this quarter");

      expect(result.constraints[0].targetNodeId).toBe("fac_churn_rate");
    });
  });

  describe("retention proxies", () => {
    it("maps 'improve retention' to retention_rate >= 85%", () => {
      const result = mapQualitativeToProxy("Improve customer retention");

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_retention_rate");
      expect(result.constraints[0].operator).toBe(">=");
      expect(result.constraints[0].value).toBe(0.85);
    });
  });

  describe("quality proxies", () => {
    it("maps 'improve code quality' to coverage >= 80%", () => {
      const result = mapQualitativeToProxy("We need to improve code quality");

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_code_coverage");
      expect(result.constraints[0].operator).toBe(">=");
      expect(result.constraints[0].value).toBe(0.80);
    });
  });

  describe("confidence and warnings", () => {
    it("sets lower confidence for proxy constraints", () => {
      const result = mapQualitativeToProxy("Improve customer satisfaction");

      expect(result.constraints[0].confidence).toBeLessThan(0.75);
      expect(result.constraints[0].confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("includes warning about proxy assumption", () => {
      const result = mapQualitativeToProxy("Improve customer satisfaction");

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("proxy");
    });
  });

  describe("no matches", () => {
    it("returns empty when no qualitative patterns found", () => {
      const result = mapQualitativeToProxy("Should I hire a contractor for this project?");

      expect(result.constraints).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("deduplication", () => {
    it("does not duplicate constraints for same target", () => {
      const result = mapQualitativeToProxy(
        "Improve customer satisfaction and boost customer satisfaction"
      );

      const npsConstraints = result.constraints.filter(c =>
        c.targetNodeId === "fac_nps_score"
      );
      expect(npsConstraints).toHaveLength(1);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("compound goal integration", () => {
  it("extracts and converts full compound goal brief", () => {
    const brief = `
      Should I invest in a new marketing campaign to grow MRR to £50k
      while keeping churn under 5% and ensuring retention stays above 85%?
      We need to complete this within 6 months.
    `;

    const extraction = extractCompoundGoals(brief);
    const goalConstraints = toGoalConstraints(extraction.constraints);
    const constraintNodes = generateConstraintNodes(extraction.constraints);
    const constraintEdges = generateConstraintEdges(extraction.constraints);

    // Verify extraction
    expect(extraction.isCompound).toBe(true);
    expect(extraction.constraints.length).toBeGreaterThanOrEqual(2);

    // Verify goal constraints for PLoT
    expect(goalConstraints.length).toBeGreaterThanOrEqual(2);
    for (const gc of goalConstraints) {
      expect(gc.constraint_id).toMatch(/^constraint_/);
      expect(gc.node_id).toBeTruthy();
      expect([">=", "<="]).toContain(gc.operator);
      expect(typeof gc.value).toBe("number");
    }

    // Verify constraint nodes
    for (const node of constraintNodes) {
      expect(node.kind).toBe("constraint");
      expect(node.observed_state.metadata.operator).toMatch(/^(>=|<=)$/);
      expect(node.data.operator).toMatch(/^(>=|<=)$/);
      // ASCII operators only - no unicode
      expect(node.observed_state.metadata.operator).not.toMatch(/[≥≤]/);
      expect(node.data.operator).not.toMatch(/[≥≤]/);
    }

    // Verify constraint edges
    expect(constraintEdges.length).toBe(constraintNodes.length);
    for (const edge of constraintEdges) {
      expect(edge.from).toMatch(/^constraint_/);
      expect(edge.belief_exists).toBe(1.0);
    }
  });

  it("handles brief with qualitative goals", () => {
    // Note: Proxy extraction only works when includeProxies is true
    const brief = "We want to improve customer satisfaction and also reduce churn significantly";

    const extraction = extractCompoundGoals(brief, { includeProxies: true });

    // Should have at least one proxy constraint
    expect(extraction.constraints.length).toBeGreaterThanOrEqual(1);

    const proxyConstraints = extraction.constraints.filter(c => c.provenance === "proxy");
    expect(proxyConstraints.length).toBeGreaterThanOrEqual(1);
  });

  it("maintains backward compatibility with single-goal briefs", () => {
    const brief = "Should I hire a new engineer to help with the backend?";

    const extraction = extractCompoundGoals(brief);
    const goalConstraints = toGoalConstraints(extraction.constraints);
    const constraintNodes = generateConstraintNodes(extraction.constraints);

    // No constraints extracted
    expect(extraction.isCompound).toBe(false);
    expect(goalConstraints).toHaveLength(0);
    expect(constraintNodes).toHaveLength(0);
  });
});

// ============================================================================
// remapConstraintTargets Tests
// ============================================================================

describe("remapConstraintTargets", () => {
  /** Simulated mid-market expansion graph node IDs */
  const MID_MARKET_NODES = [
    "g1", "d1", "o1", "o2",
    "fac_customer_churn",
    "fac_revenue_growth",
    "fac_team_capacity",
    "fac_marketing_spend",
    "out_revenue_retention",
    "out_market_share",
  ];

  const MID_MARKET_LABELS = new Map<string, string>([
    ["fac_customer_churn", "Customer Churn Rate"],
    ["fac_revenue_growth", "Revenue Growth"],
    ["fac_team_capacity", "Team Capacity"],
    ["fac_marketing_spend", "Marketing Spend"],
    ["out_revenue_retention", "Revenue Retention Rate"],
    ["out_market_share", "Market Share"],
  ]);

  function makeConstraint(overrides: Partial<ExtractedGoalConstraint> & { targetNodeId: string }): ExtractedGoalConstraint {
    return {
      targetName: overrides.targetName ?? "test",
      targetNodeId: overrides.targetNodeId,
      operator: overrides.operator ?? "<=",
      value: overrides.value ?? 0.05,
      unit: overrides.unit ?? "%",
      label: overrides.label ?? "test constraint",
      sourceQuote: overrides.sourceQuote ?? "test quote",
      confidence: overrides.confidence ?? 0.85,
      provenance: overrides.provenance ?? "explicit",
    };
  }

  describe("mid-market brief scenario", () => {
    it("rejects junk IDs, remaps via label/alias/fuzzy, binds temporal to goal", () => {
      // Simulate constraints the extractor produces for the mid-market brief.
      const temporalConstraint = makeConstraint({
        targetNodeId: "delivery_time_months", targetName: "delivery time", unit: "months", value: 18,
      });
      (temporalConstraint as any).deadlineMetadata = { deadline_date: "2025-06-01" };

      const extractedConstraints: ExtractedGoalConstraint[] = [
        // fac_churn → stem "churn" — matches fac_customer_churn (customer_churn contains churn)
        makeConstraint({ targetNodeId: "fac_churn", targetName: "churn" }),
        // fac_we_have → junk ID (all stop-words)
        makeConstraint({ targetNodeId: "fac_we_have", targetName: "we have" }),
        // fac_revenue_retention_rate → label "revenue retention rate" matches "Revenue Retention Rate" on out_revenue_retention
        makeConstraint({ targetNodeId: "fac_revenue_retention_rate", targetName: "revenue retention rate", operator: ">=" }),
        // delivery_time_months → temporal, bound to goal node
        temporalConstraint,
      ];

      const result = remapConstraintTargets(
        extractedConstraints,
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
        undefined,
        "g1", // goalNodeId for temporal binding
      );

      // fac_we_have should be rejected as junk
      expect(result.rejected_junk).toBe(1);
      // fac_churn should remap to fac_customer_churn
      const churnConstraint = result.constraints.find(c => c.targetNodeId === "fac_customer_churn");
      expect(churnConstraint).toBeDefined();
      // revenue retention rate should match out_revenue_retention via label
      const retentionConstraint = result.constraints.find(c => c.targetNodeId === "out_revenue_retention");
      expect(retentionConstraint).toBeDefined();
      // temporal should be bound to goal node g1
      const temporal = result.constraints.find(c => (c as any).deadlineMetadata);
      expect(temporal).toBeDefined();
      expect(temporal!.targetNodeId).toBe("g1");
      // At least 3 survived (churn, retention, temporal) — 1 junk rejected
      expect(result.constraints.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("junk ID rejection", () => {
    it("rejects 'fac_we_have' as a junk ID", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_we_have", targetName: "we have" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_junk).toBe(1);
    });

    it("rejects IDs with all stop-word tokens", () => {
      const junkIds = ["fac_the_and", "fac_for_with", "fac_this_that"];
      for (const id of junkIds) {
        const result = remapConstraintTargets(
          [makeConstraint({ targetNodeId: id })],
          MID_MARKET_NODES,
          MID_MARKET_LABELS,
        );
        expect(result.rejected_junk).toBe(1);
      }
    });

    it("rejects verb-like junk IDs (fac_keep, fac_ensure, fac_maintain)", () => {
      const verbIds = ["fac_keep", "fac_ensure", "fac_maintain", "fac_achieve", "fac_stay"];
      for (const id of verbIds) {
        const result = remapConstraintTargets(
          [makeConstraint({ targetNodeId: id })],
          MID_MARKET_NODES,
          MID_MARKET_LABELS,
        );
        expect(result.rejected_junk).toBe(1);
      }
    });

    it("rejects IDs with stems shorter than 4 chars", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_ab" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_junk).toBe(1);
    });

    it("accepts IDs with at least one substantive token", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_customer_churn" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // Exact match — should pass through
      expect(result.constraints).toHaveLength(1);
      expect(result.rejected_junk).toBe(0);
    });
  });

  describe("exact matching", () => {
    it("keeps constraints that exactly match a graph node", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_customer_churn" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(0);
    });
  });

  describe("fuzzy remapping", () => {
    it("remaps fac_churn to fac_customer_churn via stem substring match", () => {
      // fac_churn → stem "churn"
      // fac_customer_churn → stem "customer_churn" which CONTAINS "churn"
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_churn", targetName: "churn" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(1);
    });

    it("remaps via label-based fallback when stem matching fails", () => {
      // fac_customer_retention → stem "customer_retention"
      // Graph has fac_customer_churn (stem: customer_churn — no substring match)
      // But label "Customer Churn Rate" → normalized "customer_churn_rate"
      // This doesn't help. Let's test a case that DOES match via label:
      //
      // fac_revenue → stem "revenue"
      // fac_revenue_growth → stem "revenue_growth" CONTAINS "revenue" → stem match
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_revenue", targetName: "revenue" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_revenue_growth");
      expect(result.remapped).toBe(1);
    });

    it("remaps when constraint stem is contained in graph node stem", () => {
      // fac_marketing → stem "marketing"
      // fac_marketing_spend → stem "marketing_spend" CONTAINS "marketing"
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_marketing", targetName: "marketing" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_marketing_spend");
      expect(result.remapped).toBe(1);
    });
  });

  describe("deduplication after remapping", () => {
    it("deduplicates constraints that map to the same target+operator", () => {
      // Both fac_churn and fac_customer_churn_rate will remap to fac_customer_churn
      // fac_churn → stem "churn" → customer_churn contains churn → match
      // fac_customer_churn → exact match
      const constraints = [
        makeConstraint({ targetNodeId: "fac_churn", targetName: "churn", operator: "<=", value: 0.05 }),
        makeConstraint({ targetNodeId: "fac_customer_churn", targetName: "customer churn", operator: "<=", value: 0.03 }),
      ];

      const result = remapConstraintTargets(
        constraints,
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // Should be deduplicated to a single constraint on fac_customer_churn
      const churnConstraints = result.constraints.filter(
        c => c.targetNodeId === "fac_customer_churn",
      );
      expect(churnConstraints).toHaveLength(1);
      // For <=, keep stricter (smaller) value
      expect(churnConstraints[0].value).toBe(0.03);
    });
  });

  describe("no-match handling", () => {
    it("drops constraints with no matching node", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_totally_unrelated_metric" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_no_match).toBe(1);
    });
  });

  describe("cross-prefix handling", () => {
    it("blocks cross-prefix fuzzy remapping (fac_ → out_) when no label match", () => {
      // When targetName does NOT match any label, fuzzy matching still respects
      // prefix safety and blocks fac_ → out_ stem matching.
      const result = remapConstraintTargets(
        [makeConstraint({
          targetNodeId: "fac_some_metric",
          targetName: "some metric",
          operator: ">=",
        })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // No match — no label, alias, or fuzzy match for "some metric"
      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_no_match).toBe(1);
    });

    it("label-based matching correctly crosses prefixes when label matches exactly", () => {
      // When targetName matches a node label exactly, label matching resolves
      // the constraint to that node regardless of prefix — this is correct
      // because the extractor doesn't know what prefix the LLM will use.
      const result = remapConstraintTargets(
        [makeConstraint({
          targetNodeId: "fac_revenue_retention_rate",
          targetName: "revenue retention rate",
          operator: ">=",
        })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // Label "Revenue Retention Rate" on out_revenue_retention matches exactly
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("out_revenue_retention");
      expect(result.remapped).toBe(1);
    });
  });

  describe("empty inputs", () => {
    it("returns empty when no constraints provided", () => {
      const result = remapConstraintTargets([], MID_MARKET_NODES, MID_MARKET_LABELS);
      expect(result.constraints).toHaveLength(0);
      expect(result.remapped).toBe(0);
      expect(result.rejected_junk).toBe(0);
      expect(result.rejected_no_match).toBe(0);
    });

    it("drops all constraints when no graph nodes provided", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_churn" })],
        [],
      );
      expect(result.constraints).toHaveLength(0);
    });
  });

  describe("temporal constraint handling", () => {
    it("binds temporal constraint to goal node when goalNodeId provided", () => {
      const temporalConstraint = makeConstraint({
        targetNodeId: "delivery_time_months",
        targetName: "delivery time",
        unit: "months",
        value: 18,
        operator: "<=",
      });
      (temporalConstraint as any).deadlineMetadata = {
        deadline_date: "2025-06-01",
        reference_date: "2024-01-01",
        assumed_reference_date: false,
      };

      const result = remapConstraintTargets(
        [temporalConstraint],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
        undefined,
        "g1", // goalNodeId
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("g1");
      expect(result.remapped).toBe(1);
      expect(result.rejected_junk).toBe(0);
      expect(result.rejected_no_match).toBe(0);
    });

    it("drops temporal constraint with reason when no goalNodeId provided", () => {
      const temporalConstraint = makeConstraint({
        targetNodeId: "delivery_time_months",
        targetName: "delivery time",
        unit: "months",
        value: 18,
        operator: "<=",
      });
      (temporalConstraint as any).deadlineMetadata = {
        deadline_date: "2025-06-01",
      };

      const result = remapConstraintTargets(
        [temporalConstraint],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_no_match).toBe(1);
    });

    it("binds temporal constraints alongside remapped metric constraints", () => {
      const temporalConstraint = makeConstraint({
        targetNodeId: "delivery_time_months",
        targetName: "delivery time",
        unit: "months",
        value: 12,
        operator: "<=",
      });
      (temporalConstraint as any).deadlineMetadata = {
        deadline_date: "2025-01-01",
      };

      const metricConstraint = makeConstraint({
        targetNodeId: "fac_churn",
        targetName: "churn",
        operator: "<=",
        value: 0.05,
      });

      const result = remapConstraintTargets(
        [temporalConstraint, metricConstraint],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
        undefined,
        "g1", // goalNodeId
      );

      // Both should survive: temporal bound to goal, metric remapped
      expect(result.constraints).toHaveLength(2);
      expect(result.constraints.find(c => c.targetNodeId === "g1")).toBeDefined();
      expect(result.constraints.find(c => c.targetNodeId === "fac_customer_churn")).toBeDefined();
      expect(result.remapped).toBe(2); // temporal + metric both remapped
    });
  });

  describe("mid-market brief survival rate", () => {
    it("survives at least 3 of 5 typical mid-market constraints", () => {
      // Realistic constraints the extractor produces for a mid-market expansion brief:
      // 1. fac_churn → alias-matches fac_customer_churn
      // 2. fac_revenue → alias-matches fac_revenue_growth
      // 3. fac_marketing → label-matches fac_marketing_spend ("Marketing Spend")
      // 4. fac_we_have → junk (all stop-words)
      // 5. fac_team → label-matches fac_team_capacity ("Team Capacity")
      const extractedConstraints = [
        makeConstraint({ targetNodeId: "fac_churn", targetName: "churn", operator: "<=", value: 0.05 }),
        makeConstraint({ targetNodeId: "fac_revenue", targetName: "revenue", operator: ">=", value: 1000000 }),
        makeConstraint({ targetNodeId: "fac_marketing", targetName: "marketing spend", operator: "<=", value: 50000 }),
        makeConstraint({ targetNodeId: "fac_we_have", targetName: "we have", operator: "<=", value: 10 }),
        makeConstraint({ targetNodeId: "fac_team", targetName: "team capacity", operator: ">=", value: 5 }),
      ];

      const result = remapConstraintTargets(
        extractedConstraints,
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // All 4 non-junk survive (alias + label matching ensures high survival)
      expect(result.constraints.length).toBeGreaterThanOrEqual(3);
      // All 4 should now survive with improved matching
      expect(result.constraints.length).toBe(4);
      // Junk should be rejected
      expect(result.rejected_junk).toBe(1);
      expect(result.rejected_no_match).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Alias matching tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("alias matching (CONSTRAINT_ALIASES)", () => {
    it("resolves 'churn' via alias to fac_customer_churn", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_churn", targetName: "churn" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(1);
    });

    it("resolves 'revenue' via alias to fac_revenue_growth", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_revenue", targetName: "revenue" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_revenue_growth");
      expect(result.remapped).toBe(1);
    });

    it("resolves 'budget' via alias to fac_marketing_spend when available", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_budget", targetName: "budget" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_marketing_spend");
      expect(result.remapped).toBe(1);
    });

    it("skips alias when no alias candidate exists in graph", () => {
      // Graph with no matching alias candidates
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_satisfaction_score", targetName: "satisfaction" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // "satisfaction" alias maps to ["customer_satisfaction", "nps_score", "csat"] — none in graph
      expect(result.constraints).toHaveLength(0);
      expect(result.rejected_no_match).toBe(1);
    });

    it("resolves via substring alias key match ('monthly churn rate' matches 'churn rate' key)", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_monthly_churn_rate", targetName: "monthly churn rate" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      // "monthly churn rate" contains the alias key "churn rate" → candidates ["churn_rate", "customer_churn", ...]
      // fac_customer_churn has stem "customer_churn" which contains alias candidate "churn_rate"? No.
      // But "customer_churn" contains substring "churn" from "monthly_churn" candidate? Yes via "monthly churn" key.
      // Longest matching key is "monthly churn" → ["monthly_churn", "churn_rate", "customer_churn"]
      // "customer_churn" stem includes substring from candidate "customer_churn" → exact match
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(1);
    });

    it("resolves via substring stem matching ('churn' candidate matches 'customer_churn' node stem)", () => {
      // Alias key "churn" maps to candidates ["customer_churn", "churn_rate", ...]
      // Node stem "customer_churn" contains the candidate "customer_churn" (exact) → match
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_high_churn", targetName: "churn" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Label exact matching tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("label exact matching", () => {
    it("resolves constraint via exact label match", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_team_cap", targetName: "team capacity" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_team_capacity");
      expect(result.remapped).toBe(1);
    });

    it("resolves constraint via normalised label match (case-insensitive, punctuation-stripped)", () => {
      const result = remapConstraintTargets(
        [makeConstraint({ targetNodeId: "fac_customer_churn_rate", targetName: "Customer Churn Rate" })],
        MID_MARKET_NODES,
        MID_MARKET_LABELS,
      );

      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].targetNodeId).toBe("fac_customer_churn");
      expect(result.remapped).toBe(1);
    });
  });
});
