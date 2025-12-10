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

      it("suggests diminishing_returns for cost-related node labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Cost of materials", kind: "option" },
          target_node: { id: "n2", label: "Product quality", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("diminishing_returns");
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

      it("suggests s_curve for market share labels", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Marketing spend", kind: "option" },
          target_node: { id: "n2", label: "Market share growth", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("s_curve");
      });
    });

    describe("linear default", () => {
      it("suggests linear for ambiguous relationships", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Input A", kind: "option" },
          target_node: { id: "n2", label: "Output B", kind: "outcome" },
        });

        expect(result.suggested_function).toBe("linear");
        expect(result.suggested_params).toEqual({});
        expect(result.provenance).toBe("cee");
      });

      it("returns low confidence for linear default", () => {
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Generic Input", kind: "option" },
          target_node: { id: "n2", label: "Generic Output", kind: "outcome" },
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
        const result = suggestEdgeFunction({
          edge_id: "e1",
          source_node: { id: "n1", label: "Safety investment", kind: "option" },
          target_node: { id: "n2", label: "Risk reduction", kind: "outcome" },
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
