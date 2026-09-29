/**
 * ⭐⭐⭐ THE ENHANCE WRITE MAY NOT STAMP A FIGURE FROM OUTSIDE THE NODE'S OWN
 * STATED SPAN.
 *
 * ── THE HARM, measured on deployed staging (3 Sep 2026)
 * A founder with £8k MRR and £200k runway was shown **£8.5m** on a factor about
 * his own time. The brief's largest figure is a COMPETITOR's £5m raise, in a
 * different paragraph; the hire he asked about is stated at £80–120k.
 *
 * One `data` write in the enricher's ENHANCE branch did three things at once:
 * it BOUND the competitor's £5m to a founder-time factor, MINTED
 * `computeNormalisationCap(5e6) = 1e7` around it, and STAMPED
 * `extractionType: "explicit"` → `source: "brief_extraction"` — certifying a
 * number the user never wrote as the user's own words.
 *
 * ── WHY THE WRONG NODE WAS SELECTED
 * `labelsMatch` is a bidirectional SUBSTRING test over labels stripped of
 * non-alphanumerics, plus `SYNONYM_GROUPS`. A stated `cause` node's label is a
 * VERBATIM brief sentence — 118 characters here — so a short extracted label
 * occurring anywhere inside it matches. "retention" sits in the founder-time
 * sentence and in `SYNONYM_GROUPS[2]`, so "Retention Rate" selected it.
 *
 * ── WHAT IS PINNED HERE, AND WHAT IS NOT
 * `labelsMatch` is UNCHANGED and stays the candidate generator and the dedup
 * predicate. The single new rejection test is positional: a stated node may
 * only be stamped with a figure written inside its own `source_quote`.
 *
 * ⚠ THE FOUR CASES ARE A DISCRIMINATING SET, not four assertions. (a) and (d)
 * run the SAME brief through the SAME extraction against nodes that differ
 * ONLY in whether a `source_quote` is present. So (d) passing is what PINS
 * (a)'s precondition: it proves the selector still fires and the write still
 * happens, and therefore that (a)'s absence of a write is the GATE's doing and
 * not a fixture that quietly stopped reproducing (trap 13b).
 *
 * ⚠ HONEST NON-COVERAGE. These fixtures drive the REGEX extractor, so the
 * label geometry ("retention" within `inferLabel`'s 50-character window) is
 * this test's, not the capture's — the live 3 Sep run used LLM-first
 * extraction, whose labels are model-authored. What is reproduced faithfully
 * is the SHAPE the gate governs: a figure from outside a stated node's span
 * being written onto it. No deployed witness exists for this change.
 */

import { describe, it, expect } from "vitest";
import { enrichGraphWithFactorsAsync } from "../enricher.js";
import type { GraphT } from "../../../schemas/graph.js";

/** The founder-time sentence, verbatim from the 3 Sep brief. */
const FOUNDER_TIME_QUOTE =
  "hiring would free this up for product, which we believe indirectly affects " +
  "retention through product quality improvements";

/**
 * The 3 Sep brief's shape: the founder-time sentence, and a competitor's £5m in
 * a DIFFERENT sentence. "retention" precedes the figure so the regex extractor
 * labels it "Retention Rate" and `SYNONYM_GROUPS[2]` selects the node above.
 */
const BRIEF_WITH_OUT_OF_SPAN_FIGURE = [
  "The founder currently spends most of their week on sales — " +
    FOUNDER_TIME_QUOTE + ".",
  "",
  "On retention: a competitor just raised £5m and is hiring aggressively.",
].join("\n");

function factorNode(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "27c23ebb",
    kind: "factor",
    category: "controllable",
    ...overrides,
  };
}

function graphWith(node: Record<string, unknown>): GraphT {
  return {
    nodes: [
      { id: "g-mrr", kind: "goal", label: "Reach £30k MRR Within 18 Months" },
      node,
      { id: "opt-hire", kind: "option", label: "Hire a Dedicated Sales Team" },
    ],
    edges: [{ from: "27c23ebb", to: "g-mrr", kind: "influences" }],
  } as unknown as GraphT;
}

/** A stated node: the record projector writes `provenance.source_quote`. */
function statedNode(quote: string) {
  return factorNode({
    label: quote,
    provenance: { provenance_class: "stated", source_quote: quote },
  });
}

const dataOf = (g: GraphT) =>
  (g.nodes.find((n) => n.id === "27c23ebb") as { data?: Record<string, unknown> } | undefined)
    ?.data;

describe("enhance write — positional span containment", () => {
  it("(a) REFUSES to bind a figure from outside the node's stated span, and stamps nothing", async () => {
    const result = await enrichGraphWithFactorsAsync(
      graphWith(statedNode(FOUNDER_TIME_QUOTE)),
      BRIEF_WITH_OUT_OF_SPAN_FIGURE
    );

    const data = dataOf(result.graph);

    // No write at all — not a corrected value, not a hedged one. Nothing.
    expect(data).toBeUndefined();
    expect(result.factorsEnhanced).toBe(0);

    // The competitor's £5m reached NO node, and minted no cap around itself.
    for (const node of result.graph.nodes) {
      const d = (node as { data?: Record<string, unknown> }).data;
      expect(d?.raw_value).not.toBe(5_000_000);
      expect(d?.cap).not.toBe(10_000_000);
    }

    // Refusal must not fall through to node creation — that mints duplicates.
    const founderTimeNodes = result.graph.nodes.filter(
      (n) => n.id === "27c23ebb" || n.label === FOUNDER_TIME_QUOTE
    );
    expect(founderTimeNodes).toHaveLength(1);
  });

  /**
   * "Written unchanged" is asserted RELATIONALLY, against the same graph whose
   * node carries no quote — the path this gate provably never touches. That is
   * stronger than naming an expected `extractionType`, and it cannot go stale:
   * it derives the expectation from the producer rather than from the test
   * author's reading of which pattern fired (trap 13c).
   */
  async function writeWithAndWithoutQuote(quote: string, brief: string) {
    const gated = await enrichGraphWithFactorsAsync(graphWith(statedNode(quote)), brief);
    const ungated = await enrichGraphWithFactorsAsync(
      graphWith(factorNode({ label: quote })),
      brief
    );
    return { gated: dataOf(gated.graph), ungated: dataOf(ungated.graph), result: gated };
  }

  it("(b) CONTROL — a figure INSIDE the node's own quote is written, byte-identically to today", async () => {
    const quote = "our fully loaded cost per sales seat is £5000 each month";
    const { gated, ungated, result } = await writeWithAndWithoutQuote(
      quote,
      `We are planning headcount. ${quote}.`
    );

    expect(gated).toBeDefined();
    expect(result.factorsEnhanced).toBe(1);
    expect(gated?.raw_value).toBe(5000);

    // The stamp half — what certifies the number as the user's own words —
    // survives, whatever the extractor declared it to be.
    expect(gated?.extractionType).toBeDefined();
    expect(gated).toEqual(ungated);
  });

  it("(c) CONTROL — a percentage the user typed keeps its stamp (a magnitude route would strip it)", async () => {
    const quote = "our churn is 4% monthly and we want it lower";
    const { gated, ungated, result } = await writeWithAndWithoutQuote(
      quote,
      `Some context first. ${quote}.`
    );

    expect(gated).toBeDefined();
    expect(result.factorsEnhanced).toBe(1);

    // Percents are stored as fractions; `isAmountStatedInBrief` refuses
    // percent↔fraction equivalence, which is exactly why this gate is
    // positional. The user's own 4% must survive with its provenance.
    expect(gated?.unit).toBe("%");
    expect(gated?.extractionType).toBeDefined();
    expect(gated).toEqual(ungated);
  });

  it("(d) CONTROL + PRECONDITION PIN — a span-less claim factor behaves exactly as today", async () => {
    // Identical brief and extraction to (a). The ONLY difference is that this
    // node is claim-derived, so `projector.ts:2673` gives it no `source_quote`.
    const result = await enrichGraphWithFactorsAsync(
      graphWith(
        factorNode({
          label: FOUNDER_TIME_QUOTE,
          provenance: { provenance_class: "ai_inferred", basis: [], unbased: true },
        })
      ),
      BRIEF_WITH_OUT_OF_SPAN_FIGURE
    );

    const data = dataOf(result.graph);

    // Unchanged behaviour — and this is the pin: the selector DID fire and the
    // write DID happen on the same inputs (a) refused, so (a) is the gate.
    expect(data).toBeDefined();
    expect(result.factorsEnhanced).toBe(1);
    expect(data?.raw_value).toBe(5_000_000);
  });
});
