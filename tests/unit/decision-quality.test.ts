/**
 * Unit tests for decision quality assessment
 *
 * Tests the mapping from quality metrics and readiness assessment
 * to simplified decision quality levels for the Results Panel.
 */

import { describe, it, expect } from "vitest";
import {
  computeDecisionQuality,
  countMissingBaselines,
  type DecisionQualityInputs,
} from "../../src/services/review/decisionQuality.js";

describe("computeDecisionQuality", () => {
  const baseQuality = {
    overall: 7,
    structure: 7,
    causality: 7,
    coverage: 7,
    safety: 8,
    issues_by_severity: { error: 0, warning: 0, info: 0 },
    details: {
      raw_confidence: 0.7,
      engine_issue_count: 0,
      cee_issue_count: 0,
      node_count: 8,
      edge_count: 10,
      option_count: 3,
      risk_count: 2,
      outcome_count: 3,
    },
  };

  describe("level determination", () => {
    it("returns 'incomplete' when readiness is not_ready", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 8 },
        readiness: { level: "not_ready", score: 0.2 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("incomplete");
    });

    it("returns 'incomplete' when quality.overall < 4", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 3 },
        readiness: { level: "caution", score: 0.5 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("incomplete");
    });

    it("returns 'needs_strengthening' when readiness is caution", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 6 },
        readiness: { level: "caution", score: 0.5 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("needs_strengthening");
    });

    it("returns 'needs_strengthening' when quality.overall is 4-6", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 5 },
        readiness: { level: "ready", score: 0.7 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("needs_strengthening");
    });

    it("returns 'good' when ready with quality 7-8", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 7 },
        readiness: { level: "ready", score: 0.75 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("good");
    });

    it("returns 'solid' when ready with quality >= 9", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 9 },
        readiness: { level: "ready", score: 0.9 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("solid");
    });
  });

  describe("summary generation", () => {
    it("mentions missing baselines when incomplete with missing baselines", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 3 },
        readiness: { level: "not_ready", score: 0.2 },
        issues: [],
        missingBaselineCount: 3,
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("missing baseline values");
      expect(result.summary).toContain("3");
    });

    it("mentions no options when incomplete with zero options", () => {
      const inputs: DecisionQualityInputs = {
        quality: {
          ...baseQuality,
          overall: 3,
          details: { ...baseQuality.details, option_count: 0 },
        },
        readiness: { level: "not_ready", score: 0.2 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("No decision options");
    });

    it("mentions fragile assumptions when needs_strengthening with fragile edges", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 6 },
        readiness: { level: "caution", score: 0.5 },
        issues: [],
        fragileEdgeCount: 2,
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("sensitive to");
      expect(result.summary).toContain("2 assumptions");
    });

    it("mentions uniform weights when needs_strengthening with placeholder issue", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 6 },
        readiness: { level: "caution", score: 0.5 },
        issues: ["Edges have uniform placeholder values"],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("placeholder values");
    });

    it("mentions low risk coverage when needs_strengthening without risks", () => {
      const inputs: DecisionQualityInputs = {
        quality: {
          ...baseQuality,
          overall: 6,
          details: { ...baseQuality.details, risk_count: 0 },
        },
        readiness: { level: "caution", score: 0.5 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("risk factors");
    });

    it("returns positive summary for good quality", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 7 },
        readiness: { level: "ready", score: 0.75 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("sound");
    });

    it("returns positive summary for solid quality", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 9 },
        readiness: { level: "ready", score: 0.9 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("Well-structured");
    });
  });

  describe("edge cases", () => {
    it("handles missing quality details gracefully", () => {
      const inputs: DecisionQualityInputs = {
        quality: { overall: 5 } as any,
        readiness: { level: "caution", score: 0.5 },
        issues: [],
      };

      const result = computeDecisionQuality(inputs);

      expect(result.level).toBe("needs_strengthening");
      expect(result.summary).toBeDefined();
    });

    it("handles singular baseline count in summary", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 3 },
        readiness: { level: "not_ready", score: 0.2 },
        issues: [],
        missingBaselineCount: 1,
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("1 key factor");
      expect(result.summary).not.toContain("factors");
    });

    it("handles singular assumption count in summary", () => {
      const inputs: DecisionQualityInputs = {
        quality: { ...baseQuality, overall: 6 },
        readiness: { level: "caution", score: 0.5 },
        issues: [],
        fragileEdgeCount: 1,
      };

      const result = computeDecisionQuality(inputs);

      expect(result.summary).toContain("1 assumption");
      expect(result.summary).not.toContain("assumptions");
    });
  });
});

describe("countMissingBaselines", () => {
  it("returns 0 for undefined graph", () => {
    expect(countMissingBaselines(undefined)).toBe(0);
  });

  it("returns 0 for graph with no nodes", () => {
    expect(countMissingBaselines({ nodes: [] })).toBe(0);
  });

  it("returns 0 when all factors have baseline values", () => {
    const graph = {
      nodes: [
        { kind: "factor", observed_state: { value: 1.0 } },
        { kind: "factor", observed_state: { value: 0 } },
        { kind: "goal", observed_state: undefined },
      ],
    };

    expect(countMissingBaselines(graph)).toBe(0);
  });

  it("counts factors without observed_state", () => {
    const graph = {
      nodes: [
        { kind: "factor", observed_state: undefined },
        { kind: "factor", observed_state: { value: 1.0 } },
        { kind: "factor" }, // no observed_state property
      ],
    };

    expect(countMissingBaselines(graph)).toBe(2);
  });

  it("counts factors with null value", () => {
    const graph = {
      nodes: [
        { kind: "factor", observed_state: { value: null as unknown as number } },
        { kind: "factor", observed_state: { value: 1.0 } },
      ],
    };

    expect(countMissingBaselines(graph)).toBe(1);
  });

  it("ignores non-factor nodes", () => {
    const graph = {
      nodes: [
        { kind: "goal", observed_state: undefined },
        { kind: "option", observed_state: undefined },
        { kind: "factor", observed_state: undefined },
      ],
    };

    expect(countMissingBaselines(graph)).toBe(1);
  });

  it("treats value of 0 as present (not missing)", () => {
    const graph = {
      nodes: [{ kind: "factor", observed_state: { value: 0 } }],
    };

    expect(countMissingBaselines(graph)).toBe(0);
  });
});
