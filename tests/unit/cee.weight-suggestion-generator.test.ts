import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import type { CEEWeightSuggestionV1T } from "../../src/schemas/ceeResponses.js";
import {
  generateWeightSuggestions,
  type GeneratedWeightSuggestion,
} from "../../src/cee/verification/generators/weight-suggestion-generator.js";

function makeGraph(partial: Partial<GraphV1>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    ...(partial as any),
  } as GraphV1;
}

function makeDetection(
  partial: Partial<CEEWeightSuggestionV1T>
): CEEWeightSuggestionV1T {
  return {
    edge_id: "dec_1->opt_1",
    from_node_id: "dec_1",
    to_node_id: "opt_1",
    current_belief: 0.33,
    reason: "uniform_distribution",
    ...partial,
  };
}

describe("WeightSuggestionGenerator", () => {
  describe("grounding score to confidence mapping", () => {
    it("maps high grounding score (≥0.8) to high confidence (0.9)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-high-grounding",
        numericalGroundingScore: 0.85,
      });

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.9);
      expect(results[0].auto_applied).toBe(true);
    });

    it("maps medium grounding score (≥0.5, <0.8) to medium confidence (0.7)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-medium-grounding",
        numericalGroundingScore: 0.65,
      });

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.7);
      expect(results[0].auto_applied).toBe(true);
    });

    it("maps low grounding score (<0.5) to low confidence (0.5)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-low-grounding",
        numericalGroundingScore: 0.3,
      });

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.5);
      expect(results[0].auto_applied).toBe(false);
    });

    it("defaults to medium confidence when grounding score is undefined", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-no-grounding",
        // numericalGroundingScore not provided
      });

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.7); // Default to medium
      expect(results[0].auto_applied).toBe(true);
    });

    it("handles edge case at exactly 0.8 threshold", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const results = await generateWeightSuggestions({
        graph,
        detections: [makeDetection({})],
        requestId: "test-edge-0.8",
        numericalGroundingScore: 0.8,
      });

      expect(results[0].confidence).toBe(0.9); // ≥0.8 is high
    });

    it("handles edge case at exactly 0.5 threshold", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const results = await generateWeightSuggestions({
        graph,
        detections: [makeDetection({})],
        requestId: "test-edge-0.5",
        numericalGroundingScore: 0.5,
      });

      expect(results[0].confidence).toBe(0.7); // ≥0.5 is medium
    });
  });

  describe("suggested_belief population", () => {
    it("populates suggested_belief for near_zero when confidence >= 0.7", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Unlikely Outcome" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", belief: 0.02 } as any],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({
          edge_id: "opt_1->out_1",
          from_node_id: "opt_1",
          to_node_id: "out_1",
          current_belief: 0.02,
          reason: "near_zero",
        }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-near-zero-suggested",
        numericalGroundingScore: 0.85, // High confidence
      });

      expect(results).toHaveLength(1);
      expect(results[0].suggested_belief).toBe(0.15); // Minimum meaningful probability
    });

    it("populates suggested_belief for near_one when confidence >= 0.7", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Sure Thing" } as any,
          { id: "out_1", kind: "outcome", label: "Expected Result" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", belief: 0.98 } as any],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({
          edge_id: "opt_1->out_1",
          from_node_id: "opt_1",
          to_node_id: "out_1",
          current_belief: 0.98,
          reason: "near_one",
        }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-near-one-suggested",
        numericalGroundingScore: 0.85, // High confidence
      });

      expect(results).toHaveLength(1);
      expect(results[0].suggested_belief).toBe(0.85); // High but not certain
    });

    it("does not populate suggested_belief for uniform_distribution", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const results = await generateWeightSuggestions({
        graph,
        detections: [makeDetection({ reason: "uniform_distribution" })],
        requestId: "test-uniform-no-suggested",
        numericalGroundingScore: 0.9, // Even with high confidence
      });

      expect(results[0].suggested_belief).toBeUndefined();
    });

    it("does not populate suggested_belief when confidence < 0.7", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome" } as any,
        ],
        edges: [],
      });

      const results = await generateWeightSuggestions({
        graph,
        detections: [makeDetection({ reason: "near_zero", current_belief: 0.02 })],
        requestId: "test-low-confidence-no-suggested",
        numericalGroundingScore: 0.3, // Low grounding = low confidence
      });

      expect(results[0].confidence).toBe(0.5);
      expect(results[0].suggested_belief).toBeUndefined();
    });
  });

  describe("context-aware rationales", () => {
    it("generates context-aware rationale for uniform_distribution", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Which option?" } as any,
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "opt_2", kind: "option", label: "Option B" } as any,
        ],
        edges: [
          { from: "dec_1", to: "opt_1", belief: 0.5 } as any,
          { from: "dec_1", to: "opt_2", belief: 0.5 } as any,
        ],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({ reason: "uniform_distribution" }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-1",
        numericalGroundingScore: 0.7,
      });

      expect(results).toHaveLength(1);
      expect(results[0].rationale).toContain("equal probability");
      expect(results[0].rationale).toContain("Which option?"); // Node label included
    });

    it("generates context-aware rationale for near_zero detection", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Unlikely Outcome" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", belief: 0.02 } as any],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({
          edge_id: "opt_1->out_1",
          from_node_id: "opt_1",
          to_node_id: "out_1",
          current_belief: 0.02,
          reason: "near_zero",
        }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-2",
        numericalGroundingScore: 0.6,
      });

      expect(results).toHaveLength(1);
      expect(results[0].reason).toBe("near_zero");
      expect(results[0].rationale).toContain("very low probability");
      expect(results[0].rationale).toContain("Option A");
      expect(results[0].rationale).toContain("Unlikely Outcome");
    });

    it("generates context-aware rationale for near_one detection", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Sure Thing" } as any,
          { id: "out_1", kind: "outcome", label: "Expected Result" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", belief: 0.98 } as any],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({
          edge_id: "opt_1->out_1",
          from_node_id: "opt_1",
          to_node_id: "out_1",
          current_belief: 0.98,
          reason: "near_one",
        }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-3",
        numericalGroundingScore: 0.6,
      });

      expect(results).toHaveLength(1);
      expect(results[0].reason).toBe("near_one");
      expect(results[0].rationale).toContain("very high probability");
      expect(results[0].rationale).toContain("Sure Thing");
      expect(results[0].rationale).toContain("Expected Result");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty detections", async () => {
      const graph = makeGraph({});

      const results = await generateWeightSuggestions({
        graph,
        detections: [],
        requestId: "test-req-4",
      });

      expect(results).toHaveLength(0);
    });

    it("limits suggestions to MAX_SUGGESTIONS (5)", async () => {
      const graph = makeGraph({
        nodes: Array.from({ length: 10 }, (_, i) => ({
          id: `opt_${i}`,
          kind: "option",
          label: `Option ${i}`,
        })) as any,
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = Array.from(
        { length: 10 },
        (_, i) =>
          makeDetection({
            edge_id: `dec_1->opt_${i}`,
            from_node_id: "dec_1",
            to_node_id: `opt_${i}`,
          })
      );

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-5",
      });

      expect(results).toHaveLength(5); // Exactly 5, not just <= 5
    });

    it("preserves original detection fields in generated suggestions", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option" } as any,
        ],
        edges: [],
      });

      const detection: CEEWeightSuggestionV1T = {
        edge_id: "dec_1->opt_1",
        from_node_id: "dec_1",
        to_node_id: "opt_1",
        current_belief: 0.33,
        reason: "uniform_distribution",
        suggestion: "Original suggestion",
      };

      const results = await generateWeightSuggestions({
        graph,
        detections: [detection],
        requestId: "test-req-6",
      });

      expect(results).toHaveLength(1);
      const result = results[0] as GeneratedWeightSuggestion;

      // Original fields should be preserved
      expect(result.edge_id).toBe("dec_1->opt_1");
      expect(result.from_node_id).toBe("dec_1");
      expect(result.to_node_id).toBe("opt_1");
      expect(result.current_belief).toBe(0.33);
      expect(result.reason).toBe("uniform_distribution");
      expect(result.suggestion).toBe("Original suggestion");

      // Generated fields should be added
      expect(typeof result.confidence).toBe("number");
      expect(typeof result.rationale).toBe("string");
      expect(typeof result.auto_applied).toBe("boolean");
    });

    it("uses node IDs when labels are missing", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision" } as any, // No label
          { id: "opt_1", kind: "option" } as any, // No label
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-7",
      });

      expect(results).toHaveLength(1);
      // Should fall back to node IDs
      expect(results[0].rationale).toContain("dec_1");
      expect(results[0].rationale).toContain("opt_1");
    });

    it("handles graph without matching nodes gracefully", async () => {
      const graph = makeGraph({
        nodes: [], // No nodes at all
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-8",
      });

      expect(results).toHaveLength(1);
      // Should use node IDs from detection
      expect(results[0].rationale).toContain("dec_1");
      expect(results[0].rationale).toContain("opt_1");
    });

    it("accepts brief context (reserved for future LLM integration)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Pricing decision" } as any,
          { id: "opt_1", kind: "option", label: "Premium tier" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      // Brief is accepted but not currently used in deterministic mode
      const results = await generateWeightSuggestions({
        brief: "Evaluate pricing strategy for SaaS product",
        graph,
        detections,
        requestId: "test-req-9",
      });

      expect(results).toHaveLength(1);
      expect(results[0].rationale).toBeDefined();
    });
  });

  describe("generated suggestion structure", () => {
    it("includes all required Phase 2 fields", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option A" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [makeDetection({})];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-req-10",
        numericalGroundingScore: 0.75,
      });

      const result = results[0] as GeneratedWeightSuggestion;

      // Phase 2 fields
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.rationale).toBeDefined();
      expect(result.rationale.length).toBeGreaterThan(0);
      expect(typeof result.auto_applied).toBe("boolean");
    });

    it("applies same confidence to all suggestions in a batch", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" } as any,
          { id: "opt_1", kind: "option", label: "Option 1" } as any,
          { id: "opt_2", kind: "option", label: "Option 2" } as any,
        ],
        edges: [],
      });

      const detections: CEEWeightSuggestionV1T[] = [
        makeDetection({ edge_id: "dec_1->opt_1", to_node_id: "opt_1" }),
        makeDetection({ edge_id: "dec_1->opt_2", to_node_id: "opt_2" }),
      ];

      const results = await generateWeightSuggestions({
        graph,
        detections,
        requestId: "test-batch",
        numericalGroundingScore: 0.85,
      });

      expect(results).toHaveLength(2);
      expect(results[0].confidence).toBe(0.9);
      expect(results[1].confidence).toBe(0.9);
      expect(results[0].auto_applied).toBe(true);
      expect(results[1].auto_applied).toBe(true);
    });
  });
});
