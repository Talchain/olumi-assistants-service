import { describe, it, expect, vi } from "vitest";
import {
  stripUngroundedNumerics,
  buildGroundedValues,
  extractBriefNumbers,
  detectConstraintTension,
  handleExplainResults,
} from "../../../../src/orchestrator/tools/explain-results.js";
import type { V2RunResponseEnvelope, ConversationContext } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAnalysisResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    analysis_status: "completed",
    meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-1" },
    results: [{ option_label: "Option A", win_probability: 0.65 }],
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: makeAnalysisResponse(),
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeAdapter(response = "Option A leads due to high elasticity.") {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe("explain_results — numeric freehand stripping", () => {
  it("strips integers", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("The value is 42 units.");
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBeGreaterThan(0);
  });

  it("strips percentages", () => {
    const { cleaned } = stripUngroundedNumerics("Win probability is 65%.");
    expect(cleaned).toContain("[value]");
    expect(cleaned).not.toMatch(/65%/);
  });

  it("strips currency", () => {
    const { cleaned } = stripUngroundedNumerics("The cost is $20k.");
    expect(cleaned).toContain("[value]");
  });

  it("strips decimals", () => {
    const { cleaned } = stripUngroundedNumerics("Elasticity is 0.85.");
    expect(cleaned).toContain("[value]");
  });

  it("strips ranges", () => {
    const { cleaned } = stripUngroundedNumerics("Estimated 10-12 months.");
    expect(cleaned).toContain("[value]");
  });

  it("strips approximations", () => {
    const { cleaned } = stripUngroundedNumerics("Approximately 150 units.");
    expect(cleaned).toContain("[value]");
  });

  it("preserves 4-digit years", () => {
    const { cleaned } = stripUngroundedNumerics("Since 2023, the trend has changed.");
    expect(cleaned).toContain("2023");
  });

  it("preserves single-digit structural references", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("There are 3 options.");
    expect(cleaned).toContain("3");
    expect(strippedCount).toBe(0);
  });

  it("returns zero stripped count when no numerics found", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics("No numbers here.");
    expect(cleaned).toBe("No numbers here.");
    expect(strippedCount).toBe(0);
  });
});

describe("explain_results — grounded-set numeric stripping", () => {
  const analysisWithData = makeAnalysisResponse({
    results: [
      { option_label: "Option A", win_probability: 0.62 },
      { option_label: "Option B", win_probability: 0.38, goal_value: { mean: 18500, p10: 14200, p90: 22800 } },
    ] as unknown as V2RunResponseEnvelope["results"],
    factor_sensitivity: [
      { label: "Market demand", elasticity: 0.85, direction: "positive" },
    ] as unknown as V2RunResponseEnvelope["factor_sensitivity"],
    meta: { seed_used: 42, n_samples: 10000, response_hash: "hash-1" },
    constraint_analysis: {
      joint_probability: 0.45,
      per_constraint: [{ probability: 0.8 }, { probability: 0.7 }],
    },
  });

  it("preserves grounded percentage (62%) from win_probability 0.62", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads with 62% win probability.",
      analysisWithData,
    );
    expect(cleaned).toContain("62%");
    expect(strippedCount).toBe(0);
  });

  it("preserves grounded decimal (0.62)", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Win probability is 0.62 for Option A.",
      analysisWithData,
    );
    expect(cleaned).toContain("0.62");
  });

  it("preserves rounded percentage (63%) from 0.625-like rounding", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Option A has approximately 62% probability.",
      analysisWithData,
    );
    expect(cleaned).toContain("62%");
  });

  it("preserves grounded currency (£18,500) from goal_value.mean", () => {
    const { cleaned } = stripUngroundedNumerics(
      "The expected outcome is £18,500.",
      analysisWithData,
    );
    expect(cleaned).toContain("£18,500");
  });

  it("preserves grounded range (14,200-22,800) from p10/p90", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Range is between 14200 and 22800.",
      analysisWithData,
    );
    expect(cleaned).toContain("14200");
    expect(cleaned).toContain("22800");
  });

  it("preserves grounded elasticity (0.85)", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Market demand has an elasticity of 0.85.",
      analysisWithData,
    );
    expect(cleaned).toContain("0.85");
  });

  it("preserves grounded sample count (10,000)", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Based on 10,000 simulations.",
      analysisWithData,
    );
    expect(cleaned).toContain("10,000");
  });

  it("strips ungrounded numbers that do not appear in analysis", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "There is a 87% chance this saves $50,000 annually.",
      analysisWithData,
    );
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBe(2);
  });

  it("preserves grounded while stripping ungrounded in the same text", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads with 62% probability. This could save approximately 150 units.",
      analysisWithData,
    );
    expect(cleaned).toContain("62%");
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBe(1);
  });

  it("preserves constraint joint probability (45%)", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Joint constraint probability is 45%.",
      analysisWithData,
    );
    expect(cleaned).toContain("45%");
  });

  it("preserves grounded values from option_comparison (raw PLoT shape)", () => {
    const plotResponse = {
      analysis_status: "computed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-1" },
      results: [],
      option_comparison: [
        { option_label: "Option A", win_probability: 0.62 },
        { option_label: "Option B", win_probability: 0.38 },
      ],
      factor_sensitivity: [
        { label: "Market demand", elasticity: 0.85, direction: "positive" },
      ],
    } as unknown as V2RunResponseEnvelope;
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads with 62% win probability. This could save $50,000.",
      plotResponse,
    );
    expect(cleaned).toContain("62%");
    expect(cleaned).toContain("[value]"); // $50,000 is ungrounded
    expect(strippedCount).toBe(1);
  });

  it("backward compatible: strips all when no analysis provided", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads with 62% probability.",
    );
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBeGreaterThan(0);
  });

  it("preserves grounded 'percent' word form (62 percent)", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads with 62 percent win probability.",
      analysisWithData,
    );
    expect(cleaned).toContain("62 percent");
    expect(strippedCount).toBe(0);
  });

  it("preserves grounded negative elasticity (-0.4)", () => {
    const analysisWithNeg = makeAnalysisResponse({
      results: [{ option_label: "A", win_probability: 0.5 }] as unknown as V2RunResponseEnvelope["results"],
      factor_sensitivity: [
        { label: "Cost", elasticity: -0.4, direction: "negative" },
      ] as unknown as V2RunResponseEnvelope["factor_sensitivity"],
    });
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Cost has a negative elasticity of -0.4.",
      analysisWithNeg,
    );
    expect(cleaned).toContain("-0.4");
    expect(strippedCount).toBe(0);
  });

  it("preserves absolute value of negative grounded number (0.4 from -0.4)", () => {
    const analysisWithNeg = makeAnalysisResponse({
      results: [{ option_label: "A", win_probability: 0.5 }] as unknown as V2RunResponseEnvelope["results"],
      factor_sensitivity: [
        { label: "Cost", elasticity: -0.4, direction: "negative" },
      ] as unknown as V2RunResponseEnvelope["factor_sensitivity"],
    });
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Cost elasticity magnitude is 0.4.",
      analysisWithNeg,
    );
    expect(cleaned).toContain("0.4");
    expect(strippedCount).toBe(0);
  });
});

describe("explain_results — buildGroundedValues", () => {
  it("includes percentage forms of win_probability", () => {
    const response = makeAnalysisResponse({
      results: [{ option_label: "A", win_probability: 0.625 }] as unknown as V2RunResponseEnvelope["results"],
    });
    const values = buildGroundedValues(response);
    expect(values.has("62")).toBe(true);  // floor
    expect(values.has("63")).toBe(true);  // ceil
    expect(values.has("62.5")).toBe(true); // exact
    expect(values.has("0.625")).toBe(true); // raw
  });

  it("includes n_samples from meta", () => {
    const response = makeAnalysisResponse();
    const values = buildGroundedValues(response);
    expect(values.has("1000")).toBe(true);
    expect(values.has("1,000")).toBe(true);
  });

  it("includes goal_value fields", () => {
    const response = makeAnalysisResponse({
      results: [{ option_label: "A", win_probability: 0.5, goal_value: { mean: 18500, p10: 14200, p90: 22800 } }] as unknown as V2RunResponseEnvelope["results"],
    });
    const values = buildGroundedValues(response);
    expect(values.has("18500")).toBe(true);
    expect(values.has("18,500")).toBe(true);
    expect(values.has("18.5k")).toBe(true);
    expect(values.has("14200")).toBe(true);
    expect(values.has("22800")).toBe(true);
  });

  it("includes both signed and absolute forms for negative elasticity", () => {
    const response = makeAnalysisResponse({
      factor_sensitivity: [
        { label: "Cost", elasticity: -0.4, direction: "negative" },
      ] as unknown as V2RunResponseEnvelope["factor_sensitivity"],
    });
    const values = buildGroundedValues(response);
    expect(values.has("-0.4")).toBe(true);  // signed
    expect(values.has("0.4")).toBe(true);   // absolute
    expect(values.has("40")).toBe(true);    // percentage of abs
  });

  it("reads option_comparison when results is empty (raw PLoT shape)", () => {
    const response = {
      analysis_status: "computed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-1" },
      results: [],
      option_comparison: [
        { option_label: "Option A", win_probability: 0.65 },
        { option_label: "Option B", win_probability: 0.35 },
      ],
    } as unknown as V2RunResponseEnvelope;
    const values = buildGroundedValues(response);
    expect(values.has("65")).toBe(true);
    expect(values.has("35")).toBe(true);
    expect(values.has("0.65")).toBe(true);
  });
});

describe("explain_results — constraint tension detection", () => {
  it("detects tension when joint < min(individual) × 0.7", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.3,
        per_constraint: [
          { probability: 0.8 },
          { probability: 0.9 },
        ],
      },
    } as unknown as V2RunResponseEnvelope;

    const note = detectConstraintTension(response);
    expect(note).not.toBeNull();
    expect(note).toContain("in tension");
  });

  it("returns null when no tension", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.7,
        per_constraint: [
          { probability: 0.8 },
          { probability: 0.9 },
        ],
      },
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });

  it("returns null when constraint_analysis absent", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });

  it("returns null when no per_constraint data", () => {
    const response = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      constraint_analysis: {
        joint_probability: 0.3,
      },
    } as unknown as V2RunResponseEnvelope;

    expect(detectConstraintTension(response)).toBeNull();
  });
});

// ============================================================================
// Tests: handleExplainResults handler
// ============================================================================

describe("handleExplainResults handler", () => {
  it("throws TOOL_EXECUTION_FAILED when analysis_response is null", async () => {
    const context = makeContext({ analysis_response: null });
    const adapter = makeAdapter();

    await expect(
      handleExplainResults(context, adapter as never, "req-1", "turn-1"),
    ).rejects.toThrow("No analysis results to explain");
  });

  it("throws with orchestratorError.code TOOL_EXECUTION_FAILED when no analysis", async () => {
    const context = makeContext({ analysis_response: null });
    const adapter = makeAdapter();

    try {
      await handleExplainResults(context, adapter as never, "req-1", "turn-1");
    } catch (error) {
      expect((error as { orchestratorError: { code: string } }).orchestratorError?.code)
        .toBe("TOOL_EXECUTION_FAILED");
    }
  });

  it("returns a commentary block on success", async () => {
    const context = makeContext();
    const adapter = makeAdapter("Option A is the clear winner.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
    expect(result.assistantText).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("passes the user message with focus to the adapter", async () => {
    const context = makeContext();
    const adapter = makeAdapter("Sensitivity analysis shows...");

    await handleExplainResults(context, adapter as never, "req-1", "turn-1", "sensitivity");

    const calls = adapter.chat.mock.calls;
    expect(calls).toHaveLength(1);
    const userMsg = calls[0][0].userMessage as string;
    expect(userMsg).toContain("sensitivity");
  });

  it("passes plain explain message when no focus", async () => {
    const context = makeContext();
    const adapter = makeAdapter("Here are the results.");

    await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    const userMsg = adapter.chat.mock.calls[0][0].userMessage as string;
    expect(userMsg).toContain("Explain the analysis results");
    expect(userMsg).not.toContain("focusing on");
  });

  it("strips ungrounded numerics from LLM output", async () => {
    const context = makeContext();
    // Response contains a freehand numeric that should be stripped
    const adapter = makeAdapter("Option A wins with 87% probability.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    const block = result.blocks[0];
    const narrative = (block.data as { narrative: string }).narrative;
    // 87% should be replaced with [value]
    expect(narrative).not.toContain("87%");
    expect(narrative).toContain("[value]");
  });

  it("gracefully degrades with tiered fallback when LLM throws", async () => {
    const context = makeContext();
    const adapter = {
      chat: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    // Should return a fallback block instead of throwing
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
    // Tier 1: winner exists in default fixture → short explanation
    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("Option A leads at");
  });

  it("supporting_refs ref_ids all correspond to fact_ids from the analysis response", async () => {
    const factId = "sensitivity_market_demand";
    const analysisResponse = makeAnalysisResponse({
      fact_objects: [
        { fact_id: factId, fact_type: "sensitivity_rank", value: 0.9 } as unknown as V2RunResponseEnvelope["fact_objects"] extends (infer T)[] | undefined ? T : never,
      ],
    } as Partial<V2RunResponseEnvelope>);
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = makeAdapter("The top driver is market demand.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    const block = result.blocks[0];
    const data = block.data as { narrative: string; supporting_refs: Array<{ ref_type: string; ref_id: string; claim: string }> };
    // Every ref_id must exist in the analysis response's fact_objects
    const knownFactIds = new Set(
      (analysisResponse.fact_objects as Array<{ fact_id: string }> | undefined ?? []).map((f) => f.fact_id),
    );
    for (const ref of data.supporting_refs) {
      if (ref.ref_type === "fact") {
        expect(knownFactIds.has(ref.ref_id), `Unknown fact_id in supporting_refs: ${ref.ref_id}`).toBe(true);
      }
    }
  });

  it("preserves 4-digit years in LLM output (grounded structure, not analysis value)", async () => {
    const context = makeContext();
    // Response contains a year — should NOT be stripped
    const adapter = makeAdapter("Since 2023, this trend has accelerated.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    const block = result.blocks[0];
    const narrative = (block.data as { narrative: string }).narrative;
    expect(narrative).toContain("2023");
  });

  it("returns graceful fallback when analysis_response has null results", async () => {
    const analysisResponse = makeAnalysisResponse({
      results: null as unknown as V2RunResponseEnvelope["results"],
    });
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = makeAdapter("Some explanation.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
    expect((result.blocks[0].data as { narrative: string }).narrative).toContain("completed, explainable analysis");
    expect(adapter.chat).not.toHaveBeenCalled();
  });

  it("handles results missing win_probability without crashing", async () => {
    const analysisResponse = makeAnalysisResponse({
      results: [
        { option_label: "Option A" } as unknown as V2RunResponseEnvelope["results"][number],
        { option_label: "Option B", win_probability: 0.4 } as unknown as V2RunResponseEnvelope["results"][number],
      ] as V2RunResponseEnvelope["results"],
    });
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = makeAdapter("Option B is the leader.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
  });

  it("handles empty factor_sensitivity without crashing", async () => {
    const analysisResponse = makeAnalysisResponse({
      factor_sensitivity: [] as unknown as V2RunResponseEnvelope["factor_sensitivity"],
    });
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = makeAdapter("No major drivers detected.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
  });

  it("returns Tier 2 generic fallback when LLM throws and no valid results for Tier 1", async () => {
    const analysisResponse = makeAnalysisResponse({
      results: [] as V2RunResponseEnvelope["results"],
      factor_sensitivity: [{ label: "Market demand" }] as V2RunResponseEnvelope["factor_sensitivity"],
    });
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = {
      chat: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("fuller explanation");
  });

  it("returns stale guidance when analysis is not current", async () => {
    const context = makeContext({
      framing: { stage: "ideate" },
    });
    const adapter = makeAdapter("Some explanation.");

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect((result.blocks[0].data as { narrative: string }).narrative).toContain("graph has changed since that run");
    expect(adapter.chat).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: extractBriefNumbers
// ============================================================================

describe("extractBriefNumbers", () => {
  it("extracts currency-adjacent numbers (£50,000)", () => {
    const values = extractBriefNumbers("MRR target of £50,000 within 6 months");
    expect(values.has("50000")).toBe(true);
    expect(values.has("50,000")).toBe(true);
    expect(values.has("50k")).toBe(true);
  });

  it("extracts timeline numbers adjacent to 'months'", () => {
    const values = extractBriefNumbers("MRR target of £50,000 within 6 months");
    expect(values.has("6")).toBe(true);
  });

  it("extracts percentage numbers", () => {
    const values = extractBriefNumbers("revenue growth of 15%");
    expect(values.has("15")).toBe(true);
  });

  it("does NOT extract casual context numbers without decision-relevant nouns", () => {
    const values = extractBriefNumbers("I spent 3 weeks thinking about this");
    expect(values.has("3")).toBe(false);
  });

  it("does NOT extract 'team of 12 engineers' without headcount noun", () => {
    const values = extractBriefNumbers("my team of 12 engineers built the prototype");
    expect(values.has("12")).toBe(false);
  });

  it("extracts 'headcount of 12' with decision-relevant noun", () => {
    const values = extractBriefNumbers("headcount of 12 people in the department");
    expect(values.has("12")).toBe(true);
  });

  it("extracts dollar amounts ($200)", () => {
    const values = extractBriefNumbers("subscription price of $200 per month");
    expect(values.has("200")).toBe(true);
  });

  it("extracts large currency values with k/m forms", () => {
    const values = extractBriefNumbers("budget of $1,500,000 for the project");
    expect(values.has("1500000")).toBe(true);
    expect(values.has("1.5m")).toBe(true);
  });

  it("extracts multiple numbers from a complex brief", () => {
    const brief = "We want to reach £50,000 MRR within 6 months. Current churn is 5% and we charge $99 per user.";
    const values = extractBriefNumbers(brief);
    expect(values.has("50000")).toBe(true);
    expect(values.has("6")).toBe(true);
    expect(values.has("5")).toBe(true);
    expect(values.has("99")).toBe(true);
  });

  it("returns empty set for empty/null brief", () => {
    expect(extractBriefNumbers("").size).toBe(0);
  });
});

// ============================================================================
// Tests: stripUngroundedNumerics with brief context
// ============================================================================

describe("stripUngroundedNumerics — brief-context grounding", () => {
  const analysisWithData = makeAnalysisResponse({
    results: [
      { option_label: "Option A", win_probability: 0.62 },
    ] as unknown as V2RunResponseEnvelope["results"],
  });

  it("preserves brief-context MRR target (£50,000) in LLM output", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "The goal of £50,000 MRR within 6 months is achievable.",
      analysisWithData,
      "MRR target of £50,000 within 6 months",
    );
    expect(cleaned).toContain("£50,000");
    expect(cleaned).toContain("6");
    expect(strippedCount).toBe(0);
  });

  it("preserves brief percentage (15%) in LLM output", () => {
    const { cleaned } = stripUngroundedNumerics(
      "Revenue growth of 15% is within reach.",
      analysisWithData,
      "revenue growth of 15%",
    );
    expect(cleaned).toContain("15%");
  });

  it("still strips numbers not in analysis or brief", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "This could generate $999,000 in savings.",
      analysisWithData,
      "MRR target of £50,000",
    );
    expect(cleaned).toContain("[value]");
    expect(strippedCount).toBe(1);
  });

  it("preserves both analysis and brief numbers in the same text", () => {
    const { cleaned, strippedCount } = stripUngroundedNumerics(
      "Option A leads at 62% — well on track for the £50,000 MRR target.",
      analysisWithData,
      "MRR target of £50,000 within 6 months",
    );
    expect(cleaned).toContain("62%");
    expect(cleaned).toContain("£50,000");
    expect(strippedCount).toBe(0);
  });
});
