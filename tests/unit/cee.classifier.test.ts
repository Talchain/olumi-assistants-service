/**
 * CEE Classifier Tests
 *
 * Tests for severity classification and translation utilities.
 *
 * @module tests/unit/cee.classifier.test
 */

import { describe, it, expect } from "vitest";
import {
  toCanonicalSeverity,
  severityRank,
  compareSeverity,
  classifyIssueSeverity,
  type CeeSeverity,
  type CanonicalSeverity,
} from "../../src/cee/validation/classifier.js";

// ============================================================================
// toCanonicalSeverity Tests
// ============================================================================

describe("toCanonicalSeverity", () => {
  it("translates 'error' to 'blocker'", () => {
    expect(toCanonicalSeverity("error")).toBe("blocker");
  });

  it("translates 'warning' to 'medium'", () => {
    expect(toCanonicalSeverity("warning")).toBe("medium");
  });

  it("translates 'info' to 'low'", () => {
    expect(toCanonicalSeverity("info")).toBe("low");
  });

  it("defaults unknown values to 'medium'", () => {
    expect(toCanonicalSeverity("unknown")).toBe("medium");
    expect(toCanonicalSeverity("")).toBe("medium");
    expect(toCanonicalSeverity("anything")).toBe("medium");
  });

  it("handles CeeSeverity type correctly", () => {
    const severities: CeeSeverity[] = ["error", "warn", "info"];
    const expected: CanonicalSeverity[] = ["blocker", "medium", "low"];

    severities.forEach((sev, i) => {
      expect(toCanonicalSeverity(sev)).toBe(expected[i]);
    });
  });
});

// ============================================================================
// severityRank Tests
// ============================================================================

describe("severityRank", () => {
  it("ranks blocker highest (3)", () => {
    expect(severityRank("blocker")).toBe(3);
  });

  it("ranks high second (2)", () => {
    expect(severityRank("high")).toBe(2);
  });

  it("ranks medium third (1)", () => {
    expect(severityRank("medium")).toBe(1);
  });

  it("ranks low last (0)", () => {
    expect(severityRank("low")).toBe(0);
  });

  it("maintains ordering: blocker > high > medium > low", () => {
    expect(severityRank("blocker")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });
});

// ============================================================================
// compareSeverity Tests
// ============================================================================

describe("compareSeverity", () => {
  it("returns positive when a > b", () => {
    expect(compareSeverity("blocker", "high")).toBeGreaterThan(0);
    expect(compareSeverity("high", "medium")).toBeGreaterThan(0);
    expect(compareSeverity("medium", "low")).toBeGreaterThan(0);
  });

  it("returns negative when a < b", () => {
    expect(compareSeverity("low", "medium")).toBeLessThan(0);
    expect(compareSeverity("medium", "high")).toBeLessThan(0);
    expect(compareSeverity("high", "blocker")).toBeLessThan(0);
  });

  it("returns 0 when a === b", () => {
    expect(compareSeverity("blocker", "blocker")).toBe(0);
    expect(compareSeverity("high", "high")).toBe(0);
    expect(compareSeverity("medium", "medium")).toBe(0);
    expect(compareSeverity("low", "low")).toBe(0);
  });
});

// ============================================================================
// classifyIssueSeverity Tests
// ============================================================================

describe("classifyIssueSeverity", () => {
  it("classifies error codes as 'error'", () => {
    expect(classifyIssueSeverity("SCHEMA_VALIDATION_ERROR")).toBe("error");
    expect(classifyIssueSeverity("GOAL_NODE_MISSING")).toBe("error");
    expect(classifyIssueSeverity("GRAPH_CONTAINS_CYCLE")).toBe("error");
  });

  it("classifies warning codes as 'warn'", () => {
    expect(classifyIssueSeverity("MISSING_EVIDENCE")).toBe("warn");
    expect(classifyIssueSeverity("STRENGTH_CLUSTERING")).toBe("warn");
    expect(classifyIssueSeverity("SAME_LEVER_OPTIONS")).toBe("warn");
  });

  it("classifies info codes as 'info'", () => {
    expect(classifyIssueSeverity("CONSIDER_CONFOUNDER")).toBe("info");
    expect(classifyIssueSeverity("EDGE_ORIGIN_DEFAULTED")).toBe("info");
    expect(classifyIssueSeverity("COULD_ADD_FACTOR")).toBe("info");
  });

  it("defaults unknown codes to 'warn'", () => {
    expect(classifyIssueSeverity("UNKNOWN_CODE")).toBe("warn");
    expect(classifyIssueSeverity("")).toBe("warn");
  });

  it("is case-insensitive", () => {
    expect(classifyIssueSeverity("schema_validation_error")).toBe("error");
    expect(classifyIssueSeverity("Schema_Validation_Error")).toBe("error");
  });

  it("handles null/undefined gracefully", () => {
    expect(classifyIssueSeverity(null)).toBe("warn");
    expect(classifyIssueSeverity(undefined)).toBe("warn");
  });
});

// ============================================================================
// Integration: Translation Round-Trip
// ============================================================================

describe("Severity translation integration", () => {
  it("v3-validator severities translate to consistent canonical values", () => {
    // This tests the full translation chain
    const v3Severities: CeeSeverity[] = ["error", "warn", "info"];
    const canonicalResults = v3Severities.map(toCanonicalSeverity);

    // Ensure all results are valid canonical severities
    // Note: warn maps to medium (consistent with draft_warnings patterns)
    expect(canonicalResults).toEqual(["blocker", "medium", "low"]);

    // Ensure ordering is preserved (blocker > medium > low)
    expect(severityRank(canonicalResults[0])).toBeGreaterThan(severityRank(canonicalResults[1]));
    expect(severityRank(canonicalResults[1])).toBeGreaterThan(severityRank(canonicalResults[2]));
  });

  it("classifyIssueSeverity + toCanonicalSeverity produces consistent results", () => {
    // Test that the chain from code → CeeSeverity → CanonicalSeverity works
    const errorCode = "SCHEMA_VALIDATION_ERROR";
    const warningCode = "MISSING_EVIDENCE";
    const infoCode = "CONSIDER_CONFOUNDER";

    expect(toCanonicalSeverity(classifyIssueSeverity(errorCode))).toBe("blocker");
    expect(toCanonicalSeverity(classifyIssueSeverity(warningCode))).toBe("medium");
    expect(toCanonicalSeverity(classifyIssueSeverity(infoCode))).toBe("low");
  });
});
