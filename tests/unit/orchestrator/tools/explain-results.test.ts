import { describe, it, expect, vi } from "vitest";
import {
  stripUngroundedNumerics,
  detectConstraintTension,
  handleExplainResults,
} from "../../../../src/orchestrator/tools/explain-results.js";
import type { V2RunResponseEnvelope, ConversationContext } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAnalysisResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
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

    // Should still produce a valid block — buildAnalysisSummary won't crash
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
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
    });
    const context = makeContext({ analysis_response: analysisResponse });
    const adapter = {
      chat: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const result = await handleExplainResults(context, adapter as never, "req-1", "turn-1");

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");
    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    // Tier 2: no winner extractable → generic message
    expect(narrative).toContain("unable to generate a detailed explanation");
  });
});
