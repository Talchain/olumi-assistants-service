/**
 * P53x (Codex review of #2819 P2): the validator never words a placeholder's default mean as "negligible" strength.
 * Identity: the factor_marketing → outcome_growth link of the schema-v3 sample, re-stamped as a projected-mean placeholder.
 */
import { describe, it, expect } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import { linkSizing } from "../../src/cee/magnitude/link-sizing.js";

const v1: V1DraftGraphResponse = {
  graph: {
    version: "1",
    nodes: [
      { id: "goal_revenue", kind: "goal", label: "Revenue" },
      { id: "outcome_growth", kind: "outcome", label: "Growth" },
      { id: "factor_marketing", kind: "factor", label: "Marketing" },
    ],
    edges: [
      { from: "factor_marketing", to: "outcome_growth", weight: 0.6, belief: 0.85, effect_direction: "positive" },
      { from: "outcome_growth", to: "goal_revenue", weight: 1.0, belief: 1.0, effect_direction: "positive" },
    ],
  },
} as V1DraftGraphResponse;

const withLink = (provenance: Record<string, unknown>) => {
  const v3 = structuredClone(transformResponseToV3(v1)) as any;
  const e = v3.edges.find((x: any) => x.from === "factor_marketing" && x.to === "outcome_growth");
  e.strength = { ...e.strength, mean: 0.02 };
  e.provenance = provenance;
  return { v3, e };
};
const negligibleFor = (warnings: any[] | undefined) =>
  (warnings ?? []).filter((w) => w.code === "NEGLIGIBLE_STRENGTH" && String(w.affected_edge_id ?? w.message).includes("factor_marketing"));

describe("P53x validator words", () => {
  it("a projected-mean placeholder at 0.02 is not called 'negligible'", () => {
    const { v3, e } = withLink({ source: "cee_hypothesis", mean_projected: true });
    expect(linkSizing(e)).toBe("placeholder");
    expect(negligibleFor(validateV3Response(v3).warnings)).toEqual([]);
  });
  it("CONTROL: the same 0.02 link sized by Olumi is still called negligible", () => {
    const { v3, e } = withLink({ source: "cee_hypothesis", magnitude: "olumi_estimate" });
    expect(linkSizing(e)).toBe("olumi_estimate");
    expect(negligibleFor(validateV3Response(v3).warnings)).toHaveLength(1);
  });
});
