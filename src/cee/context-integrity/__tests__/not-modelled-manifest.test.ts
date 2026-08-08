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

  it("reports the two surviving caps as in_model (atoms A19, A20)", () => {
    // The constraint chain demonstrably works where a cap-bearing factor is
    // drafted. The manifest must NOT cry loss over these, or it becomes noise.
    // Note the two representations: cap 8 (expanded) and cap 1.5 with unit "£m"
    // (mantissa). Both must count.
    expect(statedItem(B1, "8 people").verdict).toBe("in_model");
    expect(statedItem(B1, "£1.5m").verdict).toBe("in_model");
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
