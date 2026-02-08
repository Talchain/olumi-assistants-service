import { describe, it, expect } from "vitest";
import {
  runIntegrityChecks,
  normaliseIdForMatch,
  type IntegrityWarning,
} from "../../src/cee/validation/integrity-sentinel.js";

/**
 * CIL Phase 0 — Sentinel integrity check tests.
 *
 * Verifies that runIntegrityChecks correctly detects data loss between
 * LLM raw output and V3 response.
 */
describe("CIL Phase 0: Sentinel integrity checks", () => {
  // ── normaliseIdForMatch ────────────────────────────────────────────────
  describe("normaliseIdForMatch", () => {
    it("preserves IDs that already match the valid pattern", () => {
      // Valid IDs are returned as-is (case-preserved)
      expect(normaliseIdForMatch("Factor_Price")).toBe("Factor_Price");
      expect(normaliseIdForMatch("Goal-Revenue")).toBe("Goal-Revenue");
      expect(normaliseIdForMatch("factor_price")).toBe("factor_price");
    });

    it("normalises human-readable labels the same way as production", () => {
      // Labels with spaces/parens go through full normalisation
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
        { id: "factor_price", kind: "factor" }, // category missing
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const catWarnings = warnings.filter((w) => w.code === "CATEGORY_STRIPPED");

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

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const catWarnings = warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(catWarnings).toHaveLength(0);
    });
  });

  // ── NODE_DROPPED ───────────────────────────────────────────────────────
  describe("NODE_DROPPED", () => {
    it("emits warning when raw node is missing from V3", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
        { id: "factor_demand", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
        // factor_demand missing
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const dropped = warnings.filter((w) => w.code === "NODE_DROPPED");

      expect(dropped).toHaveLength(1);
      expect(dropped[0].node_id).toBe("factor_demand");
    });
  });

  // ── SYNTHETIC_NODE_INJECTED ────────────────────────────────────────────
  describe("SYNTHETIC_NODE_INJECTED", () => {
    it("emits warning when V3 has node not in raw", () => {
      const rawNodes = [
        { id: "factor_price", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
        { id: "synthetic_node", kind: "factor" },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const synthetic = warnings.filter((w) => w.code === "SYNTHETIC_NODE_INJECTED");

      expect(synthetic).toHaveLength(1);
      expect(synthetic[0].node_id).toBe("synthetic_node");
    });
  });

  // ── GOAL_THRESHOLD_STRIPPED ────────────────────────────────────────────
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
        { id: "goal_revenue", kind: "goal" }, // all threshold fields missing
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const threshold = warnings.filter((w) => w.code === "GOAL_THRESHOLD_STRIPPED");

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

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const threshold = warnings.filter((w) => w.code === "GOAL_THRESHOLD_STRIPPED");
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
          observed_state: { value: 49 }, // enrichment fields missing
        },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const enrichment = warnings.filter((w) => w.code === "ENRICHMENT_STRIPPED");

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
          data: {
            value: 49,
            raw_value: 49,
            cap: 100,
          },
        },
      ];
      const v3Nodes = [
        {
          id: "factor_price",
          kind: "factor",
          observed_state: {
            value: 49,
            raw_value: 49,
            cap: 100,
          },
        },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      const enrichment = warnings.filter((w) => w.code === "ENRICHMENT_STRIPPED");
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
          data: {
            interventions: { factor_price: { value: 59 } },
          },
        },
      ];
      const v3Nodes = [
        { id: "option_premium", kind: "option" },
      ];
      const v3Options = [
        { id: "option_premium", interventions: {} }, // empty
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      const intWarnings = warnings.filter((w) => w.code === "INTERVENTIONS_STRIPPED");

      expect(intWarnings).toHaveLength(1);
      expect(intWarnings[0].node_id).toBe("option_premium");
    });

    it("does not emit when option interventions are preserved", () => {
      const rawNodes = [
        {
          id: "option_premium",
          kind: "option",
          data: {
            interventions: { factor_price: { value: 59 } },
          },
        },
      ];
      const v3Nodes = [
        { id: "option_premium", kind: "option" },
      ];
      const v3Options = [
        {
          id: "option_premium",
          interventions: { factor_price: { value: 59, source: "brief_extraction", target_match: { node_id: "factor_price", match_type: "exact_id", confidence: "high" } } },
        },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      const intWarnings = warnings.filter((w) => w.code === "INTERVENTIONS_STRIPPED");
      expect(intWarnings).toHaveLength(0);
    });
  });

  // ── Everything matches → zero warnings ─────────────────────────────────
  describe("clean fixture", () => {
    it("emits zero warnings when everything matches", () => {
      const rawNodes = [
        {
          id: "goal_revenue",
          kind: "goal",
          goal_threshold: 0.8,
        },
        {
          id: "factor_price",
          kind: "factor",
          category: "controllable",
          data: {
            value: 49,
            unit: "GBP",
            raw_value: 49,
          },
        },
        {
          id: "option_premium",
          kind: "option",
          data: {
            interventions: { factor_price: { value: 59 } },
          },
        },
      ];
      const v3Nodes = [
        {
          id: "goal_revenue",
          kind: "goal",
          goal_threshold: 0.8,
        },
        {
          id: "factor_price",
          kind: "factor",
          category: "controllable",
          observed_state: {
            value: 49,
            unit: "GBP",
            raw_value: 49,
          },
        },
        {
          id: "option_premium",
          kind: "option",
        },
      ];
      const v3Options = [
        {
          id: "option_premium",
          interventions: { factor_price: { value: 59 } },
        },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, v3Options);
      expect(warnings).toHaveLength(0);
    });
  });

  // ── ID normalisation matching ──────────────────────────────────────────
  describe("ID normalisation matching", () => {
    it("matches raw human-readable label to V3 normalised ID", () => {
      // Raw LLM output may use "Price (GBP)" which normalises to "price_gbp"
      const rawNodes = [
        { id: "Price (GBP)", kind: "factor", category: "controllable" },
      ];
      const v3Nodes = [
        { id: "price_gbp", kind: "factor" }, // category missing
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      // Should match by normalised ID and detect CATEGORY_STRIPPED, not NODE_DROPPED
      const dropped = warnings.filter((w) => w.code === "NODE_DROPPED");
      const catStripped = warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(dropped).toHaveLength(0);
      expect(catStripped).toHaveLength(1);
    });

    it("valid IDs with different casing are treated as different nodes", () => {
      // Both match ^[A-Za-z][A-Za-z0-9_-]*$ so are preserved as-is
      const rawNodes = [
        { id: "Factor_Price", kind: "factor" },
      ];
      const v3Nodes = [
        { id: "factor_price", kind: "factor" },
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      // These are different normalised IDs, so both NODE_DROPPED and SYNTHETIC
      const dropped = warnings.filter((w) => w.code === "NODE_DROPPED");
      const synthetic = warnings.filter((w) => w.code === "SYNTHETIC_NODE_INJECTED");
      expect(dropped).toHaveLength(1);
      expect(synthetic).toHaveLength(1);
    });
  });

  // ── Collision handling ─────────────────────────────────────────────────
  describe("collision handling", () => {
    it("checks all raw nodes that normalise to the same key", () => {
      // Two raw labels that both normalise to "marketing_spend" under production rules
      const rawNodes = [
        { id: "Marketing Spend", kind: "factor", category: "controllable" },
        { id: "Marketing  Spend", kind: "factor", category: "external" },
      ];
      // V3 has one node at the normalised key
      const v3Nodes = [
        { id: "marketing_spend", kind: "factor" }, // category missing
      ];

      const warnings = runIntegrityChecks(rawNodes, v3Nodes, []);
      // Both raw nodes should be checked — both have category stripped
      const catStripped = warnings.filter((w) => w.code === "CATEGORY_STRIPPED");
      expect(catStripped).toHaveLength(2);
      // No NODE_DROPPED since the normalised key exists in V3
      const dropped = warnings.filter((w) => w.code === "NODE_DROPPED");
      expect(dropped).toHaveLength(0);
    });
  });
});
