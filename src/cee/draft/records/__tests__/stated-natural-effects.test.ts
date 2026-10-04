import { describe, expect, it } from "vitest";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { deriveNotModelledManifest, extractStatedLikelyRange, extractStatedPerUnitEffects } from "../../../context-integrity/not-modelled-manifest.js";
import { targetTestabilityOf } from "../../../../orchestrator-v5/admission/target-testability.js";
import { projectDraftRecords } from "../seam.js";

const BRIEF =
  "We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. " +
  "Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. " +
  "Goal: reach at least £150,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month " +
  "to monthly recurring revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer " +
  "removes £300 a month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. " +
  "Each starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in support. " +
  "Keeping pricing as it is adds nothing.";

const records = {
  stated_items: [
    { kind: "goal", source_quote: "Goal: reach at least £150,000 monthly recurring revenue within 9 months.", value: 150000, baseline: 120000, unit: "£/month", role: "target" },
    { kind: "option", source_quote: "raise prices by 10%" },
    { kind: "option", source_quote: "launch a starter tier at £49 a month" },
    { kind: "option", source_quote: "keep pricing as it is" },
    { kind: "figure", source_quote: "The starter tier would win about 150 new subscribers, between 80 and 250.", value: 150, unit: "subscribers", role: "baseline" },
    { kind: "figure", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4.", value: 2, baseline: 2, unit: "customers", role: "baseline" },
  ],
  claims: [
    { claim_kind: "factor", label: "Price rise", value: 0.1, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "factor", label: "Starter tier subscribers", value: 150, unit: "subscribers", value_scale: "raw_count" },
    { claim_kind: "outcome", label: "Monthly recurring revenue", value: 120000, unit: "£/month" },
    { claim_kind: "outcome", label: "Monthly support cost", value: 0, unit: "£/month" },
    { claim_kind: "causal_link", label: "price rise → MRR", from_claim: 0, to_claim: 2, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" } },
    { claim_kind: "causal_link", label: "subscribers → MRR", from_claim: 1, to_claim: 2, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscribers" } },
    { claim_kind: "causal_link", label: "price rise → goal", from_claim: 0, to_stated: 0, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" } },
    { claim_kind: "causal_link", label: "subscribers → goal", from_claim: 1, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" } },
    { claim_kind: "causal_link", label: "stated subscribers → goal", from_stated: 4, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [4] },
    { claim_kind: "causal_link", label: "raise → price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.1, basis: [0] },
    { claim_kind: "causal_link", label: "starter → subscribers", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 150, basis: [4] },
    { claim_kind: "causal_link", label: "keep → subscribers", from_stated: 3, to_claim: 1, effect: "positive", sets_to: 0, basis: [3] },
    { claim_kind: "causal_link", label: "lost customers → MRR", from_stated: 5, to_claim: 2, effect: "negative", effect_detail: { amount: -300, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customer" }, basis: [5] },
    { claim_kind: "causal_link", label: "subscribers → support", from_claim: 1, to_claim: 3, effect: "negative", effect_detail: { amount: -6, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" } },
  ],
} as const;

describe("draft stated figures at the records seam", () => {
  it("extracts the existing brief figures, including support cost and ranges", () => {
    const effects = extractStatedPerUnitEffects(BRIEF);
    expect(effects.map((effect) => [effect.amount, effect.amount_unit, effect.per_source_change, effect.per_source_change_unit])).toEqual([
      [1200, "£/month", 1, "%"],
      [-2, "customers", 1, "%"],
      [-300, "£/month", 1, "customer"],
      [49, "£/month", 1, "subscriber"],
      [-6, "£/month", 1, "subscriber"],
    ]);
    expect(extractStatedLikelyRange("The starter tier would win about 150 new subscribers, between 80 and 250.")).toEqual({
      low: 80, high: 250, text: "between 80 and 250",
    });
  });

  it("carries effect_detail through the seam and writes natural effects with brief provenance", () => {
    const result = projectDraftRecords(records, BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = result.projection.graph;
    const natural = graph.edges
      .map((edge) => edge.provenance?.natural_effect)
      .filter((effect): effect is NonNullable<typeof effect> => effect !== undefined);
    expect(natural.map((effect) => [effect.amount, effect.amount_unit, effect.per_source_change])).toEqual([
      [1200, "£/month", 1],
      [49, "£/month", 1],
      [1200, "£/month", 1],
      [49, "£/month", 1],
      [-6, "£/month", 1],
    ]);
    expect(graph.edges.filter((edge) => edge.provenance?.source === "brief_extraction")).toHaveLength(5);
    const starter = graph.nodes.find((node) => node.label.includes("starter tier would win"));
    expect(starter?.observed_state).toMatchObject({ value: 0.75, raw_value: 150, baseline: 150, range: { min: 80, max: 250 } });
    const manifest = deriveNotModelledManifest(BRIEF, graph);
    const manifestItems = manifest.quantities?.items ?? [];
    expect(manifestItems.filter((item) => ["£1,200", "£49", "£6"].includes(item.literal)).every((item) => item.verdict === "in_model")).toBe(true);
  });

  it("makes the fixed brief target-testable offline once the structured draft is projected", () => {
    const result = projectDraftRecords(records, BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = normaliseDraftResponse(structuredClone(result.projection.graph));
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toMatchObject({ kind: "testable" });
  });
});
