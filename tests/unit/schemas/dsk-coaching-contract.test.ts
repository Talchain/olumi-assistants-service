import { describe, it, expect } from "vitest";
import {
  DskCoachingItemsPayload,
  DSK_COACHING_CONTRACT_VERSION,
  BiasAlertSchema,
  TechniqueRecommendationSchema,
  SurfaceTargetSchema,
} from "../../../src/schemas/dsk-coaching.js";
import canonicalFixture from "../../../tools/fixtures/canonical/dsk-coaching.json";

describe("DskCoachingItemsPayload schema", () => {
  const validPayload = canonicalFixture.payload;

  it("validates canonical fixture", () => {
    const result = DskCoachingItemsPayload.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("contract_version is literal '1.0.0'", () => {
    expect(DSK_COACHING_CONTRACT_VERSION).toBe("1.0.0");
    const bad = { ...validPayload, contract_version: "2.0.0" };
    expect(DskCoachingItemsPayload.safeParse(bad).success).toBe(false);
  });

  it("accepts empty bias_alerts and technique_recommendations", () => {
    const result = DskCoachingItemsPayload.safeParse({
      ...validPayload,
      bias_alerts: [],
      technique_recommendations: [],
      metadata: { ...validPayload.metadata, alerts_surfaced: 0, recommendations_surfaced: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { bias_alerts: _, ...rest } = validPayload;
    expect(DskCoachingItemsPayload.safeParse(rest).success).toBe(false);
  });
});

describe("BiasAlertSchema", () => {
  const validAlert = canonicalFixture.payload.bias_alerts[0];

  it("accepts a valid bias alert", () => {
    expect(BiasAlertSchema.safeParse(validAlert).success).toBe(true);
  });

  it("accepts null claim_id", () => {
    expect(BiasAlertSchema.safeParse({ ...validAlert, claim_id: null }).success).toBe(true);
  });

  it("accepts null evidence_strength", () => {
    expect(BiasAlertSchema.safeParse({ ...validAlert, evidence_strength: null }).success).toBe(true);
  });

  it("rejects confidence > 1", () => {
    expect(BiasAlertSchema.safeParse({ ...validAlert, confidence: 1.5 }).success).toBe(false);
  });

  it("rejects confidence < 0", () => {
    expect(BiasAlertSchema.safeParse({ ...validAlert, confidence: -0.1 }).success).toBe(false);
  });

  it("all human_description strings in fixture end with '?'", () => {
    for (const alert of canonicalFixture.payload.bias_alerts) {
      expect(alert.human_description).toMatch(/\?$/);
    }
  });
});

describe("TechniqueRecommendationSchema", () => {
  const validRec = canonicalFixture.payload.technique_recommendations[0];

  it("accepts a valid technique recommendation", () => {
    expect(TechniqueRecommendationSchema.safeParse(validRec).success).toBe(true);
  });

  it("accepts null protocol_id", () => {
    expect(TechniqueRecommendationSchema.safeParse({ ...validRec, protocol_id: null }).success).toBe(true);
  });

  it("rejects invalid evidence_strength", () => {
    expect(
      TechniqueRecommendationSchema.safeParse({ ...validRec, evidence_strength: "weak" }).success,
    ).toBe(false);
  });

  it("rejects missing claim_id", () => {
    const { claim_id: _, ...rest } = validRec;
    expect(TechniqueRecommendationSchema.safeParse(rest).success).toBe(false);
  });
});

describe("SurfaceTargetSchema", () => {
  it("accepts valid surface targets", () => {
    for (const target of ["guidance_panel", "pre_analysis_panel", "evidence_gap_card", "model_tab"]) {
      expect(SurfaceTargetSchema.safeParse(target).success).toBe(true);
    }
  });

  it("rejects unknown surface target", () => {
    expect(SurfaceTargetSchema.safeParse("unknown_panel").success).toBe(false);
  });
});
