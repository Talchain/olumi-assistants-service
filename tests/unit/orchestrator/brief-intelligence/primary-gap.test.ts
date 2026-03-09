import { describe, it, expect } from "vitest";
import { selectPrimaryGap } from "../../../../src/orchestrator/brief-intelligence/primary-gap.js";
import type { BriefIntelligence } from "../../../../src/schemas/brief-intelligence.js";
import { BIL_CONTRACT_VERSION } from "../../../../src/schemas/brief-intelligence.js";

function makeBil(overrides?: Partial<BriefIntelligence>): BriefIntelligence {
  return {
    contract_version: BIL_CONTRACT_VERSION,
    goal: { label: "Revenue Growth", measurable: true, confidence: 0.9 },
    options: [
      { label: "Price Increase", confidence: 0.8 },
      { label: "Keep Current", confidence: 0.7 },
    ],
    constraints: [],
    factors: [],
    completeness_band: "medium",
    causal_framing_score: "moderate",
    specificity_score: "moderate",
    ambiguity_flags: [],
    missing_elements: [],
    dsk_cues: [],
    ...overrides,
  };
}

describe("selectPrimaryGap", () => {
  it("missing goal → gap_id: 'goal' (highest priority)", () => {
    const bil = makeBil({
      goal: null,
      missing_elements: ["goal", "constraints"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("goal");
  });

  it("goal present, 1 option → gap_id: 'options'", () => {
    const bil = makeBil({
      options: [{ label: "Only Option", confidence: 0.8 }],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("options");
  });

  it("goal + 2 options, no constraints → gap_id: 'constraints'", () => {
    const bil = makeBil({
      missing_elements: ["constraints"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("constraints");
  });

  it("goal + 2 options + constraints, no status_quo → gap_id: 'status_quo'", () => {
    const bil = makeBil({
      constraints: [{ label: "Budget < $100k", type: "hard_limit", confidence: 0.9 }],
      missing_elements: ["status_quo_option"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("status_quo");
  });

  it("goal + 1 option + constraints, no status_quo → skips status_quo (options < 2), falls through", () => {
    const bil = makeBil({
      options: [{ label: "Only Option", confidence: 0.8 }],
      constraints: [{ label: "Budget < $100k", type: "hard_limit", confidence: 0.9 }],
      missing_elements: ["status_quo_option", "time_horizon"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    // Should be 'options' (priority 2) since only 1 option, not 'status_quo'
    expect(result!.gap_id).toBe("options");
  });

  it("only time_horizon missing → gap_id: 'time_horizon'", () => {
    const bil = makeBil({
      missing_elements: ["time_horizon"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("time_horizon");
  });

  it("nothing missing, options >= 2 → null", () => {
    const bil = makeBil();
    const result = selectPrimaryGap(bil);
    expect(result).toBeNull();
  });

  it("multiple missing, goal among them → gap_id: 'goal' (priority wins)", () => {
    const bil = makeBil({
      goal: null,
      missing_elements: ["constraints", "goal", "time_horizon"],
    });
    const result = selectPrimaryGap(bil);
    expect(result).not.toBeNull();
    expect(result!.gap_id).toBe("goal");
  });

  it("coaching_prompt is non-empty for all gap types", () => {
    // Test goal
    const goalBil = makeBil({ goal: null, missing_elements: ["goal"] });
    expect(selectPrimaryGap(goalBil)!.coaching_prompt.length).toBeGreaterThan(0);

    // Test options
    const optBil = makeBil({ options: [] });
    expect(selectPrimaryGap(optBil)!.coaching_prompt.length).toBeGreaterThan(0);
  });
});
