import { describe, it, expect } from "vitest";
import {
  AnalysisInputsSummaryPayload,
  ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION,
} from "../../../src/schemas/analysis-inputs-summary.js";
import canonicalFixture from "../../../tools/fixtures/canonical/analysis-inputs-summary.json";

describe("AnalysisInputsSummaryPayload schema", () => {
  const validPayload = {
    contract_version: ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION,
    recommendation: { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
    options: [
      { id: "opt_a", label: "Option A", win_probability: 0.65 },
      { id: "opt_b", label: "Option B", win_probability: 0.35 },
    ],
    top_drivers: [
      { factor_id: "fac_1", factor_label: "Churn", elasticity: -0.3 },
    ],
    sensitivity_concentration: 0.7,
    confidence_band: "medium" as const,
    robustness: { level: "moderate" as const, recommendation_stability: 0.72 },
    constraints_status: [
      { label: "Revenue floor", satisfied: true, probability: 0.85 },
    ],
    run_metadata: { seed: 42, quality_mode: "standard", timestamp: "2026-03-08T00:00:00Z" },
  };

  it("accepts a valid full payload", () => {
    const result = AnalysisInputsSummaryPayload.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts nullable confidence_band", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      confidence_band: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts nullable recommendation_stability", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      robustness: { level: "robust", recommendation_stability: null },
    });
    expect(result.success).toBe(true);
  });

  it("rejects win_probability outside [0,1]", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      recommendation: { ...validPayload.recommendation, win_probability: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      contract_version: ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION,
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong contract_version", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      contract_version: "9.9.9",
    });
    expect(result.success).toBe(false);
  });

  it("rejects top_drivers exceeding max 3", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      top_drivers: [
        { factor_id: "a", factor_label: "A", elasticity: 0.1 },
        { factor_id: "b", factor_label: "B", elasticity: 0.2 },
        { factor_id: "c", factor_label: "C", elasticity: 0.3 },
        { factor_id: "d", factor_label: "D", elasticity: 0.4 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects constraints_status exceeding max 5", () => {
    const result = AnalysisInputsSummaryPayload.safeParse({
      ...validPayload,
      constraints_status: Array.from({ length: 6 }, (_, i) => ({
        label: `C${i}`, satisfied: true,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects payload exceeding 2KB", () => {
    const bigPayload = {
      ...validPayload,
      // Inject a very large option label to exceed 2KB
      options: Array.from({ length: 20 }, (_, i) => ({
        id: `opt_${i}`,
        label: "A".repeat(100) + `_${i}`,
        win_probability: 0.05,
      })),
    };
    const result = AnalysisInputsSummaryPayload.safeParse(bigPayload);
    expect(result.success).toBe(false);
  });

  it("contract_version is literal '1.0.0'", () => {
    expect(ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION).toBe("1.0.0");
    const result = AnalysisInputsSummaryPayload.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contract_version).toBe("1.0.0");
    }
  });

  it("validates canonical fixture", () => {
    const result = AnalysisInputsSummaryPayload.safeParse(canonicalFixture.payload);
    expect(result.success).toBe(true);
  });
});
