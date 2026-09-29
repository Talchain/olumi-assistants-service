import { describe, it, expect } from "vitest";
import { projectRecordsToGraph } from "../../draft/records/projector.js";
import { enrichGraphWithFactorsAsync } from "../enricher.js";

/**
 * ⭐⭐⭐ A FIGURE MAY ONLY BE WRITTEN ONTO A NODE THAT IS BASED ON IT.
 *
 * ── THE MEASURED HARM (two independent fresh drafts, 14 Sep 2026)
 * Brief: "increasing the Pro plan price from £49 to £59 per month with the next
 * Pro feature release, while keeping monthly churn under 4% and reaching £20k
 * MRR within 12 months."
 *
 * The saved graph put the user's PRICE on the CHURN factor — node `22a8bb6d`
 * "Price-Driven Churn Rate" carried `display_value: "£49"`, `unit: "£"`,
 * `raw_value: 49`, `value: 0.49`, `source: "brief_extraction"` — while the
 * actual price factor `6d9a37f3` "Pro Plan Monthly Price" carried NO observed
 * state at all. The browser rendered the same wrong association, so this was
 * never a display defect.
 *
 * ── THE RAW RECORDS WERE CORRECT, SO THE CONVERSION CORRUPTED THEM
 * The draft records associate "Pro Plan Monthly Price" with £49/£59
 * (`basis: [3,4]`) and "Price-Driven Churn Rate" with 4% (`basis: [7]`). The
 * record projector already resolves that to node provenance. The enricher then
 * discarded it and re-derived the association from LABEL TOKENS: `labelsMatch`
 * is a bidirectional substring test plus synonym groups that contain BOTH
 * `["price", …]` AND `["churn", …]`, and "Price-Driven Churn Rate" contains the
 * token "price". `existingFactors.find(…)` took the FIRST such node and the
 * write landed on the wrong subject.
 *
 * ── WHY THE EXISTING SPAN GATE DID NOT STOP IT
 * `enhanceWriteIsSpanContained` is the designated rejection test, but its first
 * line is `if (quote === undefined) return true` — and a CLAIM-derived node has
 * no `source_quote` by construction (`projector.ts:3056` mints
 * `provenance_class: "ai_inferred"` with `basis`/`unbased` and no quote). Every
 * AI-minted factor is therefore span-less, so the one gate that could refuse
 * the write was vacuous for exactly the nodes the model invents.
 *
 * ── WHAT THESE TESTS BIND TO
 * Node IDENTITY (`6d9a37f3`, `22a8bb6d`, `f41a4049`) and the figures the
 * records declare — never a value predicate another node could satisfy, and
 * never a count of how many figures reached the model.
 */

/** The captured draft records from the 14 Sep fresh draft (stated items + claims). */
const CAPTURED_RECORDS = {
  "stated_items": [
    {
      "kind": "goal",
      "source_quote": "reaching £20k MRR within 12 months",
      "role": "target",
      "is_baseline": false
    },
    {
      "kind": "option",
      "source_quote": "increase the Pro plan price from £49 to £59 per month with the next Pro feature release",
      "is_baseline": false
    },
    {
      "kind": "constraint",
      "source_quote": "keeping monthly churn under 4%",
      "direction": "ceiling",
      "applies_to_stated": 0
    },
    {
      "kind": "figure",
      "source_quote": "£49",
      "value": 49,
      "unit": "£"
    },
    {
      "kind": "figure",
      "source_quote": "£59",
      "value": 59,
      "unit": "£"
    },
    {
      "kind": "figure",
      "source_quote": "£20k MRR",
      "value": 20000,
      "unit": "£"
    },
    {
      "kind": "figure",
      "source_quote": "12 months",
      "value": 12,
      "unit": "months"
    },
    {
      "kind": "figure",
      "source_quote": "4%",
      "value": 4,
      "unit": "%"
    }
  ],
  "claims": [
    {
      "claim_kind": "option_refinement",
      "label": "Hold Price at £49",
      "basis": [
        1
      ],
      "is_baseline": true
    },
    {
      "claim_kind": "option_refinement",
      "label": "Raise Price to £59 with Feature Release",
      "basis": [
        1
      ],
      "is_baseline": false
    },
    {
      "claim_kind": "option_refinement",
      "label": "Raise Price to £59 Immediately (No Feature Tie)",
      "basis": [
        1
      ],
      "is_baseline": false
    },
    {
      "claim_kind": "factor",
      "label": "Pro Plan Monthly Price",
      "basis": [
        3,
        4
      ]
    },
    {
      "claim_kind": "factor",
      "label": "Feature Release Quality",
      "basis": [
        1
      ]
    },
    {
      "claim_kind": "factor",
      "label": "Price-Driven Churn Rate",
      "basis": [
        7
      ]
    },
    {
      "claim_kind": "outcome",
      "label": "Monthly Recurring Revenue",
      "basis": [
        0,
        5
      ]
    },
    {
      "claim_kind": "risk",
      "label": "Subscriber Churn on Price Rise",
      "basis": [
        2,
        7
      ]
    },
    {
      "claim_kind": "prior",
      "label": "Customer Price Sensitivity",
      "basis": []
    },
    {
      "claim_kind": "causal_link",
      "label": "Holding price keeps MRR at current per-seat rate, limiting revenue growth",
      "from_claim": 0,
      "to_claim": 3,
      "effect": "positive",
      "sets_to": 49,
      "is_baseline": true
    },
    {
      "claim_kind": "causal_link",
      "label": "Raising price with feature release sets per-seat revenue higher",
      "from_claim": 1,
      "to_claim": 3,
      "effect": "positive",
      "sets_to": 59
    },
    {
      "claim_kind": "causal_link",
      "label": "Raising price immediately sets per-seat revenue higher but without feature justification",
      "from_claim": 2,
      "to_claim": 3,
      "effect": "positive",
      "sets_to": 59
    },
    {
      "claim_kind": "causal_link",
      "label": "Feature release quality moderates churn risk when price rises",
      "from_claim": 1,
      "to_claim": 4,
      "effect": "positive",
      "sets_to": 0.75
    },
    {
      "claim_kind": "causal_link",
      "label": "No feature release leaves churn risk unmitigated",
      "from_claim": 2,
      "to_claim": 4,
      "effect": "positive",
      "sets_to": 0.2
    },
    {
      "claim_kind": "causal_link",
      "label": "Status quo option holds feature release quality at baseline",
      "from_claim": 0,
      "to_claim": 4,
      "effect": "positive",
      "sets_to": 0.5
    },
    {
      "claim_kind": "causal_link",
      "label": "Higher price increases churn probability among price-sensitive subscribers",
      "from_claim": 3,
      "to_claim": 5,
      "effect": "positive"
    },
    {
      "claim_kind": "causal_link",
      "label": "Feature release quality reduces churn risk by justifying price",
      "from_claim": 4,
      "to_claim": 5,
      "effect": "negative"
    },
    {
      "claim_kind": "causal_link",
      "label": "Pro plan price directly drives per-seat MRR",
      "from_claim": 3,
      "to_claim": 6,
      "effect": "positive"
    },
    {
      "claim_kind": "causal_link",
      "label": "Subscriber churn reduces active subscriber count and therefore MRR",
      "from_claim": 7,
      "to_claim": 6,
      "effect": "negative"
    },
    {
      "claim_kind": "causal_link",
      "label": "MRR outcome drives progress toward £20k MRR goal",
      "from_claim": 6,
      "to_stated": 0,
      "effect": "positive"
    },
    {
      "claim_kind": "causal_link",
      "label": "Churn risk threatens goal by eroding subscriber base",
      "from_claim": 7,
      "to_stated": 0,
      "effect": "negative"
    },
    {
      "claim_kind": "prior",
      "label": "Competitive Pricing Pressure",
      "basis": []
    }
  ]
} as const;

const BRIEF =
  "We are increasing the Pro plan price from £49 to £59 per month with the next Pro feature release, " +
  "while keeping monthly churn under 4% and reaching £20k MRR within 12 months.";

/** Node ids are content-addressed by the projector, so they are stable identities. */
const PRICE_FACTOR = "6d9a37f3"; // "Pro Plan Monthly Price",   declared basis £49/£59
const CHURN_FACTOR = "22a8bb6d"; // "Price-Driven Churn Rate",  declared basis 4%

type Prov = { basis_figures?: readonly { value: number; unit?: string }[] };
const provOf = (n: unknown): Prov => ((n as { provenance?: Prov }).provenance ?? {});

describe("the record projector carries which figures a claim is based on", () => {
  it("resolves each claim's basis to the stated figures themselves, not just their ids", () => {
    const projection = projectRecordsToGraph(CAPTURED_RECORDS as never, BRIEF);
    const byId = new Map(projection.graph.nodes.map((n) => [n.id, n]));

    const price = byId.get(PRICE_FACTOR);
    expect(price, `node ${PRICE_FACTOR} "Pro Plan Monthly Price" must exist`).toBeDefined();

    // TARGET: the price factor declares the user's two price figures.
    const priceFigures = (provOf(price).basis_figures ?? []).map((f) => f.value);
    expect(priceFigures).toEqual(expect.arrayContaining([49, 59]));

    // CONTRAST, SAME RUN: a node based on the 4% declares 4 and NOT 49 —
    // so a non-empty read above is a measurement, not a probe that says
    // "everything" to everything.
    const churnish = projection.graph.nodes.find(
      (n) => provOf(n).basis_figures?.some((f) => f.value === 4 && f.unit === "%") === true,
    );
    expect(churnish, "some node must declare the stated 4% as its basis").toBeDefined();
    expect((provOf(churnish).basis_figures ?? []).map((f) => f.value)).not.toContain(49);
  });
});

describe("the brief→saved-model conversion puts each figure on its own subject", () => {
  /** The graph as the 14 Sep draft saved it: claim-derived factor nodes, no values yet. */
  function capturedGraph(order: "as-captured" | "reversed") {
    const projection = projectRecordsToGraph(CAPTURED_RECORDS as never, BRIEF);
    const declared = new Map(projection.graph.nodes.map((n) => [n.id, provOf(n).basis_figures]));
    const factor = (id: string, label: string, basisFigures: readonly { value: number; unit?: string }[]) => ({
      id,
      kind: "factor" as const,
      label,
      provenance: {
        provenance_class: "ai_inferred",
        basis: [],
        unbased: false,
        ...(declared.get(id) !== undefined ? { basis_figures: declared.get(id) } : { basis_figures: basisFigures }),
      },
    });
    const nodes = [
      { id: "123e4591", kind: "decision" as const, label: "Question" },
      { id: "1e5b7a20", kind: "factor" as const, label: "Feature Release Quality", provenance: { provenance_class: "ai_inferred", basis: [], unbased: true } },
      factor(CHURN_FACTOR, "Price-Driven Churn Rate", [{ value: 4, unit: "%" }]),
      factor(PRICE_FACTOR, "Pro Plan Monthly Price", [{ value: 49, unit: "£" }, { value: 59, unit: "£" }]),
      { id: "94fa174b", kind: "outcome" as const, label: "Monthly Recurring Revenue" },
      { id: "b4014d90", kind: "goal" as const, label: "Reach £20k MRR Within 12 Months" },
    ];
    // Order is not semantics: the same records must convert the same way whichever
    // order the nodes happen to sit in. Pristine `find()` is first-match-wins.
    const factorIdx = [2, 3];
    if (order === "reversed") [nodes[factorIdx[0]!], nodes[factorIdx[1]!]] = [nodes[factorIdx[1]!]!, nodes[factorIdx[0]!]!];
    return { nodes, edges: [] };
  }

  const STATED_CURRENCY = [49, 59, 54, 20000];

  for (const order of ["as-captured", "reversed"] as const) {
    it(`binds the price figure to the price factor and refuses it on the churn factor (node order: ${order})`, async () => {
      const result = await enrichGraphWithFactorsAsync(capturedGraph(order) as never, BRIEF, {});
      const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));

      const churn = byId.get(CHURN_FACTOR);
      const price = byId.get(PRICE_FACTOR);
      expect(churn, `node ${CHURN_FACTOR} must survive the conversion`).toBeDefined();
      expect(price, `node ${PRICE_FACTOR} must survive the conversion`).toBeDefined();

      const churnData = (churn!.data ?? {}) as Record<string, unknown>;
      const priceData = (price!.data ?? {}) as Record<string, unknown>;

      // ── TARGET: the churn factor must not be given the user's price.
      expect(churnData.unit, `"${churn!.label}" must not be denominated in currency`).not.toBe("£");
      for (const figure of STATED_CURRENCY) {
        expect(churnData.raw_value, `"${churn!.label}" must not carry the stated ${figure}`).not.toBe(figure);
        expect(churnData.baseline, `"${churn!.label}" must not be based at ${figure}`).not.toBe(figure);
      }
      expect(churnData.display_value ?? "", `"${churn!.label}" must not display a price`).not.toMatch(/£/);

      // ── CONTRAST, SAME RUN: the price factor must actually receive it.
      // Without this the target above passes whenever the conversion writes
      // nothing at all, which is not the property under test.
      expect(priceData.unit, `"${price!.label}" must be denominated in the stated currency`).toBe("£");
      expect(
        [priceData.raw_value, priceData.baseline],
        `"${price!.label}" must carry the user's stated £49`,
      ).toContain(49);

      // ── AND refusing the price must not cost the user the 4% they stated
      // about churn: the figure must still reach this node's subject.
      //
      // ⛔⛔ DELIBERATELY NOT `expect(churnData.value).toBe(0.04)`, AND THIS IS
      // THE LOAD-BEARING PART OF THE ASSERTION.
      //
      // `value` is the field for WHAT IS CURRENTLY TRUE. The user wrote "keep
      // monthly churn under 4%" — a LIMIT. Writing 0.04 into `value` makes the
      // model assert that churn IS 4%, which the user never said, and
      // `schema-v3.ts:362` then badges it `source: "brief_extraction"` — the
      // product's own words for "the user told us this". That is an OPEN DEFECT
      // on a different seam (the constraint-binding path), not something this
      // change closes.
      //
      // Pinning `value === 0.04` here would CEMENT it: the fix that stops
      // asserting a limit as an observation would have to break this test to
      // land. So this asserts only what is true under BOTH the current
      // behaviour and the corrected one — the 4% is not lost, and it is not
      // denominated in currency. A test written to guard one defect must not
      // quietly ratify its neighbour.
      expect(
        [churnData.value, churnData.raw_value, churnData.goal_threshold],
        `"${churn!.label}" must still carry the user's stated 4% somewhere`,
      ).toContain(0.04);
      expect(churnData.unit, `"${churn!.label}"'s own figure is a percentage`).not.toBe("£");
    });
  }
});

describe("the conversion does not mint a rival factor for a figure already placed", () => {
  /**
   * THE SECOND SITE. `extractFactors` labels by proximity, and in "…keeping
   * monthly churn under 4% and reaching £20k MRR within 12 months" it returns
   * the £20k MRR GOAL figure under the label "Churn Rate". With no existing
   * factor to match, the create branch minted `factor_churn_rate_0` — a churn
   * factor denominated in POUNDS at `raw_value: 20000`, badged
   * `extractionType: "explicit"`, invented from the user's revenue target.
   */
  it("refuses to invent a churn factor from the MRR goal figure, and keeps the price binding", async () => {
    const projection = projectRecordsToGraph(CAPTURED_RECORDS as never, BRIEF);
    const result = await enrichGraphWithFactorsAsync(projection.graph as never, BRIEF, {});

    // ── TARGET: no node anywhere carries the £20k on a churn subject.
    const invented = result.graph.nodes.filter((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return /churn|attrition|retention/i.test(n.label ?? "") && (d.unit === "£" || d.raw_value === 20000);
    });
    expect(
      invented.map((n) => `${n.id} "${n.label}" ${JSON.stringify(n.data)}`),
      "no churn-subject node may be denominated in currency or carry the MRR goal figure",
    ).toEqual([]);

    // ── CONTRAST, SAME RUN: the conversion is still writing. Without this the
    // assertion above passes whenever enrichment does nothing at all.
    const price = result.graph.nodes.find((n) => n.id === PRICE_FACTOR);
    const priceData = (price?.data ?? {}) as Record<string, unknown>;
    expect(priceData.unit, "the price factor must still receive the stated currency").toBe("£");
    expect([priceData.raw_value, priceData.baseline], "the price factor must still carry £49").toContain(49);
  });
});
