import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config — DSK coaching enabled by default in tests
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: {
      dskCoachingEnabled: true,
    },
  },
}));

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

import { assembleDskCoachingItems } from "../../../../src/orchestrator/dsk-coaching/assemble-coaching-items.js";
import { config } from "../../../../src/config/index.js";
import type { BriefIntelligence } from "../../../../src/schemas/brief-intelligence.js";
import type { EvidenceGap } from "../../../../src/orchestrator/dsk-coaching/technique-recommendations.js";

function makeBil(overrides?: Partial<BriefIntelligence>): BriefIntelligence {
  return {
    contract_version: "1.0.0",
    goal: { label: "test", measurable: false, confidence: 0.5 },
    options: [],
    constraints: [],
    factors: [],
    completeness_band: "medium",
    ambiguity_flags: [],
    missing_elements: [],
    dsk_cues: [
      { bias_type: "anchoring", signal: "anchored to price", claim_id: null, confidence: 0.85 },
    ],
    ...overrides,
  } as BriefIntelligence;
}

const sampleGaps: EvidenceGap[] = [
  { factor_id: "f1", factor_label: "Revenue", is_quantitative: true, confidence: 0.3 },
  { factor_id: "f2", factor_label: "Cost", has_observed_value: false },
];

describe("assembleDskCoachingItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to enabled
    (config.features as { dskCoachingEnabled: boolean }).dskCoachingEnabled = true;
  });

  it("pre-model: bias_alerts populated, technique_recommendations empty", () => {
    const result = assembleDskCoachingItems(makeBil(), "pre_model");
    expect(result).toBeDefined();
    expect(result!.bias_alerts.length).toBeGreaterThan(0);
    expect(result!.technique_recommendations).toHaveLength(0);
    expect(result!.metadata.stage).toBe("pre_model");
  });

  it("post-model: both populated when evidence gaps provided", () => {
    const result = assembleDskCoachingItems(makeBil(), "post_model", sampleGaps);
    expect(result).toBeDefined();
    expect(result!.bias_alerts.length).toBeGreaterThan(0);
    expect(result!.technique_recommendations.length).toBeGreaterThan(0);
    expect(result!.technique_recommendations[0].provisional).toBe(false);
    expect(result!.metadata.stage).toBe("post_model");
  });

  it("metadata counts correct", () => {
    const bil = makeBil({
      dsk_cues: [
        { bias_type: "anchoring", signal: "x", claim_id: null, confidence: 0.9 },
        { bias_type: "sunk_cost", signal: "y", claim_id: null, confidence: 0.8 },
      ],
    });
    const result = assembleDskCoachingItems(bil, "post_model", sampleGaps);
    expect(result).toBeDefined();
    expect(result!.metadata.total_cues_evaluated).toBe(2);
    expect(result!.metadata.total_gaps_evaluated).toBe(2);
    expect(result!.metadata.alerts_surfaced).toBe(result!.bias_alerts.length);
    expect(result!.metadata.recommendations_surfaced).toBe(result!.technique_recommendations.length);
  });

  it("no cues + no gaps → undefined (omit-empty)", () => {
    const bil = makeBil({ dsk_cues: [] });
    const result = assembleDskCoachingItems(bil, "post_model", []);
    expect(result).toBeUndefined();
  });

  it("DSK_COACHING_ENABLED=false → undefined", () => {
    (config.features as { dskCoachingEnabled: boolean }).dskCoachingEnabled = false;
    const result = assembleDskCoachingItems(makeBil(), "pre_model");
    expect(result).toBeUndefined();
  });

  it("contract_version matches DSK_COACHING_CONTRACT_VERSION", () => {
    const result = assembleDskCoachingItems(makeBil(), "pre_model");
    expect(result).toBeDefined();
    expect(result!.contract_version).toBe("1.0.0");
  });

  it("post-model with no gaps → bias alerts only", () => {
    const result = assembleDskCoachingItems(makeBil(), "post_model");
    expect(result).toBeDefined();
    expect(result!.technique_recommendations).toHaveLength(0);
    expect(result!.bias_alerts.length).toBeGreaterThan(0);
  });
});
