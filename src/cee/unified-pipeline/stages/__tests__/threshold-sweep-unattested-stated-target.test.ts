/**
 * ⭐⭐ A STATED TARGET THAT NO ONE ATTESTED IS STRIPPED BY THE HEURISTIC.
 *
 * Step 1 of the goal/guardrail capability: trace a valued goal past the
 * projector, through the real Stage 4b sweep. Derived at the bytes:
 *
 *   · `threshold-sweep.ts:139` keeps a threshold when `attested.has(node.id)`;
 *   · `attested` is populated ONLY from `ctx.enricherMintedGoalIds`
 *     (`stages/enrich.ts:44` ← `factor-extraction/enricher.ts:1171`);
 *   · the RECORDS projector mints the same five fields at a DIFFERENT site,
 *     `draft/records/projector.ts::applyStatedGoalTarget`, and registers
 *     nothing into `goalThresholdsMinted`.
 *
 * So the provenance keep — added because the heuristic "deleted a target the
 * USER supplied" — covers one mint site and not the other. The heuristic fires
 * on `Number.isInteger(raw) || raw % 5 === 0` with a digit-free label, which is
 * the ordinary shape of a stated target (£20k, £3m, 90%) beside an AUTHORED
 * goal label — and authoring digit-free labels is what the projector's sibling
 * work exists to do.
 *
 * ⚠⚠ WHAT THIS DOES NOT CLAIM. It does NOT claim the live pricing draft took
 *    this path. The unified pipeline does not import the records projector, so
 *    whether a projector-minted threshold ever reaches this sweep is UNESTABLISHED
 *    from banked evidence, and the raw preimage is absent. This pins the sweep's
 *    behaviour for that input shape; it does not locate the live loss, and I am
 *    not repairing a composition I cannot show occurs.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from "vitest";

import { runStageThresholdSweep } from "../threshold-sweep.js";

/** The projector's five fields, as `applyStatedGoalTarget` mints them. */
function statedTargetGoal(label: string): Record<string, unknown> {
  return {
    id: "goal-1",
    kind: "goal",
    label,
    goal_threshold_raw: 20000,
    goal_threshold_unit: "£",
    goal_threshold_cap: 100000,
    goal_threshold: 0.2,
    goal_threshold_frame: "level",
  };
}

async function sweep(
  goal: Record<string, unknown>,
  attested: string[],
): Promise<Record<string, unknown>> {
  const ctx = {
    graph: { nodes: [goal], edges: [] },
    enricherMintedGoalIds: new Set(attested),
  } as never;
  await runStageThresholdSweep(ctx);
  return goal;
}

describe("Stage 4b and a target minted outside the enricher", () => {
  it("⭐ UNATTESTED + round + digit-free label: the stated target is STRIPPED", async () => {
    const goal = await sweep(statedTargetGoal("Grow monthly recurring revenue"), []);
    expect(goal["goal_threshold_raw"]).toBeUndefined();
    expect(goal["goal_threshold"]).toBeUndefined();
  });

  it("ATTESTED: the same input survives — the keep exists and works", async () => {
    // Positive control for the carve-out, so the case above is the ATTESTATION
    // difference and not a sweep that deletes everything.
    const goal = await sweep(statedTargetGoal("Grow monthly recurring revenue"), ["goal-1"]);
    expect(goal["goal_threshold_raw"]).toBe(20000);
    expect(goal["goal_threshold"]).toBe(0.2);
  });

  it("A DIGIT IN THE LABEL also survives — the heuristic needs both conditions", async () => {
    const goal = await sweep(statedTargetGoal("Reach £20k MRR within 12 months"), []);
    expect(goal["goal_threshold_raw"]).toBe(20000);
  });
});
