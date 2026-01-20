/**
 * Unit Tests for Option Status Computation Utility
 *
 * Tests the shared status computation logic used by both:
 * - draft-graph endpoint (via intervention-extractor.ts)
 * - graph-readiness endpoint (via analysis-ready.ts)
 *
 * KEY ACCEPTANCE CRITERIA:
 * - Both exact_id AND exact_label matches count as "resolved"
 * - Only semantic matches block "ready" status
 * - Informational questions (low confidence confirmations) don't block ready status
 * - Blocking questions (missing values) DO block ready status
 */

import { describe, it, expect } from "vitest";
import {
  computeOptionStatus,
  computeAnalysisReadyStatus,
  isInterventionResolved,
  countInterventionsByResolution,
  isBlockingQuestion,
  categorizeUserQuestions,
  RESOLVED_MATCH_TYPES,
} from "../../src/cee/transforms/option-status.js";
import type { InterventionV3T } from "../../src/schemas/cee-v3.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function makeIntervention(
  matchType: "exact_id" | "exact_label" | "semantic",
  value: number = 59,
  confidence: "high" | "medium" | "low" = "high"
): InterventionV3T {
  return {
    value,
    source: "brief_extraction",
    target_match: {
      node_id: "factor_price",
      match_type: matchType,
      confidence,
    },
  };
}

// ============================================================================
// isInterventionResolved Tests
// ============================================================================

describe("isInterventionResolved", () => {
  it("returns true for exact_id match", () => {
    const intervention = makeIntervention("exact_id");
    expect(isInterventionResolved(intervention)).toBe(true);
  });

  it("returns true for exact_label match", () => {
    const intervention = makeIntervention("exact_label");
    expect(isInterventionResolved(intervention)).toBe(true);
  });

  it("returns false for semantic match", () => {
    const intervention = makeIntervention("semantic");
    expect(isInterventionResolved(intervention)).toBe(false);
  });

  it("returns false when target_match is undefined", () => {
    const intervention = { value: 59, source: "brief_extraction" } as InterventionV3T;
    expect(isInterventionResolved(intervention)).toBe(false);
  });
});

// ============================================================================
// countInterventionsByResolution Tests
// ============================================================================

describe("countInterventionsByResolution", () => {
  it("counts all exact_id matches as resolved", () => {
    const interventions = {
      factor_price: makeIntervention("exact_id"),
      factor_cost: makeIntervention("exact_id"),
    };
    const result = countInterventionsByResolution(interventions);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(0);
  });

  it("counts all exact_label matches as resolved", () => {
    const interventions = {
      factor_price: makeIntervention("exact_label"),
      factor_cost: makeIntervention("exact_label"),
    };
    const result = countInterventionsByResolution(interventions);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(0);
  });

  it("counts mixed matches correctly", () => {
    const interventions = {
      factor_price: makeIntervention("exact_id"),
      factor_cost: makeIntervention("exact_label"),
      factor_risk: makeIntervention("semantic"),
    };
    const result = countInterventionsByResolution(interventions);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(1);
  });

  it("returns zero for empty interventions", () => {
    const result = countInterventionsByResolution({});
    expect(result.resolved).toBe(0);
    expect(result.unresolved).toBe(0);
  });
});

// ============================================================================
// computeOptionStatus Tests - Core Logic
// ============================================================================

describe("computeOptionStatus", () => {
  describe("ready status", () => {
    it("returns ready when has exact_id matched interventions", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_id"),
        },
      });
      expect(result.status).toBe("ready");
      expect(result.resolvedCount).toBe(1);
    });

    it("returns ready when has exact_label matched interventions", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
      });
      expect(result.status).toBe("ready");
      expect(result.resolvedCount).toBe(1);
      expect(result.reason).toContain("resolved intervention");
    });

    it("returns ready with mixed exact_id and exact_label matches", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_id"),
          factor_cost: makeIntervention("exact_label"),
        },
      });
      expect(result.status).toBe("ready");
      expect(result.resolvedCount).toBe(2);
    });

    it("returns ready even with some semantic matches alongside resolved ones", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
          factor_risk: makeIntervention("semantic"),
        },
      });
      expect(result.status).toBe("ready");
      expect(result.resolvedCount).toBe(1);
      expect(result.unresolvedCount).toBe(1);
    });
  });

  describe("needs_user_mapping status", () => {
    it("returns needs_user_mapping when no interventions", () => {
      const result = computeOptionStatus({
        interventions: {},
      });
      expect(result.status).toBe("needs_user_mapping");
      expect(result.reason).toContain("No interventions");
    });

    it("returns needs_user_mapping when only semantic matches exist", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("semantic"),
          factor_cost: makeIntervention("semantic"),
        },
      });
      expect(result.status).toBe("needs_user_mapping");
      expect(result.reason).toContain("semantic matches");
    });

    it("returns needs_user_mapping when has unresolved targets", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
        unresolvedTargets: ["marketing spend"],
      });
      expect(result.status).toBe("needs_user_mapping");
      expect(result.reason).toContain("Unresolved targets");
    });

    it("returns needs_user_mapping when has blocking questions", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
        blockingQuestions: ["What value should 'budget' be set to?"],
      });
      expect(result.status).toBe("needs_user_mapping");
      expect(result.reason).toContain("Blocking questions");
    });
  });

  describe("needs_encoding status", () => {
    it("returns needs_encoding when has non-numeric raw values", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_region: makeIntervention("exact_label"),
        },
        hasNonNumericRaw: true,
      });
      expect(result.status).toBe("needs_encoding");
      expect(result.reason).toContain("categorical/boolean");
    });
  });
});

// ============================================================================
// computeAnalysisReadyStatus Tests
// ============================================================================

describe("computeAnalysisReadyStatus", () => {
  it("returns ready when has interventions and no non-numeric raw", () => {
    const status = computeAnalysisReadyStatus(2, "ready", false);
    expect(status).toBe("ready");
  });

  it("returns needs_user_mapping when no interventions", () => {
    const status = computeAnalysisReadyStatus(0, undefined, false);
    expect(status).toBe("needs_user_mapping");
  });

  it("returns needs_encoding when original status was needs_encoding and no interventions", () => {
    const status = computeAnalysisReadyStatus(0, "needs_encoding", false);
    expect(status).toBe("needs_encoding");
  });

  it("returns needs_encoding when has non-numeric raw values", () => {
    const status = computeAnalysisReadyStatus(2, "ready", true);
    expect(status).toBe("needs_encoding");
  });

  it("preserves needs_encoding from original status", () => {
    const status = computeAnalysisReadyStatus(2, "needs_encoding", false);
    expect(status).toBe("needs_encoding");
  });

  it("upgrades needs_user_mapping to ready when has interventions", () => {
    const status = computeAnalysisReadyStatus(2, "needs_user_mapping", false);
    expect(status).toBe("ready");
  });
});

// ============================================================================
// Question Classification Tests
// ============================================================================

describe("isBlockingQuestion", () => {
  describe("blocking questions", () => {
    it("identifies missing value questions as blocking", () => {
      expect(isBlockingQuestion("What value should 'price' be set to?")).toBe(true);
    });

    it("identifies unmatched factor questions as blocking", () => {
      expect(isBlockingQuestion("Which factor does 'marketing spend' correspond to?")).toBe(true);
    });

    it("identifies encoding questions as NOT blocking (they cause needs_encoding)", () => {
      // Encoding questions are NOT blocking - they result in needs_encoding status
      expect(isBlockingQuestion("How should 'UK' be encoded numerically?")).toBe(false);
    });

    it("identifies value specification questions as blocking", () => {
      expect(isBlockingQuestion("What factors and values should be specified for Option A?")).toBe(true);
    });
  });

  describe("informational questions (not blocking)", () => {
    it("identifies confirmation questions as non-blocking", () => {
      expect(isBlockingQuestion("Is 'price' correctly mapped to 'factor_price'?")).toBe(false);
    });

    it("identifies path warning questions as non-blocking", () => {
      expect(isBlockingQuestion("The factor 'risk' doesn't have a path to goal. Is this correct?")).toBe(false);
    });

    it("identifies general confirmation as non-blocking", () => {
      expect(isBlockingQuestion("Please confirm the mapping is correct.")).toBe(false);
    });
  });
});

describe("categorizeUserQuestions", () => {
  it("categorizes mixed questions correctly", () => {
    const questions = [
      "What value should 'budget' be set to?",
      "Is 'price' correctly mapped to 'factor_price'?",
      "Which factor does 'marketing' correspond to?",
      "The factor 'risk' doesn't have a path to goal. Is this correct?",
      "How should 'UK' be encoded numerically?", // Encoding - informational
    ];

    const result = categorizeUserQuestions(questions);

    expect(result.blocking).toHaveLength(2);
    expect(result.blocking).toContain("What value should 'budget' be set to?");
    expect(result.blocking).toContain("Which factor does 'marketing' correspond to?");

    expect(result.informational).toHaveLength(3);
    expect(result.informational).toContain("Is 'price' correctly mapped to 'factor_price'?");
    expect(result.informational).toContain("The factor 'risk' doesn't have a path to goal. Is this correct?");
    expect(result.informational).toContain("How should 'UK' be encoded numerically?");
  });

  it("returns empty arrays for no questions", () => {
    const result = categorizeUserQuestions([]);
    expect(result.blocking).toHaveLength(0);
    expect(result.informational).toHaveLength(0);
  });
});

// ============================================================================
// Integration Tests - Key Acceptance Criteria
// ============================================================================

describe("Acceptance Criteria", () => {
  describe("AC: Label matches count as resolved", () => {
    it("exact_label match produces ready status", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
      });
      expect(result.status).toBe("ready");
    });

    it("multiple exact_label matches all count as resolved", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
          factor_cost: makeIntervention("exact_label"),
        },
      });
      expect(result.status).toBe("ready");
      expect(result.resolvedCount).toBe(2);
    });
  });

  describe("AC: Informational questions don't block ready status", () => {
    it("low confidence confirmation question doesn't block ready", () => {
      // This question is informational, not blocking
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label", 59, "low"),
        },
        // Empty blocking questions - informational questions aren't passed here
        blockingQuestions: [],
      });
      expect(result.status).toBe("ready");
    });

    it("path warning question doesn't block ready", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
        // Path warning is informational, not blocking
        blockingQuestions: [],
      });
      expect(result.status).toBe("ready");
    });
  });

  describe("AC: Blocking questions DO block ready status", () => {
    it("missing value question blocks ready status", () => {
      const result = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
        blockingQuestions: ["What value should 'budget' be set to?"],
      });
      expect(result.status).toBe("needs_user_mapping");
    });
  });

  describe("AC: Consistent status across endpoints", () => {
    it("analysis-ready status matches extraction status for resolved interventions", () => {
      // Simulate extraction result
      const extractionResult = computeOptionStatus({
        interventions: {
          factor_price: makeIntervention("exact_label"),
        },
      });

      // Simulate analysis-ready transformation
      // When interventions exist and original status is ready, should stay ready
      const analysisReadyStatus = computeAnalysisReadyStatus(
        1, // intervention count
        extractionResult.status,
        false // no non-numeric raw
      );

      expect(extractionResult.status).toBe("ready");
      expect(analysisReadyStatus).toBe("ready");
    });
  });
});

// ============================================================================
// RESOLVED_MATCH_TYPES Tests
// ============================================================================

describe("RESOLVED_MATCH_TYPES", () => {
  it("contains exact_id", () => {
    expect(RESOLVED_MATCH_TYPES.has("exact_id")).toBe(true);
  });

  it("contains exact_label", () => {
    expect(RESOLVED_MATCH_TYPES.has("exact_label")).toBe(true);
  });

  it("does not contain semantic", () => {
    expect(RESOLVED_MATCH_TYPES.has("semantic")).toBe(false);
  });
});
