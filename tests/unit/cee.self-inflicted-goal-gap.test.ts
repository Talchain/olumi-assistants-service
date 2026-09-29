/**
 * ROADMAP goalfence — THE PIPELINE INVENTED THE GOAL, THEN REJECTED THE DRAFT
 * FOR NOT REACHING IT.
 *
 * ── WHAT THESE TESTS BIND TO ───────────────────────────────────────────────
 * The invariants below are written against the SPEC — *"a block is
 * self-inflicted iff the unreached goal is one WE minted with no content, and
 * the ONLY thing wrong is reaching it"* — NOT against the failure mode that
 * produced this lane. That distinction is the point: a corpus written from the
 * symptom ("short pricing briefs 500") would pass while the predicate was wrong
 * about every other input, and would share the code's blind spots exactly.
 *
 * ⭐ EVERY REFUSAL CASE HAS AN OPPOSITE-DIRECTION ADMIT TWIN, and vice versa.
 * A guard that only ever proves "we correctly refuse" cannot tell a correct
 * fence from a fence that never fires; a guard that only proves "we correctly
 * admit" cannot tell a narrow fence from a blanket one. Both harms are live
 * here — a fence that never fires leaves the 500s, and a fence that is too wide
 * routes a genuinely broken draft into a question about the user's goal.
 */

import { describe, it, expect } from "vitest";
import {
  isSelfInflictedGoalGap,
  hasContentlessMintedGoal,
  GOAL_CONNECTIVITY_CODES,
} from "../../src/cee/unified-pipeline/stages/repair/self-inflicted-goal-gap.js";
import { DEFAULT_GOAL_LABEL } from "../../src/cee/structure/goal-inference.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ---------------------------------------------------------------------------
// Fixtures — built from the PRODUCER's own constant, never a copied string.
// ---------------------------------------------------------------------------

/** A graph whose goal is the contentless placeholder CEE mints for itself. */
function graphWithMintedGoal(extra: Record<string, unknown> = {}): GraphT {
  return {
    nodes: [
      { id: "decision_1", kind: "decision", label: "Pro plan price" },
      { id: "opt_1", kind: "option", label: "Raise to £59" },
      {
        id: "goal_inferred",
        kind: "goal",
        label: DEFAULT_GOAL_LABEL,
        provenance: { provenance_class: "projector_structural", source: "synthetic" },
        ...extra,
      },
    ],
    edges: [],
  } as unknown as GraphT;
}

/** A graph whose goal came from the user's own words. */
function graphWithStatedGoal(): GraphT {
  return {
    nodes: [
      { id: "decision_1", kind: "decision", label: "Pro plan price" },
      { id: "opt_1", kind: "option", label: "Raise to £59" },
      {
        id: "9ec6e2cf",
        kind: "goal",
        label: "Maximise Annual Recurring Revenue Over the Next 12 Months",
        source_quote: "maximise annual recurring revenue over the next 12 months",
        provenance: { provenance_class: "stated" },
      },
    ],
    edges: [],
  } as unknown as GraphT;
}

describe("GOAL_CONNECTIVITY_CODES", () => {
  it("holds exactly the two codes the captured failures ever carried", () => {
    // Bound to the measurement: across 11 captured failures on build 2212ae0
    // the blocking multiset was only ever NO_PATH_TO_GOAL / NO_EFFECT_PATH.
    expect([...GOAL_CONNECTIVITY_CODES].sort()).toEqual([
      "NO_EFFECT_PATH",
      "NO_PATH_TO_GOAL",
    ]);
  });
});

describe("hasContentlessMintedGoal", () => {
  it("ADMITS the placeholder goal CEE mints when a brief designates no objective", () => {
    expect(hasContentlessMintedGoal(graphWithMintedGoal())).toBe(true);
  });

  // ── TWIN of the case above: a real goal must never read as ours. ──────────
  it("REFUSES a goal derived from the user's own words", () => {
    expect(hasContentlessMintedGoal(graphWithStatedGoal())).toBe(false);
  });

  /**
   * ⚠ THE CASE THE LABEL CHECK ALONE WOULD GET WRONG.
   *
   * `MINTED_GOAL_PROVENANCE` badges BOTH limbs of `ensureGoalNode` identically
   * — the regex-derived label and the pure placeholder — so provenance cannot
   * discriminate, and the label can be reproduced by a user who types it. What
   * separates "we invented this" from "the user said this" is the verbatim.
   * A user who writes this sentence has STATED it, and their draft must keep
   * failing loudly rather than being quietly re-routed into a question they
   * have already answered.
   */
  it("REFUSES a node carrying the placeholder label when the user's verbatim is present (top level)", () => {
    expect(
      hasContentlessMintedGoal(
        graphWithMintedGoal({ source_quote: "achieve the best outcome for this decision" }),
      ),
    ).toBe(false);
  });

  it("REFUSES a node carrying the placeholder label when the user's verbatim is nested on provenance", () => {
    expect(
      hasContentlessMintedGoal({
        nodes: [
          {
            id: "goal_inferred",
            kind: "goal",
            label: DEFAULT_GOAL_LABEL,
            provenance: {
              provenance_class: "stated",
              source_quote: "achieve the best outcome for this decision",
            },
          },
        ],
        edges: [],
      } as unknown as GraphT),
    ).toBe(false);
  });

  it("treats a blank verbatim as no verbatim — whitespace is not the user's words", () => {
    expect(hasContentlessMintedGoal(graphWithMintedGoal({ source_quote: "   " }))).toBe(true);
  });

  /**
   * ⭐⭐ THE CLASS THIS CORPUS ORIGINALLY MISSED, AND A SURVIVING MUTANT FOUND IT.
   *
   * Deleting the `label !== DEFAULT_GOAL_LABEL` conjunct left the whole suite
   * GREEN — which said the label was doing no discriminating work. It is:
   * `ensureGoalNode`'s REGEX limb (`goal-inference.ts:375-381`) mints a goal
   * with a CONTENTFUL label derived from the brief — "Increase Revenue" — and
   * badges it with the very same `MINTED_GOAL_PROVENANCE`, so it carries NO
   * `source_quote` either. Every case in the first corpus separated the two
   * classes by verbatim alone, so the label check was untested.
   *
   * That goal HAS content. Nodes can connect to it, so a block on such a graph
   * is a genuine topology failure, NOT the pipeline punishing the user for its
   * own placeholder — and fencing it would route a real defect into a question
   * about a goal the user's own words already produced.
   *
   * (Trap 22: a corpus drawn from the author's head cannot see the class the
   * author did not imagine. The mutant saw it.)
   */
  it("REFUSES a CEE-minted goal whose label was derived from the brief and HAS content", () => {
    expect(
      hasContentlessMintedGoal({
        nodes: [
          {
            // Same id, same badge, same absent verbatim as the placeholder —
            // the LABEL is the only thing that separates them.
            id: "goal_inferred",
            kind: "goal",
            label: "Increase Revenue",
            provenance: { provenance_class: "projector_structural", source: "synthetic" },
          },
        ],
        edges: [],
      } as unknown as GraphT),
    ).toBe(false);
  });

  it("REFUSES a graph with no goal — MISSING_GOAL owns that failure", () => {
    expect(
      hasContentlessMintedGoal({
        nodes: [{ id: "opt_1", kind: "option", label: "Raise to £59" }],
        edges: [],
      } as unknown as GraphT),
    ).toBe(false);
  });

  it("REFUSES a multi-goal graph — not the shape this was measured on", () => {
    expect(
      hasContentlessMintedGoal({
        nodes: [
          { id: "g1", kind: "goal", label: DEFAULT_GOAL_LABEL },
          { id: "g2", kind: "goal", label: DEFAULT_GOAL_LABEL },
        ],
        edges: [],
      } as unknown as GraphT),
    ).toBe(false);
  });

  it("REFUSES an absent or malformed graph rather than throwing", () => {
    expect(hasContentlessMintedGoal(undefined)).toBe(false);
    expect(hasContentlessMintedGoal({} as unknown as GraphT)).toBe(false);
  });
});

describe("isSelfInflictedGoalGap", () => {
  it("ADMITS the measured failure shape: minted goal, goal-connectivity codes only", () => {
    expect(
      isSelfInflictedGoalGap(graphWithMintedGoal(), ["NO_PATH_TO_GOAL", "NO_EFFECT_PATH"]),
    ).toBe(true);
  });

  it("ADMITS a single goal-connectivity code", () => {
    expect(isSelfInflictedGoalGap(graphWithMintedGoal(), ["NO_PATH_TO_GOAL"])).toBe(true);
    expect(isSelfInflictedGoalGap(graphWithMintedGoal(), ["NO_EFFECT_PATH"])).toBe(true);
  });

  /**
   * ⭐⭐ THE FENCE ITSELF — `every`, not `some`.
   *
   * A graph that ALSO failed a structural check has a real defect this module
   * says nothing about. Fencing it would route a genuinely broken draft into a
   * question about the user's goal and leave the actual failure unreported.
   * The block must stand whenever anything other than goal-reachability is
   * wrong — even on a graph whose goal IS ours.
   */
  it("REFUSES when ANY non-goal-connectivity code is also blocking", () => {
    expect(
      isSelfInflictedGoalGap(graphWithMintedGoal(), ["NO_PATH_TO_GOAL", "MISSING_DECISION"]),
    ).toBe(false);
    expect(
      isSelfInflictedGoalGap(graphWithMintedGoal(), ["CYCLE_DETECTED", "NO_EFFECT_PATH"]),
    ).toBe(false);
    expect(isSelfInflictedGoalGap(graphWithMintedGoal(), ["OPTION_NO_OP"])).toBe(false);
  });

  // ── TWIN: the same codes on a REAL goal are the user's problem, not ours. ─
  it("REFUSES goal-connectivity codes when the goal came from the user", () => {
    expect(
      isSelfInflictedGoalGap(graphWithStatedGoal(), ["NO_PATH_TO_GOAL", "NO_EFFECT_PATH"]),
    ).toBe(false);
  });

  /**
   * ⚠ EMPTY IS FALSE, AND `every` WOULD HAVE SAID TRUE.
   *
   * `[].every(...)` is vacuously true, so the convenient answer here is to
   * fence a block we know nothing about. Named and pinned rather than left to
   * the default — this is the one input where the safe answer and the
   * language's answer differ.
   */
  it("REFUSES an empty code set — no codes is not evidence of a goal gap", () => {
    expect(isSelfInflictedGoalGap(graphWithMintedGoal(), [])).toBe(false);
  });
});
