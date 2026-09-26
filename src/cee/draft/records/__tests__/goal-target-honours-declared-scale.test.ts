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

  it("refuses a unit_interval declaration above 1 — it contradicts its own domain", () => {
    const n = goalNode(goalRecords(95, "%", "unit_interval"));
    expect(n.goal_threshold_raw).toBe(95);
    expect(n.goal_threshold).toBe(0.95);
  });

  it("keeps the cap and its provenance in step with the threshold", () => {
    const n = goalNode(goalRecords(0.95, "%", "unit_interval"));
    expect(n.goal_threshold_cap).toBe(100);
    expect(n.goal_threshold_unit).toBe("%");
    expect(n.goal_threshold_frame).toBe("level");
    expect(n.goal_threshold_cap_provenance).toBe("metric_scale");
  });
});

/**
 * ⛔⛔ THE ROWS THE FIRST VERSION OF THIS FIX BROKE.
 *
 * An adversarial review measured them; they are kept verbatim as the corpus,
 * because they came from outside this author's head and the author's own spec
 * was 7/7 green while every one of them was wrong (trap 22c).
 *
 * `resolveGoalThresholdCapWithProvenance` returns `cap = 100` ONLY for
 * `unit === "%"`. Every other unit falls to `target_derived_headroom`,
 * `cap = raw * 1.25`, and v1 wrote `raw = value * cap` there — i.e.
 * `value² × 1.25`. That is not a rounding matter: `goal-threshold-cap.ts`
 * records that on this rule the threshold is the CONSTANT 0.8 and **the user's
 * figure survives only in `goal_threshold_raw`**, so corrupting raw destroys
 * the sole carrier. `formatGoalTargetNotSavedText` rendered "your previous
 * target of 0.2205share"; `projectGoalTargetRecord` is `model_facing: true`.
 *
 * These are not corner cases: `instruction.ts:375` DIRECTS the no-unit shape,
 * and `display-value.ts:617` records `{value: 0.4, unit: "share"}` as a
 * live-measured emission.
 */
describe("a cap derived FROM the target is not a frame — those rows must not move", () => {
  const untouched: ReadonlyArray<readonly [string, number, string | undefined, string]> = [
    ["no unit, unit_interval", 0.95, undefined, "unit_interval"],
    ["share, unit_interval", 0.42, "share", "unit_interval"],
    ["GBP, unit_interval", 0.6, "GBP", "unit_interval"],
    ["no unit, ratio", 0.9, undefined, "ratio"],
    ["percent (spelled out), unit_interval", 0.95, "percent", "unit_interval"],
  ];

  for (const [name, value, unit, scale] of untouched) {
    it(`leaves raw as the emitted value: ${name}`, () => {
      const n = goalNode(goalRecords(value, unit as string, scale));
      expect(n.goal_threshold_raw).toBe(value);
    });

    it(`keeps target_derived_headroom truthful: ${name}`, () => {
      const n = goalNode(goalRecords(value, unit as string, scale));
      if (n.goal_threshold_cap_provenance === "target_derived_headroom") {
        expect(n.goal_threshold_cap).toBeCloseTo((n.goal_threshold_raw as number) * 1.25, 12);
      }
    });
  }
});

/**
 * ⛔ AND THE CLASS `ratio` EXISTS FOR, which v1's shared `value <= 1` guard
 * excluded. The contract: "a ratio that can meaningfully exceed 100% (NRR,
 * growth, ROI). Admissible [0, +inf); 1.0 is parity." A ratio above 1 is its
 * NORMAL value, not a contradiction — so the 100-fold understatement this file
 * exists to close was still live on exactly that case.
 */
describe("a ratio may exceed parity", () => {
  it("frames NRR 120% as 1.2, not 0.012", () => {
    const n = goalNode(goalRecords(1.2, "%", "ratio"));
    expect(n.goal_threshold).toBe(1.2);
    expect(n.goal_threshold_raw).toBe(120);
  });
});
