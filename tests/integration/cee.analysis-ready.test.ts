/**
 * CEE Analysis-Ready Output Tests
 *
 * P0 acceptance criteria tests for the analysis_ready payload.
 * Tests ensure CEE outputs analysis-ready data that PLoT can consume directly.
 *
 * @see CEE Workstream — Analysis-Ready Output (Complete Specification)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  transformOptionToAnalysisReady,
  buildAnalysisReadyPayload,
  validateAnalysisReadyPayload,
  validateAndLogAnalysisReady,
  getAnalysisReadySummary,
} from "../../src/cee/transforms/analysis-ready.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { OptionV3T, GraphV3T, NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";
import type { AnalysisReadyPayloadT } from "../../src/schemas/analysis-ready.js";
import { AnalysisReadyPayload } from "../../src/schemas/analysis-ready.js";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal V3 option for testing.
 */
function createV3Option(
  id: string,
  label: string,
  interventions: Record<string, { value: number; factorId: string }>,
  status: "ready" | "needs_user_mapping" = "ready"
): OptionV3T {
  const v3Interventions: OptionV3T["interventions"] = {};
  for (const [key, { value, factorId }] of Object.entries(interventions)) {
    v3Interventions[key] = {
      value,
      source: "brief_extraction",
      target_match: {
        node_id: factorId,
        match_type: "exact_id",
        confidence: "high",
      },
    };
  }

  return {
    id,
    label,
    status,
    interventions: v3Interventions,
  };
}

/**
 * Create a minimal V3 graph for testing.
 */
function createV3Graph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  edges: Array<{ from: string; to: string }>
): GraphV3T {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind as NodeV3T["kind"],
      label: n.label,
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      strength_mean: 0.5,
      strength_std: 0.2,
      belief_exists: 0.8,
      effect_direction: "positive" as const,
    })),
  };
}

// ============================================================================
// Acceptance Criteria Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Acceptance Criteria", () => {
  describe("AC1: analysis_ready field exists in response", () => {
    it("should include analysis_ready in V3 response", () => {
      const v1Response = {
        graph: {
          nodes: [
            { id: "goal_mrr", kind: "goal", label: "Reach £20k MRR" },
            { id: "factor_price", kind: "factor", label: "Price" },
            { id: "opt_increase", kind: "option", label: "Increase to £59" },
          ],
          edges: [
            { from: "factor_price", to: "goal_mrr", weight: 0.8 },
          ],
        },
        quality: { overall: 0.7 },
        trace: { request_id: "test-123" },
      };

      const v3Response = transformResponseToV3(v1Response as any, {
        requestId: "test-123",
      });

      expect(v3Response).toHaveProperty("analysis_ready");
      expect(v3Response.analysis_ready).toBeDefined();
    });
  });

  describe("AC2: option IDs match graph nodes", () => {
    it("should have option IDs that match original option node IDs", () => {
      const graph = createV3Graph(
        [
          { id: "goal_mrr", kind: "goal", label: "Reach MRR" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt_a", "Option A", { factor_price: { value: 59, factorId: "factor_price" } }),
        createV3Option("opt_b", "Option B", { factor_price: { value: 49, factorId: "factor_price" } }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_mrr", graph);

      expect(payload.options[0].id).toBe("opt_a");
      expect(payload.options[1].id).toBe("opt_b");
    });
  });

  describe("AC3: interventions are Record<string, number>", () => {
    it("should flatten InterventionV3 objects to plain numbers", () => {
      const v3Option: OptionV3T = {
        id: "opt_increase",
        label: "Increase to £59",
        status: "ready",
        interventions: {
          factor_price: {
            value: 59,
            source: "brief_extraction",
            target_match: {
              node_id: "factor_price",
              match_type: "exact_id",
              confidence: "high",
            },
            reasoning: "Extracted from brief",
          },
        },
      };

      const analysisOption = transformOptionToAnalysisReady(v3Option);

      // Should be a plain number, not an object
      expect(typeof analysisOption.interventions.factor_price).toBe("number");
      expect(analysisOption.interventions.factor_price).toBe(59);
    });

    it("should NOT have nested objects in interventions", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "Factor A" },
          { id: "factor_b", kind: "factor", label: "Factor B" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt", "Option", {
          factor_a: { value: 100, factorId: "factor_a" },
          factor_b: { value: 200, factorId: "factor_b" },
        }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      // All intervention values should be plain numbers
      for (const option of payload.options) {
        for (const [key, value] of Object.entries(option.interventions)) {
          expect(typeof value).toBe("number");
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
          // Ensure it's not an object
          expect(typeof value).not.toBe("object");
        }
      }
    });
  });

  describe("AC4: goal_node_id matches graph", () => {
    it("should include goal_node_id that exists in graph", () => {
      const graph = createV3Graph(
        [
          { id: "goal_revenue", kind: "goal", label: "Maximise revenue" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt", "Option", { factor_price: { value: 50, factorId: "factor_price" } }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_revenue", graph);

      expect(payload.goal_node_id).toBe("goal_revenue");

      // Validation should pass
      const validation = validateAnalysisReadyPayload(payload, graph);
      expect(validation.valid).toBe(true);
    });

    it("should fail validation if goal_node_id not in graph", () => {
      const graph = createV3Graph(
        [{ id: "factor_price", kind: "factor", label: "Price" }],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [],
        goal_node_id: "missing_goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "GOAL_NODE_NOT_FOUND")).toBe(true);
    });
  });

  describe("AC5: status 'ready' when all interventions populated", () => {
    it("should set status='ready' when all options have interventions", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt_a", "Option A", { factor_price: { value: 59, factorId: "factor_price" } }, "ready"),
        createV3Option("opt_b", "Option B", { factor_price: { value: 49, factorId: "factor_price" } }, "ready"),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      expect(payload.status).toBe("ready");
    });
  });

  describe("AC6: status 'needs_user_mapping' with user_questions when incomplete", () => {
    it("should set status='needs_user_mapping' when options have empty interventions", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_budget", kind: "factor", label: "Budget" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt_increase",
          label: "Increase by 25%",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["What is your current budget?"],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      expect(payload.status).toBe("needs_user_mapping");
      expect(payload.user_questions).toContain("What is your current budget?");
    });

    it("should aggregate user_questions from all options", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt_a",
          label: "Option A",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["Question 1?"],
        },
        {
          id: "opt_b",
          label: "Option B",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["Question 2?", "Question 3?"],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      expect(payload.user_questions).toHaveLength(3);
      expect(payload.user_questions).toContain("Question 1?");
      expect(payload.user_questions).toContain("Question 2?");
      expect(payload.user_questions).toContain("Question 3?");
    });
  });

  describe("AC7 & AC8: No null or string values in interventions", () => {
    it("should only have numeric values in interventions", () => {
      const v3Option: OptionV3T = {
        id: "opt",
        label: "Option",
        status: "ready",
        interventions: {
          factor_a: { value: 100, source: "brief_extraction", target_match: { node_id: "factor_a", match_type: "exact_id", confidence: "high" } },
          factor_b: { value: 0, source: "brief_extraction", target_match: { node_id: "factor_b", match_type: "exact_id", confidence: "high" } },
          factor_c: { value: -50, source: "brief_extraction", target_match: { node_id: "factor_c", match_type: "exact_id", confidence: "high" } },
          factor_d: { value: 3.14159, source: "brief_extraction", target_match: { node_id: "factor_d", match_type: "exact_id", confidence: "high" } },
        },
      };

      const analysisOption = transformOptionToAnalysisReady(v3Option);

      // All should be numbers
      expect(analysisOption.interventions.factor_a).toBe(100);
      expect(analysisOption.interventions.factor_b).toBe(0);
      expect(analysisOption.interventions.factor_c).toBe(-50);
      expect(analysisOption.interventions.factor_d).toBeCloseTo(3.14159);

      // Type checks
      for (const value of Object.values(analysisOption.interventions)) {
        expect(typeof value).toBe("number");
        expect(value).not.toBeNull();
        expect(Number.isNaN(value)).toBe(false);
      }
    });
  });

  describe("AC9: Validation passes for valid responses", () => {
    it("should pass validation for a well-formed payload", () => {
      const graph = createV3Graph(
        [
          { id: "goal_mrr", kind: "goal", label: "Reach MRR" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        [{ from: "factor_price", to: "goal_mrr" }]
      );

      const options: OptionV3T[] = [
        createV3Option("opt_increase", "Increase to £59", { factor_price: { value: 59, factorId: "factor_price" } }),
        createV3Option("opt_keep", "Keep at £49", { factor_price: { value: 49, factorId: "factor_price" } }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_mrr", graph);
      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
});

// ============================================================================
// Test Brief Scenarios
// ============================================================================

describe("CEE Analysis-Ready Output - Test Brief Scenarios", () => {
  describe("Pricing Decision: 'Price at £49 or £59'", () => {
    it("should produce status='ready' with 2 options × 1 factor", () => {
      const graph = createV3Graph(
        [
          { id: "goal_revenue", kind: "goal", label: "Maximise revenue" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        [{ from: "factor_price", to: "goal_revenue" }]
      );

      const options: OptionV3T[] = [
        createV3Option("opt_49", "Price at £49", { factor_price: { value: 49, factorId: "factor_price" } }),
        createV3Option("opt_59", "Price at £59", { factor_price: { value: 59, factorId: "factor_price" } }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_revenue", graph);
      const summary = getAnalysisReadySummary(payload);

      expect(payload.status).toBe("ready");
      expect(summary.optionCount).toBe(2);
      expect(summary.totalInterventions).toBe(2); // 2 options × 1 factor each
      expect(summary.readyOptions).toBe(2);
      expect(summary.incompleteOptions).toBe(0);
    });
  });

  describe("Resource Allocation: 'Split £100k: 70/30 vs 50/50'", () => {
    it("should produce status='ready' with 2 options × 2 factors", () => {
      const graph = createV3Graph(
        [
          { id: "goal_revenue", kind: "goal", label: "Maximise revenue" },
          { id: "factor_marketing", kind: "factor", label: "Marketing Budget" },
          { id: "factor_sales", kind: "factor", label: "Sales Budget" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt_70_30", "70/30 Marketing-heavy", {
          factor_marketing: { value: 70000, factorId: "factor_marketing" },
          factor_sales: { value: 30000, factorId: "factor_sales" },
        }),
        createV3Option("opt_50_50", "50/50 Balanced", {
          factor_marketing: { value: 50000, factorId: "factor_marketing" },
          factor_sales: { value: 50000, factorId: "factor_sales" },
        }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_revenue", graph);
      const summary = getAnalysisReadySummary(payload);

      expect(payload.status).toBe("ready");
      expect(summary.optionCount).toBe(2);
      expect(summary.totalInterventions).toBe(4); // 2 options × 2 factors each
    });
  });

  describe("Go/No-Go: 'Proceed with £5m acquisition?'", () => {
    it("should produce status='ready' with binary interventions", () => {
      const graph = createV3Graph(
        [
          { id: "goal_growth", kind: "goal", label: "Accelerate growth" },
          { id: "factor_action", kind: "factor", label: "Acquisition decision" },
          { id: "factor_cost", kind: "factor", label: "Acquisition cost" },
        ],
        []
      );

      const options: OptionV3T[] = [
        createV3Option("opt_proceed", "Proceed with acquisition", {
          factor_action: { value: 1, factorId: "factor_action" },
          factor_cost: { value: 5000000, factorId: "factor_cost" },
        }),
        createV3Option("opt_decline", "Do not proceed", {
          factor_action: { value: 0, factorId: "factor_action" },
          factor_cost: { value: 0, factorId: "factor_cost" },
        }),
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_growth", graph);

      expect(payload.status).toBe("ready");
      expect(payload.options[0].interventions.factor_action).toBe(1);
      expect(payload.options[0].interventions.factor_cost).toBe(5000000);
      expect(payload.options[1].interventions.factor_action).toBe(0);
      expect(payload.options[1].interventions.factor_cost).toBe(0);
    });
  });

  describe("Relative Value: 'Increase budget by 20%'", () => {
    it("should produce status='needs_user_mapping' with questions", () => {
      const graph = createV3Graph(
        [
          { id: "goal_leads", kind: "goal", label: "Increase qualified leads" },
          { id: "factor_marketing", kind: "factor", label: "Marketing Budget" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt_increase",
          label: "Increase by 20%",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["What is your current marketing budget?"],
        },
        {
          id: "opt_keep",
          label: "Keep current budget",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["What is your current marketing budget?"],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_leads", graph);

      expect(payload.status).toBe("needs_user_mapping");
      expect(payload.user_questions).toBeDefined();
      expect(payload.user_questions?.length).toBeGreaterThan(0);
    });
  });

  describe("Categorical Choice: 'Germany or France?'", () => {
    it("should produce status='needs_user_mapping' asking for factor ratings", () => {
      const graph = createV3Graph(
        [
          { id: "goal_growth", kind: "goal", label: "International growth" },
          { id: "factor_market_size", kind: "factor", label: "Market Size" },
          { id: "factor_competition", kind: "factor", label: "Competition Level" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt_germany",
          label: "Expand to Germany",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: [
            "On a scale of 1-10, how would you rate Germany's market size?",
            "On a scale of 1-10, how would you rate competition in Germany?",
          ],
        },
        {
          id: "opt_france",
          label: "Expand to France",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: [
            "On a scale of 1-10, how would you rate France's market size?",
            "On a scale of 1-10, how would you rate competition in France?",
          ],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal_growth", graph);

      expect(payload.status).toBe("needs_user_mapping");
      expect(payload.user_questions?.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ============================================================================
// Validation Rule Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Validation Rules", () => {
  describe("Rule 3: Intervention factor IDs must exist", () => {
    it("should fail if factor ID not in graph", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt",
            label: "Option",
            status: "ready",
            interventions: {
              factor_missing: 100, // This factor doesn't exist in graph
            },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "INTERVENTION_FACTOR_NOT_FOUND")).toBe(true);
    });
  });

  describe("Rule 5: Status consistency", () => {
    it("should fail if status='ready' but options have empty interventions", () => {
      const graph = createV3Graph(
        [{ id: "goal", kind: "goal", label: "Goal" }],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          { id: "opt", label: "Option", status: "needs_user_mapping", interventions: {} },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready", // Inconsistent: should be needs_user_mapping
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "STATUS_INCONSISTENT")).toBe(true);
    });

    it("should fail if status='needs_user_mapping' but no questions provided", () => {
      const graph = createV3Graph(
        [{ id: "goal", kind: "goal", label: "Goal" }],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          { id: "opt", label: "Option", status: "needs_user_mapping", interventions: {} },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "needs_user_mapping",
        // Missing user_questions
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "MISSING_USER_QUESTIONS")).toBe(true);
    });
  });
});

// ============================================================================
// Summary Statistics Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Summary Statistics", () => {
  it("should calculate correct summary statistics", () => {
    const graph = createV3Graph(
      [
        { id: "goal", kind: "goal", label: "Goal" },
        { id: "factor_a", kind: "factor", label: "A" },
        { id: "factor_b", kind: "factor", label: "B" },
      ],
      []
    );

    const options: OptionV3T[] = [
      createV3Option("opt_1", "Option 1", {
        factor_a: { value: 10, factorId: "factor_a" },
        factor_b: { value: 20, factorId: "factor_b" },
      }),
      createV3Option("opt_2", "Option 2", {
        factor_a: { value: 30, factorId: "factor_a" },
      }),
      {
        id: "opt_3",
        label: "Option 3",
        status: "needs_user_mapping",
        interventions: {},
        user_questions: ["Q1?", "Q2?"],
      },
    ];

    const payload = buildAnalysisReadyPayload(options, "goal", graph);
    const summary = getAnalysisReadySummary(payload);

    expect(summary.optionCount).toBe(3);
    expect(summary.totalInterventions).toBe(3); // 2 + 1 + 0
    expect(summary.averageInterventionsPerOption).toBe(1); // 3/3
    expect(summary.readyOptions).toBe(2);
    expect(summary.incompleteOptions).toBe(1);
    expect(summary.status).toBe("needs_user_mapping");
    expect(summary.userQuestionCount).toBe(2);
  });
});

// ============================================================================
// Backwards Compatibility Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Backwards Compatibility", () => {
  describe("Status alias handling", () => {
    it("should normalize 'needs_user_input' input to 'needs_user_mapping' output via Zod", () => {
      const input = {
        options: [{ id: "opt", label: "Option", status: "needs_user_mapping", interventions: {} }],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "needs_user_input", // Legacy input
        user_questions: ["What is the baseline?"],
      };

      const result = AnalysisReadyPayload.parse(input);

      // Should be normalized to needs_user_mapping
      expect(result.status).toBe("needs_user_mapping");
    });

    it("should accept 'needs_user_mapping' as-is", () => {
      const input = {
        options: [{ id: "opt", label: "Option", status: "needs_user_mapping", interventions: {} }],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "needs_user_mapping",
        user_questions: ["What is the baseline?"],
      };

      const result = AnalysisReadyPayload.parse(input);

      expect(result.status).toBe("needs_user_mapping");
    });

    it("should accept 'ready' as-is", () => {
      const input = {
        options: [{ id: "opt", label: "Option", status: "ready", interventions: { factor_a: 100 } }],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const result = AnalysisReadyPayload.parse(input);

      expect(result.status).toBe("ready");
    });

    it("should output 'needs_user_mapping' when builder creates incomplete payload", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt",
          label: "Option",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["What is the value?"],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      // Builder should ALWAYS output needs_user_mapping (never needs_user_input)
      expect(payload.status).toBe("needs_user_mapping");
    });
  });

  describe("Builder/Validator consistency", () => {
    it("should produce valid payload when options have needs_user_mapping but no questions", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      // Option with needs_user_mapping status but NO user_questions
      const options: OptionV3T[] = [
        {
          id: "opt_incomplete",
          label: "Incomplete Option",
          status: "needs_user_mapping",
          interventions: {},
          // NO user_questions - this previously caused builder/validator mismatch
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      // Builder should generate fallback question
      expect(payload.status).toBe("needs_user_mapping");
      expect(payload.user_questions).toBeDefined();
      expect(payload.user_questions!.length).toBeGreaterThan(0);

      // The generated payload should pass its own validator
      const validation = validateAnalysisReadyPayload(payload, graph, options);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should produce valid payload when options have empty interventions but no questions", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      // Option with empty interventions and no questions
      const options: OptionV3T[] = [
        {
          id: "opt_empty",
          label: "Empty Interventions Option",
          status: "ready", // Even if status is 'ready', empty interventions triggers needs_user_mapping
          interventions: {},
          // NO user_questions
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      // Builder should detect empty interventions and set needs_user_mapping with fallback question
      expect(payload.status).toBe("needs_user_mapping");
      expect(payload.user_questions).toBeDefined();
      expect(payload.user_questions!.length).toBeGreaterThan(0);

      // The generated payload should pass its own validator
      const validation = validateAnalysisReadyPayload(payload, graph, options);
      expect(validation.valid).toBe(true);
    });

    it("should include option labels in fallback question", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt1",
          label: "Marketing Campaign",
          status: "needs_user_mapping",
          interventions: {},
        },
        {
          id: "opt2",
          label: "Sales Initiative",
          status: "needs_user_mapping",
          interventions: {},
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      expect(payload.user_questions).toBeDefined();
      expect(payload.user_questions![0]).toContain("Marketing Campaign");
      expect(payload.user_questions![0]).toContain("Sales Initiative");
    });

    it("should preserve explicit user_questions instead of generating fallback", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const options: OptionV3T[] = [
        {
          id: "opt",
          label: "Option With Questions",
          status: "needs_user_mapping",
          interventions: {},
          user_questions: ["What is your budget?", "What is your timeline?"],
        },
      ];

      const payload = buildAnalysisReadyPayload(options, "goal", graph);

      expect(payload.user_questions).toEqual(["What is your budget?", "What is your timeline?"]);
      // Should NOT contain the fallback question
      expect(payload.user_questions!.some((q) => q.includes("factors and values"))).toBe(false);
    });
  });
});

// ============================================================================
// High Priority - Factor Kind Enforcement Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Factor Kind Enforcement", () => {
  describe("Rule 3 (strict): Intervention targets must have kind='factor'", () => {
    it("should fail if intervention target is a goal node", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "outcome_revenue", kind: "outcome", label: "Revenue" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt",
            label: "Option",
            status: "ready",
            interventions: {
              goal: 100, // WRONG: targeting a goal node, not a factor
            },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "INTERVENTION_TARGET_WRONG_KIND")).toBe(true);
      expect(validation.errors[0].message).toContain('kind="goal"');
    });

    it("should fail if intervention target is an outcome node", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "outcome_revenue", kind: "outcome", label: "Revenue" },
          { id: "factor_price", kind: "factor", label: "Price" },
        ],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt",
            label: "Option",
            status: "ready",
            interventions: {
              outcome_revenue: 500, // WRONG: targeting an outcome, not a factor
            },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "INTERVENTION_TARGET_WRONG_KIND")).toBe(true);
      expect(validation.errors[0].message).toContain('kind="outcome"');
    });

    it("should pass if all intervention targets are factors", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
          { id: "factor_b", kind: "factor", label: "B" },
        ],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt",
            label: "Option",
            status: "ready",
            interventions: {
              factor_a: 100,
              factor_b: 200,
            },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
});

// ============================================================================
// Option ID Consistency Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Option ID Consistency", () => {
  describe("Rule 1: Option IDs must match V3 options", () => {
    it("should fail if payload option ID not found in V3 options", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const v3Options: OptionV3T[] = [
        createV3Option("opt_real", "Real Option", { factor_a: { value: 100, factorId: "factor_a" } }),
      ];

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt_fake", // This doesn't exist in v3Options
            label: "Fake Option",
            status: "ready",
            interventions: { factor_a: 999 },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      const validation = validateAnalysisReadyPayload(payload, graph, v3Options);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.code === "OPTION_ID_MISMATCH")).toBe(true);
    });

    it("should pass if all payload option IDs match V3 options", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const v3Options: OptionV3T[] = [
        createV3Option("opt_a", "Option A", { factor_a: { value: 100, factorId: "factor_a" } }),
        createV3Option("opt_b", "Option B", { factor_a: { value: 200, factorId: "factor_a" } }),
      ];

      const payload = buildAnalysisReadyPayload(v3Options, "goal", graph);
      const validation = validateAnalysisReadyPayload(payload, graph, v3Options);

      expect(validation.valid).toBe(true);
    });

    it("should skip option ID validation when v3Options not provided", () => {
      const graph = createV3Graph(
        [
          { id: "goal", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
        ],
        []
      );

      const payload: AnalysisReadyPayloadT = {
        options: [
          {
            id: "opt_any",
            label: "Any Option",
            status: "ready",
            interventions: { factor_a: 100 },
          },
        ],
        goal_node_id: "goal",
        suggested_seed: "42",
        status: "ready",
      };

      // No v3Options provided - should not fail on option ID mismatch
      const validation = validateAnalysisReadyPayload(payload, graph);

      expect(validation.valid).toBe(true);
    });
  });
});

// ============================================================================
// Telemetry Emission Tests
// ============================================================================

describe("CEE Analysis-Ready Output - Telemetry", () => {
  it("should emit AnalysisReadyValidationFailed when validation fails", () => {
    const graph = createV3Graph(
      [{ id: "goal", kind: "goal", label: "Goal" }],
      []
    );

    const payload: AnalysisReadyPayloadT = {
      options: [
        {
          id: "opt",
          label: "Option",
          status: "ready",
          interventions: {
            missing_factor: 100, // This will fail validation
          },
        },
      ],
      goal_node_id: "goal",
      suggested_seed: "42",
      status: "ready",
    };

    // The validateAndLogAnalysisReady function should emit telemetry
    // We're testing that the function executes without error and returns invalid result
    const result = validateAndLogAnalysisReady(payload, graph, undefined, "test-request-id");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Telemetry emission is verified by the telemetry-events test suite
  });
});
