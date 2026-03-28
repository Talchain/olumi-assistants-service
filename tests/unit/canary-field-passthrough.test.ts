/**
 * Canary field conformance test
 *
 * Proves that additive (unknown) fields survive the complete adapter pipeline:
 *   raw LLM JSON → normaliseDraftResponse() → ensureControllableFactorBaselines() → LLMDraftResponse.safeParse()
 *
 * Guards against regressions where normaliser reconstruction or Zod's default
 * .strip() mode silently drops fields that downstream consumers depend on.
 */
import { describe, it, expect } from "vitest";
import { normaliseDraftResponse, ensureControllableFactorBaselines } from "../../src/adapters/llm/normalisation.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";

// =============================================================================
// Fixture: minimal valid draft-graph with canary fields at every level
// =============================================================================

/**
 * Build a minimal valid draft-graph fixture injected with canary fields.
 * Canary fields use an underscore prefix so they are clearly not part of
 * any current schema — their survival proves .passthrough() is working.
 */
function makeCanaryFixture() {
  return {
    // ---- Canary at graph envelope level ----
    _canary_graph: "test",

    nodes: [
      { id: "decision_1", kind: "decision", label: "Hire or Build?" },
      {
        id: "opt_a",
        kind: "option",
        label: "Option A",
        data: { interventions: { fac_cost: 100 } },
      },
      {
        id: "fac_cost",
        kind: "factor",
        label: "Cost",
        category: "controllable",
        data: { value: 50 },
        // ---- Canary at node level (on a factor that will be touched by baselines) ----
        _canary_node: { nested: true },
      },
      {
        id: "out_1",
        kind: "outcome",
        label: "Outcome",
        // ---- Canary on a different node kind ----
        _canary_node_outcome: 42,
      },
      {
        id: "goal_1",
        kind: "goal",
        label: "Maximise outcome",
        goal_threshold: 0.8,
      },
    ],

    edges: [
      {
        from: "decision_1",
        to: "opt_a",
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        // ---- Canary at edge level ----
        _canary_edge: true,
      },
      {
        from: "opt_a",
        to: "fac_cost",
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
      },
      {
        from: "fac_cost",
        to: "out_1",
        strength: { mean: -0.5, std: 0.15 },
        exists_probability: 0.85,
      },
      {
        from: "out_1",
        to: "goal_1",
        strength: { mean: 0.9, std: 0.05 },
        exists_probability: 1,
      },
    ],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("additive fields survive normalisation + validation pipeline", () => {
  it("canary fields at graph, node, and edge levels survive the full pipeline", () => {
    const raw = makeCanaryFixture();

    // Stage 1: normaliseDraftResponse — node-kind mapping + edge coercion
    const normalised = normaliseDraftResponse(raw);

    // Stage 2: ensureControllableFactorBaselines — baseline patching
    const { response: withBaselines } = ensureControllableFactorBaselines(normalised);

    // Stage 3: Zod validation (same schema both adapters use)
    const parseResult = LLMDraftResponse.safeParse(withBaselines);
    if (!parseResult.success) {
      const first = parseResult.error.issues[0];
      throw new Error(
        `LLMDraftResponse validation failed: path=${first?.path?.join(".")}, ` +
        `message=${first?.message}, code=${first?.code}`,
      );
    }
    expect(parseResult.success).toBe(true);

    const output = parseResult.data as Record<string, unknown>;

    // ---- Graph envelope canary ----
    expect(output._canary_graph).toBe("test");

    // ---- Node canaries ----
    const nodes = output.nodes as Array<Record<string, unknown>>;
    const facCost = nodes.find((n) => n.id === "fac_cost")!;
    expect(facCost._canary_node).toEqual({ nested: true });

    const outcome = nodes.find((n) => n.id === "out_1")!;
    expect(outcome._canary_node_outcome).toBe(42);

    // ---- Edge canary ----
    const edges = output.edges as Array<Record<string, unknown>>;
    const firstEdge = edges.find((e) => e.from === "decision_1" && e.to === "opt_a")!;
    expect(firstEdge._canary_edge).toBe(true);
  });

  it("canary on a controllable factor without data.value survives baseline defaulting", () => {
    // Factor without data.value gets baseline patched by ensureControllableFactorBaselines.
    // The canary must survive the { ...node, data: { ... } } spread.
    const raw = {
      _canary_graph: "envelope_test",
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A" },
        {
          id: "fac_no_value",
          kind: "factor",
          label: "Factor without value",
          // no data.value — will be defaulted to 1.0
          _canary_node: "must_survive_baseline_patch",
        },
        { id: "out_1", kind: "outcome", label: "O" },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "opt_a", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
        { from: "opt_a", to: "fac_no_value", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
        { from: "fac_no_value", to: "out_1", strength: { mean: 0.3, std: 0.2 }, exists_probability: 0.8 },
        { from: "out_1", to: "goal_1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 1 },
      ],
    };

    const normalised = normaliseDraftResponse(raw);
    const { response: withBaselines, defaultedFactors } = ensureControllableFactorBaselines(normalised);

    // Confirm baseline was actually defaulted (so the spread path was exercised)
    expect(defaultedFactors).toContain("fac_no_value");

    const parseResult = LLMDraftResponse.safeParse(withBaselines);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const output = parseResult.data as Record<string, unknown>;
    const nodes = output.nodes as Array<Record<string, unknown>>;
    const factor = nodes.find((n) => n.id === "fac_no_value")!;

    // Canary survived the baseline-defaulting spread
    expect(factor._canary_node).toBe("must_survive_baseline_patch");
    // Baseline was applied
    expect((factor.data as any).value).toBe(1.0);

    // Envelope canary survived
    expect(output._canary_graph).toBe("envelope_test");
  });

  it("canary on a non-canonical node kind survives kind normalisation", () => {
    // Node with kind "evidence" will be normalised to "option".
    // The canary must survive the { ...n, kind: normalised } spread.
    const raw = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "D" },
        {
          id: "ev_1",
          kind: "evidence", // non-canonical — will be normalised to "option"
          label: "Some evidence",
          _canary_node: "survives_kind_normalisation",
        },
        { id: "fac_1", kind: "factor", label: "F", category: "controllable", data: { value: 1 } },
        { id: "out_1", kind: "outcome", label: "O" },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "decision_1", to: "ev_1", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
        { from: "ev_1", to: "fac_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
        { from: "fac_1", to: "out_1", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.8 },
        { from: "out_1", to: "goal_1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 1 },
      ],
    };

    const normalised = normaliseDraftResponse(raw) as any;

    // Kind was normalised
    const ev = normalised.nodes.find((n: any) => n.id === "ev_1");
    expect(ev.kind).toBe("option");
    // Canary survived the spread
    expect(ev._canary_node).toBe("survives_kind_normalisation");

    const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
    const parseResult = LLMDraftResponse.safeParse(withBaselines);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const output = parseResult.data as Record<string, unknown>;
    const nodes = output.nodes as Array<Record<string, unknown>>;
    const parsedEv = nodes.find((n) => n.id === "ev_1")!;
    expect(parsedEv._canary_node).toBe("survives_kind_normalisation");
    expect(parsedEv.kind).toBe("option");
  });
});
