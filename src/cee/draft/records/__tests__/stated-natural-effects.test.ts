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

const legacyRecords = {
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

function span(quote:string,literal:string){const start=quote.indexOf(literal);return {start,end:start+literal.length};}
// These fixtures now declare quantities and signed authority; matching figures alone no longer attests an effect.
const records:DraftRecordSet=structuredClone(legacyRecords);
records.stated_items.push(
  {kind:'figure',source_quote:'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month.',value:120000,unit:'£/month',quantity:11,role:'baseline',value_span:span(BRIEF,'£120,000'),unit_span:span(BRIEF,'monthly')},
  {kind:'figure',source_quote:'within 9 months',value:9,unit:'months',value_span:{start:7,end:8},unit_span:{start:9,end:15}});
Object.assign(records.stated_items[0]!,{quantity:11,baseline_ref:11,horizon_ref:12,horizon_months:9,direction:'floor',value_span:span(records.stated_items[0]!.source_quote,'£150,000'),unit_span:span(records.stated_items[0]!.source_quote,'monthly'),direction_span:span(records.stated_items[0]!.source_quote,'at least')});
for(const [index,from,to,amount,amountUnit,sourceUnit,amountLiteral,sourceLiteral] of [
  [6,6,11,1200,'£/month','%','£1,200','1%'],[7,6,5,-2,'customers','%','2','1%'],[8,5,11,-300,'£/month','customers','£300','Each'],[9,4,11,49,'£/month','subscribers','£49','Each'],[10,4,10,-6,'£/month','subscribers','£6','Each'],
] as const){const item=records.stated_items[index]!;item.relationship={from_quantity:from,to_quantity:to,amount,amount_unit:amountUnit,per_source_change:1,per_source_change_unit:sourceUnit,amount_span:span(item.source_quote,amountLiteral),source_span:span(item.source_quote,sourceLiteral)};}
Object.assign(records.stated_items[6]!,{quantity:6,unit:'%'});Object.assign(records.stated_items[10]!,{quantity:10,unit:'£/month'});
Object.assign(records.stated_items[4]!,{quantity:4,value_span:span(records.stated_items[4]!.source_quote,'150'),unit_span:span(records.stated_items[4]!.source_quote,'subscribers'),range:{low:80,high:250,unit:'subscribers',low_span:span(records.stated_items[4]!.source_quote,'80'),high_span:span(records.stated_items[4]!.source_quote,'250')}});
// A predicted change is not today's count; the flow starts at zero and derives its frame from its signed relationship.
Object.assign(records.stated_items[5]!,{quantity:5,role:'context'});records.claims[14]!.value=0;
records.stated_items[7]!.relationship!.range={low:-4,high:-1,low_literal:'4',high_literal:'between 1'};
for(const [index,q] of [[0,6],[1,4],[2,11],[3,10],[14,5]])records.claims[index]!.quantity=q;
records.claims[0]!.value=0;records.claims[9]!.sets_to=10;
// Legacy aliases into the same goal remain unsized; the canonical carrier is the revenue claim.
delete records.claims[6]!.effect_detail;delete records.claims[7]!.effect_detail;delete records.claims[8]!.effect_detail;

// Each reader probe now supplies explicit signed authority. Values/signs in the tested detail still cannot override it.
function authority(quote:string,detail:{amount:number;amount_unit:string;per_source_change:number;per_source_change_unit:string},amountLiteral:string,sourceLiteral:string){return {from_quantity:0,to_quantity:1,...detail,amount_span:span(quote,amountLiteral),source_span:span(quote,sourceLiteral)};}

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
    const authored=authority(quote,{amount:1200,amount_unit:'£/month',per_source_change:1,per_source_change_unit:'%'},'£1,200','1%');
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" },authored)).toBe(true);
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "USD/month", per_source_change: 1, per_source_change_unit: "%" },authored)).toBe(false);
    expect(statedEffectQuoteMatches(quote, { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customers" },authored)).toBe(false);
    expect(statedEffectQuoteMatches(quote, { amount: 12000, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" },authored)).toBe(false);
    expect(extractStatedLikelyRange("The starter tier would win about 150 new subscribers, between 80 and 250.")).toEqual({
      low: 80, high: 250, text: "between 80 and 250",
    });
  });

  it("locates each/every/per as exactly one source unit, including noun n-grams", () => {
    const detail = { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" };
    for (const determiner of ["Each", "Every", "per"]) {
      const quote = `${determiner} starter subscriber adds £49 a month to monthly recurring revenue.`;
      const authored=authority(quote,detail,'£49',determiner);
      expect(statedEffectQuoteMatches(quote, detail,authored)).toBe(true);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change_unit: "starter subscriber" },{...authored,per_source_change_unit:"starter subscriber"})).toBe(true);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: 2 },authored)).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: -1 },authored)).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: 1 + 1e-10 },authored)).toBe(false);
      expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change_unit: "customer" },authored)).toBe(false);
    }
    expect(statedEffectQuoteMatches("£49 a month per subscriber", detail,authority("£49 a month per subscriber",detail,"£49","per"))).toBe(true);
    expect(statedEffectQuoteMatches("Each 2 subscribers add £49 a month.", detail,authority("Each 2 subscribers add £49 a month.",{...detail,per_source_change:2},"£49","2"))).toBe(false);
    expect(statedEffectQuoteMatches("Each 2 subscribers add £49 a month.", { ...detail, per_source_change: 2 },authority("Each 2 subscribers add £49 a month.",{...detail,per_source_change:2},"£49","2"))).toBe(true);
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

      [-300, "£/month", 1, "customers"],
      [-6, "£/month", 1, "subscribers"],
      [-2, "customers", 1, "%"],
      // B6: the same revenue quantity now has an independently checked definition into the goal.
      [1, "£/month", 1, "£/month"],
    ]);
    expect(graph.edges.filter((edge) => edge.provenance?.source === "brief_extraction")).toHaveLength(5);
    expect(naturalOn(graph, "Price rise", "Monthly recurring revenue")?.amount).toBe(1200);
    expect(naturalOn(graph, "Starter tier subscribers", "Monthly recurring revenue")?.amount).toBe(49);
    expect(naturalOn(graph, "Starter tier subscribers", "Monthly support cost")?.amount).toBe(-6);
    expect(naturalOn(graph, "Customers lost to price rise", "Monthly recurring revenue")?.amount).toBe(-300);
    expect(naturalOn(graph, "Price rise", "Customers lost to price rise")?.amount).toBe(-2);
    expect(naturalOn(graph, "Price rise", records.stated_items[0].source_quote)).toBeUndefined();
    for (const edge of graph.edges.filter((edge) => edge.provenance?.natural_effect)) {
      // B6 definitions assert an exact unit conversion; transcribed effects still require the user's quote.
      if(edge.provenance!.definitional){expect(edge.provenance!.source).toBe('domain_knowledge');expect(edge.provenance!.natural_effect!.amount).toBe(1);expect(edge.provenance!.natural_effect!.strength_mean).toBe(edge.strength_mean);}
      else expect(BRIEF).toContain(edge.provenance!.quote);
    }
    const starter = graph.nodes.find((node) => node.label.includes("starter tier would win"));
    expect(starter?.observed_state).toMatchObject({ value: 0.75, raw_value: 150, baseline: 150, range: { min: 80, max: 250 } });
    const manifest = deriveNotModelledManifest(BRIEF, graph);
    const manifestItems = manifest.quantities?.items ?? [];
    expect(manifestItems.filter((item) => ["£1,200", "£49"].includes(item.literal)).every((item) => item.verdict === "in_model")).toBe(true);
    // A1 now retains the unsigned literal as prose while the signed -£6 effect is asserted above.
    expect(manifestItems.find((item) => item.literal === "£6")?.verdict).toBe("prose_only");
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
    // B4 checks the cause relationship, rather than treating basis as natural-effect authority.
    expect(projected((variant) => { variant.claims[13]!.basis = [9, 10]; variant.stated_items[10]!.relationship!.from_quantity = 11; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.basis = []; delete variant.stated_items[10]!.relationship; })).toBeUndefined();
    expect(projected((variant) => { variant.claims[13]!.basis = [10, 999]; variant.stated_items[10]!.relationship!.to_quantity = 999; })).toBeUndefined();
    expect(projected((variant) => { variant.stated_items[10]!.source_quote = "Each starter subscriber costs about £6 a year in support."; })).toBeUndefined();
  });

  it("does not let invalid natural-effect provenance take the unanchored manifest route", () => {
    // Typed endpoint evidence and the exact calculation bundle are required by the manifest reader.
    const brief = "Each 1% price rise adds £1,200 a month to monthly recurring revenue.";
    const graph = (effect: Record<string, unknown>, quote = brief) => ({
      nodes: [
        { id: "source", kind: "factor", label: "Price rise", scale_frame:100, unit:"%",data:{unit:"%"},observed_state:{unit:"%",value:0} },
        { id: "target", kind: "outcome", label: "Monthly recurring revenue", scale_frame:1200000, unit:"£/month",data:{unit:"£/month"},observed_state:{unit:"£/month"} },
      ],
      edges: [{ from: "source", to: "target", provenance: {
        source: "brief_extraction", magnitude: "user_stated", quote, source_quote:quote, natural_effect: effect,
        stated_relationship:{...authority(brief,{amount:1200,amount_unit:"£/month",per_source_change:1,per_source_change_unit:"%"},"£1,200","1%"),from_node:"source",to_node:"target"},
      }, effect_direction: "positive", strength_mean:0.1,strength_std:0.05 }],
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
