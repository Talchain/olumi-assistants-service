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
import { DraftGraphOutput, GoalConstraintSchema } from "../../src/schemas/assist.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";

/**
 * CIL Phase 1 — Verify egress schemas strip unknown fields.
 *
 * NodeV3, EdgeV3, CEEGraphResponseV3 now use .strip() (Zod default)
 * instead of .passthrough(). Unknown fields are silently dropped.
 * Schemas that remain passthrough (OptionV3, ObservedStateV3, etc.)
 * still preserve extra fields.
 */
describe("CIL Phase 1: V3 egress schemas strip unknown fields on NodeV3, EdgeV3, CEEGraphResponseV3", () => {
  // ── NodeV3 (stripped) ──────────────────────────────────────────────────
  it("NodeV3 strips extra fields", () => {
    const input = {
      id: "factor_price",
      kind: "factor",
      label: "Price",
      experimental_flag: true,
      custom_score: 42,
    };
    const result = NodeV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.experimental_flag).toBeUndefined();
    expect((result as any).data.custom_score).toBeUndefined();
  });

  // ── EdgeV3 (stripped) ──────────────────────────────────────────────────
  it("EdgeV3 strips extra fields", () => {
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
    expect((result as any).data.edge_metadata).toBeUndefined();
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

  // ── CEEGraphResponseV3 (stripped) ───────────────────────────────────────
  it("CEEGraphResponseV3 strips extra top-level fields", () => {
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
    expect((result as any).data.custom_top_level).toBeUndefined();
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
      id: "INVALID WITH SPACES!", // must be lowercase alphanumeric/underscores/colons/hyphens
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
        // v0.11.0 schema amendment: canonical BiasType replaces legacy "framing".
        bias_category: "narrow_framing",
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

// ============================================================================
// CIL Phase 1 — Schema hardening additions
// ============================================================================

describe("CIL Phase 1: Schema hardening — new field declarations and strip behaviour", () => {
  // ── NodeV3 option-kind fields ─────────────────────────────────────────
  it("NodeV3 accepts interventions and is_baseline on option-kind nodes", () => {
    const input = {
      id: "opt_expand",
      kind: "option",
      label: "Expand into EU",
      interventions: {
        fac_price: { value: 59, source: "brief_extraction", target_match: { node_id: "fac_price", match_type: "exact_id", confidence: "high" } },
      },
      is_baseline: false,
    };
    const result = NodeV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.interventions).toBeDefined();
    expect((result as any).data.is_baseline).toBe(false);
  });

  // ── NodeV3 declared CIL Phase 1 fields ─────────────────────────────────
  it("NodeV3 accepts all declared metadata fields", () => {
    const input = {
      id: "fac_revenue",
      kind: "factor",
      label: "Revenue",
      prior: { distribution: "uniform", range_min: 0, range_max: 100 },
      factor_type: "continuous",
      extractionType: "extracted",
      uncertainty_drivers: ["market_volatility"],
      intercept: 0.5,
      display_value: "£40,000",
      encoding_map: { "0": "Low", "1": "High" },
    };
    const result = NodeV3.safeParse(input);
    expect(result.success).toBe(true);
    const data = (result as any).data;
    expect(data.prior.distribution).toBe("uniform");
    expect(data.factor_type).toBe("continuous");
    expect(data.extractionType).toBe("extracted");
    expect(data.uncertainty_drivers).toEqual(["market_volatility"]);
    expect(data.intercept).toBe(0.5);
    expect(data.display_value).toBe("£40,000");
    expect(data.encoding_map).toEqual({ "0": "Low", "1": "High" });
  });

  // ── _retry_suggestion stripped ─────────────────────────────────────────
  it("CEEGraphResponseV3 strips _retry_suggestion", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      _retry_suggestion: {
        should_retry: true,
        reason: "missing factors",
        missing_factor_terms: ["price"],
      },
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data._retry_suggestion).toBeUndefined();
  });

  // ── Rationale validation ───────────────────────────────────────────────
  it("CEEGraphResponseV3 accepts valid rationales with provenance_source", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      rationales: [
        { target: "fac_price", why: "Price drives conversion", provenance_source: "brief" },
        { target: "fac_cost", why: "Cost is a constraint" },
      ],
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    const rationales = (result as any).data.rationales;
    expect(rationales).toHaveLength(2);
    expect(rationales[0].provenance_source).toBe("brief");
    expect(rationales[1].provenance_source).toBeUndefined();
  });

  it("CEEGraphResponseV3 rejects rationale missing target", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      rationales: [
        { why: "missing target field" },
      ],
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(false);
  });

  // ── Coaching strips extra fields ───────────────────────────────────────
  it("CEEGraphResponseV3 coaching strips undeclared fields from strengthen_items", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      coaching: {
        summary: "Test coaching",
        strengthen_items: [{
          id: "str_1",
          label: "Add cost data",
          detail: "Brief mentions budget",
          action_type: "add_constraint",
          openai_hallucinated_field: "should be stripped",
        }],
      },
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    const item = (result as any).data.coaching.strengthen_items[0];
    expect(item.id).toBe("str_1");
    expect(item.openai_hallucinated_field).toBeUndefined();
  });

  // ── GoalConstraint strips extra fields ─────────────────────────────────
  it("GoalConstraintSchema strips undeclared fields", () => {
    const input = {
      constraint_id: "c1",
      node_id: "fac_revenue",
      operator: ">=",
      value: 800,
      label: "Revenue target",
      extra_openai_field: "should be stripped",
    };
    const result = GoalConstraintSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.extra_openai_field).toBeUndefined();
    expect((result as any).data.constraint_id).toBe("c1");
  });

  // ── LLMDraftResponse rationale provenance_source ───────────────────────
  it("LLMDraftResponse preserves provenance_source on rationales", () => {
    const input = {
      nodes: [{ id: "goal_1", kind: "goal", label: "Revenue" }],
      edges: [],
      rationales: [
        { target: "fac_price", why: "Drives revenue", provenance_source: "user_brief" },
      ],
    };
    const result = LLMDraftResponse.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.rationales[0].provenance_source).toBe("user_brief");
  });

  // ── CEEGraphResponseV3 with all declared fields ────────────────────────
  it("CEEGraphResponseV3 passes with all declared fields populated", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{
        id: "goal_1",
        kind: "goal",
        label: "Revenue",
        goal_threshold: 0.8,
        goal_threshold_raw: 800,
        goal_threshold_unit: "customers",
        goal_threshold_cap: 1000,
      }],
      edges: [{
        from: "fac_1",
        to: "goal_1",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: "positive" as const,
        defaulted: true,
      }],
      options: [{
        id: "opt_1",
        label: "Option A",
        status: "ready" as const,
        interventions: {},
      }],
      goal_node_id: "goal_1",
      rationales: [{ target: "goal_1", why: "test" }],
      draft_warnings: [{ id: "orphan_node", severity: "medium", affected_node_ids: ["fac_1"], affected_edge_ids: [] }],
      coaching: {
        summary: "test",
        strengthen_items: [{ id: "s1", label: "l", detail: "d", action_type: "a" }],
      },
      quality: { overall: 7 },
      meta: { roots: ["goal_1"] },
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
  });

  // ── draft_warnings matches CEEStructuralWarningV1 shape ────────────────
  it("CEEGraphResponseV3 accepts draft_warnings with CEEStructuralWarningV1 shape", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      draft_warnings: [
        {
          id: "orphan_node",
          severity: "medium",
          node_ids: ["fac_orphan"],
          affected_node_ids: ["fac_orphan"],
          affected_edge_ids: [],
          explanation: "Node fac_orphan has no incoming or outgoing edges",
          fix_hint: "Connect the node or remove it",
        },
        {
          id: "uniform_edge_strengths",
          severity: "low",
          affected_node_ids: [],
          affected_edge_ids: ["e1", "e2"],
        },
      ],
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(true);
    const warnings = (result as any).data.draft_warnings;
    expect(warnings).toHaveLength(2);
    expect(warnings[0].id).toBe("orphan_node");
    expect(warnings[0].affected_node_ids).toEqual(["fac_orphan"]);
    expect(warnings[0].explanation).toBe("Node fac_orphan has no incoming or outgoing edges");
    expect(warnings[1].affected_edge_ids).toEqual(["e1", "e2"]);
  });

  it("CEEGraphResponseV3 rejects draft_warning missing required id field", () => {
    const input = {
      schema_version: "3.0",
      nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
      edges: [],
      options: [],
      goal_node_id: "goal_1",
      draft_warnings: [{ severity: "medium", affected_node_ids: [], affected_edge_ids: [] }],
    };
    const result = CEEGraphResponseV3.safeParse(input);
    expect(result.success).toBe(false);
  });
});
