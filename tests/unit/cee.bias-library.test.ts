import { describe, it, expect } from "vitest";
import { getBiasDefinition, applyBiasDefinition } from "../../src/cee/bias/library.js";

describe("CEE bias library", () => {
  it("returns canonical definition for known bias codes", () => {
    const def = getBiasDefinition("confirmation_bias");

    expect(def).toBeDefined();
    expect(def!.code).toBe("CONFIRMATION_BIAS");
    expect(def!.label).toBe("Confirmation bias");
    expect(def!.typical_interventions.length).toBeGreaterThan(0);
  });

  it("applyBiasDefinition enriches finding with mechanism, citation, and micro_intervention", () => {
    const finding: any = {
      id: "test_finding",
      category: "other",
      severity: "low",
      node_ids: [],
      explanation: "Test finding",
    };

    const enriched = applyBiasDefinition(finding, "CONFIRMATION_BIAS");

    expect(enriched.code).toBe("CONFIRMATION_BIAS");
    expect(typeof enriched.mechanism).toBe("string");
    expect(typeof enriched.citation).toBe("string");

    expect(enriched.micro_intervention).toBeDefined();
    const steps = enriched.micro_intervention?.steps ?? [];
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
    expect(enriched.micro_intervention?.estimated_minutes).toBe(3);
  });

  it("applyBiasDefinition leaves finding unchanged when code is unknown", () => {
    const finding: any = {
      id: "test_unknown_code",
      category: "other",
      severity: "low",
      node_ids: [],
      explanation: "Test finding",
    };

    const enriched = applyBiasDefinition(finding, "UNKNOWN_CODE");

    expect(enriched).toBe(finding);
  });
});
