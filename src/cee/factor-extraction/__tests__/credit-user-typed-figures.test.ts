/**
 * THE USER'S OWN FIGURES MUST NOT BE REPORTED AS OUR GUESSES.
 *
 * ── THE DEFECT THIS PINS, measured at the bytes on capture `d9c4066c`
 * (19 Sep 2026). The user wrote *"conversion rate from trial to paid is 12%"*
 * and *"Our churn rate is 4% monthly"*. Both reached the graph carrying exactly
 * those figures and both were stamped `extractionType: "inferred"`, which
 * `transforms/schema-v3.ts:458` publishes as `observed_state.source:
 * "cee_inference"`. `brief_extraction` appeared on 0 of the capture's 6 valued
 * factors, so the product told the user that every estimate behind the analysis
 * was machine-authored — **a false sentence about two numbers they typed.**
 *
 * ── THE FIXTURES ARE THE REAL CAPTURE, NOT A CONVENIENCE
 * `CAPTURED_BRIEF` is the user's own text and `capturedFactors()` reproduces
 * the six valued factors at their captured levels. A corpus written from the
 * author's head cannot see the class the author did not imagine (trap 22), and
 * the sharpest case here — the competitor's `£5m`, which `inferLabel` really
 * does label "Churn Rate" on this brief — was found by running the real text,
 * not by inventing a case.
 *
 * ── WHAT EACH NEGATIVE IS FOR
 * The predicate guards two opposite harms, so the cases come in both
 * directions (trap 22b): a GAP silently withholds a badge the user earned; a
 * LIE credits them with a number they never wrote — and a wrong credit here is
 * not cosmetic, because `brief_extraction` counts as user-stated in the
 * analysis-admission census and can license naming a leading option.
 */

import { describe, it, expect } from "vitest";
import { creditUserTypedFigures } from "../enricher.js";
import type { GraphT, NodeT } from "../../../schemas/graph.js";

/** The user's own words, from capture `d9c4066c` (19 Sep 2026). */
const CAPTURED_BRIEF = [
  "We're a B2B SaaS company (£8k MRR, 120 customers) deciding whether to hire a dedicated sales team or continue with founder-led sales. Our goal is reaching £30k MRR within 18 months.",
  "Key context:",
  "* Current conversion rate from trial to paid is 12%, which we believe is partly driven by product quality and partly by how much attention each trial gets from the founder",
  "* Our churn rate is 4% monthly, but we suspect churn and customer acquisition cost are both influenced by the same underlying factor: how well we understand our ICP (ideal customer profile), which we haven't formally validated",
  "* We've heard from three churned customers that they left because of missing integrations, not price — so we think product gaps mediate the relationship between customer satisfaction and churn",
  "* A competitor just raised £5m and is hiring aggressively, but we don't know their exact strategy",
  "* If we hire sales, we'd need to spend £80-120k on the first hire plus £20k tooling, funded from our £200k runway",
].join("\n");

function factor(
  id: string,
  label: string,
  value: number,
  unit: string,
  overrides: Partial<NodeT> = {},
): NodeT {
  return {
    id,
    kind: "factor",
    label,
    category: "observable",
    data: { value, unit, extractionType: "inferred" },
    ...overrides,
  } as NodeT;
}

/** The six VALUED factors of capture `d9c4066c`, at their captured levels. */
function capturedFactors(): NodeT[] {
  return [
    factor("50555008", "Trial-to-Paid Conversion Rate", 0.12, "%"),
    factor("ab78e513", "Monthly Churn Rate", 0.04, "%"),
    factor("5c05ae61", "Sales Headcount Cost", 0, "£"),
    factor("65f6ae27", "Founder Time on Product", 0.4, "ratio"),
    factor("897b32dc", "Runway Remaining", 0.4, "£"),
    factor("cc057894", "Product Quality", 0.5, "scale"),
  ];
}

function graphOf(nodes: NodeT[]): GraphT {
  return { nodes, edges: [] } as unknown as GraphT;
}

/**
 * What the wire will say. Bound to the ONE mapping that decides it
 * (`schema-v3.ts:458`) rather than to `extractionType` directly, so these
 * assertions are about what the USER is told, not about an internal token.
 * ⚠ Note the default: an ABSENT `extractionType` reads `brief_extraction`, so
 * a test asserting the defect must assert the literal `"inferred"` is present.
 */
function publishedSource(node: NodeT): "brief_extraction" | "cee_inference" {
  const data = node.data as { extractionType?: string } | undefined;
  return data?.extractionType === "inferred" ? "cee_inference" : "brief_extraction";
}

function byId(graph: GraphT, id: string): NodeT {
  const found = graph.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`fixture drift: node ${id} is not in the graph`);
  return found;
}

describe("the figures the user typed are credited to the user", () => {
  it("moves BOTH captured figures from machine-authored to user-stated, and nothing else", () => {
    const graph = graphOf(capturedFactors());

    // The defect, asserted before the fix runs — not inferred from the absence
    // of a badge, but from the `inferred` stamp actually being there.
    expect(publishedSource(byId(graph, "50555008"))).toBe("cee_inference");
    expect(publishedSource(byId(graph, "ab78e513"))).toBe("cee_inference");

    const credited = creditUserTypedFigures(graph, CAPTURED_BRIEF);

    expect(credited).toBe(2);
    expect(publishedSource(byId(graph, "50555008"))).toBe("brief_extraction");
    expect(publishedSource(byId(graph, "ab78e513"))).toBe("brief_extraction");

    // ⭐ THE SCOPE IS PART OF THE CLAIM. The other four valued factors carry
    // model-normalised levels that match no figure in the brief, and crossing
    // the material-parameters floor for them would be a lie. Named by IDENTITY,
    // never by a count another set could satisfy (trap 19).
    for (const id of ["5c05ae61", "65f6ae27", "897b32dc", "cc057894"]) {
      expect(publishedSource(byId(graph, id))).toBe("cee_inference");
    }
  });

  it("leaves the VALUES, units and labels of the credited factors untouched", () => {
    const graph = graphOf(capturedFactors());
    creditUserTypedFigures(graph, CAPTURED_BRIEF);

    // Provenance only. A pass that may write a value is a different and far
    // more dangerous thing than one that may write a badge.
    expect(byId(graph, "50555008").data).toMatchObject({ value: 0.12, unit: "%" });
    expect(byId(graph, "ab78e513").data).toMatchObject({ value: 0.04, unit: "%" });
    expect(byId(graph, "ab78e513").label).toBe("Monthly Churn Rate");
    expect(graph.nodes).toHaveLength(6);
  });

  it("credits a value the brief states for a DIFFERENT entity to NOBODY", () => {
    // ⭐ THE CASE THE REAL TEXT FOUND. `inferLabel` labels the competitor's
    // `£5m` "Churn Rate" — its window reaches back into the previous bullet —
    // and a model-drafted node has no sentence of its own, so the existing span
    // gate is vacuous here. Without `labelIsNamedInFigureSentence` this node is
    // credited with 5,000,000 as the user's own churn figure.
    const graph = graphOf([factor("x", "Monthly Churn Rate", 5_000_000, "£")]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(0);
    expect(publishedSource(byId(graph, "x"))).toBe("cee_inference");
  });

  it("credits a value the brief never states to NOBODY", () => {
    const graph = graphOf([factor("x", "Monthly Churn Rate", 0.07, "%")]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(0);
    expect(publishedSource(byId(graph, "x"))).toBe("cee_inference");
  });

  it("credits an invented value that COINCIDES with a brief number to NOBODY", () => {
    // 0.12 is genuinely in this brief — as the user's conversion rate. A
    // product-quality factor the model set to 0.12 has nothing to do with it,
    // and a value predicate alone cannot tell the two apart (trap 19).
    const graph = graphOf([factor("x", "Product Quality", 0.12, "scale")]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(0);
    expect(publishedSource(byId(graph, "x"))).toBe("cee_inference");
  });

  it("refuses when the node's OWN stated sentence does not contain the figure", () => {
    // The stated-node arm of the same question, and the one the shipped
    // `enhanceWriteIsSpanContained` answers. The level is the user's 4% and the
    // label matches, but the user wrote this node's sentence about a competitor.
    const graph = graphOf([
      factor("x", "Monthly Churn Rate", 0.04, "%", {
        provenance: {
          provenance_class: "stated",
          source_quote: "A competitor just raised £5m and is hiring aggressively",
        },
      } as Partial<NodeT>),
    ]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(0);
    expect(publishedSource(byId(graph, "x"))).toBe("cee_inference");
  });

  it("credits when the node's OWN stated sentence DOES contain the figure", () => {
    // The discriminating twin of the case above: same node, same level, same
    // brief — only the span moves. One of these alone proves nothing about the
    // span gate; the pair proves the refusal is about the SPAN and not about
    // some other limb quietly failing (trap 13b).
    const graph = graphOf([
      factor("x", "Monthly Churn Rate", 0.04, "%", {
        provenance: {
          provenance_class: "stated",
          source_quote: "Our churn rate is 4% monthly",
        },
      } as Partial<NodeT>),
    ]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(1);
    expect(publishedSource(byId(graph, "x"))).toBe("brief_extraction");
  });

  it("never touches a stamp that is not `inferred`", () => {
    // The pass may only correct a machine-authored claim UPWARD. If it could
    // rewrite `range` or `observed` it would be a provenance authority rather
    // than a repair, and a repair is all that was reviewed.
    const graph = graphOf([
      { ...factor("r", "Monthly Churn Rate", 0.04, "%"), data: { value: 0.04, unit: "%", extractionType: "range" } } as NodeT,
      { ...factor("o", "Monthly Churn Rate", 0.04, "%"), data: { value: 0.04, unit: "%", extractionType: "observed" } } as NodeT,
    ]);

    expect(creditUserTypedFigures(graph, CAPTURED_BRIEF)).toBe(0);
    expect((byId(graph, "r").data as { extractionType?: string }).extractionType).toBe("range");
    expect((byId(graph, "o").data as { extractionType?: string }).extractionType).toBe("observed");
  });

  it("refuses when TWO figures in the brief could be this level", () => {
    // ⭐ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. Loosening the refusal from
    // `!== 1` to `< 1` — i.e. "credit the first earner and stop asking" — left
    // the whole suite green, so the branch was unpinned, and an unpinned branch
    // is what a later tidy-up deletes without anything going red (trap 13b).
    // Reached, not imagined: `extractFactors` reads this sentence as both
    // `Rate` (inferLabel's fallback, which a node actually LABELLED "Rate"
    // does not disqualify) and `Churn Rate`, at the same 0.04.
    const brief = "Our churn rate is 4% and our refund rate is 4% across the same cohort.";
    const graph = graphOf([factor("x", "Rate", 0.04, "%")]);

    expect(creditUserTypedFigures(graph, brief)).toBe(0);
    expect(publishedSource(byId(graph, "x"))).toBe("cee_inference");

    // The discriminating twin: the SAME brief and the SAME level, with a label
    // that only one figure earns. Without this, the refusal above could be some
    // other limb quietly failing rather than the ambiguity rule (trap 13b).
    const unambiguous = graphOf([factor("x", "Churn Rate", 0.04, "%")]);
    expect(creditUserTypedFigures(unambiguous, brief)).toBe(1);
  });

  it("writes nothing when there is no brief to read", () => {
    // "We had nothing to look in" is not "we looked and it is not there". Both
    // decline, and declining on an empty brief must not depend on the extractor
    // happening to return nothing.
    for (const brief of ["", "   "]) {
      const graph = graphOf(capturedFactors());
      expect(creditUserTypedFigures(graph, brief)).toBe(0);
      expect(publishedSource(byId(graph, "50555008"))).toBe("cee_inference");
    }
  });

  it("does not let a decimal point end a sentence", () => {
    // CLAUDE.md trap 22: a guard was once handed a window cut at the first
    // `[.!?]` — which is also the decimal point — so `£1.5 million` became `1`
    // before the guard looked. This asserts the sentence scan survives a
    // decimal inside the very figure it is placing.
    const brief = "Our infrastructure spend is 12.5% of revenue. A competitor raised £5m.";
    const graph = graphOf([factor("x", "Infrastructure Spend", 0.125, "%")]);

    expect(creditUserTypedFigures(graph, brief)).toBe(1);
    expect(publishedSource(byId(graph, "x"))).toBe("brief_extraction");
  });
});
