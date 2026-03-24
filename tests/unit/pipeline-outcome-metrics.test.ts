/**
 * Pipeline Outcome Metrics Tests
 */

import { describe, it, expect } from "vitest";
import type { PipelineOutcome, FactorValueCoverage, LlmRepairOutcome, RepairProvenanceEntry } from "../../src/cee/unified-pipeline/types.js";

describe("PipelineOutcome type shape", () => {
  it("has all required diagnostic fields with correct types", () => {
    const outcome: PipelineOutcome = {
      graph_drafted: true, graph_structurally_valid: true, deterministic_sweep_violations: 3,
      verification_status: "passed", validation_status: "passed", enrichment_status: "complete",
      coaching_status: "complete", warnings: [],
      rescue_score: 7,
      factor_value_coverage: { total: 5, explicit: 2, inferred_with_evidence: 1, fallback_default: 2 },
      edge_strength_unique_count: 4,
      llm_repair: { triggered: false, outcome: "skipped", fallback_reason: null, attempts: 0 },
      repair_provenance: [{ rule: "NAN_VALUE", code: "NAN_VALUE", node_or_edge_id: "edges[fac_a→out_b]", field: "graph", before: null, after: null, source: "fallback_default" }],
    };
    expect(outcome.rescue_score).toBe(7);
    expect(outcome.factor_value_coverage.total).toBe(5);
    expect(outcome.edge_strength_unique_count).toBe(4);
    expect(outcome.llm_repair.triggered).toBe(false);
    expect(outcome.repair_provenance).toHaveLength(1);
  });

  it("factor_value_coverage sums correctly", () => {
    const c: FactorValueCoverage = { total: 10, explicit: 3, inferred_with_evidence: 4, fallback_default: 3 };
    expect(c.explicit + c.inferred_with_evidence + c.fallback_default).toBe(c.total);
  });

  it("llm_repair outcome represents triggered state", () => {
    const t: LlmRepairOutcome = { triggered: true, outcome: "accepted", fallback_reason: null, attempts: 1 };
    expect(t.triggered).toBe(true);
    const r: LlmRepairOutcome = { triggered: true, outcome: "rejected", fallback_reason: "revalidation_failed", attempts: 1 };
    expect(r.fallback_reason).toBe("revalidation_failed");
  });

  it("repair_provenance source types are valid", () => {
    const s: RepairProvenanceEntry = { rule: "SIGN_MISMATCH", code: "SIGN_MISMATCH", node_or_edge_id: "x", field: "graph", before: null, after: null, source: "structure" };
    expect(s.source).toBe("structure");
    const d: RepairProvenanceEntry = { rule: "CONTROLLABLE_MISSING_DATA", code: "CONTROLLABLE_MISSING_DATA", node_or_edge_id: "y", field: "graph", before: null, after: null, source: "fallback_default" };
    expect(d.source).toBe("fallback_default");
  });

  it("default pipeline outcome initializes with zero/empty values", () => {
    const d: PipelineOutcome = {
      graph_drafted: false, graph_structurally_valid: false, deterministic_sweep_violations: 0,
      verification_status: "skipped", validation_status: "skipped", enrichment_status: "skipped",
      coaching_status: "partial", warnings: [],
      rescue_score: 0,
      factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
      edge_strength_unique_count: 0,
      llm_repair: { triggered: false, outcome: "skipped", fallback_reason: null, attempts: 0 },
      repair_provenance: [],
    };
    expect(d.rescue_score).toBe(0);
    expect(d.repair_provenance).toHaveLength(0);
  });
});
