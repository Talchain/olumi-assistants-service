import { describe, it, expect } from "vitest";
import { resolveIntent } from "../../../src/orchestrator/intent-gate.js";

describe("Intent Gate", () => {
  // =========================================================================
  // run_analysis — deterministic
  // =========================================================================
  describe("run_analysis routing", () => {
    it.each([
      "run",
      "Run",
      "RUN",
      "run analysis",
      "run the analysis",
      "analyse",
      "analyze",
      "analyse it",
      "analyze it",
      "run it",
      "Run Analysis!",
      "run analysis.",
      "run the analysis please",
      "run analysis with 1000 samples",
    ])("routes %j to run_analysis (deterministic)", (message) => {
      const result = resolveIntent(message);
      expect(result.tool).toBe("run_analysis");
      expect(result.routing).toBe("deterministic");
    });
  });

  // =========================================================================
  // generate_brief — deterministic
  // =========================================================================
  describe("generate_brief routing", () => {
    it.each([
      "generate brief",
      "generate the brief",
      "write the brief",
      "write a brief",
      "create brief",
      "create the brief",
      "create a brief",
      "Generate Brief!",
      "generate brief for the team",
    ])("routes %j to generate_brief (deterministic)", (message) => {
      const result = resolveIntent(message);
      expect(result.tool).toBe("generate_brief");
      expect(result.routing).toBe("deterministic");
    });
  });

  // =========================================================================
  // draft_graph — deterministic
  // =========================================================================
  describe("draft_graph routing", () => {
    it.each([
      "draft",
      "draft the graph",
      "draft the model",
      "draft a model",
      "build the model",
      "build a model",
      "create a model",
      "create the model",
      "Draft!",
      "draft the graph for my decision",
    ])("routes %j to draft_graph (deterministic)", (message) => {
      const result = resolveIntent(message);
      expect(result.tool).toBe("draft_graph");
      expect(result.routing).toBe("deterministic");
    });
  });

  // =========================================================================
  // LLM fallback — required negative tests
  // =========================================================================
  describe("LLM fallback (no deterministic match)", () => {
    it.each([
      "I want to run a marathon",
      "can you analyze why my draft failed",
      "undo my understanding of X",
      "can you run through the results?",
      "undo",
      "Undo",
      "undo that",
      "undo last change",
      "UNDO!",
      "what do you think about running",
      "help me understand the analysis",
      "I drafted a proposal yesterday",
      "tell me more about the graph",
      "explain the results",
      "what should I do next",
      "",
      " ",
    ])("falls through to LLM for %j", (message) => {
      const result = resolveIntent(message);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
    });
  });

  // =========================================================================
  // Normalisation
  // =========================================================================
  describe("normalisation", () => {
    it("strips trailing punctuation", () => {
      expect(resolveIntent("run!").tool).toBe("run_analysis");
      expect(resolveIntent("run.").tool).toBe("run_analysis");
      expect(resolveIntent("run?").tool).toBe("run_analysis");
      expect(resolveIntent("run,").tool).toBe("run_analysis");
    });

    it("trims whitespace", () => {
      expect(resolveIntent("  run  ").tool).toBe("run_analysis");
      expect(resolveIntent("\tundo\n").tool).toBeNull();
    });

    it("is case insensitive", () => {
      expect(resolveIntent("RUN ANALYSIS").tool).toBe("run_analysis");
      expect(resolveIntent("UNDO").tool).toBeNull();
      expect(resolveIntent("Generate Brief").tool).toBe("generate_brief");
    });
  });
});
