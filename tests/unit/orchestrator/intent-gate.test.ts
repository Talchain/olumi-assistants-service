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
import {
  classifyIntent,
  classifyIntentWithContext,
  looksLikeDecisionBrief,
  INTENT_PATTERN_ENTRIES,
} from "../../../src/orchestrator/intent-gate.js";
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
      "generate the brief",
      "write the brief",
      "create brief",
      "create a brief",
      "create the brief",
      "decision brief",
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
  // edit_graph verb-prefix patterns
  // ============================================================================

  describe("edit_graph verb-prefix patterns", () => {
    it.each([
      ["update the team size factor", "update the"],
      ["change the risk tolerance", "change the"],
      ["modify the hiring cost factor", "modify the"],
      ["add a factor for competitor response", "add a factor for"],
      ["add an option for outsourcing", "add an option for"],
      ["set the budget constraint to 50k", "set the"],
      ["remove the legacy factor", "remove the"],
      ["please update the team size", "please update the"],
      ["please add a new risk factor", "please add a"],
    ])("routes %j to edit_graph (prefix: %j)", (message, expectedPrefix) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("edit_graph");
      expect(result.routing).toBe("deterministic");
      expect(result.confidence).toBe("exact");
      expect(result.matched_pattern).toBe(expectedPrefix.trim());
    });

    it("does NOT route 'what about X?' to edit_graph", () => {
      const result = classifyIntent("what about market conditions?");
      expect(result.tool).not.toBe("edit_graph");
    });

    it("does NOT route bare verb with no remainder to edit prefix", () => {
      // Bare "update" has no remainder after "update " prefix → no prefix match.
      // Also not in exact pattern table → falls through to LLM.
      const result = classifyIntent("update");
      expect(result.tool).toBeNull();
    });

    // False-positive avoidance: bare verbs without determiner/graph-object must NOT match
    it.each([
      "add some context to the brief",
      "set aside time for review",
      "remove any ambiguity from the wording",
      "change course if needed",
      "update me on the progress",
    ])("does NOT route conversational %j to edit_graph", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).not.toBe("edit_graph");
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

    it("generate_brief near-miss: standalone 'brief' falls through to LLM (too ambiguous)", () => {
      expect(classifyIntent("brief").tool).toBeNull();
    });

    it("generate_brief near-miss: standalone 'summary' falls through to LLM (too ambiguous)", () => {
      expect(classifyIntent("summary").tool).toBeNull();
    });

    it("generate_brief near-miss: 'write a summary' falls through to LLM (too ambiguous)", () => {
      expect(classifyIntent("write a summary").tool).toBeNull();
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
// Intent collision negatives — must NOT route to generate_brief
// ============================================================================

describe("Intent Gate — generate_brief collision negatives", () => {
  it.each([
    "summarise the results",
    "briefly explain",
    "give me a quick summary",
    "in brief, what happened",
    "can you summarise",
    "brief overview",
  ])("does not route %j to generate_brief", (message) => {
    const result = classifyIntent(message);
    expect(result.tool).not.toBe("generate_brief");
  });
});

// ============================================================================
// Structural integrity
// ============================================================================

describe("Intent Gate — structural integrity", () => {
  // Note: run_exercise is gate-only (not LLM-selectable), but is a valid ToolName.
  // It is intentionally excluded from TOOL_DEFINITIONS (prompt-registry alignment test passes).
  const VALID_TOOL_NAMES: ReadonlySet<ToolName> = new Set([
    "draft_graph",
    "edit_graph",
    "run_analysis",
    "explain_results",
    "generate_brief",
    "run_exercise",
  ]);

  it("every registered pattern maps to a valid ToolName", () => {
    for (const [, tool] of INTENT_PATTERN_ENTRIES) {
      expect(VALID_TOOL_NAMES.has(tool), `Unknown tool: ${tool}`).toBe(true);
    }
  });

  it("all 6 tool names have at least one pattern", () => {
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

// ============================================================================
// Brief Detection Heuristic Tests
// ============================================================================

describe("looksLikeDecisionBrief", () => {
  it.each([
    "We're choosing between three CRM vendors for our sales team",
    "I'm deciding between hiring a contractor or a full-time employee for this project",
    "Our options are to expand into Europe, focus on the US market, or partner with a distributor",
    "Should we raise prices by 10% or keep them the same to retain customers?",
    "We need to evaluate whether to build in-house or buy a third-party solution",
    "Comparing two approaches: microservices versus monolith for our new platform",
    "The trade-off is between speed to market and long-term maintainability",
  ])("detects %j as a decision brief", (message) => {
    expect(looksLikeDecisionBrief(message)).toBe(true);
  });

  it.each([
    "Hello",
    "What is a causal model?",
    "Explain the results",
    "Run the analysis",
    "How does pricing affect revenue?",
    "Tell me about decision science",
    "Can you help me understand the model?",
    "short",
  ])("rejects %j as not a brief", (message) => {
    expect(looksLikeDecisionBrief(message)).toBe(false);
  });

  it("rejects messages shorter than 30 characters", () => {
    expect(looksLikeDecisionBrief("choosing between A or B")).toBe(false);
  });
});

describe("classifyIntentWithContext", () => {
  it("routes NL brief to draft_graph when no graph exists", () => {
    const result = classifyIntentWithContext(
      "We're choosing between three CRM vendors for our sales team and need to evaluate cost vs features",
      { hasGraph: false },
    );
    expect(result.tool).toBe("draft_graph");
    expect(result.routing).toBe("deterministic");
    expect(result.matched_pattern).toBe("brief_detection");
  });

  it("does NOT route NL brief when graph already exists", () => {
    const result = classifyIntentWithContext(
      "We're choosing between three CRM vendors for our sales team and need to evaluate cost vs features",
      { hasGraph: true },
    );
    expect(result.tool).toBeNull();
    expect(result.routing).toBe("llm");
  });

  it("preserves exact-match routing over brief detection", () => {
    const result = classifyIntentWithContext("draft a model", { hasGraph: false });
    expect(result.tool).toBe("draft_graph");
    expect(result.matched_pattern).toBe("draft a model");
  });

  it("preserves LLM fallback for non-brief messages", () => {
    const result = classifyIntentWithContext("Hello, how are you?", { hasGraph: false });
    expect(result.tool).toBeNull();
    expect(result.routing).toBe("llm");
  });
});
