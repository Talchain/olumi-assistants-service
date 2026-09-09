import { describe, expect, it } from "vitest";
import { FactorData, Graph, type GraphT } from "../../../schemas/graph.js";
import { extractFactors } from "../index.js";
import { enrichGraphWithFactors, enrichGraphWithFactorsAsync } from "../enricher.js";
import { deriveStatedTargetBaselinePercent } from "../stated-level.js";

// Original user text from the b0d541a9 manual test. The graph below is a
// controlled pre-enrichment fixture, NOT a recovered raw model response.
const ORIGINAL_BRIEF = "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";
const FEATURE_ID = "3b8f6a73";
const PRICE_ID = "6d9a37f3";
const GOAL_ID = "b4014d90";

function model(label = "Pro Feature Value Perception", quote?: string): GraphT {
  return Graph.parse({
    nodes: [
      { id: GOAL_ID, kind: "goal", label: "Reach £20k MRR Within 12 Months" },
      {
        id: FEATURE_ID, kind: "factor", label,
        data: { factor_type: "quality", uncertainty_drivers: ["Customer response is not yet measured"] },
        ...(quote ? { provenance: { provenance_class: "stated", source_quote: quote } } : {}),
      },
      { id: PRICE_ID, kind: "factor", label: "Pro Plan Price" },
    ],
    edges: [{ from: FEATURE_ID, to: GOAL_ID, belief: 0.5 }],
  });
}

function node(graph: GraphT, id: string) {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Fixture lost node ${id}`);
  return found;
}

describe("quantity identity at the real enrichment write", () => {
  it("pins the source-compatible precondition: the MRR amount really has fallback label Value", () => {
    expect(extractFactors(ORIGINAL_BRIEF)).toContainEqual(expect.objectContaining({
      label: "Value", value: 20000, unit: "£", matchedText: "£20k", extractionType: "explicit",
    }));
  });

  for (const entry of ["async", "sync"] as const) {
    for (const sameSentenceQuote of [false, true]) {
      it(`${entry}: MRR currency cannot stamp qualitative perception, quote=${sameSentenceQuote}`, async () => {
        const input = model(undefined, sameSentenceQuote ? ORIGINAL_BRIEF : undefined);
        const before = structuredClone(input);
        const result = entry === "async"
          ? await enrichGraphWithFactorsAsync(input, ORIGINAL_BRIEF)
          : enrichGraphWithFactors(input, ORIGINAL_BRIEF);

        expect(node(result.graph, FEATURE_ID)).toEqual(node(before, FEATURE_ID));
        expect(result.factorsSkipped).toBeGreaterThan(0);
        // A refused binding must not become a newly minted generic factor or
        // cap. The amount remains in the brief, not in a fabricated scalar.
        expect(result.graph.nodes.some((n) => n.label === "Value")).toBe(false);
        expect(result.graph.nodes.some((n) => n.data && "raw_value" in n.data && n.data.raw_value === 20000)).toBe(false);
        expect(input).toEqual(before);
      });
    }
  }

  it.each([
    ["We aim to reach $80k ARR.", "Customer Value Perception", 80000, "$"],
    ["The proposal mentions €250k.", "Cultural Value Alignment", 250000, "€"],
  ] as const)("non-pricing contrast: %s does not quantify %s", async (brief, label, amount, unit) => {
    const input = model(label);
    expect(extractFactors(brief)).toContainEqual(expect.objectContaining({ label: "Value", value: amount, unit }));
    const result = await enrichGraphWithFactorsAsync(input, brief);
    expect(node(result.graph, FEATURE_ID)).toEqual(node(input, FEATURE_ID));
    expect(result.factorsEnhanced).toBe(0);
    expect(result.factorsAdded).toBe(0);
    expect(result.graph.edges).toEqual(input.edges);
  });

  it("an unbound percentage does not quantify confidence in a rate", async () => {
    const brief = "The board mentioned 4%.";
    const input = model("Conversion Rate Confidence");
    expect(extractFactors(brief)).toContainEqual(expect.objectContaining({ label: "Rate", value: 0.04, unit: "%" }));
    const result = await enrichGraphWithFactorsAsync(input, brief);
    expect(node(result.graph, FEATURE_ID)).toEqual(node(input, FEATURE_ID));
    expect(result.factorsAdded).toBe(0);
  });

  it("an unbound range does not quantify a differently named factor", async () => {
    const brief = "Between 2 and 4.";
    const input = model("Human Factors Confidence");
    expect(extractFactors(brief)).toContainEqual(expect.objectContaining({ label: "Factor", value: 3, extractionType: "range" }));
    const result = await enrichGraphWithFactorsAsync(input, brief);
    expect(node(result.graph, FEATURE_ID)).toEqual(node(input, FEATURE_ID));
    expect(result.factorsAdded).toBe(0);
  });

  it("an exact existing quantity label retains its prior binding", async () => {
    const result = await enrichGraphWithFactorsAsync(model("Value"), "The stated amount is £20000.");
    expect(FactorData.parse(node(result.graph, FEATURE_ID).data)).toMatchObject({
      value: 0.2, raw_value: 20000, cap: 100000, unit: "£",
    });
    expect(result.factorsEnhanced).toBe(1);
  });

  it("positive counterpart: the same brief retains stated current and proposed prices and raw scale", async () => {
    const result = await enrichGraphWithFactorsAsync(model(), ORIGINAL_BRIEF);
    expect(result.extractionMode).toBe("regex-only");
    const price = FactorData.parse(node(result.graph, PRICE_ID).data);
    expect(price).toMatchObject({ value: 0.59, baseline: 49, raw_value: 59, cap: 100, unit: "£", factor_type: "price", extractionType: "explicit", display_value: "£59" });
    if (price.raw_value === undefined || price.cap === undefined) throw new Error("Price lost its raw scale");
    expect(price.value).toBe(price.raw_value / price.cap);
    expect(node(result.graph, GOAL_ID).goal_baseline).toBeUndefined();
    // No claim that the existing goal grammar has acquired the trailing MRR
    // target or that execution now establishes goal/churn success.
    expect(node(result.graph, GOAL_ID).goal_threshold).toBeUndefined();
  });

  it("positive non-pricing counterpart: an identified hiring budget retains its own currency scale", async () => {
    const result = await enrichGraphWithFactorsAsync(model("Annual Hiring Budget"), "Our hiring budget is £200k.");
    expect(FactorData.parse(node(result.graph, FEATURE_ID).data)).toMatchObject({
      value: 0.2, raw_value: 200000, cap: 1000000, unit: "£", factor_type: "cost", display_value: "£200k",
    });
  });

  it("an already stored value, including zero, is not overwritten", async () => {
    const input = model();
    node(input, PRICE_ID).data = FactorData.parse({ value: 0, raw_value: 0, cap: 100, unit: "£", factor_type: "price" });
    const before = structuredClone(input);
    const result = await enrichGraphWithFactorsAsync(input, ORIGINAL_BRIEF);
    expect(node(result.graph, PRICE_ID)).toEqual(node(before, PRICE_ID));
    expect(input).toEqual(before);
  });

  it("supported explicit target keeps its role without inventing a current baseline", async () => {
    const result = await enrichGraphWithFactorsAsync(model(), "Our target is £20000.");
    expect(node(result.graph, GOAL_ID)).toMatchObject({ goal_threshold_raw: 20000, goal_threshold_unit: "£", goal_threshold_frame: "level" });
    expect(node(result.graph, GOAL_ID).goal_baseline).toBeUndefined();
    expect(node(result.graph, GOAL_ID).goal_baseline_raw).toBeUndefined();
    expect(node(result.graph, FEATURE_ID)).toEqual(node(model(), FEATURE_ID));
  });

  it("existing absolute-level authority distinguishes stated churn from uplift or an upper bound", () => {
    expect(deriveStatedTargetBaselinePercent("Monthly churn is 3% today.", "Monthly churn")).toBe(3);
    expect(deriveStatedTargetBaselinePercent("Monthly churn uplift is 4%.", "Monthly churn")).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent("Keep monthly churn under 4%.", "Monthly churn")).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent(ORIGINAL_BRIEF, "Monthly churn")).toBeUndefined();
  });
});
