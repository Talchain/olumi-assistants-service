/**
 * ⭐⭐ AN EXPLICIT `strength_mean: 0` SURVIVES THE FACTOR→GOAL SPLIT VERBATIM.
 *
 * ── WHY THIS IS PINNED ────────────────────────────────────────────────────
 * `fixFactorGoalEdges` splits every `factor → goal` edge into
 * `factor → outcome → goal` and fills the gaps from hardcoded defaults
 * (`?? 0.5`, `?? 0.15`, `?? 0.9`, `effect_direction ?? "positive"`). A producer
 * that wants to mint a bridge WITHOUT asserting a causal magnitude therefore has
 * exactly one representable way to say so: send `strength_mean: 0`, and rely on
 * `??` not firing on zero.
 *
 * That is not a stylistic preference. A bare bridge — one with no magnitude —
 * comes out of this function as a fully-numeric POSITIVE causal path that nobody
 * authored. On a COST dimension that is the model's own sign inverted, and the
 * option that costs MORE pushes the goal HARDER: a confident lie, strictly worse
 * than an omission.
 *
 * ⛔ THE PROPERTY IS LOAD-BEARING AND WAS PINNED NOWHERE. `?? 0.5` → `|| 0.5` is
 * a ONE-CHARACTER change — the kind a lint rule or a tidy-up makes — and it
 * silently converts every deliberate zero back into a moderate causal claim.
 * Nothing else in the suite would go red. `strengthBand(0)` is `'negligible'`
 * and is explicitly NOT interchangeable with absent (`edge-format.ts`), so the
 * distinction this test pins is one the codebase already says it makes.
 *
 * ── THE DISCRIMINATION ────────────────────────────────────────────────────
 * The two cases are an opposite-direction PAIR on the same graph shape, because
 * a predicate here guards two harms that cannot share a window:
 *   · ZERO  must be CARRIED   — else a deliberate non-assertion becomes a claim.
 *   · ABSENT must be DEFAULTED — else the safety net stops supplying numerics.
 * A change that collapsed everything to 0 would satisfy the first and break the
 * second; a change from `??` to `||` does the reverse. Only the pair sees both.
 *
 * Each case asserts its OWN PRECONDITION (`splitCount === 1`) before reading the
 * limb, so neither can pass by the split silently not happening.
 */
import { describe, expect, it } from "vitest";

import { fixFactorGoalEdges } from "../deterministic-sweep.js";
import { detectEdgeFormat } from "../../../utils/edge-format.js";

interface TestNode { id: string; kind: string; label?: string; category?: string }
interface TestGraph {
  version: string;
  default_seed: number;
  nodes: TestNode[];
  edges: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

const graphOf = (nodes: TestNode[], edges: Record<string, unknown>[]): TestGraph => ({
  version: "1",
  default_seed: 42,
  nodes,
  edges,
  meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
});

const format = (g: TestGraph) => detectEdgeFormat(g.edges as never);

/** The factor→outcome limb, bound by IDENTITY (both endpoints), never by position. */
const factorLimb = (g: TestGraph) =>
  g.edges.find((e) => e.from === "fac_cost" && e.to === "out_fac_cost_impact");

const gapGraph = (costEdge: Record<string, unknown>) =>
  graphOf(
    [
      { id: "fac_cost", kind: "factor", label: "Annual Staffing Cost", category: "controllable" },
      { id: "goal_1", kind: "goal", label: "Grow ARR" },
    ],
    [{ from: "fac_cost", to: "goal_1", ...costEdge }],
  );

describe("fixFactorGoalEdges — an explicit zero is a statement, not an absence", () => {
  it("CARRIES `strength_mean: 0` onto the factor limb instead of defaulting it to 0.5", () => {
    const graph = gapGraph({
      strength_mean: 0,
      strength_std: 0.15,
      belief_exists: 0.9,
      effect_direction: "positive" as const,
    });

    const result = fixFactorGoalEdges(graph as never, format(graph));

    // PRECONDITION, asserted in-test: if the split did not fire, the limb below
    // would be undefined and an `toBe(0)` on nothing would be vacuous.
    expect(result.splitCount).toBe(1);

    const limb = factorLimb(graph);
    expect(limb).toBeDefined();
    // ⭐ THE PIN. Under `|| 0.5` this reads 0.5 and the test REDs.
    expect(limb?.strength_mean).toBe(0);
  });

  it("still DEFAULTS an absent strength to 0.5 — the safety net is not disarmed", () => {
    // The opposite-direction twin. Without it, a change that forced every limb to
    // zero would pass the case above while silently removing the numerics this
    // repair exists to supply.
    const graph = gapGraph({
      strength_std: 0.15,
      belief_exists: 0.9,
      effect_direction: "positive" as const,
    });

    const result = fixFactorGoalEdges(graph as never, format(graph));
    expect(result.splitCount).toBe(1);

    const limb = factorLimb(graph);
    expect(limb).toBeDefined();
    expect(limb?.strength_mean).toBe(0.5);
  });
});
