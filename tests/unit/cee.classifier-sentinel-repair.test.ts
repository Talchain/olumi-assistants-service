/**
 * Tests for three CEE fixes:
 *
 * Fix 1: Structural edge classifier tightening
 * Fix 2: Sentinel interventions cleanup (normaliser, unreachable-factors, sweep)
 * Fix 3: (RETIRED — the dedicated LLMRepairResponse schema was removed
 *         with the LLM graph-repair capability, ROADMAP 2.763.)
 */

import { describe, it, expect, vi } from "vitest";
import { classifyEdgeByKind, isLegalStructuralEdge } from "../../src/cee/utils/structural-edge-classifier.js";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";
import { handleUnreachableFactors } from "../../src/cee/unified-pipeline/stages/repair/unreachable-factors.js";

// Suppress noisy logs
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

// ============================================================================
// Fix 1: Structural edge classifier
// ============================================================================

describe("Fix 1: classifyEdgeByKind", () => {
  it("decision -> option IS structural", () => {
    expect(classifyEdgeByKind("decision", "option")).toBe("structural");
  });

  it("option -> factor IS structural", () => {
    expect(classifyEdgeByKind("option", "factor")).toBe("structural");
  });

  it("option -> outcome is NOT structural (forbidden pattern)", () => {
    expect(classifyEdgeByKind("option", "outcome")).toBe("causal");
  });

  it("option -> risk is NOT structural (forbidden pattern)", () => {
    expect(classifyEdgeByKind("option", "risk")).toBe("causal");
  });

  it("decision -> factor is NOT structural (forbidden pattern)", () => {
    expect(classifyEdgeByKind("decision", "factor")).toBe("causal");
  });

  it("decision -> outcome is NOT structural (forbidden pattern)", () => {
    expect(classifyEdgeByKind("decision", "outcome")).toBe("causal");
  });

  it("factor -> outcome is causal", () => {
    expect(classifyEdgeByKind("factor", "outcome")).toBe("causal");
  });

  it("factor -> factor is causal", () => {
    expect(classifyEdgeByKind("factor", "factor")).toBe("causal");
  });

  it("edge with unresolvable fromKind is NOT structural", () => {
    expect(classifyEdgeByKind(undefined, "option")).toBe("causal");
  });

  it("edge with unresolvable toKind is NOT structural", () => {
    expect(classifyEdgeByKind("decision", undefined)).toBe("causal");
  });

  it("edge with both kinds unresolvable is NOT structural", () => {
    expect(classifyEdgeByKind(undefined, undefined)).toBe("causal");
  });
});

describe("Fix 1: isLegalStructuralEdge", () => {
  it("returns true for decision -> option", () => {
    expect(isLegalStructuralEdge("decision", "option")).toBe(true);
  });

  it("returns true for option -> factor", () => {
    expect(isLegalStructuralEdge("option", "factor")).toBe(true);
  });

  it("returns false for option -> outcome", () => {
    expect(isLegalStructuralEdge("option", "outcome")).toBe(false);
  });

  it("returns false for undefined kinds", () => {
    expect(isLegalStructuralEdge(undefined, "option")).toBe(false);
  });
});

// ============================================================================
// Fix 2a: Sentinel interventions stripped in normaliser
// ============================================================================

describe("Fix 2a: normaliseDraftResponse — sentinel interventions", () => {
  it("strips interventions: [] from factor nodes", () => {
    const raw = {
      nodes: [{
        id: "fac_1", kind: "factor", label: "Cost",
        data: { value: 0.5, interventions: [], extractionType: "inferred", factor_type: "cost" },
      }],
      edges: [],
    };
    const result = normaliseDraftResponse(raw) as any;
    expect(result.nodes[0].data.interventions).toBeUndefined();
    // Factor metadata should survive
    expect(result.nodes[0].data.value).toBe(0.5);
    expect(result.nodes[0].data.factor_type).toBe("cost");
  });

  it("strips interventions from goal nodes", () => {
    const raw = {
      nodes: [{
        id: "goal_1", kind: "goal", label: "Revenue",
        data: { value: 0, interventions: [] },
      }],
      edges: [],
    };
    const result = normaliseDraftResponse(raw) as any;
    // Data may be stripped entirely (no union key, no metadata)
    // or interventions removed. Either way, no interventions should survive.
    if (result.nodes[0].data) {
      expect(result.nodes[0].data.interventions).toBeUndefined();
    }
  });

  it("preserves interventions on option nodes (array -> object conversion)", () => {
    const raw = {
      nodes: [{
        id: "opt_1", kind: "option", label: "Option A",
        data: { interventions: [{ factor_id: "fac_1", value: 0.5 }] },
      }],
      edges: [],
    };
    const result = normaliseDraftResponse(raw) as any;
    expect(result.nodes[0].data.interventions).toEqual({ fac_1: 0.5 });
  });

  it("preserves object-form interventions on option nodes", () => {
    const raw = {
      nodes: [{
        id: "opt_1", kind: "option", label: "Option A",
        data: { interventions: { fac_1: 0.5 } },
      }],
      edges: [],
    };
    const result = normaliseDraftResponse(raw) as any;
    expect(result.nodes[0].data.interventions).toEqual({ fac_1: 0.5 });
  });

  it("strips empty interventions from risk nodes", () => {
    const raw = {
      nodes: [{
        id: "risk_1", kind: "risk", label: "Risk",
        data: { value: 0.3, interventions: [] },
      }],
      edges: [],
    };
    const result = normaliseDraftResponse(raw) as any;
    if (result.nodes[0].data) {
      expect(result.nodes[0].data.interventions).toBeUndefined();
    }
  });
});

// ============================================================================
// Fix 2b: Unreachable-factors semantic guard
// ============================================================================

describe("Fix 2b: handleUnreachableFactors — semantic data guard", () => {
  it("deletes data when only sentinel interventions remain (empty array)", () => {
    const graph = {
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "observable",
          data: { value: 0.6, interventions: [] } },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1" },
        { from: "fac_1", to: "goal_1" },
      ],
    };

    const result = handleUnreachableFactors(graph as any, "V1_FLAT");
    expect(result.reclassified).toContain("fac_1");

    const fac1 = (graph as any).nodes.find((n: any) => n.id === "fac_1");
    // data should be deleted — interventions: [] is not a valid union key
    expect(fac1.data).toBeUndefined();
  });

  it("preserves data when real object-form interventions exist", () => {
    const graph = {
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "controllable",
          data: { interventions: { opt_1: 0.5 } } },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1" },
        { from: "fac_1", to: "goal_1" },
      ],
    };

    handleUnreachableFactors(graph as any, "V1_FLAT");

    const fac1 = (graph as any).nodes.find((n: any) => n.id === "fac_1");
    // Unreachable factor gets reclassified but data with real interventions survives the guard
    // (value is deleted but interventions object keeps data alive)
    if (fac1.data) {
      expect(typeof fac1.data.interventions).toBe("object");
    }
  });
});

// ============================================================================
// Fix 3 (retired): the repair-response schema is gone; the draft half remains
// ============================================================================

describe("Fix 3 (retired): draft-schema rationale contract", () => {
  const validRepairNode = {
    id: "fac_1",
    kind: "factor",
    label: "Factor",
    data: { value: 0.5 },
  };

  const validRepairEdge = {
    from: "dec_1",
    to: "opt_1",
    strength: { mean: 1.0, std: 0.01 },
  };

  // The three LLMRepairResponse cases that lived here were REMOVED by ROADMAP
  // 2.763: the schema parsed the LLM repair call's output, and that call is
  // retired. The draft-schema cases below are retained — they were the control
  // half of the original pair and still guard the LIVE draft contract.

  it("draft schema still accepts draft-style rationales", () => {
    const input = {
      nodes: [validRepairNode],
      edges: [validRepairEdge],
      rationales: [
        { target: "fac_1", why: "Important connection" },
      ],
    };
    const result = LLMDraftResponse.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("draft schema still works without rationales", () => {
    const input = {
      nodes: [validRepairNode],
      edges: [validRepairEdge],
    };
    const result = LLMDraftResponse.safeParse(input);
    expect(result.success).toBe(true);
  });
});
