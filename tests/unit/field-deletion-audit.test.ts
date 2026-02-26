/**
 * Field Deletion Audit Telemetry Tests
 *
 * Validates that field deletions across pipeline repair stages produce
 * per-field audit events with correct stage, node_id, field, and reason.
 */
import { describe, it, expect } from "vitest";
import { fieldDeletion } from "../../src/cee/unified-pipeline/utils/field-deletion-audit.js";
import { handleUnreachableFactors } from "../../src/cee/unified-pipeline/stages/repair/unreachable-factors.js";
import { reconcileStructuralTruth } from "../../src/validators/structural-reconciliation.js";
import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

// =============================================================================
// Shared utility tests
// =============================================================================

describe("fieldDeletion helper", () => {
  it("creates a correctly shaped event", () => {
    const event = fieldDeletion("threshold-sweep", "goal_1", "goal_threshold", "THRESHOLD_STRIPPED_NO_RAW");
    expect(event).toEqual({
      stage: "threshold-sweep",
      node_id: "goal_1",
      field: "goal_threshold",
      reason: "THRESHOLD_STRIPPED_NO_RAW",
    });
  });
});

// =============================================================================
// unreachable-factors: field deletion events
// =============================================================================

describe("unreachable-factors field deletion audit", () => {
  it("produces deletion events for value, factor_type, uncertainty_drivers on reclassification", () => {
    const graph = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A", data: { interventions: {} } },
        {
          id: "fac_no_option",
          kind: "factor",
          label: "Unreachable Factor",
          category: "controllable",
          data: { value: 0.5, factor_type: "cost", uncertainty_drivers: ["market"] },
        },
        { id: "out_1", kind: "outcome", label: "O" },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        // Note: no opt_a → fac_no_option edge, so fac_no_option is unreachable
        { from: "fac_no_option", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
      ],
    };

    const result = handleUnreachableFactors(graph as any, "V1_FLAT");
    expect(result.reclassified).toContain("fac_no_option");
    expect(result.fieldDeletions.length).toBeGreaterThan(0);

    // Should have deletions for the three controllable-only fields
    const deletionFields = result.fieldDeletions.map((d) => d.field);
    expect(deletionFields).toContain("data.value");
    expect(deletionFields).toContain("data.factor_type");
    expect(deletionFields).toContain("data.uncertainty_drivers");

    // All deletions should reference the correct stage, node, and reason
    for (const d of result.fieldDeletions) {
      expect(d.stage).toBe("unreachable-factors");
      expect(d.node_id).toBe("fac_no_option");
      expect(d.reason).toBe("UNREACHABLE_FACTOR_RECLASSIFIED");
    }
  });

  it("produces no deletion events when node has no deletable fields", () => {
    const graph = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A", data: { interventions: {} } },
        {
          id: "fac_empty",
          kind: "factor",
          label: "Already External",
          category: "external",
          // No data — nothing to delete
        },
        { id: "out_1", kind: "outcome", label: "O" },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "opt_a", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        // fac_empty not connected to options, but also has no data fields to delete
        { from: "fac_empty", to: "out_1", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
      ],
    };

    const result = handleUnreachableFactors(graph as any, "V1_FLAT");
    // Node gets reclassified but has no data to delete
    expect(result.fieldDeletions.length).toBe(0);
  });
});

// =============================================================================
// threshold-sweep: field deletion events
// =============================================================================

/**
 * Helper to build a minimal StageContext for threshold-sweep tests.
 * Only populates fields that threshold-sweep reads.
 */
function makeThresholdSweepCtx(nodes: any[]): Partial<StageContext> {
  return {
    requestId: "test-ts",
    graph: { nodes, edges: [] } as any,
    deterministicRepairs: [],
    repairTrace: { deterministic_sweep: {} } as any,
  };
}

describe("threshold-sweep field deletion audit", () => {
  it("produces THRESHOLD_STRIPPED_NO_RAW events when goal_threshold_raw is absent", async () => {
    const ctx = makeThresholdSweepCtx([
      {
        id: "goal_1",
        kind: "goal",
        label: "Maximise outcome",
        goal_threshold: 0.8,
        // goal_threshold_raw absent → strip
      },
    ]) as StageContext;

    await runStageThresholdSweep(ctx);

    expect(ctx.fieldDeletions).toBeDefined();
    expect(ctx.fieldDeletions!.length).toBeGreaterThan(0);

    const reasons = ctx.fieldDeletions!.map((d) => d.reason);
    expect(reasons).toContain("THRESHOLD_STRIPPED_NO_RAW");

    for (const d of ctx.fieldDeletions!) {
      expect(d.stage).toBe("threshold-sweep");
      expect(d.node_id).toBe("goal_1");
    }
  });

  it("produces THRESHOLD_STRIPPED_NO_DIGITS events when round raw + no digits in label", async () => {
    const ctx = makeThresholdSweepCtx([
      {
        id: "goal_1",
        kind: "goal",
        label: "Maximise revenue", // no digits
        goal_threshold: 0.8,
        goal_threshold_raw: 100, // round number
      },
    ]) as StageContext;

    await runStageThresholdSweep(ctx);

    expect(ctx.fieldDeletions).toBeDefined();
    expect(ctx.fieldDeletions!.length).toBeGreaterThan(0);

    const reasons = ctx.fieldDeletions!.map((d) => d.reason);
    expect(reasons).toContain("THRESHOLD_STRIPPED_NO_DIGITS");
  });

  it("produces no deletion events when goal has digits in label (safe threshold)", async () => {
    const ctx = makeThresholdSweepCtx([
      {
        id: "goal_1",
        kind: "goal",
        label: "Target 800 customers", // has digits → safe
        goal_threshold: 0.8,
        goal_threshold_raw: 800,
      },
    ]) as StageContext;

    await runStageThresholdSweep(ctx);

    // No deletions — threshold preserved
    expect(ctx.fieldDeletions ?? []).toHaveLength(0);
  });
});

// =============================================================================
// structural-reconciliation: field deletion events on category override
// =============================================================================

describe("structural-reconciliation field deletion audit", () => {
  it("produces deletion events when reclassifying controllable to external strips fields", () => {
    const graph = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A", data: { interventions: {} } },
        {
          id: "fac_wrong_cat",
          kind: "factor",
          label: "Mislabelled",
          category: "controllable", // declared controllable but no option edge → will be overridden
          data: { value: 0.5, factor_type: "cost", uncertainty_drivers: ["market"] },
        },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        // no edge from opt_a to fac_wrong_cat → inferred = observable (has value) not controllable
        { from: "fac_wrong_cat", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      ],
    };

    const result = reconcileStructuralTruth(graph as any, { requestId: "test" });

    // Category override should fire
    const catMutations = result.mutations.filter((m) => m.code === "CATEGORY_OVERRIDE");
    expect(catMutations.length).toBe(1);
    expect(catMutations[0].after).toBe("observable");

    // Should have field deletion events for controllable-only fields
    expect(result.fieldDeletions.length).toBeGreaterThan(0);
    const deletionFields = result.fieldDeletions.map((d) => d.field);
    expect(deletionFields).toContain("data.factor_type");
    expect(deletionFields).toContain("data.uncertainty_drivers");

    for (const d of result.fieldDeletions) {
      expect(d.stage).toBe("structural-reconciliation");
      expect(d.node_id).toBe("fac_wrong_cat");
      expect(d.reason).toBe("CATEGORY_OVERRIDE_STRIP");
    }
  });

  it("produces no deletion events when no category override strips fields", () => {
    const graph = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A", data: { interventions: { fac_1: 100 } } },
        {
          id: "fac_1",
          kind: "factor",
          label: "Correct",
          category: "controllable",
          data: { value: 0.5, factor_type: "cost", uncertainty_drivers: ["market"] },
        },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { from: "opt_a", to: "fac_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "fac_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      ],
    };

    const result = reconcileStructuralTruth(graph as any, { requestId: "test" });
    expect(result.fieldDeletions.length).toBe(0);
  });
});
