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

  it("formats at location when at is a string", () => {
    const input = [{ code: "CYCLE_DETECTED", severity: "error", at: "fac_a→fac_b", suggestion: "Remove cycle" }];
    expect(coerceViolations(input)).toEqual(["[CYCLE_DETECTED] at fac_a→fac_b: Remove cycle"]);
  });

  it("formats at location when at is an object (edge reference)", () => {
    const input = [{ code: "INVALID_EDGE_REF", severity: "error", at: { from: "fac_x", to: "out_y" }, suggestion: "Remove edge" }];
    const result = coerceViolations(input);
    expect(result[0]).toMatch(/^\[INVALID_EDGE_REF\] at \{.*\}: Remove edge$/);
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

  it("converts non-string, non-object elements to 'unknown violation'", () => {
    const input = [null, undefined, 42, true];
    expect(coerceViolations(input)).toEqual([
      "unknown violation",
      "unknown violation",
      "unknown violation",
      "unknown violation",
    ]);
  });
});
