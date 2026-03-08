import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dsk-loader
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getClaimById: vi.fn(() => null),
  getProtocolById: vi.fn(() => null),
  getAllByType: vi.fn(() => []),
  getVersion: vi.fn(() => null),
  getDskVersionHash: vi.fn(() => null),
}));

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { recommendTechniques } from "../../../../src/orchestrator/dsk-coaching/technique-recommendations.js";
import type { EvidenceGap } from "../../../../src/orchestrator/dsk-coaching/technique-recommendations.js";

function makeGap(overrides: Partial<EvidenceGap> & { factor_id: string; factor_label: string }): EvidenceGap {
  return { ...overrides };
}

describe("recommendTechniques", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dominant driver → pre-mortem (priority 1)", () => {
    const recs = recommendTechniques(
      [makeGap({ factor_id: "driver_1", factor_label: "Revenue" })],
      "driver_1",
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].technique_label).toBe("Pre-mortem");
    expect(recs[0].claim_id).toBe("DSK-T-001");
  });

  it("no observed value → implementation intentions (priority 2)", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "f1", factor_label: "Data", has_observed_value: false }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].technique_label).toBe("Implementation intentions");
    expect(recs[0].claim_id).toBe("DSK-T-006");
  });

  it("quantitative + low confidence → reference class forecasting (priority 3)", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "f1", factor_label: "Cost", is_quantitative: true, confidence: 0.3 }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].technique_label).toBe("Reference class forecasting");
    expect(recs[0].claim_id).toBe("DSK-T-002");
  });

  it("non-quantitative + low confidence → consider-the-opposite (priority 4)", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "f1", factor_label: "Strategy", is_quantitative: false, confidence: 0.3 }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].technique_label).toBe("Consider-the-opposite");
    expect(recs[0].claim_id).toBe("DSK-T-003");
  });

  it("fallback → devil's advocacy (priority 5)", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "f1", factor_label: "Unknown" }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].technique_label).toBe("Devil's advocacy");
    expect(recs[0].claim_id).toBe("DSK-T-005");
  });

  it("max 5 cap", () => {
    const gaps = Array.from({ length: 8 }, (_, i) =>
      makeGap({ factor_id: `f${i}`, factor_label: `Factor ${i}` }),
    );
    const recs = recommendTechniques(gaps);
    expect(recs).toHaveLength(5);
  });

  it("precedence: dominant driver wins over no-observed-value", () => {
    const recs = recommendTechniques(
      [makeGap({ factor_id: "d1", factor_label: "Driver", has_observed_value: false })],
      "d1", // dominantDriverId matches
    );
    expect(recs[0].technique_label).toBe("Pre-mortem");
  });

  it("nullable fields: null is_quantitative skips priority 3 and 4", () => {
    const recs = recommendTechniques([
      makeGap({
        factor_id: "f1",
        factor_label: "X",
        is_quantitative: null,
        confidence: 0.2,
      }),
    ]);
    // Priority 3 (quantitative) and 4 (non-quantitative) both require is_quantitative !== null
    // Falls through to priority 5
    expect(recs[0].technique_label).toBe("Devil's advocacy");
  });

  it("stable sort: same inputs → same order and IDs", () => {
    const gaps = [
      makeGap({ factor_id: "a", factor_label: "A" }),
      makeGap({ factor_id: "b", factor_label: "B" }),
    ];
    const r1 = recommendTechniques(gaps);
    const r2 = recommendTechniques(gaps);
    expect(r1.map((r) => r.id)).toEqual(r2.map((r) => r.id));
    expect(r1[0].id).toHaveLength(12);
  });

  it("dedup by factor_id (case-insensitive)", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "Revenue", factor_label: "Revenue" }),
      makeGap({ factor_id: "revenue", factor_label: "Revenue again" }),
    ]);
    expect(recs).toHaveLength(1);
  });

  it("post-model surface_targets = ['evidence_gap_card']", () => {
    const recs = recommendTechniques(
      [makeGap({ factor_id: "f1", factor_label: "X" })],
      null,
      { provisional: false },
    );
    expect(recs[0].surface_targets).toEqual(["evidence_gap_card"]);
  });

  it("provisional surface_targets = ['pre_analysis_panel']", () => {
    const recs = recommendTechniques(
      [makeGap({ factor_id: "f1", factor_label: "X" })],
      null,
      { provisional: true },
    );
    expect(recs[0].surface_targets).toEqual(["pre_analysis_panel"]);
  });

  it("tie-break by factor_label when confidence is equal", () => {
    const recs = recommendTechniques([
      makeGap({ factor_id: "f1", factor_label: "Zebra", confidence: 0.5 }),
      makeGap({ factor_id: "f2", factor_label: "Alpha", confidence: 0.5 }),
    ]);
    expect(recs[0].factor_label).toBe("Alpha");
    expect(recs[1].factor_label).toBe("Zebra");
  });
});
