/**
 * Late-STRP constraint preservation — regression test
 *
 * Ensures that runLateStrp does NOT clobber ctx.goalConstraints set by the
 * compound-goals stage. Historically late-STRP re-ran Rule 3 (constraint
 * target normalisation) and wrote the normalised output back to ctx.
 * When node IDs had shifted in intermediate repairs, Rule 3 dropped all
 * constraints and produced []; the unconditional overwrite then zeroed
 * ctx.goalConstraints and the HTTP response omitted goal_constraints.
 *
 * Fix: late-STRP omits goalConstraints from the reconcileStructuralTruth
 * call, and the overwrite is guarded on length > 0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/validators/structural-reconciliation.js", () => ({
  reconcileStructuralTruth: vi.fn(),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/cee/unified-pipeline/utils/field-deletion-audit.js", () => ({
  recordFieldDeletions: vi.fn(),
}));

import { runLateStrp } from "../../src/cee/unified-pipeline/stages/repair/late-strp.js";
import { reconcileStructuralTruth } from "../../src/validators/structural-reconciliation.js";
import { log } from "../../src/utils/telemetry.js";

function makeCtx(overrides?: Record<string, any>): any {
  return {
    requestId: "test-late-strp",
    graph: {
      nodes: [
        { id: "g1", kind: "goal", label: "Grow Revenue" },
        { id: "fac_churn", kind: "factor", label: "Monthly Churn" },
      ],
      edges: [],
    },
    goalConstraints: undefined,
    ...overrides,
  };
}

describe("runLateStrp — goalConstraints preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes prior constraints into reconcileStructuralTruth (so Rule 3b still runs)", () => {
    const priorConstraints = [
      { constraint_id: "c1", node_id: "fac_churn", operator: "<=", value: 0.05 },
    ];
    const ctx = makeCtx({ goalConstraints: priorConstraints });

    (reconcileStructuralTruth as any).mockReturnValue({
      graph: ctx.graph,
      mutations: [],
      goalConstraints: priorConstraints,
      fieldDeletions: [],
    });

    runLateStrp(ctx);

    const call = (reconcileStructuralTruth as any).mock.calls[0];
    expect(call[1].goalConstraints).toEqual(priorConstraints);
  });

  it("preserves ctx.goalConstraints when reconcileStructuralTruth returns undefined", () => {
    const priorConstraints = [
      { constraint_id: "c1", node_id: "fac_churn", operator: "<=", value: 0.05 },
    ];
    const ctx = makeCtx({ goalConstraints: priorConstraints });

    (reconcileStructuralTruth as any).mockReturnValue({
      graph: ctx.graph,
      mutations: [],
      goalConstraints: undefined,
      fieldDeletions: [],
    });

    runLateStrp(ctx);

    expect(ctx.goalConstraints).toEqual(priorConstraints);
    expect(ctx.goalConstraints).toHaveLength(1);
  });

  it("does NOT overwrite non-empty goalConstraints with an empty array", () => {
    const priorConstraints = [
      { constraint_id: "c1", node_id: "fac_churn", operator: "<=", value: 0.05 },
    ];
    const ctx = makeCtx({ goalConstraints: priorConstraints });

    // Simulate the historical bug pathway: STRP returns []
    (reconcileStructuralTruth as any).mockReturnValue({
      graph: ctx.graph,
      mutations: [],
      goalConstraints: [],
      fieldDeletions: [],
    });

    runLateStrp(ctx);

    expect(ctx.goalConstraints).toEqual(priorConstraints);
    expect(ctx.goalConstraints).toHaveLength(1);
  });

  it("logs cee.late_strp.constraint_overwrite_prevented when the guard fires", () => {
    const priorConstraints = [
      { constraint_id: "c1", node_id: "fac_churn", operator: "<=", value: 0.05 },
    ];
    const ctx = makeCtx({ goalConstraints: priorConstraints });

    (reconcileStructuralTruth as any).mockReturnValue({
      graph: ctx.graph,
      mutations: [],
      goalConstraints: [],
      fieldDeletions: [],
    });

    runLateStrp(ctx);

    const infoCalls = (log.info as any).mock.calls;
    const preventedCall = infoCalls.find(
      (c: any[]) => c[0]?.event === "cee.late_strp.constraint_overwrite_prevented",
    );
    expect(preventedCall).toBeDefined();
    expect(preventedCall[0]).toMatchObject({
      event: "cee.late_strp.constraint_overwrite_prevented",
      request_id: "test-late-strp",
      existing_count: 1,
      strp_count: 0,
    });
  });

  it("adopts non-empty goalConstraints from STRP (belt-and-braces path)", () => {
    const ctx = makeCtx({ goalConstraints: undefined });
    const strpConstraints = [
      { constraint_id: "c2", node_id: "fac_churn", operator: ">=", value: 0.9 },
    ];

    (reconcileStructuralTruth as any).mockReturnValue({
      graph: ctx.graph,
      mutations: [],
      goalConstraints: strpConstraints,
      fieldDeletions: [],
    });

    runLateStrp(ctx);

    expect(ctx.goalConstraints).toEqual(strpConstraints);
  });
});
