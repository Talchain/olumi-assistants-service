import { describe, expect, it } from "vitest";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { deriveNotModelledManifest, extractStatedLikelyRange } from "../../../context-integrity/not-modelled-manifest.js";
import { statedEffectQuoteMatches } from "../../../provenance/stated-effect.js";
import { targetTestabilityOf } from "../../../../orchestrator-v5/admission/target-testability.js";
import { projectDraftRecords } from "../seam.js";

const BRIEF =
  "We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. " +
  "Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. " +
  "Goal: reach at least £150,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month " +
  "to monthly recurring revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each 1 lost customer " +
  "removes £300 a month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. " +
  "Each 1 subscriber adds £49 a month to monthly recurring revenue. Each 1 subscriber costs about £6 a month in support. " +
  "Keeping pricing as it is adds nothing.";

const records = {
  stated_items: [
    { kind: "goal", source_quote: "Goal: reach at least £150,000 monthly recurring revenue within 9 months.", value: 150000, baseline: 120000, unit: "£/month", role: "target" },
    { kind: "option", source_quote: "raise prices by 10%" },
    { kind: "option", source_quote: "launch a starter tier at £49 a month" },
    { kind: "option", source_quote: "keep pricing as it is" },
    { kind: "figure", source_quote: "The starter tier would win about 150 new subscribers, between 80 and 250.", value: 150, unit: "subscribers", role: "baseline" },
    { kind: "figure", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4.", value: 2, baseline: 2, unit: "customers", role: "baseline" },
    { kind: "cause", source_quote: "each 1% price rise adds £1,200 a month to monthly recurring revenue before churn." },
    { kind: "cause", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4." },
    { kind: "cause", source_quote: "Each 1 lost customer removes £300 a month of monthly recurring revenue." },
    { kind: "cause", source_quote: "Each 1 subscriber adds £49 a month to monthly recurring revenue." },
    { kind: "cause", source_quote: "Each 1 subscriber costs about £6 a month in support." },
  ],
  claims: [
    { claim_kind: "factor", label: "Price rise", value: 0.1, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "factor", label: "Subscriber", value: 150, unit: "subscribers", value_scale: "raw_count" },
    { claim_kind: "outcome", label: "Monthly recurring revenue", value: 120000, unit: "£/month" },
    { claim_kind: "outcome", label: "Support", value: 0, unit: "£/month" },
    { claim_kind: "causal_link", label: "price rise → MRR", from_claim: 0, to_claim: 2, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → MRR", from_claim: 1, to_claim: 2, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscribers" }, basis: [9] },
    { claim_kind: "causal_link", label: "price rise → goal", from_claim: 0, to_stated: 0, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → goal", from_claim: 1, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [9] },
    { claim_kind: "causal_link", label: "stated subscribers → goal", from_stated: 4, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [4, 9] },
    { claim_kind: "causal_link", label: "raise → price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.1, basis: [0] },
    { claim_kind: "causal_link", label: "starter → subscribers", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 150, basis: [4] },
    { claim_kind: "causal_link", label: "keep → subscribers", from_stated: 3, to_claim: 1, effect: "positive", sets_to: 0, basis: [3] },
    { claim_kind: "causal_link", label: "lost customers → MRR", from_stated: 5, to_claim: 2, effect: "negative", effect_detail: { amount: -300, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customer" }, basis: [8] },
    { claim_kind: "causal_link", label: "subscribers → support", from_claim: 1, to_claim: 3, effect: "negative", effect_detail: { amount: -6, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [10] },
  ],
} as const;

describe("draft stated figures at the records seam", () => {
  it("validates all four typed fields against one quoted span", () => {
    const quote = "Each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.";
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" })).toBe(true);
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "USD/month", per_source_change: 1, per_source_change_unit: "%" })).toBe(false);
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customers" })).toBe(false);
    expect(statedEffectQuoteMatches(quote, { amount: 12000, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" })).toBe(false);
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
      [-6, "£/month", 1],
    ]);
    expect(graph.edges.filter((edge) => edge.provenance?.source === "brief_extraction")).toHaveLength(3);
    const starter = graph.nodes.find((node) => node.label.includes("starter tier would win"));
    expect(starter?.observed_state).toMatchObject({ value: 0.75, raw_value: 150, baseline: 150, range: { min: 80, max: 250 } });
    const manifest = deriveNotModelledManifest(BRIEF, graph);
    const manifestItems = manifest.quantities?.items ?? [];
    expect(manifestItems.filter((item) => ["£1,200", "£49"].includes(item.literal)).every((item) => item.verdict === "in_model")).toBe(true);
    expect(manifestItems.find((item) => item.literal === "£6")?.verdict).not.toBe("in_model");
  });

  it("keeps the goal path untestable when only same-unit direct links are present", () => {
    const result = projectDraftRecords(records, BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = normaliseDraftResponse(structuredClone(result.projection.graph));
    const verdict = targetTestabilityOf(graph);
    expect(verdict.kind).toBe("not_testable");
    if (verdict.kind !== "not_testable") return;
    expect(verdict.failures.some((failure) => failure.code === "goal_path_unsized" && failure.lever === "Price rise")).toBe(true);
  });

  it("fails closed for swapped identity, duplicate labels, unquoted spans and malformed ranges", () => {
    const projectVariant = (mutate: (variant: any) => void) => {
      const variant = structuredClone(records) as any;
      mutate(variant);
      const result = projectDraftRecords(variant, BRIEF);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("variant did not reach projection");
      return result.projection.graph;
    };
    const naturalOn = (graph: any, fromLabel: string, toLabel: string) => {
      const from = graph.nodes.find((node: any) => node.label === fromLabel)?.id;
      const to = graph.nodes.find((node: any) => node.label === toLabel)?.id;
      return graph.edges.find((edge: any) => edge.from === from && edge.to === to)?.provenance?.natural_effect;
    };

    expect(naturalOn(projectVariant((variant) => { variant.claims[4].to_claim = 3; }), "Price rise", "Support")).toBeUndefined();
    expect(naturalOn(projectVariant((variant) => { variant.claims[1].label = "Monthly recurring revenue"; }), "Monthly recurring revenue", "Monthly recurring revenue")).toBeUndefined();
    expect(naturalOn(projectVariant((variant) => { variant.stated_items[6].source_quote = "each 1% price rise adds £1,200 a month to an unquoted metric."; }), "Price rise", "Monthly recurring revenue")).toBeUndefined();
    expect(extractStatedLikelyRange("between 250 and 80 customers")).toBeUndefined();
  });

  it("does not let invalid natural-effect provenance take the unanchored manifest route", () => {
    const brief = "Each 1% price rise adds £1,200 a month to monthly recurring revenue.";
    const graph = (effect: Record<string, unknown>, quote = brief) => ({
      nodes: [
        { id: "source", kind: "factor", label: "Price rise" },
        { id: "target", kind: "outcome", label: "Monthly recurring revenue" },
      ],
      edges: [{ from: "source", to: "target", provenance: {
        source: "brief_extraction", magnitude: "user_stated", quote, natural_effect: effect,
      }, effect_direction: "positive" }],
    });
    const detail = { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%", strength_mean: 0.1, strength_mean_frame: "edge_strength" };
    const item = (value: number) => deriveNotModelledManifest(brief, graph({ ...detail, amount: value })).quantities?.items.find((entry) => entry.literal === "£1,200");
    expect(item(1200)).toMatchObject({ verdict: "in_model", matched_node_id: "target" });
    expect(item(-1200)?.verdict).not.toBe("in_model");
    expect(deriveNotModelledManifest(brief, graph({ ...detail, amount_unit: "USD/month" })).quantities?.items.find((entry) => entry.literal === "£1,200")?.verdict).not.toBe("in_model");
    expect(deriveNotModelledManifest(brief, graph(detail, "a quote not present in the brief")).quantities?.items.find((entry) => entry.literal === "£1,200")?.verdict).not.toBe("in_model");
    expect(deriveNotModelledManifest(brief, graph({ ...detail, amount: 1200 }, brief)).quantities?.items.find((entry) => entry.literal === "£1,200")?.matched_node_id).toBe("target");
  });
});
