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

import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "../../../../../utils/telemetry.js";
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

  // ── F1: the producer writes this shape on THREE kinds, not one ──────────
  // `projector.ts:3425` emits `observed_state = {...prev, declared_scale}`
  // outside its value guard for every kind in LEVEL_BEARING_CLAIM_NODE_KINDS.
  // Scoping the repair to `factor` rescued one of three.
  for (const kind of ["factor", "risk", "outcome"] as const) {
    it(`a ${kind} carrying only {declared_scale} is rescued, not 400ed`, () => {
      const ctx = makeCtx([
        { id: `n_${kind}`, kind, label: `A ${kind}`, data: { value: 0.4 },
          declared_scale: "unit_interval",
          observed_state: { declared_scale: "unit_interval" } },
      ]);
      runBoth(ctx);

      expect(ctx.earlyReturn).toBeUndefined();
      const node = (ctx.graph as any).nodes.find((n: any) => n.id === `n_${kind}`);
      expect(node.observed_state).toBeUndefined();
      // The node-level twin SURVIVES — only the unparseable copy goes.
      expect(node.declared_scale).toBe("unit_interval");
    });
  }

  it("the audit names declared_scale — the only thing the target shape carried", () => {
    const ctx = makeCtx([
      { id: "n_risk", kind: "risk", label: "A risk", data: { value: 0.4 },
        declared_scale: "unit_interval",
        observed_state: { declared_scale: "unit_interval" } },
    ]);
    runBoth(ctx);

    const ev = ((ctx as any).fieldDeletions ?? []).find((e: any) => e.node_id === "n_risk");
    expect(ev).toBeDefined();
    expect(ev.previous_declared_scale).toBe("unit_interval");
  });

  it("a present-but-undefined raw_value parses, so it is left alone and NOT audited", () => {
    // z.number().optional() accepts undefined — deleting it recorded a false row.
    const ctx = makeCtx([factor({ value: 0.6, raw_value: undefined })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect((ctx as any).fieldDeletions).toBeUndefined();
  });


  it("the audit says WHAT KIND it dropped, and survives JSON for a non-finite value", () => {
    const ctx = makeCtx([
      { id: "n_risk", kind: "risk", label: "A risk", data: { value: 0.4 },
        observed_state: { value: Number.NaN } },
    ]);
    runBoth(ctx);

    const ev = ((ctx as any).fieldDeletions ?? []).find((e: any) => e.node_id === "n_risk");
    expect(ev.node_kind).toBe("risk");
    // JSON.stringify collapses NaN to null; the descriptor must survive it.
    const roundTripped = JSON.parse(JSON.stringify(ev));
    expect(roundTripped.previous_value).toBeNull();
    expect(roundTripped.previous_value_repr).toBe("NaN");
  });

  it("an absent value survives JSON too — the key would otherwise vanish", () => {
    const ctx = makeCtx([factor({ raw_value: 30000, unit: "£" })]);
    runBoth(ctx);

    const ev = ((ctx as any).fieldDeletions ?? []).find((e: any) => e.node_id === "fac_cost");
    const roundTripped = JSON.parse(JSON.stringify(ev));
    expect("previous_value" in roundTripped).toBe(false);
    expect(roundTripped.previous_value_repr).toBe("undefined");
    expect(roundTripped.node_kind).toBe("factor");
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

  it("GUARD: a CONSTRAINT with no usable threshold still 400s — it is never dropped", () => {
    // Discriminates the `kind === "factor"` guard ALONE. This observed_state is
    // factor-SHAPED (no `metadata`) but sits on a constraint node, so only the
    // kind guard can save it. Dropping it would delete the user's threshold to
    // buy a 200 — the failure must stay loud.
    const ctx = makeCtx([
      factor({ value: 0.6 }),
      { id: "con_budget", kind: "constraint", label: "Budget cap", observed_state: { raw_value: 50000 } },
    ]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const con = (ctx.graph as any).nodes.find((n: any) => n.id === "con_budget");
    expect(con.observed_state).toEqual({ raw_value: 50000 });
  });

  it("GUARD: a FACTOR carrying constraint metadata AND no value still 400s", () => {
    // Discriminates the `"metadata" in o` skip ALONE: the value is invalid, so
    // only the metadata skip prevents the drop. Laundering a malformed
    // constraint object by shedding it is exactly what must not happen.
    const ctx = makeCtx([factor({ metadata: { operator: ">=" } })]);
    runBoth(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const node = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_cost");
    expect(node.observed_state).toEqual({ metadata: { operator: ">=" } });
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

/**
 * F6 — `describeIssueNode` had ZERO test references, and a mutant returning
 * `undefined` unconditionally survived 11/11 and 261/261. This is the only
 * instrument that will name the writer of the next unparseable shape, so an
 * untested one is a diagnostic that can silently stop working.
 */
describe("structural parse failure telemetry names the node", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits issue_nodes with identity, key set and member types — never values", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation((() => {}) as never);
    // A constraint is skipped by the normaliser, so this reaches the parse and fails.
    const ctx = makeCtx([
      factor({ value: 0.6 }),
      { id: "con_budget", kind: "constraint", label: "Budget cap",
        observed_state: { value: 50000, metadata: {} } },
    ]);
    runBoth(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const call = warn.mock.calls.find(
      (c: any) => c[0]?.event === "cee.structural_parse.failed",
    );
    expect(call).toBeDefined();
    const nodes = (call as any)[0].issue_nodes;
    expect(Array.isArray(nodes)).toBe(true);
    const entry = nodes.find((n: any) => n.node_id === "con_budget");
    expect(entry).toBeDefined();
    expect(entry.node_kind).toBe("constraint");
    expect(entry.field).toBe("observed_state");
    expect(entry.field_keys).toEqual(["value", "metadata"]);
    expect(entry.member_types).toEqual({ value: "number", metadata: "object" });
    // ⛔ The user's magnitude must NOT be in the log line.
    expect(JSON.stringify(nodes)).not.toContain("50000");
  });
});
