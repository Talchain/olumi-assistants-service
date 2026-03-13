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
import { compactAnalysis } from "../../../../src/orchestrator/context/analysis-compact.js";
import type { EnrichedContext, ReferencedEntityDetail, V2RunResponseEnvelope } from "../../../../src/orchestrator/pipeline/types.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../../../src/orchestrator/context/analysis-compact.js";
import type { DecisionContinuity } from "../../../../src/orchestrator/context/decision-continuity.js";

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
  constraints: ["Budget < $500k", "Launch by Q3"],
  options: ["Launch Now", "Delay 6 Months"],
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
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
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

  describe("Section character cap (2000 chars)", () => {
    it("truncates graph section exceeding 2000 chars and appends truncation marker", async () => {
      // Build a compact graph with a node label long enough to push the serialised
      // output past the 2000-char cap. The serialised line for this node is:
      //   "  n1 [factor] \"<label>\""  (~17 + label length chars)
      // plus the "Graph (N nodes, M edges):\n" header (~27 chars).
      // Total with a 2000-char label: ~2044 chars → exceeds 2000.
      const longLabel = "x".repeat(2000);
      const largeGraph: GraphV3Compact = {
        nodes: [
          { id: "n1", kind: "factor", label: longLabel },
          { id: "n2", kind: "outcome", label: "Revenue" },
        ],
        edges: [{ from: "n1", to: "n2", strength: 0.8, exists: 0.9 }],
        _node_count: 2,
        _edge_count: 1,
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: largeGraph }));
      expect(prompt).toContain("…truncated");
    });

    it("does not truncate graph section within 2000 chars", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ graph_compact: COMPACT_GRAPH }));
      expect(prompt).not.toContain("…truncated");
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

  // =========================================================================
  // P1.2: <decision_state> exact format assertions
  // =========================================================================

  describe("<decision_state> block format", () => {
    const BASE_DC: DecisionContinuity = {
      goal: "Maximise revenue",
      options: ["Launch Now", "Delay 6 Months"],
      constraints: ["Budget < $500k"],
      stage: "evaluate",
      graph_version: null,
      analysis_status: "current",
      top_drivers: ["Market Size", "Competition Level"],
      top_uncertainties: ["Regulatory Risk"],
      last_patch_summary: null,
      active_proposal: null,
      assumption_count: 0,
    };

    it("wraps output in <decision_state> tags", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: BASE_DC }));
      expect(prompt).toContain("<decision_state>");
      expect(prompt).toContain("</decision_state>");
    });

    it("emits 'N options' (count only) when compact graph is present", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        decision_continuity: BASE_DC,
        graph_compact: COMPACT_GRAPH,
      }));
      expect(prompt).toContain("Options: 2 options");
      // Must NOT list labels inline when compact graph is present (anti-duplication)
      expect(prompt).not.toMatch(/Options:.*Launch Now/);
    });

    it("emits 'N options (list)' with labels when no compact graph", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        decision_continuity: BASE_DC,
        graph_compact: undefined,
      }));
      expect(prompt).toContain("Options: 2 options (Launch Now, Delay 6 Months)");
    });

    it("omits Options line entirely when options array is empty", async () => {
      const dc: DecisionContinuity = { ...BASE_DC, options: [] };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: dc }));
      expect(prompt).not.toMatch(/Options:/);
    });

    it("includes Goal, Stage, and Analysis lines", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: BASE_DC }));
      expect(prompt).toContain("Goal: Maximise revenue");
      expect(prompt).toContain("Stage: evaluate");
      expect(prompt).toContain("Analysis: current");
    });

    it("includes Top drivers and Top uncertainties", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: BASE_DC }));
      expect(prompt).toContain("Top drivers: Market Size, Competition Level");
      expect(prompt).toContain("Top uncertainties: Regulatory Risk");
    });

    it("omits Top drivers line when array is empty", async () => {
      const dc: DecisionContinuity = { ...BASE_DC, top_drivers: [] };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: dc }));
      expect(prompt).not.toContain("Top drivers:");
    });

    it("emits 'Assumptions: 1 inferred value' (singular) when assumption_count=1", async () => {
      const dc: DecisionContinuity = { ...BASE_DC, assumption_count: 1 };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: dc }));
      expect(prompt).toContain("Assumptions: 1 inferred value");
      expect(prompt).not.toContain("Assumptions: 1 inferred values");
    });

    it("emits 'Assumptions: N inferred values' (plural) when assumption_count>1", async () => {
      const dc: DecisionContinuity = { ...BASE_DC, assumption_count: 3 };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: dc }));
      expect(prompt).toContain("Assumptions: 3 inferred values");
    });

    it("omits Assumptions line when assumption_count=0", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: BASE_DC }));
      expect(prompt).not.toContain("Assumptions:");
    });

    it("omits Goal line when goal is null", async () => {
      const dc: DecisionContinuity = { ...BASE_DC, goal: null };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: dc }));
      expect(prompt).not.toContain("Goal:");
    });

    it("omits <decision_state> block entirely when decision_continuity is absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ decision_continuity: undefined }));
      expect(prompt).not.toContain("<decision_state>");
    });
  });

  // =========================================================================
  // P1.2: <referenced_entity> exact format assertions
  // =========================================================================

  describe("<referenced_entity> block format", () => {
    const FULL_ENTITY: ReferencedEntityDetail = {
      id: "n1",
      label: "Market Size",
      kind: "factor",
      category: "demand",
      value: 1200000,
      unit: "USD",
      source: "user",
      edges: [
        { connected_label: "Revenue", strength: 0.7 },
        { connected_label: "Market Share", strength: 0.4 },
      ],
    };

    const MINIMAL_ENTITY: ReferencedEntityDetail = {
      id: "n2",
      label: "Competition Level",
      kind: "factor",
      edges: [],
    };

    it("wraps entity in <referenced_entity> tags", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [FULL_ENTITY] }));
      expect(prompt).toContain("<referenced_entity>");
      expect(prompt).toContain("</referenced_entity>");
    });

    it("emits Label line", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [FULL_ENTITY] }));
      expect(prompt).toContain("Label: Market Size");
    });

    it("emits 'Kind: X | Category: Y' when category is present", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [FULL_ENTITY] }));
      expect(prompt).toContain("Kind: factor | Category: demand");
    });

    it("emits 'Kind: X' without Category when category is absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [MINIMAL_ENTITY] }));
      expect(prompt).toContain("Kind: factor");
      expect(prompt).not.toContain("Category:");
    });

    it("emits Value | Unit | Source line when all three are present", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [FULL_ENTITY] }));
      expect(prompt).toContain("Value: 1200000 | Unit: USD | Source: user");
    });

    it("emits only present value fields (Unit only when value and source absent)", async () => {
      const entity: ReferencedEntityDetail = { ...FULL_ENTITY, value: undefined, source: undefined };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [entity] }));
      expect(prompt).toContain("Unit: USD");
      expect(prompt).not.toContain("Value:");
      expect(prompt).not.toContain("Source:");
    });

    it("omits Value/Unit/Source line entirely when all are absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [MINIMAL_ENTITY] }));
      expect(prompt).not.toContain("Value:");
      expect(prompt).not.toContain("Unit:");
      expect(prompt).not.toContain("Source:");
    });

    it("emits Connected line with strength to 1 decimal place", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [FULL_ENTITY] }));
      expect(prompt).toContain("Connected: Revenue (mean=0.7), Market Share (mean=0.4)");
    });

    it("omits Connected line when edges array is empty", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [MINIMAL_ENTITY] }));
      expect(prompt).not.toContain("Connected:");
    });

    it("caps rendering at 2 entities even when 3 are provided", async () => {
      const third: ReferencedEntityDetail = {
        id: "n3",
        label: "Regulatory Risk",
        kind: "risk",
        edges: [],
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        referenced_entities: [FULL_ENTITY, MINIMAL_ENTITY, third],
      }));
      // First two rendered
      expect(prompt).toContain("Label: Market Size");
      expect(prompt).toContain("Label: Competition Level");
      // Third must be absent
      expect(prompt).not.toContain("Label: Regulatory Risk");
    });

    it("omits all <referenced_entity> blocks when array is empty", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: [] }));
      expect(prompt).not.toContain("<referenced_entity>");
    });

    it("omits all <referenced_entity> blocks when referenced_entities is absent", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ referenced_entities: undefined }));
      expect(prompt).not.toContain("<referenced_entity>");
    });
  });

  // =========================================================================
  // Option comparison rendering
  // =========================================================================

  describe("Option comparison rendering", () => {
    it("renders all options with win %, mean, and range when option_results present", async () => {
      const analysis: AnalysisResponseSummary = {
        ...COMPACT_ANALYSIS,
        options: [
          { option_id: "opt_a", option_label: "Hire Tech Lead", win_probability: 0.37, outcome_mean: 0.42, outcome_p10: 0.18, outcome_p90: 0.67 },
          { option_id: "opt_b", option_label: "Hire AI Contractor", win_probability: 0.24, outcome_mean: 0.31, outcome_p10: 0.09, outcome_p90: 0.54 },
        ],
        option_results: [
          { label: "Hire Tech Lead", win_probability: 0.37, mean: 0.42, p10: 0.18, p90: 0.67 },
          { label: "Hire AI Contractor", win_probability: 0.24, mean: 0.31, p10: 0.09, p90: 0.54 },
        ],
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: analysis }));
      expect(prompt).toContain("Option comparison:");
      expect(prompt).toContain("Hire Tech Lead: 37% win, mean=0.42, range [0.18, 0.67]");
      expect(prompt).toContain("Hire AI Contractor: 24% win, mean=0.31, range [0.09, 0.54]");
    });

    it("omits range when p10/p90 are absent", async () => {
      const analysis: AnalysisResponseSummary = {
        ...COMPACT_ANALYSIS,
        options: [
          { option_id: "opt_a", option_label: "Launch Now", win_probability: 0.72, outcome_mean: 1100000 },
          { option_id: "opt_b", option_label: "Delay", win_probability: 0.28, outcome_mean: 850000 },
        ],
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: analysis }));
      expect(prompt).toContain("Option comparison:");
      expect(prompt).not.toContain("range");
    });

    it("renders option comparison even with single option", async () => {
      const analysis: AnalysisResponseSummary = {
        ...COMPACT_ANALYSIS,
        options: [
          { option_id: "opt_a", option_label: "Launch Now", win_probability: 0.72, outcome_mean: 1100000 },
        ],
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: analysis }));
      expect(prompt).toContain("Option comparison:");
      expect(prompt).toContain("Launch Now: 72% win");
    });

    it("omits option comparison when no analysis exists", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({ analysis_response: undefined }));
      expect(prompt).not.toContain("Option comparison:");
    });
  });

  // =========================================================================
  // Pending changes block
  // =========================================================================

  describe("<pending_changes> block", () => {
    it("emits pending_changes when analysis_status is stale", async () => {
      const dc: DecisionContinuity = {
        goal: "Maximise revenue",
        options: ["Option A"],
        constraints: [],
        stage: "evaluate",
        graph_version: null,
        analysis_status: "stale",
        top_drivers: [],
        top_uncertainties: [],
        last_patch_summary: null,
        active_proposal: null,
        assumption_count: 0,
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: COMPACT_ANALYSIS,
        decision_continuity: dc,
      }));
      expect(prompt).toContain("<pending_changes>");
      expect(prompt).toContain("The graph has been modified since the last analysis");
      expect(prompt).toContain("</pending_changes>");
    });

    it("includes patch summary when available", async () => {
      const dc: DecisionContinuity = {
        goal: "Maximise revenue",
        options: ["Option A"],
        constraints: [],
        stage: "evaluate",
        graph_version: null,
        analysis_status: "stale",
        top_drivers: [],
        top_uncertainties: [],
        last_patch_summary: "Churn Response updated to low confidence",
        active_proposal: null,
        assumption_count: 0,
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: COMPACT_ANALYSIS,
        decision_continuity: dc,
      }));
      expect(prompt).toContain("<pending_changes>");
      expect(prompt).toContain("Since last analysis: Churn Response updated to low confidence");
      expect(prompt).toContain("Consider re-running the analysis");
    });

    it("absent when analysis is current", async () => {
      const dc: DecisionContinuity = {
        goal: "Maximise revenue",
        options: ["Option A"],
        constraints: [],
        stage: "evaluate",
        graph_version: null,
        analysis_status: "current",
        top_drivers: [],
        top_uncertainties: [],
        last_patch_summary: null,
        active_proposal: null,
        assumption_count: 0,
      };
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: COMPACT_ANALYSIS,
        decision_continuity: dc,
      }));
      expect(prompt).not.toContain("<pending_changes>");
    });

    it("absent when no analysis exists", async () => {
      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: undefined,
        decision_continuity: undefined,
      }));
      expect(prompt).not.toContain("<pending_changes>");
    });
  });

  // =========================================================================
  // End-to-end: raw V2RunResponseEnvelope → compactAnalysis → prompt text
  // =========================================================================

  describe("End-to-end from raw analysis payload", () => {
    it("renders option comparison from raw V2RunResponseEnvelope with nested outcome shape", async () => {
      const rawResponse = {
        meta: { seed_used: 42, n_samples: 1000, response_hash: "abc123" },
        results: [
          {
            option_id: "opt_a",
            option_label: "Hire Tech Lead",
            win_probability: 0.37,
            outcome: { mean: 0.42, p10: 0.18, p90: 0.67 },
          },
          {
            option_id: "opt_b",
            option_label: "Status Quo",
            win_probability: 0.18,
            outcome: { mean: 0.15, p10: -0.05, p90: 0.35 },
          },
        ],
      } as unknown as V2RunResponseEnvelope;

      const compacted = compactAnalysis(rawResponse);
      expect(compacted).not.toBeNull();
      expect(compacted!.option_results).toHaveLength(2);

      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: compacted!,
      }));
      expect(prompt).toContain("Option comparison:");
      expect(prompt).toContain("Hire Tech Lead: 37% win, mean=0.42, range [0.18, 0.67]");
      expect(prompt).toContain("Status Quo: 18% win, mean=0.15, range [-0.05, 0.35]");
    });

    it("renders option comparison from raw V2RunResponseEnvelope with flat outcome fields", async () => {
      const rawResponse = {
        meta: { seed_used: 42, n_samples: 1000, response_hash: "abc123" },
        results: [
          {
            option_id: "opt_a",
            option_label: "Hire Tech Lead",
            win_probability: 0.37,
            outcome_mean: 0.42,
            outcome_p10: 0.18,
            outcome_p90: 0.67,
          },
          {
            option_id: "opt_b",
            option_label: "Status Quo",
            win_probability: 0.18,
            outcome_mean: 0.15,
            outcome_p10: -0.05,
            outcome_p90: 0.35,
          },
        ],
      } as unknown as V2RunResponseEnvelope;

      const compacted = compactAnalysis(rawResponse);
      expect(compacted).not.toBeNull();
      expect(compacted!.option_results).toHaveLength(2);

      const prompt = await assembleV2SystemPrompt(makeEnrichedContext({
        analysis_response: compacted!,
      }));
      expect(prompt).toContain("Option comparison:");
      expect(prompt).toContain("Hire Tech Lead: 37% win, mean=0.42, range [0.18, 0.67]");
      expect(prompt).toContain("Status Quo: 18% win, mean=0.15, range [-0.05, 0.35]");
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
