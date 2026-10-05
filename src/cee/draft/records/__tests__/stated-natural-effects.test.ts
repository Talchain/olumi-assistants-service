import { describe, expect, it } from "vitest";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { deriveNotModelledManifest, extractStatedLikelyRange } from "../../../context-integrity/not-modelled-manifest.js";
import { statedEffectQuoteMatches } from "../../../provenance/stated-effect.js";
import { targetTestabilityOf } from "../../../../orchestrator-v5/admission/target-testability.js";
import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

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
    { kind: "cause", source_quote: "each 1% price rise adds £1,200 a month to monthly recurring revenue before churn." },
    { kind: "cause", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4." },
    { kind: "cause", source_quote: "Each lost customer removes £300 a month of monthly recurring revenue." },
    { kind: "cause", source_quote: "Each starter subscriber adds £49 a month to monthly recurring revenue." },
    { kind: "cause", source_quote: "Each starter subscriber costs about £6 a month in support." },
  ],
  claims: [
    { claim_kind: "factor", label: "Price rise", value: 0.1, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "factor", label: "Starter tier subscribers", value: 150, unit: "subscribers", value_scale: "raw_count" },
    { claim_kind: "outcome", label: "Monthly recurring revenue", value: 120000, unit: "£/month" },
    { claim_kind: "outcome", label: "Monthly support cost", value: 0, unit: "£/month" },
    { claim_kind: "causal_link", label: "price rise → MRR", from_claim: 0, to_claim: 2, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → MRR", from_claim: 1, to_claim: 2, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscribers" }, basis: [9] },
    { claim_kind: "causal_link", label: "price rise → goal", from_claim: 0, to_stated: 0, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → goal", from_claim: 1, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [9] },
    { claim_kind: "causal_link", label: "stated subscribers → goal", from_stated: 4, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [4, 9] },
    { claim_kind: "causal_link", label: "raise → price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.1, basis: [0] },
    { claim_kind: "causal_link", label: "starter → subscribers", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 150, basis: [4] },
    { claim_kind: "causal_link", label: "keep → subscribers", from_stated: 3, to_claim: 1, effect: "positive", sets_to: 0, basis: [3] },
    { claim_kind: "causal_link", label: "lost customers → MRR", from_claim: 14, to_claim: 2, effect: "negative", effect_detail: { amount: -300, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customer" }, basis: [8] },
    { claim_kind: "causal_link", label: "subscribers → support", from_claim: 1, to_claim: 3, effect: "negative", effect_detail: { amount: -6, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [10] },
    { claim_kind: "factor", label: "Customers lost to price rise", value: 2, unit: "customers", value_scale: "raw_count" },
    { claim_kind: "causal_link", label: "price rise → lost customers", from_claim: 0, to_claim: 14, effect: "negative", effect_detail: { amount: -2, amount_unit: "customers", per_source_change: 1, per_source_change_unit: "%" }, basis: [7] },
    // Retain the revenue/churn path through the projector's connectivity pass.
    // This typed link has no stated size; the fixture must report that gap honestly.
    { claim_kind: "causal_link", label: "MRR → goal", from_claim: 2, to_stated: 0, effect: "positive" },
  ],
} satisfies DraftRecordSet;

function projectVariant(mutate: (variant: DraftRecordSet) => void) {
  const variant: DraftRecordSet = structuredClone(records);
  mutate(variant);
  const result = projectDraftRecords(variant, BRIEF);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("variant did not reach projection");
  return result.projection.graph;
}

function naturalOn(graph: ReturnType<typeof projectVariant>, fromLabel: string, toLabel: string) {
  const from = graph.nodes.find((node) => node.label === fromLabel)?.id;
  const to = graph.nodes.find((node) => node.label === toLabel)?.id;
  return graph.edges.find((edge) => edge.from === from && edge.to === to)?.provenance?.natural_effect;
}

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

  it("locates each/every/per as exactly one source unit, including noun n-grams", () => {
    const detail = { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" };
    for (const determiner of ["Each", "Every", "per"]) {
      const quote = `${determiner} starter subscriber adds £49 a month to monthly recurring revenue.`;
      expect(statedEffectQuoteMatches(quote, detail)).toBe(true);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change_unit: "starter subscriber" })).toBe(true);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: 2 })).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: -1 })).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: 1 + 1e-10 })).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change_unit: "customer" })).toBe(false);
    }
    expect(statedEffectQuoteMatches("£49 a month per subscriber", detail)).toBe(true);
    expect(statedEffectQuoteMatches("Each 2 subscribers add £49 a month.", detail)).toBe(false);
    expect(statedEffectQuoteMatches("Each 2 subscribers add £49 a month.", { ...detail, per_source_change: 2 })).toBe(true);
    // The determiner cannot locate the target amount, or a source noun later in the sentence.
    expect(statedEffectQuoteMatches("Each subscriber adds £49 a month.", {
      amount: 1, amount_unit: "subscriber", per_source_change: 49, per_source_change_unit: "£/month",
    })).toBe(false);
    expect(statedEffectQuoteMatches("Each customer adds £49 a month to subscriber revenue.", detail)).toBe(false);
  });

  it("carries effect_detail through the seam and writes natural effects with brief provenance", () => {
    const result = projectDraftRecords(records, BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = result.projection.graph;
    const natural = graph.edges
      .map((edge) => edge.provenance?.natural_effect)
      .filter((effect): effect is NonNullable<typeof effect> => effect !== undefined);
    expect(natural.map((effect) => [effect.amount, effect.amount_unit, effect.per_source_change, effect.per_source_change_unit])).toEqual([
      [1200, "£/month", 1, "%"],
      [49, "£/month", 1, "subscribers"],
      // The original typed goal link uses singular "subscriber", a distinct four-field group.
      [49, "£/month", 1, "subscribers"],
      [-300, "£/month", 1, "customers"],
      [-6, "£/month", 1, "subscribers"],
      [-2, "customers", 1, "%"],
    ]);
    expect(graph.edges.filter((edge) => edge.provenance?.source === "brief_extraction")).toHaveLength(6);
    expect(naturalOn(graph, "Price rise", "Monthly recurring revenue")?.amount).toBe(1200);
    expect(naturalOn(graph, "Starter tier subscribers", "Monthly recurring revenue")?.amount).toBe(49);
    expect(naturalOn(graph, "Starter tier subscribers", "Monthly support cost")?.amount).toBe(-6);
    expect(naturalOn(graph, "Customers lost to price rise", "Monthly recurring revenue")?.amount).toBe(-300);
    expect(naturalOn(graph, "Price rise", "Customers lost to price rise")?.amount).toBe(-2);
    expect(naturalOn(graph, "Price rise", records.stated_items[0].source_quote)).toBeUndefined();
    for (const edge of graph.edges.filter((edge) => edge.provenance?.natural_effect)) {
      expect(BRIEF).toContain(edge.provenance!.quote);
    }
    const starter = graph.nodes.find((node) => node.label.includes("starter tier would win"));
    expect(starter?.observed_state).toMatchObject({ value: 0.75, raw_value: 150, baseline: 150, range: { min: 80, max: 250 } });
    const manifest = deriveNotModelledManifest(BRIEF, graph);
    const manifestItems = manifest.quantities?.items ?? [];
    expect(manifestItems.filter((item) => ["£1,200", "£49"].includes(item.literal)).length).toBeGreaterThan(0);
    expect(manifestItems.filter((item) => ["£1,200", "£49"].includes(item.literal)).every((item) => item.verdict === "in_model")).toBe(true);
    // ⛔ RE-PINNED ON PURPOSE (#2601, served false absence #87 5996437122). This row used to pin the signed-value
    // matcher's FALSE ABSENCE: "£6" was reported `absent` while the admitted −£6 edge held it. A figure the user wrote
    // is a magnitude ("cost £6 a month each"); the edge's sign is its direction. Bound by identity to the node it sizes.
    const supportCost = graph.nodes.find((node) => node.label === "Monthly support cost");
    expect(supportCost).toBeDefined();
    expect(manifestItems.find((item) => item.literal === "£6")).toMatchObject({
      verdict: "in_model",
      matched_node_id: supportCost!.id,
    });
  });

  it("reports the full original-brief fixture's remaining P5 goal_path_unsized failure", () => {
    const result = projectDraftRecords(records, BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = normaliseDraftResponse(structuredClone(result.projection.graph));
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toEqual({
      kind: "not_testable", goal_id: result.projection.graph.nodes.find((node) => node.kind === "goal")!.id,
      failures: [{ precondition: "P5", case: "c", code: "goal_path_unsized", lever: "Price rise" }],
    });
  });

  it("fails closed for swapped identity, duplicate labels, unquoted spans and malformed ranges", () => {
    expect(naturalOn(projectVariant((variant) => { variant.claims[4].to_claim = 3; }), "Price rise", "Monthly support cost")).toBeUndefined();
    expect(naturalOn(projectVariant((variant) => { variant.claims[1].label = "Monthly recurring revenue"; }), "Monthly recurring revenue", "Monthly recurring revenue")).toBeUndefined();
    expect(naturalOn(projectVariant((variant) => { variant.claims[1].label = "Monthly recurring revenue"; }), "Price rise", "Monthly recurring revenue")).toBeUndefined();
    expect(naturalOn(projectVariant((variant) => { variant.stated_items[6].source_quote = "each 1% price rise adds £1,200 a month to an unquoted metric."; }), "Price rise", "Monthly recurring revenue")).toBeUndefined();
    expect(extractStatedLikelyRange("between 250 and 80 customers")).toBeUndefined();
  });

  it("sizes no competing edge when neither or both members name their endpoints uniquely", () => {
    const neither = projectVariant((variant) => {
      variant.claims.push({ ...variant.claims[13]!, label: "unrelated support claim", from_claim: 0, to_claim: 2 });
    });
    expect(naturalOn(neither, "Starter tier subscribers", "Monthly support cost")).toBeUndefined();
    expect(neither.edges.some((edge) => edge.provenance?.natural_effect?.amount === -6)).toBe(false);

    const both = projectVariant((variant) => {
      delete variant.claims[6]!.effect_detail;
      const target = variant.claims.length;
      variant.claims.push({ claim_kind: "outcome", label: "Churn", value: 0, unit: "£/month" });
      variant.claims.push({ ...variant.claims[4]!, label: "price rise → churn", to_claim: target });
    });
    expect(naturalOn(both, "Price rise", "Monthly recurring revenue")).toBeUndefined();
    expect(naturalOn(both, "Price rise", "Churn")).toBeUndefined();
    expect(both.edges.some((edge) => edge.provenance?.natural_effect?.amount === 1200)).toBe(false);
  });

  it("keeps structural singleton identity, and fails closed on invalid fields, sign and basis", () => {
    const projected = (mutate: (variant: DraftRecordSet) => void) => naturalOn(projectVariant(mutate), "Starter tier subscribers", "Monthly support cost");
    expect(projected(() => {})).toMatchObject({ amount: -6, per_source_change: 1 });
    expect(projected((variant) => { variant.claims[13]!.effect_detail!.per_source_change = 2; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.effect_detail!.per_source_change_unit = "customer"; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.effect_detail!.amount_unit = "USD/month"; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.effect_detail!.amount = -60; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.effect = "positive"; })).toBeUndefined();
    expect(projected((variant) => { delete variant.claims[13]!.effect; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.basis = [9, 10]; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.basis = []; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.basis = [10, 999]; })).toBeUndefined();
    expect(projected((variant) => { variant.stated_items[10]!.source_quote = "Each starter subscriber costs about £6 a year in support."; })).toBeUndefined();
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
