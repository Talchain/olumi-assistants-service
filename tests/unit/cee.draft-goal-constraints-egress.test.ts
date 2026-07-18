/**
 * Draft goal_constraints[] — emission observability + egress survival
 *
 * Context (live staging build 08781d5, scenario 94587fa3): a brief carrying
 * "Hard constraint: first-year budget cannot exceed £50,000" drafted a
 * `fac_first_year_cost` factor node but NO `draft_graph.goal_constraints`.
 *
 * Two hypotheses had to be separated:
 *   (a) NOT-EMITTED  — the model never produced goal_constraints[]
 *   (b) STRIPPED     — the pipeline dropped them somewhere between the
 *                      adapter boundary and the wire
 *
 * These tests pin BOTH halves:
 *
 *   1. EGRESS SURVIVAL — an LLM-emitted constraint whose node_id matches a
 *      real graph node survives compound-goals -> V1 -> V3 and appears in the
 *      SERIALIZED response bytes. This is the (b) control: if egress ever
 *      regresses, this goes red. Asserted on JSON.stringify output, not a
 *      reconstructed fixture.
 *
 *   2. DROP OBSERVABILITY — when the LLM DOES emit constraints but every one
 *      fails the node-existence filter (compound-goals.ts), the drop must be
 *      logged. Before this change the log was gated on
 *      `llmConstraints.length > 0`, so the all-dropped case emitted NOTHING
 *      and (a) was indistinguishable from (b) in staging logs. That silence
 *      is what made the live defect undiagnosable from telemetry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { logInfo, logWarn } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// importOriginal-spread rather than a hand-listed surface: the telemetry
// module also exports `emit`/`TelemetryEvents`, which transformResponseToV3
// calls. A hand-maintained factory REPLACES the module, so every export added
// since would silently vanish and throw at collection.
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...actual,
    log: { ...actual.log, info: logInfo, warn: logWarn },
  };
});

import { runCompoundGoals } from "../../src/cee/unified-pipeline/stages/repair/compound-goals.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";

/** Graph mirroring the live scenario's shape. */
function makeGraph() {
  return {
    nodes: [
      { id: "g1", kind: "goal", label: "Launch Successfully" },
      { id: "d1", kind: "decision", label: "Launch?" },
      { id: "opt_a", kind: "option", label: "Launch now" },
      { id: "fac_first_year_cost", kind: "factor", label: "First-Year Cost" },
    ],
    edges: [
      { from: "d1", to: "opt_a", strength_mean: 1 },
      { from: "opt_a", to: "fac_first_year_cost", strength_mean: 0.5 },
      { from: "fac_first_year_cost", to: "g1", strength_mean: 0.5 },
    ],
  };
}

/**
 * Brief deliberately free of regex-extractable constraint language, so the
 * LLM branch (ctx.llmGoalConstraints) is the ONLY constraint source under
 * test. If the regex extractor also fired, a green result would not prove
 * the LLM path works.
 */
function makeCtx(llmGoalConstraints: unknown): any {
  return {
    requestId: "test-draft-goal-constraints",
    effectiveBrief: "Should we launch the new product?",
    graph: makeGraph(),
    goalConstraints: undefined,
    llmGoalConstraints,
  };
}

const BUDGET_CONSTRAINT = {
  constraint_id: "c_first_year_budget",
  node_id: "fac_first_year_cost",
  operator: "<=",
  value: 50000,
  label: "First-year budget cap",
  unit: "£",
  source_quote: "first-year budget cannot exceed £50,000",
  provenance: "explicit",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("draft goal_constraints — egress survival (LLM-emitted)", () => {
  it("carries an LLM constraint with a matching node_id into ctx.goalConstraints", () => {
    const ctx = makeCtx([BUDGET_CONSTRAINT]);

    runCompoundGoals(ctx);

    expect(ctx.goalConstraints).toBeDefined();
    expect(ctx.goalConstraints).toHaveLength(1);
    expect(ctx.goalConstraints[0]).toMatchObject({
      node_id: "fac_first_year_cost",
      operator: "<=",
      value: 50000,
    });
  });

  it("survives V1 -> V3 into the SERIALIZED response bytes", () => {
    const ctx = makeCtx([BUDGET_CONSTRAINT]);
    runCompoundGoals(ctx);

    // Package stage shape (package.ts: goal_constraints: ctx.goalConstraints)
    const v1Response: any = {
      graph: ctx.graph,
      goal_constraints: ctx.goalConstraints,
      rationales: [],
      confidence: 0.5,
    };

    const v3 = transformResponseToV3(v1Response, { requestId: ctx.requestId });

    // Assert on real serialized bytes — a reconstructed fixture would not
    // prove the field survives JSON emission (undefined silently vanishes).
    const wireBytes = JSON.stringify(v3);
    expect(wireBytes).toContain('"goal_constraints"');

    const reparsed = JSON.parse(wireBytes);
    expect(reparsed.goal_constraints).toHaveLength(1);
    expect(reparsed.goal_constraints[0].node_id).toBe("fac_first_year_cost");
    expect(reparsed.goal_constraints[0].value).toBe(50000);
  });
});

describe("draft goal_constraints — drop observability", () => {
  it("logs a warning when EVERY LLM constraint fails the node-existence filter", () => {
    // node_id is a near-miss: the real node is `fac_first_year_cost`.
    const ctx = makeCtx([{ ...BUDGET_CONSTRAINT, node_id: "first_year_cost" }]);

    runCompoundGoals(ctx);

    // The constraint is still dropped (binding it to a nonexistent node
    // would be worse) — but the drop must no longer be silent.
    expect(ctx.goalConstraints).toBeUndefined();

    expect(logWarn).toHaveBeenCalledTimes(1);
    const [payload] = logWarn.mock.calls[0];
    expect(payload).toMatchObject({
      event: "cee.compound_goal.llm_dropped",
      llm_emitted: 1,
      llm_count: 0,
      llm_skipped: 1,
    });
    expect(payload.skipped_node_ids).toEqual(["first_year_cost"]);
  });

  it("logs a warning on a PARTIAL drop and still emits the surviving constraint", () => {
    const ctx = makeCtx([
      BUDGET_CONSTRAINT,
      { ...BUDGET_CONSTRAINT, constraint_id: "c_ghost", node_id: "fac_nonexistent" },
    ]);

    runCompoundGoals(ctx);

    expect(ctx.goalConstraints).toHaveLength(1);
    expect(ctx.goalConstraints[0].node_id).toBe("fac_first_year_cost");

    expect(logWarn).toHaveBeenCalledTimes(1);
    const [payload] = logWarn.mock.calls[0];
    expect(payload).toMatchObject({
      event: "cee.compound_goal.llm_dropped",
      llm_emitted: 2,
      llm_count: 1,
      llm_skipped: 1,
    });
    expect(payload.skipped_node_ids).toEqual(["fac_nonexistent"]);
  });

  it("does NOT warn when the model emitted nothing (the NOT-EMITTED case stays distinguishable)", () => {
    runCompoundGoals(makeCtx(undefined));
    runCompoundGoals(makeCtx([]));

    expect(logWarn).not.toHaveBeenCalled();
  });

  it("does NOT warn when every LLM constraint binds cleanly", () => {
    runCompoundGoals(makeCtx([BUDGET_CONSTRAINT]));

    expect(logWarn).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalled();
  });
});
