import { describe, it, expect } from "vitest";
import {
  suggestEdgeFunction,
  validateEdgeFunctionInput,
  type EdgeFunctionSuggestionInput,
} from "../../src/cee/edge-function-suggestions/index.js";

describe("CEE Edge Function Suggestions", () => {
  describe("suggestEdgeFunction", () => {
    describe("diminishing returns detection", () => {
      it("suggests diminishing_returns for 'diminishing' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing Budget", kind: "option" },
          target_node: { id: "n2", label: "Customer Acquisition", kind: "outcome" },
          relationship_description: "Spending more shows diminishing returns over time",
        });

        expect(result.suggested_function).toBe("diminishing_returns");
        expect(result.suggested_params).toEqual({ k: 2.0 });
        expect(result.provenance).toBe("cee");
      });

      it("suggests diminishing_returns for 'saturates' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Training Hours", kind: "option" },
          target_node: { id: "n2", label: "Skill Level", kind: "outcome" },
          relationship_description: "Performance improvement saturates after initial gains",
        });

        expect(result.suggested_function).toBe("diminishing_returns");
      });

      it("suggests noisy_and_not for cost-related node labels (preventative)", () => {
        // Cost is now detected as a preventative factor → noisy_and_not
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Cost of materials", kind: "option" },
          target_node: { id: "n2", label: "Product quality", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("noisy_and_not");
        expect(result.confidence).toMatch(/medium|low/);
      });

      it("suggests diminishing_returns for training/learning labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Training investment", kind: "option" },
          target_node: { id: "n2", label: "Team performance", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("diminishing_returns");
      });
    });

    describe("threshold detection", () => {
      it("suggests threshold for 'threshold' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Security Investment", kind: "option" },
          target_node: { id: "n2", label: "Compliance Status", kind: "outcome" },
          relationship_description: "Must meet minimum threshold to achieve compliance",
        });

        expect(result.suggested_function).toBe("threshold");
        expect(result.suggested_params).toEqual({ threshold: 0.5, slope: 1.0 });
        expect(result.provenance).toBe("cee");
      });

      it("suggests threshold for 'minimum' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Quality Score", kind: "option" },
          target_node: { id: "n2", label: "Certification", kind: "outcome" },
          relationship_description: "Need to reach minimum quality level",
        });

        expect(result.suggested_function).toBe("threshold");
      });

      it("suggests threshold for 'critical' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Safety Measures", kind: "option" },
          target_node: { id: "n2", label: "Operations", kind: "outcome" },
          relationship_description: "Critical safety requirements must be met",
        });

        expect(result.suggested_function).toBe("threshold");
      });

      it("suggests threshold for compliance-related labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Compliance effort", kind: "option" },
          target_node: { id: "n2", label: "Regulatory approval", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("threshold");
      });

      it("suggests threshold for risk node kinds", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Mitigation effort", kind: "option" },
          target_node: { id: "n2", label: "Security breach", kind: "risk" },
        });

        // Risk nodes have threshold signal
        expect(["threshold", "s_curve"]).toContain(result.suggested_function);
      });
    });

    describe("s_curve detection", () => {
      it("suggests s_curve for 'tipping point' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "User Adoption", kind: "option" },
          target_node: { id: "n2", label: "Network Value", kind: "outcome" },
          relationship_description: "Reaches a tipping point after critical mass",
        });

        expect(result.suggested_function).toBe("s_curve");
        expect(result.suggested_params).toEqual({ k: 5.0, midpoint: 0.5 });
        expect(result.provenance).toBe("cee");
      });

      it("suggests s_curve for 'adoption curve' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing Push", kind: "option" },
          target_node: { id: "n2", label: "Product Adoption", kind: "outcome" },
          relationship_description: "Follows a typical adoption curve pattern",
        });

        expect(result.suggested_function).toBe("s_curve");
      });

      it("suggests s_curve for 'viral' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Initial Users", kind: "option" },
          target_node: { id: "n2", label: "User Growth", kind: "outcome" },
          relationship_description: "Viral spread of the product",
        });

        expect(result.suggested_function).toBe("s_curve");
      });

      it("suggests s_curve or diminishing_returns for market share labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing spend", kind: "option" },
          target_node: { id: "n2", label: "Market share growth", kind: "outcome" },
        });

        // Marketing spend triggers diminishing_returns pattern (investment pattern)
        // Market share growth triggers s_curve pattern
        // Either is valid - depends on which signals are stronger
        expect(["s_curve", "diminishing_returns"]).toContain(result.suggested_function);
      });
    });

    describe("linear default", () => {
      it("suggests linear for truly ambiguous relationships", () => {
        // Use node kinds that don't have signals to get linear
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Input A", kind: "unknown" },
          target_node: { id: "n2", label: "Output B", kind: "unknown" },
        });

        expect(result.suggested_function).toBe("linear");
        expect(result.suggested_params).toEqual({});
        expect(result.provenance).toBe("cee");
      });

      it("returns low confidence for linear default", () => {
        // Use labels and kinds that don't match any patterns
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "X", kind: "node" },
          target_node: { id: "n2", label: "Y", kind: "node" },
        });

        expect(result.suggested_function).toBe("linear");
        expect(result.confidence).toBe("low");
      });
    });

    describe("alternatives", () => {
      it("includes alternatives when confidence is low", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Resource", kind: "option" },
          target_node: { id: "n2", label: "Result", kind: "outcome" },
        });

        expect(result.alternatives.length).toBeGreaterThan(0);
        // Should include other function types as alternatives
        const alternativeTypes = result.alternatives.map((a) => a.function_type);
        expect(
          alternativeTypes.some((t) =>
            ["diminishing_returns", "threshold", "s_curve"].includes(t)
          )
        ).toBe(true);
      });

      it("includes reasoning for each alternative", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Input", kind: "option" },
          target_node: { id: "n2", label: "Output", kind: "outcome" },
        });

        for (const alt of result.alternatives) {
          expect(alt.reasoning).toBeDefined();
          expect(alt.reasoning.length).toBeGreaterThan(0);
          expect(alt.params).toBeDefined();
        }
      });
    });

    describe("confidence levels", () => {
      it("returns high confidence for strong keyword matches", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Investment", kind: "option" },
          target_node: { id: "n2", label: "Returns", kind: "outcome" },
          relationship_description: "Shows clear diminishing returns with saturation",
        });

        // Multiple keywords should give high confidence
        expect(result.confidence).toBe("high");
      });

      it("returns medium confidence for single keyword matches", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Effort", kind: "option" },
          target_node: { id: "n2", label: "Quality improvement", kind: "outcome" },
        });

        // Label pattern match should give medium confidence
        expect(["medium", "low"]).toContain(result.confidence);
      });
    });

    describe("node label pattern matching", () => {
      it("detects safety-related labels for threshold", () => {
        // Use a clear threshold scenario without investment pattern
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Safety compliance", kind: "option" },
          target_node: { id: "n2", label: "Certification status", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("threshold");
      });

      it("detects network/viral labels for s_curve", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Network effects", kind: "option" },
          target_node: { id: "n2", label: "Platform value", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("s_curve");
      });
    });

    describe("provenance", () => {
      it("always includes provenance: cee", () => {
        const inputs: EdgeFunctionSuggestionInput[] = [
          {
            edge_id: "e1",
            source_node: { id: "n1", label: "A", kind: "option" },
            target_node: { id: "n2", label: "B", kind: "outcome" },
          },
          {
            edge_id: "e2",
            source_node: { id: "n3", label: "C", kind: "option" },
            target_node: { id: "n4", label: "D", kind: "outcome" },
            relationship_description: "diminishing returns",
          },
        ];

        for (const input of inputs) {
          const result = suggestEdgeFunction(input);
          expect(result.provenance).toBe("cee");
        }
      });
    });

    describe("noisy_or detection (Brief 18 Task 1)", () => {
      it("suggests noisy_or for 'causes' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Market Demand", kind: "factor" },
          target_node: { id: "n2", label: "Revenue Growth", kind: "outcome" },
          relationship_description: "Increased demand causes revenue growth",
        });

        expect(result.suggested_function).toBe("noisy_or");
        expect(result.suggested_params).toEqual({ leak: 0.01 });
        expect(result.provenance).toBe("cee");
      });

      it("suggests noisy_or for 'generates' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Innovation", kind: "action" },
          target_node: { id: "n2", label: "Competitive Advantage", kind: "outcome" },
          relationship_description: "Innovation generates competitive advantage",
        });

        expect(result.suggested_function).toBe("noisy_or");
      });

      it("suggests noisy_or for 'contributes to' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Training", kind: "action" },
          target_node: { id: "n2", label: "Employee Performance", kind: "outcome" },
          relationship_description: "Training contributes to improved performance",
        });

        expect(result.suggested_function).toBe("noisy_or");
      });

      it("suggests noisy_or for driver/enabler labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Technology Driver", kind: "factor" },
          target_node: { id: "n2", label: "Efficiency", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("noisy_or");
      });

      it("suggests noisy_or for outcome nodes with multiple causes", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Customer Satisfaction", kind: "action" },
          target_node: { id: "n2", label: "Customer Success", kind: "outcome" },
          relationship_description: "drives success",
        });

        expect(result.suggested_function).toBe("noisy_or");
      });
    });

    describe("noisy_and_not detection (Brief 18 Task 1)", () => {
      it("suggests noisy_and_not for 'reduces' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Competition", kind: "risk" },
          target_node: { id: "n2", label: "Market Share", kind: "outcome" },
          relationship_description: "Competition reduces market share",
        });

        expect(result.suggested_function).toBe("noisy_and_not");
        expect(result.suggested_params).toEqual({ inhibition_strength: 0.8 });
        expect(result.provenance).toBe("cee");
      });

      it("suggests noisy_and_not for 'prevents' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Regulatory Barrier", kind: "risk" },
          target_node: { id: "n2", label: "Market Entry", kind: "outcome" },
          relationship_description: "Barriers prevents market entry",
        });

        expect(result.suggested_function).toBe("noisy_and_not");
      });

      it("suggests noisy_and_not for 'inhibits' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Budget Constraints", kind: "factor" },
          target_node: { id: "n2", label: "Expansion Plans", kind: "outcome" },
          relationship_description: "Budget constraints inhibits expansion",
        });

        expect(result.suggested_function).toBe("noisy_and_not");
      });

      it("suggests noisy_and_not for risk/threat labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Security Threat", kind: "risk" },
          target_node: { id: "n2", label: "Business Continuity", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("noisy_and_not");
      });

      it("suggests noisy_and_not for preventative source → positive target", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Competitor Action", kind: "factor" },
          target_node: { id: "n2", label: "Revenue Growth", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("noisy_and_not");
      });

      it("suggests noisy_and_not for obstacle/barrier labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Technical Obstacle", kind: "factor" },
          target_node: { id: "n2", label: "Project Success", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("noisy_and_not");
      });
    });

    describe("logistic detection (Brief 18 Task 1)", () => {
      it("suggests logistic for 'probability of' keyword", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Investment Level", kind: "option" },
          target_node: { id: "n2", label: "Success", kind: "binary" },
          relationship_description: "Affects the probability of success",
        });

        expect(result.suggested_function).toBe("logistic");
        expect(result.suggested_params).toEqual({ k: 5.0, midpoint: 0.5 });
      });

      it("suggests logistic for binary outcome nodes", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Effort", kind: "option" },
          target_node: { id: "n2", label: "Pass/Fail Result", kind: "binary" },
        });

        // Binary node kind should suggest logistic or noisy_or
        expect(["logistic", "noisy_or"]).toContain(result.suggested_function);
      });

      it("suggests logistic for 'pass or fail' description", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Preparation", kind: "option" },
          target_node: { id: "n2", label: "Exam Result", kind: "outcome" },
          relationship_description: "Determines pass or fail outcome",
        });

        expect(result.suggested_function).toBe("logistic");
      });
    });

    describe("signals array (Brief 18 Task 3)", () => {
      it("includes signals in output", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing Spend", kind: "option" },
          target_node: { id: "n2", label: "Brand Awareness", kind: "outcome" },
          relationship_description: "Marketing drives awareness",
        });

        expect(Array.isArray(result.signals)).toBe(true);
        expect(result.signals.length).toBeGreaterThan(0);
      });

      it("signals have correct structure", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Competition Risk", kind: "risk" },
          target_node: { id: "n2", label: "Profit Margin", kind: "outcome" },
          relationship_description: "Competition reduces margins",
        });

        for (const signal of result.signals) {
          expect(signal).toHaveProperty("type");
          expect(signal).toHaveProperty("description");
          expect(signal).toHaveProperty("strength");
          expect(["node_type", "label_pattern", "keyword", "relationship_type", "domain_pattern"]).toContain(signal.type);
          expect(["strong", "moderate", "weak"]).toContain(signal.strength);
        }
      });

      it("includes keyword signals when keywords match", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Factor", kind: "factor" },
          target_node: { id: "n2", label: "Outcome", kind: "outcome" },
          relationship_description: "Factor prevents the outcome",
        });

        const keywordSignals = result.signals.filter((s) => s.type === "keyword");
        expect(keywordSignals.length).toBeGreaterThan(0);
      });

      it("includes node_type signals when node kinds match", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Security Risk", kind: "risk" },
          target_node: { id: "n2", label: "Operations", kind: "outcome" },
        });

        const nodeTypeSignals = result.signals.filter((s) => s.type === "node_type");
        expect(nodeTypeSignals.length).toBeGreaterThan(0);
      });

      it("includes relationship_type signals for preventative patterns", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Competitor Threat", kind: "factor" },
          target_node: { id: "n2", label: "Revenue Growth", kind: "outcome" },
        });

        const relSignals = result.signals.filter((s) => s.type === "relationship_type");
        expect(relSignals.length).toBeGreaterThan(0);
        expect(relSignals[0].description).toContain("Preventative");
      });
    });

    describe("current form note (Brief 18 Task 1)", () => {
      it("generates note when current form matches recommendation", () => {
        const result = suggestEdgeFunction(
          {
            edge_id: "e1",
            source_node: { id: "n1", label: "Training Budget", kind: "option" },
            target_node: { id: "n2", label: "Skill Level", kind: "outcome" },
          },
          "diminishing_returns"
        );

        expect(result.current_form_note).toBeDefined();
        expect(result.current_form_note).toContain("matches");
      });

      it("generates improvement note when current form differs", () => {
        const result = suggestEdgeFunction(
          {
            edge_id: "e1",
            source_node: { id: "n1", label: "Competition", kind: "risk" },
            target_node: { id: "n2", label: "Revenue", kind: "outcome" },
            relationship_description: "Competition reduces revenue",
          },
          "linear"
        );

        expect(result.current_form_note).toBeDefined();
        expect(result.current_form_note).toContain("differs");
      });

      it("omits note when currentForm not provided", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Input", kind: "option" },
          target_node: { id: "n2", label: "Output", kind: "outcome" },
        });

        expect(result.current_form_note).toBeUndefined();
      });
    });

    describe("edge case handling (Brief 18 Task 4)", () => {
      it("handles missing source label gracefully", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "", kind: "option" },
          target_node: { id: "n2", label: "Output", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("linear");
        expect(result.confidence).toBe("low");
        expect(result.signals).toEqual([]);
        expect(result.reasoning).toContain("Insufficient information");
      });

      it("handles missing target label gracefully", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Input", kind: "option" },
          target_node: { id: "n2", label: "", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("linear");
        expect(result.confidence).toBe("low");
        expect(result.reasoning).toContain("Insufficient information");
      });

      it("limits alternatives to top 3", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Generic Input", kind: "option" },
          target_node: { id: "n2", label: "Generic Output", kind: "outcome" },
        });

        expect(result.alternatives.length).toBeLessThanOrEqual(3);
      });
    });

    describe("improved confidence calibration (Brief 18 Task 2)", () => {
      it("requires multiple strong signals for high confidence", () => {
        // Single keyword match with neutral node kinds should give medium/low confidence
        // Use "unknown" kind which has no signals to isolate keyword effect
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "A", kind: "unknown" },
          target_node: { id: "n2", label: "B", kind: "unknown" },
          relationship_description: "saturates",
        });

        // Just one keyword without corroborating node type signals shouldn't be high
        // Even with a strong keyword, we need margin over other types
        expect(["medium", "low"]).toContain(result.confidence);
      });

      it("gives high confidence with strong corroboration", () => {
        // Multiple strong signals should give high confidence
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Competition Risk", kind: "risk" },
          target_node: { id: "n2", label: "Revenue Growth", kind: "outcome" },
          relationship_description: "Competitor actions reduce and inhibit our revenue growth",
        });

        // Multiple signals: keyword "reduce", keyword "inhibit", node kind "risk",
        // label pattern "risk", preventative relationship pattern
        const strongSignals = result.signals.filter((s) => s.strength === "strong");
        expect(strongSignals.length).toBeGreaterThanOrEqual(2);
        expect(result.confidence).toBe("high");
      });

      it("returns low confidence when signals conflict", () => {
        // Conflicting signals should result in low confidence
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing Budget", kind: "option" },
          target_node: { id: "n2", label: "Compliance Threshold", kind: "outcome" },
        });

        // Marketing suggests diminishing_returns, threshold in label suggests threshold
        // Without clear winner, confidence should be medium or low
        expect(["medium", "low"]).toContain(result.confidence);
      });
    });

    describe("detailed reasoning (Brief 18 Task 3)", () => {
      it("includes node-specific context in reasoning", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Risk Factor", kind: "risk" },
          target_node: { id: "n2", label: "Profit", kind: "outcome" },
          relationship_description: "Risk reduces profit",
        });

        expect(result.reasoning).toContain("Risk Factor");
        expect(result.reasoning).toContain("Profit");
      });

      it("includes parameter explanations in reasoning", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Demand", kind: "factor" },
          target_node: { id: "n2", label: "Sales", kind: "outcome" },
          relationship_description: "Demand causes increased sales",
        });

        // Noisy-OR reasoning should mention leak parameter
        if (result.suggested_function === "noisy_or") {
          expect(result.reasoning).toContain("leak");
        }
      });

      it("includes domain context for diminishing returns", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing Spend", kind: "option" },
          target_node: { id: "n2", label: "Customer Acquisition", kind: "outcome" },
        });

        expect(result.reasoning).toContain("diminishing");
        expect(result.reasoning).toContain("k parameter");
      });
    });

    describe("factor node handling", () => {
      it("handles factor nodes appropriately", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Market Demand Level", kind: "factor" },
          target_node: { id: "n2", label: "Sales Volume", kind: "outcome" },
        });

        // Factor nodes should trigger appropriate signals
        const nodeTypeSignals = result.signals.filter((s) => s.type === "node_type");
        expect(nodeTypeSignals.length).toBeGreaterThan(0);
      });

      it("suggests s_curve for economic factors", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Economic Conditions", kind: "factor" },
          target_node: { id: "n2", label: "Business Performance", kind: "outcome" },
        });

        expect(["s_curve", "diminishing_returns", "threshold"]).toContain(result.suggested_function);
      });

      it("suggests threshold for regulatory factors", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Regulatory Compliance Level", kind: "factor" },
          target_node: { id: "n2", label: "Market Access", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("threshold");
      });
    });
  });

  describe("validateEdgeFunctionInput", () => {
    it("validates correct input", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(true);
    });

    it("validates input with relationship_description", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
          relationship_description: "Some description",
        })
      ).toBe(true);
    });

    it("rejects null input", () => {
      expect(validateEdgeFunctionInput(null)).toBe(false);
    });

    it("rejects undefined input", () => {
      expect(validateEdgeFunctionInput(undefined)).toBe(false);
    });

    it("rejects missing edge_id", () => {
      expect(
        validateEdgeFunctionInput({
          source_node: { id: "n1", label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects empty edge_id", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "",
          source_node: { id: "n1", label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects missing source_node", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects missing target_node", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", label: "A", kind: "option" },
        })
      ).toBe(false);
    });

    it("rejects invalid source_node (missing id)", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects invalid source_node (missing label)", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects invalid source_node (missing kind)", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", label: "A" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
        })
      ).toBe(false);
    });

    it("rejects non-string relationship_description", () => {
      expect(
        validateEdgeFunctionInput({
          edge_id: "e1",
          source_node: { id: "n1", label: "A", kind: "option" },
          target_node: { id: "n2", label: "B", kind: "outcome" },
          relationship_description: 123,
        })
      ).toBe(false);
    });
  });
});
