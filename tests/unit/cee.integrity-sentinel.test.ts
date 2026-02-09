import { describe, it, expect } from "vitest";
import {
  runIntegrityChecks,
  normaliseIdForMatch,
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
        { from: "factor_a", to: "factor_b", strength_mean: 0.5 },
        { from: "factor_b", to: "goal", strength_mean: 0.5 },
        { from: "factor_a", to: "goal", strength_mean: 0.5 },
      ];

      const result = runIntegrityChecks(rawNodes, v3Nodes, [], [], v3Edges);

      // Verify counter values (warning is added at schema-v3 level, not here)
      expect(result.strength_defaults.detected).toBe(true);
      expect(result.strength_defaults.total_edges).toBe(3);
      expect(result.strength_defaults.defaulted_count).toBe(3);
      expect(result.strength_defaults.default_value).toBe(0.5);

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
        { from: "factor_a", to: "factor_b", strength_mean: 0.5 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5 },
        { from: "factor_c", to: "goal", strength_mean: 0.5 },
        { from: "factor_a", to: "goal", strength_mean: 0.5 },
        { from: "factor_b", to: "goal", strength_mean: 0.8 }, // One varied edge
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
        { from: "factor_a", to: "factor_b", strength_mean: 0.5 },
        { from: "factor_b", to: "factor_c", strength_mean: 0.5 },
        { from: "factor_c", to: "goal", strength_mean: 0.5 },
        { from: "factor_a", to: "goal", strength_mean: 0.7 },
        { from: "factor_b", to: "goal", strength_mean: 0.8 },
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
        { from: "factor_a", to: "goal", strength_mean: 0.5 },
        { from: "factor_a", to: "goal", strength_mean: 0.5 },
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
        { from: "decision", to: "option_a", strength_mean: 0.5 },
        { from: "option_a", to: "factor_price", strength_mean: 0.5 },
        // Causal edges (included)
        { from: "factor_price", to: "goal", strength_mean: 0.5 },
        { from: "factor_price", to: "goal", strength_mean: 0.5 },
        { from: "factor_price", to: "goal", strength_mean: 0.5 },
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
        { from: "factor_a", to: "goal", strength_mean: 0.5 },
        { from: "factor_b", to: "goal", strength_mean: 0.5 }, // Missing from node
        { from: "factor_a", to: "factor_missing", strength_mean: 0.5 }, // Missing to node
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
  });
});
