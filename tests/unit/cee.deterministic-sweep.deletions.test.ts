/**
 * Deterministic Sweep — Field Deletion Telemetry Tests
 *
 * Validates that EXTERNAL_HAS_DATA and OBSERVABLE_EXTRA_DATA code paths in
 * runDeterministicSweep produce correct FieldDeletionEvent entries on ctx.
 *
 * Uses mocked graph-validator (same pattern as gating tests) so we can
 * inject specific violations without needing a real graph structure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockValidateGraph } = vi.hoisted(() => ({
  mockValidateGraph: vi.fn(),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/validators/graph-validator.js", () => ({
  validateGraph: mockValidateGraph,
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(nodes: any[], edges: any[]): any {
  return {
    graph: { nodes, edges, meta: { roots: [], leaves: [] } },
    requestId: "test-deletions",
    repairTrace: {},
  };
}

function validResult() {
  return { valid: true, errors: [], warnings: [], errorCount: 0, warningCount: 0 };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("deterministic-sweep field deletion: EXTERNAL_HAS_DATA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces deletion events for value, factor_type, uncertainty_drivers on external factor", async () => {
    const nodes = [
      { id: "dec_1", kind: "decision", label: "D" },
      { id: "opt_a", kind: "option", label: "A" },
      {
        id: "fac_ext",
        kind: "factor",
        label: "External",
        category: "external",
        data: { value: 0.5, factor_type: "cost", uncertainty_drivers: ["market"] },
      },
      { id: "out_1", kind: "outcome", label: "O" },
      { id: "goal_1", kind: "goal", label: "G" },
    ];
    const edges = [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "fac_ext", to: "out_1", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
    ];

    // Pre-sweep: validator returns EXTERNAL_HAS_DATA violation
    // Post-sweep: validator returns clean
    mockValidateGraph
      .mockReturnValueOnce({
        valid: false,
        errors: [{ code: "EXTERNAL_HAS_DATA", path: "fac_ext", message: "external has data" }],
        warnings: [],
        errorCount: 1,
        warningCount: 0,
      })
      .mockReturnValue(validResult());

    const ctx = makeCtx(nodes, edges);
    await runDeterministicSweep(ctx);

    expect(ctx.fieldDeletions).toBeDefined();
    expect(ctx.fieldDeletions.length).toBeGreaterThan(0);

    const extDeletions = ctx.fieldDeletions.filter((d: any) => d.node_id === "fac_ext");
    expect(extDeletions.length).toBeGreaterThan(0);

    const fields = extDeletions.map((d: any) => d.field);
    expect(fields).toContain("data.value");
    expect(fields).toContain("data.factor_type");
    expect(fields).toContain("data.uncertainty_drivers");

    for (const d of extDeletions) {
      expect(d.stage).toBe("deterministic-sweep");
      expect(d.reason).toBe("EXTERNAL_HAS_DATA");
    }
  });
});

describe("deterministic-sweep field deletion: OBSERVABLE_EXTRA_DATA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces deletion events for factor_type and uncertainty_drivers on observable factor", async () => {
    const nodes = [
      { id: "dec_1", kind: "decision", label: "D" },
      { id: "opt_a", kind: "option", label: "A" },
      {
        id: "fac_obs",
        kind: "factor",
        label: "Observable",
        category: "observable",
        data: { value: 0.5, factor_type: "cost", uncertainty_drivers: ["supply"] },
      },
      { id: "out_1", kind: "outcome", label: "O" },
      { id: "goal_1", kind: "goal", label: "G" },
    ];
    const edges = [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "fac_obs", to: "out_1", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
    ];

    // Pre-sweep: validator returns OBSERVABLE_EXTRA_DATA violation
    // Post-sweep: validator returns clean
    mockValidateGraph
      .mockReturnValueOnce({
        valid: false,
        errors: [{ code: "OBSERVABLE_EXTRA_DATA", path: "fac_obs", message: "observable has extra data" }],
        warnings: [],
        errorCount: 1,
        warningCount: 0,
      })
      .mockReturnValue(validResult());

    const ctx = makeCtx(nodes, edges);
    await runDeterministicSweep(ctx);

    expect(ctx.fieldDeletions).toBeDefined();
    const obsDeletions = ctx.fieldDeletions.filter(
      (d: any) => d.node_id === "fac_obs" && d.reason === "OBSERVABLE_EXTRA_DATA",
    );
    expect(obsDeletions.length).toBeGreaterThan(0);

    const fields = obsDeletions.map((d: any) => d.field);
    expect(fields).toContain("data.factor_type");
    expect(fields).toContain("data.uncertainty_drivers");

    for (const d of obsDeletions) {
      expect(d.stage).toBe("deterministic-sweep");
    }
  });
});
