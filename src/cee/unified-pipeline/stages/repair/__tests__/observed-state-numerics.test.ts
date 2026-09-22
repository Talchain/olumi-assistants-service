/**
 * THE FIRST BRIEF MUST NOT 500 BECAUSE A FACTOR CARRIES AN UNPARSEABLE
 * `observed_state`.
 *
 * ── THE DEFECT, MEASURED ON DEPLOYED STAGING `9c16e8c` ─────────────────────
 * 6 of 12 signed-in first-brief turns returned HTTP 500
 * `draft_graph_cee_graph_invalid`; an untouched 21:15–21:46Z window showed
 * 4 of 16. The server-side line was identical in all 9 captured failures:
 *   cee.structural_parse.failed · graph.nodes.<N>.observed_state · invalid_union
 * and every failing index resolved to `kind: "factor"`.
 *
 * ── WHY THESE ASSERTIONS ARE SHAPED THIS WAY ───────────────────────────────
 * The oracle is NOT this author's preference. Both members of
 * `NodeObservedState` require `value: z.number()`, so the set of factor
 * observed_states that can parse is fixed by the schema, not chosen here. Each
 * case below is a member of the set the schema REJECTS, and the control is a
 * member it ACCEPTS — so a build that deleted the normaliser fails case 1
 * while the control still passes, which is what makes the control load-bearing
 * rather than decorative.
 *
 * ⚠ SCOPE. These are pipeline-substep assertions over `runObservedStateNumerics`
 * followed by `runStructuralParse`. Nothing here claims anything about what the
 * UI renders, nor about the incidence rate on staging.
 */

import { describe, it, expect } from "vitest";
import type { StageContext } from "../../../types.js";
import { runObservedStateNumerics } from "../observed-state-numerics.js";
import { runStructuralParse } from "../structural-parse.js";

function makeCtx(nodes: Array<Record<string, unknown>>): StageContext {
  return {
    requestId: "test-observed-state-numerics",
    graph: {
      nodes: [
        { id: "goal_growth", kind: "goal", label: "Grow revenue" },
        ...nodes,
      ],
      edges: [{ id: "e1", from: "fac_cost", to: "goal_growth" }],
    },
    rationales: [],
    confidence: 0.8,
    goalConstraints: undefined,
    earlyReturn: undefined,
    opts: {},
    input: {},
    request: { headers: {} },
  } as unknown as StageContext;
}

/** Run the two substeps in the order `repair/index.ts` runs them. */
function runBoth(ctx: StageContext): void {
  runObservedStateNumerics(ctx);
  runStructuralParse(ctx);
}

const factor = (observed: unknown): Record<string, unknown> => ({
  id: "fac_cost",
  kind: "factor",
  label: "Operating cost",
  data: { value: 0.6 },
  ...(observed === undefined ? {} : { observed_state: observed }),
});

describe("observed_state numeric normalisation", () => {
  it("CONTROL: a well-formed factor observed_state parses and is untouched", () => {
    const ctx = makeCtx([factor({ value: 0.6, raw_value: 30000 })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    // Byte-identical: the normaliser is a no-op on valid input.
    expect(node.observed_state).toEqual({ value: 0.6, raw_value: 30000 });
    expect((ctx as any).fieldDeletions).toBeUndefined();
  });

  it("the wire defect: a factor observed_state with NO value no longer 500s", () => {
    // The captured shape: a magnitude and its unit, but no model-scale value.
    const ctx = makeCtx([factor({ raw_value: 30000, unit: "£" })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    expect(node.observed_state).toBeUndefined();
  });

  it("NaN passes `typeof x === 'number'` but not z.number() — it is dropped", () => {
    const ctx = makeCtx([factor({ value: Number.NaN, raw_value: 30000 })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect((ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost").observed_state)
      .toBeUndefined();
  });

  it("a non-numeric raw_value alone costs only that key, never the value", () => {
    const ctx = makeCtx([factor({ value: 0.6, raw_value: "30000" })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    expect(node.observed_state).toEqual({ value: 0.6 });
  });

  it("NOTHING IS INVENTED — a dropped observed_state is not replaced by a default", () => {
    const ctx = makeCtx([factor({ raw_value: 30000, unit: "£" })]);
    runBoth(ctx);

    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    expect(node.observed_state).toBeUndefined();
    // No 0.5, no 0, no synthesised position anywhere on the node.
    expect(node.value).toBeUndefined();
    expect(node.data).toEqual({ value: 0.6 }); // untouched, as it arrived
  });

  it("the drop is recorded with what was removed, so the loss is disclosable", () => {
    const ctx = makeCtx([factor({ raw_value: 30000, unit: "£" })]);
    runBoth(ctx);

    const events = (ctx as any).fieldDeletions ?? [];
    const ev = events.find((e: any) => e.node_id === "fac_cost");
    expect(ev).toBeDefined();
    expect(ev.reason).toBe("OBSERVED_STATE_NOT_NUMERIC");
    expect(ev.field).toBe("observed_state");
    expect(ev.previous_raw_value).toBe(30000);
    expect(ev.previous_unit).toBe("£");
  });

  it("CONTRAST CONTROL: constraint validation is NOT loosened to buy a 200", () => {
    // A constraint node whose observed_state has a value but no valid operator
    // matches neither union branch. It must STILL fail — dropping a user's
    // threshold to obtain a 200 would be worse than refusing.
    const ctx = makeCtx([
      factor({ value: 0.6 }),
      {
        id: "con_budget",
        kind: "constraint",
        label: "Budget cap",
        observed_state: { value: 50000, metadata: {} },
      },
    ]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });

  it("CONTRAST CONTROL: a FACTOR cannot shed the constraint shape to slip through", () => {
    // FactorObservedState refuses any `metadata` key. A factor carrying broken
    // constraint metadata is skipped by the normaliser and still 400s.
    const ctx = makeCtx([factor({ value: 0.6, metadata: { operator: "nonsense" } })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });
});

/**
 * ⚠ THE SUITE ABOVE CANNOT SEE THE WIRING. It calls the substeps directly, so
 * a build that DELETED `runObservedStateNumerics(ctx)` from `repair/index.ts`
 * passes every assertion above while the deployed pipeline still 500s. That is
 * the shape that let a mutant survive a previous suite here: the caller is
 * asserted, the call is not. This block runs the REAL stage entry point.
 */
describe("the normaliser is wired into the repair stage, not merely exported", () => {
  it("runStageRepair drops an unparseable factor observed_state and does not 400", async () => {
    const { runStageRepair } = await import("../index.js");
    const ctx = makeCtx([factor({ raw_value: 30000, unit: "£" })]);

    await runStageRepair(ctx);

    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    expect(node?.observed_state).toBeUndefined();
    expect(ctx.earlyReturn).toBeUndefined();
  });
});
