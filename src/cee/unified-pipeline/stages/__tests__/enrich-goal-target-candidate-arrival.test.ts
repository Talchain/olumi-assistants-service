/**
 * ROUND 6 (CEE #1328) — THE CANDIDATE ARRIVES WHERE ITS ONE READER LOOKS.
 *
 * The goal-label route no longer writes `goal_threshold`; it yields a
 * candidate that the orchestration seam turns into an `elicit_goal_target`
 * question. That seam reads `ctx.goal_target_candidate` and nothing else.
 *
 * ⚠ WHY THIS TEST IS THE DELIVERABLE. `runStageEnrich` copies named fields off
 * the enricher's result and DISCARDS the rest — it has dropped the enricher's
 * `warnings` since the day it was written. A candidate the enricher emits and
 * the stage does not carry is indistinguishable, at the consumer, from "the
 * ask did not fire" (CLAUDE.md hazards 1–2, one hop earlier). So arrival is
 * asserted at the stage, on production-shaped input, with a NEGATIVE twin so
 * "nothing arrives" cannot pass by nothing ever being produced.
 */
import { describe, expect, it } from "vitest";

import { runStageEnrich } from "../enrich.js";

/** The real pricing brief the served projector missed on 11 and 14 Sep 2026 (exports 5b41f0eb, 34bb09e9). */
const BRIEF_WITH_FIGURE =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";
/** The same decision, no figure anywhere: a label figure would be a model invention. */
const BRIEF_WITHOUT_FIGURE =
  "We want to grow recurring revenue over the next year while keeping churn low. Should we increase the Pro plan price with the next Pro feature release?";

/**
 * A DRAFT-SHAPED graph: every option carries valued interventions, so the
 * enricher's complete-V4 skip fires — the shape production actually produces
 * (see enrich-goal-mint-on-complete-drafts.test.ts for why that matters).
 */
function draftShapedGraph(goalLabel: string): Record<string, unknown> {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_mrr", kind: "goal", label: goalLabel },
      { id: "d1", kind: "decision", label: "Pro plan pricing" },
      { id: "f_price", kind: "factor", label: "Pro Plan Monthly Price", category: "controllable", data: { value: 0.5, unit: "count" } },
      { id: "f_churn", kind: "factor", label: "Monthly Churn", category: "external", data: { value: 0.5, unit: "count" } },
      { id: "o1", kind: "option", label: "Raise price to £59", data: { interventions: { f_price: 0.7, f_churn: 0.5 } } },
      { id: "o2", kind: "option", label: "Hold at £49", data: { interventions: { f_price: 0.5, f_churn: 0.4 } } },
    ],
    edges: [
      { from: "d1", to: "o1" },
      { from: "d1", to: "o2" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

/** Minimal StageContext — only the fields Stage 3 (Enrich) reads. */
function makeCtx(graph: unknown, brief: string): any {
  return {
    input: {},
    rawBody: {},
    request: {},
    requestId: "test-1328-round6",
    opts: { schemaVersion: "v1" as const },
    start: Date.now(),
    graph,
    effectiveBrief: brief,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: undefined,
    confidence: undefined,
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: undefined,
    hadCycles: false,
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    structuralMeta: undefined,
    validationSummary: undefined,
  };
}

describe("round 6 — the goal-label candidate ARRIVES on the stage context, and nothing is written", () => {
  it("draft-shaped graph + a brief that states the figure ⇒ ctx.goal_target_candidate is populated, by identity and exact value", async () => {
    const ctx = makeCtx(draftShapedGraph("Reach £20k MRR Within 12 Months"), BRIEF_WITH_FIGURE);
    await runStageEnrich(ctx);

    expect(ctx.goal_target_candidate).toEqual({
      goal_node_id: "goal_mrr",
      value_user_units: 20000,
      unit: "£",
      label_span: "£20k",
      brief_span: "£20k",
      binding: "governed",
      reason: "governed",
    });
    // The write did NOT happen — the candidate is the only artefact.
    const goal = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_mrr");
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(ctx.enricherMintedGoalIds.size).toBe(0);
  });

  it("⭐ NEGATIVE TWIN: the same graph with a brief that states NO figure ⇒ ctx.goal_target_candidate is absent", async () => {
    // Without this, the case above passes just as well on a stage that copies
    // a stale or constant value; and "nothing arrives" must be distinguishable
    // from "nothing was produced".
    const ctx = makeCtx(draftShapedGraph("Reach £20k MRR Within 12 Months"), BRIEF_WITHOUT_FIGURE);
    await runStageEnrich(ctx);

    expect(ctx.goal_target_candidate).toBeUndefined();
    const goal = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_mrr");
    expect(goal.goal_threshold_raw).toBeUndefined();
  });

  it("a present-but-unbound figure arrives WITH its reason (the seam decides whether to ask)", async () => {
    const ctx = makeCtx(
      draftShapedGraph("Reach £42k MRR"),
      "We spent £42k on office refurbishment last year; improve recurring revenue. Should we raise the Pro plan price?",
    );
    await runStageEnrich(ctx);
    expect(ctx.goal_target_candidate).toMatchObject({
      goal_node_id: "goal_mrr",
      value_user_units: 42000,
      unit: "£",
      binding: "present_unbound",
      reason: "stated_as_spend",
    });
    expect((ctx.graph as any).nodes.find((n: any) => n.id === "goal_mrr").goal_threshold_raw).toBeUndefined();
  });

  it("a node that already carries a typed target yields NO candidate (first writer wins, one level up)", async () => {
    const graph: any = draftShapedGraph("Reach £20k MRR Within 12 Months");
    graph.nodes[0].goal_threshold_raw = 20000;
    graph.nodes[0].goal_threshold_unit = "£";
    const ctx = makeCtx(graph, BRIEF_WITH_FIGURE);
    await runStageEnrich(ctx);
    expect(ctx.goal_target_candidate).toBeUndefined();
    expect((ctx.graph as any).nodes.find((n: any) => n.id === "goal_mrr").goal_threshold_raw).toBe(20000);
  });
});
