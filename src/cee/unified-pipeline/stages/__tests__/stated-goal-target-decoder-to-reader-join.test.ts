/**
 * ⭐⭐ ONE STATED TARGET, DECODER → ENRICH → SWEEP → THE ACTUAL READER.
 *
 * The bounded next proof the independent review asked for. My previous spec
 * called the bare projector and then the sweep in isolation, which (a) bypassed
 * the live decoder boundary and (b) duplicated coverage that already exists at
 * `enrich-goal-mint-on-complete-drafts.test.ts:399`. This joins the stages the
 * live path actually composes and stops at the first real loss.
 *
 *   · decoder  `draft/records/seam.ts::projectDraftRecords` — the boundary the
 *     Anthropic adapter calls (`adapters/llm/anthropic.ts:1976`), which
 *     validates the wire shape and rebuilds value/unit/role field-by-field;
 *   · `runStageEnrich` then `runStageThresholdSweep` — the real stages, in the
 *     order `unified-pipeline/index.ts:1272` runs them;
 *   · reader `compose/goal-target-receipt-guard.ts::extractPersistedGoalTarget`
 *     — the persisted-target view, deliberately NOT telemetry `has_goal_target`
 *     and not readiness, which its own source distinguishes.
 *
 * ⚠⚠ STILL NOT A NATIVE CAUSE. The raw draft-record preimage for request
 *    `3d5ce286…` is absent, so final target absence cannot distinguish an
 *    omitted or mistyped record from downstream removal, and the
 *    request-filtered log's lack of sweep events is not proof the sweep did not
 *    run. This records what the composed path does to a KNOWN-GOOD tuple; if it
 *    survives, that narrows the search rather than closing it.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from "vitest";

import { projectDraftRecords } from "../../../draft/records/seam.js";
import { runStageEnrich } from "../enrich.js";
import { runStageThresholdSweep } from "../threshold-sweep.js";
import { extractPersistedGoalTarget } from "../../../../orchestrator-v5/compose/goal-target-receipt-guard.js";

const BRIEF =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";

/** A digit-free authored label: the shape that triggers the sweep heuristic. */
const GOAL_LABEL_DIGIT_FREE = "Grow monthly recurring revenue";

const RAW_RECORDS = {
  stated_items: [
    {
      kind: "goal",
      source_quote: "reaching £20k MRR within 12 months",
      value: 20000,
      unit: "£",
      role: "target",
    },
    { kind: "option", source_quote: "increase the Pro plan price from £49 to £59" },
    { kind: "option", source_quote: "hold the Pro plan price" },
  ],
  claims: [],
};

function makeCtx(graph: unknown, brief: string): any {
  return {
    input: {},
    rawBody: {},
    request: {},
    requestId: "goal-join-test",
    opts: { schemaVersion: "v1" as const },
    start: Date.now(),
    graph,
    effectiveBrief: brief,
    rationales: [],
    draftCost: 0,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,
  };
}

describe("a stated goal target, from the decoder to the persisted-target reader", () => {
  it("⭐ the tuple is recorded at every hop, and the first loss (if any) is named", async () => {
    const decoded = projectDraftRecords(RAW_RECORDS, BRIEF);
    expect(decoded.ok, "decoder refused the record shape").toBe(true);

    const graph = (decoded as { projection: { graph: any } }).projection.graph;
    const decodedGoal = graph.nodes.find((n: any) => n.kind === "goal");
    expect(decodedGoal, "the decoder produced no goal").toBeDefined();

    // HOP 1 — after the decoder. Recorded as values, not field names.
    const afterDecoder = {
      raw: decodedGoal.goal_threshold_raw,
      cap: decodedGoal.goal_threshold_cap,
      normalised: decodedGoal.goal_threshold,
      unit: decodedGoal.goal_threshold_unit,
      frame: decodedGoal.goal_threshold_frame,
    };
    expect(afterDecoder.raw, `decoder did not bind the stated target: ${JSON.stringify(afterDecoder)}`).toBe(20000);
    expect(afterDecoder.normalised).toBeCloseTo(afterDecoder.raw / afterDecoder.cap, 12);

    // ⚠ THE DECODER'S OWN LABEL IS LEFT ALONE. My first cut overwrote it with a
    //   digit-free string to activate the sweep heuristic, and the resulting red
    //   was then a property of MY MUTATION, not of the receiving path — the
    //   independent review named that and it is right. The unmodified output is
    //   the normal-path case; the relabelled one is characterised separately
    //   below, and asserts what actually happens rather than failing the gate.
    expect(typeof decodedGoal.label).toBe("string");

    // HOP 2 — the real stages, in the order the pipeline runs them.
    const ctx = makeCtx(graph, BRIEF);
    await runStageEnrich(ctx);
    const attestedAfterEnrich = ctx.enricherMintedGoalIds?.size ?? 0;
    await runStageThresholdSweep(ctx);

    const sweptGoal = (ctx.graph as any).nodes.find((n: any) => n.kind === "goal");
    const codes = (ctx.deterministicRepairs ?? []).map((r: any) => r.code);

    // HOP 3 — the actual persisted-target reader, not telemetry, not readiness.
    const read = extractPersistedGoalTarget(ctx.graph);

    // ⚠ The assertion is the JOIN, and its message carries the evidence for
    //   whichever way it lands, so a failure names the hop rather than needing a
    //   second investigation.
    expect(
      read,
      `stated target lost between decoder and reader. attested=${attestedAfterEnrich}, ` +
        `repairs=${JSON.stringify(codes)}, swept=${JSON.stringify({
          raw: sweptGoal?.goal_threshold_raw,
          normalised: sweptGoal?.goal_threshold,
        })}`,
    ).not.toBeNull();
    expect(read!.value).toBe(20000);
    expect(read!.unit).toBe("£");
  });

  it("CONDITIONAL — a digit-free label makes the sweep strip a decoder-minted target", async () => {
    // ⚠ THIS CASE MUTATES THE GRAPH, AND SAYS SO. No producer that relabels a
    //   goal this way is exercised, so this is a boundary record, NOT evidence
    //   about the native run — whose sweep made ZERO repairs
    //   (`cee.threshold_sweep.completed`, `repair_count: 0`) and whose goal
    //   label carried digits. It asserts what the composed path DOES under that
    //   condition, so it documents the boundary instead of failing the gate.
    const decoded = projectDraftRecords(RAW_RECORDS, BRIEF);
    const graph = (decoded as { projection: { graph: any } }).projection.graph;
    const goal = graph.nodes.find((n: any) => n.kind === "goal");
    expect(goal.goal_threshold_raw).toBe(20000);

    goal.label = GOAL_LABEL_DIGIT_FREE; // the mutation, stated plainly
    const ctx = makeCtx(graph, BRIEF);
    await runStageEnrich(ctx);
    await runStageThresholdSweep(ctx);

    const codes = (ctx.deterministicRepairs ?? []).map((r: any) => r.code);
    const attested = ctx.enricherMintedGoalIds?.size ?? 0;
    // Recorded, not asserted as a defect: unattested + round + digit-free is
    // swept, which is the heuristic behaving exactly as its own contract says.
    expect(attested).toBe(0);
    expect(codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
    expect(extractPersistedGoalTarget(ctx.graph)).toBeNull();
  });

  it("CONTRAST — the decoder does not manufacture a target from a valueless record", async () => {
    const decoded = projectDraftRecords(
      {
        stated_items: [
          { kind: "goal", source_quote: "reaching £20k MRR within 12 months" },
          { kind: "option", source_quote: "increase the Pro plan price from £49 to £59" },
          { kind: "option", source_quote: "hold the Pro plan price" },
        ],
        claims: [],
      },
      BRIEF,
    );
    expect(decoded.ok).toBe(true);
    const graph = (decoded as { projection: { graph: any } }).projection.graph;

    const ctx = makeCtx(graph, BRIEF);
    await runStageEnrich(ctx);
    await runStageThresholdSweep(ctx);

    // ⚠ SCOPED HONESTLY. This previously read
    //   `read === null || read.value !== 20000`, which also passes on a
    //   DIFFERENT wrongly-acquired target — it could not distinguish "no target"
    //   from "some other target". And asserting `null` outright would be wrong
    //   too: the enricher has a legitimate brief-derived mint, so a target
    //   appearing later is not by itself unauthorised.
    //
    //   So the claim is made where it is checkable — at the DECODER, which must
    //   not manufacture a target from a record that carried no value. What any
    //   later stage legitimately mints is a different question and is not
    //   claimed here.
    const decodedGoal = graph.nodes.find((n: any) => n.kind === "goal");
    expect(decodedGoal).toBeDefined();
    expect(decodedGoal.goal_threshold_raw).toBeUndefined();
    expect(decodedGoal.goal_threshold).toBeUndefined();
  });
});
