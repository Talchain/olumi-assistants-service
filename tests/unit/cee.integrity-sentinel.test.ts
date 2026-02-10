import { describe, it, expect } from "vitest";
import {
  runIntegrityChecks,
  normaliseIdForMatch,
  detectStrengthDefaults,
  detectStrengthMeanDominant,
  type IntegrityWarning,
  type IntegrityWarningsOutput,
} from "../../src/cee/validation/integrity-sentinel.js";

/**
 * CIL Phase 0.2 — Sentinel integrity check tests.
 *
 * Verifies that runIntegrityChecks correctly detects data loss between
 * pipeline V1 input and V3 response, and returns enriched output with
 * input_counts / output_counts evidence for debug bundles.
 */
describe("CIL Phase 0.2: Sentinel integrity checks", () => {
  // ── normaliseIdForMatch ────────────────────────────────────────────────
  describe("normaliseIdForMatch", () => {
    it("preserves IDs that already match the valid pattern", () => {
      expect(normaliseIdForMatch("Factor_Price")).toBe("Factor_Price");
      expect(normaliseIdForMatch("Goal-Revenue")).toBe("Goal-Revenue");
      expect(normaliseIdForMatch("factor_price")).toBe("factor_price");
    });

    it("normalises human-readable labels the same way as production", () => {
      expect(normaliseIdForMatch("Price (GBP)")).toBe("price_gbp");
      expect(normaliseIdForMatch("Marketing Spend")).toBe("marketing_spend");
      expect(normaliseIdForMatch("opt (A)")).toBe("opt_a");
    });
  });

  // ── CATEGORY_STRIPPED ──────────────────────────────────────────────────
  describe("CATEGORY_STRIPPED", () => {
    it("emits warning when factor has category in raw but not in V3", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor", category: "controllable" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const catWarnings = result.warnings.filter((w) => w.code === "CATEGORY_STRIPPED");

      expect(catWarnings).toHaveLength(1);
      expect(catWarnings[0].node_id).toBe("factor_price");
      expect(catWarnings[0].details).toContain("category");
      expect(catWarnings[0].details).toContain("controllable");
    });

    it("does not emit when category is preserved", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor", category: "controllable" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor", category: "controllable" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const catWarnings = result.warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(catWarnings).toHaveLength(0);
    });
  });

  // ── NODE_DROPPED ───────────────────────────────────────────────────
  describe("NODE_DROPPED", () => {
    it("emits warning when raw node is missing from V3", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
        { id: "factor_demand", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");

      expect(dropped).toHaveLength(1);
      expect(dropped[0].node_id).toBe("factor_demand");
    });
  });

  // ── SYNTHETIC_NODE_INJECTED ──────────────────────────────────────────
  describe("SYNTHETIC_NODE_INJECTED", () => {
    it("emits warning when V3 has node not in raw", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
        { id: "synthetic_node", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const synthetic = result.warnings.filter((w) => w.code === "SYNTHETIC_NODE_INJECTED");

      expect(synthetic).toHaveLength(1);
      expect(synthetic[0].node_id).toBe("synthetic_node");
    });
  });

  // ── GOAL_THRESHOLD_STRIPPED ──────────────────────────────────────────
  describe("GOAL_THRESHOLD_STRIPPED", () => {
    it("emits warning when goal_threshold fields are in raw but not V3", () => {
      const rawNodes = [
        {
          id: "goal_revenue",
          kind: "goal",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
          goal_threshold_unit: "customers",
          goal_threshold_cap: 1000,
        },
      ];
      const v3Nodes = [
        { id: "goal_revenue", kind: "goal" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const threshold = result.warnings.filter((w) => w.code === "GOAL_THRESHOLD_STRIPPED");

      expect(threshold).toHaveLength(1);
      expect(threshold[0].node_id).toBe("goal_revenue");
      expect(threshold[0].details).toContain("goal_threshold");
    });

    it("does not emit when goal_threshold fields are preserved", () => {
      const rawNodes = [
        {
          id: "goal_revenue",
          kind: "goal",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
        },
      ];
      const v3Nodes = [
        {
          id: "goal_revenue",
          kind: "goal",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
        },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const threshold = result.warnings.filter((w) => w.code === "GOAL_THRESHOLD_STRIPPED");
      expect(threshold).toHaveLength(0);
    });
  });

  // ── ENRICHMENT_STRIPPED ────────────────────────────────────────────────
  describe("ENRICHMENT_STRIPPED", () => {
    it("emits warning when enrichment fields in raw data are absent from V3 observed_state", () => {
      const rawNodes = [
        {
          id: "factor_price",
          kind: "factor",
          data: {
            value: 49,
            raw_value: 49,
            cap: 100,
            factor_type: "price",
            uncertainty_drivers: ["market volatility"],
          },
        },
      ];
      const v3Nodes = [
        {
          id: "factor_price",
          kind: "factor",
          observed_state: { value: 49 },
        },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const enrichment = result.warnings.filter((w) => w.code === "ENRICHMENT_STRIPPED");

      expect(enrichment).toHaveLength(1);
      expect(enrichment[0].node_id).toBe("factor_price");
      expect(enrichment[0].details).toContain("raw_value");
      expect(enrichment[0].details).toContain("cap");
      expect(enrichment[0].details).toContain("factor_type");
      expect(enrichment[0].details).toContain("uncertainty_drivers");
    });

    it("does not emit when enrichment fields are preserved in observed_state", () => {
      const rawNodes = [
        {
          id: "factor_price",
          kind: "factor",
          data: { value: 49, raw_value: 49, cap: 100 },
        },
      ];
      const v3Nodes = [
        {
          id: "factor_price",
          kind: "factor",
          observed_state: { value: 49, raw_value: 49, cap: 100 },
        },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const enrichment = result.warnings.filter((w) => w.code === "ENRICHMENT_STRIPPED");
      expect(enrichment).toHaveLength(0);
    });
  });

  // ── INTERVENTIONS_STRIPPED ─────────────────────────────────────────────
  describe("INTERVENTIONS_STRIPPED", () => {
    it("emits warning when option has interventions in raw but empty in V3", () => {
      const rawNodes = [
        {
          id: "option_premium",
          kind: "option",
          data: { interventions: { factor_price: { value: 59 } } },
        },
      ];
      const v3Nodes = [{ id: "option_premium", kind: "option" }];
      const v3Options = [{ id: "option_premium", interventions: {} }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      const intWarnings = result.warnings.filter((w) => w.code === "INTERVENTIONS_STRIPPED");

      expect(intWarnings).toHaveLength(1);
      expect(intWarnings[0].node_id).toBe("option_premium");
    });

    it("does not emit when option interventions are preserved", () => {
      const rawNodes = [
        {
          id: "option_premium",
          kind: "option",
          data: { interventions: { factor_price: { value: 59 } } },
        },
      ];
      const v3Nodes = [{ id: "option_premium", kind: "option" }];
      const v3Options = [
        {
          id: "option_premium",
          interventions: { factor_price: { value: 59, source: "brief_extraction", target_match: { node_id: "factor_price", match_type: "exact_id", confidence: "high" } } },
        },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      const intWarnings = result.warnings.filter((w) => w.code === "INTERVENTIONS_STRIPPED");
      expect(intWarnings).toHaveLength(0);
    });
  });

  // ── Clean fixture → zero warnings ───────────────────────────────────────
  describe("clean fixture", () => {
    it("emits zero warnings when everything matches", () => {
      const rawNodes = [
        { id: "goal_revenue", kind: "goal", goal_threshold: 0.8 },
        {
          id: "factor_price",
          kind: "factor",
          category: "controllable",
          data: { value: 49, unit: "GBP", raw_value: 49 },
        },
        {
          id: "option_premium",
          kind: "option",
          data: { interventions: { factor_price: { value: 59 } } },
        },
      ];
      const v3Nodes = [
        { id: "goal_revenue", kind: "goal", goal_threshold: 0.8 },
        {
          id: "factor_price",
          kind: "factor",
          category: "controllable",
          observed_state: { value: 49, unit: "GBP", raw_value: 49 },
        },
        { id: "option_premium", kind: "option" },
      ];
      const v3Options = [
        { id: "option_premium", interventions: { factor_price: { value: 59 } } },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ── ID normalisation matching ──────────────────────────────────────────
  describe("ID normalisation matching", () => {
    it("matches raw human-readable label to V3 normalised ID", () => {
      const rawNodes = [
        { id: "Price (GBP)", kind: "factor", category: "controllable" },
      ];
      const v3Nodes = [
        { id: "price_gbp", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");
      const catStripped = result.warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(dropped).toHaveLength(0);
      expect(catStripped).toHaveLength(1);
    });

    it("valid IDs with different casing are treated as different nodes", () => {
      const rawNodes = [{ id: "Factor_Price", kind: "factor" }];
      const v3Nodes = [{ id: "factor_price", kind: "factor" }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");
      const synthetic = result.warnings.filter((w) => w.code === "SYNTHETIC_NODE_INJECTED");
      expect(dropped).toHaveLength(1);
      expect(synthetic).toHaveLength(1);
    });
  });

  // ── Collision handling ─────────────────────────────────────────────────
  describe("collision handling", () => {
    it("checks all raw nodes that normalise to the same key", () => {
      const rawNodes = [
        { id: "Marketing Spend", kind: "factor", category: "controllable" },
        { id: "Marketing  Spend", kind: "factor", category: "external" },
      ];
      const v3Nodes = [
        { id: "marketing_spend", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);
      const catStripped = result.warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(catStripped).toHaveLength(2);
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");
      expect(dropped).toHaveLength(0);
    });
  });

  // ============================================================================
  // Task A: Debug bundle visibility tests
  // ============================================================================
  describe("Task A: debug bundle visibility", () => {
    it("returns IntegrityWarningsOutput with non-empty warnings for mismatch fixture", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
        { id: "factor_demand", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
        // factor_demand dropped
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);

      // Result is IntegrityWarningsOutput, not a flat array
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("input_counts");
      expect(result).toHaveProperty("output_counts");
      expect(result.warnings.length).toBeGreaterThan(0);

      // At least one NODE_DROPPED
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");
      expect(dropped.length).toBeGreaterThanOrEqual(1);
      expect(dropped[0].node_id).toBe("factor_demand");
    });

    it("returns IntegrityWarningsOutput with empty warnings [] for clean fixture", () => {
      const rawNodes = [{ id: "factor_price", kind: "factor" }];
      const v3Nodes = [{ id: "factor_price", kind: "factor" }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);

      expect(result).toHaveProperty("warnings");
      expect(result.warnings).toHaveLength(0);
      // Counts still present even with no warnings
      expect(result.input_counts).toBeDefined();
      expect(result.output_counts).toBeDefined();
    });
  });

  // ============================================================================
  // Task B: Evidence counts tests
  // ============================================================================
  describe("Task B: input_counts / output_counts evidence", () => {
    it("input_counts and output_counts match actual fixture data", () => {
      const rawNodes = [
        { id: "goal_revenue", kind: "goal" },
        { id: "factor_price", kind: "factor" },
        { id: "factor_demand", kind: "factor" },
      ];
      const rawEdges = [
        { from: "factor_price", to: "goal_revenue" },
        { from: "factor_demand", to: "goal_revenue" },
      ];
      const v3Nodes = [
        { id: "goal_revenue", kind: "goal" },
        { id: "factor_price", kind: "factor" },
      ];
      const v3Edges = [
        { from: "factor_price", to: "goal_revenue" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], rawEdges, v3Edges);

      expect(result.input_counts.node_count).toBe(3);
      expect(result.input_counts.edge_count).toBe(2);
      expect(result.input_counts.node_ids).toEqual(["goal_revenue", "factor_price", "factor_demand"]);

      expect(result.output_counts.node_count).toBe(2);
      expect(result.output_counts.edge_count).toBe(1);
      expect(result.output_counts.node_ids).toEqual(["goal_revenue", "factor_price"]);
    });

    it("dropped node appears in input_counts.node_ids but not output_counts.node_ids, with NODE_DROPPED warning", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
        { id: "factor_demand", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);

      // factor_demand is in input but not output
      expect(result.input_counts.node_ids).toContain("factor_demand");
      expect(result.output_counts.node_ids).not.toContain("factor_demand");

      // Corresponding NODE_DROPPED warning exists
      const dropped = result.warnings.filter((w) => w.code === "NODE_DROPPED");
      expect(dropped).toHaveLength(1);
      expect(dropped[0].node_id).toBe("factor_demand");
    });

    it("counts populate even when no warnings (clean fixture)", () => {
      const rawNodes = [{ id: "factor_price", kind: "factor" }];
      const rawEdges = [{ from: "factor_price", to: "goal" }];
      const v3Nodes = [{ id: "factor_price", kind: "factor" }];
      const v3Edges = [{ from: "factor_price", to: "goal" }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], rawEdges, v3Edges);

      expect(result.warnings).toHaveLength(0);
      expect(result.input_counts.node_count).toBe(1);
      expect(result.input_counts.edge_count).toBe(1);
      expect(result.output_counts.node_count).toBe(1);
      expect(result.output_counts.edge_count).toBe(1);
    });

    it("edge counts default to 0 when edges not provided", () => {
      const rawNodes = [{ id: "factor_price", kind: "factor" }];
      const v3Nodes = [{ id: "factor_price", kind: "factor" }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, []);

      expect(result.input_counts.edge_count).toBe(0);
      expect(result.output_counts.edge_count).toBe(0);
    });
  });

  // ── CIL Phase 1: STRENGTH_DEFAULT_APPLIED ──────────────────────────────
  describe("STRENGTH_DEFAULT_APPLIED (Phase 1)", () => {
    it("detects uniform 0.5 strength values across all edges", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Verify counter values (warning is added at schema-v3 level, not here)
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(3);
      expect(result.strength_defaults.default_value).toBe(0.5);
      expect(result.strength_defaults.defaulted_edge_ids).toEqual([
        "factor_a->factor_b",
        "factor_b->goal",
        "factor_a->goal",
      ]);

      // Note: STRENGTH_DEFAULT_APPLIED warning is no longer added to result.warnings here.
      // It's added to validation_warnings in schema-v3.ts for production visibility.
      // See integration tests for end-to-end warning propagation.
    });

    it("does NOT detect when edges have varied strength values", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.3 },
        { from: "factor_b", to: "goal", strength_mean: 0.7 },
        { from: "factor_a", to: "goal", strength_mean: 0.9 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // No uniform defaulting - detected should be false
      expect(result.strength_defaults.detected).toBe(false);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(0);
      expect(result.strength_defaults.default_value).toBe(null);
    });

    it("detects when exactly 80% threshold is met (4 of 5 edges)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_c", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "goal", strength_mean: 0.8, strength_std: 0.2 }, // One varied edge
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // 80% threshold met - detected flag should be true
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.total_edges).toBe(5);
      expect(result.strength_defaults.defaulted_count).toBe(4);
      expect(result.strength_defaults.default_value).toBe(0.5);
    });

    it("does NOT detect when below 80% threshold (3 of 5 = 60%)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_c", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_a", to: "goal", strength_mean: 0.7, strength_std: 0.2 },
        { from: "factor_b", to: "goal", strength_mean: 0.8, strength_std: 0.25 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Below 80% threshold (60%) - should not be detected
      expect(result.strength_defaults.detected).toBe(false);
      expect(result.strength_defaults.total_edges).toBe(5);
      expect(result.strength_defaults.defaulted_count).toBe(3);
    });

    it("does NOT detect when edge count is below minimum (< 3 edges)", () => {
      const rawNodes = [{ id: "factor_a", kind: "factor" }, { id: "goal", kind: "goal" }];
      const v3Nodes = [{ id: "factor_a", kind: "factor" }, { id: "goal", kind: "goal" }];
      const v3Edges = [
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Below minimum edge count (MIN_EDGES = 3) - should not be detected
      expect(result.strength_defaults.detected).toBe(false);
      expect(result.strength_defaults.total_edges).toBe(2);
      expect(result.strength_defaults.defaulted_count).toBe(0);
    });

    it("excludes structural edges (decision→option, option→factor) from analysis", () => {
      const rawNodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "factor_price", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "factor_price", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // Structural edges (excluded)
        { from: "decision", to: "option_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "option_a", to: "factor_price", strength_mean: 0.5, strength_std: 0.125 },
        // Causal edges (included)
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Only 3 causal edges should be analyzed (structural excluded)
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(3);
    });

    it("strength_defaults counter is always present (even when no defaulting)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "goal", strength_mean: 0.3 },
        { from: "factor_a", to: "goal", strength_mean: 0.7 },
        { from: "factor_a", to: "goal", strength_mean: 0.9 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Counter should exist even when no defaulting detected
      expect(result.strength_defaults).toBeDefined();
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(0);
      expect(result.strength_defaults.default_value).toBe(null);
    });

    it("strength_defaults counter exists even with zero edges", () => {
      const rawNodes = [{ id: "factor_a", kind: "factor" }];
      const v3Nodes = [{ id: "factor_a", kind: "factor" }];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], []);

      expect(result.strength_defaults).toBeDefined();
      expect(result.strength_defaults.total_edges).toBe(0);
      expect(result.strength_defaults.defaulted_count).toBe(0);
      expect(result.strength_defaults.default_value).toBe(null);
    });

    it("excludes edges with missing nodes (malformed graphs)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
        // Note: factor_b is missing but referenced in edges
      ];
      const v3Edges = [
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.125 }, // Missing from node
        { from: "factor_a", to: "factor_missing", strength_mean: 0.5, strength_std: 0.125 }, // Missing to node
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Only 1 valid edge should be counted (edges with missing nodes excluded)
      expect(result.strength_defaults.total_edges).toBe(1);
      // With < MIN_EDGES (3), detection returns early with defaulted_count = 0
      expect(result.strength_defaults.defaulted_count).toBe(0);
      expect(result.strength_defaults.detected).toBe(false);
    });

    it("excludes all option-outgoing edges from strength analysis", () => {
      // Per Platform Contract v2.6 Appendix A, option nodes are organisational (not causal)
      // and do not participate in inference. This test verifies that option-outgoing edges
      // are excluded even when they have default strength values.
      const rawNodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "option_b", kind: "option" },
        { id: "factor_x", kind: "factor" },
        { id: "factor_y", kind: "factor" },
        { id: "outcome", kind: "outcome" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "option_b", kind: "option" },
        { id: "factor_x", kind: "factor" },
        { id: "factor_y", kind: "factor" },
        { id: "outcome", kind: "outcome" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // Option-outgoing edges with 0.5 (excluded from analysis)
        { from: "option_a", to: "factor_x", strength_mean: 0.5 },
        { from: "option_a", to: "factor_y", strength_mean: 0.5 },
        { from: "option_b", to: "factor_x", strength_mean: 0.5 },
        { from: "option_b", to: "outcome", strength_mean: 0.5 },
        // Decision→option edges (excluded)
        { from: "decision", to: "option_a", strength_mean: 0.5 },
        { from: "decision", to: "option_b", strength_mean: 0.5 },
        // Causal edges with varied strengths (included)
        { from: "factor_x", to: "outcome", strength_mean: 0.3 },
        { from: "factor_y", to: "outcome", strength_mean: 0.7 },
        { from: "outcome", to: "goal", strength_mean: 0.9 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Only 3 causal edges should be counted (all structural edges excluded)
      expect(result.strength_defaults.total_edges).toBe(3);
      // Causal edges have varied strengths → no defaulting detected
      expect(result.strength_defaults.defaulted_count).toBe(0);
      expect(result.strength_defaults.detected).toBe(false);
    });

    it("detects negative defaults (-0.5) from effect_direction sign adjustment", () => {
      // When LLM omits strength data and edge has effect_direction: "negative",
      // transform applies sign flip: default 0.5 → -0.5 after adjustment.
      // Detection should count both +0.5 and -0.5 as defaults via Math.abs().
      const rawNodes = [
        { id: "risk_a", kind: "risk" },
        { id: "risk_b", kind: "risk" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "risk_a", kind: "risk" },
        { id: "risk_b", kind: "risk" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // Negative defaults (sign-adjusted from 0.5 → -0.5), std still 0.125
        { from: "risk_a", to: "goal", strength_mean: -0.5, strength_std: 0.125, effect_direction: "negative" },
        { from: "risk_b", to: "goal", strength_mean: -0.5, strength_std: 0.125, effect_direction: "negative" },
        // Positive default
        { from: "risk_a", to: "risk_b", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // All 3 edges have default magnitude (|±0.5|) AND std (0.125) → 100% defaulted
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(3);
      expect(result.strength_defaults.default_value).toBe(0.5);
    });
  });

  // ============================================================================
  // CIL Phase 1.1: Strength Mean Dominant Detection (70% threshold, mean-only)
  // ============================================================================
  describe("Strength mean dominant detection (CIL Phase 1.1)", () => {
    it("epsilon comparison catches near-default values (0.5000000001)", () => {
      // Floating-point values very close to 0.5 should be detected via epsilon (1e-9)
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5000000001, strength_std: 0.2 },
        { from: "factor_b", to: "goal", strength_mean: 0.4999999999, strength_std: 0.18 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // All 3 edges have mean ≈ 0.5 within epsilon → 100% mean-dominant
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.total_edges).toBe(3);
      expect(result.strength_mean_dominant.mean_default_count).toBe(3);
      expect(result.strength_mean_dominant.default_value).toBe(0.5);
      expect(result.strength_mean_dominant.mean_defaulted_edge_ids).toEqual([
        "factor_a->factor_b",
        "factor_b->goal",
        "factor_a->goal",
      ]);
    });

    it("detects when exactly 70% threshold is met (7 of 10 edges)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // 7 edges with mean = 0.5 but varying std (mean-dominant case)
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.2 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5, strength_std: 0.18 },
        { from: "factor_c", to: "goal", strength_mean: 0.5, strength_std: 0.15 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.22 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
        { from: "factor_a", to: "factor_c", strength_mean: 0.5, strength_std: 0.12 },
        { from: "factor_c", to: "factor_a", strength_mean: 0.5, strength_std: 0.19 },
        // 3 edges with varied mean (not defaults)
        { from: "factor_a", to: "factor_b", strength_mean: 0.3, strength_std: 0.1 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.7, strength_std: 0.2 },
        { from: "factor_c", to: "goal", strength_mean: 0.9, strength_std: 0.15 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Exactly 70% threshold met - should be detected
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.total_edges).toBe(10);
      expect(result.strength_mean_dominant.mean_default_count).toBe(7);
      expect(result.strength_mean_dominant.default_value).toBe(0.5);
    });

    it("does NOT detect when below 70% threshold (6 of 10 = 60%)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "factor_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // 6 edges with mean = 0.5
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.2 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5, strength_std: 0.18 },
        { from: "factor_c", to: "goal", strength_mean: 0.5, strength_std: 0.15 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.22 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
        { from: "factor_a", to: "factor_c", strength_mean: 0.5, strength_std: 0.12 },
        // 4 edges with varied mean
        { from: "factor_c", to: "factor_a", strength_mean: 0.3, strength_std: 0.19 },
        { from: "factor_a", to: "factor_b", strength_mean: 0.7, strength_std: 0.1 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.9, strength_std: 0.2 },
        { from: "factor_c", to: "goal", strength_mean: 0.8, strength_std: 0.15 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Below 70% threshold (60%) - should NOT be detected
      expect(result.strength_mean_dominant.detected).toBe(false);
      expect(result.strength_mean_dominant.total_edges).toBe(10);
      expect(result.strength_mean_dominant.mean_default_count).toBe(6);
      expect(result.strength_mean_dominant.default_value).toBe(null);
    });

    it("both warnings can fire simultaneously (≥80% mean+std AND ≥70% mean-only)", () => {
      // When all edges have mean=0.5 AND std=0.125, both detections should fire
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Both detections should fire (100% match for both criteria)
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.defaulted_count).toBe(3);
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.mean_default_count).toBe(3);
    });

    it("mean-dominant fires independently when std varies (mean=0.5, varied std)", () => {
      // Case: LLM varied belief/provenance (different std) but defaulted magnitude (mean)
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "factor_b", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.2 },
        { from: "factor_b", to: "goal", strength_mean: 0.5, strength_std: 0.18 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Mean-dominant should fire (100% mean=0.5)
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.mean_default_count).toBe(3);
      // Full default should NOT fire (std varies, not all 0.125)
      expect(result.strength_defaults.detected).toBe(false);
      expect(result.strength_defaults.defaulted_count).toBe(0);
    });

    it("detects negative mean defaults (-0.5) from effect_direction sign adjustment", () => {
      // Like strength_defaults, mean-dominant should detect both +0.5 and -0.5 via Math.abs()
      const rawNodes = [
        { id: "risk_a", kind: "risk" },
        { id: "risk_b", kind: "risk" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "risk_a", kind: "risk" },
        { id: "risk_b", kind: "risk" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // Negative mean (sign-adjusted from 0.5 → -0.5), varied std
        { from: "risk_a", to: "goal", strength_mean: -0.5, strength_std: 0.2 },
        { from: "risk_b", to: "goal", strength_mean: -0.5, strength_std: 0.18 },
        // Positive mean, varied std
        { from: "risk_a", to: "risk_b", strength_mean: 0.5, strength_std: 0.25 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // All 3 edges have |mean| = 0.5 → 100% mean-dominant
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.total_edges).toBe(3);
      expect(result.strength_mean_dominant.mean_default_count).toBe(3);
      expect(result.strength_mean_dominant.default_value).toBe(0.5);
    });

    it("excludes structural edges (decision→option, option→*) from mean-dominant analysis", () => {
      const rawNodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "factor_price", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "decision", kind: "decision" },
        { id: "option_a", kind: "option" },
        { id: "factor_price", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // Structural edges with mean=0.5 (excluded from analysis)
        { from: "decision", to: "option_a", strength_mean: 0.5, strength_std: 0.2 },
        { from: "option_a", to: "factor_price", strength_mean: 0.5, strength_std: 0.18 },
        // Causal edges with mean=0.5 (included)
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.15 },
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.22 },
        { from: "factor_price", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Only 3 causal edges should be analyzed (structural excluded)
      expect(result.strength_mean_dominant.detected).toBe(true);
      expect(result.strength_mean_dominant.total_edges).toBe(3);
      expect(result.strength_mean_dominant.mean_default_count).toBe(3);
    });

    it("does NOT detect when edge count is below minimum (< 3 edges)", () => {
      const rawNodes = [{ id: "factor_a", kind: "factor" }, { id: "goal", kind: "goal" }];
      const v3Nodes = [{ id: "factor_a", kind: "factor" }, { id: "goal", kind: "goal" }];
      const v3Edges = [
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.2 },
        { from: "factor_a", to: "goal", strength_mean: 0.5, strength_std: 0.18 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Below minimum edge count (MIN_EDGES = 3) - should not be detected
      expect(result.strength_mean_dominant.detected).toBe(false);
      expect(result.strength_mean_dominant.total_edges).toBe(2);
      expect(result.strength_mean_dominant.mean_default_count).toBe(0);
    });

    it("strength_mean_dominant counter is always present (even when no dominance)", () => {
      const rawNodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Nodes = [
        { id: "factor_a", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        { from: "factor_a", to: "goal", strength_mean: 0.3 },
        { from: "factor_a", to: "goal", strength_mean: 0.7 },
        { from: "factor_a", to: "goal", strength_mean: 0.9 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Counter should exist even when no dominance detected
      expect(result.strength_mean_dominant).toBeDefined();
      expect(result.strength_mean_dominant.total_edges).toBe(3);
      expect(result.strength_mean_dominant.mean_default_count).toBe(0);
      expect(result.strength_mean_dominant.default_value).toBe(null);
    });
  });

  // ============================================================================
  // Structural Edge Exclusion (decision→*, option→*)
  // ============================================================================
  describe("Structural edge exclusion", () => {
    // Shared graph fixture: decision, 2 options, 2 factors, 1 outcome, 1 goal
    const structuralNodes = [
      { id: "dec", kind: "decision" },
      { id: "opt_a", kind: "option" },
      { id: "opt_b", kind: "option" },
      { id: "fac_price", kind: "factor" },
      { id: "fac_demand", kind: "factor" },
      { id: "out_revenue", kind: "outcome" },
      { id: "goal_profit", kind: "goal" },
    ];

    it("decision→option edges excluded from default count (both warnings)", () => {
      const v3Edges = [
        // Structural: decision→option (excluded)
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "dec", to: "opt_b", strength_mean: 0.5, strength_std: 0.125 },
        // Causal edges (included) — all defaulted
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      const dominant = detectStrengthMeanDominant(structuralNodes, v3Edges);

      // Decision edges excluded from both
      expect(defaults.total_edges).toBe(3);
      expect(defaults.structural_edges_excluded).toBe(2);
      expect(defaults.defaulted_count).toBe(3);

      expect(dominant.total_edges).toBe(3);
      expect(dominant.structural_edges_excluded).toBe(2);
      expect(dominant.mean_default_count).toBe(3);
    });

    it("option→factor edges excluded from default count (both warnings)", () => {
      const v3Edges = [
        // Structural: option→factor (excluded)
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_b", to: "fac_demand", strength_mean: 0.5, strength_std: 0.125 },
        // Causal edges (included) — all defaulted
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      const dominant = detectStrengthMeanDominant(structuralNodes, v3Edges);

      expect(defaults.total_edges).toBe(3);
      expect(defaults.structural_edges_excluded).toBe(2);
      expect(dominant.total_edges).toBe(3);
      expect(dominant.structural_edges_excluded).toBe(2);
    });

    it("causal edges (factor→outcome, outcome→goal, risk→goal) still counted correctly", () => {
      const nodes = [
        ...structuralNodes,
        { id: "risk_inflation", kind: "risk" },
      ];
      const v3Edges = [
        // Causal edges with varied strengths
        { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.2 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.3, strength_std: 0.1 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.8, strength_std: 0.15 },
        { from: "risk_inflation", to: "goal_profit", strength_mean: -0.4, strength_std: 0.18 },
      ];

      const defaults = detectStrengthDefaults(nodes, v3Edges);

      expect(defaults.total_edges).toBe(4);
      expect(defaults.structural_edges_excluded).toBe(0);
      expect(defaults.defaulted_count).toBe(0);
      expect(defaults.detected).toBe(false);
    });

    it("total_edges in details reflects causal-only count", () => {
      const v3Edges = [
        // 4 structural edges
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "dec", to: "opt_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_b", to: "fac_demand", strength_mean: 0.5, strength_std: 0.125 },
        // 3 causal edges
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      const dominant = detectStrengthMeanDominant(structuralNodes, v3Edges);

      // total_edges = causal only (7 edges - 4 structural = 3)
      expect(defaults.total_edges).toBe(3);
      expect(dominant.total_edges).toBe(3);
    });

    it("structural_edges_excluded is present and correct in both results", () => {
      const v3Edges = [
        // 4 structural
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "dec", to: "opt_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_b", to: "fac_demand", strength_mean: 0.5, strength_std: 0.125 },
        // 3 causal
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      const dominant = detectStrengthMeanDominant(structuralNodes, v3Edges);

      expect(defaults.structural_edges_excluded).toBe(4);
      expect(dominant.structural_edges_excluded).toBe(4);
    });

    it("graph with ONLY structural edges → no warning fires (no division by zero)", () => {
      const v3Edges = [
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "dec", to: "opt_b", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_b", to: "fac_demand", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      const dominant = detectStrengthMeanDominant(structuralNodes, v3Edges);

      expect(defaults.detected).toBe(false);
      expect(defaults.total_edges).toBe(0);
      expect(defaults.structural_edges_excluded).toBe(4);
      expect(defaults.defaulted_count).toBe(0);

      expect(dominant.detected).toBe(false);
      expect(dominant.total_edges).toBe(0);
      expect(dominant.structural_edges_excluded).toBe(4);
      expect(dominant.mean_default_count).toBe(0);
    });

    it("mixed structural + causal edges → correct counts", () => {
      const v3Edges = [
        // 3 structural
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_b", to: "fac_demand", strength_mean: 0.5, strength_std: 0.125 },
        // 4 causal — 3 defaulted, 1 varied
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_price", to: "goal_profit", strength_mean: 0.8, strength_std: 0.2 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);

      expect(defaults.structural_edges_excluded).toBe(3);
      expect(defaults.total_edges).toBe(4);
      expect(defaults.defaulted_count).toBe(3);
      // 3/4 = 75% < 80% threshold → not detected
      expect(defaults.detected).toBe(false);
      expect(defaults.defaulted_edge_ids).toEqual([
        "fac_price->out_revenue",
        "fac_demand->out_revenue",
        "out_revenue->goal_profit",
      ]);
    });

    it("edge from factor→option is NOT excluded (only from-node kind matters)", () => {
      const v3Edges = [
        // factor→option edge: NOT structural (from-node is factor, not decision/option)
        { from: "fac_price", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        // Normal causal edges
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);

      // factor→option counts as causal (from-node is factor)
      expect(defaults.total_edges).toBe(4);
      expect(defaults.structural_edges_excluded).toBe(0);
      expect(defaults.defaulted_count).toBe(4);
    });

    it("existing STRENGTH_DEFAULT_APPLIED threshold unchanged (fires at ≥80%)", () => {
      const v3Edges = [
        // 4 of 5 causal edges defaulted = 80%
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_price", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
        // 1 varied
        { from: "fac_demand", to: "goal_profit", strength_mean: 0.8, strength_std: 0.2 },
      ];

      const defaults = detectStrengthDefaults(structuralNodes, v3Edges);
      expect(defaults.detected).toBe(true);
      expect(defaults.defaulted_count).toBe(4);
      expect(defaults.total_edges).toBe(5);
    });

    it("existing STRENGTH_MEAN_DEFAULT_DOMINANT threshold unchanged (fires at ≥70%)", () => {
      const nodes = [
        { id: "fac_a", kind: "factor" },
        { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" },
        { id: "goal", kind: "goal" },
      ];
      const v3Edges = [
        // 7 of 10 edges with mean=0.5 (varied std) = 70%
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.2 },
        { from: "fac_b", to: "fac_c", strength_mean: 0.5, strength_std: 0.18 },
        { from: "fac_c", to: "goal", strength_mean: 0.5, strength_std: 0.15 },
        { from: "fac_a", to: "goal", strength_mean: 0.5, strength_std: 0.22 },
        { from: "fac_b", to: "goal", strength_mean: 0.5, strength_std: 0.25 },
        { from: "fac_a", to: "fac_c", strength_mean: 0.5, strength_std: 0.12 },
        { from: "fac_c", to: "fac_a", strength_mean: 0.5, strength_std: 0.19 },
        // 3 varied
        { from: "fac_a", to: "fac_b", strength_mean: 0.3, strength_std: 0.1 },
        { from: "fac_b", to: "fac_c", strength_mean: 0.7, strength_std: 0.2 },
        { from: "fac_c", to: "goal", strength_mean: 0.9, strength_std: 0.15 },
      ];

      const dominant = detectStrengthMeanDominant(nodes, v3Edges);
      expect(dominant.detected).toBe(true);
      expect(dominant.mean_default_count).toBe(7);
      expect(dominant.total_edges).toBe(10);
    });

    it("structural_edges_excluded propagates to runIntegrityChecks output", () => {
      const v3Edges = [
        { from: "dec", to: "opt_a", strength_mean: 0.5, strength_std: 0.125 },
        { from: "opt_a", to: "fac_price", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_price", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "fac_demand", to: "out_revenue", strength_mean: 0.5, strength_std: 0.125 },
        { from: "out_revenue", to: "goal_profit", strength_mean: 0.5, strength_std: 0.125 },
      ];

      const result = runIntegrityChecks(structuralNodes, structuralNodes, [], [], v3Edges);

      expect(result.strength_defaults.structural_edges_excluded).toBe(2);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_mean_dominant.structural_edges_excluded).toBe(2);
      expect(result.strength_mean_dominant.total_edges).toBe(3);
    });
  });
});
