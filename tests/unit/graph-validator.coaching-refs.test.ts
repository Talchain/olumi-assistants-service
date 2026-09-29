/**
 * Graph validator referential-integrity tests (v0.11.0 schema amendment).
 *
 * Pins the five new warning codes:
 *   CAUSAL_CLAIM_INVALID_REF
 *   CAUSAL_CLAIM_BETWEEN_INVALID
 *   CAUSAL_CLAIM_GOAL_TARGET
 *   CAUSAL_CLAIMS_CARDINALITY_OFF
 *   WIDENING_LOG_INVALID_REF
 *
 * All are warning-level — never reject. Tests assert presence and absence
 * via fixture-backed mutation.
 */
import { describe, it, expect } from "vitest";
import { validateGraph } from "../../src/validators/graph-validator.js";
import type { GraphT, NodeT, EdgeT } from "../../src/schemas/graph.js";

function makeGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_main", kind: "decision", label: "decision" },
      { id: "opt_a", kind: "option", label: "option a", data: { is_baseline: false, interventions: { fac_a: 1 } } },
      { id: "opt_b", kind: "option", label: "option b", data: { is_baseline: true, interventions: {} } },
      { id: "fac_a", kind: "factor", label: "factor a", category: "controllable", data: { value: 0, extractionType: "explicit", factor_type: "other", uncertainty_drivers: [] } },
      { id: "fac_b", kind: "factor", label: "factor b", category: "controllable", data: { value: 0, extractionType: "explicit", factor_type: "other", uncertainty_drivers: [] } },
      { id: "out_x", kind: "outcome", label: "outcome x" },
      { id: "out_y", kind: "outcome", label: "outcome y" },
      { id: "risk_z", kind: "risk", label: "risk z" },
      { id: "goal_g", kind: "goal", label: "goal", goal_threshold: 0.8 },
    ] as unknown as NodeT[],
    edges: [
      { from: "dec_main", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_main", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_a", to: "out_x", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      { from: "fac_b", to: "out_y", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      { from: "fac_a", to: "risk_z", strength_mean: 0.4, strength_std: 0.1, belief_exists: 0.6, effect_direction: "positive" },
      { from: "out_x", to: "goal_g", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "out_y", to: "goal_g", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "risk_z", to: "goal_g", strength_mean: -0.5, strength_std: 0.1, belief_exists: 0.7, effect_direction: "negative" },
    ] as unknown as EdgeT[],
  };
}

describe("graph-validator coaching/causal-claims referential integrity", () => {
  it("(a) flags causal_claims with bad from/to/via — CAUSAL_CLAIM_INVALID_REF", () => {
    const graph = makeGraph();
    const result = validateGraph({
      graph,
      causalClaims: [
        { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
        { type: "direct_effect", from: "fac_does_not_exist", to: "out_x", stated_strength: "moderate" },
        { type: "mediation_only", from: "fac_a", via: "out_phantom", to: "goal_g" },
      ],
    });
    const refWarnings = result.warnings.filter((w) => w.code === "CAUSAL_CLAIM_INVALID_REF");
    expect(refWarnings).toHaveLength(2);
    // Ref-integrity is warning-level only; the new codes never appear in errors.
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(result.errors.filter((e) => newCodes.has(e.code))).toEqual([]);
  });

  it("(b) flags unmeasured_confounder with non-distinct or non-factor refs — CAUSAL_CLAIM_BETWEEN_INVALID", () => {
    const graph = makeGraph();
    const result = validateGraph({
      graph,
      causalClaims: [
        // Same id twice
        { type: "unmeasured_confounder", between: ["fac_a", "fac_a"] },
        // One is a non-factor (outcome)
        { type: "unmeasured_confounder", between: ["fac_a", "out_x"] },
        // length != 2
        { type: "unmeasured_confounder", between: ["fac_a"] },
      ],
    });
    const betweenInvalid = result.warnings.filter((w) => w.code === "CAUSAL_CLAIM_BETWEEN_INVALID");
    // Three warnings: dup, non-factor, length-mismatch
    expect(betweenInvalid.length).toBeGreaterThanOrEqual(3);
    // Ref-integrity is warning-level only; the new codes never appear in errors.
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(result.errors.filter((e) => newCodes.has(e.code))).toEqual([]);
  });

  it("(c) flags coaching.widening_log.elements_added entries that don't reference a node — WIDENING_LOG_INVALID_REF", () => {
    const graph = makeGraph();
    const result = validateGraph({
      graph,
      coaching: {
        summary: "x",
        strengthen_items: [],
        widening_log: {
          elements_added: ["fac_a", "fac_phantom", "risk_z", "node_does_not_exist"],
          elements_considered_but_excluded: [],
          brief_completeness: "partial",
        },
        bias_signals: [],
      },
    });
    const refWarnings = result.warnings.filter((w) => w.code === "WIDENING_LOG_INVALID_REF");
    expect(refWarnings).toHaveLength(2);
    // Ref-integrity is warning-level only; the new codes never appear in errors.
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(result.errors.filter((e) => newCodes.has(e.code))).toEqual([]);
  });

  it("(d) warns when direct_effect/mediation_only/no_direct_effect from or via points at the goal — CAUSAL_CLAIM_GOAL_TARGET", () => {
    const graph = makeGraph();
    const result = validateGraph({
      graph,
      causalClaims: [
        // from === goal — implausible for a direct_effect; warn
        { type: "direct_effect", from: "goal_g", to: "out_x", stated_strength: "strong" },
        // via === goal — implausible for mediation_only; warn
        { type: "mediation_only", from: "fac_a", via: "goal_g", to: "out_x" },
      ],
    });
    const goalWarnings = result.warnings.filter((w) => w.code === "CAUSAL_CLAIM_GOAL_TARGET");
    expect(goalWarnings).toHaveLength(2);
    // Ref-integrity is warning-level only; the new codes never appear in errors.
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(result.errors.filter((e) => newCodes.has(e.code))).toEqual([]);
  });

  it("(e) warns when graph has 5+ causal edges and claims length is outside [3,8] — CAUSAL_CLAIMS_CARDINALITY_OFF", () => {
    const graph = makeGraph();
    // makeGraph() has 5 non-structural causal edges (fac→out, fac→out, fac→risk, out→goal x2, risk→goal — 6).
    const result = validateGraph({
      graph,
      causalClaims: [
        { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
      ], // 1 < 3 → cardinality warn
    });
    const cardinalityWarnings = result.warnings.filter((w) => w.code === "CAUSAL_CLAIMS_CARDINALITY_OFF");
    expect(cardinalityWarnings).toHaveLength(1);
    // Ref-integrity is warning-level only; the new codes never appear in errors.
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(result.errors.filter((e) => newCodes.has(e.code))).toEqual([]);
  });

  it("does NOT warn for cardinality when graph has fewer than 5 causal edges", () => {
    // Trim graph to fewer causal edges
    const graph = makeGraph();
    graph.edges = graph.edges.filter(
      (e) =>
        !(
          (e.from === "fac_b" && e.to === "out_y") ||
          (e.from === "out_y" && e.to === "goal_g") ||
          (e.from === "fac_a" && e.to === "risk_z") ||
          (e.from === "risk_z" && e.to === "goal_g")
        ),
    );
    const result = validateGraph({
      graph,
      causalClaims: [
        { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
      ],
    });
    const cardinalityWarnings = result.warnings.filter((w) => w.code === "CAUSAL_CLAIMS_CARDINALITY_OFF");
    expect(cardinalityWarnings).toHaveLength(0);
  });

  it("emits no new warnings when coaching/causalClaims are absent (no-op contract)", () => {
    const graph = makeGraph();
    const baseline = validateGraph({ graph });
    const newCodes = new Set([
      "CAUSAL_CLAIM_INVALID_REF",
      "CAUSAL_CLAIM_BETWEEN_INVALID",
      "CAUSAL_CLAIM_GOAL_TARGET",
      "CAUSAL_CLAIMS_CARDINALITY_OFF",
      "WIDENING_LOG_INVALID_REF",
    ]);
    expect(baseline.warnings.filter((w) => newCodes.has(w.code))).toEqual([]);
  });
});
