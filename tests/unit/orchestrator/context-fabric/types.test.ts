import { describe, it, expect } from "vitest";
import {
  ContextFabricRouteSchema,
  DecisionStageSchema,
  DecisionStateSchema,
  ConversationTurnSchema,
  ToolOutputSchema,
  RouteProfileSchema,
  GraphSummarySchema,
  AnalysisSummarySchema,
  DriverSummarySchema,
} from "../../../../src/orchestrator/context-fabric/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function validDecisionState() {
  return {
    graph_summary: {
      node_count: 5,
      edge_count: 8,
      goal_node_id: "goal_1",
      option_node_ids: ["opt_1", "opt_2"],
      compact_edges: "fac_1 -> out_1 (0.6)\nfac_2 -> out_1 (0.3)",
    },
    analysis_summary: {
      winner_id: "opt_1",
      winner_probability: 0.72,
      winner_fact_id: "f_win_1",
      winning_margin: 0.15,
      margin_fact_id: "f_margin_1",
      robustness_level: "moderate",
      robustness_fact_id: "f_rob_1",
      top_drivers: [
        { node_id: "fac_1", sensitivity: 0.42, confidence: "high", fact_id: "f_d1" },
        { node_id: "fac_2", sensitivity: 0.18, confidence: "medium" },
      ],
      fragile_edge_ids: ["fac_3->out_1"],
    },
    event_summary: "Graph: 5 nodes, 8 edges. Analysis: opt_1 at 72.0%, margin 15.0pp, robustness moderate.",
    framing: {
      goal: "Decide on market entry strategy",
      constraints: ["Budget < 1M"],
      options: ["Option A", "Option B"],
      brief_text: "Initial assessment of options",
      stage: "evaluate_pre" as const,
    },
    user_causal_claims: ["Marketing spend drives revenue"],
    unresolved_questions: ["What about competitor response?"],
  };
}

function validConversationTurn() {
  return {
    role: "user" as const,
    content: "What does the analysis show?",
    tool_outputs: [
      {
        tool_name: "run_analysis",
        system_fields: { seed: 42, n_samples: 10000 },
        user_originated_fields: { goal_label: "Market entry" },
      },
    ],
  };
}

function validRouteProfile() {
  return {
    route: "CHAT" as const,
    max_turns: 3,
    include_graph_summary: true,
    include_full_graph: false,
    include_analysis_summary: true,
    include_full_analysis: false,
    include_archetypes: false,
    include_selected_elements: false,
    token_budget: 8000,
  };
}

// ============================================================================
// ContextFabricRoute
// ============================================================================

describe("ContextFabricRouteSchema", () => {
  it("accepts all 5 valid routes", () => {
    for (const r of ["CHAT", "DRAFT_GRAPH", "EDIT_GRAPH", "EXPLAIN_RESULTS", "GENERATE_BRIEF"]) {
      expect(ContextFabricRouteSchema.parse(r)).toBe(r);
    }
  });

  it("rejects RUN_ANALYSIS", () => {
    expect(() => ContextFabricRouteSchema.parse("RUN_ANALYSIS")).toThrow();
  });

  it("rejects unknown strings", () => {
    expect(() => ContextFabricRouteSchema.parse("UNKNOWN")).toThrow();
  });
});

// ============================================================================
// DecisionStage
// ============================================================================

describe("DecisionStageSchema", () => {
  it("accepts all 6 stages", () => {
    for (const s of ["frame", "ideate", "evaluate_pre", "evaluate_post", "decide", "optimise"]) {
      expect(DecisionStageSchema.parse(s)).toBe(s);
    }
  });

  it("rejects bare 'evaluate'", () => {
    expect(() => DecisionStageSchema.parse("evaluate")).toThrow();
  });
});

// ============================================================================
// GraphSummary
// ============================================================================

describe("GraphSummarySchema", () => {
  it("accepts valid graph summary", () => {
    const input = {
      node_count: 3,
      edge_count: 2,
      goal_node_id: "goal_1",
      option_node_ids: ["opt_1"],
      compact_edges: "a -> b (0.5)",
    };
    expect(GraphSummarySchema.parse(input)).toEqual(input);
  });

  it("accepts null goal_node_id", () => {
    const input = {
      node_count: 0,
      edge_count: 0,
      goal_node_id: null,
      option_node_ids: [],
      compact_edges: "",
    };
    expect(GraphSummarySchema.parse(input)).toEqual(input);
  });

  it("rejects missing node_count", () => {
    expect(() => GraphSummarySchema.parse({ edge_count: 0, goal_node_id: null, option_node_ids: [], compact_edges: "" })).toThrow();
  });

  it("rejects negative node_count", () => {
    expect(() => GraphSummarySchema.parse({ node_count: -1, edge_count: 0, goal_node_id: null, option_node_ids: [], compact_edges: "" })).toThrow();
  });
});

// ============================================================================
// DriverSummary
// ============================================================================

describe("DriverSummarySchema", () => {
  it("accepts valid driver with fact_id", () => {
    const d = { node_id: "fac_1", sensitivity: 0.42, confidence: "high", fact_id: "f_d1" };
    expect(DriverSummarySchema.parse(d)).toEqual(d);
  });

  it("accepts driver without fact_id", () => {
    const d = { node_id: "fac_1", sensitivity: 0.18, confidence: "medium" };
    const result = DriverSummarySchema.parse(d);
    expect(result.node_id).toBe("fac_1");
    expect(result.fact_id).toBeUndefined();
  });

  it("rejects missing node_id", () => {
    expect(() => DriverSummarySchema.parse({ sensitivity: 0.1, confidence: "high" })).toThrow();
  });
});

// ============================================================================
// AnalysisSummary
// ============================================================================

describe("AnalysisSummarySchema", () => {
  it("accepts valid analysis summary", () => {
    const input = validDecisionState().analysis_summary;
    expect(AnalysisSummarySchema.parse(input)).toEqual(input);
  });

  it("rejects winner_probability > 1", () => {
    const input = { ...validDecisionState().analysis_summary!, winner_probability: 1.5 };
    expect(() => AnalysisSummarySchema.parse(input)).toThrow();
  });

  it("rejects winner_probability < 0", () => {
    const input = { ...validDecisionState().analysis_summary!, winner_probability: -0.1 };
    expect(() => AnalysisSummarySchema.parse(input)).toThrow();
  });

  it("accepts empty top_drivers and fragile_edge_ids", () => {
    const input = {
      winner_id: "opt_1",
      winner_probability: 0.5,
      winning_margin: 0.1,
      robustness_level: "high",
      top_drivers: [],
      fragile_edge_ids: [],
    };
    expect(AnalysisSummarySchema.parse(input)).toEqual(input);
  });
});

// ============================================================================
// DecisionState
// ============================================================================

describe("DecisionStateSchema", () => {
  it("accepts fully populated state", () => {
    const input = validDecisionState();
    const result = DecisionStateSchema.parse(input);
    expect(result.graph_summary?.node_count).toBe(5);
    expect(result.framing?.stage).toBe("evaluate_pre");
    expect(result.user_causal_claims).toHaveLength(1);
  });

  it("accepts minimal state with null optionals", () => {
    const input = {
      graph_summary: null,
      analysis_summary: null,
      event_summary: "",
      framing: null,
      user_causal_claims: [],
      unresolved_questions: [],
    };
    expect(DecisionStateSchema.parse(input)).toEqual(input);
  });

  it("framing null is valid", () => {
    const input = { ...validDecisionState(), framing: null };
    expect(DecisionStateSchema.parse(input).framing).toBeNull();
  });

  it("framing without stage is rejected", () => {
    const input = {
      ...validDecisionState(),
      framing: { goal: "Something", constraints: [] },
    };
    expect(() => DecisionStateSchema.parse(input)).toThrow();
  });

  it("framing with only stage is valid", () => {
    const input = { ...validDecisionState(), framing: { stage: "frame" } };
    expect(DecisionStateSchema.parse(input).framing?.stage).toBe("frame");
  });

  it("rejects missing event_summary", () => {
    const { event_summary: _, ...rest } = validDecisionState();
    expect(() => DecisionStateSchema.parse(rest)).toThrow();
  });

  it("accepts empty arrays for claims and questions", () => {
    const input = { ...validDecisionState(), user_causal_claims: [], unresolved_questions: [] };
    expect(DecisionStateSchema.parse(input).user_causal_claims).toEqual([]);
  });
});

// ============================================================================
// ToolOutput
// ============================================================================

describe("ToolOutputSchema", () => {
  it("accepts valid tool output", () => {
    const input = {
      tool_name: "run_analysis",
      system_fields: { seed: 42, n_samples: 10000 },
      user_originated_fields: { goal_label: "Market entry" },
    };
    expect(ToolOutputSchema.parse(input)).toEqual(input);
  });

  it("rejects extra top-level fields (strict)", () => {
    const input = {
      tool_name: "test",
      system_fields: {},
      user_originated_fields: {},
      extra_field: "should fail",
    };
    expect(() => ToolOutputSchema.parse(input)).toThrow();
  });

  it("accepts empty record fields", () => {
    const input = { tool_name: "test", system_fields: {}, user_originated_fields: {} };
    expect(ToolOutputSchema.parse(input)).toEqual(input);
  });

  it("accepts nested objects in record fields", () => {
    const input = {
      tool_name: "test",
      system_fields: { nested: { a: 1, b: [2, 3] } },
      user_originated_fields: { text: "hello" },
    };
    expect(ToolOutputSchema.parse(input)).toEqual(input);
  });
});

// ============================================================================
// ConversationTurn
// ============================================================================

describe("ConversationTurnSchema", () => {
  it("accepts user turn with tool outputs", () => {
    const input = validConversationTurn();
    expect(ConversationTurnSchema.parse(input).role).toBe("user");
  });

  it("accepts assistant turn without tool outputs", () => {
    const input = { role: "assistant" as const, content: "Here is my analysis." };
    expect(ConversationTurnSchema.parse(input).tool_outputs).toBeUndefined();
  });

  it("accepts turn with empty tool_outputs array", () => {
    const input = { role: "user" as const, content: "test", tool_outputs: [] };
    expect(ConversationTurnSchema.parse(input).tool_outputs).toEqual([]);
  });

  it("rejects invalid role", () => {
    expect(() => ConversationTurnSchema.parse({ role: "system", content: "x" })).toThrow();
  });

  it("rejects missing content", () => {
    expect(() => ConversationTurnSchema.parse({ role: "user" })).toThrow();
  });
});

// ============================================================================
// RouteProfile
// ============================================================================

describe("RouteProfileSchema", () => {
  it("accepts valid profile", () => {
    const input = validRouteProfile();
    expect(RouteProfileSchema.parse(input).route).toBe("CHAT");
  });

  it("rejects invalid route", () => {
    const input = { ...validRouteProfile(), route: "RUN_ANALYSIS" };
    expect(() => RouteProfileSchema.parse(input)).toThrow();
  });

  it("rejects zero max_turns", () => {
    const input = { ...validRouteProfile(), max_turns: 0 };
    expect(() => RouteProfileSchema.parse(input)).toThrow();
  });

  it("rejects negative token_budget", () => {
    const input = { ...validRouteProfile(), token_budget: -100 };
    expect(() => RouteProfileSchema.parse(input)).toThrow();
  });

  it("rejects non-boolean include flags", () => {
    const input = { ...validRouteProfile(), include_graph_summary: "yes" };
    expect(() => RouteProfileSchema.parse(input)).toThrow();
  });
});
