/**
 * Strength-clustering detection — the two questions, and the arithmetic that
 * decides them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `detectStrengthClustering` shipped taking the variance of the SIGNED strengths
 * around the mean of the ABSOLUTE strengths. `normaliseRiskCoefficients` forces
 * every risk→goal / risk→outcome edge negative in Stage 2 (normalise), 500 lines
 * before Stage 5 (package) measures the spread — so every graph containing a
 * risk edge got a hugely inflated coefficient of variation and the detector
 * could not fire. Measured over a 21-artefact corpus spanning ~9 scenarios, the
 * shipped arithmetic returns CV 0.954–1.669 and NEVER once goes below its 0.3
 * threshold.
 *
 * These tests bind to the two questions the detectors answer, by IDENTITY
 * (warning id, and the specific edge population), never by a value predicate a
 * different population could satisfy.
 */

import { describe, it, expect } from "vitest";
import {
  detectStrengthClustering,
  detectGoalLayerStrengthClustering,
} from "../../src/cee/structure/index.js";
import founderGraph from "../fixtures/founder-session-7826c742.graph.json" with { type: "json" };

/** A graph whose goal layer is flat while its interior varies — the founder shape. */
function flatGoalLayerGraph() {
  return {
    nodes: [
      { id: "g1", kind: "goal" },
      { id: "o1", kind: "outcome" },
      { id: "o2", kind: "outcome" },
      { id: "r1", kind: "risk" },
      { id: "f1", kind: "factor" },
      { id: "f2", kind: "factor" },
    ],
    edges: [
      // interior — genuinely differentiated
      { id: "i1", from: "f1", to: "o1", strength_mean: 0.2 },
      { id: "i2", from: "f2", to: "o2", strength_mean: 0.75 },
      { id: "i3", from: "f1", to: "r1", strength_mean: 0.4 },
      // goal layer — every magnitude identical, risks signed negative by Stage 2
      { id: "g_o1", from: "o1", to: "g1", strength_mean: 0.5 },
      { id: "g_o2", from: "o2", to: "g1", strength_mean: 0.5 },
      { id: "g_r1", from: "r1", to: "g1", strength_mean: -0.5 },
    ],
  };
}

describe("detectStrengthClustering — 'did the model differentiate its causal weights at all?'", () => {
  it("fires on a perfectly flat sign-mixed layer (the shipped arithmetic could not)", () => {
    // The founder session's goal layer, standalone: three risks and two outcomes,
    // every magnitude exactly 0.5. True magnitude CV 0.000.
    const graph = {
      nodes: [
        { id: "g1", kind: "goal" },
        { id: "o1", kind: "outcome" },
        { id: "o2", kind: "outcome" },
        { id: "r1", kind: "risk" },
        { id: "r2", kind: "risk" },
        { id: "r3", kind: "risk" },
      ],
      edges: [
        { id: "e1", from: "o1", to: "g1", strength_mean: 0.5 },
        { id: "e2", from: "o2", to: "g1", strength_mean: 0.5 },
        { id: "e3", from: "r1", to: "g1", strength_mean: -0.5 },
        { id: "e4", from: "r2", to: "g1", strength_mean: -0.5 },
        { id: "e5", from: "r3", to: "g1", strength_mean: -0.5 },
      ],
    };
    const result = detectStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(5);
    expect(result.coefficientOfVariation).toBeCloseTo(0, 6);
    expect(result.detected).toBe(true);
    expect(result.warning?.id).toBe("strength_clustering");
    // Bind to the population, not just to the verdict: every edge is named.
    expect(result.warning?.affected_edge_ids).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("stays silent on a sign-mixed layer that is genuinely differentiated", () => {
    // DISCRIMINATING TWIN of the case above: identical signs and node kinds,
    // magnitudes varied. If the fix merely made the detector fire always, this REDs.
    const graph = {
      nodes: [
        { id: "g1", kind: "goal" },
        { id: "o1", kind: "outcome" },
        { id: "o2", kind: "outcome" },
        { id: "r1", kind: "risk" },
        { id: "r2", kind: "risk" },
        { id: "r3", kind: "risk" },
      ],
      edges: [
        { id: "e1", from: "o1", to: "g1", strength_mean: 0.9 },
        { id: "e2", from: "o2", to: "g1", strength_mean: 0.2 },
        { id: "e3", from: "r1", to: "g1", strength_mean: -0.75 },
        { id: "e4", from: "r2", to: "g1", strength_mean: -0.15 },
        { id: "e5", from: "r3", to: "g1", strength_mean: -0.45 },
      ],
    };
    const result = detectStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(5);
    expect(result.coefficientOfVariation).toBeGreaterThan(0.3);
    expect(result.detected).toBe(false);
  });

  it("measures dispersion of MAGNITUDE, so sign alone never inflates the CV", () => {
    // Same magnitudes, opposite sign patterns. The question is "did the model
    // differentiate how MUCH each thing matters"; direction is a separate
    // semantic, carried by effect_direction. Both must read identically.
    const mk = (signs: number[]) => ({
      nodes: [
        { id: "g1", kind: "goal" },
        { id: "a", kind: "outcome" },
        { id: "b", kind: "outcome" },
        { id: "c", kind: "outcome" },
      ],
      edges: [0, 1, 2].map((i) => ({
        id: `e${i}`,
        from: ["a", "b", "c"][i],
        to: "g1",
        strength_mean: signs[i] * [0.2, 0.5, 0.8][i],
      })),
    });
    const allPositive = detectStrengthClustering(mk([1, 1, 1]) as any);
    const mixed = detectStrengthClustering(mk([1, -1, -1]) as any);
    expect(mixed.coefficientOfVariation).toBeCloseTo(allPositive.coefficientOfVariation, 12);
    expect(mixed.detected).toBe(allPositive.detected);
  });

  it("still excludes structural edges from the population", () => {
    // decision→option and option→factor are canonical wiring at 1.0/0.01, not
    // beliefs. Including them would swamp the causal signal.
    const graph = {
      nodes: [
        { id: "d1", kind: "decision" },
        { id: "op1", kind: "option" },
        { id: "f1", kind: "factor" },
        { id: "g1", kind: "goal" },
        { id: "o1", kind: "outcome" },
      ],
      edges: [
        { id: "s1", from: "d1", to: "op1", strength_mean: 1.0 },
        { id: "s2", from: "op1", to: "f1", strength_mean: 1.0 },
        { id: "c1", from: "f1", to: "o1", strength_mean: 0.5 },
        { id: "c2", from: "o1", to: "g1", strength_mean: 0.5 },
      ],
    };
    const result = detectStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(2);
    expect(result.warning?.affected_edge_ids).toEqual(["c1", "c2"]);
  });
});

describe("detectGoalLayerStrengthClustering — 'does the model hold a differentiated belief about what matters to the goal?'", () => {
  it("fires on a flat goal layer that the whole-graph detector cannot see", () => {
    const graph = flatGoalLayerGraph();

    // The whole-graph question is answered NO — correctly. The interior varies,
    // so the graph as a whole is differentiated.
    const wholeGraph = detectStrengthClustering(graph as any);
    expect(wholeGraph.detected).toBe(false);

    // The goal-layer question is answered YES. This is the pathology the founder
    // session exhibited and neither shipped detector could express.
    const goalLayer = detectGoalLayerStrengthClustering(graph as any);
    expect(goalLayer.edgeCount).toBe(3);
    expect(goalLayer.coefficientOfVariation).toBeCloseTo(0, 6);
    expect(goalLayer.detected).toBe(true);
    expect(goalLayer.warning?.id).toBe("goal_layer_strength_clustering");
    // IDENTITY binding: exactly the three edges INTO the goal, no interior edge.
    expect(goalLayer.warning?.affected_edge_ids).toEqual(["g_o1", "g_o2", "g_r1"]);
  });

  it("stays silent when the goal layer is differentiated but the interior is flat", () => {
    // DISCRIMINATING TWIN: the mirror image of the case above. Proves the
    // detector is bound to the goal population and not merely to "some flatness
    // somewhere in the graph".
    const graph = flatGoalLayerGraph();
    graph.edges = [
      { id: "i1", from: "f1", to: "o1", strength_mean: 0.5 },
      { id: "i2", from: "f2", to: "o2", strength_mean: 0.5 },
      { id: "i3", from: "f1", to: "r1", strength_mean: 0.5 },
      { id: "g_o1", from: "o1", to: "g1", strength_mean: 0.9 },
      { id: "g_o2", from: "o2", to: "g1", strength_mean: 0.2 },
      { id: "g_r1", from: "r1", to: "g1", strength_mean: -0.45 },
    ];
    const goalLayer = detectGoalLayerStrengthClustering(graph as any);
    expect(goalLayer.edgeCount).toBe(3);
    expect(goalLayer.coefficientOfVariation).toBeGreaterThan(0.15);
    expect(goalLayer.detected).toBe(false);
  });

  it("returns no verdict when there is no goal node", () => {
    const graph = {
      nodes: [
        { id: "f1", kind: "factor" },
        { id: "o1", kind: "outcome" },
        { id: "o2", kind: "outcome" },
      ],
      edges: [
        { id: "e1", from: "f1", to: "o1", strength_mean: 0.5 },
        { id: "e2", from: "f1", to: "o2", strength_mean: 0.5 },
      ],
    };
    const result = detectGoalLayerStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(0);
    expect(result.detected).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it("returns no verdict on a single goal edge — dispersion of one number is not a fact", () => {
    const graph = {
      nodes: [
        { id: "g1", kind: "goal" },
        { id: "o1", kind: "outcome" },
        { id: "f1", kind: "factor" },
      ],
      edges: [
        { id: "e1", from: "f1", to: "o1", strength_mean: 0.5 },
        { id: "g_o1", from: "o1", to: "g1", strength_mean: 0.5 },
      ],
    };
    const result = detectGoalLayerStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(1);
    expect(result.detected).toBe(false);
  });

  it("excludes structural edges from the goal population", () => {
    // An option→factor edge at canonical 1.0 must never enter the goal layer,
    // and a decision→option edge must never be mistaken for a belief about the goal.
    const graph = {
      nodes: [
        { id: "g1", kind: "goal" },
        { id: "d1", kind: "decision" },
        { id: "op1", kind: "option" },
        { id: "o1", kind: "outcome" },
        { id: "o2", kind: "outcome" },
      ],
      edges: [
        { id: "s1", from: "d1", to: "op1", strength_mean: 1.0 },
        { id: "g_o1", from: "o1", to: "g1", strength_mean: 0.5 },
        { id: "g_o2", from: "o2", to: "g1", strength_mean: 0.5 },
      ],
    };
    const result = detectGoalLayerStrengthClustering(graph as any);
    expect(result.edgeCount).toBe(2);
    expect(result.warning?.affected_edge_ids).toEqual(["g_o1", "g_o2"]);
  });
});

describe("the founder's session (scenario 7826c742) — the graph that shipped a 62%/38% over a flat goal layer", () => {
  it("goal layer: every magnitude identical, CV 0.000, detector fires", () => {
    const result = detectGoalLayerStrengthClustering(founderGraph as any);
    // Five outcome/risk → goal edges, all at magnitude 0.5.
    expect(result.edgeCount).toBe(5);
    expect(result.coefficientOfVariation).toBeCloseTo(0, 6);
    expect(result.detected).toBe(true);
    expect(result.warning?.id).toBe("goal_layer_strength_clustering");
  });

  it("whole graph: CV 0.229 on magnitudes — the shipped arithmetic read 0.977", () => {
    const result = detectStrengthClustering(founderGraph as any);
    expect(result.edgeCount).toBe(15);
    // Measured over the fixture: magnitude CV 0.229. The shipped code returned
    // 0.977 for the identical input, which is why nothing fired.
    expect(result.coefficientOfVariation).toBeCloseTo(0.229, 3);
    expect(result.detected).toBe(true);
  });
});

describe("the goal-layer threshold, pinned to the corpus gap it was derived from", () => {
  /**
   * 0.15 was not chosen; it is the midpoint of the widest empirical gap in a
   * 21-artefact corpus spanning ~9 scenarios. Goal-layer magnitude CV is 0.000
   * for five artefacts and 0.091 for one, then jumps to 0.221 and above for the
   * fifteen that are genuinely differentiated.
   *
   * These two cases are the real artefacts on either side of that gap. They pin
   * the constant INTO the gap: move the threshold out of (0.091, 0.221] in
   * either direction and one of them REDs. Without this pair the constant is
   * unguarded and the next tidy-up can round it anywhere.
   */
  const goalLayer = (signed: number[]) => ({
    nodes: [
      { id: "g1", kind: "goal" },
      ...signed.map((_, i) => ({ id: `n${i}`, kind: i % 2 ? "risk" : "outcome" })),
    ],
    edges: signed.map((v, i) => ({ id: `e${i}`, from: `n${i}`, to: "g1", strength_mean: v })),
  });

  it("FIRES on the near-flat band measured in b2_10 (CV 0.091)", () => {
    // Real goal layer: magnitudes 0.50 / 0.40 / 0.45 across the three edges that
    // decide the answer. Barely a belief.
    const result = detectGoalLayerStrengthClustering(goalLayer([0.5, -0.4, -0.45]) as any);
    expect(result.coefficientOfVariation).toBeCloseTo(0.091, 3);
    expect(result.detected).toBe(true);
  });

  it("STAYS SILENT on the least-dispersed layer that is genuinely differentiated (CV 0.221)", () => {
    // Real goal layer from live-draft-1-eu-expansion: 0.55 / 0.35 / 0.40 / 0.50 / 0.30.
    const result = detectGoalLayerStrengthClustering(
      goalLayer([0.55, 0.35, -0.4, -0.5, -0.3]) as any,
    );
    expect(result.coefficientOfVariation).toBeCloseTo(0.221, 3);
    expect(result.detected).toBe(false);
  });
});
