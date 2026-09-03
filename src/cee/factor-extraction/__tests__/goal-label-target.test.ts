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
    const r = deriveGoalTargetFromLabel(GOAL_LABEL, FOUNDER_BRIEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.unit).not.toBe("months");
    expect(r.target.value).not.toBe(18);
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
