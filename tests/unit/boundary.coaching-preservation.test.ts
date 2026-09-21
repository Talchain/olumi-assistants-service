/**
 * Stage 6 V1 → V3 boundary tests for the v0.11.0 schema amendment.
 *
 * Exercises the REAL `transformResponseToV3` from
 * `src/cee/transforms/schema-v3.ts` (not a re-implemented helper) so a
 * production regression in the boundary preservation path would actually
 * fail this test.
 *
 * Hard invariant for `topology_plan`: when present in V1, the V3 output
 * MUST equal the V1 input exactly — same length, same order, same string
 * contents. No filter, no trim, no reorder.
 *
 * Coaching and causal_claims preservation is also asserted via the real
 * transform.
 */
import { describe, it, expect } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";

function buildMinimalV1Response(overrides: Partial<V1DraftGraphResponse> = {}): V1DraftGraphResponse {
  const baseGraph = {
    nodes: [
      { id: "dec_1", kind: "decision" as const, label: "decision" },
      { id: "opt_a", kind: "option" as const, label: "option a", data: { is_baseline: false, interventions: { fac_a: 1 } } },
      { id: "opt_b", kind: "option" as const, label: "status quo", data: { is_baseline: true, interventions: {} } },
      { id: "fac_a", kind: "factor" as const, label: "factor a", category: "controllable", data: { value: 0, extractionType: "explicit" as const, factor_type: "other", uncertainty_drivers: [] } },
      { id: "out_x", kind: "outcome" as const, label: "outcome x" },
      { id: "goal_g", kind: "goal" as const, label: "goal", goal_threshold: 0.8 },
    ] as unknown as V1DraftGraphResponse["graph"]["nodes"],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
      { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
      { from: "opt_a", to: "fac_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
      { from: "fac_a", to: "out_x", strength_mean: 0.6, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" as const },
      { from: "out_x", to: "goal_g", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" as const },
    ] as unknown as V1DraftGraphResponse["graph"]["edges"],
    meta: { schema_version: "1" },
  } as unknown as V1DraftGraphResponse["graph"];
  return {
    graph: baseGraph,
    rationales: [],
    quality: { overall: 7, structure: 8, coverage: 7 },
    trace: {} as V1DraftGraphResponse["trace"],
    ...overrides,
  } as V1DraftGraphResponse;
}

describe("transformResponseToV3 — v0.11.0 boundary preservation (real transform)", () => {
  it("preserves topology_plan exactly: same length, order, contents", () => {
    const lines = [
      "opt_a sets {fac_a=1}",
      "opt_b sets {fac_a=0}",
      "fac_a -> out_x",
      "out_x -> goal_g",
    ];
    const v1 = buildMinimalV1Response({
      topology_plan: lines,
    } as Partial<V1DraftGraphResponse>);
    const v3 = transformResponseToV3(v1);
    const v3TopologyPlan = (v3 as unknown as { topology_plan?: unknown[] }).topology_plan;
    expect(v3TopologyPlan).toEqual(lines);
    expect(Array.isArray(v3TopologyPlan)).toBe(true);
    expect((v3TopologyPlan as unknown[]).length).toBe(lines.length);
    (v3TopologyPlan as string[]).forEach((line, i) => expect(line).toBe(lines[i]));
  });

  it("defaults topology_plan to [] when V1 omits it (canonical contract requires presence)", () => {
    // v0.11.0 schema amendment: topology_plan is required at the boundary
    // contract. Stage 6 normalises legacy absence by defaulting to [],
    // ensuring V3 consumers always see the field.
    const v1 = buildMinimalV1Response();
    const v3 = transformResponseToV3(v1);
    const tp = (v3 as unknown as { topology_plan?: unknown[] }).topology_plan;
    expect(Array.isArray(tp)).toBe(true);
    expect((tp as unknown[]).length).toBe(0);
  });

  it("preserves an empty topology_plan as []", () => {
    const v1 = buildMinimalV1Response({ topology_plan: [] } as Partial<V1DraftGraphResponse>);
    const v3 = transformResponseToV3(v1);
    const tp = (v3 as unknown as { topology_plan?: unknown[] }).topology_plan;
    expect(Array.isArray(tp)).toBe(true);
    expect((tp as unknown[]).length).toBe(0);
  });

  it("defaults causal_claims to [] when V1 omits it (canonical contract: required at V3 boundary)", () => {
    // v0.11.0 schema amendment: causal_claims is required at the V3
    // boundary. Stage 6 normalises legacy absence by defaulting to [],
    // collapsing the Phase 2B provenance distinction (which is preserved
    // internally on ctx.causalClaims for analytics).
    const v1 = buildMinimalV1Response();
    const v3 = transformResponseToV3(v1);
    expect((v3 as unknown as { causal_claims?: unknown[] }).causal_claims).toEqual([]);
  });

  it("preserves causal_claims when V1 emits an array", () => {
    const claims = [
      { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
      { type: "no_direct_effect", from: "opt_a", to: "goal_g" },
    ];
    const v1 = buildMinimalV1Response({ causal_claims: claims } as unknown as Partial<V1DraftGraphResponse>);
    const v3 = transformResponseToV3(v1);
    expect((v3 as unknown as { causal_claims?: unknown[] }).causal_claims).toEqual(claims);
  });

  it("preserves coaching when V1 emits canonical-shape coaching", () => {
    const coaching = {
      summary: "Some coaching",
      strengthen_items: [
        { id: "s1", label: "lbl", detail: "detail", action_type: "add_constraint" },
      ],
      widening_log: {
        elements_added: ["fac_a"],
        elements_considered_but_excluded: ["regulatory pause unlikely in this horizon"],
        brief_completeness: "partial",
      },
      bias_signals: [{ type: "anchoring", detail: "Synergy figure anchored on 50M without basis." }],
    };
    const v1 = buildMinimalV1Response({ coaching } as unknown as Partial<V1DraftGraphResponse>);
    const v3 = transformResponseToV3(v1);
    const v3Coaching = (v3 as unknown as { coaching?: typeof coaching }).coaching;
    expect(v3Coaching?.summary).toBe(coaching.summary);
    expect(v3Coaching?.strengthen_items).toEqual(coaching.strengthen_items);
    expect(v3Coaching?.widening_log).toEqual(coaching.widening_log);
    expect(v3Coaching?.bias_signals).toEqual(coaching.bias_signals);
  });
});
