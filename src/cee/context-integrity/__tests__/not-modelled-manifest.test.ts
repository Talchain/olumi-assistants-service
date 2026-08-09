/**
 * ROADMAP 2.973 — THE NOT-MODELLED MANIFEST, graded against real deployed bytes.
 *
 * ── THE ORACLE IS NOT MINE ─────────────────────────────────────────────────
 * Every expectation below is taken from the per-atom loss tables in
 * `PHASE0-EVIDENCE-2026-07-28/context-integrity-trace-2026-08-08/loss-map.md`,
 * produced by a DIFFERENT lane by driving the deployed system with three real
 * strategic briefs and grading 76 pre-registered information atoms by hand.
 *
 * This matters more than it looks (trap 13c — a mutant kit validates
 * sensitivity, never correctness). A test whose expectations came from reading
 * this module's own output would be a perfect score on the wrong exam: it would
 * pin whatever the code happens to do. These expectations were written down by
 * someone who had never seen this code, from the deployed product's behaviour.
 * Each assertion cites the atom id it comes from.
 *
 * ── THE FIXTURES ARE REAL WIRE BYTES ───────────────────────────────────────
 * `fixtures/*.cold-read.json` are the unedited `brief_text` + `graph` from the
 * trace's own cold-read captures against CEE build `4b57b8f` (a fixture you
 * authored yourself is not evidence about the wire — trap 16-inverse). They are
 * carried whole, including the `trace` and `_pipeline_outcome` subtrees the
 * derivation must ignore, so that a mutant which stops ignoring them BITES.
 *
 * ── ANTI-VACUITY ───────────────────────────────────────────────────────────
 * Every verdict assertion is preceded by `expectStatedAt`, which proves the
 * fixture genuinely carries that literal at that offset. Without it, a typo'd
 * literal would silently find no item and `undefined?.verdict` assertions would
 * pass by testing nothing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriveNotModelledManifest,
  extractStatedQuantities,
  NOT_TRACKED_CLASSES,
  type NotModelledItem,
} from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}

function loadCapture(name: string): ColdRead {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", `${name}.cold-read.json`), "utf8"),
  ) as ColdRead;
}

const B1 = loadCapture("b1-growth"); // market entry — Germany vs UK depth
const B2 = loadCapture("b2-restructuring"); // £4m opex reduction
const B3 = loadCapture("b3-product-bet"); // copilot vs platform rewrite

/**
 * Find the item for a literal, having FIRST proved the brief really says it
 * there. Binds by identity (offset + exact literal), never by a value predicate
 * another quantity could satisfy (trap 19).
 */
function statedItem(capture: ColdRead, literal: string): NotModelledItem {
  const offset = capture.brief_text.indexOf(literal);
  expect(
    offset,
    `PRECONDITION: the captured brief must contain "${literal}"`,
  ).toBeGreaterThanOrEqual(0);
  expect(capture.brief_text.slice(offset, offset + literal.length)).toBe(literal);

  const m = deriveNotModelledManifest(capture.brief_text, capture.graph);
  const item = m.quantities?.items.find(
    (i) => i.char_offset === offset && i.literal === literal,
  );
  expect(
    item,
    `the derivation must report "${literal}" at offset ${offset}`,
  ).toBeDefined();
  return item as NotModelledItem;
}

describe("the fixtures are the trace's real captures", () => {
  it("carries the briefs and graphs at the sizes the trace recorded", () => {
    // Pins the fixture's identity. If someone swaps or trims a capture, every
    // oracle-derived expectation below is measuring a different thing, and this
    // fails first with a readable reason.
    expect(B1.brief_text).toHaveLength(1945);
    expect(B2.brief_text).toHaveLength(2078);
    expect(B3.brief_text).toHaveLength(2563);
    expect((B1.graph.nodes as unknown[]).length).toBe(24);
    expect((B2.graph.nodes as unknown[]).length).toBe(20);
    expect((B3.graph.nodes as unknown[]).length).toBe(19);
  });

  it("still carries the internal subtrees the derivation must ignore", () => {
    // A positive control for the exclusion mutants: if the fixture stopped
    // carrying `trace`/`_pipeline_outcome`, the "ignores internals" mutants
    // below would pass by having nothing to find (trap 13).
    expect(B1.graph).toHaveProperty("trace");
    expect(B1.graph).toHaveProperty("_pipeline_outcome");
    expect(B1.graph).toHaveProperty("coaching");
  });
});

describe("B1 growth brief — oracle: loss-map B1 per-atom table", () => {
  it("reports the ARR baseline as absent (atom A03, graded HIGH)", () => {
    // "£11.2m ARR" — the baseline the £20m goal is measured from.
    expect(statedItem(B1, "£11.2m").verdict).toBe("absent");
  });

  it("reports NRR 112% as absent (atom A22, graded SEVERE)", () => {
    // The trace's sharpest single finding: the value was dropped, the factor
    // got a maximum-width prior, the widest prior topped the influence ranking,
    // and the product then told the user to go and collect the number they had
    // just given it.
    expect(statedItem(B1, "112%").verdict).toBe("absent");
  });

  it("reports the cash position as absent after its magnitude collapsed (atom A14)", () => {
    // "£3.1m cash" became a unitless 0.31. Neither 3.1 nor 3,100,000 is in the
    // model, so the honest answer is that the stated figure is not there.
    expect(statedItem(B1, "£3.1m").verdict).toBe("absent");
  });

  it("reports the Gartner TAM as absent (atom A09, graded HIGH)", () => {
    expect(statedItem(B1, "€400m").verdict).toBe("absent");
  });

  it("reports the surviving marketing cap as in_model (atom A20)", () => {
    // The constraint chain demonstrably works where a cap-bearing factor is
    // drafted. The manifest must NOT cry loss over this, or it becomes noise.
    // `fac_marketing_spend` carries cap 1.5 under unit "£m" — same currency,
    // and 1.5 x 10^6 is exactly what the brief said.
    const item = statedItem(B1, "£1.5m");
    expect(item.verdict).toBe("in_model");
    // A numeric match must NAME its carrier, or it is not a match.
    expect(item.matched_node_id).toBe("fac_marketing_spend");
  });

  it("does NOT claim the headcount cap, whose declared unit is money (atom A19)", () => {
    // ⚠ A DELIBERATE DIVERGENCE FROM THE TRACE'S GRADING, and the reason
    // matters. The trace graded A19 "faithful (constraint→cap)" because the
    // number 8 reached the graph. That answers "did the value arrive?". This
    // surface makes a STRICTER claim to the user — "the model is using your
    // figure" — and a unit mismatch defeats it: `fac_headcount_budget` records
    // that cap under unit "£m", so what the model holds is £8m, not 8 hires.
    //
    // Two different questions under one number (trap 21). Telling the user
    // their hiring constraint is in the model, when what is in the model is a
    // money cap, is exactly the confident-false-statement this panel exists to
    // stop. Falling to "not modelled yet" invites them to add it — the
    // recoverable direction.
    expect(statedItem(B1, "8 people").verdict).not.toBe("in_model");

    // PRECONDITION, pinned in-test so this cannot pass by the cap having
    // vanished from the fixture: the carrier really is there, really is 8, and
    // really declares a money unit.
    const nodes = B1.graph.nodes as Array<Record<string, unknown>>;
    const headcount = nodes.find((n) => n.id === "fac_headcount_budget");
    const observed = headcount?.observed_state as Record<string, unknown>;
    expect(observed.cap).toBe(8);
    expect(observed.unit).toBe("£m");

    // And the pair partner: the SAME magnitude stated as money DOES match it,
    // so the rule discriminates on unit rather than simply refusing counts.
    const asMoney = deriveNotModelledManifest("We can spend £8m on this.", B1.graph);
    const eightMillion = asMoney.quantities?.items.find((i) => i.literal === "£8m");
    expect(eightMillion?.verdict).toBe("in_model");
    expect(eightMillion?.matched_node_id).toBe("fac_headcount_budget");
  });

  it("reports the goal figure as in_model (atom A07)", () => {
    expect(statedItem(B1, "£20m").verdict).toBe("in_model");
  });

  it("separates a coaching quote from a modelled value (atom A06)", () => {
    // "70% penetrated" is quoted verbatim by the Anchoring coaching card and
    // parameterises nothing. Calling that "in the model" is exactly the
    // confident-false-statement failure the trace measured as loss class 7.
    expect(statedItem(B1, "70%").verdict).toBe("prose_only");
  });
});

describe("B2 restructuring brief — oracle: loss-map B2 per-atom table", () => {
  it("reports the TaskUs quote as absent (atom A07, graded SEVERE)", () => {
    // The only real priced offer on the table.
    expect(statedItem(B2, "£1.1m").verdict).toBe("absent");
  });

  it("reports the Leeds break clause as absent (atom A13, graded SEVERE)", () => {
    // A hard timing constraint on the whole decision.
    expect(statedItem(B2, "March 2027").verdict).toBe("absent");
  });

  it("reports the measured pilot result as absent (atom A10, graded HIGH)", () => {
    expect(statedItem(B2, "34%").verdict).toBe("absent");
  });

  it("reports the EBITDA gap as absent (atom A03, graded HIGH)", () => {
    expect(statedItem(B2, "£1.8m").verdict).toBe("absent");
  });

  it("reports the two surviving caps as in_model (atoms A05, A06)", () => {
    expect(statedItem(B2, "£4m").verdict).toBe("in_model");
    expect(statedItem(B2, "£2.9m").verdict).toBe("in_model");
  });

  it("matches an abbreviated month in a model label (atom A23)", () => {
    // The brief writes "January 2027"; the model labels a risk "(Jan 2027)".
    // Without month canonicalisation this reads as a loss that did not happen.
    expect(statedItem(B2, "January 2027").verdict).toBe("in_model");
  });
});

describe("B3 product-bet brief — oracle: loss-map B3 per-atom table", () => {
  it("reports BOTH sides of the contradicted budget as absent (atoms A21, A22, graded SEVERE)", () => {
    // The trace's T4E probe confirmed from the inside that not even the
    // assistant can tell which figure the model uses. Neither is in it.
    expect(statedItem(B3, "£2m").verdict).toBe("absent");
    expect(statedItem(B3, "£1.2m").verdict).toBe("absent");
  });

  it("reports the CEO's demo deadline as absent (atom A23, graded SEVERE)", () => {
    expect(statedItem(B3, "14 May 2027").verdict).toBe("absent");
  });

  it("reports the author's own revenue correction as absent (atom A25, graded HIGH)", () => {
    // The CORR class had 0/4 survival — the worst-served information class.
    expect(statedItem(B3, "£700k").verdict).toBe("absent");
  });

  it("reports the self-flagged win-rate claim as absent (atom A04, graded HIGH)", () => {
    expect(statedItem(B3, "22%").verdict).toBe("absent");
  });

  it("reports the goal figure as the ONE quantity that survived (atom A02)", () => {
    // The trace's tally for B3: "Quantitative atoms with unit+magnitude intact:
    // 1 of ~14 (the 15% inside the goal label)". This asserts the survivor AND
    // that the derivation is not generously inventing others.
    const m = deriveNotModelledManifest(B3.brief_text, B3.graph);
    expect(statedItem(B3, "15%").verdict).toBe("in_model");
    expect(m.quantities?.in_model).toBe(1);
  });
});

describe("the drafting model's OWN declared exclusions", () => {
  it("surfaces the dissenting proposal the trace graded SEVERE (B2 atom A21)", () => {
    // ⚠ THIS REFUTES THE PREMISE THIS WORK STARTED FROM. The loss map graded
    // A21 as SEVERE with the note `"Dana" 0 hits` — scoped to the TURN
    // RESPONSE. The PERSISTED graph carries the model's own sentence saying it
    // excluded exactly that option, and why. The knowledge existed; only the
    // plumbing was missing. This is the one loss class a quantity-containment
    // check is structurally blind to, so it is the highest-value thing here.
    const m = deriveNotModelledManifest(B2.brief_text, B2.graph);

    expect(m.declared_exclusions.status).toBe("reported");
    const dana = m.declared_exclusions.items.find((s) => s.includes("Dana"));
    expect(dana, "the model's own record of dropping Dana's RIF option").toBeDefined();
    expect(dana).toContain("across-the-board RIF");
    // Carried VERBATIM — the model's reason, not our paraphrase of it.
    expect(dana).toContain("excluded because");
  });

  it("surfaces the excluded margin-floor constraint (B1 atom A08)", () => {
    const m = deriveNotModelledManifest(B1.brief_text, B1.graph);
    expect(m.declared_exclusions.status).toBe("reported");
    expect(m.declared_exclusions.items.some((s) => s.includes("78%"))).toBe(true);
  });

  it('distinguishes "the model reported none" from "nothing was excluded" (B3)', () => {
    // THE DISCRIMINATOR, and B3 is why the three-state field exists. Its
    // coaching pass produced ZERO output on the brief engineered to be densest
    // in bias material, so its exclusion list is EMPTY — while the trace graded
    // 16 of its 26 atoms dropped. An implementation that reported this as
    // "nothing was excluded" would be at its most confident exactly where it is
    // most wrong.
    const m = deriveNotModelledManifest(B3.brief_text, B3.graph);
    expect(m.declared_exclusions.status).toBe("none_reported");
    expect(m.declared_exclusions.items).toEqual([]);
    // And the quantities half must still be reporting heavy loss on this brief,
    // which is what proves "none_reported" is not evidence of a clean draft.
    expect(m.quantities!.absent).toBeGreaterThan(10);
  });

  it('reports "not_recorded" when the graph carries no widening log at all', () => {
    const m = deriveNotModelledManifest("We have £4m and 6 months.", {
      nodes: [],
      edges: [],
    });
    expect(m.declared_exclusions.status).toBe("not_recorded");
    expect(m.declared_exclusions.items).toEqual([]);
  });

  it("does not score an excluded figure as merely 'mentioned in the explanation'", () => {
    // B1's 78% margin floor appears ONLY inside the exclusion record. A figure
    // the model says it EXCLUDED is absent from the model — grading it
    // `prose_only` would understate that to the user.
    expect(statedItem(B1, "78%").verdict).toBe("absent");
  });
});

describe("what the product ESTIMATED — derived from evidence, not from labels", () => {
  it("names the factor whose stated value was dropped (B1 atom A22, SEVERE)", () => {
    // The trace's sharpest case: the user stated NRR 112%, the value never
    // entered, the factor got a maximum-width prior, and that prior then topped
    // the influence ranking. The figure the model is using is OURS, and the
    // user is entitled to know that.
    const m = deriveNotModelledManifest(B1.brief_text, B1.graph);
    expect(m.inferred_factors.status).toBe("derived");
    const ids = m.inferred_factors.items.map((i) => i.node_id);
    expect(ids).toContain("fac_nrr");
    expect(ids).toContain("fac_cash_runway"); // A14 — £3.1m collapsed to 0.31
  });

  it("does NOT read the provenance label, which is false where it matters", () => {
    // `fac_nrr` and `fac_cash_runway` both carry provenance "from_brief" /
    // extractionType "explicit" while holding no brief figure. A derivation
    // that trusted those labels would report them as the user's own numbers —
    // laundering the exact defect this surface exists to expose. The
    // PRECONDITION is pinned in-test so this cannot pass on a fixture that
    // happens not to carry the mislabel.
    const nodes = B1.graph.nodes as Array<Record<string, unknown>>;
    const nrr = nodes.find((n) => n.id === "fac_nrr");
    expect(nrr?.provenance, "fixture must carry the mislabel").toBe("from_brief");
    expect(nrr?.extractionType).toBe("explicit");

    const m = deriveNotModelledManifest(B1.brief_text, B1.graph);
    expect(m.inferred_factors.items.map((i) => i.node_id)).toContain("fac_nrr");
  });

  it("carries the human label, never the unitless encoded value", () => {
    const m = deriveNotModelledManifest(B1.brief_text, B1.graph);
    const nrr = m.inferred_factors.items.find((i) => i.node_id === "fac_nrr");
    expect(nrr?.label).toBe("Net Revenue Retention");
    for (const item of m.inferred_factors.items) {
      // "0.31 to 0.93" and friends must never travel as a label.
      expect(item.label).not.toMatch(/^\d|\bto\b\s*\d/);
    }
  });

  it("does NOT claim a factor whose figure the user DID state", () => {
    // The discrimination. A derivation that simply listed every factor would
    // satisfy every assertion above. B2's offshore-scale and opex-savings
    // factors carry the caps the brief stated (£2.9m, £4m), so they are the
    // user's numbers and must not appear as ours.
    const m = deriveNotModelledManifest(B2.brief_text, B2.graph);
    const ids = m.inferred_factors.items.map((i) => i.node_id);
    const factors = (B2.graph.nodes as Array<Record<string, unknown>>).filter(
      (n) => n.kind === "factor",
    );
    expect(ids.length).toBeLessThan(factors.length);
    expect(ids).not.toContain("fac_offshore_scale");
  });

  it.each([
    ["observed_state.cap", { observed_state: { cap: 4_000_000, unit: "£" } }],
    ["observed_state.raw_value", { observed_state: { raw_value: 4_000_000 } }],
    ["observed_state.value", { observed_state: { value: 4_000_000 } }],
    ["a node-level cap", { cap: 4_000_000 }],
    ["a prior bound", { prior: { range_min: 4_000_000, range_max: 9 } }],
    ["an encoding-map caption", { encoding_map: { "0.5": "£4,000,000 of savings" } }],
  ])(
    "does not claim a factor whose ONLY link to the brief is %s",
    (_where, valueCarrier) => {
      // ⚠ WHY THESE ARE SEPARATE, MINIMAL CASES. The real-capture test above
      // stopped discriminating the field list once encoding-map captions were
      // also read: B2's offshore factor is rescued by its caption whether or
      // not `observed_state.cap` is consulted, so a mutant deleting that read
      // stayed GREEN. A guard that passes for a reason other than the one it
      // names is not a guard (trap 13b). Each row here isolates ONE carrier as
      // the sole link, so deleting any single read turns exactly this red.
      const graph = {
        nodes: [
          {
            id: "fac_savings",
            kind: "factor",
            label: "Opex savings",
            ...valueCarrier,
          },
        ],
        edges: [],
      };
      const m = deriveNotModelledManifest("We must take £4m out of opex.", graph);
      // Precondition: the brief really does state a matching figure, so a
      // "not claimed" result cannot come from there being nothing to match.
      expect(m.quantities?.items.map((i) => i.literal)).toContain("£4m");
      expect(m.inferred_factors.items.map((i) => i.node_id)).not.toContain("fac_savings");
    },
  );

  it("DOES claim a factor whose figure matches nothing in the brief (the pair partner)", () => {
    // Without this, every row above could pass on a derivation that claims
    // nothing at all.
    const graph = {
      nodes: [
        { id: "fac_other", kind: "factor", label: "Something else", observed_state: { cap: 777 } },
      ],
      edges: [],
    };
    const m = deriveNotModelledManifest("We must take £4m out of opex.", graph);
    expect(m.inferred_factors.items.map((i) => i.node_id)).toContain("fac_other");
  });

  it("does not claim a factor that carries no figure at all", () => {
    // Found by a surviving mutant: every factor in all three captures happens
    // to carry a number, so the guard never fired and nothing covered it. A
    // factor with nothing numeric is structural — there is no figure to own,
    // and claiming "the numbers behind this are mine" about it would be a
    // statement with no referent.
    const graph = {
      nodes: [
        { id: "fac_structural", kind: "factor", label: "Something structural" },
        { id: "fac_numeric", kind: "factor", label: "Has a number", observed_state: { cap: 777 } },
      ],
      edges: [],
    };
    const m = deriveNotModelledManifest("We must take £4m out of opex.", graph);
    const ids = m.inferred_factors.items.map((i) => i.node_id);
    expect(ids).not.toContain("fac_structural");
    // Pair partner: the derivation is not simply refusing everything.
    expect(ids).toContain("fac_numeric");
  });

  it("reports not_recorded rather than an empty list when there is no graph to read", () => {
    const m = deriveNotModelledManifest(B1.brief_text, null);
    expect(m.inferred_factors.status).toBe("not_recorded");
    expect(m.inferred_factors.items).toEqual([]);
  });
});

describe("ORDINARY INPUT MUST NOT COLLIDE WITH TOPOLOGY — the corpus is external", () => {
  /**
   * ⚠ THIS CORPUS IS DELIBERATELY NOT DRAWN FROM THE THREE BRIEFS, because the
   * three briefs are exactly where this defect hid (trap 22: a corpus from the
   * author's head cannot see the class the author did not imagine).
   *
   * The first matcher compared a stated quantity against EVERY number anywhere
   * in the model subtree, unit-blind. On the real deployed graphs that made
   * ordinary sentences false — "within 1 year" matched one of 46
   * `edges[].exists_probability` values; "£0.75m" matched a unitless prior
   * bound; "5 people" matched `out_csat`'s cap of 5, declared unit "Trustpilot
   * score". None of those is a user-facing quantity.
   *
   * Every sentence here states a figure NO graph legitimately carries, so any
   * verdict other than `absent` is a collision.
   */
  const ORDINARY = [
    "We need to decide within 1 year.",
    "It has 1 month of runway left.",
    "We have 1 engineer free.",
    "There are 5 people on the team.",
    "Give it 2 quarters.",
    "Attrition sits at 1%.",
    "Churn is 0.5%.",
    "We can spend £0.75m on marketing.",
    "We lose £0.5m a quarter.",
    "Payback is 3 years.",
    "We need 8 weeks.",
  ];

  it.each([
    ["B1", B1],
    ["B2", B2],
    ["B3", B3],
  ])("%s: no ordinary figure is falsely reported as used", (_name, capture) => {
    for (const sentence of ORDINARY) {
      const m = deriveNotModelledManifest(sentence, capture.graph);
      const items = m.quantities?.items ?? [];
      // POSITIVE CONTROL: the sentence must actually yield a quantity, or the
      // assertion below passes by there being nothing to check (trap 13).
      expect(items.length, `"${sentence}" must yield a quantity`).toBeGreaterThan(0);
      for (const item of items) {
        expect(
          item.verdict,
          `"${sentence}" -> "${item.literal}" wrongly reported ${item.verdict}` +
            (item.matched_node_id ? ` against ${item.matched_node_id}` : ""),
        ).toBe("absent");
      }
    }
  });

  it("DISCRIMINATION: a figure the graph really carries is still reported as used", () => {
    // Without this, every row above could pass on a matcher that never matches
    // anything. B1 carries current marketing spend as 0.3 under unit "£m".
    const m = deriveNotModelledManifest("Budget of £0.3m for marketing.", B1.graph);
    const item = m.quantities?.items.find((i) => i.literal === "£0.3m");
    expect(item?.verdict).toBe("in_model");
    expect(item?.matched_node_id).toBe("fac_marketing_spend");
  });

  it("does not match across currencies", () => {
    // The trace measured a real €900k -> £1.6m swap. A matcher blind to the
    // symbol would report that swap as the user's own number.
    const m = deriveNotModelledManifest("Marketing is capped at €1.5m.", B1.graph);
    expect(m.quantities?.items.find((i) => i.literal === "€1.5m")?.verdict).toBe("absent");
  });

  it("topology metadata is not a candidate at all", () => {
    // The mechanism, pinned directly rather than only through its symptoms.
    // B1 carries 46 edges whose `exists_probability` is 1; none may be offered
    // as evidence that a user's "1" reached the model.
    const edges = B1.graph.edges as Array<Record<string, unknown>>;
    const ones = edges.filter((e) => e.exists_probability === 1);
    expect(ones.length, "fixture must carry the collision targets").toBeGreaterThan(10);

    const m = deriveNotModelledManifest("Give us 1 quarter.", B1.graph);
    expect(m.quantities?.items[0]?.verdict).toBe("absent");
  });

  it("topology is excluded TWICE OVER — the collection list is the second line", () => {
    // ⚠ THIS ENTRY HAS BEEN WRONG IN BOTH DIRECTIONS, so it states the measured
    // position precisely.
    //
    // A mutant readmitting `edges` to the candidate collections stayed GREEN,
    // and I concluded "the collection list was never the guard". THAT
    // OVERSTATED IT. The mutant is equivalent only against TODAY'S producer:
    // real edges carry no `id` and no `label` (0 of 113 across all three
    // captures), so the named-candidate requirement drops them first. Feed in a
    // synthetic edge carrying id + label + unit + cap and the exclusion becomes
    // load-bearing — it is a real second line of defence against a shape the
    // current producer happens not to emit, not a redundant one.
    const allEdges = [B1, B2, B3].flatMap(
      (c) => c.graph.edges as Array<Record<string, unknown>>,
    );
    expect(allEdges.length).toBeGreaterThan(100);
    expect(
      allEdges.filter((e) => typeof e.id === "string" && typeof e.label === "string").length,
      "real edges carry neither id nor label, in ANY capture",
    ).toBe(0);

    // And the hypothetical the mutant was reaching for: even an edge-shaped
    // entry that DID carry id + label still offers no candidate, because
    // topology fields are not value carriers.
    const graph = {
      nodes: [
        {
          id: "edge_like",
          kind: "factor",
          label: "Edge-shaped entry",
          strength: { mean: 1, std: 0.2 },
          exists_probability: 1,
        },
      ],
      edges: [],
    };
    const m = deriveNotModelledManifest("Give us 1 quarter.", graph);
    expect(m.quantities?.items[0]?.verdict).toBe("absent");
  });
});

describe("THE TWO SECTIONS MAY NEVER CONTRADICT EACH OTHER", () => {
  /**
   * ⚠ THE CORPUS VARIES MAGNITUDE NOTATION, because that is the axis every
   * other fixture here holds constant — and it is the axis the defect lived on.
   *
   * `classify` was converted to unit-aware candidates and `deriveInferredFactors`
   * was not, so the two answered "is this number the user's?" with different
   * machinery. The clash fired only when the user's written magnitude suffix
   * disagreed with the carrier's declared unit scale: measured on this exact
   * graph, `£1.5m` was clean while `£1,500,000` had the panel report
   * "What I used: £1,500,000 -> Marketing Spend" and, directly beneath,
   * "What I estimated: Marketing Spend" under "the numbers behind these are
   * mine, not yours".
   *
   * `fac_marketing_spend` and `fac_headcount_budget` both declare unit "£m" in
   * the real capture, which is what makes them the natural probes.
   */
  const NOTATIONS = [
    "£1.5m",
    "£1,500,000",
    "£300k",
    "£300,000",
    "£8m",
    "£8,000,000",
    "£1.6m",
    "£1,600,000",
    "£0.3m",
  ];

  it.each(NOTATIONS)(
    "a node the matcher certified as the user's is never also claimed as ours (%s)",
    (notation) => {
      const m = deriveNotModelledManifest(
        `We can spend ${notation} on marketing this year.`,
        B1.graph,
      );

      const matched = new Set(
        (m.quantities?.items ?? [])
          .map((i) => i.matched_node_id)
          .filter((id): id is string => id !== null),
      );
      // POSITIVE CONTROL: this notation must actually reach a node, or the
      // assertion below passes by matching nothing (trap 13). Every notation
      // here names a figure the real graph genuinely carries.
      expect(matched.size, `"${notation}" must match a carrier`).toBeGreaterThan(0);

      const claimedAsOurs = new Set(m.inferred_factors.items.map((i) => i.node_id));
      const both = [...matched].filter((id) => claimedAsOurs.has(id));
      expect(
        both,
        `these nodes are asserted as the user's AND denied as ours: ${both.join(", ")}`,
      ).toEqual([]);
    },
  );

  /**
   * ⚠ MONEY WRITTEN IN WORDS AND IN OTHER CURRENCIES — the axis every previous
   * corpus here held constant, and the door the original defect came back
   * through.
   *
   * The asymmetry that protects "what I estimated" was robust to MATCHING
   * failure and not to EXTRACTION failure: `QUANTITY_RE` knows three currency
   * symbols, and the coincidence guard consumed only successfully-extracted
   * quantities — so when extraction missed a figure there was no cannot-tell
   * left to fire, and the factor fell straight through to being claimed as
   * ours.
   *
   * Each notation below writes the SAME figure b1's real brief states
   * ("marketing spend is capped at £1.5m") against the SAME carrier
   * (`fac_marketing_spend`, `cap: 1.5, unit: "£m"`) that this module's own
   * matcher certifies as the user's in the £ notation. None may produce a
   * claim that the number is ours.
   */
  const MONEY_IN_WORDS = [
    "1.5 million pounds",
    "GBP 1.5m",
    "USD 1.5m",
    "1.5 million dollars",
    "¥1.5m",
    "₹1.5m",
    "CHF 1.5m",
    "1,500,000 pounds",
    "1.5 million",
  ];

  it.each(MONEY_IN_WORDS)(
    "a figure our extractor cannot read is never claimed as ours (%s)",
    (notation) => {
      const brief = `Marketing spend is capped at ${notation}.`;
      const m = deriveNotModelledManifest(brief, B1.graph);

      // PRECONDITION, and it is the whole point: extraction genuinely FAILS to
      // produce a matched quantity for these notations. If a future extractor
      // widening made this false, the case would stop exercising the
      // extraction-failure path and this test would quietly become a duplicate
      // of the £ cases above.
      const matched = (m.quantities?.items ?? []).filter((i) => i.matched_node_id !== null);
      expect(
        matched,
        `"${notation}" is expected to defeat extraction; if it no longer does, ` +
          `re-point this corpus at a notation that still does`,
      ).toEqual([]);

      // The claim that must not appear.
      expect(
        m.inferred_factors.items.map((i) => i.node_id),
        `"${notation}" produced a false claim that the carrier's figure is ours`,
      ).not.toContain("fac_marketing_spend");
    },
  );

  it("DISCRIMINATION: the suppressor is not simply silencing everything", () => {
    // Without this, every row above passes on a guard that claims nothing. A
    // brief whose numbers match nothing in the graph must still yield the full
    // estimated list.
    const m = deriveNotModelledManifest("We should decide by next spring.", B1.graph);
    expect(m.quantities?.items ?? []).toEqual([]);
    expect(m.inferred_factors.items.length).toBeGreaterThan(3);
    expect(m.inferred_factors.items.map((i) => i.node_id)).toContain("fac_marketing_spend");
  });

  it("an unrelated sentence does not delete the trust-critical answer", () => {
    // The suppressor's other failure direction. Unitless [0,1] prior bounds are
    // the pipeline's normalised defaults; admitting them let "We have £1m in
    // the bank" (mantissa 1 = every default range_max) drop the list 9 -> 6.
    const baseline = deriveNotModelledManifest(B1.brief_text, B1.graph);
    const withNoise = deriveNotModelledManifest(
      `${B1.brief_text} We have £1m in the bank.`,
      B1.graph,
    );
    expect(baseline.inferred_factors.items.length).toBeGreaterThan(3);
    expect(withNoise.inferred_factors.items.length).toBe(
      baseline.inferred_factors.items.length,
    );
  });

  it("but a REAL-WORLD-magnitude prior bound still suppresses", () => {
    // The pair partner for the [0,1] rule: a prior outside the unit interval is
    // a figure, not a normalised default, and a coincidence with one is a
    // genuine cannot-tell. Excluding those wholesale would trade a recoverable
    // silence for a false assertion about the user's own number.
    const graph = {
      nodes: [
        {
          id: "fac_savings",
          kind: "factor",
          label: "Opex savings",
          prior: { range_min: 4_000_000, range_max: 9_000_000 },
        },
      ],
      edges: [],
    };
    const m = deriveNotModelledManifest("We must take £4m out of opex.", graph);
    expect(m.inferred_factors.items.map((i) => i.node_id)).not.toContain("fac_savings");
  });

  it("holds across all three real captures with their own briefs", () => {
    for (const [name, capture] of [
      ["B1", B1],
      ["B2", B2],
      ["B3", B3],
    ] as const) {
      const m = deriveNotModelledManifest(capture.brief_text, capture.graph);
      const matched = new Set(
        (m.quantities?.items ?? [])
          .map((i) => i.matched_node_id)
          .filter((id): id is string => id !== null),
      );
      const claimedAsOurs = new Set(m.inferred_factors.items.map((i) => i.node_id));
      const both = [...matched].filter((id) => claimedAsOurs.has(id));
      expect(both, `${name} contradicts itself on: ${both.join(", ")}`).toEqual([]);
    }
  });

  it("DISCRIMINATION: the estimated list is not simply empty", () => {
    // Without this, every assertion above passes on a derivation that claims
    // nothing as ours — which would satisfy "no contradiction" by saying
    // nothing at all, and delete the trust-critical answer in the process.
    const m = deriveNotModelledManifest(B1.brief_text, B1.graph);
    expect(m.inferred_factors.items.length).toBeGreaterThan(3);
    expect(m.inferred_factors.items.map((i) => i.node_id)).toContain("fac_nrr");
  });
});

describe("the loss is visible across all three briefs", () => {
  it("finds a majority of stated quantities missing from every model", () => {
    // The headline the surface exists to show. Stated as a floor, not a fixed
    // count: the point is that most of what the strategist quantified is gone,
    // and a derivation that quietly stopped finding losses must fail here.
    for (const [name, cap] of [
      ["B1", B1],
      ["B2", B2],
      ["B3", B3],
    ] as const) {
      const m = deriveNotModelledManifest(cap.brief_text, cap.graph);
      const q = m.quantities;
      expect(q, name).not.toBeNull();
      expect(q!.total, `${name} quantities found`).toBeGreaterThan(20);
      expect(q!.absent, `${name} absent`).toBeGreaterThan(q!.in_model);
      expect(q!.in_model + q!.prose_only + q!.absent).toBe(q!.total);
    }
  });
});

describe('"we did not look" is never reported as "nothing was dropped"', () => {
  it("returns a null tally, not a zero tally, without a brief", () => {
    for (const brief of [null, undefined, "", "   "]) {
      const m = deriveNotModelledManifest(brief, B1.graph);
      expect(m.status).toBe("unavailable");
      expect(m.unavailable_reason).toBe("no_brief_text");
      expect(m.quantities).toBeNull();
    }
  });

  it("returns a null tally, not a zero tally, without a graph", () => {
    for (const graph of [null, undefined, "not an object"]) {
      const m = deriveNotModelledManifest(B1.brief_text, graph);
      expect(m.status).toBe("unavailable");
      expect(m.unavailable_reason).toBe("no_graph");
      expect(m.quantities).toBeNull();
    }
  });

  it("always carries the classes it cannot see, on both paths", () => {
    const derived = deriveNotModelledManifest(B1.brief_text, B1.graph);
    const unavailable = deriveNotModelledManifest(null, null);
    for (const m of [derived, unavailable]) {
      expect(m.not_tracked).toEqual(NOT_TRACKED_CLASSES);
      expect(m.not_tracked).toContain("competing_or_dissenting_proposals");
      expect(m.not_tracked).toContain("corrections_and_second_thoughts");
    }
  });

  it("a brief with no stated quantities is DERIVED with an empty list, not unavailable", () => {
    // The two zeros must stay distinguishable: this one genuinely means "we
    // looked and found nothing to check", and it is the only case allowed to
    // report a zero tally.
    const m = deriveNotModelledManifest("Should I take the job or stay put?", B1.graph);
    expect(m.status).toBe("derived");
    expect(m.quantities?.total).toBe(0);
    expect(m.quantities?.items).toEqual([]);
  });
});

describe("the magnitude alphabet needs a CORPUS, not just consistent consumers", () => {
  /**
   * ⚠ TRAP 12d, LIVE. A mutant deleting `thousand` from `MAGNITUDE` left every
   * other test GREEN: deriving guards FROM the map is structurally blind to a
   * key the map is missing. The only thing that catches a short list is a
   * hand-written corpus of real-world spellings — exactly the kind of mirror
   * derivation was introduced to abolish. Both are needed; neither supersedes
   * the other.
   *
   * `parseUnit("£ million")` scaled by 1 before these existed — a 10^6 error in
   * a figure we quote back to the user as their own.
   */
  it.each([
    ["£ million", 1_000_000, "£4m"],
    ["£ thousand", 1_000, "£4k"],
    ["£m", 1_000_000, "£4m"],
    ["£k", 1_000, "£4k"],
  ])("a carrier declared in %s is read at its true scale", (unit, scale, literal) => {
    const value = 4;
    const graph = {
      nodes: [
        {
          id: "fac_scaled",
          kind: "factor",
          label: "Scaled carrier",
          observed_state: { cap: value, unit },
        },
      ],
      edges: [],
    };
    // PRECONDITION: the brief states exactly `value * scale` in the notation
    // under test, so a match is only possible if the unit was scaled correctly.
    const m = deriveNotModelledManifest(`We can spend ${literal} on this.`, graph);
    const item = m.quantities?.items.find((i) => i.literal === literal);
    expect(item, `the brief must state ${literal}`).toBeDefined();
    expect(item?.verdict, `unit "${unit}" must scale by ${scale}`).toBe("in_model");
    expect(item?.matched_node_id).toBe("fac_scaled");
  });
});

describe("the extractor's declared scope", () => {
  it("ignores bare undecorated integers", () => {
    // Measured on the corpus: matching them made "FY28" report the quantity 28.
    // A quantity must carry a unit, currency, percent sign or calendar form.
    const qs = extractStatedQuantities("We looked at 7 and then 42 and also 1000.");
    expect(qs).toEqual([]);
  });

  it("reads a currency magnitude suffix rather than the digits alone", () => {
    const [q] = extractStatedQuantities("budget is £11.2m this year");
    expect(q.literal).toBe("£11.2m");
    expect(q.kind).toBe("money");
    expect(q.value).toBe(11_200_000);
    expect(q.mantissa).toBe(11.2);
  });

  it("does not match a percentage inside a longer number", () => {
    // Boundary guard: "9%" must not be found inside "129%".
    const qs = extractStatedQuantities("growth of 129% last year");
    expect(qs.map((q) => q.literal)).toEqual(["129%"]);
  });
});
