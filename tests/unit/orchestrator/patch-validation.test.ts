import { describe, it, expect } from "vitest";
import {
  PatchOperationSchema,
  PatchOperationsArraySchema,
  validatePatchOperations,
  checkReferentialIntegrity,
  formatPatchValidationErrors,
  type ValidatedPatchOperation,
} from "../../../src/orchestrator/patch-validation.js";

// ============================================================================
// Fixtures
// ============================================================================

const GRAPH = {
  nodes: [
    { id: "goal_1", kind: "goal", label: "Revenue" },
    { id: "factor_1", kind: "factor", label: "Price" },
    { id: "factor_2", kind: "factor", label: "Volume" },
  ],
  edges: [
    { from: "factor_1", to: "goal_1" },
    { from: "factor_2", to: "goal_1" },
  ],
};

// ============================================================================
// PatchOperationSchema — Discriminated Union
// ============================================================================

describe("PatchOperationSchema", () => {
  it("validates add_node with required fields", () => {
    const op = { op: "add_node", path: "nodes/new", value: { id: "new", kind: "factor", label: "Cost" } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("rejects add_node missing id in value", () => {
    const op = { op: "add_node", path: "nodes/new", value: { kind: "factor", label: "Cost" } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("rejects add_node missing kind in value", () => {
    const op = { op: "add_node", path: "nodes/new", value: { id: "new", label: "Cost" } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("validates remove_node without value", () => {
    const op = { op: "remove_node", path: "factor_1" };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("validates update_node with at least one field", () => {
    const op = { op: "update_node", path: "factor_1", value: { label: "New Label" } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("rejects update_node with empty value", () => {
    const op = { op: "update_node", path: "factor_1", value: {} };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("validates add_edge with required fields", () => {
    const op = {
      op: "add_edge",
      path: "edges/new",
      value: { from: "factor_1", to: "factor_2", strength_mean: 0.5 },
    };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("rejects add_edge missing from", () => {
    const op = { op: "add_edge", path: "edges/new", value: { to: "factor_2", strength_mean: 0.5 } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("validates remove_edge without value", () => {
    const op = { op: "remove_edge", path: "factor_1::goal_1" };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("validates update_edge with partial value", () => {
    const op = { op: "update_edge", path: "factor_1::goal_1", value: { strength_mean: 0.8 } };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  it("rejects unknown op type", () => {
    const op = { op: "delete_all", path: "nodes" };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("rejects missing path", () => {
    const op = { op: "remove_node" };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
  });

  it("allows passthrough fields on add_node value", () => {
    const op = {
      op: "add_node",
      path: "nodes/new",
      value: { id: "new", kind: "factor", label: "Cost", category: "financial", extra: true },
    };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.value as Record<string, unknown>).category).toBe("financial");
    }
  });
});

// ============================================================================
// PatchOperationsArraySchema
// ============================================================================

describe("PatchOperationsArraySchema", () => {
  it("rejects empty array", () => {
    const result = PatchOperationsArraySchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("validates array with one valid op", () => {
    const result = PatchOperationsArraySchema.safeParse([
      { op: "remove_node", path: "factor_1" },
    ]);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// checkReferentialIntegrity
// ============================================================================

describe("checkReferentialIntegrity", () => {
  it("reports error for remove_node on non-existent node", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "remove_node", path: "missing_node" },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("does not exist");
  });

  it("reports error for add_node with duplicate ID", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "add_node", path: "nodes/goal_1", value: { id: "goal_1", kind: "goal", label: "Dup" } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("already exists");
  });

  it("allows add_edge when both nodes exist", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "add_edge", path: "edges/new", value: { from: "factor_1", to: "factor_2", strength_mean: 0.3 } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(0);
  });

  it("reports error for add_edge with non-existent source node", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "add_edge", path: "edges/new", value: { from: "missing", to: "goal_1", strength_mean: 0.3 } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("missing");
  });

  it("allows cross-reference to node added in same batch", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "add_node", path: "nodes/new_factor", value: { id: "new_factor", kind: "factor", label: "New" } },
      { op: "add_edge", path: "edges/new", value: { from: "new_factor", to: "goal_1", strength_mean: 0.5 } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(0);
  });

  it("detects add_edge to node being removed in same batch", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "remove_node", path: "factor_1" },
      { op: "add_edge", path: "edges/bad", value: { from: "factor_1", to: "goal_1", strength_mean: 0.5 } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some(e => e.message.includes("being removed"))).toBe(true);
  });

  it("reports error for update_node on non-existent node", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "update_node", path: "ghost", value: { label: "X" } },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(1);
  });

  it("reports error for remove_edge on non-existent edge (from::to format)", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "remove_edge", path: "factor_1::factor_2" },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("does not exist");
  });

  it("allows remove_edge on existing edge (from::to format)", () => {
    const ops: ValidatedPatchOperation[] = [
      { op: "remove_edge", path: "factor_1::goal_1" },
    ];
    const errors = checkReferentialIntegrity(ops, GRAPH);
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// validatePatchOperations (combined Zod + referential)
// ============================================================================

describe("validatePatchOperations", () => {
  it("returns valid=true for correct operations", () => {
    const rawOps = [
      { op: "update_node", path: "factor_1", value: { label: "New Price" } },
    ];
    const result = validatePatchOperations(rawOps, GRAPH);
    expect(result.valid).toBe(true);
    expect(result.operations).toHaveLength(1);
  });

  it("returns valid=false with zodErrors for bad schema", () => {
    const rawOps = [{ op: "nuke_it_all", path: "everything" }];
    const result = validatePatchOperations(rawOps, GRAPH);
    expect(result.valid).toBe(false);
    expect(result.zodErrors).toBeDefined();
  });

  it("returns valid=false with referentialErrors for integrity violation", () => {
    const rawOps = [
      { op: "remove_node", path: "non_existent_node" },
    ];
    const result = validatePatchOperations(rawOps, GRAPH);
    expect(result.valid).toBe(false);
    expect(result.referentialErrors).toBeDefined();
    expect(result.referentialErrors!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// formatPatchValidationErrors
// ============================================================================

describe("formatPatchValidationErrors", () => {
  it("formats zod errors into readable lines", () => {
    const result = validatePatchOperations(
      [{ op: "bad_op", path: "x" }],
      GRAPH,
    );
    const formatted = formatPatchValidationErrors(result);
    expect(formatted).toContain("Schema:");
  });

  it("formats referential errors into readable lines", () => {
    const result = validatePatchOperations(
      [{ op: "remove_node", path: "ghost" }],
      GRAPH,
    );
    const formatted = formatPatchValidationErrors(result);
    expect(formatted).toContain("Integrity:");
  });
});
