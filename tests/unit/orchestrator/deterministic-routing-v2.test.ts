/**
 * Deterministic Routing V2 Tests
 *
 * Tests for CEE_DETERMINISTIC_ROUTING_V2 features:
 * - Adjective-only parameter assignment exclusion
 * - Chip passthrough routing (artefact + UI-aligned)
 * - Enhanced parameter assignment patterns (= restricted to numeric RHS)
 * - ISL/PLoT field serialisation
 * - Artefact appendix injection
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntentWithContext,
  matchChipPattern,
} from "../../../src/orchestrator/intent-gate.js";
import {
  serialiseGapSummary,
  serialiseVoiRanking,
  serialiseEdgeEValues,
  serialiseConditionalWinners,
  serialiseInferenceWarnings,
  serialisePlotCritiques,
} from "../../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js";
import type {
  GapSummary,
  VoiRankingEntry,
  EdgeEValue,
  ConditionalWinner,
  InferenceWarning,
  PlotCritique,
} from "../../../src/orchestrator/pipeline/types.js";

// ============================================================================
// Task 1: Adjective-only exclusion
// ============================================================================

describe("V2 — adjective-only exclusion", () => {
  const NODE_LABELS = ['Budget', 'Team Size', 'Timeline', 'Quality'];
  const ctx = { hasGraph: true, graphNodeLabels: NODE_LABELS, deterministicRoutingV2: true };

  it.each([
    "budget is tight",
    "timeline is aggressive",
    "quality is important",
    "budget is limited",
    "team size is insufficient",
    "budget is flexible",
  ])("does NOT route adjective-only '%s' to edit_graph", (msg) => {
    const result = classifyIntentWithContext(msg, ctx);
    expect(result.tool).toBeNull();
    expect(result.routing).toBe("llm");
  });

  it.each([
    "budget is £120k",
    "budget is 150000",
    "team size is 7",
    "budget is high",
    "team size is low",
    "budget is very high",
    "budget is none",
    "budget is moderate",
  ])("still routes settable value '%s' to edit_graph", (msg) => {
    const result = classifyIntentWithContext(msg, ctx);
    expect(result.tool).toBe("edit_graph");
    expect(result.routing).toBe("deterministic");
    expect(result.matched_pattern).toBe("parameter_assignment");
  });

  it("'budget = tight' does NOT route (RHS must be numeric in V2)", () => {
    const result = classifyIntentWithContext("budget = tight", ctx);
    expect(result.tool).toBeNull();
  });

  it("'budget = 120000' still routes", () => {
    const result = classifyIntentWithContext("budget = 120000", ctx);
    expect(result.tool).toBe("edit_graph");
    expect(result.matched_pattern).toBe("parameter_assignment");
  });

  it("'budget = £50k' still routes", () => {
    const result = classifyIntentWithContext("budget = £50k", ctx);
    expect(result.tool).toBe("edit_graph");
    expect(result.matched_pattern).toBe("parameter_assignment");
  });
});

// ============================================================================
// Task 1: Enhanced parameter patterns
// ============================================================================

describe("V2 — enhanced parameter assignment patterns", () => {
  const NODE_LABELS = ['Budget', 'Team Size', 'Revenue'];
  const ctx = { hasGraph: true, graphNodeLabels: NODE_LABELS, deterministicRoutingV2: true };

  it("routes 'increase budget by 20%' to edit_graph (to/by both work)", () => {
    const result = classifyIntentWithContext("increase budget by 20%", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("routes 'reduce budget to 80000' to edit_graph", () => {
    const result = classifyIntentWithContext("reduce budget to 80000", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("routes 'decrease revenue by 10%' to edit_graph", () => {
    const result = classifyIntentWithContext("decrease revenue by 10%", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("routes 'make budget moderate' to edit_graph", () => {
    const result = classifyIntentWithContext("make budget moderate", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  // P0-5: Value validation — non-settable Y values fall through
  it("does NOT route 'set budget to aggressive' (adjective-only value)", () => {
    const result = classifyIntentWithContext("set budget to aggressive", ctx);
    expect(result.tool).toBeNull();
  });

  it("does NOT route 'increase budget to important' (adjective-only value)", () => {
    const result = classifyIntentWithContext("increase budget to important", ctx);
    expect(result.tool).toBeNull();
  });

  it("routes 'set budget to 50000' (numeric value)", () => {
    const result = classifyIntentWithContext("set budget to 50000", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("routes 'set budget to high' (strength level)", () => {
    const result = classifyIntentWithContext("set budget to high", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("routes 'reduce budget by 20%' (percentage)", () => {
    const result = classifyIntentWithContext("reduce budget by 20%", ctx);
    expect(result.tool).toBe("edit_graph");
  });

  it("does NOT route 'reduce budget by tight' (adjective)", () => {
    const result = classifyIntentWithContext("reduce budget by tight", ctx);
    expect(result.tool).toBeNull();
  });
});

// ============================================================================
// Task 3: Chip passthrough routing
// ============================================================================

describe("V2 — chip passthrough routing", () => {
  const ctx = { hasGraph: true, graphNodeLabels: ['Budget'], deterministicRoutingV2: true };

  describe("artefact chip patterns", () => {
    it.each([
      "Assess these options",
      "Show me a decision matrix for all three alternatives",
      "Visualise sensitivity",
      "Visualize sensitivity",
      "Sensitivity breakdown",
      "Compare options",
      "Compare options side by side",
      "Run pre-mortem exercise",
    ])("routes artefact chip '%s' to LLM with chip_origin + chip_artefact", (msg) => {
      const result = classifyIntentWithContext(msg, ctx);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
      expect(result.chip_origin).toBe(true);
      expect(result.chip_artefact).toBe(true);
      expect(result.matched_pattern).toBe("chip_passthrough");
    });
  });

  describe("UI-aligned chip patterns", () => {
    it.each([
      "What baselines am I missing? Help me fill in the data gaps.",
      "Which edges are model-estimated? Help me calibrate the most important ones.",
      "Based on the analysis, where would better data most improve this decision?",
      "Show me the relationships that could flip the recommendation.",
    ])("routes UI chip '%s' to LLM with chip_origin (NOT artefact)", (msg) => {
      const result = classifyIntentWithContext(msg, ctx);
      expect(result.tool).toBeNull();
      expect(result.routing).toBe("llm");
      expect(result.chip_origin).toBe(true);
      expect(result.chip_artefact).toBe(false);
    });
  });

  it("does NOT mark non-chip messages as chip_origin", () => {
    const result = classifyIntentWithContext("budget is £120k", ctx);
    expect(result.chip_origin).toBeUndefined();
  });

  it("full chip text 'Run pre-mortem exercise' routes to LLM via chip passthrough", () => {
    const result = classifyIntentWithContext("Run pre-mortem exercise", ctx);
    expect(result.routing).toBe("llm");
    expect(result.chip_origin).toBe(true);
    expect(result.chip_artefact).toBe(true);
  });

  it("bare 'pre-mortem' still routes to run_exercise (not chip passthrough)", () => {
    // Bare "pre-mortem" is NOT in chip patterns — it should hit the exact-match
    // run_exercise pattern, not the chip passthrough.
    const result = classifyIntentWithContext("pre-mortem", ctx);
    expect(result.tool).toBe("run_exercise");
    expect(result.routing).toBe("deterministic");
    expect(result.chip_origin).toBeUndefined();
  });

  it("chip passthrough only fires when deterministicRoutingV2 is true", () => {
    const ctxNoV2 = { hasGraph: true, graphNodeLabels: ['Budget'] };
    const result = classifyIntentWithContext("Assess these options", ctxNoV2);
    // Without V2, falls through to LLM normally (no chip_origin flag)
    expect(result.chip_origin).toBeUndefined();
  });
});

describe("matchChipPattern", () => {
  it("returns artefact: true for artefact chips", () => {
    expect(matchChipPattern("assess these options")).toEqual({ matched: true, artefact: true });
    expect(matchChipPattern("show me a decision matrix")).toEqual({ matched: true, artefact: true });
    expect(matchChipPattern("visualise sensitivity")).toEqual({ matched: true, artefact: true });
  });

  it("returns artefact: false for UI-aligned chips", () => {
    expect(matchChipPattern("what baselines am i missing")).toEqual({ matched: true, artefact: false });
    expect(matchChipPattern("which edges are model-estimated")).toEqual({ matched: true, artefact: false });
  });

  it("returns null for non-chip messages", () => {
    expect(matchChipPattern("budget is £120k")).toBeNull();
    expect(matchChipPattern("run the analysis")).toBeNull();
  });
});

// ============================================================================
// Task 5: ISL/PLoT field serialisation
// ============================================================================

describe("V2 — ISL/PLoT field serialisation", () => {
  describe("serialiseGapSummary", () => {
    it("serialises basic gap summary", () => {
      const gs: GapSummary = {
        missing_baseline_count: 3,
        missing_baseline_factors: ['Budget', 'Timeline', 'Quality'],
        missing_goal_target: false,
        unconfirmed_count: 2,
        total_factor_count: 8,
      };
      const text = serialiseGapSummary(gs);
      expect(text).toContain("3 of 8 factors missing baselines");
      expect(text).toContain("2 values are estimates");
      expect(text).not.toContain("Goal target");
    });

    it("includes goal target warning when missing", () => {
      const gs: GapSummary = {
        missing_baseline_count: 0,
        missing_baseline_factors: [],
        missing_goal_target: true,
        unconfirmed_count: 0,
        total_factor_count: 5,
      };
      const text = serialiseGapSummary(gs);
      expect(text).toContain("Goal target not set");
    });

    it("omits unconfirmed note when count is 0", () => {
      const gs: GapSummary = {
        missing_baseline_count: 1,
        missing_baseline_factors: ['Budget'],
        missing_goal_target: false,
        unconfirmed_count: 0,
        total_factor_count: 5,
      };
      const text = serialiseGapSummary(gs);
      expect(text).not.toContain("estimate");
    });
  });

  describe("serialiseVoiRanking", () => {
    it("serialises top entries sorted by EVPI", () => {
      const entries: VoiRankingEntry[] = [
        { factor_id: 'f1', factor_label: 'Budget', voi_score: 0.8, evpi: 0.15, evpi_percentage_points: 4.2 },
        { factor_id: 'f2', factor_label: 'Timeline', voi_score: 0.9, evpi: 0.2, evpi_percentage_points: 6.1 },
      ];
      const text = serialiseVoiRanking(entries);
      expect(text).toContain("Investigation priorities:");
      expect(text).toContain("1. Timeline");
      expect(text).toContain("2. Budget");
      expect(text).toContain("6.1pp");
      expect(text).toContain("4.2pp");
    });

    it("limits to 5 entries", () => {
      const entries: VoiRankingEntry[] = Array.from({ length: 8 }, (_, i) => ({
        factor_id: `f${i}`, factor_label: `Factor ${i}`,
        voi_score: 0.5, evpi: 0.1, evpi_percentage_points: i,
      }));
      const text = serialiseVoiRanking(entries);
      const lines = text.split('\n').filter(l => l.trim().match(/^\d\./));
      expect(lines).toHaveLength(5);
    });
  });

  describe("serialiseEdgeEValues", () => {
    it("labels robust and fragile edges", () => {
      const entries: EdgeEValue[] = [
        { edge_id: 'e1', e_value: 3.5, flip_direction: 'up', current_mean: 0.5, flip_mean: 1.75 },
        { edge_id: 'e2', e_value: 1.2, flip_direction: 'down', current_mean: 0.8, flip_mean: 0.96 },
      ];
      const text = serialiseEdgeEValues(entries);
      expect(text).toContain("e1: would need to be 3.5x wrong to flip (robust)");
      expect(text).toContain("e2: would need to be 1.2x wrong to flip (fragile)");
    });
  });

  describe("serialiseConditionalWinners", () => {
    it("serialises conditional splits", () => {
      const entries: ConditionalWinner[] = [{
        factor_id: 'f1', factor_label: 'Budget', split_value: 100000,
        split_unit: 'GBP', low_bucket: 'Outsource', high_bucket: 'In-house',
        winner_flips: true,
      }];
      const text = serialiseConditionalWinners(entries);
      expect(text).toContain("Budget: winner changes if value exceeds 100000 GBP");
    });

    it("omits unit when empty", () => {
      const entries: ConditionalWinner[] = [{
        factor_id: 'f1', factor_label: 'Team Size', split_value: 5,
        split_unit: '', low_bucket: 'A', high_bucket: 'B', winner_flips: true,
      }];
      const text = serialiseConditionalWinners(entries);
      expect(text).toContain("Team Size: winner changes if value exceeds 5");
      expect(text).not.toMatch(/exceeds 5\s+\n/);
    });
  });

  describe("serialiseInferenceWarnings", () => {
    it("serialises warnings", () => {
      const entries: InferenceWarning[] = [
        { node_id: 'n1', code: 'DEFAULT_VALUE', message: 'Budget has no value (defaulting to zero)' },
      ];
      const text = serialiseInferenceWarnings(entries);
      expect(text).toContain("Warning: Budget has no value (defaulting to zero)");
    });
  });

  describe("serialisePlotCritiques", () => {
    it("serialises critiques as model health lines", () => {
      const entries: PlotCritique[] = [
        { code: 'INBOUND_STRENGTH_SUM_EXCEEDED', message: 'Revenue node has inbound strength sum exceeding 1.0' },
      ];
      const text = serialisePlotCritiques(entries);
      expect(text).toContain("Model health: Revenue node has inbound strength sum exceeding 1.0");
    });
  });

  describe("mixed present/absent Zone 2 field serialisation", () => {
    it("serialises only gap_summary when other fields absent", () => {
      const gs: GapSummary = { missing_baseline_count: 2, missing_baseline_factors: ['A', 'B'], missing_goal_target: false, unconfirmed_count: 0, total_factor_count: 5 };
      const text = serialiseGapSummary(gs);
      expect(text).toContain("2 of 5 factors");
      // When only gap_summary is present, other serialisers are never called
    });

    it("serialises gap_summary + voi_ranking together", () => {
      const gs: GapSummary = { missing_baseline_count: 1, missing_baseline_factors: ['A'], missing_goal_target: false, unconfirmed_count: 0, total_factor_count: 3 };
      const voi: VoiRankingEntry[] = [{ factor_id: 'f1', factor_label: 'Budget', voi_score: 0.8, evpi: 0.1, evpi_percentage_points: 3.5 }];
      const gapText = serialiseGapSummary(gs);
      const voiText = serialiseVoiRanking(voi);
      const combined = `${gapText}\n${voiText}`;
      expect(combined).toContain("1 of 3 factors");
      expect(combined).toContain("Budget: resolving uncertainty could improve confidence by 3.5pp");
    });
  });
});

// ============================================================================
// P1-3: Integration tests for direct_analysis_run INTERPRET routing
// ============================================================================

describe("V2 — direct_analysis_run INTERPRET routing", () => {
  it("routeSystemEvent returns needsNarration for completed analysis (V2 flag off by default)", async () => {
    const { routeSystemEvent } = await import("../../../src/orchestrator/system-event-router.js");
    const result = await routeSystemEvent({
      event: {
        event_type: 'direct_analysis_run' as const,
        timestamp: '2026-03-22T00:00:00Z',
        event_id: 'evt-da-1',
        details: {},
      },
      turnRequest: {
        message: 'What do the results mean?',
        scenario_id: 'sc-1',
        client_turn_id: 'ct-1',
        context: {
          messages: [],
          graph: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] },
          analysis_response: { analysis_status: 'completed', results: [] },
        },
        analysis_state: { analysis_status: 'completed', results: [] } as any,
        graph_state: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] } as any,
      } as any,
      turnId: 'turn-1',
      requestId: 'req-1',
      plotClient: null,
    });

    // With V2 off: uses legacy needsNarration path
    expect(result.needsNarration).toBe(true);
    expect(result.delegateToTool).toBeUndefined();
  });

  it("routeSystemEvent returns no narration for blocked analysis", async () => {
    const { routeSystemEvent } = await import("../../../src/orchestrator/system-event-router.js");
    const result = await routeSystemEvent({
      event: {
        event_type: 'direct_analysis_run' as const,
        timestamp: '2026-03-22T00:00:00Z',
        event_id: 'evt-da-2',
        details: {},
      },
      turnRequest: {
        message: 'What do the results mean?',
        scenario_id: 'sc-1',
        client_turn_id: 'ct-1',
        context: {
          messages: [],
          graph: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] },
          analysis_response: { analysis_status: 'blocked', results: [] },
        },
        analysis_state: { analysis_status: 'blocked', results: [] } as any,
        graph_state: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] } as any,
      } as any,
      turnId: 'turn-1',
      requestId: 'req-1',
      plotClient: null,
    });

    // Blocked analysis: no narration, no LLM interpret
    expect(result.needsNarration).toBe(false);
    expect(result.routeToLlmInterpret).toBeUndefined();
  });

  it("routeToLlmInterpret is gated: V2 off produces needsNarration, not routeToLlmInterpret", async () => {
    // With V2 flag off (default in tests), completed analysis should use needsNarration
    // instead of routeToLlmInterpret. This verifies the gating works.
    const { routeSystemEvent } = await import("../../../src/orchestrator/system-event-router.js");
    const result = await routeSystemEvent({
      event: {
        event_type: 'direct_analysis_run' as const,
        timestamp: '2026-03-22T00:00:00Z',
        event_id: 'evt-da-gate',
        details: {},
      },
      turnRequest: {
        message: 'What do the results mean?',
        scenario_id: 'sc-1',
        client_turn_id: 'ct-1',
        context: {
          messages: [],
          graph: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] },
          analysis_response: { analysis_status: 'completed', results: [] },
        },
        analysis_state: { analysis_status: 'completed', results: [] } as any,
        graph_state: { nodes: [{ id: 'n1', label: 'Budget', kind: 'factor' }], edges: [] } as any,
      } as any,
      turnId: 'turn-1',
      requestId: 'req-1',
      plotClient: null,
    });

    // V2 off → legacy path: needsNarration set, routeToLlmInterpret absent
    expect(result.needsNarration).toBe(true);
    expect(result.routeToLlmInterpret).toBeUndefined();
  });
});

// ============================================================================
// Edge cases: isSettableValue boundary conditions
// ============================================================================

describe("V2 — isSettableValue edge cases", () => {
  const NODE_LABELS = ['Budget', 'Team Size', 'Revenue'];
  const ctx = { hasGraph: true, graphNodeLabels: NODE_LABELS, deterministicRoutingV2: true };

  it.each([
    ["budget is very low", true],
    ["budget is very high", true],
    ["budget is 0", true],
    ["budget is $0", true],
    ["budget is 10.5", true],
    ["budget is €200k", true],
    ["budget is minimal", true],
    ["budget is significant", true],
    ["budget is critical", true],
    ["budget is negligible", true],
  ])("'%s' routes to edit_graph = %s", (msg, shouldRoute) => {
    const result = classifyIntentWithContext(msg, ctx);
    if (shouldRoute) {
      expect(result.tool).toBe("edit_graph");
    } else {
      expect(result.tool).toBeNull();
    }
  });

  it.each([
    "budget is £",      // currency prefix without value
    "budget is $",      // currency prefix without value
    "budget is okay",   // adjective
    "budget is fine",   // adjective
    "budget is risky",  // adjective
  ])("'%s' does NOT route (invalid or adjective value)", (msg) => {
    const result = classifyIntentWithContext(msg, ctx);
    expect(result.tool).toBeNull();
  });
});

// ============================================================================
// Edge cases: matchChipPattern specifics
// ============================================================================

describe("V2 — matchChipPattern edge cases", () => {
  it("bare 'pre-mortem' does NOT match chip patterns", () => {
    expect(matchChipPattern("pre-mortem")).toBeNull();
  });

  it("'run pre-mortem exercise' matches artefact chip", () => {
    expect(matchChipPattern("run pre-mortem exercise")).toEqual({ matched: true, artefact: true });
  });

  it("message containing both artefact and UI patterns matches artefact first", () => {
    // Artefact patterns are checked first
    const result = matchChipPattern("assess these options and show me what baselines am i missing");
    expect(result).toEqual({ matched: true, artefact: true });
  });
});
