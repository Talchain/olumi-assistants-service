/**
 * Tests for the deterministic answer hierarchy in explain_results.
 *
 * Covers:
 * - classifyExplainQuestion routing (Tier 1 / Tier 2 / Tier 3)
 * - handleExplainResults Tier 1 returns cached answer, no LLM call
 * - handleExplainResults Tier 2 returns review data, no LLM call
 * - handleExplainResults Tier 3 triggers LLM
 * - Stale analysis qualifier behaviour
 * - Pre-analysis guard (no analysis → falls through to Tier 3)
 * - deterministic_answer_tier in result
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyExplainQuestion,
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
    results: [
      { option_id: "opt_a", option_label: "Option A", win_probability: 0.70 },
      { option_id: "opt_b", option_label: "Option B", win_probability: 0.30 },
    ],
    factor_sensitivity: [
      { label: "Pricing", sensitivity: 0.85, direction: "positive" },
      { label: "Market Size", sensitivity: 0.62, direction: "positive" },
      { label: "Churn Rate", sensitivity: -0.45, direction: "negative" },
    ],
    robustness: { level: "high" },
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: makeAnalysisResponse(),
    framing: { stage: "evaluate" },
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeAdapter(response = "Option A leads due to high elasticity.") {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
    model: "test-model",
    name: "test-provider",
  };
}

// ============================================================================
// classifyExplainQuestion — Tier routing
// ============================================================================

describe("classifyExplainQuestion — Tier 1 routing", () => {
  it("classifies 'who is winning' as tier1", () => {
    expect(classifyExplainQuestion("who is winning?")).toBe("tier1");
  });

  it("classifies 'who wins' as tier1", () => {
    expect(classifyExplainQuestion("who wins?")).toBe("tier1");
  });

  it("classifies 'what is the recommendation' as tier1", () => {
    expect(classifyExplainQuestion("what is the recommendation?")).toBe("tier1");
  });

  it("classifies 'what are the top drivers' as tier1", () => {
    expect(classifyExplainQuestion("what are the top drivers?")).toBe("tier1");
  });

  it("classifies 'what matters most' as tier1", () => {
    expect(classifyExplainQuestion("what matters most?")).toBe("tier1");
  });

  it("classifies 'what are the scores' as tier1", () => {
    expect(classifyExplainQuestion("what are the scores?")).toBe("tier1");
  });

  it("classifies 'how robust is this' as tier1", () => {
    expect(classifyExplainQuestion("how robust is this?")).toBe("tier1");
  });

  it("classifies 'how confident should I be' as tier1", () => {
    expect(classifyExplainQuestion("how confident should I be?")).toBe("tier1");
  });

  it("classifies 'what are the options' as tier1", () => {
    expect(classifyExplainQuestion("what are the options?")).toBe("tier1");
  });
});

describe("classifyExplainQuestion — Tier 2 routing", () => {
  it("classifies 'summarise the results' as tier2", () => {
    expect(classifyExplainQuestion("summarise the results")).toBe("tier2");
  });

  it("classifies 'what is the headline' as tier2", () => {
    expect(classifyExplainQuestion("what is the headline?")).toBe("tier2");
  });

  it("classifies 'give me an overview' as tier2", () => {
    expect(classifyExplainQuestion("give me an overview")).toBe("tier2");
  });

  it("classifies 'what did the analysis say' as tier2", () => {
    expect(classifyExplainQuestion("what did the analysis say?")).toBe("tier2");
  });

  it("classifies 'what should I do' as tier2_recommendation", () => {
    expect(classifyExplainQuestion("what should I do?")).toBe("tier2_recommendation");
  });

  it("classifies 'which should I choose' as tier2_recommendation", () => {
    expect(classifyExplainQuestion("which option should I choose?")).toBe("tier2_recommendation");
  });
});

describe("classifyExplainQuestion — Tier 3 routing (causal / LLM)", () => {
  it("classifies 'why did A win' as tier3", () => {
    expect(classifyExplainQuestion("why did A win?")).toBe("tier3");
  });

  it("classifies 'why is A leading' as tier3", () => {
    expect(classifyExplainQuestion("why is A leading?")).toBe("tier3");
  });

  it("classifies 'what would change the result' as tier3", () => {
    expect(classifyExplainQuestion("what would change the result?")).toBe("tier3");
  });

  it("classifies 'what if pricing is wrong' as tier3", () => {
    expect(classifyExplainQuestion("what if pricing is wrong?")).toBe("tier3");
  });

  it("classifies 'how does churn affect the outcome' as tier3", () => {
    expect(classifyExplainQuestion("how does churn affect the outcome?")).toBe("tier3");
  });

  it("classifies empty string as tier3", () => {
    expect(classifyExplainQuestion("")).toBe("tier3");
  });

  it("classifies vague question as tier3", () => {
    expect(classifyExplainQuestion("explain the results")).toBe("tier3");
  });
});

// ============================================================================
// handleExplainResults — Tier 1: cached deterministic answer, no LLM call
// ============================================================================

describe("handleExplainResults — Tier 1 deterministic answers", () => {
  it("returns tier1 for 'who is winning' from cached state, no LLM call", async () => {
    const adapter = makeAdapter();
    const context = makeContext();
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "who is winning?",
    );

    expect(result.deterministic_answer_tier).toBe(1);
    expect(adapter.chat).not.toHaveBeenCalled();
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("commentary");

    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("Option A");
    expect(narrative).toContain("70.0%");
  });

  it("returns tier1 for 'what are the top drivers' from sensitivity data, no LLM call", async () => {
    const adapter = makeAdapter();
    const context = makeContext();
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "what are the top drivers?",
    );

    expect(result.deterministic_answer_tier).toBe(1);
    expect(adapter.chat).not.toHaveBeenCalled();

    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("Pricing");
  });

  it("falls through to tier3 gracefully when analysis has no results", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({ results: [] }),
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "who is winning?",
    );

    // Tier 1 data insufficient — falls to Tier 3
    expect(result.deterministic_answer_tier).toBe(3);
    expect(adapter.chat).toHaveBeenCalled();
  });

  it("pre-analysis guard: no analysis_response → falls through to Tier 3", async () => {
    const adapter = makeAdapter();
    const context = makeContext({ analysis_response: null });
    // No analysis → handler throws (not explainable)
    await expect(
      handleExplainResults(context, adapter as never, "req-1", "turn-1", "who is winning?"),
    ).rejects.toThrow("No analysis results");
  });
});

// ============================================================================
// handleExplainResults — Tier 2: review data
// ============================================================================

describe("handleExplainResults — Tier 2 review data", () => {
  it("uses review data for 'summarise the results' when review cards present", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        review_cards: [
          { narrative_summary: "Option A dominates on cost efficiency. Option B is riskier." },
        ],
      }),
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "summarise the results",
    );

    expect(result.deterministic_answer_tier).toBe(2);
    expect(adapter.chat).not.toHaveBeenCalled();

    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("Option A dominates");
  });

  it("falls through to tier3 when 'summarise the results' has no review cards", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({ review_cards: [] }),
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "summarise the results",
    );

    expect(result.deterministic_answer_tier).toBe(3);
    expect(adapter.chat).toHaveBeenCalled();
  });

  it("'what should I do' with explicit recommendation uses Tier 2", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        review_cards: [
          { recommendation_summary: "Choose Option A for the best outcome given your constraints." },
        ],
      }),
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "what should I do?",
    );

    expect(result.deterministic_answer_tier).toBe(2);
    expect(adapter.chat).not.toHaveBeenCalled();

    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("Choose Option A");
  });

  it("'what should I do' without explicit recommendation falls through to Tier 3", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        review_cards: [
          { narrative_summary: "Option A is better overall." }, // no recommendation_summary
        ],
      }),
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "what should I do?",
    );

    expect(result.deterministic_answer_tier).toBe(3);
    expect(adapter.chat).toHaveBeenCalled();
  });
});

// ============================================================================
// handleExplainResults — Tier 3: LLM for causal questions
// ============================================================================

describe("handleExplainResults — Tier 3 LLM for causal questions", () => {
  it("'why did A win' triggers LLM call", async () => {
    const adapter = makeAdapter("Option A won because of strong pricing sensitivity.");
    const context = makeContext();
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "why did A win?",
    );

    expect(result.deterministic_answer_tier).toBe(3);
    expect(adapter.chat).toHaveBeenCalled();
  });

  it("undefined focus (no focus arg) uses Tier 3", async () => {
    const adapter = makeAdapter("The analysis shows...");
    const context = makeContext();
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      undefined, // no focus
    );

    expect(result.deterministic_answer_tier).toBe(3);
    expect(adapter.chat).toHaveBeenCalled();
  });
});

// ============================================================================
// Stale analysis — qualifier in deterministic answers
// ============================================================================

describe("handleExplainResults — stale analysis qualifier", () => {
  it("includes stale qualifier when stage is 'ideate' (graph changed since last run)", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      framing: { stage: "ideate" }, // isAnalysisCurrent returns false → stale
    });
    const result = await handleExplainResults(
      context,
      adapter as never,
      "req-1",
      "turn-1",
      "who is winning?",
    );

    // Should still answer deterministically (Tier 1) but with stale qualifier
    expect(result.deterministic_answer_tier).toBe(1);
    expect(adapter.chat).not.toHaveBeenCalled();

    const narrative = (result.blocks[0].data as { narrative: string }).narrative;
    expect(narrative).toContain("last analysis");
    expect(narrative).toContain("recent changes");
  });
});

// ============================================================================
// deterministic_answer_tier in result trace
// ============================================================================

describe("handleExplainResults — deterministic_answer_tier trace", () => {
  it("includes deterministic_answer_tier: 1 in Tier 1 result", async () => {
    const adapter = makeAdapter();
    const context = makeContext();
    const result = await handleExplainResults(
      context, adapter as never, "req-1", "turn-1", "who is winning?",
    );
    expect(result.deterministic_answer_tier).toBe(1);
  });

  it("includes deterministic_answer_tier: 2 in Tier 2 result", async () => {
    const adapter = makeAdapter();
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        review_cards: [{ narrative_summary: "The results are clear: Option A leads." }],
      }),
    });
    const result = await handleExplainResults(
      context, adapter as never, "req-1", "turn-1", "summarise the results",
    );
    expect(result.deterministic_answer_tier).toBe(2);
  });

  it("includes deterministic_answer_tier: 3 in Tier 3 result", async () => {
    const adapter = makeAdapter();
    const context = makeContext();
    const result = await handleExplainResults(
      context, adapter as never, "req-1", "turn-1", "why did A win?",
    );
    expect(result.deterministic_answer_tier).toBe(3);
  });
});
