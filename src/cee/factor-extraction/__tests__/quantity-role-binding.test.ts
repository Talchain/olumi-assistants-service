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

  /**
   * ⚠ THE EXPECTED LEVEL MOVED 59 → 49, AND THAT IS THE POINT OF THE CHANGE,
   * NOT A CASUALTY OF IT (`enricher.ts` `statedCurrentRaw`).
   *
   * This case is about ROLE BINDING — that the MRR amount cannot stamp the
   * perception factor and the PRICE quantities land on the price node — and it
   * pinned the level incidentally. The level it pinned was the brief's TARGET:
   * Paul's *"from £49 to £59"* reached the canvas as *"£59"*, telling the user
   * the price they are considering is the price they already charge.
   *
   * Everything this case is actually about is unchanged: the same node binds
   * the same quantities, `baseline` still carries the stated 49, the cap is
   * still 100, and the `value === raw_value / cap` invariant below still holds
   * (0.49 = 49/100) — it is re-asserted, not relaxed. The full property has its
   * own corpus in `factor-current-level-is-the-stated-baseline.test.ts`.
   */
  it("positive counterpart: the same brief retains stated current and proposed prices and raw scale", async () => {
    const result = await enrichGraphWithFactorsAsync(model(), ORIGINAL_BRIEF);
    expect(result.extractionMode).toBe("regex-only");
    const price = FactorData.parse(node(result.graph, PRICE_ID).data);
    expect(price).toMatchObject({ value: 0.49, baseline: 49, raw_value: 49, cap: 100, unit: "£", factor_type: "price", extractionType: "explicit", display_value: "£49" });
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


  /**
   * ⭐⭐⭐ THE RECEIVING-PATH REGRESSION FOR THE CURRENCY DEFAULT.
   *
   * `inferFactorType`'s currency branch is the one place in that function that
   * answers a question it has no evidence for: three keyword checks, then
   * `return "cost"`. Every other unknown falls through to `"other"`.
   *
   * ⚠ THESE TESTS DO NOT REPRODUCE THE WITNESSED MISBINDING, AND SAY SO. On the
   * 2026-09-08 22:38 pricing run the £20k MRR amount reached the graph attached
   * to "Pro Feature Value Perception" as `factor_type:'cost'`. The ATTACHMENT is
   * already refused at this tip — that is what the first four cases in this file
   * pin, and #1405 closed it. What remains reachable is narrower and is what is
   * tested here: when a currency amount LEGITIMATELY binds under the extractor's
   * fallback label `Value`, the write still stamps a positive claim about which
   * kind of money it is.
   *
   * Both cases assert their own precondition — that the amount was actually
   * written — so neither can pass by the binding quietly disappearing.
   */
  it("⭐ a legitimately bound fallback-label amount is NOT stamped as a cost", async () => {
    const result = await enrichGraphWithFactorsAsync(model("Value"), "The stated amount is £20000.");
    const written = FactorData.parse(node(result.graph, FEATURE_ID).data);

    // Precondition, in-test: the amount really did land on this node.
    expect(result.factorsEnhanced).toBe(1);
    expect(written).toMatchObject({ raw_value: 20000, cap: 100000, unit: "£", value: 0.2 });

    // "The stated amount" says nothing about the KIND of money.
    expect(written.factor_type).not.toBe("cost");
    expect(written.factor_type).toBe("other");
  });

  it("⭐ the captured pricing brief's £20k MRR amount, once bound, is not a cost either", async () => {
    const result = await enrichGraphWithFactorsAsync(model("Value"), ORIGINAL_BRIEF);
    const written = FactorData.parse(node(result.graph, FEATURE_ID).data);

    // Precondition: this is the captured £20k, on the captured text.
    expect(written).toMatchObject({ raw_value: 20000, unit: "£" });

    expect(written.factor_type).not.toBe("cost");
    expect(written.factor_type).toBe("other");
  });

  it("⚠ withholding the CLAIM withholds nothing the person sees or analyses", async () => {
    // The amount, its scale and its rendering must be identical to a factor that
    // genuinely types `cost`. Only the unsupported claim differs — otherwise this
    // is a silent data loss wearing an honesty argument.
    const asCost = await enrichGraphWithFactorsAsync(model("Annual Hiring Budget"), "Our hiring budget is £200k.");
    const unclassified = await enrichGraphWithFactorsAsync(model("Value"), "The stated amount is £200k.");
    const a = FactorData.parse(node(asCost.graph, FEATURE_ID).data);
    const b = FactorData.parse(node(unclassified.graph, FEATURE_ID).data);

    expect(a.factor_type).toBe("cost");
    expect(b.factor_type).toBe("other");

    expect(b.value).toBe(a.value);
    expect(b.raw_value).toBe(a.raw_value);
    expect(b.cap).toBe(a.cap);
    expect(b.unit).toBe(a.unit);
    expect(b.display_value).toBe(a.display_value);
    expect(b.display_value).toBeDefined();
  });

  it("⭐ discriminating twin: a stated revenue amount still types revenue", async () => {
    const result = await enrichGraphWithFactorsAsync(model("Revenue"), "Our monthly revenue is £30k.");
    const written = FactorData.parse(node(result.graph, FEATURE_ID).data);
    expect(result.factorsEnhanced).toBe(1);
    expect(written).toMatchObject({ factor_type: "revenue", raw_value: 30000, unit: "£" });
  });

  // The cost twin is the existing "positive non-pricing counterpart" case above:
  // "Annual Hiring Budget" / "Our hiring budget is £200k." already asserts
  // `factor_type: "cost"`, and its expectation is deliberately NOT graduated.

  it("existing absolute-level authority distinguishes stated churn from uplift or an upper bound", () => {
    expect(deriveStatedTargetBaselinePercent("Monthly churn is 3% today.", "Monthly churn")).toBe(3);
    expect(deriveStatedTargetBaselinePercent("Monthly churn uplift is 4%.", "Monthly churn")).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent("Keep monthly churn under 4%.", "Monthly churn")).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent(ORIGINAL_BRIEF, "Monthly churn")).toBeUndefined();
  });
});
