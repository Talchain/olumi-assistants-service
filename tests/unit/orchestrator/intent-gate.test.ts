/**
 * Intent Gate Tests
 *
 * Exhaustive coverage of classifyIntent():
 * - Per-tool pattern matching (all 5 tools)
 * - Excluded patterns (must NOT match)
 * - Conversational near-misses (LLM fallback)
 * - Edge cases (normalisation, empty input, punctuation, Unicode)
 * - Structural integrity (pattern map consistency)
 */

import { describe, it, expect } from "vitest";
import { classifyIntent, INTENT_PATTERN_ENTRIES } from "../../../src/orchestrator/intent-gate.js";
import type { ToolName } from "../../../src/orchestrator/intent-gate.js";

// ============================================================================
// Per-tool pattern tests
// ============================================================================

describe("Intent Gate — classifyIntent", () => {
  describe("run_analysis patterns", () => {
    it.each([
      "run it",
      "run the analysis",
      "run analysis",
      "analyse",
      "analyze",
      "analyse it",
      "analyze it",
      "run the model",
      "run simulation",
      "simulate",
      "evaluate options",
    ])("routes %j to run_analysis", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("run_analysis");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBeDefined();
    });
  });

  describe("draft_graph patterns", () => {
    it.each([
      "draft",
      "draft a model",
      "build the model",
      "build a model",
      "create a model",
      "start over",
      "new model",
      "redraft",
      "draft it",
    ])("routes %j to draft_graph", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("draft_graph");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBeDefined();
    });
  });

  describe("generate_brief patterns", () => {
    it.each([
      "generate brief",
      "generate a brief",
      "write the brief",
      "create brief",
      "brief",
      "summary",
      "write a summary",
      "generate report",
      "write report",
    ])("routes %j to generate_brief", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("generate_brief");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBeDefined();
    });
  });

  describe("explain_results patterns", () => {
    it.each([
      "explain",
      "explain the results",
      "explain results",
      "why",
      "break it down",
      "explain it",
    ])("routes %j to explain_results", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("explain_results");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBeDefined();
    });
  });

  describe("edit_graph patterns", () => {
    it.each([
      "edit",
      "edit the model",
      "edit model",
      "modify",
      "change",
      "update the model",
      "update model",
    ])("routes %j to edit_graph", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("edit_graph");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBeDefined();
    });
  });

  // ============================================================================
  // Excluded patterns (too ambiguous — must NOT match)
  // ============================================================================

  describe("excluded patterns (must NOT match)", () => {
    it.each([
      "go",
      "let's go",
      "do it",
      "run",
      "why did",
      "what happened",
    ])("does not match %j", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
      expect(result.confidence).toBe("none");
    });
  });

  // ============================================================================
  // Conversational near-misses (contain command words but are NOT commands)
  // ============================================================================

  describe("conversational near-misses (LLM fallback)", () => {
    it.each([
      "I was thinking we should run a different analysis approach",
      "Can you explain why the model uses these assumptions?",
      "I want to draft an email about this decision",
      "Let me explain my thinking",
      "Should we run the analysis or wait for more data?",
      "I want to run a marathon",
      "can you analyze why my draft failed",
      "can you run through the results?",
      "what do you think about running",
      "help me understand the analysis",
      "I drafted a proposal yesterday",
      "tell me more about the graph",
      "what should I do next",
      "undo",
      "undo that",
      "undo last change",
      "run analysis with 1000 samples",
      "generate brief for the team",
      "draft the graph for my decision",
    ])("falls through to LLM for %j", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
    });
  });

  // ============================================================================
  // Unknown commands
  // ============================================================================

  describe("unknown commands (LLM fallback)", () => {
    it.each([
      "delete everything",
      "restart",
      "help",
      "save",
      "undo",
    ])("does not match %j", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  describe("edge cases", () => {
    it("empty string → no match", () => {
      const result = classifyIntent("");
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
      expect(result.normalised_message).toBe("");
    });

    it("whitespace only → no match", () => {
      const result = classifyIntent("   ");
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
      expect(result.normalised_message).toBe("");
    });

    it("mixed case: RUN THE ANALYSIS → matches run_analysis", () => {
      const result = classifyIntent("RUN THE ANALYSIS");
      expect(result.tool).toBe("run_analysis");
    });

    it("trailing punctuation stripped: run it! → matches", () => {
      expect(classifyIntent("run it!").tool).toBe("run_analysis");
    });

    it("repeated trailing punctuation: run it!!! → matches", () => {
      expect(classifyIntent("run it!!!").tool).toBe("run_analysis");
    });

    it("trailing ellipsis (three dots): analyse... → matches", () => {
      expect(classifyIntent("analyse...").tool).toBe("run_analysis");
    });

    it("trailing Unicode ellipsis (\u2026): analyse\u2026 → matches", () => {
      expect(classifyIntent("analyse\u2026").tool).toBe("run_analysis");
    });

    it("trailing semicolons and colons stripped", () => {
      expect(classifyIntent("explain;").tool).toBe("explain_results");
      expect(classifyIntent("explain:").tool).toBe("explain_results");
    });

    it("multiple spaces collapse to single: run  the  analysis → matches", () => {
      expect(classifyIntent("run  the  analysis").tool).toBe("run_analysis");
    });

    it("leading/trailing whitespace trimmed", () => {
      expect(classifyIntent("  run it  ").tool).toBe("run_analysis");
      expect(classifyIntent("\texplain\n").tool).toBe("explain_results");
    });

    it("curly apostrophe \u2019 normalised to ASCII '", () => {
      // "let\u2019s go" normalises to "let's go" which won't match (excluded)
      const result = classifyIntent("let\u2019s go");
      expect(result.tool).toBeNull();
      expect(result.normalised_message).toBe("let's go");
    });

    it("curly apostrophe \u2018 normalised to ASCII '", () => {
      const result = classifyIntent("\u2018twas the night");
      expect(result.normalised_message).toBe("'twas the night");
      expect(result.tool).toBeNull();
    });

    it("result shape: normalised_message and matched_pattern populated on match", () => {
      const result = classifyIntent("  EXPLAIN!  ");
      expect(result.normalised_message).toBe("explain");
      expect(result.matched_pattern).toBe("explain");
      expect(result.tool).toBe("explain_results");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
    });

    it("result shape: matched_pattern absent on no-match", () => {
      const result = classifyIntent("what do you think?");
      expect(result.matched_pattern).toBeUndefined();
      expect(result.tool).toBeNull();
    });
  });

  // ============================================================================
  // Each tool has at least one near-miss (false positive avoided)
  // ============================================================================

  describe("per-tool near-miss (avoided false positive)", () => {
    it("run_analysis near-miss: 'I want to run a marathon'", () => {
      expect(classifyIntent("I want to run a marathon").tool).toBeNull();
    });

    it("draft_graph near-miss: 'I drafted a proposal yesterday'", () => {
      expect(classifyIntent("I drafted a proposal yesterday").tool).toBeNull();
    });

    it("generate_brief near-miss: 'give me a brief overview of the issue'", () => {
      expect(classifyIntent("give me a brief overview of the issue").tool).toBeNull();
    });

    it("explain_results near-miss: 'can you explain the methodology?'", () => {
      expect(classifyIntent("can you explain the methodology?").tool).toBeNull();
    });

    it("edit_graph near-miss: 'I want to edit my profile'", () => {
      expect(classifyIntent("I want to edit my profile").tool).toBeNull();
    });
  });
});

// ============================================================================
// Structural integrity
// ============================================================================

describe("Intent Gate — structural integrity", () => {
  const VALID_TOOL_NAMES: ReadonlySet<ToolName> = new Set([
    "draft_graph",
    "edit_graph",
    "run_analysis",
    "explain_results",
    "generate_brief",
  ]);

  it("every registered pattern maps to a valid ToolName", () => {
    for (const [, tool] of INTENT_PATTERN_ENTRIES) {
      expect(VALID_TOOL_NAMES.has(tool), `Unknown tool: ${tool}`).toBe(true);
    }
  });

  it("all 5 tool names have at least one pattern", () => {
    const toolsWithPatterns = new Set<ToolName>();
    for (const [, tool] of INTENT_PATTERN_ENTRIES) {
      toolsWithPatterns.add(tool);
    }
    for (const toolName of VALID_TOOL_NAMES) {
      expect(toolsWithPatterns.has(toolName), `No pattern for tool: ${toolName}`).toBe(true);
    }
  });

  it("pattern list is not empty", () => {
    expect(INTENT_PATTERN_ENTRIES.length).toBeGreaterThan(0);
  });

  it("no duplicate patterns in the entries", () => {
    const seen = new Set<string>();
    for (const [pattern] of INTENT_PATTERN_ENTRIES) {
      expect(seen.has(pattern), `Duplicate pattern: ${pattern}`).toBe(false);
      seen.add(pattern);
    }
  });
});
