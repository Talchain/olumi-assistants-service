/**
 * ⭐⭐ THE USER'S STATED TARGET REACHES THE GOAL'S OWN FIELD — and a DEADLINE
 * never does.
 *
 * ── THE DEFECT, MEASURED ON THE DEPLOYED BUILD ──────────────────────────────
 * 5 identical draws against `https://cee-staging.onrender.com/proxy/v5/turn` on
 * staging `50cb5d5f`, 2026-09-14, brief verbatim below. The goal node
 * `b4014d90` "Reach £20k MRR Within 12 Months" carried
 * `source_quote: "reaching £20k MRR within 12 months"` in ALL FIVE:
 *
 *     £20,000 registered as the target ............ 0 / 5
 *     no threshold at all ........................ 3 / 5   ("Target not captured")
 *     goal_threshold_raw: 12, unit "months" ...... 2 / 5   ⛔ the DEADLINE, scored
 *
 * The 2/5 also reported `goal_target_stated: true`, so the product asserted it
 * had the user's success criterion while holding a duration on a node measured
 * in £. A gap is visible; that is a confident lie wearing the same field.
 *
 * ── WHAT THESE CASES BIND TO ────────────────────────────────────────────────
 * Every assertion binds to the GOAL NODE by identity and to a NAMED field, not
 * to a count of nodes or figures. `mintedFieldCount` exists because raw · cap ·
 * normalised · frame · unit are one contract: ISL computes
 * `goal_threshold − baseline`, and a threshold scored against a different
 * denominator than its baseline "does not fail — it silently returns a WRONG
 * probability" (`graph.ts:325-330`).
 *
 * ⚠ THE DISCRIMINATION IS THE POINT, SO IT IS PINNED IN BOTH DIRECTIONS. The
 * new route fires only on an EXPLICIT `role: "target"`. #1411's `DISCUSSION
 * ONLY` and `WRONG TARGET` contrasts are `{kind:"goal", source_quote}` with NO
 * role and must keep meaning exactly what they say, so the no-role twin of the
 * positive case is asserted here rather than left to that file.
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import {
  applyGoalTargetRedirect,
  enrichGraphWithFactorsAsync,
} from "../../../factor-extraction/enricher.js";
import { soleStatedQuantityInSpan, unitIsTemporal } from "../../../factor-extraction/goal-label-target.js";
import type { GraphT } from "../../../../schemas/graph.js";

/** Verbatim — the brief driven live for the measurement in the header. */
const BRIEF =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";

/** Verbatim — the `source_quote` the deployed build put on the goal node in 5/5 draws. */
const GOAL_QUOTE = "reaching £20k MRR within 12 months";

const OPTIONS = [
  { kind: "option" as const, source_quote: "increase the Pro plan price from £49 to £59" },
  { kind: "option" as const, source_quote: "hold the Pro plan price" },
];

function project(records: DraftRecordSet, brief: string = BRIEF): Record<string, unknown> | undefined {
  const graph = projectRecordsToGraph(records, brief).graph;
  return graph.nodes.find((n) => n.kind === "goal") as Record<string, unknown> | undefined;
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

describe("the target the model put in its quote instead of its value field", () => {
  it("⭐ THE DEFECT — a goal the model marked role:target mints its own span's figure", () => {
    const goal = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, role: "target" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);

    expect(goal).toBeDefined();
    // ⭐ BOUND BY IDENTITY: this is the goal carrying the user's own quote, and
    //   the value asserted is the one inside THAT quote — not "some figure".
    expect(goal!["source_quote"] ?? (goal!["provenance"] as { source_quote?: string } | undefined)?.source_quote)
      .toContain("£20k");
    const raw = goal!["goal_threshold_raw"] as number;
    const cap = goal!["goal_threshold_cap"] as number;
    expect(raw).toBe(20000);
    expect(goal!["goal_threshold_unit"]).toBe("£");
    expect(typeof cap).toBe("number");
    // The co-mint's parts must AGREE, not merely be present.
    expect(goal!["goal_threshold"]).toBeCloseTo(raw / cap, 12);
    expect(goal!["goal_threshold_frame"]).toBe("level");
    expect(mintedFieldCount(goal)).toBe(5);
  });

  it("⛔ THE DEADLINE IS NOT THE TARGET — 12 months never reaches the field", () => {
    const goal = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, role: "target" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    // The span carries BOTH "£20k" and "12 months". The measured live defect
    // registered the second. Asserting the unit is what discriminates them —
    // `mintedFieldCount` alone would pass on either.
    expect(goal!["goal_threshold_unit"]).not.toBe("months");
    expect(goal!["goal_threshold_raw"]).not.toBe(12);
  });

  it("DISCRIMINATING TWIN — the SAME span with NO role mints nothing", () => {
    const goal = project({
      stated_items: [{ kind: "goal", source_quote: GOAL_QUOTE }, ...OPTIONS],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("DISCRIMINATING TWIN — role:baseline is a current reading, not a target", () => {
    const goal = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, role: "baseline" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("A SPAN WITH ONLY A DEADLINE mints nothing — a duration is never a target", () => {
    const brief = "Given our goal of getting there within 12 months, should we raise the Pro plan price?";
    const goal = project(
      {
        stated_items: [
          { kind: "goal", source_quote: "getting there within 12 months", role: "target" },
          { kind: "option" as const, source_quote: "raise the Pro plan price" },
          { kind: "option" as const, source_quote: "hold the Pro plan price" },
        ],
        claims: [],
      } as never,
      brief,
    );
    expect(goal).toBeDefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("TWO TARGETS IN ONE SPAN REFUSE — it never picks one (ask-don't-guess)", () => {
    const brief = "Our goal is reaching £30k MRR and 4% churn, so should we raise the Pro plan price?";
    const goal = project(
      {
        stated_items: [
          { kind: "goal", source_quote: "reaching £30k MRR and 4% churn", role: "target" },
          { kind: "option" as const, source_quote: "raise the Pro plan price" },
          { kind: "option" as const, source_quote: "hold the Pro plan price" },
        ],
        claims: [],
      } as never,
      brief,
    );
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("⭐ AN INVENTED QUOTE MINTS NOTHING — the attestation limb that is load-bearing", () => {
    // The figure £64k does not occur in the brief at all: a model that writes a
    // span the user never said gets no target. This is the limb that does the
    // work; the magnitude limb cannot discriminate here (the value was read out
    // of the very quote it is checked against) and is not relied on.
    const goal = project({
      stated_items: [
        { kind: "goal", source_quote: "reaching £64k MRR within 12 months", role: "target" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("⭐ NEGATIVE CONTROL — a brief stating NO target leaves the field empty", () => {
    const brief = "Should we increase the Pro plan price from £49 to £59 with the next feature release?";
    const goal = project(
      {
        stated_items: [
          { kind: "goal", source_quote: "increase the Pro plan price", role: "target" },
          { kind: "option" as const, source_quote: "increase the Pro plan price from £49 to £59" },
          { kind: "option" as const, source_quote: "hold the Pro plan price" },
        ],
        claims: [],
      } as never,
      brief,
    );
    expect(goal).toBeDefined();
    expect(goal!["goal_threshold_raw"]).toBeUndefined();
    expect(mintedFieldCount(goal)).toBe(0);
  });

  it("A FIGURE STATED ELSEWHERE NEVER BECOMES THE GOAL'S TARGET", () => {
    const goal = project({
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, role: "target" },
        { kind: "figure", source_quote: "increase the Pro plan price from £49 to £59", value: 59, unit: "£" },
        ...OPTIONS,
      ],
      claims: [],
    } as never);
    // The mint is bound to the goal node's OWN span: a neighbouring figure
    // cannot displace it, and 59 must not appear on the goal.
    expect(goal!["goal_threshold_raw"]).toBe(20000);
    expect(goal!["goal_threshold_raw"]).not.toBe(59);
  });
});

describe("the span reader itself", () => {
  it("returns the one non-temporal quantity in USER UNITS, and refuses on two", () => {
    expect(soleStatedQuantityInSpan(GOAL_QUOTE)).toEqual({
      value: 20000,
      unit: "£",
      matchedText: expect.stringContaining("20"),
    });
    // The percent convention is the shared one: 4, not 0.04.
    expect(soleStatedQuantityInSpan("keeping monthly churn under 4%")?.value).toBe(4);
    expect(soleStatedQuantityInSpan("reaching £30k MRR and 4% churn")).toBeUndefined();
    expect(soleStatedQuantityInSpan("getting there within 12 months")).toBeUndefined();
    expect(soleStatedQuantityInSpan("")).toBeUndefined();
    expect(soleStatedQuantityInSpan(undefined)).toBeUndefined();
  });

  it("⭐ the temporal predicate is ALIVE — it must say yes to a real time unit", () => {
    // Trap 15: a screen that cannot fire is theatre. Positive AND contrast.
    expect(unitIsTemporal("months")).toBe(true);
    expect(unitIsTemporal("years")).toBe(true);
    expect(unitIsTemporal("£")).toBe(false);
    expect(unitIsTemporal("%")).toBe(false);
    expect(unitIsTemporal(undefined)).toBe(false);
  });
});

describe("the enricher's factor route refuses a duration as the success target", () => {
  function goalOnlyGraph(): GraphT {
    return {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "g1", kind: "goal", label: "Revenue Goal" },
        { id: "d1", kind: "decision", label: "Pricing decision" },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
    } as unknown as GraphT;
  }

  /**
   * The factor shape is INJECTED, not driven from a brief, and that is forced
   * rather than chosen: measured, `extractFactors("Our target is 12 months.")`
   * returns `{label:"Target", value:12}` with NO unit, so the regex path cannot
   * produce a duration-united factor at all. The unit below is the one the
   * DEPLOYED build put on the goal node in 2/5 draws — a replayed wire shape,
   * not an invented one.
   */
  function goalTargetFactor(over: Record<string, unknown>) {
    return {
      label: "Target",
      value: 12,
      confidence: 0.9,
      factor_type: "other",
      extractionType: "explicit",
      ...over,
    } as never;
  }

  it("⛔ THE HARM — a factor denominated in MONTHS never becomes the success target", () => {
    const graph = goalOnlyGraph();
    const minted = applyGoalTargetRedirect(graph, 0, goalTargetFactor({ value: 12, unit: "months" }));
    expect(minted).toBe(false);
    const goal = graph.nodes.find((n) => n.kind === "goal");
    // The live defect, field by field: raw 12 / unit "months" / cap 15 / 0.8.
    expect(goal?.goal_threshold_raw).toBeUndefined();
    expect(goal?.goal_threshold_unit).toBeUndefined();
    expect(goal?.goal_threshold).toBeUndefined();
    expect(goal?.goal_threshold_cap).toBeUndefined();
  });

  it("⭐ THE CONTRAST TWIN — a £ target through the SAME call still mints all five", () => {
    // Without this, "refuses everything" would pass the case above.
    const graph = goalOnlyGraph();
    const minted = applyGoalTargetRedirect(graph, 0, goalTargetFactor({ value: 20000, unit: "£" }));
    expect(minted).toBe(true);
    const goal = graph.nodes.find((n) => n.kind === "goal");
    expect(goal?.goal_threshold_raw).toBe(20000);
    expect(goal?.goal_threshold_unit).toBe("£");
    expect(goal?.goal_threshold_frame).toBe("level");
    expect(typeof goal?.goal_threshold_cap).toBe("number");
  });

  it("⭐ THE POSITIVE TWIN — a non-temporal target still registers, so the route is not broken", async () => {
    const result = await enrichGraphWithFactorsAsync(goalOnlyGraph(), "Our target is 800.");
    const goal = result.graph.nodes.find((n) => n.kind === "goal");
    expect(goal?.goal_threshold_raw).toBe(800);
  });
});
