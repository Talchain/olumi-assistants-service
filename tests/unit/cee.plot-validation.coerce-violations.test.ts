import { describe, it, expect } from "vitest";
import { coerceViolations } from "../../src/cee/unified-pipeline/stages/repair/plot-validation.js";

describe("coerceViolations", () => {
  it("passes through plain strings unchanged", () => {
    const input = ["CYCLE_DETECTED", "MISSING_BRIDGE"];
    expect(coerceViolations(input)).toEqual(["CYCLE_DETECTED", "MISSING_BRIDGE"]);
  });

  it("formats object violations with code and suggestion", () => {
    const input = [
      { code: "CYCLE_DETECTED", severity: "error", suggestion: "Remove weakest edge in cycle" },
      { code: "MISSING_BRIDGE", severity: "error", suggestion: "Add outcome node connecting factors to goal" },
    ];
    expect(coerceViolations(input)).toEqual([
      "[CYCLE_DETECTED]: Remove weakest edge in cycle",
      "[MISSING_BRIDGE]: Add outcome node connecting factors to goal",
    ]);
  });

  it("falls back to message when suggestion is absent", () => {
    const input = [{ code: "INVALID_EDGE_TYPE", severity: "error", message: "Edge from factor to decision not allowed" }];
    expect(coerceViolations(input)).toEqual(["[INVALID_EDGE_TYPE]: Edge from factor to decision not allowed"]);
  });

  it("falls back to code when neither suggestion nor message present", () => {
    const input = [{ code: "ORPHAN_NODE", severity: "error" }];
    expect(coerceViolations(input)).toEqual(["[ORPHAN_NODE]: ORPHAN_NODE"]);
  });

  it("formats at is string (priority 4)", () => {
    const input = [{ code: "CYCLE_DETECTED", severity: "error", at: "fac_a→fac_b", suggestion: "Remove cycle" }];
    expect(coerceViolations(input)).toEqual(["[CYCLE_DETECTED] at fac_a→fac_b: Remove cycle"]);
  });

  it("formats at.from+at.to as 'at edge from→to' (priority 1)", () => {
    const input = [{ code: "CYCLE_DETECTED", severity: "error", at: { from: "fac_a", to: "fac_b" }, suggestion: "Remove weakest edge in cycle" }];
    expect(coerceViolations(input)).toEqual(["[CYCLE_DETECTED] at edge fac_a→fac_b: Remove weakest edge in cycle"]);
  });

  it("formats at.node_id as 'at node <id>' (priority 2)", () => {
    const input = [{ code: "FACTOR_HAS_INCOMING_EDGES", severity: "warning", at: { node_id: "fac_demand" }, suggestion: "Remove incoming edges or change node type" }];
    expect(coerceViolations(input)).toEqual(["[FACTOR_HAS_INCOMING_EDGES] at node fac_demand: Remove incoming edges or change node type"]);
  });

  it("formats at.node as 'at node <id>' (priority 2, alternate field)", () => {
    const input = [{ code: "ORPHAN_NODE", severity: "error", at: { node: "fac_orphan" }, suggestion: "Connect to graph" }];
    expect(coerceViolations(input)).toEqual(["[ORPHAN_NODE] at node fac_orphan: Connect to graph"]);
  });

  it("formats at.path as 'at <path>' (priority 3)", () => {
    const input = [{ code: "SCHEMA_ERROR", severity: "error", at: { path: "nodes[2].data.value" }, suggestion: "Fix value field" }];
    expect(coerceViolations(input)).toEqual(["[SCHEMA_ERROR] at nodes[2].data.value: Fix value field"]);
  });

  it("omits location when at object has no recognised fields", () => {
    const input = [{ code: "UNKNOWN_ISSUE", severity: "error", at: { unknown_field: "x" }, suggestion: "Fix it" }];
    expect(coerceViolations(input)).toEqual(["[UNKNOWN_ISSUE]: Fix it"]);
  });

  it("handles mixed array of strings and objects", () => {
    const input = [
      "MISSING_GOAL",
      { code: "CYCLE_DETECTED", severity: "error", suggestion: "Break the cycle" },
    ];
    expect(coerceViolations(input)).toEqual([
      "MISSING_GOAL",
      "[CYCLE_DETECTED]: Break the cycle",
    ]);
  });

  it("returns ['unknown'] for null/undefined/empty input", () => {
    expect(coerceViolations(undefined)).toEqual(["unknown"]);
    expect(coerceViolations(null)).toEqual(["unknown"]);
    expect(coerceViolations([])).toEqual(["unknown"]);
  });

  it("returns ['unknown'] for non-array input", () => {
    expect(coerceViolations("not an array")).toEqual(["unknown"]);
    expect(coerceViolations(42)).toEqual(["unknown"]);
  });

  it("safely stringifies non-string, non-object elements (bounded 200 chars)", () => {
    // null/undefined → "unknown violation" (JSON.stringify(undefined) returns undefined)
    // numbers/booleans → JSON-stringified representation
    const input = [null, undefined, 42, true];
    expect(coerceViolations(input)).toEqual([
      "null",           // JSON.stringify(null) === "null"
      "unknown violation", // JSON.stringify(undefined) === undefined → fallback
      "42",
      "true",
    ]);
  });
});
