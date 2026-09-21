/**
 * ⭐⭐⭐ THE MODEL NAMING A FACTOR BETTER THAN THE USER DID MUST NOT COST THE
 * USER CREDIT FOR THEIR OWN NUMBER.
 *
 * ── THE DEFECT, MEASURED AT THE DEPLOYED BYTES (build `3032f55`, 21 Sep 2026)
 * Brief: *"Our monthly churn is currently 3.8% ..."*. The draft came back with
 * a factor labelled **"Monthly Churn Rate"** carrying exactly
 * `{ value: 0.038, raw_value: 3.8, unit: "%" }` — the user's own figure,
 * round-tripped correctly — and stamped `extractionType: "inferred"`, which
 * `transforms/schema-v3.ts:458` publishes as `observed_state.source:
 * "cee_inference"` and `provenance: "ai_inferred"`. The same payload's
 * `factor_value_coverage` read `explicit: 0`.
 *
 * `creditUserTypedFigures` is the pass that exists to correct exactly this, it
 * ran, and it credited nothing. Measured from the served logs over the witness
 * window: `cee.enrich.figures_credited_to_user` **0 occurrences** across 11
 * draft calls (contrast control `cee.draft.records.wire_histogram`: 11 — the
 * probe sees).
 *
 * ── THE MECHANISM, ISOLATED BY A DISCRIMINATING PROBE
 * `labelIsNamedInFigureSentence` requires EVERY content token of the node's
 * label to appear in the sentence the figure was written in. The user wrote
 * *"monthly churn"*; the model named the node *"Monthly Churn Rate"*. The word
 * **"Rate"** is absent from the brief, so the user's own number is refused.
 * Run on the real brief, the same node at three spellings:
 *
 *     "Monthly Churn Rate"  → 0 credited      (what the product actually emits)
 *     "Churn Rate"          → 0 credited
 *     "Monthly Churn"       → 1 credited      (only if the user's exact words)
 *
 * ── WHY THIS IS NOT THE UNDER-CLAIM THE RULING ALREADY PRICED (trap 21)
 * `labelIsNamedInFigureSentence`'s docblock accepts an under-claim in terms:
 * *"A user who names a factor in one sentence and gives its number in the next
 * is refused."* That is a DIFFERENT question. Here the user names the factor
 * and gives the number IN THE SAME SENTENCE, and a single generic noun the
 * MODEL added is what disqualifies them. The ruling priced cross-sentence
 * distance; it did not price the model's own vocabulary. The cross-sentence
 * refusal is pinned below, unchanged.
 *
 * ── THE FIX IS A NARROWER READ OF AN AUTHORITY THIS MODULE ALREADY RATIFIED
 * `UNIDENTIFIED_QUANTITY_LABELS` = {Rate, Value, Factor}, whose own docblock
 * says they *"name the SHAPE of the quantity ... and say nothing about WHAT the
 * number measures."* A token that identifies nothing cannot be evidence that
 * the user NAMED this factor, so it is not required to appear. No new list,
 * no third copy of a vocabulary (trap 12) — the same move the unit gate in this
 * module already made.
 *
 * ── OPPOSITE-DIRECTION TWINS (trap 22b)
 * Widening a credit predicate risks the LIE direction, so every case that now
 * credits is paired with one that must still refuse: the competitor's `£5m`
 * that `inferLabel` really does label "Churn Rate"; a label made only of
 * shape-words; and the cross-sentence case above.
 */

import { describe, it, expect } from "vitest";
import { creditUserTypedFigures } from "../enricher.js";
import type { GraphT, NodeT } from "../../../schemas/graph.js";

/** The user's own words, from the deployed witness draw (build `3032f55`). */
const WITNESS_BRIEF =
  "We run a small B2B SaaS. Our monthly churn is currently 3.8% and our hard ceiling for it is 6%. " +
  "We have 11 engineers. Annual recurring revenue is £2,400,000 and we want to reach £3,000,000. " +
  "Our onboarding experience is weak compared with our competitors. " +
  "Should we move upmarket to enterprise customers, or double down on self-serve?";

/** Capture `d9c4066c` (19 Sep 2026) — the brief this pass was built on. */
const CAPTURED_BRIEF = [
  "We're a B2B SaaS company (£8k MRR, 120 customers) deciding whether to hire a dedicated sales team or continue with founder-led sales.",
  "* Current conversion rate from trial to paid is 12%, which we believe is partly driven by product quality",
  "* Our churn rate is 4% monthly, but we suspect churn and customer acquisition cost are influenced by the same underlying factor",
  "* A competitor just raised £5m and is hiring aggressively, but we don't know their exact strategy",
].join("\n");

function factor(label: string, value: number, unit: string): NodeT {
  return {
    id: "n1",
    kind: "factor",
    label,
    category: "observable",
    data: { value, unit, extractionType: "inferred" },
  } as unknown as NodeT;
}

/**
 * What the WIRE will say — bound to the one mapping that decides it
 * (`schema-v3.ts:458`), not to the internal token, so these assertions are
 * about what the user is told.
 */
function publishedSource(node: NodeT): "brief_extraction" | "cee_inference" {
  const data = node.data as { extractionType?: string } | undefined;
  return data?.extractionType === "inferred" ? "cee_inference" : "brief_extraction";
}

function creditOne(brief: string, label: string, value: number, unit: string) {
  const graph = { nodes: [factor(label, value, unit)], edges: [] } as unknown as GraphT;
  const credited = creditUserTypedFigures(graph, brief);
  return { credited, source: publishedSource(graph.nodes[0]!) };
}

describe("the user's figure survives a label the model wrote better", () => {
  it("credits the churn figure the deployed draft emitted, label and all", () => {
    const r = creditOne(WITNESS_BRIEF, "Monthly Churn Rate", 0.038, "%");
    expect(r.credited).toBe(1);
    expect(r.source).toBe("brief_extraction");
  });

  it("credits it when the model drops the user's qualifier too", () => {
    expect(creditOne(WITNESS_BRIEF, "Churn Rate", 0.038, "%").credited).toBe(1);
  });

  it("still credits the user's exact wording", () => {
    expect(creditOne(WITNESS_BRIEF, "Monthly Churn", 0.038, "%").credited).toBe(1);
  });

  // ── the twins: each must REFUSE, before and after ───────────────────────
  it("refuses the competitor's figure that inferLabel calls a churn rate", () => {
    const r = creditOne(CAPTURED_BRIEF, "Monthly Churn Rate", 5_000_000, "£");
    expect(r.credited).toBe(0);
    expect(r.source).toBe("cee_inference");
  });

  it("refuses a label made only of shape-words, which name no subject at all", () => {
    expect(creditOne(WITNESS_BRIEF, "Rate", 0.038, "%").credited).toBe(0);
    expect(creditOne(WITNESS_BRIEF, "Value", 0.038, "%").credited).toBe(0);
    expect(creditOne(WITNESS_BRIEF, "Factor", 0.038, "%").credited).toBe(0);
  });

  it("still refuses a factor named in one sentence and numbered in the next", () => {
    const brief = "We watch onboarding quality closely. It sits at 30% today.";
    expect(creditOne(brief, "Onboarding Quality", 0.3, "%").credited).toBe(0);
  });

  it("still refuses a subject the figure's sentence never names", () => {
    expect(creditOne(WITNESS_BRIEF, "Enterprise Pipeline Rate", 0.038, "%").credited).toBe(0);
  });

  // ── regression: the capture this pass was built on ──────────────────────
  it("keeps crediting the two figures of capture d9c4066c", () => {
    expect(creditOne(CAPTURED_BRIEF, "Monthly Churn Rate", 0.04, "%").credited).toBe(1);
    expect(creditOne(CAPTURED_BRIEF, "Trial-to-Paid Conversion Rate", 0.12, "%").credited).toBe(1);
  });
});
