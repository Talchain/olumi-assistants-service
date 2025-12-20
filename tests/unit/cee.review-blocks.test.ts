/**
 * Unit tests for CEE Review block builders and readiness assessor
 */

import { describe, it, expect } from "vitest";
import {
  buildAllBlocks,
  buildBiasesBlock,
  buildRecommendationBlock,
  buildDriversBlock,
  buildGapsBlock,
  buildPredictionBlock,
  buildRisksBlock,
  type BlockBuilderContext,
} from "../../src/services/review/blockBuilders.js";
import {
  assessReadiness,
  buildReadinessBlock,
  type ReadinessContext,
} from "../../src/services/review/readinessAssessor.js";
import type { GraphT } from "../../src/schemas/graph.js";

describe("CEE Review Block Builders", () => {
  // Sample graphs for testing
  const completeGraph: GraphT = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Increase Revenue" },
      { id: "decision_1", kind: "decision", label: "Pricing Strategy" },
      { id: "option_1", kind: "option", label: "Raise Prices" },
      { id: "option_2", kind: "option", label: "Lower Prices" },
      { id: "factor_1", kind: "factor", label: "Market Competition", data: { value: 0.7 } },
      { id: "outcome_1", kind: "outcome", label: "Revenue Growth" },
    ],
    edges: [
      { from: "decision_1", to: "goal_1", belief: 0.8 },
      { from: "option_1", to: "decision_1", belief: 0.6 },
      { from: "option_2", to: "decision_1", belief: 0.5 },
      { from: "factor_1", to: "option_1", belief: 0.7 },
      { from: "outcome_1", to: "goal_1", belief: 0.9 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };

  const minimalGraph: GraphT = {
    version: "1",
    default_seed: 42,
    nodes: [{ id: "goal_1", kind: "goal", label: "Some Goal" }],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };

  const graphWithOrphans: GraphT = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Goal" },
      { id: "orphan_1", kind: "factor", label: "Orphan" },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };

  const baseContext: BlockBuilderContext = {
    graph: completeGraph,
    brief: "We need to decide on a pricing strategy for our product.",
    requestId: "test-request-123",
  };

  describe("buildBiasesBlock", () => {
    it("should return biases block with findings array", () => {
      const result = buildBiasesBlock(baseContext);

      expect(result.block.type).toBe("biases");
      expect(result.block.id).toBeDefined();
      expect(result.block.generated_at).toBeDefined();
      expect(result.block.placeholder).toBe(true);

      // Type guard
      if (result.block.type === "biases") {
        expect(Array.isArray(result.block.findings)).toBe(true);
        expect(typeof result.block.confidence).toBe("number");
      }
    });

    it("should detect confirmation bias for single option", () => {
      const singleOptionGraph: GraphT = {
        ...completeGraph,
        nodes: completeGraph.nodes.filter((n) => n.id !== "option_2"),
      };

      const result = buildBiasesBlock({
        ...baseContext,
        graph: singleOptionGraph,
      });

      if (result.block.type === "biases") {
        const confirmationBias = result.block.findings.find(
          (f: { bias_type: string }) => f.bias_type === "confirmation_bias"
        );
        expect(confirmationBias).toBeDefined();
      }
    });

    it("should detect optimism bias when no negative outcomes", () => {
      const graphWithOnlyPositiveOutcomes: GraphT = {
        ...completeGraph,
        nodes: [
          ...completeGraph.nodes.filter((n) => n.kind !== "outcome"),
          { id: "outcome_1", kind: "outcome", label: "Success" },
          { id: "outcome_2", kind: "outcome", label: "Growth" },
        ],
      };

      const result = buildBiasesBlock({
        ...baseContext,
        graph: graphWithOnlyPositiveOutcomes,
      });

      if (result.block.type === "biases") {
        const optimismBias = result.block.findings.find(
          (f: { bias_type: string }) => f.bias_type === "optimism_bias"
        );
        expect(optimismBias).toBeDefined();
      }
    });
  });

  describe("buildRecommendationBlock", () => {
    it("should return recommendation block with suggestions", () => {
      const result = buildRecommendationBlock(baseContext);

      expect(result.block.type).toBe("recommendation");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "recommendation") {
        expect(Array.isArray(result.block.suggestions)).toBe(true);
        expect(typeof result.block.confidence).toBe("number");
      }
    });

    it("should suggest status quo when not present", () => {
      const result = buildRecommendationBlock({
        ...baseContext,
        graph: minimalGraph,
      });

      if (result.block.type === "recommendation") {
        const statusQuo = result.block.suggestions.find(
          (s: { label: string }) => s.label.toLowerCase().includes("status quo")
        );
        expect(statusQuo).toBeDefined();
      }
    });
  });

  describe("buildDriversBlock", () => {
    it("should return drivers block", () => {
      const result = buildDriversBlock(baseContext);

      expect(result.block.type).toBe("drivers");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "drivers") {
        expect(Array.isArray(result.block.suggestions)).toBe(true);
      }
    });

    it("should use inference data when provided", () => {
      const contextWithInference: BlockBuilderContext = {
        ...baseContext,
        inference: {
          top_drivers: [
            { node_id: "factor_1", label: "Competition", impact_pct: 75, direction: "negative" },
          ],
        },
      };

      const result = buildDriversBlock(contextWithInference);

      if (result.block.type === "drivers") {
        const suggestion = result.block.suggestions.find(
          (s: { node_id: string }) => s.node_id === "factor_1"
        );
        expect(suggestion).toBeDefined();
        expect(suggestion?.direction).toBe("negative");
      }
    });
  });

  describe("buildGapsBlock", () => {
    it("should return gaps block with suggestions", () => {
      const result = buildGapsBlock(baseContext);

      expect(result.block.type).toBe("gaps");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "gaps") {
        expect(Array.isArray(result.block.suggestions)).toBe(true);
      }
    });

    it("should suggest data gathering for factors without data", () => {
      const graphWithoutData: GraphT = {
        ...completeGraph,
        nodes: completeGraph.nodes.map((n) => ({ ...n, data: undefined })),
      };

      const result = buildGapsBlock({
        ...baseContext,
        graph: graphWithoutData,
      });

      if (result.block.type === "gaps") {
        const marketDataSuggestion = result.block.suggestions.find(
          (s: { type: string }) => s.type === "market_data"
        );
        expect(marketDataSuggestion).toBeDefined();
      }
    });
  });

  describe("buildPredictionBlock", () => {
    it("should return prediction block with headline", () => {
      const result = buildPredictionBlock(baseContext);

      expect(result.block.type).toBe("prediction");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "prediction") {
        expect(result.block.headline).toBeDefined();
        expect(typeof result.block.confidence).toBe("number");
      }
    });

    it("should use inference data for headline when available", () => {
      const contextWithInference: BlockBuilderContext = {
        ...baseContext,
        inference: {
          ranked_actions: [
            { node_id: "option_1", label: "Raise Prices", expected_utility: 0.8, rank: 1 },
          ],
          summary: "Raising prices is optimal.",
        },
      };

      const result = buildPredictionBlock(contextWithInference);

      if (result.block.type === "prediction") {
        expect(result.block.headline).toContain("Raise Prices");
      }
    });
  });

  describe("buildRisksBlock", () => {
    it("should return risks block", () => {
      const result = buildRisksBlock(baseContext);

      expect(result.block.type).toBe("risks");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "risks") {
        expect(Array.isArray(result.block.warnings)).toBe(true);
      }
    });

    it("should detect orphan nodes", () => {
      const result = buildRisksBlock({
        ...baseContext,
        graph: graphWithOrphans,
      });

      if (result.block.type === "risks") {
        const orphanWarning = result.block.warnings.find(
          (w: { type: string }) => w.type === "orphan_nodes"
        );
        expect(orphanWarning).toBeDefined();
        expect(orphanWarning?.severity).toBe("warning");
      }
    });

    it("should detect missing goal", () => {
      const noGoalGraph: GraphT = {
        ...minimalGraph,
        nodes: [{ id: "decision_1", kind: "decision", label: "Decision" }],
      };

      const result = buildRisksBlock({
        ...baseContext,
        graph: noGoalGraph,
      });

      if (result.block.type === "risks") {
        const missingGoal = result.block.warnings.find(
          (w: { type: string }) => w.type === "missing_goal"
        );
        expect(missingGoal).toBeDefined();
        expect(missingGoal?.severity).toBe("error");
      }
    });

    it("should detect missing options", () => {
      const noOptionsGraph: GraphT = {
        ...minimalGraph,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "decision_1", kind: "decision", label: "Decision" },
        ],
      };

      const result = buildRisksBlock({
        ...baseContext,
        graph: noOptionsGraph,
      });

      if (result.block.type === "risks") {
        const missingOptions = result.block.warnings.find(
          (w: { type: string }) => w.type === "missing_options"
        );
        expect(missingOptions).toBeDefined();
      }
    });

    it("should detect no edges", () => {
      const noEdgesGraph: GraphT = {
        ...completeGraph,
        edges: [],
      };

      const result = buildRisksBlock({
        ...baseContext,
        graph: noEdgesGraph,
      });

      if (result.block.type === "risks") {
        const noEdgesWarning = result.block.warnings.find(
          (w: { type: string }) => w.type === "no_edges"
        );
        expect(noEdgesWarning).toBeDefined();
      }
    });
  });

  describe("buildAllBlocks", () => {
    it("should build all default block types", () => {
      const result = buildAllBlocks(baseContext);

      expect(result.blocks.length).toBeGreaterThan(0);

      const blockTypes = result.blocks.map((b) => b.type);
      expect(blockTypes).toContain("biases");
      expect(blockTypes).toContain("risks");
    });

    it("should build specific block types when specified", () => {
      const result = buildAllBlocks(baseContext, ["biases", "prediction"]);

      expect(result.blocks.length).toBe(2);

      const blockTypes = result.blocks.map((b) => b.type);
      expect(blockTypes).toContain("biases");
      expect(blockTypes).toContain("prediction");
      expect(blockTypes).not.toContain("recommendation");
    });

    it("should not include next_steps block (handled separately)", () => {
      const result = buildAllBlocks(baseContext);

      const blockTypes = result.blocks.map((b) => b.type);
      expect(blockTypes).not.toContain("next_steps");
    });
  });
});

describe("CEE Review Readiness Assessor", () => {
  const completeGraph: GraphT = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Goal" },
      { id: "decision_1", kind: "decision", label: "Decision" },
      { id: "option_1", kind: "option", label: "Option 1" },
      { id: "option_2", kind: "option", label: "Option 2" },
      { id: "factor_1", kind: "factor", label: "Factor", data: { value: 0.5 } },
    ],
    edges: [
      { from: "decision_1", to: "goal_1", belief: 0.8 },
      { from: "option_1", to: "decision_1", belief: 0.6 },
      { from: "option_2", to: "decision_1", belief: 0.5 },
      { from: "factor_1", to: "option_1", belief: 0.7 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };

  const baseContext: ReadinessContext = {
    graph: completeGraph,
    brief: "Test brief for readiness assessment.",
    blocks: [],
    requestId: "test-request-123",
  };

  describe("assessReadiness", () => {
    it("should return readiness assessment with all required fields", () => {
      const result = assessReadiness(baseContext);

      expect(result.level).toBeDefined();
      expect(["ready", "caution", "not_ready"]).toContain(result.level);
      expect(typeof result.score).toBe("number");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);

      // Check factors
      expect(result.factors).toBeDefined();
      expect(typeof result.factors.completeness).toBe("number");
      expect(typeof result.factors.structure).toBe("number");
      expect(typeof result.factors.evidence).toBe("number");
      expect(typeof result.factors.bias_risk).toBe("number");
    });

    it("should return higher score for complete graph", () => {
      const result = assessReadiness(baseContext);

      expect(result.score).toBeGreaterThan(0.3);
    });

    it("should return lower score for incomplete graph", () => {
      const incompleteGraph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = assessReadiness({
        ...baseContext,
        graph: incompleteGraph,
      });

      expect(result.score).toBeLessThan(0.5);
      expect(result.level).toBe("not_ready");
    });

    it("should generate recommendations for incomplete graph", () => {
      const incompleteGraph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = assessReadiness({
        ...baseContext,
        graph: incompleteGraph,
      });

      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("should factor in bias findings", () => {
      const biasBlock = {
        id: "test-id",
        type: "biases" as const,
        generated_at: new Date().toISOString(),
        placeholder: true as const,
        findings: [
          { id: "1", bias_type: "confirmation_bias", severity: "high" as const, description: "Test" },
        ],
        confidence: 0.8,
      };

      const result = assessReadiness({
        ...baseContext,
        blocks: [biasBlock],
      });

      expect(result.factors.bias_risk).toBeGreaterThan(0);
    });
  });

  describe("buildReadinessBlock", () => {
    it("should return next_steps block with assessment", () => {
      const result = buildReadinessBlock(baseContext);

      expect(result.block.type).toBe("next_steps");
      expect(result.block.id).toBeDefined();

      if (result.block.type === "next_steps") {
        expect(result.block.level).toBeDefined();
        expect(result.block.score).toBeDefined();
        expect(result.block.factors).toBeDefined();
        expect(result.block.summary).toBeDefined();
      }

      expect(result.assessment).toBeDefined();
      if (result.block.type === "next_steps") {
        expect(result.assessment.level).toBe(result.block.level);
        expect(result.assessment.score).toBe(result.block.score);
      }
    });
  });
});
