/**
 * Unit tests for extractConstraintDropBlockers
 *
 * Verifies that STRP CONSTRAINT_DROPPED mutations are correctly
 * converted to AnalysisBlocker entries for analysis_ready.blockers.
 */

import { describe, it, expect } from "vitest";
import { extractConstraintDropBlockers } from "../../src/cee/transforms/analysis-ready.js";

describe("extractConstraintDropBlockers", () => {
  it("converts CONSTRAINT_DROPPED mutations to blockers", () => {
    const mutations = [
      {
        rule: "constraint_target",
        code: "CONSTRAINT_DROPPED",
        constraint_id: "c1",
        field: "node_id",
        before: "fac_totally_unknown",
        after: null,
        reason: 'Constraint with node_id "fac_totally_unknown" dropped — no matching node found',
        severity: "info",
      },
      {
        rule: "constraint_target",
        code: "CONSTRAINT_DROPPED",
        constraint_id: "c2",
        field: "node_id",
        before: "fac_missing_factor",
        after: null,
        reason: 'Constraint with node_id "fac_missing_factor" dropped — no matching node found',
        severity: "info",
      },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toEqual({
      factor_id: "fac_totally_unknown",
      factor_label: "fac_totally_unknown",
      blocker_type: "constraint_dropped",
      message: 'Constraint dropped (c1): Constraint with node_id "fac_totally_unknown" dropped — no matching node found',
      suggested_action: "review_constraint",
    });
    expect(blockers[1]).toEqual({
      factor_id: "fac_missing_factor",
      factor_label: "fac_missing_factor",
      blocker_type: "constraint_dropped",
      message: 'Constraint dropped (c2): Constraint with node_id "fac_missing_factor" dropped — no matching node found',
      suggested_action: "review_constraint",
    });
  });

  it("ignores non-CONSTRAINT_DROPPED mutations", () => {
    const mutations = [
      { code: "CATEGORY_OVERRIDE", rule: "category_override", reason: "cat reclassified" },
      { code: "CONSTRAINT_REMAPPED", rule: "constraint_target", constraint_id: "c1", before: "fac_pric", after: "fac_price", reason: "remapped" },
      { code: "SIGN_CORRECTED", rule: "sign_reconciliation", reason: "sign fixed" },
      { code: "CONTROLLABLE_DATA_FILLED", rule: "controllable_data_completeness", reason: "data filled" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(0);
  });

  it("returns empty array when no mutations", () => {
    expect(extractConstraintDropBlockers([])).toEqual([]);
  });

  it("handles missing constraint_id gracefully", () => {
    const mutations = [
      { code: "CONSTRAINT_DROPPED", before: "fac_orphan", reason: "dropped" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(1);
    expect(blockers[0].factor_id).toBe("fac_orphan");
    expect(blockers[0].message).toBe("Constraint dropped: dropped");
  });

  it("handles missing before gracefully", () => {
    const mutations = [
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", reason: "dropped" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(1);
    expect(blockers[0].factor_id).toBe("unknown");
    expect(blockers[0].factor_label).toBe("unknown");
  });

  it("handles missing reason gracefully", () => {
    const mutations = [
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: "fac_x" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toBe("Constraint dropped (c1): target node not found in graph");
  });

  it("mixes CONSTRAINT_DROPPED with other codes and only extracts drops", () => {
    const mutations = [
      { code: "CATEGORY_OVERRIDE", reason: "cat reclassified" },
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: "fac_x", reason: "dropped" },
      { code: "CONSTRAINT_REMAPPED", constraint_id: "c2", before: "fac_y", after: "fac_z", reason: "remapped" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(1);
    expect(blockers[0].factor_id).toBe("fac_x");
  });

  it("deduplicates by constraint_id", () => {
    const mutations = [
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: "fac_x", reason: "dropped once" },
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: "fac_x", reason: "dropped again" },
      { code: "CONSTRAINT_DROPPED", constraint_id: "c2", before: "fac_y", reason: "different constraint" },
    ];

    const blockers = extractConstraintDropBlockers(mutations);

    expect(blockers).toHaveLength(2);
    expect(blockers[0].factor_id).toBe("fac_x");
    expect(blockers[0].message).toBe("Constraint dropped (c1): dropped once");
    expect(blockers[1].factor_id).toBe("fac_y");
  });

  it("handles non-string before value safely", () => {
    const mutations = [
      { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: 42, reason: "numeric before" },
      { code: "CONSTRAINT_DROPPED", constraint_id: "c2", before: { id: "obj" }, reason: "object before" },
    ];

    const blockers = extractConstraintDropBlockers(mutations as any);

    expect(blockers).toHaveLength(2);
    expect(blockers[0].factor_id).toBe("unknown");
    expect(blockers[0].factor_label).toBe("unknown");
    expect(blockers[1].factor_id).toBe("unknown");
    expect(blockers[1].factor_label).toBe("unknown");
  });
});
