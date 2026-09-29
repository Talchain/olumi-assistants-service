/**
 * Unit tests for CEE effect direction inference
 *
 * Tests the inferEffectDirection and ensureEffectDirection functions
 * which provide fallback inference when LLM doesn't output effect_direction.
 */
import { describe, it, expect } from "vitest";
import {
  inferEffectDirection,
  ensureEffectDirection,
  ensureEffectDirectionBatch,
  type NodeInfo,
} from "../../src/cee/transforms/effect-direction-inference.js";

// Helper to create test nodes
function createNode(id: string, kind: string, label: string): NodeInfo {
  return { id, kind, label };
}

describe("inferEffectDirection", () => {
  describe("known negative relationships", () => {
    it("infers negative for price → demand", () => {
      const fromNode = createNode("price", "factor", "Product Price");
      const toNode = createNode("demand", "outcome", "Customer Demand");
      const edge = { from: "price", to: "demand" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for price → sales", () => {
      const fromNode = createNode("price", "factor", "Unit Price");
      const toNode = createNode("sales", "outcome", "Sales Volume");
      const edge = { from: "price", to: "sales" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for price → conversion", () => {
      const fromNode = createNode("price", "factor", "Subscription Price");
      const toNode = createNode("conversion", "outcome", "Conversion Rate");
      const edge = { from: "price", to: "conversion" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for risk → success", () => {
      const fromNode = createNode("risk_1", "risk", "Implementation Risk");
      const toNode = createNode("success", "goal", "Project Success");
      const edge = { from: "risk_1", to: "success" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for risk → profit", () => {
      const fromNode = createNode("risk", "risk", "Market Risk");
      const toNode = createNode("profit", "outcome", "Profit Margin");
      const edge = { from: "risk", to: "profit" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for competition → market share", () => {
      const fromNode = createNode("competition", "factor", "Competitor Activity");
      const toNode = createNode("share", "outcome", "Market Share");
      const edge = { from: "competition", to: "share" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for churn → revenue", () => {
      const fromNode = createNode("churn", "factor", "Customer Churn");
      const toNode = createNode("revenue", "outcome", "Monthly Revenue");
      const edge = { from: "churn", to: "revenue" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for churn → growth", () => {
      const fromNode = createNode("churn", "factor", "Churn Rate");
      const toNode = createNode("growth", "outcome", "User Growth");
      const edge = { from: "churn", to: "growth" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for cost → profit", () => {
      const fromNode = createNode("cost", "factor", "Operating Cost");
      const toNode = createNode("profit", "outcome", "Net Profit");
      const edge = { from: "cost", to: "profit" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for expense → profit", () => {
      const fromNode = createNode("expense", "factor", "Marketing Expense");
      const toNode = createNode("profit", "outcome", "Profit");
      const edge = { from: "expense", to: "profit" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for delay → success", () => {
      const fromNode = createNode("delay", "risk", "Project Delay");
      const toNode = createNode("success", "goal", "Launch Success");
      const edge = { from: "delay", to: "success" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for complexity → efficiency", () => {
      const fromNode = createNode("complexity", "factor", "System Complexity");
      const toNode = createNode("efficiency", "outcome", "Development Efficiency");
      const edge = { from: "complexity", to: "efficiency" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative for attrition → retention", () => {
      const fromNode = createNode("attrition", "factor", "Employee Attrition");
      const toNode = createNode("retention", "outcome", "Customer Retention");
      const edge = { from: "attrition", to: "retention" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });
  });

  describe("negative source to positive target", () => {
    it("infers negative when risk node affects goal", () => {
      const fromNode = createNode("risk_market", "risk", "Market Volatility");
      const toNode = createNode("goal_1", "goal", "Achieve Revenue Target");
      const edge = { from: "risk_market", to: "goal_1" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative when cost label affects profit", () => {
      const fromNode = createNode("factor_1", "factor", "Infrastructure Cost");
      const toNode = createNode("outcome_1", "outcome", "Profit Growth");
      const edge = { from: "factor_1", to: "outcome_1" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative when debt affects growth", () => {
      const fromNode = createNode("debt", "factor", "Technical Debt");
      const toNode = createNode("growth", "outcome", "Revenue Growth");
      const edge = { from: "debt", to: "growth" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative when barrier affects satisfaction", () => {
      const fromNode = createNode("barrier", "factor", "Entry Barrier");
      const toNode = createNode("satisfaction", "outcome", "User Satisfaction");
      const edge = { from: "barrier", to: "satisfaction" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("infers negative when friction affects conversion", () => {
      const fromNode = createNode("friction", "factor", "Checkout Friction");
      const toNode = createNode("conversion", "outcome", "Conversion Rate");
      const edge = { from: "friction", to: "conversion" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });
  });

  describe("positive relationships (default)", () => {
    it("infers positive for marketing → demand", () => {
      const fromNode = createNode("marketing", "factor", "Marketing Spend");
      const toNode = createNode("demand", "outcome", "Product Demand");
      const edge = { from: "marketing", to: "demand" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("positive");
    });

    it("infers positive for quality → satisfaction", () => {
      const fromNode = createNode("quality", "factor", "Product Quality");
      const toNode = createNode("satisfaction", "outcome", "Customer Satisfaction");
      const edge = { from: "quality", to: "satisfaction" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("positive");
    });

    it("infers positive for features → retention", () => {
      const fromNode = createNode("features", "factor", "Premium Features");
      const toNode = createNode("retention", "outcome", "User Retention");
      const edge = { from: "features", to: "retention" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("positive");
    });

    it("infers positive for training → performance", () => {
      const fromNode = createNode("training", "action", "Employee Training");
      const toNode = createNode("performance", "outcome", "Team Performance");
      const edge = { from: "training", to: "performance" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("positive");
    });

    it("defaults to positive for generic relationships", () => {
      const fromNode = createNode("factor_a", "factor", "Factor A");
      const toNode = createNode("outcome_b", "outcome", "Outcome B");
      const edge = { from: "factor_a", to: "outcome_b" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("positive");
    });
  });

  describe("case insensitivity", () => {
    it("matches uppercase labels", () => {
      const fromNode = createNode("price", "factor", "PRODUCT PRICE");
      const toNode = createNode("demand", "outcome", "CUSTOMER DEMAND");
      const edge = { from: "price", to: "demand" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });

    it("matches mixed case labels", () => {
      const fromNode = createNode("risk", "risk", "Market Risk Assessment");
      const toNode = createNode("success", "goal", "Project Success Rate");
      const edge = { from: "risk", to: "success" };

      expect(inferEffectDirection(edge, fromNode, toNode)).toBe("negative");
    });
  });
});

describe("ensureEffectDirection", () => {
  const testNodes: NodeInfo[] = [
    { id: "price", kind: "factor", label: "Price" },
    { id: "demand", kind: "outcome", label: "Demand" },
    { id: "marketing", kind: "factor", label: "Marketing" },
    { id: "sales", kind: "outcome", label: "Sales" },
  ];

  describe("uses LLM-provided direction", () => {
    it("returns positive when LLM provides positive", () => {
      const edge = { from: "price", to: "demand", effect_direction: "positive" as const };
      expect(ensureEffectDirection(edge, testNodes)).toBe("positive");
    });

    it("returns negative when LLM provides negative", () => {
      const edge = { from: "marketing", to: "sales", effect_direction: "negative" as const };
      expect(ensureEffectDirection(edge, testNodes)).toBe("negative");
    });
  });

  describe("infers when not provided", () => {
    it("infers from node context when effect_direction is undefined", () => {
      const edge = { from: "price", to: "demand" };
      expect(ensureEffectDirection(edge, testNodes)).toBe("negative");
    });

    it("infers positive for non-negative relationships", () => {
      const edge = { from: "marketing", to: "sales" };
      expect(ensureEffectDirection(edge, testNodes)).toBe("positive");
    });
  });

  describe("handles missing nodes", () => {
    it("defaults to positive when from node not found", () => {
      const edge = { from: "unknown", to: "demand" };
      expect(ensureEffectDirection(edge, testNodes)).toBe("positive");
    });

    it("defaults to positive when to node not found", () => {
      const edge = { from: "price", to: "unknown" };
      expect(ensureEffectDirection(edge, testNodes)).toBe("positive");
    });

    it("defaults to positive when both nodes not found", () => {
      const edge = { from: "unknown1", to: "unknown2" };
      expect(ensureEffectDirection(edge, testNodes)).toBe("positive");
    });
  });
});

describe("ensureEffectDirectionBatch", () => {
  const testNodes: NodeInfo[] = [
    { id: "price", kind: "factor", label: "Price" },
    { id: "demand", kind: "outcome", label: "Demand" },
    { id: "marketing", kind: "factor", label: "Marketing" },
    { id: "sales", kind: "outcome", label: "Sales" },
    { id: "risk", kind: "risk", label: "Market Risk" },
    { id: "success", kind: "goal", label: "Success" },
  ];

  it("processes empty array", () => {
    const result = ensureEffectDirectionBatch([], testNodes);
    expect(result).toEqual([]);
  });

  it("processes single edge", () => {
    const result = ensureEffectDirectionBatch(
      [{ from: "price", to: "demand" }],
      testNodes
    );
    expect(result).toEqual(["negative"]);
  });

  it("processes multiple edges with mixed directions", () => {
    const edges = [
      { from: "price", to: "demand" }, // negative (known relationship)
      { from: "marketing", to: "sales" }, // positive (default)
      { from: "risk", to: "success" }, // negative (risk → goal)
      { from: "price", to: "sales", effect_direction: "positive" as const }, // LLM override
    ];

    const result = ensureEffectDirectionBatch(edges, testNodes);

    expect(result).toEqual(["negative", "positive", "negative", "positive"]);
  });

  it("preserves order of edges", () => {
    const edges = [
      { from: "marketing", to: "sales" },
      { from: "price", to: "demand" },
      { from: "marketing", to: "sales" },
    ];

    const result = ensureEffectDirectionBatch(edges, testNodes);

    expect(result).toEqual(["positive", "negative", "positive"]);
  });
});
