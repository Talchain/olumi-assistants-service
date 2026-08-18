/**
 * THE GOAL LABEL — a concise faithful display label, verbatim kept as provenance.
 *
 * ORACLE PROVENANCE, stated so it cannot be over-read (trap 13c):
 * EXTERNAL — the defect string is the founder's own witnessed output
 *   `Compound Goal: we'd like to spend less + increase productivity, while
 *    maintaining code quality`
 *   and the two live corpus examples in
 *   `orchestrator-v5/compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/
 *    digit-bearing-replies.json:200,353`, which show the same prefix reaching real
 *   replies — one of them carrying `£59`, i.e. a real figure inside a compound goal.
 *   The `£250,000` constraint case is `live-4day-week.cold-read.json`'s, per the
 *   quality bar's measured baseline.
 * MINE — the conservation expectations, derived from the ruling's own enforceable
 *   clause ("no numeral or named quantity may be dropped from a restatement")
 *   rather than from a preference about readability.
 *
 * ⚠ WHAT THIS SUITE DOES NOT CLAIM. Nothing here asserts a label "reads well" —
 * that is not enforceable and the implementation does not pretend otherwise. It
 * also asserts nothing about which goals MERGE (quality bar §8 A3, founder's
 * call) or about authored paraphrase (§8 A7 — needs the served prompt, absent
 * from this repo).
 */

import { describe, it, expect } from "vitest";
import {
  buildCompoundGoalLabel,
  conservesQuantities,
  quantityTokens,
} from "../compound-goal-label.js";
import { enforceSingleGoal } from "../index.js";

// ───────────────────────────────────────────────────────────────────────────
// A — the witnessed defect
// ───────────────────────────────────────────────────────────────────────────

describe("A — the repair no longer announces itself in the user's goal", () => {
  it("does not emit the 'Compound Goal:' prefix for the founder's witnessed input", () => {
    const result = buildCompoundGoalLabel([
      "we'd like to spend less",
      "increase productivity, while maintaining code quality",
    ]);

    expect(result.label).not.toContain("Compound Goal");
    expect(result.label).not.toContain(" + ");
  });

  it("keeps every original objective verbatim as provenance", () => {
    const originals = [
      "we'd like to spend less",
      "increase productivity, while maintaining code quality",
    ];

    const result = buildCompoundGoalLabel(originals);

    // The ruling: exact user language preserved as PROVENANCE, not as display.
    expect(result.merged_from).toEqual(originals);
  });

  it("chooses a label from the user's own words and invents no prose", () => {
    const originals = ["we'd like to spend less", "increase productivity"];

    const result = buildCompoundGoalLabel(originals);

    // Selection, not paraphrase — the label must be composed only of clauses the
    // user actually wrote (A7: a code-only fix may not author new prose).
    for (const clause of result.label.split("; ")) {
      expect(originals).toContain(clause);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B — THE CONSERVATION RULE, both directions
// ───────────────────────────────────────────────────────────────────────────

describe("B — no numeral or named quantity may be dropped from a restatement", () => {
  it("detects the quantity classes the corpus actually contains", () => {
    expect(quantityTokens("Reach £20m ARR by End of FY28")).toContain("£20m");
    expect(quantityTokens("I want to reach £59")).toContain("£59");
    expect(quantityTokens("must not exceed £250,000")).toContain("£250000");
    expect(quantityTokens("Achieve 15% ARR Growth")).toContain("15%");
    expect(quantityTokens("Deliver 4-Day Week")).toContain("4-day");
  });

  it("A2 — conservation holds across the RECORD, not within the label", () => {
    // The live-corpus shape: first clause has no figure, second carries £59.
    // The label is free to omit `£59`; what may NOT happen is the figure leaving
    // the record. A1 keeps the exact user language as provenance, so the union of
    // label + provenance conserves it — and that union is what A2 asserts.
    const result = buildCompoundGoalLabel([
      "Our aim is to raise our average seat price",
      "I want to reach £59",
    ]);

    // Readable label, no synthesis, no join.
    expect(result.label).toBe("Our aim is to raise our average seat price");
    expect(result.label).not.toContain(";");
    // …and the figure is still in the record.
    expect(conservesQuantities(
      [result.label, ...(result.merged_from ?? [])].join(" "),
      result.merged_from!,
    )).toBe(true);
  });

  it("TWIN — a primary label that already carries every figure needs no provenance to conserve", () => {
    const result = buildCompoundGoalLabel([
      "Reach £20m ARR by End of FY28",
      "keep the team happy",
    ]);

    expect(result.label).toBe("Reach £20m ARR by End of FY28");
    // Conserves on the label ALONE — the stronger case, and it must still hold.
    expect(conservesQuantities(result.label, result.merged_from!)).toBe(true);
  });

  it("never joins labels, whatever the figures do (A3 is open — no synthesis)", () => {
    const result = buildCompoundGoalLabel([
      "cut cost",
      "reach £20m ARR",
      "hold attrition under 15%",
    ]);

    // The label is exactly one of the user's objectives, verbatim.
    expect(result.label).toBe("cut cost");
    expect(result.label).not.toContain(";");
    expect(result.label).not.toContain(" + ");
    // Every figure remains recoverable from the record.
    expect(conservesQuantities(
      [result.label, ...(result.merged_from ?? [])].join(" "),
      result.merged_from!,
    )).toBe(true);
  });

  it("conservesQuantities is FALSE when a figure is genuinely lost (the guard bites)", () => {
    // Pins the guard's own discrimination: it must be capable of returning false,
    // or every conservation assertion above passes vacuously (trap 13).
    expect(conservesQuantities("spend less", ["spend less", "reach £59"])).toBe(false);
    expect(conservesQuantities("reach £59", ["reach £59"])).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C — through the real producer, and the provenance it must stop discarding
// ───────────────────────────────────────────────────────────────────────────

describe("C — enforceSingleGoal", () => {
  function twoGoalGraph(): any {
    return {
      nodes: [
        {
          id: "goal_a",
          kind: "goal",
          label: "Our aim is to raise our average seat price",
        },
        {
          id: "goal_b",
          kind: "goal",
          label: "I want to reach £59",
          goal_threshold: { unit: "£", value: 59, operator: ">=" },
        },
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_x", kind: "option", label: "Option" },
      ],
      edges: [{ from: "dec_x", to: "opt_x", edge_type: "structural" }],
    };
  }

  it("produces a label carrying no repair prefix and no ' + ' join", () => {
    const { graph } = enforceSingleGoal(twoGoalGraph() as any)!;
    const goal = (graph as any).nodes.find((n: any) => n.id === "goal_a");

    expect(goal.label).not.toContain("Compound Goal");
    expect(goal.label).not.toContain(" + ");
  });

  it("does NOT discard the merged-away goal's threshold quad", () => {
    // The quality bar's HARD rule. Before, the merged-away node was filtered out
    // entirely and its `goal_threshold` went with it.
    //
    // ⚠ THE ASSERTION'S INTENT IS UNCHANGED; ITS CARRIER MOVED, because the old
    // one never delivered. This used to read the quad off `merged_goals` — a key
    // `GraphV3` STRIPS, with zero product readers, so the quad was "preserved"
    // into a field nothing could ever see. Under §8 A3 the merged-away objective
    // survives as its own OUTCOME NODE, which does cross the wire, so the quad is
    // asserted there. Re-pointing an honest assertion at the mechanism that now
    // delivers it is not the same as relaxing it: this test still fails if the
    // quad is dropped, and it now fails for a reason a user would notice.
    const { graph } = enforceSingleGoal(twoGoalGraph() as any)!;

    // Bound by IDENTITY — the specific merged goal, not "some node with a threshold".
    const preserved = (graph as any).nodes.find((n: any) => n.id === "goal_b");
    expect(preserved).toBeDefined();
    expect(preserved.kind).toBe("outcome");
    expect(preserved.goal_threshold).toEqual({ unit: "£", value: 59, operator: ">=" });
    expect(preserved.label).toBe("I want to reach £59");
  });

  it("TWIN — a single-goal graph is untouched (no merge, no provenance, no prefix)", () => {
    const single = {
      nodes: [
        { id: "goal_a", kind: "goal", label: "Reach £20m ARR by End of FY28" },
        { id: "dec_x", kind: "decision", label: "Decision" },
      ],
      edges: [],
    };

    const { graph, hadMultipleGoals } = enforceSingleGoal(single as any)!;
    const goal = (graph as any).nodes.find((n: any) => n.id === "goal_a");

    expect(hadMultipleGoals).toBe(false);
    expect(goal.label).toBe("Reach £20m ARR by End of FY28");
    expect(goal.merged_from).toBeUndefined();
    expect(goal.merged_goals).toBeUndefined();
  });
});
