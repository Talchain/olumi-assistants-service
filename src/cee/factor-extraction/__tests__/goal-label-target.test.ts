/**
 * ROADMAP — the founder brief whose £30k target reached no typed field.
 *
 * ⚠ WHAT THE FIXTURES ARE, STATED SO NOBODY INHERITS THEM AS THE WIRE.
 * The goal label, every node id/kind/label and the shape of the drafted graph
 * are VERBATIM from the debug bundle of the failed session (`full_graph`,
 * scenario `7826c742-2939-4584-917c-f1286a663ae4`, UI `86786efb`, CEE
 * `f4c8f50`). The BRIEF is a RECONSTRUCTION — the bundle captures assistant
 * text and node labels but not the user's own message — assembled around the
 * three brief spans the extractor copied verbatim into node labels. So the
 * label side of every assertion is wire-derived; the brief side is a faithful
 * reconstruction and is named as one. A capture proves what it was pointed at
 * (CLAUDE.md trap 16/20).
 */

import { describe, expect, it } from "vitest";
import {
  deriveGoalTargetFromLabel,
  goalLabelStatesUncarriedTarget,
} from "../goal-label-target.js";
import { enrichGraphWithFactorsAsync } from "../enricher.js";
import { extractFactors } from "../index.js";

/** ✓ verbatim from bundle node `552bd1c0`. */
const GOAL_LABEL = "Reach £30k MRR Within 18 Months";

/** RECONSTRUCTION — see the file header. Spans marked ✓ are verbatim node labels. */
const FOUNDER_BRIEF = [
  "We're a B2B SaaS at £8k MRR with 120 customers.",
  "I want to reach £30k MRR within 18 months.",
  "Trial-to-paid conversion is 12% and monthly churn is 4%.",
  "We have £200k of runway.",
  "We must keep at least six months of runway at all times.",
  "CAC must stay below £500.",
  "I spend 60% of my time on sales.",
  "A first sales hire would cost £80-120k plus £20k of tooling.",
  "A part-time SDR would be about £40k.",
  // ✓ bundle node 26fbdff5
  "We've heard from three churned customers that they left because of missing integrations, not price — so we think product gaps mediate the relationship between customer satisfaction and churn.",
  // ✓ bundle node 27c23ebb
  "hiring would free this up for product, which we believe indirectly affects retention through product quality improvements.",
  // ✓ bundle node 422ceee7
  "Trial-to-paid conversion, which we believe is partly driven by product quality and partly by how much attention each trial gets from the founder.",
  "A competitor raised £5m and is hiring.",
].join(" ");

/** ✓ ids, kinds and labels verbatim from the bundle's `full_graph`. */
function founderGraph(): any {
  return {
    nodes: [
      { id: "faa7499e", kind: "decision", label: "Hire a Dedicated Sales Team or Continue With Founder-Led Sales" },
      { id: "552bd1c0", kind: "goal", label: GOAL_LABEL },
      { id: "16ec3d64", kind: "factor", label: "ICP Clarity" },
      { id: "919d7f50", kind: "factor", label: "Sales Headcount Investment" },
      { id: "7dc44ba7", kind: "factor", label: "Competitive Pressure" },
      { id: "b6941ac0", kind: "outcome", label: "MRR Growth Rate" },
      { id: "b42f8b15", kind: "outcome", label: "Trial-to-Paid Conversion Uplift" },
      { id: "3d37f4b2", kind: "risk", label: "Churn Rate Deterioration" },
      { id: "428612e0", kind: "risk", label: "Runway Depletion Risk" },
      { id: "bbbbd8f2", kind: "risk", label: "Customer Acquisition Cost" },
    ],
    edges: [],
  };
}

describe("the gate that made the mint unreachable", () => {
  it("PINS THE PRECONDITION: no extracted factor label carries a target word for this brief", () => {
    // This is why `isTargetGoalLabel` never fires here, and it is asserted
    // rather than described so the test REDs if the extractor ever starts
    // labelling one of these factors "target"/"goal"/"objective"/"threshold" —
    // at which point the fix below is being exercised on a changed premise.
    const labels = extractFactors(FOUNDER_BRIEF).map((f) => f.label.toLowerCase());
    expect(labels.length).toBeGreaterThan(0);
    for (const word of ["target", "goal", "objective", "threshold"]) {
      expect(labels.some((l) => l.includes(word))).toBe(false);
    }
    // And the £30,000 IS extracted — it is simply labelled something else, so
    // the number was never missing, only unbindable.
    expect(extractFactors(FOUNDER_BRIEF).some((f) => f.value === 30000)).toBe(true);
  });
});

describe("deriveGoalTargetFromLabel", () => {
  it("reads the founder brief's target from the goal label and attests it in the brief", () => {
    const r = deriveGoalTargetFromLabel(GOAL_LABEL, FOUNDER_BRIEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(30000);
    expect(r.target.unit).toBe("£");
    expect(r.target.matchedText).toBe("£30k");
  });

  it("does NOT read the deadline as the target", () => {
    // "18 Months" is the only other quantity in the label. If the temporal
    // classification were dropped this would refuse as ambiguous, so this case
    // is load-bearing in both directions.
    //
    // ⚠ ONE ASSERTION HERE COULD NOT FAIL AND HAS BEEN REPLACED.
    // `expect(r.target.unit).not.toBe("months")` is true of every possible
    // outcome: `scanQuantities` only ever emits a currency symbol, "%" or
    // "count", so NO code change could turn it red. It read as a guard and was
    // a tautology. The `value !== 18` half was and remains real.
    const r = deriveGoalTargetFromLabel(GOAL_LABEL, FOUNDER_BRIEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).not.toBe(18);
    // Bound by IDENTITY, not by a predicate another quantity could satisfy:
    // the selected span must be the CURRENCY one, and the deadline's span must
    // not be what was chosen (trap 19).
    expect(r.target.unit).toBe("£");
    expect(r.target.matchedText).toBe("£30k");
    expect(r.target.matchedText.toLowerCase()).not.toContain("month");
  });

  it("⭐ PRECONDITION: the label really does carry the deadline this test claims to reject", () => {
    // Without this the test above passes just as well on a fixture that has
    // quietly lost its temporal quantity — the discrimination would be gone and
    // nothing would say so (trap 13b).
    expect(GOAL_LABEL).toMatch(/18\s+months/i);
    // …and a label carrying ONLY the deadline refuses, which is the same
    // classification observed from the other side.
    expect(deriveGoalTargetFromLabel("Ship Within 18 Months", FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "no_quantity_in_label",
    });
  });

  it("refuses a label figure the brief does not state (#789: no model authors a threshold)", () => {
    const r = deriveGoalTargetFromLabel("Reach £45k MRR Within 18 Months", FOUNDER_BRIEF);
    expect(r).toEqual({ ok: false, refusal: "quantity_not_attested" });
  });

  it("refuses rather than guesses when two label figures are both attested", () => {
    const r = deriveGoalTargetFromLabel(
      "Grow MRR from £8k to £30k",
      "We're at £8k MRR and I want to reach £30k MRR.",
    );
    expect(r).toEqual({ ok: false, refusal: "ambiguous_multiple_attested" });
  });

  it("is not confused by the same target stated several times in the brief", () => {
    const r = deriveGoalTargetFromLabel(
      "Reach £30k MRR",
      "I want £30k MRR. £30k MRR is the target. Everything is about £30k MRR.",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(30000);
  });

  it("matches a magnitude paraphrase: £30k in the label, £30,000 in the brief", () => {
    const r = deriveGoalTargetFromLabel("Reach £30k MRR", "We want to reach £30,000 MRR.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(30000);
    expect(r.target.briefQuote).toBe("£30,000");
  });

  it("carries percentages in the extractor's FRACTION convention", () => {
    const r = deriveGoalTargetFromLabel("Reach 30% Trial Conversion", "Take trial conversion to 30%.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.unit).toBe("%");
    expect(r.target.value).toBeCloseTo(0.3, 12);
  });

  it("reads a bare count target", () => {
    const r = deriveGoalTargetFromLabel("Reach 800 Customers", "We want 800 customers by year end.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.unit).toBe("count");
    expect(r.target.value).toBe(800);
  });

  it("refuses a label figure whose UNIT the brief never states — 500 customers is not £500", () => {
    // KILLS THE SURVIVOR. Without the unit comparison in `sameQuantity` this
    // attests a bare count of 500 against the brief's "£500" CAC ceiling and
    // mints a currency ceiling as a customer target. Same number, different
    // quantity — the one shape a value-only match cannot tell apart
    // (CLAUDE.md trap 19: bind by identity, never by a value predicate another
    // object could satisfy).
    expect(deriveGoalTargetFromLabel("Reach 500 Customers", FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "quantity_not_attested",
    });
    // Its positive twin, so the case cannot pass by refusing everything.
    const ok = deriveGoalTargetFromLabel("Reach 500 Customers", "We want 500 customers.");
    expect(ok.ok).toBe(true);
  });

  it("refuses an unquantified goal label", () => {
    expect(deriveGoalTargetFromLabel("Grow annual revenue", FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "no_quantity_in_label",
    });
  });

  it("refuses a goal label that is only a deadline", () => {
    expect(deriveGoalTargetFromLabel("Ship Within 18 Months", FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "no_quantity_in_label",
    });
  });

  it("refuses an absent label", () => {
    expect(deriveGoalTargetFromLabel(undefined, FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "no_goal_label",
    });
    expect(deriveGoalTargetFromLabel("   ", FOUNDER_BRIEF)).toEqual({
      ok: false,
      refusal: "no_goal_label",
    });
  });

  it("refuses when there is no brief to attest against", () => {
    expect(deriveGoalTargetFromLabel(GOAL_LABEL, "")).toEqual({
      ok: false,
      refusal: "quantity_not_attested",
    });
  });
});

describe("goalLabelStatesUncarriedTarget — the conservation predicate", () => {
  it("is TRUE for the exact node the failed session shipped", () => {
    // Verbatim from the bundle: label states the target, all four typed fields null.
    const shipped = {
      id: "552bd1c0",
      label: GOAL_LABEL,
      goal_threshold: null,
      goal_threshold_raw: null,
      goal_threshold_unit: null,
      goal_threshold_cap: null,
    };
    expect(goalLabelStatesUncarriedTarget(shipped, FOUNDER_BRIEF)).toBe(true);
  });

  it("is FALSE once the node carries the typed target", () => {
    expect(
      goalLabelStatesUncarriedTarget({ label: GOAL_LABEL, goal_threshold_raw: 30000 }, FOUNDER_BRIEF),
    ).toBe(false);
  });

  it("is FALSE for a label figure the brief never stated — that is not conservation, it is invention", () => {
    expect(
      goalLabelStatesUncarriedTarget({ label: "Reach £45k MRR", goal_threshold_raw: null }, FOUNDER_BRIEF),
    ).toBe(false);
  });
});

describe("the draft path mints the founder's target", () => {
  it("mints goal_threshold from the goal label for the founder brief", async () => {
    const res = await enrichGraphWithFactorsAsync(founderGraph(), FOUNDER_BRIEF, {
      minConfidence: 0.6,
      maxFactors: 10,
    });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(goal.id).toBe("552bd1c0");
    expect(goal.goal_threshold_raw).toBe(30000);
    expect(goal.goal_threshold_unit).toBe("£");
    // Normalised against the SAME cap the chat path would resolve, so the two
    // registration paths score one target identically (ROADMAP 1.18).
    expect(typeof goal.goal_threshold_cap).toBe("number");
    expect(goal.goal_threshold).toBeCloseTo(30000 / goal.goal_threshold_cap, 12);
    expect(res.goalThresholdsMinted).toEqual(["552bd1c0"]);
    // The conservation failure the bundle shipped is closed for this node.
    expect(goalLabelStatesUncarriedTarget(goal, FOUNDER_BRIEF)).toBe(false);
  });

  it("mints on the v4-complete-skip path too — the same brief, a draft with full interventions", async () => {
    // The skip fires on every well-formed draft (ROADMAP 2.281), so a fix that
    // only reached the enrichment loop would still ship dark for real drafts.
    const graph = founderGraph();
    graph.nodes.push(
      { id: "opt1", kind: "option", label: "Hire a Dedicated Sales Team", data: { interventions: { f1: 0.9 } } },
      { id: "f1", kind: "factor", label: "Sales Spend", data: { value: 0.5 } },
    );
    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(res.extractionMode).toBe("v4_factor_skip_goal_minted");
    expect(goal.goal_threshold_raw).toBe(30000);
    expect(goal.goal_threshold_unit).toBe("£");
    expect(res.goalThresholdsMinted).toEqual(["552bd1c0"]);
  });

  it("mints NOTHING when the goal label's figure is not in the brief", async () => {
    const graph = founderGraph();
    graph.nodes.find((n: any) => n.kind === "goal").label = "Reach £45k MRR Within 18 Months";
    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
  });

  it("does not overwrite a threshold a factor route already minted", async () => {
    // FIRST WRITER WINS is the pre-existing rule (`applyGoalTargetRedirect`
    // returns false when the node already carries one). The label route runs
    // only where nothing else spoke, so this pins that it is a FALLBACK and
    // not a second author.
    const graph = founderGraph();
    graph.nodes.find((n: any) => n.kind === "goal").goal_threshold = 0.42;
    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(goal.goal_threshold).toBe(0.42);
    expect(res.goalThresholdsMinted).toEqual([]);
  });
});

describe("the minted target SURVIVES Stage 4b (threshold sweep)", () => {
  it("is not stripped by the sweep that exists to delete fabricated thresholds", async () => {
    // A mint one stage later deletes is indistinguishable from no mint at all
    // (CLAUDE.md trap 16-inverse: reachable inside one function is not reachable
    // in the pipeline). So the two stages are run in their real order, with the
    // attestation carried the way `stages/enrich.ts` carries it.
    const { runStageThresholdSweep } = await import(
      "../../unified-pipeline/stages/threshold-sweep.js"
    );

    const res = await enrichGraphWithFactorsAsync(founderGraph(), FOUNDER_BRIEF, {
      minConfidence: 0.6,
      maxFactors: 10,
    });
    expect(res.goalThresholdsMinted).toEqual(["552bd1c0"]);

    const ctx: any = {
      graph: res.graph,
      requestId: "goal-label-target-sweep",
      // Exactly the derivation at `stages/enrich.ts` — never re-inferred here.
      enricherMintedGoalIds: new Set(res.goalThresholdsMinted ?? []),
      nodeRenames: new Map(),
    };
    await runStageThresholdSweep(ctx);

    const goal: any = ctx.graph.nodes.find((n: any) => n.kind === "goal");
    expect(goal.goal_threshold_raw).toBe(30000);
    expect(goal.goal_threshold_unit).toBe("£");
    expect(goal.goal_threshold_frame).toBeDefined();
    expect(ctx.thresholdSweepTrace.strips_applied).toBe(0);
  });
});

describe("the review's three findings — measured, then pinned", () => {
  /* ─────────────────────────────────────────────────────────────────────────
   * BLOCKING 1 — the temporal exclusion was applied on ONE side.
   * ────────────────────────────────────────────────────────────────────── */
  it("a DURATION in the brief does not attest a bare COUNT in the label", () => {
    // Measured at `cd010b55`: this returned
    // `ok { value: 18, unit: "count", briefQuote: "18 months" }`. The user
    // stated 18 as a DEADLINE; the mint stamped it as a LEVEL.
    expect(
      deriveGoalTargetFromLabel(
        "Reach 18 Enterprise Accounts",
        "I want to grow the business within 18 months.",
      ),
    ).toEqual({ ok: false, refusal: "quantity_not_attested" });

    expect(
      deriveGoalTargetFromLabel(
        "Hire 6 Salespeople",
        "We must keep at least 6 months of runway.",
      ),
    ).toEqual({ ok: false, refusal: "quantity_not_attested" });
  });

  it("⭐ THE TWIN: the same COUNT stated non-temporally in the brief still attests", () => {
    // Without this, "filter the brief side" could be satisfied by a change that
    // simply stopped attesting counts at all — the label-side asymmetry
    // repeated on the brief side, which is the shape of the original defect
    // (trap 13d: an invariant written with the code's own asymmetry).
    const r = deriveGoalTargetFromLabel(
      "Reach 18 Enterprise Accounts",
      "We want 18 enterprise accounts signed.",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(18);
    expect(r.target.unit).toBe("count");
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * BLOCKING 2 — the greedy digit run backtracked behind the trailer guard.
   * ────────────────────────────────────────────────────────────────────── */
  it.each([
    ["£80kARR", "no_quantity_in_label"],
    ["£1.5mARR", "no_quantity_in_label"],
    ["the run rate is £250grandish", "no_quantity_in_label"],
    ["Reach £30kMRR Within 18 Months", "no_quantity_in_label"],
  ])("%s refuses outright instead of backtracking to a shorter number", (label, refusal) => {
    // Measured at `cd010b55`, in order: £8, £1, £25, £3 — under-reads of up to
    // 10,000x, and the last is the very target this module exists to capture.
    // A brief carrying all four short readings makes the old behaviour MINT
    // them, so this is an attestation test, not only a scanner test.
    const brief = "we have £8 and £1 and £25 and £3 in the bank";
    expect(deriveGoalTargetFromLabel(label, brief)).toEqual({ ok: false, refusal });
  });

  it("⭐ THE TWIN: a magnitude followed by a SPACE or nothing still reads in full", () => {
    // The anchor must refuse a truncated read, not every read. Without this the
    // fix could be "match nothing ever" and the cases above would still pass.
    for (const [label, value] of [
      ["£30k", 30_000],
      ["Reach £30k MRR Within 18 Months", 30_000],
    ] as const) {
      const r = deriveGoalTargetFromLabel(label, "we want £30k MRR");
      expect(r.ok, label).toBe(true);
      if (!r.ok) return;
      expect(r.target.value, label).toBe(value);
    }
    // And #799's narrowing is untouched: a trailer that is NOT a magnitude key
    // must keep extracting.
    const pcm = deriveGoalTargetFromLabel("Hold Price At £49pcm", "we charge £49pcm");
    expect(pcm.ok).toBe(true);
    if (!pcm.ok) return;
    expect(pcm.target.value).toBe(49);
  });

  it("a digit INSIDE a word is not a quantity — `B2B` is not two billion", () => {
    // Measured at `cd010b55`: `briefQuote: "2B"`. The scanner had no left
    // boundary, so the `2` of "B2B" scanned as a count with `B` read as the
    // billion key, and attested a label the brief never supported.
    expect(
      deriveGoalTargetFromLabel(
        "Reach 2bn Monthly Impressions",
        "We're a B2B SaaS wanting more reach.",
      ),
    ).toEqual({ ok: false, refusal: "quantity_not_attested" });

    // THE TWIN: a genuine `2bn` in the brief still attests, so the left
    // boundary refuses word-internal digits and nothing else.
    const real = deriveGoalTargetFromLabel(
      "Reach 2bn Monthly Impressions",
      "We want 2bn monthly impressions.",
    );
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.target.value).toBe(2_000_000_000);
  });

  it("⭐ a refused word-internal number does not leak its TAIL either", () => {
    // Found by a mutant that SURVIVED: widening the left boundary to include
    // digits was not equivalent, it was strictly better. With a letters-only
    // boundary the engine advances INTO a number whose start it refused and
    // matches the tail — "12a34" published "4", "£30k30k" published "0k". The
    // backtracking defect one level out.
    //
    // Asserted through the attestation, where the harm lands: a brief whose
    // only "4" is the tail of a refused "34" must not attest a label reading 4.
    expect(deriveGoalTargetFromLabel("Reach 4 Accounts", "we run 12a34 experiments")).toEqual({
      ok: false,
      refusal: "quantity_not_attested",
    });
    // THE TWIN: a genuine, separately written 4 still attests.
    const real = deriveGoalTargetFromLabel("Reach 4 Accounts", "we want 4 accounts");
    expect(real.ok).toBe(true);
  });

  it("the left boundary sits BEFORE the currency symbol, not after it", () => {
    // Placement, not just membership. A mutant that added `£` to the boundary
    // class SURVIVED the corpus; measured against it, the two spellings differ
    // only on a doubled symbol — so this is the case that discriminates where
    // the lookbehind is anchored, and without it the placement is unpinned.
    const r = deriveGoalTargetFromLabel("Reach ££30k MRR", "we want ££30k MRR");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(30_000);
    expect(r.target.unit).toBe("£");
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * BLOCKING 3 — NOT CLOSED. Pinned as a KNOWN GAP so it stays visible.
   * ────────────────────────────────────────────────────────────────────── */
  it("⛔ KNOWN GAP — A SAMPLED FLOOR, NOT AN EXACT SET: a figure stated as a LEVEL still attests a target", () => {
    // ⚠ THIS TEST ASSERTS THE DEFECT, DELIBERATELY, AND MUST BE INVERTED —
    // NOT DELETED — WHEN THE SPAN BINDING LANDS. `sameQuantity` answers "does
    // this figure occur in the brief?", never "did the user state it as their
    // target". The brief below states 4% as the CURRENT churn level; the model
    // wrote the label; the mint stamps `goal_threshold_frame: 'level'`.
    //
    // ⚠⚠ WHAT THIS TEST GUARANTEES, AND THE PREVIOUS SENTENCE HERE CLAIMED MORE.
    // It read: "Pinned as an EXACT set so it REDs if the class grows OR
    // shrinks". FALSE, and falsifiable by reading the code beneath it: two
    // independent `toBe(true)` assertions on two hand-written inputs, with no
    // computed set and no `toEqual` over an enumeration. It REDs on SHRINK ONLY
    // — when one of these two instances starts refusing — and is structurally
    // blind to the class growing.
    //
    // THE CLASS IS WIDER THAN THESE TWO. Five more instances, measured through
    // this module at this head, every one of them minting and none of them
    // visible to the assertions below:
    //
    //   "Reach 12% Conversion"  + "our conversion is 12% today"          → %0.12
    //   "Reach £500 CAC"        + "we currently pay £500 per acquisition" → £500
    //   "Grow To 12 Engineers"  + "we are a team of 12 engineers"        → count 12
    //   "Ship 4 Releases"       + "we are migrating to GPT-4"            → count 4
    //   "Reach 27001 Users"     + "we need ISO 27001 certification"      → count 27001
    //
    // ⛔ DO NOT GROW THE SET TO MATCH. "A figure the brief states for some
    // reason other than as a target" is an OPEN CLASS over natural language;
    // enumerating it is the error, not the fix, and an exact-set claim over an
    // open class reads green as the class grows — a tracking mirror wearing a
    // guard's clothes (trap 12). These two are a SAMPLED FLOOR: a floor under
    // the gap's visibility, chosen because they are the two the review
    // measured, and they say nothing about the size of the class.
    //
    // A gap recorded in the suite is honest; a gap invisible to it is how this
    // one reached a review. What this floor is FOR is the shrink direction:
    // when the span binding lands (see the module header), these REDden and the
    // successor is told to invert them rather than discovering the gap closed
    // by accident.
    const level = deriveGoalTargetFromLabel(
      "Keep Monthly Churn Below 4%",
      "Trial-to-paid conversion is 12% and monthly churn is 4%.",
    );
    expect(level.ok, "if this is now false, INVERT this test — the gap closed").toBe(true);
    if (!level.ok) return;
    expect(level.target.value).toBe(0.04);

    const year = deriveGoalTargetFromLabel(
      "Sign 2026 Enterprise Accounts",
      "Our plan runs to 2026.",
    );
    expect(year.ok, "if this is now false, INVERT this test — the gap closed").toBe(true);
    if (!year.ok) return;
    expect(year.target.value).toBe(2026);
  });
});

describe("round 3 — a % or a currency amount is not a duration", () => {
  /* ───────────────────────────────────────────────────────────────────────────
   * THE PREVIOUS ROUND'S OWN FIX INTRODUCED THIS. The brief side gained the
   * temporal filter the label side already had — correctly — but `isTemporal`
   * was read from the trailing time GROUP alone, regardless of the unit the
   * scanner had just assigned. So a quantity carrying `%` or a currency symbol
   * was classified as a duration whenever a time word followed it.
   *
   * Two of the three consequences are gaps. The third is a LIE, and it is the
   * one this block exists for.
   * ──────────────────────────────────────────────────────────────────────── */

  it("⛔ THE HARM: a time word after a % must not delete the second target and turn a refusal into a GUESS", () => {
    // Measured at `d167f80a`: `ok { value: 30000, unit: "£" }`.
    //
    // The user stated TWO targets. "4% year on year" classified as temporal,
    // the new brief-side filter dropped it, `attested.length` fell from 2 to 1,
    // and the module silently picked one — the guess its own header promises
    // never to make ("a wrong threshold is a confident lie, an absent one is a
    // gap, and a lie outranks a gap"). At `cd010b55`, before the brief-side
    // filter existed, this same input refused correctly.
    expect(
      deriveGoalTargetFromLabel(
        "Reach £30k MRR And 4% Churn",
        "£30k MRR and churn under 4% year on year",
      ),
    ).toEqual({ ok: false, refusal: "ambiguous_multiple_attested" });
  });

  it("⭐ THE CONTROL that makes the case above discriminating: the same two targets, time word removed", () => {
    // The two inputs differ by exactly the trailing "year on year". Without
    // this control the assertion above would pass just as well on a module that
    // refuses everything, and the refusal would be no evidence at all about the
    // temporal predicate (trap 13b: a guard agreeing with itself).
    expect(
      deriveGoalTargetFromLabel("Reach £30k MRR And 4% Churn", "£30k MRR and churn under 4%"),
    ).toEqual({ ok: false, refusal: "ambiguous_multiple_attested" });
  });

  it("⭐ THE TWIN, positive direction: a % or a currency amount with a trailing time word still ATTESTS", () => {
    // "4% year on year" is a percentage measured annually, not a duration. A
    // fix that merely widened the brief-side filter would satisfy the harm case
    // above by refusing more, so the mint has to be asserted in this direction
    // too — and on BOTH sides, because the predicate is shared.
    const pct = deriveGoalTargetFromLabel("Keep Churn Under 4%", "we need it under 4% year on year");
    expect(pct.ok).toBe(true);
    if (!pct.ok) return;
    expect(pct.target.unit).toBe("%");
    expect(pct.target.value).toBeCloseTo(0.04, 12);

    const money = deriveGoalTargetFromLabel("Hold Spend At £200k", "we spend £200k year on year");
    expect(money.ok).toBe(true);
    if (!money.ok) return;
    expect(money.target.unit).toBe("£");
    expect(money.target.value).toBe(200_000);

    // The LABEL side carried the same misclassification before this round — it
    // refused `no_quantity_in_label` on a perfectly ordinary percentage target.
    // One predicate, so one fix closes both; asserted here so that stays true.
    const labelSide = deriveGoalTargetFromLabel(
      "Keep Churn Under 4% Year On Year",
      "monthly churn is 4%",
    );
    expect(labelSide.ok).toBe(true);
    if (!labelSide.ok) return;
    expect(labelSide.target.value).toBeCloseTo(0.04, 12);
  });

  it("⭐ THE TWIN, negative direction: a BARE COUNT with a time word is still a duration, on both sides", () => {
    // The complement. If the fix were spelled as "stop filtering when a time
    // word follows", BLOCKING 1 would reopen silently — so the count branch is
    // pinned on fresh inputs rather than left to the cases that motivated it.
    expect(
      deriveGoalTargetFromLabel("Reach 24 Design Partners", "we will do this in 24 hours"),
    ).toEqual({ ok: false, refusal: "quantity_not_attested" });

    expect(deriveGoalTargetFromLabel("Ship In 24 Hours", "we have 24 design partners")).toEqual({
      ok: false,
      refusal: "no_quantity_in_label",
    });

    // …and its own positive twin, so the pair cannot pass by refusing counts.
    const real = deriveGoalTargetFromLabel("Reach 24 Design Partners", "we want 24 design partners");
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.target.unit).toBe("count");
    expect(real.target.value).toBe(24);
  });
});
