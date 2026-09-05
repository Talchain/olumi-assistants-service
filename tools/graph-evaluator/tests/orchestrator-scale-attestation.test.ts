/**
 * Unattested 0-1 -> percentage renders — the DIAGNOSTIC, not a gate.
 *
 * WHAT THIS PINS. CEE renders unitless model values as percentages. The
 * sharpest instance is CEE's own Unknown-baseline placeholder: `draft_graph.txt`
 * defines "Unknown baseline: 0.5 with extractionType 'inferred'", so a unitless
 * `0.5` is the product's way of saying "we did not know". Rendering it as "50%"
 * turns an admitted unknown into a confident statistic.
 *
 * The promotion gate could not see this. Its grounding corpus contained BOTH
 * `0.5` and `Math.round(0.5 * 100)`, so `fabrication_check` certified "50%" as
 * grounded — the gate blessed the transformation it should have been measuring,
 * and a promotion run could not tell an improvement from a regression.
 *
 * ⛔ SCOPE. This suite pins that the transformation is now VISIBLE. It must NOT
 * be turned into an enforcement gate: the remedy for the rendering is an open
 * product decision, and failing on the class before that decision is made would
 * block every promotion. `it("changes no score")` below exists to FAIL LOUD if
 * anyone wires the diagnostic into scoring.
 */
import { describe, it, expect } from "vitest";
import { scoreOrchestrator } from "../src/orchestrator-scorer.js";
import type { OrchestratorFixture, TurnContext, FactorEntityRef } from "../src/types.js";

// =============================================================================
// Fixture factory — minimal, so each test's variable is the only thing moving
// =============================================================================

interface CtxOpts {
  factors?: FactorEntityRef[];
  winnerProbability?: number | null;
  topDrivers?: Array<{ id: string; label: string; sensitivity: number }>;
  edges?: TurnContext["entities"]["edges"];
}

function makeTurnContext(o: CtxOpts = {}): TurnContext {
  return {
    scenario_id: "scale-attestation",
    turn_id: "t1",
    stage: "evaluate",
    entities: {
      decisions: [],
      options: [{ id: "opt_a", label: "Option A" }],
      factors: o.factors ?? [],
      outcomes: [],
      risks: [],
      goals: [],
      edges: o.edges ?? [],
      constraints: [],
    },
    graph: { node_count: 2, edge_count: 0, option_count: 1, missing_structural: [] },
    analysis: {
      status: "completed",
      staleness_reason: null,
      winner:
        o.winnerProbability == null
          ? null
          : { id: "opt_a", label: "Option A", probability: o.winnerProbability },
      runner_up: null,
      robustness_band: "fragile",
      top_drivers: o.topDrivers ?? [],
      fragile_edges: [],
      constraints_met: null,
    },
    capabilities: {
      can_run_analysis: true,
      can_explain_results: true,
      can_edit_graph: true,
      can_compare_options: true,
      can_generate_artefact: false,
      disabled_reasons: {},
    },
    blockers: [],
    signals: {
      high_uncertainty_factors: [],
      dominant_factor: null,
      close_call: false,
      missing_option_families: [],
      default_value_count: 0,
      weak_edges: [],
    },
    conversation: {
      turn_count: 1,
      last_user_intent: null,
      last_tool_used: null,
      recent_actions_taken: [],
      recent_actions_declined: [],
      pending_confirmation: null,
      last_failed_action: null,
    },
    eligible_actions: ["explain_result"],
  } as TurnContext;
}

function makeFixture(o: CtxOpts = {}, userMessage = "What does the model say?"): OrchestratorFixture {
  return {
    id: "scale-attestation",
    name: "Scale attestation",
    description: "Scale attestation",
    stage: "evaluate",
    user_message: userMessage,
    turn_context: makeTurnContext(o),
    expected: { expects_uncertainty_language: false },
  } as OrchestratorFixture;
}

const response = (text: string) =>
  JSON.stringify({ text, insights: [], recommended_actions: [] });

/** CEE's Unknown-baseline placeholder: a unitless 0.5, no unit attested. */
const UNITLESS_HALF: FactorEntityRef = {
  id: "fac_retention",
  label: "Customer Retention",
  category: "observable",
  value: 0.5,
};

const RENDERS_FIFTY_PERCENT = "Customer Retention sits at 50%, which is driving the gap.";

// =============================================================================
// 1. THE DEFECT — the transformation must be VISIBLE
// =============================================================================

describe("unattested scale renders — the defect is now visible", () => {
  it("reports a unitless 0.5 rendered as 50%, bound to the factor that supplied it", () => {
    const fixture = makeFixture({ factors: [UNITLESS_HALF] });
    const result = scoreOrchestrator(fixture, response(RENDERS_FIFTY_PERCENT));

    // PRECONDITION, pinned in-test: the number must actually be GROUNDED here.
    // Without this the test could pass on a response whose number was simply
    // ungrounded — a different finding entirely.
    expect(result.fabrication_check).toBe(true);

    expect(result.scale_conversions).toHaveLength(1);
    const [record] = result.scale_conversions;
    // Bound by IDENTITY (the exact source ref), never by "an array is non-empty"
    // — another factor sitting at 0.5 would satisfy a weaker assertion.
    expect(record.source_ref).toBe("factor:fac_retention");
    expect(record.rendered).toBe("50%");
    expect(record.rendered_value).toBe(50);
    expect(record.source_value).toBe(0.5);
    expect(record.attestation).toBe("unattested");
  });

  it("reports a percentage rendered from a value whose unit CONTRADICTS it", () => {
    const fixture = makeFixture({
      factors: [{ ...UNITLESS_HALF, unit: "GBP" }],
    });
    const result = scoreOrchestrator(fixture, response(RENDERS_FIFTY_PERCENT));

    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toHaveLength(1);
    expect(result.scale_conversions[0].source_ref).toBe("factor:fac_retention");
    // Distinguished from a bare unitless value: here the model DID state a
    // scale, and it is not a percentage.
    expect(result.scale_conversions[0].attestation).toBe("unit_conflict");
  });

  it("reports a driver sensitivity rendered as a percentage", () => {
    // A sensitivity is a bare elasticity-like number — not a probability and
    // carrying no unit, so its percentage form is unattested too.
    const fixture = makeFixture({
      topDrivers: [{ id: "fac_cost", label: "Implementation Cost", sensitivity: 0.35 }],
    });
    const result = scoreOrchestrator(
      fixture,
      response("Implementation Cost accounts for 35% of the movement.")
    );

    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toHaveLength(1);
    expect(result.scale_conversions[0].source_ref).toBe("top_driver:fac_cost.sensitivity");
    expect(result.scale_conversions[0].attestation).toBe("unattested");
  });

  // ── edge.strength_mean — the LARGEST source class in the fixture corpus ────
  // Measured over all 23 orchestrator fixtures: 45 of the 65 records come from
  // `edge.*.strength_mean`, and 10 fixtures are exposed by NO other source. It
  // was also the class the first exposure count omitted. A causal strength is
  // unitless and is not a probability (`orchestrator-scorer.ts`, the `edges`
  // loop), so its percentage form is unattested — these two pin that.

  it("reports an edge strength_mean rendered as a percentage", () => {
    const fixture = makeFixture({
      edges: [{ from: "fac_upsell", to: "goal_arr", strength_mean: 0.7, exists_probability: 0.9 }],
    });
    const result = scoreOrchestrator(
      fixture,
      response("Enterprise Upsell pushes ARR at 70% strength on this path.")
    );

    // PRECONDITION pinned in-test: the number is GROUNDED, so the record is
    // the diagnostic's doing and not an ungrounded number falling through.
    expect(result.fabrication_check).toBe(true);

    expect(result.scale_conversions).toHaveLength(1);
    const [record] = result.scale_conversions;
    // Bound by IDENTITY to the edge that supplied it. The sibling
    // `exists_probability` (0.9) sits in the same corpus and is ATTESTED, so a
    // weaker "array is non-empty" assertion would not distinguish them.
    expect(record.source_ref).toBe("edge:fac_upsell->goal_arr.strength_mean");
    expect(record.rendered).toBe("70%");
    expect(record.source_value).toBe(0.7);
    expect(record.attestation).toBe("unattested");
  });

  it("reports a NEGATIVE edge strength rendered as a positive percentage", () => {
    // The scorer grounds `Math.abs(strength_mean)`, so a -0.5 strength grounds
    // "50%" — the render silently drops the SIGN as well as inventing the
    // scale, which is the more misleading of the two. Pinned as its own case
    // so the negative half of the value range is not certified by a corpus
    // that only ever contains positives.
    const fixture = makeFixture({
      edges: [{ from: "fac_churn", to: "goal_arr", strength_mean: -0.5, exists_probability: 0.95 }],
    });
    const result = scoreOrchestrator(
      fixture,
      response("Customer Churn moves ARR at 50% strength on this path.")
    );

    expect(result.fabrication_check).toBe(true);

    expect(result.scale_conversions).toHaveLength(1);
    const [record] = result.scale_conversions;
    expect(record.source_ref).toBe("edge:fac_churn->goal_arr.strength_mean");
    expect(record.rendered).toBe("50%");
    // The model value is -0.5; what reached the corpus is its magnitude.
    expect(record.source_value).toBe(0.5);
    expect(record.attestation).toBe("unattested");
  });
});

// =============================================================================
// 2. THE OPPOSITE-DIRECTION TWIN — legitimate percentages must NOT be flagged
//    A change that closes the blindness by flagging honest renders is the
//    WORSE defect. Every case above gets its twin here.
// =============================================================================

describe("opposite-direction twin — legitimate percentages stay clean", () => {
  it("does NOT report a percentage rendered from a declared probability", () => {
    const fixture = makeFixture({ winnerProbability: 0.62 });
    const result = scoreOrchestrator(
      fixture,
      response("Option A leads at 62% on current assumptions.")
    );

    // Precondition: the number is grounded, i.e. the scorer DID see it.
    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toEqual([]);
  });

  it("does NOT report a percentage rendered from a value with an explicit % unit", () => {
    const fixture = makeFixture({
      factors: [{ ...UNITLESS_HALF, value: 0.42, unit: "%" }],
    });
    const result = scoreOrchestrator(
      fixture,
      response("Customer Retention sits at 42%, which is driving the gap.")
    );

    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toEqual([]);
  });

  it("does NOT report a percentage rendered from an edge exists_probability", () => {
    const fixture = makeFixture({
      edges: [{ from: "fac_a", to: "goal_b", strength_mean: 0.5, exists_probability: 0.88 }],
    });
    const result = scoreOrchestrator(
      fixture,
      response("That link holds in 88% of runs, so the path is dependable.")
    );

    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toEqual([]);
  });

  it("does NOT report a value rendered AS-IS, because no scale was invented", () => {
    const fixture = makeFixture({ factors: [UNITLESS_HALF] });
    const result = scoreOrchestrator(
      fixture,
      response("Customer Retention is held at 0.5 in the current model.")
    );

    expect(result.scale_conversions).toEqual([]);
  });

  it("does NOT report a percentage the USER themselves stated", () => {
    // The user said "50%". Echoing their own figure back is not an invented
    // scale, even though a unitless 0.5 happens to sit in the graph.
    const fixture = makeFixture(
      { factors: [UNITLESS_HALF] },
      "Retention is running at 50% right now, what does that mean?"
    );
    const result = scoreOrchestrator(fixture, response(RENDERS_FIFTY_PERCENT));

    expect(result.fabrication_check).toBe(true);
    expect(result.scale_conversions).toEqual([]);
  });
});

// =============================================================================
// 3. REPORTED, NOT ENFORCED — this is the guard that keeps the change safe
// =============================================================================

describe("the diagnostic is reported, never enforced", () => {
  it("changes no score: an unattested render scores identically to a clean one", () => {
    const defect = scoreOrchestrator(
      makeFixture({ factors: [UNITLESS_HALF] }),
      response(RENDERS_FIFTY_PERCENT)
    );
    const clean = scoreOrchestrator(
      makeFixture({ factors: [{ ...UNITLESS_HALF, unit: "%" }] }),
      response(RENDERS_FIFTY_PERCENT)
    );

    // Precondition: the two really do differ on the diagnostic, so this test
    // cannot pass by comparing two identical cases.
    expect(defect.scale_conversions).toHaveLength(1);
    expect(clean.scale_conversions).toEqual([]);

    // ...and yet every score is identical. If a later change wires the
    // diagnostic into scoring, this goes RED.
    expect(defect.overall).toBe(clean.overall);
    expect(defect.fabrication_check).toBe(clean.fabrication_check);
    expect(defect.fabrication_check).toBe(true);
  });

  it("leaves a genuinely fabricated number failing, as before", () => {
    // The diagnostic must not have weakened the check it sits beside: a number
    // grounded by NOTHING is still a fabrication.
    const result = scoreOrchestrator(
      makeFixture({ factors: [UNITLESS_HALF] }),
      response("Retention is 73%, which is why Option A wins.")
    );
    expect(result.fabrication_check).toBe(false);
  });
});

// =============================================================================
// 4. ALWAYS MEASURED — an absent field is indistinguishable from "found none"
// =============================================================================

describe("the diagnostic is always present", () => {
  it("is an empty array, not undefined, when there is nothing to report", () => {
    const result = scoreOrchestrator(
      makeFixture({ winnerProbability: 0.62 }),
      response("Option A leads at 62% on current assumptions.")
    );
    expect(result.scale_conversions).toBeDefined();
    expect(result.scale_conversions).toEqual([]);
  });

  it("is an empty array on the null-response path", () => {
    expect(scoreOrchestrator(makeFixture(), null).scale_conversions).toEqual([]);
  });

  it("is an empty array on the unparseable-response path", () => {
    expect(
      scoreOrchestrator(makeFixture(), "not json at all").scale_conversions
    ).toEqual([]);
  });
});
