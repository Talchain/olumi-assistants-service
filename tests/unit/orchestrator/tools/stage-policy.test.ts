import { describe, it, expect } from "vitest";
import {
  isToolAllowedAtStage,
  hasExplicitResearchIntent,
  hasExplicitRebuildIntent,
  STAGE_TOOL_POLICY,
} from "../../../../src/orchestrator/tools/stage-policy.js";

// ============================================================================
// Policy table validation
// ============================================================================

describe("STAGE_TOOL_POLICY", () => {
  it("frame allows draft_graph and research_topic", () => {
    expect(STAGE_TOOL_POLICY.frame.has("draft_graph")).toBe(true);
    expect(STAGE_TOOL_POLICY.frame.has("research_topic")).toBe(true);
  });

  it("ideate allows edit_graph, research_topic, and draft_graph (conditionally via rebuild intent)", () => {
    expect(STAGE_TOOL_POLICY.ideate.has("edit_graph")).toBe(true);
    expect(STAGE_TOOL_POLICY.ideate.has("research_topic")).toBe(true);
    // draft_graph is in the set but requires explicit rebuild intent at runtime
    expect(STAGE_TOOL_POLICY.ideate.has("draft_graph")).toBe(true);
  });

  it("evaluate allows run_analysis, explain_results, generate_brief, edit_graph", () => {
    for (const tool of ["run_analysis", "explain_results", "generate_brief", "edit_graph"]) {
      expect(STAGE_TOOL_POLICY.evaluate.has(tool)).toBe(true);
    }
  });

  it("decide allows generate_brief and explain_results only — edit_graph removed", () => {
    expect(STAGE_TOOL_POLICY.decide.has("generate_brief")).toBe(true);
    expect(STAGE_TOOL_POLICY.decide.has("explain_results")).toBe(true);
    expect(STAGE_TOOL_POLICY.decide.has("edit_graph")).toBe(false);
  });

  it("optimise matches evaluate policy", () => {
    for (const tool of ["run_analysis", "explain_results", "generate_brief", "edit_graph"]) {
      expect(STAGE_TOOL_POLICY.optimise.has(tool)).toBe(true);
    }
  });
});

// ============================================================================
// isToolAllowedAtStage
// ============================================================================

describe("isToolAllowedAtStage", () => {
  // ── Basic allow/block ──────────────────────────────────────────────────

  it("allows draft_graph in FRAME", () => {
    expect(isToolAllowedAtStage("draft_graph", "frame").allowed).toBe(true);
  });

  it("blocks edit_graph in FRAME", () => {
    const result = isToolAllowedAtStage("edit_graph", "frame");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("edit_graph");
    expect(result.reason).toContain("frame");
  });

  it("blocks run_analysis in FRAME", () => {
    expect(isToolAllowedAtStage("run_analysis", "frame").allowed).toBe(false);
  });

  it("blocks run_analysis in IDEATE", () => {
    expect(isToolAllowedAtStage("run_analysis", "ideate").allowed).toBe(false);
  });

  it("allows run_analysis in EVALUATE", () => {
    expect(isToolAllowedAtStage("run_analysis", "evaluate").allowed).toBe(true);
  });

  it("allows edit_graph in IDEATE", () => {
    expect(isToolAllowedAtStage("edit_graph", "ideate").allowed).toBe(true);
  });

  it("allows all designated tools at their stages", () => {
    const cases: [string, string][] = [
      ["draft_graph", "frame"],
      ["edit_graph", "ideate"],
      ["edit_graph", "evaluate"],
      ["run_analysis", "evaluate"],
      ["explain_results", "evaluate"],
      ["generate_brief", "evaluate"],
      ["generate_brief", "decide"],
      ["explain_results", "decide"],
      // edit_graph removed from decide stage
    ];
    for (const [tool, stage] of cases) {
      expect(isToolAllowedAtStage(tool, stage).allowed).toBe(true);
    }
  });

  // ── research_topic in FRAME ────────────────────────────────────────────

  it("suppresses research_topic in FRAME without explicit research intent", () => {
    expect(isToolAllowedAtStage("research_topic", "frame", "What about competitor pricing?").allowed).toBe(false);
  });

  it("allows research_topic in FRAME with 'research pricing benchmarks'", () => {
    expect(isToolAllowedAtStage("research_topic", "frame", "research pricing benchmarks").allowed).toBe(true);
  });

  it("allows research_topic in FRAME with 'find data on market trends'", () => {
    expect(isToolAllowedAtStage("research_topic", "frame", "find data on market trends").allowed).toBe(true);
  });

  it("allows research_topic in FRAME with 'look up competitor pricing'", () => {
    expect(isToolAllowedAtStage("research_topic", "frame", "look up competitor pricing").allowed).toBe(true);
  });

  // ── draft_graph in IDEATE ──────────────────────────────────────────────

  it("suppresses draft_graph in IDEATE without explicit rebuild intent", () => {
    expect(isToolAllowedAtStage("draft_graph", "ideate", "Add a new factor").allowed).toBe(false);
  });

  it("allows draft_graph in IDEATE with 'start over'", () => {
    expect(isToolAllowedAtStage("draft_graph", "ideate", "I want to start over").allowed).toBe(true);
  });

  it("allows draft_graph in IDEATE with 'rebuild'", () => {
    expect(isToolAllowedAtStage("draft_graph", "ideate", "Let's rebuild the model").allowed).toBe(true);
  });

  it("allows draft_graph in IDEATE with 'from scratch'", () => {
    expect(isToolAllowedAtStage("draft_graph", "ideate", "Build this from scratch").allowed).toBe(true);
  });

  it("allows draft_graph in IDEATE with 'new model'", () => {
    expect(isToolAllowedAtStage("draft_graph", "ideate", "I need a new model for this").allowed).toBe(true);
  });

  // ── Bypass tools ───────────────────────────────────────────────────────

  it("run_exercise bypasses stage policy", () => {
    expect(isToolAllowedAtStage("run_exercise", "frame").allowed).toBe(true);
    expect(isToolAllowedAtStage("run_exercise", "ideate").allowed).toBe(true);
    expect(isToolAllowedAtStage("run_exercise", "evaluate").allowed).toBe(true);
  });

  it("undo_patch bypasses stage policy", () => {
    expect(isToolAllowedAtStage("undo_patch", "frame").allowed).toBe(true);
  });

  // ── Unknown stage ──────────────────────────────────────────────────────

  it("unknown stage → permissive fallback", () => {
    expect(isToolAllowedAtStage("run_analysis", "unknown_stage").allowed).toBe(true);
  });

  // ── Golden path ────────────────────────────────────────────────────────

  it("'What about competitor pricing?' in IDEATE → edit_graph allowed (SUGGEST mode, no edit_graph block)", () => {
    // In IDEATE, edit_graph is allowed, but the LLM chooses conversational (SUGGEST).
    // The stage policy does NOT block edit_graph in IDEATE.
    expect(isToolAllowedAtStage("edit_graph", "ideate", "What about competitor pricing?").allowed).toBe(true);
  });
});

// ============================================================================
// Intent helpers
// ============================================================================

describe("hasExplicitResearchIntent", () => {
  it("matches 'research'", () => {
    expect(hasExplicitResearchIntent("research pricing benchmarks")).toBe(true);
  });

  it("matches 'find data'", () => {
    expect(hasExplicitResearchIntent("find data on market trends")).toBe(true);
  });

  it("matches 'look up'", () => {
    expect(hasExplicitResearchIntent("look up competitor pricing")).toBe(true);
  });

  it("matches 'what does the evidence'", () => {
    expect(hasExplicitResearchIntent("what does the evidence say about pricing?")).toBe(true);
  });

  it("matches 'benchmark'", () => {
    expect(hasExplicitResearchIntent("benchmark against competitors")).toBe(true);
  });

  it("does not match generic questions", () => {
    expect(hasExplicitResearchIntent("What about competitor pricing?")).toBe(false);
  });
});

describe("hasExplicitRebuildIntent", () => {
  it("matches 'start over'", () => {
    expect(hasExplicitRebuildIntent("I want to start over")).toBe(true);
  });

  it("matches 'rebuild'", () => {
    expect(hasExplicitRebuildIntent("rebuild the model")).toBe(true);
  });

  it("matches 'from scratch'", () => {
    expect(hasExplicitRebuildIntent("build from scratch")).toBe(true);
  });

  it("matches 'new model'", () => {
    expect(hasExplicitRebuildIntent("create a new model")).toBe(true);
  });

  it("does not match 'add a new factor'", () => {
    expect(hasExplicitRebuildIntent("add a new factor")).toBe(false);
  });
});

// ============================================================================
// Invariant: coaching plays cannot leak into FRAME
// ============================================================================

describe("stage policy invariant: technique-producing tools excluded from FRAME", () => {
  // run_analysis produces technique offers (PRE_MORTEM, DEVIL_ADVOCATE, DOMINANT_FACTOR, CTA_LITE)
  // via generatePostAnalysisGuidance. If run_analysis were allowed in FRAME,
  // coaching plays would leak into FRAME without any internal stage guard.
  // This test breaks loudly if someone adds run_analysis to FRAME.
  const TECHNIQUE_PRODUCING_TOOLS = ["run_analysis"];

  for (const tool of TECHNIQUE_PRODUCING_TOOLS) {
    it(`${tool} is NOT in the FRAME allowlist`, () => {
      expect(STAGE_TOOL_POLICY.frame.has(tool)).toBe(false);
    });
  }
});
