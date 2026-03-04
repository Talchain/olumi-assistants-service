/**
 * Phase 3 Prompt Assembler (V2) — Unit Tests
 *
 * Verifies that assembleV2SystemPrompt() injects all six required
 * ConversationContext components into Zone 2:
 *   1. Graph state (compact) — node labels, IDs
 *   2. Analysis response (compact) — winner, robustness
 *   3. Framing — goal, constraints, options
 *   4. Event log summary (when populated)
 *   (Stage + intent are also tested for completeness)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { assembleV2SystemPrompt } from "../../../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js";
import type { EnrichedContext } from "../../../../src/orchestrator/pipeline/types.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../../../src/orchestrator/context/analysis-compact.js";

// Mock prompt loader — avoid FS/DB access in unit tests
vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("ZONE1_STATIC_PROMPT"),
}));

// ============================================================================
// Fixtures
// ============================================================================

const COMPACT_GRAPH: GraphV3Compact = {
  nodes: [
    { id: "n1", kind: "factor", label: "Market Size" },
    { id: "n2", kind: "factor", label: "Competition Level", category: "threat" },
    { id: "n3", kind: "outcome", label: "Revenue", value: 1200000 },
  ],
  edges: [
    { from: "n1", to: "n3", strength: 0.7, exists: 0.9 },
    { from: "n2", to: "n3", strength: -0.5, exists: 0.8 },
  ],
  _node_count: 3,
  _edge_count: 2,
};

const COMPACT_ANALYSIS: AnalysisResponseSummary = {
  winner: { option_id: "opt_a", option_label: "Launch Now", win_probability: 0.72 },
  options: [
    { option_id: "opt_a", option_label: "Launch Now", win_probability: 0.72, outcome_mean: 1100000 },
    { option_id: "opt_b", option_label: "Delay 6 Months", win_probability: 0.28, outcome_mean: 850000 },
  ],
  top_drivers: [
    { factor_id: "n1", factor_label: "Market Size", sensitivity: 0.85, direction: "positive" },
    { factor_id: "n2", factor_label: "Competition Level", sensitivity: 0.62, direction: "negative" },
  ],
  robustness_level: "moderate",
  fragile_edge_count: 1,
  analysis_status: "ok",
};

const FRAMING_WITH_ALL_FIELDS: EnrichedContext["framing"] = {
  goal: "Maximise first-year revenue",
  stage: "evaluate",
  constraints: [
    { id: "c1", label: "Budget < $500k" },
    { id: "c2", label: "Launch by Q3" },
  ],
  options: [
    { id: "opt_a", label: "Launch Now" },
    { id: "opt_b", label: "Delay 6 Months" },
  ],
};

function makeEnrichedContext(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords matched" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("assembleV2SystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes Zone 1 static prompt", async () => {
    const prompt = await assembleV2SystemPrompt(makeEnrichedContext());
    expect(prompt).toContain("ZONE1_STATIC_PROMPT");
  });

  describe("Graph state (component 1)", () => {
    it("includes node labels when graph_compact is present", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).toContain("Market Size");
      expect(prompt).toContain("Competition Level");
      expect(prompt).toContain("Revenue");
    });

    it("includes node IDs in the graph block", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).toContain("n1");
      expect(prompt).toContain("n2");
      expect(prompt).toContain("n3");
    });

    it("includes edge relationships", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).toContain("n1 → n3");
      expect(prompt).toContain("n2 → n3");
    });

    it("includes node count and edge count", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).toContain("3 nodes");
      expect(prompt).toContain("2 edges");
    });

    it("includes optional node fields (category, value)", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).toContain("category=threat");
      expect(prompt).toContain("value=1200000");
    });

    it("omits graph block when graph_compact is absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: undefined }));
      expect(prompt).not.toContain("nodes, ");
      expect(prompt).not.toContain("edges):");
    });
  });

  describe("Analysis response (component 2)", () => {
    it("includes winner label and option ID", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: COMPACT_ANALYSIS }));
      expect(prompt).toContain("Launch Now");
      expect(prompt).toContain("opt_a");
    });

    it("includes win probability as percentage", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: COMPACT_ANALYSIS }));
      expect(prompt).toContain("72%");
    });

    it("includes robustness level", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: COMPACT_ANALYSIS }));
      expect(prompt).toContain("moderate");
    });

    it("includes top driver labels", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: COMPACT_ANALYSIS }));
      expect(prompt).toContain("Market Size");
      expect(prompt).toContain("Competition Level");
    });

    it("includes all option labels", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: COMPACT_ANALYSIS }));
      expect(prompt).toContain("Delay 6 Months");
      expect(prompt).toContain("28%");
    });

    it("omits analysis block when analysis_response is absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: undefined }));
      expect(prompt).not.toContain("Winner:");
      expect(prompt).not.toContain("Robustness:");
    });
  });

  describe("Framing metadata (component 3)", () => {
    it("includes decision goal", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing: FRAMING_WITH_ALL_FIELDS }));
      expect(prompt).toContain("Maximise first-year revenue");
    });

    it("includes constraints list", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing: FRAMING_WITH_ALL_FIELDS }));
      expect(prompt).toContain("Budget < $500k");
      expect(prompt).toContain("Launch by Q3");
      expect(prompt).toMatch(/Constraints:/);
    });

    it("includes options list", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing: FRAMING_WITH_ALL_FIELDS }));
      expect(prompt).toMatch(/Options:/);
      expect(prompt).toContain("Launch Now");
      expect(prompt).toContain("Delay 6 Months");
    });

    it("omits Constraints line when constraints array is empty", async () => {
      const framing: EnrichedContext["framing"] = { ...FRAMING_WITH_ALL_FIELDS!, constraints: [] };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing }));
      expect(prompt).not.toMatch(/^Constraints:/m);
    });

    it("omits Options line when options array is empty", async () => {
      const framing: EnrichedContext["framing"] = { ...FRAMING_WITH_ALL_FIELDS!, options: [] };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing }));
      expect(prompt).not.toMatch(/^Options:/m);
    });

    it("omits goal line when framing is null", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ framing: null }));
      expect(prompt).not.toContain("Decision goal:");
    });
  });

  describe("Event log summary (component 5)", () => {
    it("includes event log summary when present", async () => {
      const summary = "Framing confirmed: Maximise revenue. Graph drafted with 3 nodes, 2 edges.";
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ event_log_summary: summary }));
      expect(prompt).toContain("Framing confirmed: Maximise revenue");
      expect(prompt).toContain("Decision history:");
    });

    it("omits event log block when event_log_summary is undefined", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ event_log_summary: undefined }));
      expect(prompt).not.toContain("Decision history:");
    });
  });

  describe("Stage + intent (components included)", () => {
    it("includes current stage", async () => {
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "explicit_event" },
      });
      const prompt = await assembleV2SystemPrompt(ctx);
      expect(prompt).toContain("evaluate");
    });

    it("includes user intent", async () => {
      const ctx = makeEnrichedContext({ intent_classification: "recommend" });
      const prompt = await assembleV2SystemPrompt(ctx);
      expect(prompt).toContain("recommend");
    });
  });

  describe("Full context with all components", () => {
    it("assembles all six components in one prompt", async () => {
      const ctx = makeEnrichedContext({
        graph_compact: COMPACT_GRAPH,
        analysis_response: COMPACT_ANALYSIS,
        framing: FRAMING_WITH_ALL_FIELDS,
        event_log_summary: "Framing confirmed: Maximise first-year revenue. Graph drafted with 3 nodes, 2 edges.",
        stage_indicator: { stage: "evaluate", confidence: "high", source: "explicit_event" },
        intent_classification: "explain",
      });

      const prompt = await assembleV2SystemPrompt(ctx);

      // Zone 1
      expect(prompt).toContain("ZONE1_STATIC_PROMPT");

      // Component 1: graph
      expect(prompt).toContain("Market Size");
      expect(prompt).toContain("n1 → n3");

      // Component 2: analysis
      expect(prompt).toContain("Launch Now");
      expect(prompt).toContain("72%");
      expect(prompt).toContain("moderate");

      // Component 3: framing
      expect(prompt).toContain("Maximise first-year revenue");
      expect(prompt).toContain("Budget < $500k");
      expect(prompt).toContain("Launch Now");

      // Component 5: event log
      expect(prompt).toContain("Decision history:");

      // Stage + intent
      expect(prompt).toContain("evaluate");
      expect(prompt).toContain("explain");
    });
  });
});
