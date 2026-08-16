/**
 * The readiness route's single admission assessor.
 *
 * These specs pin THREE things:
 *   1. the adapter answers from the MODEL and cannot be moved by client cache;
 *   2. its blocked verdicts are ACTIONABLE by identity (which option, which factor);
 *   3. the edge parameters it synthesises to satisfy `EdgeV3` are INERT —
 *      i.e. this adapter does not fabricate evidence.
 *
 * ...and one more, deliberately: the DEPLOYED-UI PAYLOAD SHAPE test at the
 * bottom pins the precondition that currently BLOCKS the route cutover. It is
 * an executable statement of a measured fact, so it REDs the day the fact
 * changes — which is exactly when the cutover becomes safe.
 */

import { describe, it, expect } from "vitest";
import {
  assessRouteAdmission,
  toCanonicalAssessableGraph,
} from "../canonical-readiness.js";

/** A V3-conformant edge (nested strength + exists_probability). */
const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: "positive" as const,
});

/**
 * The FLAT edge shape the deployed UI actually sends — derived at
 * DecisionGuideAI@9a8b84c6 `readinessStore.ts:313-320`.
 */
const uiEdge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  weight: 0.5,
  belief: 0.8,
  effect_direction: "positive" as const,
});

function baseNodes() {
  return [
    { id: "goal", kind: "goal", label: "Increase revenue" },
    { id: "decision", kind: "decision", label: "Pricing" },
    {
      id: "fac_price",
      kind: "factor",
      label: "Price",
      category: "controllable",
      prior: { distribution: "uniform", range_min: 10, range_max: 30 },
    },
  ];
}

/** Either edge projection — the canonical nested one or the deployed UI's flat one. */
type EdgeFactory = (id: string, from: string, to: string) => Record<string, unknown>;

/** A fully-configured model: both options carry their effect values. */
function configuredGraph(edge: EdgeFactory = v3Edge) {
  return {
    version: "1",
    nodes: [
      ...baseNodes(),
      { id: "opt_a", kind: "option", label: "Premium", interventions: { fac_price: 0.9 } },
      { id: "opt_c", kind: "option", label: "Value", interventions: { fac_price: 0.4 } },
    ],
    edges: [
      edge("e1", "decision", "opt_a"),
      edge("e5", "decision", "opt_c"),
      edge("e3", "opt_a", "fac_price"),
      edge("e6", "opt_c", "fac_price"),
      edge("e7", "fac_price", "goal"),
    ],
  };
}

/** The same model with ONE option left unconfigured — `opt_b`. */
function oneUnconfiguredGraph(edge: EdgeFactory = v3Edge) {
  const g = configuredGraph(edge);
  return {
    ...g,
    nodes: [...g.nodes, { id: "opt_b", kind: "option", label: "Unconfigured" }],
    edges: [...g.edges, edge("e2", "decision", "opt_b"), edge("e4", "opt_b", "fac_price")],
  };
}

describe("assessRouteAdmission — one assessor, answering from the model", () => {
  it("admits a fully-configured model", () => {
    const verdict = assessRouteAdmission(configuredGraph());

    expect(verdict.can_run_analysis).toBe(true);
    expect(verdict.readiness_issues).toEqual([]);
    expect(verdict.blocker_reason).toBeUndefined();
    expect(verdict.options_total).toBe(2);
    expect(verdict.options_ready).toBe(2);
    expect(verdict.goal_node_valid).toBe(true);
  });

  it("refuses a model with an unconfigured option", () => {
    const verdict = assessRouteAdmission(oneUnconfiguredGraph());

    expect(verdict.can_run_analysis).toBe(false);
    expect(typeof verdict.blocker_reason).toBe("string");
    expect(verdict.blocker_reason!.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // ACTIONABILITY — bound BY IDENTITY, never by count.
  //
  // The UI's draft-missing-values affordance has to name an option. A count
  // ("1 option blocked") cannot drive it. The RED/GREEN discrimination here is
  // the second half: naming opt_b is only meaningful if opt_a and opt_c are
  // NOT named — a verdict blaming every option would satisfy a
  // "names an option" assertion while being useless.
  // ==========================================================================
  it("names THAT option and THAT factor, and does not blame the configured ones", () => {
    const verdict = assessRouteAdmission(oneUnconfiguredGraph());

    const forOptB = verdict.readiness_issues.filter((i) => i.option_id === "opt_b");
    expect(forOptB.length).toBeGreaterThan(0);
    expect(forOptB.some((i) => i.factor_id === "fac_price")).toBe(true);
    expect(forOptB.every((i) => typeof i.message === "string" && i.message.length > 0)).toBe(true);

    // Discrimination: the configured options are not named.
    expect(verdict.readiness_issues.some((i) => i.option_id === "opt_a")).toBe(false);
    expect(verdict.readiness_issues.some((i) => i.option_id === "opt_c")).toBe(false);
  });

  // ==========================================================================
  // NO FABRICATION — the synthesised edge parameters must be INERT.
  //
  // `toCanonicalAssessableGraph` fills in `strength` / `exists_probability` /
  // `effect_direction` because `EdgeV3` requires them and the route's wire
  // format does not carry them. That is only honest if those values cannot
  // move the verdict. This asserts it rather than assuming it.
  // ==========================================================================
  it("gives the same verdict whatever the synthesised edge parameters would be", () => {
    const flat = oneUnconfiguredGraph(uiEdge);

    // Same model, wildly different edge parameters on the wire.
    const strong = {
      ...flat,
      edges: flat.edges.map((e) => ({ ...e, weight: 0.99, belief: 1 })),
    };
    const weak = {
      ...flat,
      edges: flat.edges.map((e) => ({ ...e, weight: -0.99, belief: 0 })),
    };
    const bare = {
      ...flat,
      edges: flat.edges.map(({ id, from, to }) => ({ id, from, to })),
    };

    const baseline = assessRouteAdmission(flat);
    for (const variant of [strong, weak, bare]) {
      const verdict = assessRouteAdmission(variant);
      expect(verdict.can_run_analysis).toBe(baseline.can_run_analysis);
      expect(verdict.readiness_issues.map((i) => [i.code, i.option_id, i.factor_id])).toEqual(
        baseline.readiness_issues.map((i) => [i.code, i.option_id, i.factor_id]),
      );
    }
  });

  it("normalises the deployed UI's flat edge shape into the canonical nested one", () => {
    const normalised = toCanonicalAssessableGraph({
      nodes: [],
      edges: [{ id: "e1", from: "a", to: "b", weight: -0.4, belief: 0.7 }],
    }) as { edges: Array<Record<string, any>> };

    // `weight` carries the magnitude; `belief` carries existence.
    expect(normalised.edges[0].strength.mean).toBe(-0.4);
    expect(normalised.edges[0].exists_probability).toBe(0.7);
    // Direction is DERIVED from the sign, never invented.
    expect(normalised.edges[0].effect_direction).toBe("negative");
  });

  it("leaves an already-canonical edge untouched", () => {
    const normalised = toCanonicalAssessableGraph({
      nodes: [],
      edges: [v3Edge("e1", "a", "b")],
    }) as { edges: Array<Record<string, any>> };

    expect(normalised.edges[0].strength).toEqual({ mean: 0.5, std: 0.1 });
    expect(normalised.edges[0].exists_probability).toBe(0.9);
  });

  // ==========================================================================
  // CACHE INDEPENDENCE — the point of the whole exercise.
  // ==========================================================================
  it("is a function of the graph alone — no client payload can reach it", () => {
    // The signature admits ONE argument. There is no `analysis_ready` channel
    // into this assessor, by construction rather than by discipline.
    expect(assessRouteAdmission.length).toBe(1);

    const graph = oneUnconfiguredGraph();
    const first = assessRouteAdmission(graph);
    const second = assessRouteAdmission(graph);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("flags options that cannot be told apart", () => {
    const g = configuredGraph();
    const identical = {
      ...g,
      nodes: g.nodes.map((n: any) =>
        n.kind === "option" ? { ...n, interventions: { fac_price: 0.5 } } : n,
      ),
    };

    expect(assessRouteAdmission(identical).critiques?.[0]?.code).toBe(
      "IDENTICAL_OPTION_INTERVENTIONS",
    );
    // ...and does NOT flag genuinely distinct options.
    expect(assessRouteAdmission(g).critiques).toBeUndefined();
  });
});

// ============================================================================
// THE CUTOVER PIN, INVERTED.
//
// This block previously asserted that a canvas-configured model read as
// UNCONFIGURED on the deployed wire — the measured data gap that blocked
// re-pointing `/assist/v1/graph-readiness` at this assessor. That gap is
// closed: DecisionGuideAI #734 makes `buildReadinessPayload` forward
// `interventions` on option nodes.
//
// So the fixture below is the NEW projection, and the assertion is the
// opposite one: the deployed payload must now ADMIT a configured model. The
// negative arm is retained directly beneath it, because "admits everything" is
// exactly as broken as "admits nothing" and one assertion alone cannot tell
// them apart.
// ============================================================================
describe("cutover pin — the deployed UI payload CAN express a configured option", () => {
  /** The UI's node projection, post-#734: option nodes carry `interventions`. */
  const uiNode = (
    id: string,
    kind: string,
    label: string,
    extra: Record<string, unknown> = {},
  ) => ({ id, type: kind, kind, label, ...extra });

  const deployedUiGraph = (configured: boolean) => ({
    nodes: [
      uiNode("goal", "goal", "Increase revenue"),
      uiNode("decision", "decision", "Pricing"),
      uiNode("fac_price", "factor", "Price", { observed_state: { value: 0.5 } }),
      uiNode("opt_a", "option", "Premium", configured ? { interventions: { fac_price: 0.9 } } : {}),
      uiNode("opt_c", "option", "Value", configured ? { interventions: { fac_price: 0.4 } } : {}),
    ],
    edges: [
      uiEdge("e1", "decision", "opt_a"),
      uiEdge("e5", "decision", "opt_c"),
      uiEdge("e3", "opt_a", "fac_price"),
      uiEdge("e6", "opt_c", "fac_price"),
      uiEdge("e7", "fac_price", "goal"),
    ],
  });

  it("ADMITS a configured model sent in the deployed UI's own payload shape", () => {
    const verdict = assessRouteAdmission(deployedUiGraph(true));

    expect(verdict.can_run_analysis).toBe(true);
    expect(verdict.readiness_issues).toEqual([]);
    expect(verdict.options_ready).toBe(2);
  });

  it("still REFUSES the same payload shape when the options are genuinely unconfigured", () => {
    const verdict = assessRouteAdmission(deployedUiGraph(false));

    expect(verdict.can_run_analysis).toBe(false);
    // Named by identity, so the affordance can act on it.
    expect(verdict.readiness_issues.some((i) => i.option_id === "opt_a")).toBe(true);
    expect(verdict.readiness_issues.some((i) => i.option_id === "opt_c")).toBe(true);
  });
});
