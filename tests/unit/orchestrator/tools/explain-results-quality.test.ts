/**
 * Tests for explain_results response quality fixes.
 *
 * Covers:
 * - Task 1: assistant_text ≠ commentary narrative (headline separation)
 * - Task 2: Driver fabrication guard in buildExplanationPrompt
 * - Task 3: Context-aware chip selection (max 3)
 * - Task 5: Placeholder token stripping
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractHeadline,
  buildExplainChips,
  buildExplanationPrompt,
  buildDriverGuard,
  stripPlaceholderTokens,
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
      { label: "Pricing", sensitivity: 0.85, direction: "positive", elasticity: 0.9 },
      { label: "Market Size", sensitivity: 0.62, direction: "positive", elasticity: 0.6 },
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

function makeAdapter(response = "Option A leads due to high elasticity. The model shows strong pricing sensitivity across all scenarios.") {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
    model: "test-model",
    name: "test-provider",
  };
}

// ============================================================================
// Task 1: Headline separation
// ============================================================================

describe("Task 1 — assistant_text headline separation", () => {
  it("extractHeadline never exceeds 200 chars", () => {
    const longText = "A".repeat(300) + ". More text here.";
    const headline = extractHeadline(longText);
    expect(headline.length).toBeLessThanOrEqual(200);
  });

  it("extractHeadline never starts with #", () => {
    const mdText = "## Weakest Relationships in the Model\nOption A leads at 70%. More details follow.";
    const headline = extractHeadline(mdText);
    expect(headline.startsWith("#")).toBe(false);
  });

  it("extractHeadline strips markdown headers", () => {
    const mdText = "### Analysis Summary\nThe leading option is A with strong margins.";
    const headline = extractHeadline(mdText);
    expect(headline).not.toContain("###");
    expect(headline).toBe("The leading option is A with strong margins.");
  });

  it("extractHeadline strips markdown header preceded by leading whitespace/newlines", () => {
    const text = "  \n## Weakest Relationships\nOption A leads.";
    const headline = extractHeadline(text);
    expect(headline.startsWith("#")).toBe(false);
    expect(headline).toBe("Option A leads.");
  });

  it("extractHeadline forces truncation when headline equals full narrative (single-sentence)", () => {
    // Single sentence > 80 chars — headline must differ from narrative
    const singleSentence = "Option A leads with strong fundamentals across all tested scenarios and market conditions in the model.";
    expect(singleSentence.length).toBeGreaterThan(80);
    const headline = extractHeadline(singleSentence);
    expect(headline).not.toBe(singleSentence);
    expect(headline.length).toBeLessThanOrEqual(80);
    expect(headline.endsWith("...")).toBe(true);
  });

  it("extractHeadline does not truncate short single-sentence text (<=80 chars)", () => {
    const shortSentence = "Option A leads at 70%.";
    expect(shortSentence.length).toBeLessThanOrEqual(80);
    const headline = extractHeadline(shortSentence);
    // Short single-sentence is fine — duplication is acceptable for very short text
    expect(headline).toBe("Option A leads at 70%.");
  });

  it("extractHeadline truncates at first period within 150 chars", () => {
    const text = "Option A wins. More detailed analysis follows with extensive explanation.";
    expect(extractHeadline(text)).toBe("Option A wins.");
  });

  it("extractHeadline truncates long text without sentence boundary at 150 chars", () => {
    const text = "A".repeat(200);
    const headline = extractHeadline(text);
    expect(headline.length).toBe(150);
    expect(headline.endsWith("...")).toBe(true);
  });

  it("assistant_text and commentary narrative are not equal for Tier 3", async () => {
    const longResponse = "## Analysis Overview\nOption A leads at 70% win probability. The model shows that Pricing is the strongest driver with elasticity of 0.9. Market Size also contributes significantly.";
    const adapter = makeAdapter(longResponse);
    const context = makeContext();
    const result = await handleExplainResults(
      context, adapter as never, "req-1", "turn-1", "why does A win?",
    );
    expect(result.assistantText).not.toBeNull();
    // Commentary block contains the full response
    const narrative = (result.blocks[0] as Record<string, unknown>).data;
    const narrativeData = narrative as Record<string, unknown>;
    const fullNarrative = narrativeData?.narrative as string | undefined;
    if (fullNarrative && result.assistantText) {
      expect(result.assistantText).not.toBe(fullNarrative);
      expect(fullNarrative.length).toBeGreaterThan(result.assistantText.length);
    }
  });
});

// ============================================================================
// Task 2: Driver fabrication guard
// ============================================================================

describe("Task 2 — driver fabrication guard", () => {
  it("buildDriverGuard detects empty top_drivers and zero sensitivity_concentration", () => {
    const response = makeAnalysisResponse({
      factor_sensitivity: undefined,
    }) as unknown as V2RunResponseEnvelope;
    // Remove sensitivity_concentration (default absent)
    const guard = buildDriverGuard(response);
    expect(guard.topDriversEmpty).toBe(true);
    expect(guard.sensitivityZero).toBe(true);
  });

  it("buildDriverGuard detects populated drivers", () => {
    const response = makeAnalysisResponse();
    const guard = buildDriverGuard(response);
    expect(guard.topDriversEmpty).toBe(false);
  });

  it("guard text is present in prompt when drivers empty and sensitivity zero", () => {
    const prompt = buildExplanationPrompt(
      "Option comparison: A 70%, B 30%",
      null,
      undefined,
      undefined,
      { topDriversEmpty: true, sensitivityZero: true },
    );
    expect(prompt).toContain("Driver and sensitivity data is not available");
    expect(prompt).toContain("Do not explain which factors drive the result");
  });

  it("guard text is absent when drivers populated", () => {
    const prompt = buildExplanationPrompt(
      "Option comparison: A 70%, B 30%",
      null,
      undefined,
      undefined,
      { topDriversEmpty: false, sensitivityZero: false },
    );
    expect(prompt).not.toContain("Driver and sensitivity data is not available");
  });

  it("guard text is absent when no driverGuard provided", () => {
    const prompt = buildExplanationPrompt(
      "Option comparison: A 70%, B 30%",
      null,
    );
    expect(prompt).not.toContain("Driver and sensitivity data is not available");
  });
});

// ============================================================================
// Task 3: Context-aware chips
// ============================================================================

describe("Task 3 — context-aware chips", () => {
  it("chip count never exceeds 3", () => {
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "fragile" },
        factor_sensitivity: [
          { label: "Pricing", sensitivity: 0.85 },
          { label: "Market", sensitivity: 0.6 },
        ],
      }),
    });
    const chips = buildExplainChips(context);
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it("includes stress-test chip when robustness is fragile", () => {
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "fragile" },
      }),
    });
    const chips = buildExplainChips(context);
    expect(chips.some(c => c.label.includes("Stress-test"))).toBe(true);
  });

  it("includes stress-test chip when robustness is moderate", () => {
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "moderate" },
      }),
    });
    const chips = buildExplainChips(context);
    expect(chips.some(c => c.label.includes("Stress-test"))).toBe(true);
  });

  it("includes driver-specific chip when top_drivers populated", () => {
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        factor_sensitivity: [
          { label: "Revenue Growth", sensitivity: 0.9 },
        ],
      }),
    });
    const chips = buildExplainChips(context);
    expect(chips.some(c => c.label.includes("Revenue Growth"))).toBe(true);
  });

  it("falls back to generic chip when no conditions match", () => {
    const context = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "high" },
        factor_sensitivity: undefined,
      }) as unknown as V2RunResponseEnvelope,
    });
    const chips = buildExplainChips(context);
    expect(chips.some(c => c.label.includes("What does this result mean"))).toBe(true);
  });

  it("chips vary between fragile and stable analysis states", () => {
    const fragileContext = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "fragile" },
        factor_sensitivity: undefined,
      }) as unknown as V2RunResponseEnvelope,
    });
    const stableContext = makeContext({
      analysis_response: makeAnalysisResponse({
        robustness: { level: "high" },
        factor_sensitivity: [{ label: "Pricing", sensitivity: 0.9 }],
      }),
    });
    const fragileChips = buildExplainChips(fragileContext);
    const stableChips = buildExplainChips(stableContext);
    const fragileLabels = fragileChips.map(c => c.label).sort();
    const stableLabels = stableChips.map(c => c.label).sort();
    expect(fragileLabels).not.toEqual(stableLabels);
  });

  it("chips vary between drivers present and absent", () => {
    const withDrivers = makeContext({
      analysis_response: makeAnalysisResponse({
        factor_sensitivity: [{ label: "Pricing", sensitivity: 0.9 }],
      }),
    });
    const withoutDrivers = makeContext({
      analysis_response: makeAnalysisResponse({
        factor_sensitivity: undefined,
      }) as unknown as V2RunResponseEnvelope,
    });
    const chipsWithDrivers = buildExplainChips(withDrivers);
    const chipsWithoutDrivers = buildExplainChips(withoutDrivers);
    expect(chipsWithDrivers.map(c => c.label)).not.toEqual(chipsWithoutDrivers.map(c => c.label));
  });
});

// ============================================================================
// Task 5: Placeholder token stripping
// ============================================================================

describe("Task 5 — placeholder token stripping", () => {
  it("strips [value] from text", () => {
    const result = stripPlaceholderTokens("The cost is [value] per unit.");
    expect(result).not.toContain("[value]");
    expect(result).toContain("the relevant figure");
  });

  it("strips [number] from text", () => {
    const result = stripPlaceholderTokens("Expected [number] customers.");
    expect(result).not.toContain("[number]");
  });

  it("strips [X] from text", () => {
    const result = stripPlaceholderTokens("Factor [X] drives the result.");
    expect(result).not.toContain("[X]");
  });

  it("strips [placeholder] from text", () => {
    const result = stripPlaceholderTokens("Use [placeholder] here.");
    expect(result).not.toContain("[placeholder]");
  });

  it("strips [TBD] and [TODO] from text", () => {
    const result = stripPlaceholderTokens("Status: [TBD] and [TODO] items remain.");
    expect(result).not.toContain("[TBD]");
    expect(result).not.toContain("[TODO]");
  });

  it("is case-insensitive", () => {
    const result = stripPlaceholderTokens("The [VALUE] is [Value].");
    expect(result).not.toMatch(/\[(?:value|VALUE|Value)\]/);
  });

  it("strips multiple occurrences", () => {
    const result = stripPlaceholderTokens("From [value] to [value] range.");
    expect(result).not.toContain("[value]");
    expect(result).toBe("From the relevant figure to the relevant figure range.");
  });

  it("preserves non-placeholder brackets", () => {
    const result = stripPlaceholderTokens("The [company] expanded.");
    expect(result).toContain("[company]");
  });

  it("response envelope contains no bracket-placeholder patterns", async () => {
    const responseWithPlaceholders = "The win probability is [value] and the driver shows [number] impact.";
    const adapter = makeAdapter(responseWithPlaceholders);
    const context = makeContext();
    const result = await handleExplainResults(
      context, adapter as never, "req-1", "turn-1", "why does A win?",
    );
    const placeholderPattern = /\[(?:value|number|X|placeholder|TBD|TODO)\]/i;
    if (result.assistantText) {
      expect(result.assistantText).not.toMatch(placeholderPattern);
    }
    const block = result.blocks[0] as Record<string, unknown>;
    const data = block.data as Record<string, unknown>;
    if (data?.narrative) {
      expect(data.narrative as string).not.toMatch(placeholderPattern);
    }
  });
});
