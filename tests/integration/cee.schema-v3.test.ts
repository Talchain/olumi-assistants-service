import { describe, it, expect } from "vitest";
import {
  transformResponseToV3,
  getV3ResponseSummary,
  validateStrictModeV3,
  needsUserMapping,
} from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";
import { normaliseIdForMatch } from "../../src/cee/validation/integrity-sentinel.js";

describe("CEE Schema V3 Integration", () => {
  // V4 topology: decision → options → factors → outcomes/risks → goal
  // factor→goal is now prohibited (closed-world), must use factor→outcome→goal
  const sampleV1Response: V1DraftGraphResponse = {
    graph: {
      version: "1",
      nodes: [
        { id: "goal_revenue", kind: "goal", label: "Maximize Annual Revenue" },
        { id: "factor_price", kind: "factor", label: "Product Price", data: { value: 49, unit: "GBP" } },
        { id: "factor_marketing", kind: "factor", label: "Marketing Spend", data: { value: 10000, unit: "GBP" } },
        { id: "option_premium", kind: "option", label: "Premium Pricing", body: "Set price to £59" },
        { id: "option_economy", kind: "option", label: "Economy Pricing", body: "Set price to £39" },
        { id: "outcome_growth", kind: "outcome", label: "Business Growth" },
        { id: "risk_churn", kind: "risk", label: "Customer Churn" },
      ],
      edges: [
        // V4 topology: factor → outcome/risk → goal (not factor → goal directly)
        { from: "factor_price", to: "outcome_growth", weight: 0.8, belief: 0.9, effect_direction: "positive" },
        { from: "factor_marketing", to: "outcome_growth", weight: 0.6, belief: 0.85, effect_direction: "positive" },
        { from: "factor_price", to: "risk_churn", weight: 0.4, belief: 0.8, effect_direction: "positive" },
        { from: "outcome_growth", to: "goal_revenue", weight: 1.0, belief: 1.0, effect_direction: "positive" },
        { from: "risk_churn", to: "goal_revenue", weight: 0.5, belief: 0.9, effect_direction: "negative" },
        { from: "option_premium", to: "factor_price", weight: 0.7, belief: 0.8 },
        { from: "option_economy", to: "factor_price", weight: 0.7, belief: 0.8 },
      ],
      meta: {
        roots: ["option_premium", "option_economy"],
        leaves: ["goal_revenue"],
        source: "assistant",
      },
    },
    quality: {
      overall: 8,
      structure: 9,
      coverage: 8,
      causality: 8,
    },
    trace: {
      request_id: "test-req-123",
      correlation_id: "test-corr-456",
    },
  };

  describe("transformResponseToV3", () => {
    it("transforms V1 response to V3 format", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        brief: "We need to decide on product pricing strategy",
        requestId: "test-req-123",
      });

      expect(v3Response.schema_version).toBe("3.0");
      expect(v3Response.goal_node_id).toBe("goal_revenue");
    });

    it("keeps options in both graph nodes and options array", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // Options should be in BOTH the graph.nodes (for connectivity) AND options[] (for interventions)
      const optionNodesInGraph = v3Response.nodes.filter(
        (n) => n.kind === "option"
      );
      expect(optionNodesInGraph.length).toBe(2);

      // Options should also be in the options array with intervention metadata
      expect(v3Response.options.length).toBeGreaterThan(0);

      // Count and IDs should match (graph node IDs are source of truth)
      const optionNodeIds = optionNodesInGraph.map((n) => n.id).sort();
      const optionIds = v3Response.options.map((o) => o.id).sort();
      expect(optionIds).toEqual(optionNodeIds);
    });

    it("preserves option IDs without normalization", () => {
      const responseWithSpecialIds: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_profit", kind: "goal", label: "Grow Profit" },
            { id: "factor_price", kind: "factor", label: "Price", data: { value: 42, unit: "USD" } },
            { id: "Opt_Premium_Tier", kind: "option", label: "Premium Tier", body: "Set price to $59" },
            { id: "outcome_margin", kind: "outcome", label: "Margin" },
          ],
          edges: [
            { from: "Opt_Premium_Tier", to: "factor_price", weight: 0.7, belief: 0.8 },
            { from: "factor_price", to: "outcome_margin", weight: 0.8, belief: 0.9, effect_direction: "positive" },
            { from: "outcome_margin", to: "goal_profit", weight: 1.0, belief: 1.0, effect_direction: "positive" },
          ],
        },
      };

      const v3Response = transformResponseToV3(responseWithSpecialIds);
      const optionNode = v3Response.nodes.find((n) => n.kind === "option");
      expect(optionNode?.id).toBe("Opt_Premium_Tier");
      expect(v3Response.options[0]?.id).toBe("Opt_Premium_Tier");
    });

    it("transforms edges to V3 format with strength_mean", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const edge of v3Response.edges) {
        expect(edge).toHaveProperty("strength_mean");
        expect(edge).toHaveProperty("strength_std");
        expect(edge).toHaveProperty("belief_exists");
        expect(edge).toHaveProperty("effect_direction");
        expect(["positive", "negative"]).toContain(edge.effect_direction);
      }
    });

    it("transforms nodes to V3 format", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const node of v3Response.nodes) {
        expect(node).toHaveProperty("id");
        expect(node).toHaveProperty("kind");
        expect(node).toHaveProperty("label");
      }
    });

    it("preserves factor observed_state", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      const priceNode = v3Response.nodes.find((n) => n.id === "factor_price");
      expect(priceNode).toBeDefined();
      expect(priceNode?.observed_state).toBeDefined();
      expect(priceNode?.observed_state?.value).toBe(49);
      expect(priceNode?.observed_state?.unit).toBe("GBP");
    });

    it("includes quality metrics", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      expect(v3Response.quality).toBeDefined();
      expect(v3Response.quality?.overall).toBe(8);
    });

    it("includes trace information", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "custom-req",
        correlationId: "custom-corr",
      });

      expect(v3Response.trace?.request_id).toBe("custom-req");
      expect(v3Response.trace?.correlation_id).toBe("custom-corr");
    });
  });

  describe("V3 Schema Validation", () => {
    it("validates a correct V3 response", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const result = validateV3Response(v3Response);

      // Log errors for debugging if validation fails
      if (!result.valid) {
        console.log("Validation errors:", JSON.stringify(result.errors, null, 2));
      }

      // Validation passes if no schema errors (warnings are OK)
      const schemaErrors = result.errors.filter((e) => e.code === "SCHEMA_VALIDATION_ERROR");
      expect(schemaErrors.length).toBe(0);
    });

    it("validates against Zod schema", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const parseResult = CEEGraphResponseV3.safeParse(v3Response);

      expect(parseResult.success).toBe(true);
    });

    it("accepts quality scores in the 1–10 range (computeQuality output)", () => {
      // computeQuality() produces integer scores clamped to 1–10 via clampScore().
      // The Zod schema must accept this range (was previously mis-set to 0–1).
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const overall of [1, 5, 7, 10]) {
        const withQuality = {
          ...v3Response,
          quality: { overall, structure: 8, coverage: 6, causality: 8, safety: 9 },
        };
        const result = CEEGraphResponseV3.safeParse(withQuality);
        expect(result.success).toBe(true);
      }
    });

    it("rejects quality scores above 10", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const withBadQuality = {
        ...v3Response,
        quality: { overall: 11 },
      };
      const result = CEEGraphResponseV3.safeParse(withBadQuality);
      expect(result.success).toBe(false);
    });

    it("rejects quality score of 0 (minimum is 1)", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const withBadQuality = {
        ...v3Response,
        quality: { overall: 0 },
      };
      const result = CEEGraphResponseV3.safeParse(withBadQuality);
      expect(result.success).toBe(false);
    });

    it("rejects negative quality scores", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const withBadQuality = {
        ...v3Response,
        quality: { overall: -1 },
      };
      const result = CEEGraphResponseV3.safeParse(withBadQuality);
      expect(result.success).toBe(false);
    });

    it("detects missing goal node", () => {
      const badResponse: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          nodes: sampleV1Response.graph.nodes.filter((n) => n.kind !== "goal"),
        },
      };

      const v3Response = transformResponseToV3(badResponse);
      const result = validateV3Response(v3Response);

      expect(result.warnings.some((w) => w.code === "GOAL_NODE_MISSING")).toBe(true);
    });
  });

  describe("V3 Response Summary", () => {
    it("calculates summary statistics", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const summary = getV3ResponseSummary(v3Response);

      expect(summary.nodeCount).toBeGreaterThan(0);
      expect(summary.edgeCount).toBeGreaterThan(0);
      expect(summary.optionCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("needsUserMapping", () => {
    it("returns true when options need user mapping", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // Check if any options need mapping (depends on extraction success)
      const hasNeedsMapping = v3Response.options.some(
        (o) => o.status === "needs_user_mapping"
      );
      const result = needsUserMapping(v3Response);

      expect(result).toBe(hasNeedsMapping);
    });
  });

  describe("Strict Mode Validation", () => {
    it("does not throw for valid response", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // May have validation warnings but shouldn't have errors
      expect(() => validateStrictModeV3(v3Response)).not.toThrow();
    });
  });

  describe("Option Extraction", () => {
    it("extracts options from decision/option nodes", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // The transformer should extract option nodes
      expect(v3Response.options).toBeDefined();
      expect(Array.isArray(v3Response.options)).toBe(true);
    });

    it("options have required fields", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const option of v3Response.options) {
        expect(option).toHaveProperty("id");
        expect(option).toHaveProperty("label");
        expect(option).toHaveProperty("status");
        expect(option).toHaveProperty("interventions");
        expect(["ready", "needs_user_mapping"]).toContain(option.status);
      }
    });

    it("marks vague options as needs_user_mapping and includes user_questions", () => {
      const vagueResponse: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Maximize Annual Revenue" },
            { id: "factor_price", kind: "factor", label: "Product Price", data: { value: 49, unit: "GBP" } },
            { id: "option_vague", kind: "option", label: "Improve marketing", body: "Improve marketing presence" },
            { id: "outcome_growth", kind: "outcome", label: "Business Growth" },
          ],
          edges: [
            // V4 topology: factor → outcome → goal (not factor → goal directly)
            { from: "factor_price", to: "outcome_growth", weight: 0.8, belief: 0.9, effect_direction: "positive" },
            { from: "outcome_growth", to: "goal_revenue", weight: 1.0, belief: 1.0, effect_direction: "positive" },
          ],
        },
      };

      const v3Response = transformResponseToV3(vagueResponse);
      const option = v3Response.options.find((o) => o.label === "Improve marketing");

      expect(option).toBeDefined();
      expect(option?.status).toBe("needs_user_mapping");
      expect(Object.keys(option?.interventions ?? {}).length).toBe(0);
      expect(option?.user_questions?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe("Edge Effect Direction", () => {
    it("derives effect_direction from strength_mean sign", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const edge of v3Response.edges) {
        if (edge.strength_mean >= 0) {
          expect(edge.effect_direction).toBe("positive");
        } else {
          expect(edge.effect_direction).toBe("negative");
        }
      }
    });

    it("preserves negative effect directions", () => {
      // Use factor_marketing -> risk_churn which doesn't exist in sampleV1Response
      const responseWithNegativeEffect: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          edges: [
            ...sampleV1Response.graph.edges,
            { from: "factor_marketing", to: "risk_churn", weight: 0.5, belief: 0.7, effect_direction: "negative" },
          ],
        },
      };

      const v3Response = transformResponseToV3(responseWithNegativeEffect);
      const negativeEdge = v3Response.edges.find(
        (e) => e.from === "factor_marketing" && e.to === "risk_churn"
      );

      expect(negativeEdge).toBeDefined();
      expect(negativeEdge?.effect_direction).toBe("negative");
      expect(negativeEdge?.strength_mean).toBeLessThan(0);
    });
  });

  describe("Risk Node Coefficient Sign (Goal Repair)", () => {
    it("REGRESSION: risk→goal edges have negative strength_mean", () => {
      // This test verifies that risk→goal edges have negative coefficients
      // in V3 output. The LLM prompt and goal-repair both specify that
      // risk→goal should have negative strength.
      const responseWithRisk: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_1", kind: "goal", label: "Achieve Success" },
            { id: "factor_1", kind: "factor", label: "Investment", data: { value: 100 } },
            { id: "outcome_1", kind: "outcome", label: "Revenue Growth" },
            { id: "risk_1", kind: "risk", label: "Budget Overrun" },
            { id: "option_1", kind: "option", label: "Option A" },
          ],
          edges: [
            { from: "factor_1", to: "outcome_1", weight: 0.8, belief: 0.9 },
            { from: "factor_1", to: "risk_1", weight: 0.6, belief: 0.8 },
            // Outcome → Goal: POSITIVE (contributes)
            { from: "outcome_1", to: "goal_1", weight: 0.7, belief: 0.9, effect_direction: "positive" },
            // Risk → Goal: NEGATIVE (detracts)
            { from: "risk_1", to: "goal_1", weight: 0.5, belief: 0.9, effect_direction: "negative" },
            { from: "option_1", to: "factor_1", weight: 1.0, belief: 1.0 },
          ],
        },
      };

      const v3Response = transformResponseToV3(responseWithRisk);

      // Find risk→goal and outcome→goal edges
      const riskToGoal = v3Response.edges.find(
        (e) => e.from === "risk_1" && e.to === "goal_1"
      );
      const outcomeToGoal = v3Response.edges.find(
        (e) => e.from === "outcome_1" && e.to === "goal_1"
      );

      expect(riskToGoal).toBeDefined();
      expect(outcomeToGoal).toBeDefined();

      // Risk → Goal MUST have negative coefficient
      expect(riskToGoal?.strength_mean).toBeLessThan(0);
      expect(riskToGoal?.effect_direction).toBe("negative");

      // Outcome → Goal should have positive coefficient
      expect(outcomeToGoal?.strength_mean).toBeGreaterThan(0);
      expect(outcomeToGoal?.effect_direction).toBe("positive");
    });

    it("handles edges with flat strength_mean fields (post-goal-repair format)", () => {
      // After goal repair, edges use flat field names (strength_mean, strength_std, belief_exists)
      // instead of nested (strength.mean, exists_probability). This test verifies
      // that such edges are correctly handled.
      const responseWithFlatFields: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_1", kind: "goal", label: "Success" },
            { id: "risk_1", kind: "risk", label: "Churn Risk" },
            { id: "out_1", kind: "outcome", label: "Revenue" },
          ],
          edges: [
            // Flat field format (as produced by wireOutcomesToGoal)
            { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15, belief_exists: 0.9 } as any,
            { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9 } as any,
          ],
        },
      };

      const v3Response = transformResponseToV3(responseWithFlatFields);

      const riskEdge = v3Response.edges.find((e) => e.from === "risk_1");
      const outcomeEdge = v3Response.edges.find((e) => e.from === "out_1");

      // Verify edges are transformed correctly
      expect(riskEdge).toBeDefined();
      expect(riskEdge?.strength_mean).toBeLessThan(0);
      expect(riskEdge?.effect_direction).toBe("negative");

      expect(outcomeEdge).toBeDefined();
      expect(outcomeEdge?.strength_mean).toBeGreaterThan(0);
      expect(outcomeEdge?.effect_direction).toBe("positive");
    });
  });

  describe("Backward Compatibility", () => {
    it("handles V1 responses without effect_direction", () => {
      const responseWithoutEffectDirection: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          edges: sampleV1Response.graph.edges.map((e) => ({
            from: e.from,
            to: e.to,
            weight: e.weight,
            belief: e.belief,
            // No effect_direction
          })),
        },
      };

      const v3Response = transformResponseToV3(responseWithoutEffectDirection);

      // Should still have effect_direction derived from weight
      for (const edge of v3Response.edges) {
        expect(edge.effect_direction).toBeDefined();
        expect(["positive", "negative"]).toContain(edge.effect_direction);
      }
    });

    it("handles responses without quality metrics", () => {
      const responseWithoutQuality: V1DraftGraphResponse = {
        graph: sampleV1Response.graph,
        trace: sampleV1Response.trace,
      };

      const v3Response = transformResponseToV3(responseWithoutQuality);

      expect(v3Response.schema_version).toBe("3.0");
      expect(v3Response.quality).toBeUndefined();
    });
  });

  // ── CIL Phase 0: goal_constraints carry-through ──────────────────────
  describe("goal_constraints in V3 output", () => {
    it("carries goal_constraints from V1 response into V3 output", () => {
      const v1WithConstraints: V1DraftGraphResponse = {
        ...sampleV1Response,
        goal_constraints: [
          {
            constraint_id: "c1",
            node_id: "goal_revenue",
            operator: ">=",
            value: 0.7,
            label: "Revenue target",
          },
        ],
      };

      const v3Response = transformResponseToV3(v1WithConstraints);

      expect(v3Response.goal_constraints).toBeDefined();
      expect(v3Response.goal_constraints).toHaveLength(1);
      expect(v3Response.goal_constraints![0]).toMatchObject({
        constraint_id: "c1",
        node_id: "goal_revenue",
        operator: ">=",
        value: 0.7,
        label: "Revenue target",
      });
    });

    it("omits goal_constraints when not present in V1 response", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      expect(v3Response.goal_constraints).toBeUndefined();
    });

    it("omits goal_constraints when V1 has empty array", () => {
      const v1WithEmpty: V1DraftGraphResponse = {
        ...sampleV1Response,
        goal_constraints: [],
      };

      const v3Response = transformResponseToV3(v1WithEmpty);

      expect(v3Response.goal_constraints).toBeUndefined();
    });

    it("goal_constraints survives CEEGraphResponseV3.safeParse()", () => {
      const v1WithConstraints: V1DraftGraphResponse = {
        ...sampleV1Response,
        goal_constraints: [
          {
            constraint_id: "c2",
            node_id: "goal_revenue",
            operator: "<=",
            value: 500,
            label: "Budget cap",
            unit: "GBP",
          },
        ],
      };

      const v3Response = transformResponseToV3(v1WithConstraints);
      const parseResult = CEEGraphResponseV3.safeParse(v3Response);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.data.goal_constraints).toBeDefined();
        expect(parseResult.data.goal_constraints).toHaveLength(1);
        expect(parseResult.data.goal_constraints![0].constraint_id).toBe("c2");
      }
    });
  });

  // ============================================================================
  // Task C: Bundle-trace alignment integration test (CIL Phase 0.1)
  // ============================================================================
  describe("CIL Phase 0.1: Bundle-trace alignment", () => {
    it("includeDebug=true → trace.pipeline.integrity_warnings exists with correct shape", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "test-bundle-alignment",
        includeDebug: true,
      });

      // integrity_warnings must exist in the response (even if empty)
      expect(v3Response.trace).toBeDefined();
      const pipeline = v3Response.trace?.pipeline as Record<string, unknown> | undefined;
      expect(pipeline).toBeDefined();
      expect(pipeline!.integrity_warnings).toBeDefined();

      const iw = pipeline!.integrity_warnings as {
        warnings: Array<{ code: string; node_id?: string; details: string }>;
        input_counts: { node_count: number; edge_count: number; node_ids: string[] };
        output_counts: { node_count: number; edge_count: number; node_ids: string[] };
      };

      // Shape checks
      expect(Array.isArray(iw.warnings)).toBe(true);
      expect(iw.input_counts).toBeDefined();
      expect(iw.output_counts).toBeDefined();
      expect(typeof iw.input_counts.node_count).toBe("number");
      expect(typeof iw.input_counts.edge_count).toBe("number");
      expect(Array.isArray(iw.input_counts.node_ids)).toBe(true);
      expect(typeof iw.output_counts.node_count).toBe("number");
      expect(typeof iw.output_counts.edge_count).toBe("number");
      expect(Array.isArray(iw.output_counts.node_ids)).toBe(true);
    });

    it("includeDebug=true → input_counts and output_counts reflect actual graph", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "test-bundle-counts",
        includeDebug: true,
      });

      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string; node_id?: string }>;
        input_counts: { node_count: number; edge_count: number; node_ids: string[] };
        output_counts: { node_count: number; edge_count: number; node_ids: string[] };
      };

      // input_counts should reflect the V1 input graph
      expect(iw.input_counts.node_count).toBe(sampleV1Response.graph.nodes.length);
      expect(iw.input_counts.edge_count).toBe(sampleV1Response.graph.edges.length);

      // output_counts should reflect the V3 output
      expect(iw.output_counts.node_count).toBe(v3Response.nodes.length);
      expect(iw.output_counts.edge_count).toBe(v3Response.edges.length);
    });

    it("includeDebug=true → output node_ids are subset of input node_ids after normalisation", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "test-bundle-subset",
        includeDebug: true,
      });

      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string; node_id?: string }>;
        input_counts: { node_count: number; node_ids: string[] };
        output_counts: { node_count: number; node_ids: string[] };
      };

      const inputNormIds = new Set(iw.input_counts.node_ids.map((id: string) => normaliseIdForMatch(id)));
      const outputNormIds = iw.output_counts.node_ids.map((id: string) => normaliseIdForMatch(id));

      // Every output node should have a corresponding input node (after normalisation)
      // OR a NODE_DROPPED / SYNTHETIC_NODE_INJECTED warning should exist
      for (const outId of outputNormIds) {
        if (!inputNormIds.has(outId)) {
          // Must have a SYNTHETIC_NODE_INJECTED warning
          const syntheticWarning = iw.warnings.find(
            (w) => w.code === "SYNTHETIC_NODE_INJECTED" && normaliseIdForMatch(w.node_id ?? "") === outId
          );
          expect(syntheticWarning).toBeDefined();
        }
      }

      // Any input node not in output should have a NODE_DROPPED warning
      const outputNormIdSet = new Set(outputNormIds);
      for (const inputId of iw.input_counts.node_ids) {
        const normInputId = normaliseIdForMatch(inputId);
        if (!outputNormIdSet.has(normInputId)) {
          const droppedWarning = iw.warnings.find(
            (w) => w.code === "NODE_DROPPED" && normaliseIdForMatch(w.node_id ?? "") === normInputId
          );
          expect(droppedWarning).toBeDefined();
        }
      }
    });

    it("includeDebug=false and no debugLoggingEnabled → integrity_warnings absent", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "test-bundle-off",
        // includeDebug not set (defaults to undefined/false)
      });

      const pipeline = v3Response.trace?.pipeline as Record<string, unknown> | undefined;
      // integrity_warnings should be absent (sentinel did not run)
      if (pipeline) {
        expect(pipeline.integrity_warnings).toBeUndefined();
      }
    });

    it("includeDebug=true → raw_counts (deprecated) aliases input_counts for backward compat", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "test-bundle-compat",
        includeDebug: true,
      });

      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string }>;
        input_counts: { node_count: number; edge_count: number; node_ids: string[] };
        raw_counts?: { node_count: number; edge_count: number; node_ids: string[] };
      };

      // Both keys should exist
      expect(iw.input_counts).toBeDefined();
      expect(iw.raw_counts).toBeDefined();

      // raw_counts should be identical to input_counts (backward compat shim)
      expect(iw.raw_counts!.node_count).toBe(iw.input_counts.node_count);
      expect(iw.raw_counts!.edge_count).toBe(iw.input_counts.edge_count);
      expect(iw.raw_counts!.node_ids).toEqual(iw.input_counts.node_ids);
    });
  });

  // ── CIL Phase 1: Strength Default Detection ───────────────────────────
  describe("CIL Phase 1: Strength default warnings", () => {
    it("detects uniform 0.5 strength → warning in validation_warnings AND counter in integrity_warnings", () => {
      // Create V1 response with edges that all have strength_mean = 0.5 AND strength_std = 0.125 (uniform default)
      const v1Response = {
        graph: {
          nodes: [
            { id: "factor_a", kind: "factor", label: "Factor A", data: {} },
            { id: "factor_b", kind: "factor", label: "Factor B", data: {} },
            { id: "goal_revenue", kind: "goal", label: "Revenue", data: {} },
          ],
          edges: [
            { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_b", to: "goal_revenue", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_a", to: "goal_revenue", strength_mean: 0.5, strength_std: 0.125 },
          ],
        },
        options: [],
        quality: { overall: 0.8 },
        trace: { request_id: "test-strength-default", pipeline: {} },
      };

      const v3Response = transformResponseToV3(v1Response, {
        requestId: "test-strength-default",
        includeDebug: true, // Enable sentinel for counter
      });

      // Verify validation_warnings contains STRENGTH_DEFAULT_APPLIED (user-facing)
      expect(v3Response.validation_warnings).toBeDefined();
      const validationStrengthWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      expect(validationStrengthWarning).toBeDefined();
      expect(validationStrengthWarning?.severity).toBe("warn");
      expect(validationStrengthWarning?.message).toContain("3 of 3 edges");
      expect(validationStrengthWarning?.message).toContain("100%");

      // Verify details payload
      expect(validationStrengthWarning?.details).toBeDefined();
      expect(validationStrengthWarning?.details?.total_edges).toBe(3);
      expect(validationStrengthWarning?.details?.defaulted_count).toBe(3);
      expect(validationStrengthWarning?.details?.defaulted_percentage).toBe(100.0);
      expect(validationStrengthWarning?.details?.defaulted_edge_ids).toEqual([
        "factor_a->factor_b",
        "factor_b->goal_revenue",
        "factor_a->goal_revenue",
      ]);

      // Verify strength_defaults counter in integrity_warnings (debug evidence)
      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string }>;
        strength_defaults: {
          detected: boolean;
          total_edges: number;
          defaulted_count: number;
          default_value: number | null;
        };
      };

      expect(iw.strength_defaults).toBeDefined();
      expect(iw.strength_defaults.detected).toBe(true);
      expect(iw.strength_defaults.total_edges).toBe(3);
      expect(iw.strength_defaults.defaulted_count).toBe(3);
      expect(iw.strength_defaults.default_value).toBe(0.5);

      // Warning is NOT in integrity_warnings.warnings (moved to validation_warnings)
      const strengthWarningInIntegrity = iw.warnings.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      expect(strengthWarningInIntegrity).toBeUndefined();
    });

    it("varied strength values → NO warning in validation_warnings", () => {
      const v1Response = {
        graph: {
          nodes: [
            { id: "factor_a", kind: "factor", label: "Factor A", data: {} },
            { id: "factor_b", kind: "factor", label: "Factor B", data: {} },
            { id: "goal_revenue", kind: "goal", label: "Revenue", data: {} },
          ],
          edges: [
            { from: "factor_a", to: "factor_b", strength_mean: 0.3, strength_std: 0.15 },
            { from: "factor_b", to: "goal_revenue", strength_mean: 0.7, strength_std: 0.15 },
            { from: "factor_a", to: "goal_revenue", strength_mean: 0.9, strength_std: 0.15 },
          ],
        },
        options: [],
        quality: { overall: 0.8 },
        trace: { request_id: "test-varied-strength", pipeline: {} },
      };

      const v3Response = transformResponseToV3(v1Response, {
        requestId: "test-varied-strength",
        includeDebug: true,
      });

      // Verify NO STRENGTH_DEFAULT_APPLIED in validation_warnings
      const validationStrengthWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      expect(validationStrengthWarning).toBeUndefined();

      // Counter should show 0 defaulted (debug evidence)
      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string }>;
        strength_defaults: { detected: boolean; total_edges: number; defaulted_count: number };
      };

      expect(iw.strength_defaults.detected).toBe(false);
      expect(iw.strength_defaults.total_edges).toBe(3);
      expect(iw.strength_defaults.defaulted_count).toBe(0);
    });

    it("STRENGTH_DEFAULT_APPLIED appears in validation_warnings even when includeDebug=false (production mode)", () => {
      // Critical: strength warnings must be user-visible in production, not debug-gated
      const v1Response = {
        graph: {
          nodes: [
            { id: "factor_a", kind: "factor", label: "Factor A", data: {} },
            { id: "factor_b", kind: "factor", label: "Factor B", data: {} },
            { id: "goal", kind: "goal", label: "Goal", data: {} },
          ],
          edges: [
            { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
          ],
        },
        options: [],
        quality: { overall: 0.8 },
        trace: { request_id: "test-prod-warning", pipeline: {} },
      };

      const v3Response = transformResponseToV3(v1Response, {
        requestId: "test-prod-warning",
        includeDebug: false, // Production mode (sentinel disabled)
      });

      // Strength warning should appear in validation_warnings (user-facing)
      expect(v3Response.validation_warnings).toBeDefined();
      const strengthWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      expect(strengthWarning).toBeDefined();
      expect(strengthWarning?.message).toContain("3 of 3 edges");
      expect(strengthWarning?.severity).toBe("warn");

      // But integrity_warnings won't exist (sentinel disabled)
      const pipeline = v3Response.trace?.pipeline as Record<string, unknown> | undefined;
      expect(pipeline?.integrity_warnings).toBeUndefined();
    });

    it("STRENGTH_MEAN_DEFAULT_DOMINANT appears when ≥70% have mean ≈ 0.5 with varied std", () => {
      // CIL Phase 1.1: Detects when LLM varied belief/provenance but defaulted magnitude
      const v1Response = {
        graph: {
          nodes: [
            { id: "factor_a", kind: "factor", label: "Factor A", data: {} },
            { id: "factor_b", kind: "factor", label: "Factor B", data: {} },
            { id: "goal", kind: "goal", label: "Goal", data: {} },
          ],
          edges: [
            // All have mean=0.5 but std varies (not the full default signature)
            { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.2 },
            { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.18 },
            { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
          ],
        },
        options: [],
        quality: { overall: 0.8 },
        trace: { request_id: "test-mean-dominant", pipeline: {} },
      };

      const v3Response = transformResponseToV3(v1Response, {
        requestId: "test-mean-dominant",
        includeDebug: true,
      });

      // Verify STRENGTH_MEAN_DEFAULT_DOMINANT appears in validation_warnings
      expect(v3Response.validation_warnings).toBeDefined();
      const meanDominantWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_MEAN_DEFAULT_DOMINANT"
      );
      expect(meanDominantWarning).toBeDefined();
      expect(meanDominantWarning?.severity).toBe("warn");
      expect(meanDominantWarning?.message).toContain("3 of 3 edges");
      expect(meanDominantWarning?.message).toContain("100%");

      // Verify details payload
      expect(meanDominantWarning?.details).toBeDefined();
      expect(meanDominantWarning?.details?.total_edges).toBe(3);
      expect(meanDominantWarning?.details?.mean_default_count).toBe(3);
      expect(meanDominantWarning?.details?.mean_default_percentage).toBe(100.0);
      expect(meanDominantWarning?.details?.mean_defaulted_edge_ids).toEqual([
        "factor_a->factor_b",
        "factor_b->goal",
        "factor_a->goal",
      ]);

      // Verify strength_mean_dominant counter in integrity_warnings (debug evidence)
      const pipeline = v3Response.trace?.pipeline as Record<string, unknown>;
      const iw = pipeline.integrity_warnings as {
        warnings: Array<{ code: string }>;
        strength_mean_dominant: {
          detected: boolean;
          total_edges: number;
          mean_default_count: number;
          default_value: number | null;
        };
      };

      expect(iw.strength_mean_dominant).toBeDefined();
      expect(iw.strength_mean_dominant.detected).toBe(true);
      expect(iw.strength_mean_dominant.total_edges).toBe(3);
      expect(iw.strength_mean_dominant.mean_default_count).toBe(3);
      expect(iw.strength_mean_dominant.default_value).toBe(0.5);

      // Also verify STRENGTH_DEFAULT_APPLIED does NOT fire (std varies, not all 0.125)
      const fullDefaultWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      expect(fullDefaultWarning).toBeUndefined();
    });

    it("both STRENGTH_DEFAULT_APPLIED and STRENGTH_MEAN_DEFAULT_DOMINANT fire simultaneously", () => {
      // When all edges have both mean=0.5 AND std=0.125, both warnings should appear
      const v1Response = {
        graph: {
          nodes: [
            { id: "factor_a", kind: "factor", label: "Factor A", data: {} },
            { id: "factor_b", kind: "factor", label: "Factor B", data: {} },
            { id: "goal", kind: "goal", label: "Goal", data: {} },
          ],
          edges: [
            { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
            { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
          ],
        },
        options: [],
        quality: { overall: 0.8 },
        trace: { request_id: "test-both-warnings", pipeline: {} },
      };

      const v3Response = transformResponseToV3(v1Response, {
        requestId: "test-both-warnings",
        includeDebug: true,
      });

      // Both warnings should be present
      expect(v3Response.validation_warnings).toBeDefined();
      const strengthDefaultWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_DEFAULT_APPLIED"
      );
      const meanDominantWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "STRENGTH_MEAN_DEFAULT_DOMINANT"
      );

      expect(strengthDefaultWarning).toBeDefined();
      expect(meanDominantWarning).toBeDefined();

      // Both should report 100% (3 of 3)
      expect(strengthDefaultWarning?.details?.defaulted_percentage).toBe(100.0);
      expect(meanDominantWarning?.details?.mean_default_percentage).toBe(100.0);
    });
  });
});
