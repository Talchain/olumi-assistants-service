/**
 * Unit tests for CEE strength derivation utilities
 *
 * Tests the deriveStrengthStd function which derives parametric uncertainty
 * (std) from edge properties for v2.2 schema.
 */
import { describe, it, expect } from "vitest";
import {
  deriveStrengthStd,
  deriveStrengthStdBatch,
} from "../../src/cee/transforms/strength-derivation.js";

describe("deriveStrengthStd", () => {
  describe("basic derivation", () => {
    it("returns minimum floor of 0.05 for edge cases", () => {
      // Very high confidence with low weight
      const result = deriveStrengthStd(0.1, 1.0, "evidence");
      expect(result).toBeGreaterThanOrEqual(0.05);
    });

    it("increases std with lower belief (lower confidence)", () => {
      const highBelief = deriveStrengthStd(1.0, 0.9, "evidence");
      const lowBelief = deriveStrengthStd(1.0, 0.3, "evidence");

      expect(lowBelief).toBeGreaterThan(highBelief);
    });

    it("scales std with weight magnitude", () => {
      const lowWeight = deriveStrengthStd(0.5, 0.7, "evidence");
      const highWeight = deriveStrengthStd(1.5, 0.7, "evidence");

      expect(highWeight).toBeGreaterThan(lowWeight);
    });
  });

  describe("coefficient of variation formula", () => {
    it("calculates cv = 0.1 when belief = 1.0", () => {
      // cv = 0.3 * (1 - 1.0) + 0.1 = 0.1
      // std = 0.1 * 1.0 * 1.0 = 0.1
      const result = deriveStrengthStd(1.0, 1.0, "evidence");
      expect(result).toBeCloseTo(0.1, 2);
    });

    it("calculates cv = 0.4 when belief = 0.0", () => {
      // cv = 0.3 * (1 - 0.0) + 0.1 = 0.4
      // std = 0.4 * 1.0 * 1.0 = 0.4
      const result = deriveStrengthStd(1.0, 0.0, "evidence");
      expect(result).toBeCloseTo(0.4, 2);
    });

    it("calculates cv = 0.25 when belief = 0.5", () => {
      // cv = 0.3 * (1 - 0.5) + 0.1 = 0.25
      // std = 0.25 * 1.0 * 1.0 = 0.25
      const result = deriveStrengthStd(1.0, 0.5, "evidence");
      expect(result).toBeCloseTo(0.25, 2);
    });
  });

  describe("hypothesis source multiplier", () => {
    it("applies 1.5x multiplier for hypothesis provenance", () => {
      const evidence = deriveStrengthStd(1.0, 0.5, "evidence");
      const hypothesis = deriveStrengthStd(1.0, 0.5, "hypothesis");

      expect(hypothesis).toBeCloseTo(evidence * 1.5, 2);
    });

    it("applies multiplier for case-insensitive hypothesis match", () => {
      const upper = deriveStrengthStd(1.0, 0.5, "HYPOTHESIS");
      const mixed = deriveStrengthStd(1.0, 0.5, "Hypothesis");
      const lower = deriveStrengthStd(1.0, 0.5, "hypothesis");

      expect(upper).toBeCloseTo(lower, 2);
      expect(mixed).toBeCloseTo(lower, 2);
    });

    it("applies multiplier when hypothesis is part of provenance string", () => {
      const result = deriveStrengthStd(1.0, 0.5, "expert_hypothesis");
      const evidenceResult = deriveStrengthStd(1.0, 0.5, "evidence");

      expect(result).toBeCloseTo(evidenceResult * 1.5, 2);
    });
  });

  describe("provenance object handling", () => {
    it("extracts source from provenance object", () => {
      const objectProvenance = deriveStrengthStd(1.0, 0.5, {
        source: "hypothesis",
        quote: "Some quote",
      });
      const stringProvenance = deriveStrengthStd(1.0, 0.5, "hypothesis");

      expect(objectProvenance).toBeCloseTo(stringProvenance, 2);
    });

    it("handles provenance object with hypothesis in source", () => {
      const result = deriveStrengthStd(1.0, 0.5, {
        source: "expert_hypothesis",
        quote: "Expert opinion",
        location: "section 3",
      });
      const evidence = deriveStrengthStd(1.0, 0.5, "evidence");

      expect(result).toBeCloseTo(evidence * 1.5, 2);
    });

    it("handles undefined provenance", () => {
      const result = deriveStrengthStd(1.0, 0.5, undefined);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeCloseTo(0.25, 2); // no hypothesis multiplier
    });

    it("handles empty string provenance", () => {
      const result = deriveStrengthStd(1.0, 0.5, "");
      expect(result).toBeGreaterThan(0);
      expect(result).toBeCloseTo(0.25, 2);
    });
  });

  describe("input clamping", () => {
    it("clamps negative weight to positive", () => {
      const negative = deriveStrengthStd(-1.0, 0.5, "evidence");
      const positive = deriveStrengthStd(1.0, 0.5, "evidence");

      expect(negative).toBeCloseTo(positive, 2);
    });

    it("uses default weight when zero", () => {
      const result = deriveStrengthStd(0, 0.5, "evidence");
      // Uses 0.5 default, cv = 0.25, std = 0.125
      expect(result).toBeCloseTo(0.125, 2);
    });

    it("clamps belief above 1.0 to 1.0", () => {
      const over = deriveStrengthStd(1.0, 1.5, "evidence");
      const exact = deriveStrengthStd(1.0, 1.0, "evidence");

      expect(over).toBeCloseTo(exact, 2);
    });

    it("clamps belief below 0.0 to 0.0", () => {
      const under = deriveStrengthStd(1.0, -0.5, "evidence");
      const exact = deriveStrengthStd(1.0, 0.0, "evidence");

      expect(under).toBeCloseTo(exact, 2);
    });

    it("uses default belief when undefined", () => {
      const result = deriveStrengthStd(1.0, undefined as any, "evidence");
      // Default belief = 0.5, cv = 0.25, std = 0.25
      expect(result).toBeCloseTo(0.25, 2);
    });
  });

  describe("realistic edge cases", () => {
    it("high confidence evidence: low std", () => {
      // belief = 0.9, weight = 1.0, evidence
      // cv = 0.3 * 0.1 + 0.1 = 0.13
      // std = 0.13 * 1.0 = 0.13
      const result = deriveStrengthStd(1.0, 0.9, "evidence");
      expect(result).toBeCloseTo(0.13, 2);
    });

    it("low confidence hypothesis: high std", () => {
      // belief = 0.5, weight = 1.0, hypothesis
      // cv = 0.3 * 0.5 + 0.1 = 0.25
      // std = 0.25 * 1.0 * 1.5 = 0.375
      const result = deriveStrengthStd(1.0, 0.5, "hypothesis");
      expect(result).toBeCloseTo(0.375, 2);
    });

    it("metric-backed moderate confidence: moderate std", () => {
      // belief = 0.7, weight = 0.8, metric
      // cv = 0.3 * 0.3 + 0.1 = 0.19
      // std = 0.19 * 0.8 = 0.152
      const result = deriveStrengthStd(0.8, 0.7, "metric");
      expect(result).toBeCloseTo(0.152, 2);
    });
  });
});

describe("deriveStrengthStdBatch", () => {
  it("processes empty array", () => {
    const result = deriveStrengthStdBatch([]);
    expect(result).toEqual([]);
  });

  it("processes single edge", () => {
    const result = deriveStrengthStdBatch([
      { weight: 1.0, belief: 0.5, provenance: "evidence" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.25, 2);
  });

  it("processes multiple edges", () => {
    const result = deriveStrengthStdBatch([
      { weight: 1.0, belief: 0.9, provenance: "evidence" },
      { weight: 1.0, belief: 0.5, provenance: "hypothesis" },
      { weight: 0.8, belief: 0.7, provenance: "metric" },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.13, 2); // high confidence
    expect(result[1]).toBeCloseTo(0.375, 2); // hypothesis
    expect(result[2]).toBeCloseTo(0.152, 2); // metric
  });

  it("uses defaults for missing properties", () => {
    const result = deriveStrengthStdBatch([
      {}, // All defaults: weight=0.5, belief=0.5
      { weight: 1.0 }, // belief=0.5
      { belief: 0.8 }, // weight=0.5
    ]);

    expect(result).toHaveLength(3);
    // All should have reasonable values
    result.forEach((std) => {
      expect(std).toBeGreaterThanOrEqual(0.05);
      expect(std).toBeLessThan(1.0);
    });
  });
});
