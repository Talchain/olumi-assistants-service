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
import {
  resolveGoalThresholdCap,
  CEE_GOAL_THRESHOLD_FRAME,
} from "../../../utils/goal-threshold-cap.js";

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
  it("ROUND 6: derives a CANDIDATE from the goal label for the founder brief — and writes NOTHING", async () => {
    // ⚠ DELIBERATE BEHAVIOUR CHANGE, reported not hidden (Codex, PR38
    // 5657776136): until round 6 this case asserted a MINT of raw 30000. The
    // label is model-authored and no string rule could tell a stated target
    // from a rejected proposal, so the label route now yields a candidate the
    // orchestration seam asks the user about; only the user's answer writes.
    const res = await enrichGraphWithFactorsAsync(founderGraph(), FOUNDER_BRIEF, {
      minConfidence: 0.6,
      maxFactors: 10,
    });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(goal.id).toBe("552bd1c0");
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
    expect(res.goal_target_candidate).toEqual({
      goal_node_id: "552bd1c0",
      value_user_units: 30000,
      unit: "£",
      label_span: "£30k",
      brief_span: "£30k",
      binding: "governed",
      reason: "governed",
    });
    // The target is still UNCARRIED on the node — that is now the honest state
    // until the user answers, and the predicate says so.
    expect(goalLabelStatesUncarriedTarget(goal, FOUNDER_BRIEF)).toBe(true);
  });

  it("ROUND 6: derives the candidate on the v4-complete-skip path too — the same brief, a draft with full interventions", async () => {
    // The skip fires on every well-formed draft (ROADMAP 2.281), so a fix that
    // only reached the enrichment loop would still ship dark for real drafts.
    const graph = founderGraph();
    graph.nodes.push(
      { id: "opt1", kind: "option", label: "Hire a Dedicated Sales Team", data: { interventions: { f1: 0.9 } } },
      { id: "f1", kind: "factor", label: "Sales Spend", data: { value: 0.5 } },
    );
    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    // ROUND 6: nothing is written on this path either, so the mode is an
    // honest COMPLETE skip — and the candidate still arrives.
    expect(res.extractionMode).toBe("v4_complete_skip");
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
    expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", value_user_units: 30000, unit: "£", binding: "governed" });
  });

  it("mints NOTHING when the goal label's figure is not in the brief", async () => {
    const graph = founderGraph();
    graph.nodes.find((n: any) => n.kind === "goal").label = "Reach £45k MRR Within 18 Months";
    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.kind === "goal");

    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
    // …and NO candidate either: a figure the brief never states is a model
    // invention, and an invention is not something to ask the user about.
    expect(res.goal_target_candidate).toBeUndefined();
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
    // FIRST WRITER WINS one level up: no candidate on a node that carries a target.
    expect(res.goal_target_candidate).toBeUndefined();
  });
});

describe("the minted target SURVIVES Stage 4b (threshold sweep)", () => {
  it("ROUND 6: a candidate is not on the graph, so the sweep has nothing to strip and nothing to protect", async () => {
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
    // ROUND 6: the label route mints nothing, so the sweep has nothing of ours
    // to protect or to strip; the candidate is the only artefact, and it is
    // not on the graph at all.
    expect(res.goalThresholdsMinted).toEqual([]);
    expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", binding: "governed" });

    const ctx: any = {
      graph: res.graph,
      requestId: "goal-label-target-sweep",
      enricherMintedGoalIds: new Set(res.goalThresholdsMinted ?? []),
      nodeRenames: new Map(),
    };
    await runStageThresholdSweep(ctx);

    const goal: any = ctx.graph.nodes.find((n: any) => n.kind === "goal");
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
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
    // must keep extracting. ⚠ ROUND 5 SPLIT THIS FIXTURE, DELIBERATELY: the
    // original brief "we charge £49pcm" states the CURRENT charge, which the
    // role rule now refuses by name — so the trailer-guard property is pinned
    // on a TARGET-framed brief (a broken guard reads £4, not £49, and the mint
    // assertion still discriminates), and the current-charge reading is pinned
    // beside it as the refusal it now is. One property per assertion.
    const pcm = deriveGoalTargetFromLabel("Hold Price At £49pcm", "our target price is £49pcm");
    expect(pcm.ok).toBe(true);
    if (!pcm.ok) return;
    expect(pcm.target.value).toBe(49);
    expect(
      deriveGoalTargetFromLabel("Hold Price At £49pcm", "we charge £49pcm"),
    ).toEqual({ ok: false, refusal: "stated_as_spend", briefQuote: "£49" });
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
  it("✅ INVERTED (round 5): a figure stated as a LEVEL no longer attests a target — BLOCKING 3 closed", () => {
    // ⚠ THIS TEST USED TO ASSERT THE DEFECT, DELIBERATELY, and its own comment
    // ordered the successor to INVERT rather than delete it when the span
    // binding landed. It landed in round 5: `sameQuantity` still answers "does
    // this figure occur?", and the ROLE rule beneath it now answers "did the
    // user state it as this goal's target?". The two instances the review
    // measured are the two pinned here; the five it listed in a comment are
    // asserted in the round-5 KNOWN-CLASS table below, by name.
    expect(
      deriveGoalTargetFromLabel(
        "Keep Monthly Churn Below 4%",
        "Trial-to-paid conversion is 12% and monthly churn is 4%.",
      ),
    ).toEqual({ ok: false, refusal: "stated_as_current_level", briefQuote: "4%" });

    expect(
      deriveGoalTargetFromLabel("Sign 2026 Enterprise Accounts", "Our plan runs to 2026."),
    ).toEqual({ ok: false, refusal: "quantity_not_stated_as_target", briefQuote: "2026" });

    // THE TWINS, so the inversion cannot pass on a module that refuses
    // everything: the same figures STATED AS TARGETS still mint.
    const churn = deriveGoalTargetFromLabel("Hit 4% Monthly Churn", "we want to hit 4% monthly churn");
    expect(churn.ok).toBe(true);
    if (churn.ok) expect(churn.target.value).toBeCloseTo(0.04, 12);
    const accounts = deriveGoalTargetFromLabel(
      "Sign 2026 Enterprise Accounts",
      "our goal is to sign 2026 enterprise accounts",
    );
    expect(accounts.ok).toBe(true);
    if (accounts.ok) expect(accounts.target.value).toBe(2026);
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
    // ⚠ ROUND 5 RE-FIXTURED THESE THREE, and SPLIT each: the property this test
    // pins is the TEMPORAL-UNIT predicate ("4% year on year" is a percentage,
    // not a duration), and the original briefs happened to state their figure
    // as a BOUND ("under 4%") or a SPEND ("we spend £200k") or a LEVEL ("churn
    // is 4%") — roles the round-5 rule now refuses by name. So the temporal
    // property is pinned on TARGET-framed twins carrying the same time word,
    // and the original briefs are pinned beside them as the refusals they are.
    const pct = deriveGoalTargetFromLabel("Hit 4% Growth", "we want to hit 4% growth year on year");
    expect(pct.ok).toBe(true);
    if (!pct.ok) return;
    expect(pct.target.unit).toBe("%");
    expect(pct.target.value).toBeCloseTo(0.04, 12);
    expect(
      deriveGoalTargetFromLabel("Keep Churn Under 4%", "we need it under 4% year on year"),
    ).toEqual({ ok: false, refusal: "limit_direction_not_representable", briefQuote: "4% year" });

    const money = deriveGoalTargetFromLabel("Reach £200k Revenue", "our target is £200k revenue year on year");
    expect(money.ok).toBe(true);
    if (!money.ok) return;
    expect(money.target.unit).toBe("£");
    expect(money.target.value).toBe(200_000);
    expect(
      deriveGoalTargetFromLabel("Hold Spend At £200k", "we spend £200k year on year"),
    ).toEqual({ ok: false, refusal: "stated_as_spend", briefQuote: "£200k year" });

    // The LABEL side carried the same misclassification before this round — it
    // refused `no_quantity_in_label` on a perfectly ordinary percentage target.
    // One predicate, so one fix closes both; asserted here so that stays true.
    const labelSide = deriveGoalTargetFromLabel(
      "Reach 4% Growth Year On Year",
      "we want to reach 4% growth",
    );
    expect(labelSide.ok).toBe(true);
    if (!labelSide.ok) return;
    expect(labelSide.target.value).toBeCloseTo(0.04, 12);
    expect(
      deriveGoalTargetFromLabel("Keep Churn Under 4% Year On Year", "monthly churn is 4%"),
    ).toEqual({ ok: false, refusal: "stated_as_current_level", briefQuote: "4%" });
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

/**
 * ── ROUND 4 — THE PROJECTOR'S PARTIAL QUAD ──────────────────────────────────
 *
 * ⭐⭐ THIS ROUTE IS NOT THE ONLY MINT, AND THE OTHER ONE CAN LEAVE A HALF-
 * WRITTEN CONTRACT BEHIND IT.
 *
 * `applyStatedGoalTarget` (`cee/draft/records/projector.ts:1312`) mints the same
 * five fields from the model's stated `goal` record. Until #1339 merged, the
 * strip at `adapters/llm/anthropic.ts` deleted its output before the enricher
 * ever saw it, which is why this module's header could once read as though the
 * enricher were the only author. It no longer is, on the Anthropic path.
 *
 * ⛔ AND IT WRITES ITS FIELDS UNDER DIFFERENT CONDITIONS. `goal_threshold_raw`
 * is written UNCONDITIONALLY; `goal_threshold`, `_cap` and `_frame` are written
 * only when `resolveGoalThresholdCap` returns non-null — and it returns `null`
 * for any target that is not strictly positive. So a user who states a target
 * of ZERO ("cut churn to zero", "get to zero defects", "break even") leaves a
 * PARTIAL quad: raw and unit set, `goal_threshold` absent.
 *
 * `applyGoalTargetRedirect`'s deferral tested `goal_threshold` — the field the
 * upstream mint writes CONDITIONALLY — so the partial quad sailed through it
 * and this route overwrote the user's stated zero with the CURRENT level stated
 * in the same brief. That is the lie direction, and by this module's own
 * doctrine a lie outranks a gap.
 *
 * The invariant below is written against the SPEC — "an upstream mint is
 * deferred to" — and therefore tests the field that mint ALWAYS writes, not the
 * one that happened to be missing in the case that exposed it.
 */
describe("round 4 — this route defers to the projector's upstream mint", () => {
  it("⭐ PRECONDITION: a stated target of ZERO really does leave the projector's quad PARTIAL", () => {
    // Asserted against the RESOLVER ITSELF rather than against my reading of
    // it, so the fixtures below are the producer's real output and not my model
    // of the producer (trap 13c — a kit measures sensitivity, never whether the
    // expectation is right).
    expect(resolveGoalThresholdCap(undefined, 0, "%", undefined)).toBeNull();
    // …and the DISCRIMINATING CONTRAST, so this is not a probe that returns
    // null for everything: a strictly positive target resolves a cap, which is
    // precisely why the full quad below is full.
    expect(resolveGoalThresholdCap(undefined, 30000, "£", undefined)).toBe(37500);
  });

  it("⛔ THE HARM: a stated target of ZERO is not overwritten with the CURRENT level", async () => {
    const graph = founderGraph();
    const goalNode = graph.nodes.find((n: any) => n.id === "552bd1c0");
    goalNode.label = "Cut Churn From 4% To Zero";
    // EXACTLY what `applyStatedGoalTarget(node, 0, "%")` leaves — raw and unit,
    // and nothing else, because the cap resolver returned null above.
    goalNode.goal_threshold_raw = 0;
    goalNode.goal_threshold_unit = "%";

    const brief = "Monthly churn is 4% today. We want to cut churn to zero.";
    const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");

    // The user's stated zero survives, and the 4% CURRENT level does not become
    // their target.
    expect(goal.goal_threshold_raw).toBe(0);
    expect(goal.goal_threshold).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
  });

  it("⭐ THE INTERACTION PIN (ARM A): a FULL quad from the projector is deferred to", async () => {
    // The guard nothing anywhere asserted. Without it a change on EITHER side —
    // this route's deferral, or the projector's mint — re-opens a double mint
    // with nothing going red.
    const graph = founderGraph();
    const goalNode = graph.nodes.find((n: any) => n.id === "552bd1c0");
    // EXACTLY what `applyStatedGoalTarget(node, 30000, "£")` leaves.
    goalNode.goal_threshold_raw = 30000;
    goalNode.goal_threshold_unit = "£";
    goalNode.goal_threshold_cap = 37500;
    goalNode.goal_threshold = 30000 / 37500;
    goalNode.goal_threshold_frame = CEE_GOAL_THRESHOLD_FRAME;

    const res = await enrichGraphWithFactorsAsync(graph, FOUNDER_BRIEF, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");

    expect(goal.goal_threshold_raw).toBe(30000);
    expect(goal.goal_threshold).toBe(0.8);
    expect(res.goalThresholdsMinted).toEqual([]);
  });

  it("⭐ THE TWIN, opposite direction: a goal node with NO upstream mint yields a CANDIDATE (round 6: never a mint)", async () => {
    // Without this, both cases above pass just as well on a module that has
    // stopped deriving altogether (trap 13b — a guard agreeing with itself).
    const res = await enrichGraphWithFactorsAsync(founderGraph(), FOUNDER_BRIEF, {
      minConfidence: 0.6,
    });
    const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");

    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
    expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", value_user_units: 30000, unit: "£", binding: "governed" });
  });

  it("⭐ THE TWIN, second direction: a PARTIAL quad blocks the FACTOR route too, not just the label route", async () => {
    // The deferral lives in `applyGoalTargetRedirect`, the ONE point both routes
    // pass through, rather than in the label route alone — otherwise the factor
    // route commits the identical harm through a door nothing is watching
    // (trap 22b). This drives the FACTOR route by giving a factor label one of
    // the four words `isTargetGoalLabel` reads, and asserts it defers as well.
    const graph = founderGraph();
    const goalNode = graph.nodes.find((n: any) => n.id === "552bd1c0");
    goalNode.label = "Reduce Churn";
    goalNode.goal_threshold_raw = 0;
    goalNode.goal_threshold_unit = "%";

    const brief = "Our churn target is 4%. We want to cut churn to zero.";
    const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
    const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");

    expect(goal.goal_threshold_raw).toBe(0);
    expect(goal.goal_threshold).toBeUndefined();
    expect(res.goalThresholdsMinted).toEqual([]);
  });
});

/**
 * ── ROUND 5 — A FIGURE MUST BE STATED AS THIS GOAL'S TARGET (CEE #1328 BLOCKING 3) ──
 *
 * `sameQuantity` answers "does this figure OCCUR in the brief?". Rounds 1–4
 * bounded the SCANNER; this round bounds the ROLE. The rule (see the module's
 * ROUND 5 block): an occurrence mints only when a target construction GOVERNS
 * it (goal word · desire lead · target verb · goal-pair span), no closed-class
 * stop screens it (bound · negation · conditional · past · present-state ·
 * spend · third-party subject), and the METRIC is bound by the user's words —
 * the construction's own metric words all appear in the label, or, when it
 * names none, the occurrence lies inside the sentence the user wrote as their
 * goal. Where two conjuncts disagree, withhold: a lie outranks a gap.
 *
 * EVERY CASE CARRIES ITS OPPOSITE-DIRECTION TWIN, and every twin pins its own
 * precondition (the figure IS in the brief), so a case cannot pass on a scanner
 * that stopped matching (trap 13b) and a refusal cannot pass on a module that
 * refuses everything.
 *
 * ⚠ THE CORPUS BELOW IS THE AUTHOR'S. Composing pre-existing closed lists
 * positionally is a NEW rule, and the author's corpus cannot see the class the
 * author did not imagine (trap 22). The reviewer's OUTSIDE corpus is the merge
 * evidence; this block is the development aid and the regression floor.
 */
describe("round 5 — a figure must be STATED AS THE TARGET, not merely occur", () => {
  const stated = (label: string, brief: string, ctx?: { goalSourceQuote?: string }) =>
    deriveGoalTargetFromLabel(label, brief, ctx);

  it("S1 ⛔ a COST that happens to equal the label figure is not the target (the review's example)", () => {
    const brief = "We spent £42k on office refurbishment last year; improve recurring revenue.";
    expect(brief).toContain("£42k"); // precondition: the figure IS there
    expect(stated("Reach £42k MRR", brief)).toEqual({
      ok: false,
      refusal: "stated_as_spend",
      briefQuote: "£42k",
    });
  });

  it("S1 ⭐ twin: the same figure STATED AS THE TARGET mints", () => {
    const r = stated("Reach £42k MRR", "We want to reach £42k MRR.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(42_000);
    expect(r.target.unit).toBe("£");
    expect(r.target.briefQuote).toBe("£42k");
  });

  it("S2 ⛔ a CURRENT LEVEL beside a written zero target is not the target (the review's second example)", () => {
    const brief = "Monthly churn is 5% today. We want to cut churn to zero.";
    expect(brief).toContain("5%");
    expect(stated("Cut Churn From 5% To Zero", brief)).toEqual({
      ok: false,
      refusal: "stated_as_current_level",
      briefQuote: "5%",
    });
  });

  it("S2 ⭐ twin: the same percentage STATED AS THE TARGET mints", () => {
    const r = stated("Hit 5% Churn", "We want to hit 5% churn.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBeCloseTo(0.05, 12);
  });

  it("S3 ✅ the £20k fixture (goal word reaching the amount through 'of reaching') still mints", () => {
    const brief =
      "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";
    const r = stated("Reach £20k MRR Within 12 Months", brief);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.value).toBe(20_000);
    expect(r.target.briefQuote).toBe("£20k");
  });

  it("S4 ⛔ a BARE amount in a target construction does not bind the LABEL's metric — the model's reading is not the user's statement", () => {
    // "we want to reach £42k" says nothing about MRR; the label does. Without
    // the user's own goal sentence there is no user-stated metric to bind.
    expect(stated("Reach £42k MRR", "We want to reach £42k.")).toEqual({
      ok: false,
      refusal: "metric_unbound",
      briefQuote: "£42k",
    });
  });

  it("S4 ⛔ …and the user's goal sentence does NOT license it either — quotation is not metric binding (Codex P1, 13 Sep)", () => {
    // The first round-5 cut let a bare amount inside the stamped goal sentence
    // mint. That re-licensed the MODEL's metric one level down: "For ARR, we
    // want to reach £64k" + label "Reach £64k MRR" minted an MRR target from an
    // ARR statement. The label's head noun must appear in the user's sentence.
    const brief = "We're a small SaaS. We want to reach £42k. Churn is fine.";
    expect(stated("Reach £42k MRR", brief, { goalSourceQuote: "We want to reach £42k." })).toEqual({
      ok: false,
      refusal: "metric_unbound",
      briefQuote: "£42k",
    });
    // THE TWIN: the same sentence naming the label's metric binds.
    const r = stated("Reach £42k MRR", "We want to reach £42k MRR.", { goalSourceQuote: "We want to reach £42k MRR." });
    expect(r.ok).toBe(true);
  });

  it("S18 ⛔ Codex P1 (13 Sep): the user's metric named OUTSIDE the governor window wins over the label's", () => {
    const brief = "For ARR, we want to reach £64k.";
    expect(stated("Reach £64k MRR", brief, { goalSourceQuote: brief })).toEqual({
      ok: false,
      refusal: "metric_unbound",
      briefQuote: "£64k",
    });
    // discriminating control: ONLY the label changes → mints
    const r = stated("Reach £64k ARR", brief, { goalSourceQuote: brief });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.target.value).toBe(64_000);
    // and the metric named EARLIER in the sentence binds without a quote too
    expect(stated("Reach £64k ARR", "Our ARR is £30k and we want to reach £64k.").ok).toBe(true);
    expect(stated("Reach £64k MRR", "Our ARR is £30k and we want to reach £64k.").ok).toBe(false);
  });

  it("S19 ⛔ Codex P1 (13 Sep): a desire prefix does not turn a CHANGE amount into a level", () => {
    expect(stated("Reach £64k MRR", "We want to increase MRR by £64k.")).toEqual({
      ok: false,
      refusal: "stated_as_change_amount",
      briefQuote: "£64k",
    });
    expect(stated("Reach £64k MRR", "Increase MRR by £64k.")).toMatchObject({ ok: false });
    // twins: the LEVEL forms
    expect(stated("Reach £64k MRR", "We want to increase MRR to £64k.").ok).toBe(true);
    expect(stated("Reach £64k MRR", "We want to grow MRR to £64k.").ok).toBe(true);
    // and a "from" amount is the baseline, never the level
    expect(stated("Reach £42k MRR", "We want to grow MRR from £42k to £64k.")).toMatchObject({
      ok: false,
      refusal: "stated_as_current_level",
    });
  });

  it("S4 ⛔ a goal sentence that does NOT contain the occurrence withholds, even when the metric words bind", () => {
    // Two conjuncts disagree — the construction says target, the user's goal
    // sentence is about something else — so withhold (coincidence guard).
    const brief = "We want to reach £42k MRR. Our goal is to keep the team small.";
    expect(
      stated("Reach £42k MRR", brief, { goalSourceQuote: "Our goal is to keep the team small." }),
    ).toEqual({ ok: false, refusal: "outside_goal_statement", briefQuote: "£42k" });
  });

  it("S4 ⭐ a goal sentence that cannot be PLACED in the brief is treated as absent, never as a match", () => {
    expect(
      stated("Reach £42k MRR", "We want to reach £42k.", { goalSourceQuote: "Reach forty-two thousand." }),
    ).toEqual({ ok: false, refusal: "metric_unbound", briefQuote: "£42k" });
  });

  it("S5 ⛔ two label figures both stated as targets still refuse as AMBIGUOUS (attestation runs before role)", () => {
    expect(
      stated("Reach £30k MRR And 12% Conversion", "we want to reach £30k MRR and hit 12% conversion"),
    ).toEqual({ ok: false, refusal: "ambiguous_multiple_attested" });
  });

  it("S6 ⛔ the SAME number stated as the target of a DIFFERENT metric does not bind", () => {
    expect(stated("Cut Churn To 12%", "Our target is 12% conversion.")).toEqual({
      ok: false,
      refusal: "metric_mismatch",
      briefQuote: "12%",
    });
    // twin: the metric the user named IS the label's
    const r = stated("Reach 12% Conversion", "Our target is 12% conversion.");
    expect(r.ok).toBe(true);
  });

  it("S8 ⛔ a BOUND is not a target: the level mint cannot carry a comparison direction", () => {
    // "keep churn under 4%" scored as a level would be a probability of
    // REACHING 4% churn. The user's limit still rides goal_constraints[], which
    // keeps its operator; this route withholds rather than inverts.
    expect(stated("Keep Churn Under 4%", "We want to keep churn under 4%.")).toEqual({
      ok: false,
      refusal: "limit_direction_not_representable",
      briefQuote: "4%",
    });
    expect(stated("Reach 500 Customers", "we need at least 500 customers")).toEqual({
      ok: false,
      refusal: "limit_direction_not_representable",
      briefQuote: "500",
    });
    expect(stated("Cut Churn To 2%", "we want to cut churn to 2%")).toEqual({
      ok: false,
      refusal: "limit_direction_not_representable",
      briefQuote: "2%",
    });
    // twin: the same count stated without a bound mints
    const r = stated("Reach 500 Customers", "we need 500 customers");
    expect(r.ok).toBe(true);
  });

  it("S9 ⛔ a NEGATED target is not a target", () => {
    expect(stated("Reach £42k MRR", "We don't want to reach £42k MRR; that is too small.")).toEqual({
      ok: false,
      refusal: "negated_target",
      briefQuote: "£42k",
    });
    expect(stated("Reach £42k MRR", "We want to reach £42k MRR.").ok).toBe(true);
  });

  it("S10 ⛔ a HYPOTHETICAL target is not a target", () => {
    expect(stated("Reach £42k MRR", "If we wanted £42k MRR we would need a sales team.")).toEqual({
      ok: false,
      refusal: "hypothetical_target",
      briefQuote: "£42k",
    });
    expect(stated("Reach £42k MRR", "We want £42k MRR and will need a sales team.").ok).toBe(true);
  });

  it("S11 ⛔ ANOTHER PARTY's target is not the user's", () => {
    expect(stated("Reach £42k MRR", "Our competitor targets £42k MRR.")).toEqual({
      ok: false,
      refusal: "subject_not_bound",
      briefQuote: "£42k",
    });
    expect(stated("Reach £42k MRR", "Their goal is £42k MRR.")).toEqual({
      ok: false,
      refusal: "subject_not_bound",
      briefQuote: "£42k",
    });
    expect(stated("Reach £42k MRR", "Our target is £42k MRR.").ok).toBe(true);
  });

  it("S12 ✅ a CURRENT value beside a DESIRED value: only the desired one binds", () => {
    const brief = "Churn is 5% today; we want to reach 2% churn.";
    const desired = stated("Reach 2% Churn", brief);
    expect(desired.ok).toBe(true);
    if (desired.ok) expect(desired.target.briefQuote).toBe("2%");
    expect(stated("Reach 5% Churn", brief)).toEqual({
      ok: false,
      refusal: "stated_as_current_level",
      briefQuote: "5%",
    });
  });

  it("S13 ⛔ a level REACHED in the past is history, not a target", () => {
    expect(stated("Reach £42k MRR", "We reached £42k MRR last year and want to double it.")).toEqual({
      ok: false,
      refusal: "stated_as_past",
      briefQuote: "£42k",
    });
  });

  it("S15 ⛔ a level ACHIEVED or produced today is a statement, not an aim — found by the author's own probe, 13 Sep", () => {
    // Every one of these MINTED at the first round-5 cut: a bare subject +
    // target verb ("we hit", "we generate") read as a target. A subject + verb
    // is a report; an aim arrives through an infinitive, a modal, a desire
    // lead, or at clause start.
    for (const brief of [
      "We've hit £42k MRR and want to double it.",
      "We just hit £42k MRR.",
      "We hit £42k MRR in March.",
      "We generate £42k MRR from 300 customers.",
      "We deliver £42k MRR to the group.",
    ]) {
      expect(stated("Reach £42k MRR", brief).ok, brief).toBe(false);
    }
    // twins: the same verbs as AIMS
    for (const brief of [
      "We will hit £42k MRR by June.",
      "Reaching £42k MRR is the goal.",
      "We should reach £42k MRR next year.",
      "We want to generate £42k MRR.",
    ]) {
      expect(stated("Reach £42k MRR", brief).ok, brief).toBe(true);
    }
  });

  it("S16 ⛔ a change verb without 'to' is a RATE or a DELTA, not a level", () => {
    expect(stated("Reach 22% Growth", "We grow 22% a year.").ok).toBe(false);
    expect(stated("Reach 22% Growth", "We are growing 22% year on year.").ok).toBe(false);
    expect(stated("Reach £42k MRR", "Increase MRR by £42k.").ok).toBe(false);
    // twins: the level form, with "to"
    expect(stated("Reach £42k MRR", "We want to grow MRR to £42k.").ok).toBe(true);
    expect(stated("Reach £42k MRR", "Grow MRR to £42k.").ok).toBe(true);
  });

  it("S17 ⛔ Paul's enterprise brief, as Core described it: six currency/percent candidates, ONE target — and it is a bound", () => {
    // Outside-authored parameters (Core, PR38 22:33Z): options at £2.5m / £800k /
    // £6–9m, churn 11%, "growing 22%", target NRR >110%. Nothing may mint; the
    // one genuine target is a BOUND and withholds by name.
    const ENT =
      "We're growing 22% year on year with churn at 11%. The options are a £2.5m acquisition, an £800k hiring plan, or a £6-9m raise. Our target is NRR above 110%.";
    expect(stated("Reach 110% NRR", ENT)).toMatchObject({ ok: false, refusal: "limit_direction_not_representable" });
    expect(stated("Reach 22% Growth", ENT).ok).toBe(false);
    expect(stated("Reach £2.5m Revenue", ENT).ok).toBe(false);
    expect(stated("Cut Churn To 11%", ENT).ok).toBe(false);
    expect(stated("Reach £800k ARR", ENT).ok).toBe(false);
  });

  it("S14 ⛔ the five instances the round-4 comment listed, now asserted by name", () => {
    expect(stated("Reach 12% Conversion", "our conversion is 12% today")).toMatchObject({
      ok: false,
      refusal: "stated_as_current_level",
    });
    expect(stated("Reach £500 CAC", "we currently pay £500 per acquisition")).toMatchObject({
      ok: false,
      refusal: "stated_as_current_level",
    });
    expect(stated("Grow To 12 Engineers", "we are a team of 12 engineers")).toMatchObject({
      ok: false,
    });
    expect(stated("Ship 4 Releases", "we are migrating to GPT-4")).toMatchObject({ ok: false });
    expect(stated("Reach 27001 Users", "we need ISO 27001 certification")).toMatchObject({ ok: false });
  });

  /**
   * ⭐⭐ THE KNOWN-DROPPED SET, PINNED EXACTLY — RED IF IT GROWS *OR* SHRINKS.
   *
   * Legitimate-looking target phrasings this rule still refuses, and the reason
   * it gives. Each is a GAP (a user is asked instead of told), never a lie. The
   * table is asserted with `toEqual` over the computed results, so a rule change
   * that admits one of these — or starts refusing one of the twins above — REDs
   * here and the successor is told, rather than discovering the reach moved.
   * A gap recorded in the suite is honest; a gap the suite cannot see is how
   * four rounds of oscillation happen (CLAUDE.md trap 22f).
   */
  it("⛔ KNOWN-DROPPED, exact set", () => {
    const table: ReadonlyArray<readonly [label: string, brief: string]> = [
      ["Reach £42k MRR", "£42k MRR is where we need to be."],
      ["Reach £42k MRR", "£42k MRR by December, whatever it takes."],
      ["Reach £42k MRR", "We would love to see £42k MRR."],
      ["Reach £42k MRR", "The board wants us to reach £42k MRR."],
      ["Reach £42k MRR", "We want to get the business to £42k MRR."],
      ["Reach 800 Customers", "800 customers is the number."],
    ];
    const measured = table.map(([label, brief]) => {
      const r = stated(label, brief);
      return [label, brief, r.ok ? "MINTS" : r.refusal] as const;
    });
    expect(measured).toEqual([
      ["Reach £42k MRR", "£42k MRR is where we need to be.", "quantity_not_stated_as_target"],
      ["Reach £42k MRR", "£42k MRR by December, whatever it takes.", "quantity_not_stated_as_target"],
      ["Reach £42k MRR", "We would love to see £42k MRR.", "quantity_not_stated_as_target"],
      ["Reach £42k MRR", "The board wants us to reach £42k MRR.", "subject_not_bound"],
      ["Reach £42k MRR", "We want to get the business to £42k MRR.", "metric_mismatch"],
      ["Reach 800 Customers", "800 customers is the number.", "quantity_not_stated_as_target"],
    ]);
  });

  it("⭐ positives the rule admits that are NOT goal-word or from→to shapes — pinned so the reach is visible", () => {
    for (const [label, brief, value] of [
      ["Reach £42k MRR", "We're targeting £42k MRR.", 42_000],
      ["Reach £42k MRR", "Getting to £42k MRR is the plan.", 42_000],
      ["Reach 30% Trial Conversion", "Take trial conversion to 30%.", 0.3],
      ["Reach 800 Customers", "We need 800 customers by year end.", 800],
      ["Reach £42k MRR", "We aim to hit £42k MRR.", 42_000],
    ] as const) {
      const r = stated(label, brief);
      expect(r.ok, `${label} / ${brief}`).toBe(true);
      if (r.ok) expect(r.target.value, brief).toBeCloseTo(value, 9);
    }
  });

  describe("through the enricher — both routes into the mint", () => {
    it("S1 ⛔ the refurbishment cost is NOT minted as the MRR target (enrichment-loop route)", async () => {
      const graph = founderGraph();
      graph.nodes.find((n: any) => n.kind === "goal").label = "Reach £42k MRR";
      const brief = "We spent £42k on office refurbishment last year; improve recurring revenue.";
      const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
      const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");
      expect(goal.goal_threshold).toBeUndefined();
      expect(goal.goal_threshold_raw).toBeUndefined();
      expect(res.goalThresholdsMinted).toEqual([]);
      // ROUND 6: present but unbound — a candidate the user can be asked about,
      // with the reason attached; never a write.
      expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", value_user_units: 42000, unit: "£", binding: "present_unbound", reason: "stated_as_spend" });
    });

    it("S2 ⛔ the current churn level is NOT minted with NO upstream mint (the route round 4 could not cover)", async () => {
      const graph = founderGraph();
      const goalNode = graph.nodes.find((n: any) => n.id === "552bd1c0");
      goalNode.label = "Cut Churn From 5% To Zero";
      // NO pre-set quad: the projector minted nothing (zero is a word, not a digit).
      const brief = "Monthly churn is 5% today. We want to cut churn to zero.";
      const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
      const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");
      expect(goal.goal_threshold).toBeUndefined();
      expect(goal.goal_threshold_raw).toBeUndefined();
      expect(res.goalThresholdsMinted).toEqual([]);
      expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", value_user_units: 5, unit: "%", binding: "present_unbound", reason: "stated_as_current_level" });
    });

    it("S2 ⛔ …and on the v4-complete-skip route", async () => {
      const graph = founderGraph();
      graph.nodes.find((n: any) => n.id === "552bd1c0").label = "Cut Churn From 5% To Zero";
      graph.nodes.push(
        { id: "opt1", kind: "option", label: "Hire", data: { interventions: { f1: 0.9 } } },
        { id: "f1", kind: "factor", label: "Sales Spend", data: { value: 0.5 } },
      );
      const brief = "Monthly churn is 5% today. We want to cut churn to zero.";
      const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
      const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");
      expect(goal.goal_threshold_raw).toBeUndefined();
      expect(res.goalThresholdsMinted).toEqual([]);
      expect(res.goal_target_candidate).toMatchObject({ goal_node_id: "552bd1c0", binding: "present_unbound", reason: "stated_as_current_level" });
    });

    it("S18/S19/S20 ⛔ Codex's cases through BOTH routes, with the projector's stated provenance on the goal — round 6: NOTHING mints; the candidate carries the binding", async () => {
      // `governed` = the helper would have minted before round 6; it is now a
      // suggestion the user is asked about. `present_unbound` = the figure is
      // in the brief but the user's words do not bind it. Either way the node
      // is untouched: the rejected proposal (S20) can no longer be written as
      // the user's target, and neither can anything else on this route.
      const cases: Array<[label: string, brief: string, binding: "governed" | "present_unbound"]> = [
        ["Reach £64k MRR", "For ARR, we want to reach £64k.", "present_unbound"],
        ["Reach £64k ARR", "For ARR, we want to reach £64k.", "governed"],
        ["Reach £64k MRR", "We want to increase MRR by £64k.", "present_unbound"],
        ["Reach £64k MRR", "We want to increase MRR to £64k.", "governed"],
        ["Reach £64k MRR", "We rejected the proposal to reach £64k MRR.", "governed"],
        ["Reach £64k MRR", "We approved the proposal to reach £64k MRR.", "governed"],
      ];
      for (const [label, brief, binding] of cases) {
        for (const skipRoute of [false, true]) {
          const graph = founderGraph();
          const goalNode = graph.nodes.find((n: any) => n.id === "552bd1c0");
          goalNode.label = label;
          goalNode.provenance = { provenance_class: "stated", source_quote: brief };
          if (skipRoute) {
            graph.nodes.push(
              { id: "opt1", kind: "option", label: "Hire", data: { interventions: { f1: 0.9 } } },
              { id: "f1", kind: "factor", label: "Sales Spend", data: { value: 0.5 } },
            );
          }
          const res = await enrichGraphWithFactorsAsync(graph, brief, { minConfidence: 0.6 });
          const goal: any = res.graph.nodes.find((n: any) => n.id === "552bd1c0");
          const tag = `${label} / ${brief} / ${skipRoute ? "skip" : "loop"}`;
          expect(goal.goal_threshold_raw, tag).toBeUndefined();
          expect(goal.goal_threshold, tag).toBeUndefined();
          expect(res.goalThresholdsMinted, tag).toEqual([]);
          expect(res.goal_target_candidate, tag).toMatchObject({ goal_node_id: "552bd1c0", value_user_units: 64_000, unit: "£", binding });
        }
      }
    });

    it("⭐ the user's own goal sentence, stamped by the projector, is READ by this route", async () => {
      // Inside the quote: governed candidate (the founder positive, now with its provenance).
      const inside = founderGraph();
      inside.nodes.find((n: any) => n.id === "552bd1c0").provenance = {
        source_quote: "I want to reach £30k MRR within 18 months.",
      };
      const r1 = await enrichGraphWithFactorsAsync(inside, FOUNDER_BRIEF, { minConfidence: 0.6 });
      expect(r1.goalThresholdsMinted).toEqual([]);
      expect(r1.goal_target_candidate).toMatchObject({ binding: "governed", reason: "governed" });

      // Outside the quote: the same brief, the same label, and the goal sentence
      // the user wrote is about runway — withhold.
      const outside = founderGraph();
      outside.nodes.find((n: any) => n.id === "552bd1c0").provenance = {
        source_quote: "We have £200k of runway.",
      };
      const r2 = await enrichGraphWithFactorsAsync(outside, FOUNDER_BRIEF, { minConfidence: 0.6 });
      expect(r2.goalThresholdsMinted).toEqual([]);
      const goal: any = r2.graph.nodes.find((n: any) => n.id === "552bd1c0");
      expect(goal.goal_threshold_raw).toBeUndefined();
      expect(r2.goal_target_candidate).toMatchObject({ binding: "present_unbound", reason: "outside_goal_statement" });
    });
  });
});
