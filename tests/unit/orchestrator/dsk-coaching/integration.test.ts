/**
 * Integration test — proves stable post-model technique recommendations
 * from real pipeline evidence gaps (not BIL-derived approximations).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config — DSK coaching enabled
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: {
      dskCoachingEnabled: true,
    },
  },
}));

// Mock dsk-loader — no bundle loaded (exercises hardcoded fallback map)
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
import { DskCoachingItemsPayload } from "../../../../src/schemas/dsk-coaching.js";

// Realistic BIL from a hiring decision brief
const hiringBil: BriefIntelligence = {
  contract_version: "1.1.0",
  goal: { label: "hire best candidate for engineering lead", measurable: false, confidence: 0.7 },
  options: [
    { label: "Candidate A — internal promotion", confidence: 0.8 },
    { label: "Candidate B — external hire", confidence: 0.7 },
  ],
  constraints: [
    { label: "salary budget £120K", type: "hard_limit", confidence: 0.9 },
    { label: "start within 3 months", type: "hard_limit", confidence: 0.6 },
  ],
  factors: [
    { label: "team culture fit", confidence: 0.5 },
    { label: "technical depth", confidence: 0.7 },
    { label: "leadership experience", confidence: 0.4 },
  ],
  completeness_band: "medium",
  causal_framing_score: "weak",
  specificity_score: "moderate",
  ambiguity_flags: ["Hedging: \"probably\""],
  missing_elements: [],
  dsk_cues: [
    { bias_type: "status_quo", signal: "already know Candidate A", claim_id: "DSK-B-007", confidence: 0.82 },
    { bias_type: "anchoring", signal: "anchored to current salary", claim_id: "DSK-B-001", confidence: 0.75 },
    { bias_type: "availability", signal: "recent success of internal hire", claim_id: null, confidence: 0.6 },
  ],
} as BriefIntelligence;

// Real pipeline evidence gaps — from a draft_graph pipeline output
// These have specific pipeline-derived fields, not BIL approximations
const pipelineGaps: EvidenceGap[] = [
  {
    factor_id: "culture_fit",
    factor_label: "Team culture fit",
    voi: 0.85,
    confidence: 0.35,
    has_observed_value: false,
    is_quantitative: false,
  },
  {
    factor_id: "technical_depth",
    factor_label: "Technical depth",
    voi: 0.7,
    confidence: 0.45,
    has_observed_value: true,
    is_quantitative: true,
  },
  {
    factor_id: "leadership_exp",
    factor_label: "Leadership experience",
    voi: 0.6,
    confidence: 0.25,
    has_observed_value: false,
    is_quantitative: false,
  },
  {
    factor_id: "salary_expectation",
    factor_label: "Salary expectation",
    voi: 0.5,
    confidence: 0.6,
    has_observed_value: true,
    is_quantitative: true,
  },
  {
    factor_id: "retention_risk",
    factor_label: "Retention risk",
    voi: 0.3,
    confidence: 0.4,
    has_observed_value: false,
    is_quantitative: false,
  },
  {
    factor_id: "onboarding_cost",
    factor_label: "Onboarding cost",
    confidence: 0.55,
    has_observed_value: true,
    is_quantitative: true,
  },
];

describe("DSK coaching integration — post-model with real pipeline gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config.features as { dskCoachingEnabled: boolean }).dskCoachingEnabled = true;
  });

  it("produces stable post-model coaching from hiring brief + pipeline gaps", () => {
    const result = assembleDskCoachingItems(hiringBil, "post_model", pipelineGaps, "culture_fit");

    expect(result).toBeDefined();

    // Schema-valid
    const parsed = DskCoachingItemsPayload.safeParse(result);
    expect(parsed.success).toBe(true);

    // Bias alerts — 2 above threshold (status_quo 0.82, anchoring 0.75; availability 0.6 below 0.7)
    expect(result!.bias_alerts).toHaveLength(2);
    expect(result!.bias_alerts[0].bias_type).toBe("status_quo"); // highest confidence
    expect(result!.bias_alerts[1].bias_type).toBe("anchoring");
    expect(result!.bias_alerts.every((a) => a.human_description.endsWith("?"))).toBe(true);

    // Technique recommendations — from pipeline gaps, max 5
    expect(result!.technique_recommendations.length).toBeGreaterThanOrEqual(3);
    expect(result!.technique_recommendations.length).toBeLessThanOrEqual(5);
    expect(result!.technique_recommendations.every((r) => r.provisional === false)).toBe(true);
    expect(result!.technique_recommendations.every((r) =>
      r.surface_targets.includes("evidence_gap_card"),
    )).toBe(true);

    // Priority 1: culture_fit is dominantDriverId → pre-mortem
    const cultureFit = result!.technique_recommendations.find((r) => r.factor_id === "culture_fit");
    expect(cultureFit).toBeDefined();
    expect(cultureFit!.technique_label).toBe("Pre-mortem");
    expect(cultureFit!.claim_id).toBe("DSK-T-001");

    // Priority 2: leadership_exp has_observed_value=false → implementation intentions
    const leadership = result!.technique_recommendations.find((r) => r.factor_id === "leadership_exp");
    expect(leadership).toBeDefined();
    expect(leadership!.technique_label).toBe("Implementation intentions");

    // Priority 3: technical_depth is_quantitative + low confidence → reference class forecasting
    const techDepth = result!.technique_recommendations.find((r) => r.factor_id === "technical_depth");
    expect(techDepth).toBeDefined();
    expect(techDepth!.technique_label).toBe("Reference class forecasting");

    // Metadata
    expect(result!.metadata.stage).toBe("post_model");
    expect(result!.metadata.total_cues_evaluated).toBe(3);
    expect(result!.metadata.total_gaps_evaluated).toBe(6);
    expect(result!.metadata.alerts_surfaced).toBe(2);
    expect(result!.metadata.recommendations_surfaced).toBe(result!.technique_recommendations.length);
  });

  it("deterministic — same inputs always produce same output", () => {
    const r1 = assembleDskCoachingItems(hiringBil, "post_model", pipelineGaps, "culture_fit");
    const r2 = assembleDskCoachingItems(hiringBil, "post_model", pipelineGaps, "culture_fit");

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    // Same alert IDs
    expect(r1!.bias_alerts.map((a) => a.id)).toEqual(r2!.bias_alerts.map((a) => a.id));
    // Same recommendation IDs and order
    expect(r1!.technique_recommendations.map((r) => r.id)).toEqual(
      r2!.technique_recommendations.map((r) => r.id),
    );
  });

  it("DSK_COACHING_ENABLED=false → no coaching even with real gaps", () => {
    (config.features as { dskCoachingEnabled: boolean }).dskCoachingEnabled = false;
    const result = assembleDskCoachingItems(hiringBil, "post_model", pipelineGaps, "culture_fit");
    expect(result).toBeUndefined();
  });

  it("BIL disabled → no dsk_coaching on envelope (assembler returns undefined for empty inputs)", () => {
    // When BIL is disabled, turn-handler never extracts BIL, so assembleDskCoachingItems
    // is never called. Verify the omit-empty contract: empty cues + no gaps → undefined.
    const emptyBil: BriefIntelligence = {
      ...hiringBil,
      dsk_cues: [],
      factors: [],
    } as BriefIntelligence;

    // Pre-model with no cues → undefined
    expect(assembleDskCoachingItems(emptyBil, "pre_model")).toBeUndefined();
    // Post-model with no cues and no gaps → undefined
    expect(assembleDskCoachingItems(emptyBil, "post_model", [])).toBeUndefined();
  });
});
