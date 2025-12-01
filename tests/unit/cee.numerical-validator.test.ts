import { describe, it, expect } from "vitest";

import { NumericalValidator } from "../../src/cee/verification/validators/numerical-validator.js";
import type { InferenceResultsV1 } from "../../src/contracts/plot/engine.js";

describe("NumericalValidator", () => {
  it("skips validation when no engine results are provided", async () => {
    const validator = new NumericalValidator();

    const result = await validator.validate({ summary: "Some text" }, { endpoint: "explain-graph", requiresEngineValidation: false });

    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("emits a warning when numbers are not grounded in inference results", async () => {
    const validator = new NumericalValidator();

    const response = {
      explanation: {
        summary: "Revenue has 95% probability of increasing",
      },
    };

    const engineResults: InferenceResultsV1 = {
      // summary uses probabilities that do not include 0.95
      summary: {
        revenue: { p10: 0.45, p50: 0.65, p90: 0.78 },
      },
    } as any;

    const result = await validator.validate(response, {
      endpoint: "explain-graph",
      requiresEngineValidation: false,
      engineResults,
    });

    expect(result.valid).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.code).toBe("NUMERICAL_UNGROUNDED");
    expect(result.details?.hallucination_score).toBeGreaterThan(0);
  });

  it("accepts grounded numbers when they match inference results", async () => {
    const validator = new NumericalValidator();

    const response = {
      explanation: {
        summary: "Most likely outcome is 0.65 (65%)",
      },
    };

    const engineResults: InferenceResultsV1 = {
      summary: {
        outcome: { p10: 0.45, p50: 0.65, p90: 0.78 },
      },
    } as any;

    const result = await validator.validate(response, {
      endpoint: "explain-graph",
      requiresEngineValidation: false,
      engineResults,
    });

    expect(result.valid).toBe(true);
    expect(result.severity).toBeUndefined();
    expect(result.code).toBeUndefined();
  });
});
