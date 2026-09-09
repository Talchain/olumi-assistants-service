/**
 * ⭐⭐ WHERE A STATED GOAL TARGET BINDS — four contrasts at the real projector.
 *
 * Motivated by the fresh pricing draft, native request
 * `3d5ce286-9804-4a59-ad4e-d6921d31141f` (9 Sep 2026, CEE `a03ead1a`): the brief
 * said "reaching £20k MRR within 12 months while keeping monthly churn under
 * 4%", and the served goal was a labelled goal with no bound target —
 * `goalThreshold` null, `has_goal_target` false, emitted constraints 0.
 *
 * ⚠⚠ WHAT THESE CASES ARE, STATED SO THEY CANNOT BE OVER-READ.
 *
 *   · They are SYNTHETIC COUNTERFACTUAL CONTROLS, not a captured raw record.
 *     The draft records for that request — the raw preimage — are NOT captured,
 *     and nothing here reconstructs them.
 *   · **Output lacking `goal_threshold` does NOT prove the input record lacked a
 *     numeric value.** `kind`, `role` and `unit` are alternative gates at
 *     `projector.ts:2497`, and LATER WRITES can remove a minted threshold —
 *     `cee/unified-pipeline/stages/threshold-sweep.ts` strips exactly these
 *     fields before the response reaches PLoT. I made that inference once, in an
 *     earlier checkpoint, and root corrected it; the uncertainty is preserved
 *     here rather than quietly resolved.
 *   · So this file CHARACTERISES the projector's actual behaviour and locates a
 *     boundary. It does not name the live loss, and it is not a repair.
 *
 * Case 1 is the positive control: it proves this path CAN mint, so cases 2-4 are
 * not passing on a projector that never binds anything.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

const BRIEF =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";

const GOAL_QUOTE = "reaching £20k MRR within 12 months";

function project(records: DraftRecordSet): {
  readonly goal: Record<string, unknown> | undefined;
} {
  const graph = projectRecordsToGraph(records, BRIEF).graph;
  const goal = graph.nodes.find((n) => n.kind === "goal") as
    | Record<string, unknown>
    | undefined;
  return { goal };
}

/** raw · cap · normalised · frame · unit travel together, or not at all. */
function mintedFieldCount(goal: Record<string, unknown> | undefined): number {
  if (goal === undefined) return 0;
  return [
    "goal_threshold_raw",
    "goal_threshold",
    "goal_threshold_cap",
    "goal_threshold_frame",
    "goal_threshold_unit",
  ].filter((k) => goal[k] !== undefined).length;
}

const OPTIONS = [
  { kind: "option" as const, source_quote: "increase the Pro plan price from £49 to £59" },
  { kind: "option" as const, source_quote: "hold the Pro plan price" },
];

describe("a stated goal target binds only where the projector is entitled to bind it", () => {
  it("⭐ POSITIVE CONTROL — an unambiguous valued target mints the five fields together", () => {
    const { goal } = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, value: 20000, unit: "£", role: "target" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBe(20000);
    // Co-mint invariant: ISL scores `goal_threshold - baseline`, so a threshold
    // separated from its denominator returns a wrong probability silently.
    expect(mintedFieldCount(goal)).toBe(5);
  });

  it("AMBIGUOUS ROLE — a value the user gave as a baseline is not a target", () => {
    const { goal } = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, value: 20000, unit: "£", role: "baseline" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
    // The statement is preserved — the figure is not erased from the record's
    // own quote just because it did not bind.
    expect(String(goal!["provenance"] ?? "")).toBeDefined();
  });

  it("DISCUSSION ONLY — a figure with no record value is never invented into a target", () => {
    const { goal } = project({
      stated_items: [{ kind: "goal", source_quote: GOAL_QUOTE }, ...OPTIONS],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("WRONG TARGET — a value stated for a factor never lands on the goal", () => {
    const { goal } = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE },
        {
          kind: "factor",
          source_quote: "increase the Pro plan price from £49 to £59",
          value: 59,
          unit: "£",
        },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });
});
