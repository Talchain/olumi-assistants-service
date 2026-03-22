/**
 * Artefact Detection Heuristic Tests
 *
 * Tests for isArtefactLikely() — determines whether the artefact design
 * appendix should be injected into the system prompt for a given user message.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { isArtefactLikely } from "../../../src/orchestrator/intent-gate.js";
import { assembleV2SystemPrompt, _resetArtefactAppendixCache } from "../../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js";
import type { EnrichedContext } from "../../../src/orchestrator/pipeline/types.js";

// ============================================================================
// Chip message patterns — must return true
// ============================================================================

describe("isArtefactLikely — chip messages", () => {
  it.each([
    "Assess these options",
    "Show me a decision matrix",
    "Visualise sensitivity",
    "Visualize sensitivity",
    "Show me the sensitivity breakdown",
    "Compare options",
    "Compare options side by side",
    "Run pre-mortem exercise",
  ])("returns true for chip message: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(true);
  });
});

// ============================================================================
// Natural language triggers — must return true
// ============================================================================

describe("isArtefactLikely — natural language triggers", () => {
  it.each([
    "create a comparison table for all options",
    "build me a SWOT analysis please",
    "I'd like a scoring rubric for these options",
    "can you visualise the results for me",
    "show me a chart of the sensitivity",
    "graph the key factors for me please",
    "let me see a matrix of the trade-offs",
    "I want a pros and cons list for each option",
  ])("returns true for NL trigger: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(true);
  });
});

// ============================================================================
// Verb prefix + visual noun — must return true
// ============================================================================

describe("isArtefactLikely — verb prefix with visual noun", () => {
  it.each([
    "create a table comparing all options",
    "generate a chart showing sensitivity",
    "build a matrix of factors and options",
    "make a diagram of the causal relationships",
    "create a comparison of the three options",
    "generate a visualisation of the results",
    "build a visualization of outcomes",
    "make a rubric for scoring these options",
    "create a pre-mortem exercise for the team",
  ])("returns true for verb prefix + visual noun: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(true);
  });
});

// ============================================================================
// Verb prefix WITHOUT visual noun — must return false
// ============================================================================

describe("isArtefactLikely — verb prefix with non-visual noun", () => {
  it.each([
    "create a model for this decision",
    "generate a brief for the team",
    "build a plan for the next quarter",
    "make a report on the findings",
    "create a summary of the analysis",
  ])("returns false for verb prefix + non-visual noun: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(false);
  });
});

// ============================================================================
// Questions — must return false
// ============================================================================

describe("isArtefactLikely — questions excluded", () => {
  it.each([
    "what is the current recommendation",
    "what are the key factors driving this",
    "how does pricing affect the outcome",
    "how do the options compare overall",
    "why did the analysis change the result",
    "why does outsourcing win in this scenario",
  ])("returns false for question: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(false);
  });
});

// ============================================================================
// Edit instructions — must return false
// ============================================================================

describe("isArtefactLikely — edit instructions excluded", () => {
  it.each([
    "set budget to 150k for the model",
    "add a factor for regulatory risk",
    "remove the outsourcing option from the model",
  ])("returns false for edit instruction: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(false);
  });
});

// ============================================================================
// Analysis requests — must return false
// ============================================================================

describe("isArtefactLikely — analysis requests excluded", () => {
  it.each([
    "run the analysis on the updated model",
    "analyse the options with the new data",
    "analyze the trade-offs for this decision",
    "please run analysis with current values",
  ])("returns false for analysis request: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(false);
  });
});

// ============================================================================
// Short messages — must return false (under 5 words, no chip match)
// ============================================================================

describe("isArtefactLikely — short messages excluded", () => {
  it.each([
    "hello",
    "ok",
    "yes",
    "thanks",
    "what next",
    "show me",
    "help me",
  ])("returns false for short message: %j", (message) => {
    expect(isArtefactLikely(message)).toBe(false);
  });
});

// ============================================================================
// Case insensitivity
// ============================================================================

describe("isArtefactLikely — case insensitive", () => {
  it("handles mixed case", () => {
    expect(isArtefactLikely("Create A Comparison Table For Me")).toBe(true);
    expect(isArtefactLikely("VISUALISE THE RESULTS FOR ME")).toBe(true);
    expect(isArtefactLikely("Build A SWOT Analysis For This Decision")).toBe(true);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("isArtefactLikely — edge cases", () => {
  it("returns false for empty string", () => {
    expect(isArtefactLikely("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(isArtefactLikely("   ")).toBe(false);
  });

  it("handles punctuation in messages", () => {
    expect(isArtefactLikely("Can you create a comparison table?")).toBe(true);
    expect(isArtefactLikely("I need a scoring rubric, please!")).toBe(true);
  });

  it("chip match overrides short-message exclusion", () => {
    // "decision matrix" is a chip pattern and has only 2 words
    // but chip check runs before word count gate
    expect(isArtefactLikely("decision matrix")).toBe(true);
  });
});

// ============================================================================
// Prompt assembly — artefact appendix injection
// ============================================================================

/**
 * Minimal EnrichedContext fixture for prompt assembly tests.
 * Only the fields read by assembleV2SystemPrompt are populated.
 */
function makeMinimalContext(): EnrichedContext {
  return {
    stage_indicator: { stage: 'frame', confidence: 'medium', source: 'inferred' },
    framing: null,
    graph: null,
    graph_compact: undefined,
    analysis: null,
    analysis_response: undefined,
    conversation_history: [],
    selected_elements: null,
    decision_continuity: undefined,
    referenced_entities: undefined,
    entity_state_map: undefined,
    event_log_summary: undefined,
    intent_classification: 'conversational',
    decision_archetype: { type: null, confidence: 'low', evidence: 'none' },
    stuck: { detected: false, rescue_routes: [] },
    dsk: { bundle: null, version_hash: null },
    scenario_id: 'sc-test',
    turn_id: 'turn-test',
    analysis_inputs: undefined,
    conversational_state: undefined,
    gap_summary: undefined,
    voi_ranking: undefined,
    edge_e_values: undefined,
    conditional_winners: undefined,
    inference_warnings: undefined,
    plot_critiques: undefined,
    progress_markers: undefined,
  } as unknown as EnrichedContext;
}

describe("assembleV2SystemPrompt — artefact appendix injection", () => {
  beforeEach(() => {
    _resetArtefactAppendixCache();
  });

  it("includes appendix in text when injectArtefactAppendix is true", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: true });
    expect(result.text).toContain("ARTEFACT_DESIGN_APPENDIX");
  });

  it("excludes appendix from text when injectArtefactAppendix is false", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: false });
    expect(result.text).not.toContain("ARTEFACT_DESIGN_APPENDIX");
  });

  it("excludes appendix when no options provided", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx);
    expect(result.text).not.toContain("ARTEFACT_DESIGN_APPENDIX");
  });

  it("includes appendix in cache_blocks when injectArtefactAppendix is true", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: true });
    // Should have 3 blocks: Zone 1 (cached), Zone 2, appendix
    expect(result.cache_blocks.length).toBe(3);
    const appendixBlock = result.cache_blocks[2];
    expect(appendixBlock.text).toContain("ARTEFACT_DESIGN_APPENDIX");
    // Appendix block should NOT have cache_control (it varies per turn)
    expect(appendixBlock.cache_control).toBeUndefined();
  });

  it("has only 2 cache_blocks when appendix is not injected", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: false });
    expect(result.cache_blocks.length).toBe(2);
  });

  it("Zone 1 cache_block has cache_control regardless of appendix", async () => {
    const ctx = makeMinimalContext();
    const withAppendix = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: true });
    const withoutAppendix = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: false });
    expect(withAppendix.cache_blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(withoutAppendix.cache_blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it("non-artefact turns have smaller system prompt", async () => {
    const ctx = makeMinimalContext();
    const withAppendix = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: true });
    const withoutAppendix = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: false });
    expect(withoutAppendix.text.length).toBeLessThan(withAppendix.text.length);
    // Appendix is ~3500+ chars (v3)
    const delta = withAppendix.text.length - withoutAppendix.text.length;
    expect(delta).toBeGreaterThan(1000);
  });

  it("appendix content is well-formed with correct XML tags", async () => {
    const ctx = makeMinimalContext();
    const result = await assembleV2SystemPrompt(ctx, { injectArtefactAppendix: true });
    expect(result.text).toContain("<ARTEFACT_DESIGN_APPENDIX>");
    expect(result.text).toContain("</ARTEFACT_DESIGN_APPENDIX>");
  });
});
