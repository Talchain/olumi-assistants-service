import { describe, it, expect } from "vitest";
import {
  stripUngroundedNumerics,
  detectConstraintTension,
} from "../../../../src/orchestrator/tools/explain-results.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

describe("explain_results — numeric freehand stripping", () => {
  it("strips integers", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("The value is 42 units.");
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBeGreaterThan(0);
  });

  it("strips percentages", () => {
    const { cleaned } = stripUngroundedNumerics("Win probability is 65%.");
    expect(cleaned).toContain("[value]");
    expect(cleaned).not.toMatch(/65%/);
  });

  it("strips currency", () => {
    const { cleaned } = stripUngroundedNumerics("The cost is $20k.");
    expect(cleaned).toContain("[value]");
  });

  it("strips decimals", () => {
    const { cleaned } = stripUngroundedNumerics("Elasticity is 0.85.");
    expect(cleaned).toContain("[value]");
  });

  it("strips ranges", () => {
    const { cleaned } = stripUngroundedNumerics("Estimated 10-12 months.");
    expect(cleaned).toContain("[value]");
  });

  it("strips approximations", () => {
    const { cleaned } = stripUngroundedNumerics("Approximately 150 units.");
    expect(cleaned).toContain("[value]");
  });

  it("preserves 4-digit years", () => {
    const { cleaned } = stripUngroundedNumerics("Since 2023, the trend has changed.");
    expect(cleaned).toContain("2023");
  });

  it("preserves single-digit structural references", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("There are 3 options.");
    expect(cleaned).toContain("3");
    expect(strippedCount).toBe(0);
  });

  it("returns zero stripped count when no numerics found", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("No numbers here.");
    expect(cleaned).toBe("No numbers here.");
    expect(strippedCount).toBe(0);
  });
});

describe("explain_results — constraint tension detection", () => {
  it("detects tension when joint < min(individual) × 0.7", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.3,
        per_constraint: [
          { probability: 0.8 },
          { probability: 0.9 },
        ],
      },
    } as unknown as V2RunResponseEnvelope;

    const note = detectConstraintTension(response);
    expect(note).not.toBeNull();
    expect(note).toContain("in tension");
  });

  it("returns null when no tension", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.7,
        per_constraint: [
          { probability: 0.8 },
          { probability: 0.9 },
        ],
      },
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });

  it("returns null when constraint_analysis absent", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });

  it("returns null when no per_constraint data", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.3,
      },
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });
});
