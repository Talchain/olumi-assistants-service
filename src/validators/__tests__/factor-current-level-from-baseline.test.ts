/**
 * ⭐⭐⭐ A STATED CURRENT LEVEL IS THE FACTOR'S CURRENT LEVEL — AND IT IS NOT
 * THE FIELD THE ANALYSIS WAS READING.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * `extractFactors("… increase the Pro plan price from £49 to £59 …")` emits,
 * at staging `77d11382` and by execution:
 *
 *   { label: "Price", value: 59, baseline: 49, unit: "£",
 *     confidence: 0.95, extractionType: "explicit" }
 *
 * `value` is the TO number and `baseline` is the FROM number — the type's own
 * comment calls `value` *"Current **or proposed** value"*, two questions under
 * one name (CLAUDE.md trap 21). The records projector then frames `value`
 * (`projector.ts:3503` — `value: raw/frame`, `raw_value: raw`) and leaves
 * `baseline` alone, so the factor reaches the analysis as
 * `{ value: 0.59, raw_value: 59, baseline: 49 }`.
 *
 * The factor is therefore born AT ITS TARGET. An option raising the price to
 * £59 changes nothing; `OPTION_NO_OP` — which is correct — refuses the draft.
 * The check is right and the data is wrong.
 *
 * ── WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE (trap 13d) ──────────────
 * The property is not "a `from X to Y` price brief". It is:
 *
 *   where a factor states a level DISTINCT from the value beside it, that
 *   stated level is where the factor is today, expressed on the SAME FRAME as
 *   the value the consumer compares against.
 *
 * ── THE SCALE HAZARD IS THE POINT OF HALF THIS FILE ────────────────────────
 * `baseline` is written in the units of the `value` it was written BESIDE —
 * raw for a currency from-to (49 beside 59), already-fractional for a percent
 * one (0.85 beside 0.95). The projector reframes `value` afterwards and does
 * not touch `baseline`. Reading `baseline` without dividing by that frame
 * replaces an inverted graph with a 100×-wrong one, which is strictly worse:
 * every case below that pins a DIVISION has a twin pinning a NON-division.
 */

import { describe, it, expect } from "vitest";
import { validateGraph, readFactorBaselineLevel } from "../graph-validator.js";
import type { GraphT, NodeT } from "../../schemas/graph.js";

/** The TRUE current price on the model's 0-1 scale: £49 against a frame of 100. */
const TRUE_LEVEL = 0.49;
/** The level the corrupted factor claims to be at: the TARGET, £59. */
const TARGET_LEVEL = 0.59;

/**
 * Paul's graph with the factor AS MEASURED on 9 Sep — the target in `value`,
 * the true current level stranded in `baseline`.
 *
 * Structurally complete so a failure here is about this invariant and not a
 * malformed fixture: decision → options, options → factor, factor → outcome →
 * goal. Mirrors `option-no-op-invariant.test.ts`'s fixture deliberately, so
 * the two files disagree only about the factor's own state.
 */
function invertedGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Which option?" },
      {
        id: "opt_59",
        kind: "option",
        label: "Raise Price to £59 at Feature Launch",
        data: { interventions: { fac_price: TARGET_LEVEL } },
      },
      {
        id: "opt_hold",
        kind: "option",
        label: "Hold at £49",
        data: { interventions: { fac_price: TRUE_LEVEL } },
      },
      {
        id: "opt_54",
        kind: "option",
        label: "Raise Price to £54 (Soft Increase)",
        data: { interventions: { fac_price: 0.54 } },
      },
      {
        id: "fac_price",
        kind: "factor",
        label: "Pro Plan Monthly Price",
        category: "controllable",
        scale_frame: 100,
        observed_state: { value: TARGET_LEVEL, raw_value: 59, baseline: 49 },
        data: { value: TARGET_LEVEL, raw_value: 59, baseline: 49, extractionType: "explicit" },
      },
      { id: "outcome_1", kind: "outcome", label: "MRR" },
      { id: "goal_1", kind: "goal", label: "£20k MRR" },
    ] as NodeT[],
    edges: [
      { from: "decision_1", to: "opt_59", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_hold", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_54", strength_mean: 1, belief_exists: 1 },
      { from: "opt_59", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_hold", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_54", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  } as GraphT;
}

/** Every option id carried on an `OPTION_NO_OP` issue, in issue order. */
function noOpOptionIds(graph: GraphT): string[] {
  return validateGraph({ graph })
    .errors.filter((e) => e.code === "OPTION_NO_OP")
    .map((e) => String((e.context as { optionId?: unknown } | undefined)?.optionId));
}

/** A bare factor node carrying exactly the surfaces a case is about. */
function factorNode(fields: Record<string, unknown>): NodeT {
  return { id: "fac_price", kind: "factor", label: "Pro Plan Monthly Price", ...fields } as NodeT;
}

describe("a factor's current level comes from its stated baseline", () => {
  describe("the level itself, on the consumer's own frame", () => {
    it("resolves £49 to 0.49 from an observed_state carrying the framed target", () => {
      const level = readFactorBaselineLevel(
        factorNode({ scale_frame: 100, observed_state: { value: TARGET_LEVEL, raw_value: 59, baseline: 49 } }),
      );
      expect(level).toBeCloseTo(TRUE_LEVEL, 10);
    });

    it("is NOT the raw magnitude 49 — the 100x hazard, named", () => {
      const level = readFactorBaselineLevel(
        factorNode({ scale_frame: 100, observed_state: { value: TARGET_LEVEL, raw_value: 59, baseline: 49 } }),
      );
      expect(level).not.toBe(49);
    });

    it("recovers the frame from the {value, raw_value} pair when none is stored", () => {
      const level = readFactorBaselineLevel(
        factorNode({ observed_state: { value: TARGET_LEVEL, raw_value: 59, baseline: 49 } }),
      );
      expect(level).toBeCloseTo(TRUE_LEVEL, 10);
    });

    it("reads the baseline from `data` when the node carries no observed_state", () => {
      const level = readFactorBaselineLevel(
        factorNode({ scale_frame: 100, data: { value: TARGET_LEVEL, raw_value: 59, baseline: 49 } }),
      );
      expect(level).toBeCloseTo(TRUE_LEVEL, 10);
    });
  });

  describe("the twin: a baseline that must NOT be divided", () => {
    it("leaves an unframed currency pair in its own raw units", () => {
      // Straight off `extractFactors`, before the projector's scale pass:
      // `{value: 59, baseline: 49}` with no raw_value and no frame.
      const level = readFactorBaselineLevel(factorNode({ data: { value: 59, baseline: 49 } }));
      expect(level).toBe(49);
    });

    it("leaves a percent from-to alone — both members are already fractions", () => {
      // MEASURED: extractFactors("… from 85% to 95% …") emits
      // `{value: 0.95, baseline: 0.85, unit: "%"}` — one scale, no frame.
      const level = readFactorBaselineLevel(
        factorNode({ observed_state: { value: 0.95, baseline: 0.85, unit: "%" } }),
      );
      expect(level).toBe(0.85);
    });

    it("leaves a goal-stamp shape alone, where baseline EQUALS value in model units", () => {
      // `add-constraint.ts:906` and `schema-v3.ts:354` write
      // `{value: B, baseline: B, raw_value: rawB}` — model units, and a frame
      // IS recoverable from that pair. Dividing here would be the 100x error.
      const level = readFactorBaselineLevel(
        factorNode({ observed_state: { value: TRUE_LEVEL, baseline: TRUE_LEVEL, raw_value: 49 } }),
      );
      expect(level).toBe(TRUE_LEVEL);
    });
  });

  describe("no baseline: today's behaviour, unchanged", () => {
    it("reads observed_state.value over data.value", () => {
      const level = readFactorBaselineLevel(
        factorNode({ observed_state: { value: 0.42 }, data: { value: 0.11 } }),
      );
      expect(level).toBe(0.42);
    });

    it("falls back to data.value when there is no observed_state", () => {
      expect(readFactorBaselineLevel(factorNode({ data: { value: 0.11 } }))).toBe(0.11);
    });

    it("returns undefined when neither surface carries a number", () => {
      expect(readFactorBaselineLevel(factorNode({ data: { unit: "£" } }))).toBeUndefined();
    });

    it("ignores a non-finite baseline and keeps today's answer", () => {
      const level = readFactorBaselineLevel(
        factorNode({ observed_state: { value: 0.42, baseline: Number.NaN } }),
      );
      expect(level).toBe(0.42);
    });
  });

  describe("the refusal Paul is hitting", () => {
    it("does NOT flag the option that raises the price to £59 — BY ID", () => {
      expect(noOpOptionIds(invertedGraph())).not.toContain("opt_59");
    });

    it("flags the option that HOLDS at £49 instead — BY ID, and only it", () => {
      // The discrimination, not just the absence: with the true level resolved
      // the no-op is the arm that keeps the price where it is, which is what
      // the invariant is for.
      expect(noOpOptionIds(invertedGraph())).toEqual(["opt_hold"]);
    });

    it("binds to THIS factor: moving only the baseline moves only the verdict", () => {
      // The reader-presence guard. `baseline` was a written field with no
      // production reader of the factor's current level — a silent lie
      // factory. Change nothing but `baseline` and the verdict must move; if
      // the reader is deleted this REDs, which is the whole point.
      const at59 = invertedGraph();
      const factor = at59.nodes.find((n) => n.id === "fac_price") as NodeT & {
        observed_state: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      factor.observed_state.baseline = 59;
      factor.data.baseline = 59;
      expect(noOpOptionIds(at59)).toEqual(["opt_59"]);
      expect(noOpOptionIds(invertedGraph())).toEqual(["opt_hold"]);
    });
  });
});
