import { describe, it, expect } from "vitest";
import {
  NodeV3,
  EdgeV3,
  OptionV3,
  ObservedStateV3,
  InterventionV3,
  EdgeProvenanceV3,
  CEEGraphResponseV3,
  TargetMatch,
  OptionProvenanceV3,
  ValidationWarningV3,
  GraphMetaV3,
} from "../../src/schemas/cee-v3.js";
import {
  OptionForAnalysis,
  AnalysisReadyPayload,
} from "../../src/schemas/analysis-ready.js";
import { DraftGraphOutput } from "../../src/schemas/assist.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";

/**
 * CIL Phase 0 — Verify .passthrough() on V3 egress schemas.
 *
 * Each test confirms that unknown/additive fields survive safeParse()
 * without affecting validation of known fields.
 */
describe("CIL Phase 0: V3 egress schemas preserve unknown fields (.passthrough)", () => {
  // ── NodeV3 ──────────────────────────────────────────────────────────────
  it("NodeV3 preserves extra fields", () => {
    const input = {
      id: "factor_price",
      kind: "factor",
      label: "Price",
      experimental_flag: true,
      custom_score: 42,
    };
    const result = NodeV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.experimental_flag).toBe(true);
    expect((result as any).data.custom_score).toBe(42);
  });

  // ── EdgeV3 ──────────────────────────────────────────────────────────────
  it("EdgeV3 preserves extra fields", () => {
    const input = {
      from: "a",
      to: "b",
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: "positive" as const,
      edge_metadata: { source: "experiment" },
    };
    const result = EdgeV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.edge_metadata).toEqual({ source: "experiment" });
  });

  // ── OptionV3 ────────────────────────────────────────────────────────────
  it("OptionV3 preserves extra fields", () => {
    const input = {
      id: "opt_a",
      label: "Option A",
      status: "ready" as const,
      interventions: {},
      ui_hint: "highlight",
    };
    const result = OptionV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.ui_hint).toBe("highlight");
  });

  // ── ObservedStateV3 ────────────────────────────────────────────────────
  it("ObservedStateV3 preserves extra fields", () => {
    const input = {
      value: 100,
      unit: "GBP",
      source: "brief_extraction" as const,
      std: 5.2,
    };
    const result = ObservedStateV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.std).toBe(5.2);
  });

  // ── InterventionV3 ─────────────────────────────────────────────────────
  it("InterventionV3 preserves extra fields", () => {
    const input = {
      value: 59,
      source: "brief_extraction" as const,
      target_match: { node_id: "f1", match_type: "exact_id" as const, confidence: "high" as const },
      llm_reasoning_trace: "derived from brief section 2",
    };
    const result = InterventionV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.llm_reasoning_trace).toBe("derived from brief section 2");
  });

  // ── EdgeProvenanceV3 ───────────────────────────────────────────────────
  it("EdgeProvenanceV3 preserves extra fields", () => {
    const input = {
      source: "brief_extraction" as const,
      reasoning: "test",
      citation_url: "https://example.com",
    };
    const result = EdgeProvenanceV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.citation_url).toBe("https://example.com");
  });

  // ── TargetMatch ────────────────────────────────────────────────────────
  it("TargetMatch preserves extra fields", () => {
    const input = {
      node_id: "f1",
      match_type: "exact_id" as const,
      confidence: "high" as const,
      similarity_score: 0.95,
    };
    const result = TargetMatch.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.similarity_score).toBe(0.95);
  });

  // ── OptionProvenanceV3 ─────────────────────────────────────────────────
  it("OptionProvenanceV3 preserves extra fields", () => {
    const input = {
      source: "brief_extraction" as const,
      brief_quote: "test",
      extraction_step: 3,
    };
    const result = OptionProvenanceV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.extraction_step).toBe(3);
  });

  // ── ValidationWarningV3 ────────────────────────────────────────────────
  it("ValidationWarningV3 preserves extra fields", () => {
    const input = {
      code: "TEST_WARNING",
      severity: "info" as const,
      message: "test",
      debug_context: { step: 1 },
    };
    const result = ValidationWarningV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.debug_context).toEqual({ step: 1 });
  });

  // ── GraphMetaV3 ────────────────────────────────────────────────────────
  it("GraphMetaV3 preserves extra fields", () => {
    const input = {
      roots: ["a"],
      source: "assistant" as const,
      layout_version: 2,
    };
    const result = GraphMetaV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.layout_version).toBe(2);
  });

  // ── CEEGraphResponseV3 (top-level) ─────────────────────────────────────
  it("CEEGraphResponseV3 preserves extra top-level fields", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      analysis_ready: { options: [], goal_node_id: "goal_1", status: "ready" },
      custom_top_level: "preserved",
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.custom_top_level).toBe("preserved");
  });

  it("CEEGraphResponseV3 preserves extra trace fields", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      trace: {
        request_id: "req-1",
        custom_trace_field: "preserved",
      },
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.trace.custom_trace_field).toBe("preserved");
  });

  // ── AnalysisReadyPayload ───────────────────────────────────────────────
  it("AnalysisReadyPayload preserves extra fields", () => {
    const input = {
      options: [],
      goal_node_id: "goal_1",
      status: "ready",
      seed: "42",
    };
    const result = AnalysisReadyPayload.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.seed).toBe("42");
  });

  // ── OptionForAnalysis ──────────────────────────────────────────────────
  it("OptionForAnalysis preserves extra fields", () => {
    const input = {
      id: "opt_1",
      label: "Option 1",
      status: "ready",
      interventions: { f1: 10 },
      custom_analysis_field: true,
    };
    const result = OptionForAnalysis.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.custom_analysis_field).toBe(true);
  });

  // ── Known field validation still works ─────────────────────────────────
  it("NodeV3 still rejects invalid known fields", () => {
    const input = {
      id: "123invalid", // must start with letter
      kind: "factor",
      label: "Price",
    };
    const result = NodeV3.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("EdgeV3 still rejects missing required fields", () => {
    const input = {
      from: "a",
      // missing: to, strength, exists_probability, effect_direction
    };
    const result = EdgeV3.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Coaching passthrough across schema boundaries
// ============================================================================

describe("Coaching passthrough across schema boundaries", () => {
  const coachingPayload = {
    summary: "Your expansion hinges on an unverified investment estimate",
    strengthen_items: [
      {
        id: "str_1",
        label: "Add cost ceiling",
        detail: "Brief mentions budget but no number",
        action_type: "add_constraint",
        bias_category: "framing",
      },
    ],
  };

  it("LLMDraftResponse preserves coaching via .passthrough()", () => {
    const input = {
      nodes: [{ id: "goal_1", kind: "goal", label: "Revenue" }],
      edges: [],
      coaching: coachingPayload,
    };
    const result = LLMDraftResponse.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.coaching).toEqual(coachingPayload);
  });

  it("DraftGraphOutput validates coaching field", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "goal_1", kind: "goal", label: "Revenue" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      coaching: coachingPayload,
    };
    const result = DraftGraphOutput.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.coaching).toEqual(coachingPayload);
  });

  it("CEEGraphResponseV3 validates coaching field", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Revenue" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      coaching: coachingPayload,
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.coaching).toEqual(coachingPayload);
  });

  it("CEEGraphResponseV3 is valid without coaching", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Revenue" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.coaching).toBeUndefined();
  });
});
