/**
 * ⭐⭐⭐ THE USER'S TARGET MUST NOT BE DIVIDED BY ITS FRAME TWICE.
 *
 * ── MEASURED ON A FRESH BRIEF, DEPLOYED BUILD, 21 Sep 2026 ─────────────────
 * Brief: *"On-time delivery is running at 91% … We want to lift it to 95%
 * within the next two quarters."* The goal came back:
 *
 *     goal_threshold_raw   0.95      <- the user said 95
 *     goal_threshold_unit  "%"
 *     goal_threshold_cap   100
 *     goal_threshold       0.0095    <- 0.95%, not 95%
 *
 * **A 100x understatement of the user's own success criterion**, and it is the
 * number ISL scores against (`delta_threshold = goal_threshold - baseline`).
 *
 * ── THE MECHANISM ──────────────────────────────────────────────────────────
 * The model emitted the target ALREADY NORMALISED (`value: 0.95`) while
 * declaring `unit: "%"`, and it DECLARED the convention — the seam histogram
 * for that exact draw reads `stated_value_scale_by_kind.goal
 * {declared: 1, absent: 0}`. `applyStatedGoalTarget(node, item.value,
 * item.unit)` never receives `item.value_scale`, so it resolves a cap of 100
 * from the unit and divides a value that was already on the unit interval.
 *
 * This is the defect class increment 1 closed on FACTORS
 * (`declaration beats inference`), still live on the GOAL path. The
 * declaration existed and nothing read it.
 *
 * ── WHY `raw` MOVES TOO ────────────────────────────────────────────────────
 * `goal_threshold_raw` is documented as the raw USER magnitude, kept. When the
 * model hands over an already-normalised value, the user's magnitude is
 * `value * cap` — 95, not 0.95. Raw and threshold are minted from ONE
 * derivation so they cannot describe different denominators
 * (`graph.ts:325-330`: a threshold scored against a different denominator than
 * its baseline "does not fail — it silently returns a WRONG probability").
 *
 * ── FAIL-OPEN, AND BOTH ARMS PINNED (trap 22b) ─────────────────────────────
 * Only `unit_interval` and `ratio` declare "already a fraction". `raw_count`
 * and an ABSENT declaration keep today's arithmetic exactly, so this can only
 * correct a value the model told us was normalised — never reinterpret one it
 * did not.
 */
import { describe, it, expect } from "vitest";
import type { DraftRecordSet } from "../index.js";
import { projectRecordsToGraph } from "../projector.js";

function goalRecords(value: number, unit: string, valueScale?: string): DraftRecordSet {
  return {
    stated_items: [
      {
        kind: "goal",
        source_quote: "lift on-time delivery to 95% within the next two quarters",
        role: "target",
        value,
        unit,
        ...(valueScale !== undefined ? { value_scale: valueScale } : {}),
      },
      { kind: "option", source_quote: "lease 20 additional vans" },
      { kind: "option", source_quote: "re-route around a second hub" },
    ],
    claims: [],
  } as unknown as DraftRecordSet;
}

function goalNode(records: DraftRecordSet) {
  const { graph } = projectRecordsToGraph(records);
  const goals = graph.nodes.filter((n) => n.kind === "goal");
  expect(goals.length, "exactly one goal, or every assertion below is vacuous").toBe(1);
  return goals[0]! as unknown as Record<string, unknown>;
}

describe("a declared unit-interval target is not divided by its cap again", () => {
  it("keeps the user's 95% as a 0.95 level, not 0.0095", () => {
    const n = goalNode(goalRecords(0.95, "%", "unit_interval"));
    expect(n.goal_threshold).toBe(0.95);
  });

  it("round-trips the user's own magnitude on raw", () => {
    const n = goalNode(goalRecords(0.95, "%", "unit_interval"));
    expect(n.goal_threshold_raw).toBe(95);
  });

  it("treats a declared ratio the same way", () => {
    const n = goalNode(goalRecords(0.95, "%", "ratio"));
    expect(n.goal_threshold).toBe(0.95);
    expect(n.goal_threshold_raw).toBe(95);
  });

  // ── the twins: today's arithmetic must survive untouched ────────────────
  it("leaves a declared raw_count exactly as it is today", () => {
    const n = goalNode(goalRecords(95, "%", "raw_count"));
    expect(n.goal_threshold_raw).toBe(95);
    expect(n.goal_threshold).toBe(0.95);
  });

  it("leaves an UNDECLARED target exactly as it is today — fail open", () => {
    const n = goalNode(goalRecords(95, "%"));
    expect(n.goal_threshold_raw).toBe(95);
    expect(n.goal_threshold).toBe(0.95);
  });

  it("refuses a declaration that contradicts its own magnitude — resolves to today's behaviour", () => {
    // 95 is not on the unit interval whatever the label says. Same precedent as
    // the factor path: a contradiction resolves to UNDECLARED, never to a side.
    const n = goalNode(goalRecords(95, "%", "unit_interval"));
    expect(n.goal_threshold_raw).toBe(95);
    expect(n.goal_threshold).toBe(0.95);
  });

  it("keeps the cap and its provenance in step with the threshold", () => {
    const n = goalNode(goalRecords(0.95, "%", "unit_interval"));
    expect(n.goal_threshold_cap).toBe(100);
    expect(n.goal_threshold_unit).toBe("%");
    expect(n.goal_threshold_frame).toBe("level");
  });
});
