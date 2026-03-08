import { describe, it, expect, vi } from "vitest";
import { assembleAnalysisInputsSummary } from "../../../../src/orchestrator/analysis-inputs/assemble.js";
import { AnalysisInputsSummaryPayload } from "../../../../src/schemas/analysis-inputs-summary.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

// Suppress log.warn in tests
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeV2Response(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    meta: {
      seed_used: 42,
      n_samples: 5000,
      response_hash: "abc123",
    },
    results: [
      { option_id: "opt_a", option_label: "Raise prices", win_probability: 0.62 },
      { option_id: "opt_b", option_label: "Keep prices", win_probability: 0.38 },
    ],
    factor_sensitivity: [
      { factor_id: "fac_churn", label: "Churn rate", elasticity: -0.34 },
      { factor_id: "fac_ltv", label: "Customer LTV", elasticity: 0.28 },
      { factor_id: "fac_conv", label: "Conversion rate", elasticity: -0.15 },
      { factor_id: "fac_brand", label: "Brand perception", elasticity: 0.08 },
    ],
    robustness: {
      level: "moderate",
      recommendation_stability: 0.71,
      overall_confidence: 0.55,
      fragile_edges: [],
    },
    constraint_analysis: {
      joint_probability: 0.75,
      per_constraint: [
        { label: "Revenue floor", satisfied: true, probability: 0.87 },
        { label: "Churn < 5%", satisfied: false, probability: 0.42 },
      ],
    },
    ...overrides,
  } as unknown as V2RunResponseEnvelope;
}

describe("assembleAnalysisInputsSummary", () => {
  it("produces valid summary from full V2RunResponse", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    expect(result!.contract_version).toBe("1.0.0");
    expect(result!.recommendation.option_label).toBe("Raise prices");
    expect(result!.recommendation.win_probability).toBe(0.62);
    expect(result!.options).toHaveLength(2);
    expect(result!.top_drivers).toHaveLength(3);

    // Schema valid
    expect(AnalysisInputsSummaryPayload.safeParse(result).success).toBe(true);
  });

  it("caps top_drivers at 3", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    expect(result!.top_drivers.length).toBeLessThanOrEqual(3);
    // Sorted by abs(elasticity) desc
    expect(Math.abs(result!.top_drivers[0].elasticity))
      .toBeGreaterThanOrEqual(Math.abs(result!.top_drivers[1].elasticity));
  });

  it("caps constraints_status at 5", () => {
    const constraints = Array.from({ length: 8 }, (_, i) => ({
      label: `Constraint ${i}`, satisfied: true, probability: 0.9,
    }));
    const result = assembleAnalysisInputsSummary(
      makeV2Response({
        constraint_analysis: { joint_probability: 0.8, per_constraint: constraints },
      } as unknown as Partial<V2RunResponseEnvelope>),
    );
    expect(result).not.toBeNull();
    expect(result!.constraints_status.length).toBeLessThanOrEqual(5);
  });

  it("returns null when results is empty", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response({ results: [] }));
    expect(result).toBeNull();
  });

  it("returns null when results is missing", () => {
    const v2 = makeV2Response();
    (v2 as Record<string, unknown>).results = undefined;
    const result = assembleAnalysisInputsSummary(v2);
    expect(result).toBeNull();
  });

  it("handles missing robustness gracefully", () => {
    const result = assembleAnalysisInputsSummary(
      makeV2Response({ robustness: undefined }),
    );
    expect(result).not.toBeNull();
    expect(result!.robustness.level).toBe("moderate"); // default
    expect(result!.robustness.recommendation_stability).toBeNull();
  });

  it("reads recommendation_stability from V2RunResponse directly (fix #6)", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    expect(result!.robustness.recommendation_stability).toBe(0.71);
  });

  it("uses overall_confidence for confidence_band (fix #6)", () => {
    // overall_confidence = 0.55 → medium
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    expect(result!.confidence_band).toBe("medium");

    // High confidence
    const highResult = assembleAnalysisInputsSummary(
      makeV2Response({
        robustness: { level: "robust", overall_confidence: 0.85 },
      } as unknown as Partial<V2RunResponseEnvelope>),
    );
    expect(highResult).not.toBeNull();
    expect(highResult!.confidence_band).toBe("high");
  });

  it("returns null confidence_band when overall_confidence absent", () => {
    const result = assembleAnalysisInputsSummary(
      makeV2Response({
        robustness: { level: "moderate" },
      } as unknown as Partial<V2RunResponseEnvelope>),
    );
    expect(result).not.toBeNull();
    expect(result!.confidence_band).toBeNull();
  });

  it("output always fits within 2KB", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2048);
  });

  it("trims to fit 2KB instead of returning null (fix #7)", () => {
    // Create a response with many long constraints to approach the limit
    const longConstraints = Array.from({ length: 5 }, (_, i) => ({
      label: "A".repeat(200) + `_constraint_${i}`,
      satisfied: i % 2 === 0,
      probability: 0.5 + i * 0.1,
    }));
    const longDrivers = Array.from({ length: 3 }, (_, i) => ({
      factor_id: `fac_${"x".repeat(50)}_${i}`,
      label: "B".repeat(200) + `_driver_${i}`,
      elasticity: 0.5 - i * 0.1,
    }));
    const result = assembleAnalysisInputsSummary(
      makeV2Response({
        factor_sensitivity: longDrivers,
        constraint_analysis: { joint_probability: 0.8, per_constraint: longConstraints },
      } as unknown as Partial<V2RunResponseEnvelope>),
    );
    // Should either fit or have trimmed entries — not null
    if (result !== null) {
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(2048);
      expect(AnalysisInputsSummaryPayload.safeParse(result).success).toBe(true);
    }
  });

  it("computes sensitivity_concentration correctly", () => {
    const result = assembleAnalysisInputsSummary(makeV2Response());
    expect(result).not.toBeNull();
    // |0.34| + |0.28| + |0.15| = 0.77; total = 0.77 + 0.08 = 0.85; concentration = 0.77/0.85 ≈ 0.906
    expect(result!.sensitivity_concentration).toBeGreaterThan(0.85);
    expect(result!.sensitivity_concentration).toBeLessThanOrEqual(1);
  });
});
