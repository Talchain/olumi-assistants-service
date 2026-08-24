/**
 * DOES A NOUN-FORM ROW SURVIVE TO THE CEE V3 RESPONSE? — the widened success
 * condition, and the only one that is about the product.
 *
 * ⚠⚠ AN ABSENT `goal_constraints` KEY IS AMBIGUOUS, WHICH IS WHY THIS FILE
 * DRIVES THE STAGES INSTEAD OF READING THE RESPONSE.
 * `transforms/schema-v3.ts:1669-1672` attaches the array ONLY when it is
 * non-empty:
 *
 *     const v1GoalConstraints = v1Response.goal_constraints;
 *     if (Array.isArray(v1GoalConstraints) && v1GoalConstraints.length > 0) {
 *       v3Response.goal_constraints = v1GoalConstraints;
 *     }
 *
 * So `goal_constraints: []` never reaches the wire — the key is a non-empty
 * array or nothing at all, and "nothing extracted" is indistinguishable from
 * "extracted and then clobbered" to anyone reading the response. A survival
 * claim made by inspecting the wire alone cannot tell this lane's fix working
 * from this lane's fix being erased. This file therefore runs the real
 * substeps in their real order and checks the count at each hop.
 *
 * THE GATE IS NOT THIS LANE'S TO FIX. Its ambiguity is a reporting problem in
 * a different seam; it is described here so the next reader is not misled by
 * an absent key, and left alone.
 *
 * ── THE CLOBBER PATH THIS IS AIMED AT ─────────────────────────────────────
 * Substep 5 `runCompoundGoals` mints, substep 6 `runLateStrp` re-runs Rule 3
 * target normalisation against the current graph, and a Rule 3 miss produces
 * `[]`. That `[]` used to overwrite the good array, and the length gate above
 * then dropped the key from the response entirely. `late-strp.ts` now adopts
 * STRP's constraints only when non-empty and logs
 * `cee.late_strp.constraint_overwrite_prevented` otherwise.
 *
 * The noun forms are a plausible population for that miss, because a limit
 * like "£50,000 cap" names no metric of its own. This file measures whether
 * they walk into it. They do not — but the guard is asserted rather than
 * assumed, and the assertion is the count at each hop, not the guard's own
 * self-report.
 *
 * ⚠ LINE NUMBERS RE-DERIVED AT 77e2e7d9. The brief that commissioned this
 * cited `schema-v3.ts:988-991`; at this tip the gate is at :1669-1672. The
 * CONTENT of the citation was exact; the coordinates were from another branch.
 */

import { describe, expect, it } from "vitest";

import { runCompoundGoals } from "../../unified-pipeline/stages/repair/compound-goals.js";
import { runLateStrp } from "../../unified-pipeline/stages/repair/late-strp.js";
import { reconcileStructuralTruth } from "../../../validators/structural-reconciliation.js";
import { transformResponseToV3 } from "../../transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../../schemas/cee-v3.js";

/** A graph offering the two metrics the noun forms resolve to. */
function makeCtx(brief: string): any {
  return {
    requestId: "noun-form-v3-survival",
    effectiveBrief: brief,
    graph: {
      nodes: [
        { id: "goal_outcome", kind: "goal", label: "Programme outcome" },
        { id: "fac_budget", kind: "factor", label: "Budget", data: { value: 100000 } },
        { id: "fac_cost", kind: "factor", label: "Total cost", data: { value: 100000 } },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "opt_b", kind: "option", label: "Option B" },
      ],
      edges: [
        { from: "fac_budget", to: "goal_outcome" },
        { from: "fac_cost", to: "goal_outcome" },
        { from: "opt_a", to: "fac_budget" },
        { from: "opt_b", to: "fac_cost" },
      ],
    },
    goalConstraints: undefined,
  };
}

/** The real substeps, in their real order, then the real transform + parse. */
function driveToWire(brief: string) {
  const ctx = makeCtx(brief);
  runCompoundGoals(ctx);
  const afterMint = Array.isArray(ctx.goalConstraints) ? ctx.goalConstraints.length : 0;
  runLateStrp(ctx);
  const afterLateStrp = Array.isArray(ctx.goalConstraints) ? ctx.goalConstraints.length : 0;

  // `package.ts:478` is the single place ctx.goalConstraints becomes the V1
  // response field; this reproduces exactly that assignment and nothing else.
  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3(
      { graph: ctx.graph, goal_constraints: ctx.goalConstraints } as never,
      { brief },
    ),
  );
  const onWire = Array.isArray((wire as any).goal_constraints)
    ? (wire as any).goal_constraints
    : undefined;
  return { afterMint, afterLateStrp, onWire };
}

/**
 * The nine noun forms that reach the wire, with the value each must carry.
 *
 * H7 and R3 are ABSENT FROM THIS TABLE AND THAT IS THE FINDING, not an
 * oversight — see the sibling case below. `compound-goals.ts:614` sets
 * `ctx.goalConstraints = binding`, i.e. the direction gate's PROVEN rows only,
 * so a withheld row never becomes a wire row at all.
 */
const REACHES_WIRE: ReadonlyArray<{ id: string; brief: string; value: number; node: string }> = [
  { id: "H1", brief: "We are choosing a replacement supplier, with a £50,000 cap.", value: 50000, node: "fac_cost" },
  { id: "H5", brief: "We have a hard limit of £250,000 on the whole programme.", value: 250000, node: "fac_cost" },
  { id: "I3", brief: "Our budget is £50,000.", value: 50000, node: "fac_budget" },
  { id: "I4", brief: "The budget for this is £50,000, hard.", value: 50000, node: "fac_budget" },
  { id: "I8", brief: "Cost ceiling: £50,000.", value: 50000, node: "fac_cost" },
  { id: "I9", brief: "£50k max.", value: 50000, node: "fac_cost" },
  { id: "R8", brief: "Should we expand into Germany this year? The goal is to grow revenue by 20% and the budget is £500,000.", value: 500000, node: "fac_budget" },
  { id: "R9", brief: "Should we launch in Q1, hire in Q2, and expand in Q3. The goal is to grow revenue by 30% on a £1m budget.", value: 1000000, node: "fac_budget" },
  { id: "R10", brief: "Our engineering team of 12 is struggling with delivery velocity. Budget constraint: £400k annual for this initiative.", value: 400000, node: "fac_budget" },
];

describe("noun-form limits — survival to the CEE V3 response", () => {
  it("pins the table (a shrunk table voids the claim this file makes)", () => {
    expect(REACHES_WIRE).toHaveLength(9);
  });

  for (const c of REACHES_WIRE) {
    it(`${c.id}: minted, survives late-STRP, and reaches the parsed V3 wire`, () => {
      const { afterMint, afterLateStrp, onWire } = driveToWire(c.brief);

      // Hop 1 — substep 5 minted it.
      expect(afterMint, `${c.id} minted nothing`).toBeGreaterThan(0);
      // Hop 2 — substep 6 did NOT clobber it. Asserting the COUNT, not the
      // guard's own log: a guard that reports success while the row is gone is
      // the failure mode, so the count is the only honest witness.
      expect(afterLateStrp, `${c.id} clobbered by late-STRP`).toBe(afterMint);
      // Hop 3 — the key is PRESENT on the wire. Absent would be indistinguishable
      // from "nothing was ever extracted", which is exactly the ambiguity above.
      expect(onWire, `${c.id} absent from the V3 wire`).toBeDefined();
      expect(onWire!.length).toBeGreaterThan(0);

      // Bound by IDENTITY, not by "a row exists" (CLAUDE.md trap 19).
      const hit = onWire!.find(
        (r: any) => r.value === c.value && r.node_id === c.node && r.operator === "<=",
      );
      expect(
        hit,
        `${c.id}: expected <= ${c.value} on ${c.node}; wire carried ` +
          JSON.stringify(onWire!.map((r: any) => `${r.operator}${r.value}@${r.node_id}`)),
      ).toBeDefined();
    });
  }

  it("H7 and R3 do NOT reach the wire — withheld by the direction gate, reported not fixed", () => {
    // ⚠ THE ROW IS MINTED AND BOUND AND THEN DROPPED AT `compound-goals.ts:614`,
    // which assigns only the direction gate's `proven` partition. The gate's
    // negation screen is sentence-scoped, so `cannot move` / `avoid` reach a
    // noun form whose direction was never in doubt.
    //
    // Pinned as a FINDING so it cannot be mistaken for a gap in the recogniser,
    // and so it REDs the day the gate changes. Fixing it means editing the
    // 1,882-line #888 predicate — this lane's explicit stop condition.
    for (const brief of [
      "The budget of £120,000 is fixed and cannot move.",
      "There are three ways this could go wrong and the goal is to avoid downtime on a £90,000 budget.",
    ]) {
      const { onWire } = driveToWire(brief);
      expect(onWire, `unexpectedly reached the wire: ${brief}`).toBeUndefined();
    }
  });

  it("Rule 3 RESOLVES the noun-form targets — the guard is not what is saving them", () => {
    // ⚠ TWO VERY DIFFERENT HEALTHY-LOOKING OUTCOMES, AND THE COUNT CANNOT TELL
    // THEM APART. `afterLateStrp === afterMint` above holds BOTH when Rule 3
    // re-resolves the target (adopt branch) AND when Rule 3 misses, returns `[]`
    // and the overwrite guard preserves the prior array. Only the second is
    // living on borrowed time — it means the row survives because a guard
    // catches a miss, and any change to that guard drops it.
    //
    // Measured here: Rule 3 RESOLVES every noun form, so the adopt branch is
    // taken and the guard is never reached. The mechanism is not luck — by this
    // point `runCompoundGoals` has already bound each row to an EXISTING node id
    // through `remapConstraintTargets` (unbindable rows are rejected outright),
    // so Rule 3 is re-normalising an id that is already a node in the same graph.
    //
    // The concern this answers is that a limit like "£50,000 cap" names no
    // metric of its own and would therefore miss target normalisation. It does
    // not, because `resolveLimitTarget` turns a bare limiter into a real metric
    // name (`cost`, or the qualifier in "Cost ceiling") BEFORE binding — the same
    // reason it must, since `isJunkNodeId` would bin a `fac_cap` stem anyway.
    for (const c of REACHES_WIRE) {
      const ctx = makeCtx(c.brief);
      runCompoundGoals(ctx);
      const prior = ctx.goalConstraints as unknown[] | undefined;
      expect(prior?.length, `${c.id} minted nothing`).toBeGreaterThan(0);

      const nodeLabels = new Map<string, string>();
      for (const n of (ctx.graph as any).nodes) if (n.label) nodeLabels.set(n.id, n.label);
      const result = reconcileStructuralTruth(ctx.graph as any, {
        goalConstraints: prior as any,
        requestId: "noun-form-rule3",
        fillControllableData: true,
        nodeLabels,
      });

      // NON-EMPTY ⇒ the adopt branch. An empty array here would mean the row is
      // reaching the wire only because the guard caught a Rule 3 miss.
      expect(
        result.goalConstraints?.length,
        `${c.id}: Rule 3 returned [] — the row survives only via the overwrite guard`,
      ).toBe(prior!.length);
      expect(result.goalConstraints!.map((r: any) => r.node_id)).toContain(c.node);
    }
  });

  it("OPPOSITE TWIN — a brief stating no limit puts NO goal_constraints key on the wire", () => {
    // The negative half of the survival claim: if this returned a key for a
    // brief with no stated limit, every assertion above would be satisfied by
    // an extractor that fires on everything.
    const { afterMint, onWire } = driveToWire(
      "We are deciding how to deploy a £50,000 capital investment this year.",
    );
    expect(afterMint).toBe(0);
    expect(onWire).toBeUndefined();
  });
});
