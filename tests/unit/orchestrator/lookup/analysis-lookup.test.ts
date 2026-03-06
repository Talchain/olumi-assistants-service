/**
 * analysis_lookup Deterministic Handler Tests
 */

import { describe, it, expect, vi } from "vitest";
import { tryAnalysisLookup, buildLookupEnvelope } from "../../../../src/orchestrator/lookup/analysis-lookup.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { EnrichedContext } from "../../../../src/orchestrator/pipeline/types.js";

// Mock config and dsk-loader for envelope builder
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: { dskV0: false },
  },
  isProduction: () => false,
}));

vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeAnalysis(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 10000, response_hash: 'test-hash' },
    results: [
      { option_label: 'Option A', win_probability: 0.65 },
      { option_label: 'Option B', win_probability: 0.35 },
    ],
    factor_sensitivity: [
      { label: 'Cost', elasticity: 0.6, node_id: 'n1' },
      { label: 'Quality', elasticity: 0.3, node_id: 'n2' },
      { label: 'Speed', elasticity: 0.1, node_id: 'n3' },
    ],
    robustness: {
      level: 'moderate',
      score: 0.72,
      fragile_edges: [
        { from: 'Cost', to: 'Outcome' },
      ],
    },
    constraint_analysis: {
      joint_probability: 0.3,
      per_constraint: [
        { label: 'Budget', probability: 0.4 },
        { label: 'Timeline', probability: 0.8 },
      ],
    },
    ...overrides,
  } as unknown as V2RunResponseEnvelope;
}

function makeGraph() {
  return {
    nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
    edges: [{ id: 'e1' }, { id: 'e2' }],
  } as any;
}

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: makeGraph(),
    analysis: makeAnalysis(),
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: 'evaluate', substate: 'has_run', confidence: 'high', source: 'inferred' },
    intent_classification: 'conversational',
    decision_archetype: { type: null, confidence: 'low', evidence: '' },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: 'socratic', calibration_tendency: 'unknown', challenge_tolerance: 'medium' },
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    ...overrides,
  } as unknown as EnrichedContext;
}

// ============================================================================
// Tests: Lookup Matching
// ============================================================================

describe("tryAnalysisLookup", () => {
  describe("lookup patterns", () => {
    it("matches 'what is the win probability' and returns option comparison", () => {
      const result = tryAnalysisLookup("What is the win probability?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("Option A");
        expect(result.assistantText).toContain("65%");
        expect(result.assistantText).toContain("Option B");
      }
    });

    it("matches 'how robust is the analysis' and returns robustness", () => {
      const result = tryAnalysisLookup("How robust is the analysis?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("72%");
        expect(result.assistantText).toContain("moderate");
      }
    });

    it("matches 'what matters most' and returns top sensitivity factors", () => {
      const result = tryAnalysisLookup("What matters most?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("Cost");
        expect(result.assistantText).toContain("Quality");
        expect(result.assistantText).toContain("Speed");
      }
    });

    it("matches 'how many simulations' and returns sample size", () => {
      const result = tryAnalysisLookup("How many simulations?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("10,000");
      }
    });

    it("matches 'how many factors' and returns model size", () => {
      const result = tryAnalysisLookup("How many factors are there?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("3 factors");
        expect(result.assistantText).toContain("2 relationships");
      }
    });

    it("matches 'fragile' and returns vulnerable assumptions", () => {
      const result = tryAnalysisLookup("Are there any fragile edges?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("1 vulnerable assumption");
        expect(result.assistantText).toContain("Cost");
        expect(result.assistantText).toContain("Outcome");
      }
    });

    it("matches 'constraints' and returns constraint status", () => {
      const result = tryAnalysisLookup("Are the constraints met?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("Budget");
        expect(result.assistantText).toContain("Timeline");
        expect(result.assistantText).toContain("2 constraints");
      }
    });
  });

  describe("no analysis in context", () => {
    it("returns matched: false when analysis_response is null", () => {
      const result = tryAnalysisLookup("What is the win probability?", null, makeGraph());
      expect(result.matched).toBe(false);
    });
  });

  describe("field missing", () => {
    it("returns graceful fallback when field is missing at all paths", () => {
      const analysis = makeAnalysis({ robustness: undefined });
      const result = tryAnalysisLookup("How robust is the analysis?", analysis, makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        // robustness.level and robustness.score both undefined → null from format → fallback
        expect(result.assistantText).toContain("can't find");
      }
    });
  });

  describe("no fragile edges", () => {
    it("returns 'no vulnerable assumptions' when fragile_edges is empty", () => {
      const analysis = makeAnalysis({
        robustness: { level: 'robust', fragile_edges: [] },
      } as any);
      const result = tryAnalysisLookup("Are there fragile edges?", analysis, makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("No vulnerable assumptions");
      }
    });
  });

  describe("staleness detection", () => {
    it("appends staleness note when stage is 'ideate' (graph edited after analysis)", () => {
      const enriched = makeEnrichedContext({
        stage_indicator: { stage: 'ideate', confidence: 'high', source: 'inferred' },
      });
      const lookupResult = tryAnalysisLookup("What is the win probability?", makeAnalysis(), makeGraph());
      expect(lookupResult.matched).toBe(true);
      if (lookupResult.matched) {
        const envelope = buildLookupEnvelope(enriched, lookupResult);
        expect(envelope.assistant_text).toContain("doesn't reflect your recent edits");
      }
    });
  });

  describe("unrelated question", () => {
    it("returns matched: false for unrelated questions", () => {
      const result = tryAnalysisLookup("What's the weather like?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });
  });

  describe("precedence: causal/explanatory questions", () => {
    it("returns matched: false for 'why' questions", () => {
      const result = tryAnalysisLookup("Why does Option A win?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });

    it("returns matched: false for 'what would change' questions", () => {
      const result = tryAnalysisLookup("What would change if we raised the cost?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });

    it("returns matched: false for 'explain' questions", () => {
      const result = tryAnalysisLookup("Explain the sensitivity results", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });

    it("returns matched: false for 'what if' questions", () => {
      const result = tryAnalysisLookup("What if we change the budget?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });
  });

  describe("envelope structure", () => {
    it("lookup response envelope matches normal V2 envelope shape", () => {
      const enriched = makeEnrichedContext();
      const lookupResult = tryAnalysisLookup("What is the win probability?", makeAnalysis(), makeGraph());
      expect(lookupResult.matched).toBe(true);
      if (!lookupResult.matched) return;

      const envelope = buildLookupEnvelope(enriched, lookupResult);

      // Verify standard V2 envelope fields
      expect(envelope).toMatchObject({
        turn_id: 'test-turn',
        assistant_text: expect.any(String),
        blocks: [],
        suggested_actions: expect.any(Array),
        guidance_items: [],
        lineage: expect.objectContaining({ context_hash: expect.any(String) }),
        stage_indicator: expect.objectContaining({ stage: 'evaluate' }),
        science_ledger: expect.objectContaining({ claims_used: [] }),
        progress_marker: { kind: 'none' },
        observability: expect.objectContaining({ intent_classification: 'conversational' }),
        turn_plan: { selected_tool: null, routing: 'deterministic', long_running: false },
      });
    });
  });

  describe("option name matching", () => {
    it("user asks about specific option by name — matches", () => {
      const result = tryAnalysisLookup("How often does Option A win?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.assistantText).toContain("Option A");
      }
    });

    it("user asks about option not in results — falls through to LLM", () => {
      const result = tryAnalysisLookup("How often does Option C win?", makeAnalysis(), makeGraph());
      expect(result.matched).toBe(false);
    });
  });
});
