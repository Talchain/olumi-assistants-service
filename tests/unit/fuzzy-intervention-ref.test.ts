/**
 * Fuzzy Intervention Reference Matching Tests
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("fuzzy intervention reference matching", () => {
  it("remaps fac_churn to fac_churn_rate via substring match", async () => {
    const { fuzzyMatchNodeId } = await import("../../src/validators/structural-reconciliation.js");
    const result = fuzzyMatchNodeId("fac_churn", ["fac_churn_rate", "fac_marketing_spend"]);
    expect(result).toBe("fac_churn_rate");
  });

  it("returns undefined for ambiguous matches", async () => {
    const { fuzzyMatchNodeId } = await import("../../src/validators/structural-reconciliation.js");
    const result = fuzzyMatchNodeId("fac_price", ["fac_price_level", "fac_price_sensitivity"]);
    expect(result).toBeUndefined();
  });

  it("returns undefined for no matches", async () => {
    const { fuzzyMatchNodeId } = await import("../../src/validators/structural-reconciliation.js");
    const result = fuzzyMatchNodeId("fac_xyz_nonexistent", ["fac_churn_rate", "fac_marketing_spend"]);
    expect(result).toBeUndefined();
  });

  it("matches via label-based fallback", async () => {
    const { fuzzyMatchNodeId } = await import("../../src/validators/structural-reconciliation.js");
    const labels = new Map<string, string>();
    labels.set("fac_churn_rate", "Customer Churn Rate");
    const result = fuzzyMatchNodeId("fac_churn", ["fac_churn_rate", "fac_marketing"], labels);
    expect(result).toBe("fac_churn_rate");
  });

  it("rejects short stems (< 4 chars after prefix strip)", async () => {
    const { fuzzyMatchNodeId } = await import("../../src/validators/structural-reconciliation.js");
    const result = fuzzyMatchNodeId("fac_ab", ["fac_abc_long"]);
    expect(result).toBeUndefined();
  });
});
