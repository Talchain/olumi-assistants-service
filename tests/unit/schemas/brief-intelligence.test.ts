import { describe, it, expect } from "vitest";
import { BriefIntelligencePayload, BIL_CONTRACT_VERSION } from "../../../src/schemas/brief-intelligence.js";
import canonicalFixture from "../../../tools/fixtures/canonical/brief-intelligence.json";

describe("BriefIntelligencePayload schema", () => {
  const validPayload = {
    contract_version: BIL_CONTRACT_VERSION,
    goal: { label: "Maximize revenue", measurable: true, confidence: 0.9 },
    options: [
      { label: "Raise prices", confidence: 0.8 },
      { label: "Keep prices", confidence: 0.7 },
    ],
    constraints: [
      { label: "Budget cap $300K", type: "hard_limit" as const, confidence: 0.8 },
    ],
    factors: [
      { label: "Customer churn", confidence: 0.6 },
    ],
    completeness_band: "high" as const,
    ambiguity_flags: ["Hedging: \"maybe\""],
    missing_elements: ["time_horizon" as const],
    dsk_cues: [
      { bias_type: "anchoring", signal: "anchored to current price", claim_id: "DSK-B-001", confidence: 0.7 },
    ],
  };

  it("accepts a valid full payload", () => {
    const result = BriefIntelligencePayload.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts null goal", () => {
    const result = BriefIntelligencePayload.safeParse({ ...validPayload, goal: null });
    expect(result.success).toBe(true);
  });

  it("accepts null claim_id on dsk_cues", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      dsk_cues: [{ bias_type: "sunk_cost", signal: "we've already spent", claim_id: null, confidence: 0.8 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      options: [],
      constraints: [],
      factors: [],
      ambiguity_flags: [],
      missing_elements: [],
      dsk_cues: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence outside 0-1", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      goal: { label: "X", measurable: false, confidence: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative confidence", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      options: [{ label: "A", confidence: -0.1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = BriefIntelligencePayload.safeParse({
      contract_version: BIL_CONTRACT_VERSION,
      goal: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid constraint type", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      constraints: [{ label: "X", type: "invalid_type", confidence: 0.5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid missing_elements enum value", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      missing_elements: ["invalid_element"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong contract_version", () => {
    const result = BriefIntelligencePayload.safeParse({
      ...validPayload,
      contract_version: "2.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("validates canonical fixture", () => {
    const result = BriefIntelligencePayload.safeParse(canonicalFixture.payload);
    expect(result.success).toBe(true);
  });
});
