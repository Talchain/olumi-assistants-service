/**
 * Edge Identity Stability Tests
 *
 * Verifies dual-key stash creation and restoration, including
 * survival through goal merge (nodeRenames reversal).
 * Uses Record objects (not Maps) so Object.freeze() prevents mutation.
 */

import { describe, it, expect } from "vitest";
import {
  createEdgeFieldStash,
  restoreEdgeFields,
} from "../../src/cee/unified-pipeline/edge-identity.js";

describe("createEdgeFieldStash", () => {
  it("stashes V4 fields by edge.id and from::to", () => {
    const edges = [
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "hypothesis" },
        provenance_source: "hypothesis",
      },
      {
        id: "e2",
        from: "out_1",
        to: "goal_1",
        strength_mean: 0.5,
        effect_direction: "negative",
      },
    ];

    const stash = createEdgeFieldStash(edges);

    // Edge e1: all 6 V4 fields
    expect(stash.byEdgeId["e1"]).toEqual({
      strength_mean: 0.7,
      strength_std: 0.1,
      belief_exists: 0.9,
      effect_direction: "positive",
      provenance: { source: "hypothesis" },
      provenance_source: "hypothesis",
    });
    expect(stash.byFromTo["fac_1::out_1"]).toEqual(stash.byEdgeId["e1"]);

    // Edge e2: only 2 V4 fields
    expect(stash.byEdgeId["e2"]).toEqual({
      strength_mean: 0.5,
      effect_direction: "negative",
    });
    expect(stash.byFromTo["out_1::goal_1"]).toEqual(stash.byEdgeId["e2"]);
  });

  it("skips edges with no V4 fields", () => {
    const edges = [
      { id: "e1", from: "a", to: "b" },
    ];
    const stash = createEdgeFieldStash(edges);
    expect(Object.keys(stash.byEdgeId)).toHaveLength(0);
    expect(Object.keys(stash.byFromTo)).toHaveLength(0);
  });

  it("handles empty/null input gracefully", () => {
    expect(createEdgeFieldStash([])).toEqual({
      byEdgeId: {},
      byFromTo: {},
    });
    expect(createEdgeFieldStash(null as any)).toEqual({
      byEdgeId: {},
      byFromTo: {},
    });
  });

  it("frozen stash prevents property assignment", () => {
    const stash = createEdgeFieldStash([
      { id: "e1", from: "a", to: "b", strength_mean: 0.5 },
    ]);
    Object.freeze(stash.byEdgeId);
    Object.freeze(stash.byFromTo);

    expect(Object.isFrozen(stash.byEdgeId)).toBe(true);
    expect(Object.isFrozen(stash.byFromTo)).toBe(true);

    // Assignment to a frozen Record throws in strict mode
    expect(() => {
      (stash.byEdgeId as any)["e2"] = { strength_mean: 0.9 };
    }).toThrow();
    expect(() => {
      (stash.byFromTo as any)["c::d"] = { strength_mean: 0.9 };
    }).toThrow();
  });
});

describe("restoreEdgeFields", () => {
  it("restores stripped V4 fields using edge.id", () => {
    const stash = createEdgeFieldStash([
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "hypothesis" },
        provenance_source: "hypothesis",
      },
    ]);

    // After PLoT validation: edge.id preserved, V4 fields stripped
    const strippedEdges = [
      { id: "e1", from: "fac_1", to: "out_1" },
    ];

    const { edges, restoredCount } = restoreEdgeFields(strippedEdges, stash, new Map());

    expect(restoredCount).toBe(1);
    expect(edges[0]).toMatchObject({
      id: "e1",
      from: "fac_1",
      to: "out_1",
      strength_mean: 0.7,
      strength_std: 0.1,
      belief_exists: 0.9,
      effect_direction: "positive",
      provenance: { source: "hypothesis" },
      provenance_source: "hypothesis",
    });
  });

  it("restores using from::to fallback when edge.id missing", () => {
    const stash = createEdgeFieldStash([
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
      },
    ]);

    // Edge without id but same from::to
    const strippedEdges = [
      { from: "fac_1", to: "out_1" },
    ];

    const { edges, restoredCount } = restoreEdgeFields(strippedEdges, stash, new Map());

    expect(restoredCount).toBe(1);
    expect(edges[0]).toMatchObject({
      from: "fac_1",
      to: "out_1",
      strength_mean: 0.7,
    });
  });

  it("restores after goal merge using nodeRenames reversal", () => {
    // Before goal merge: edge from risk_1 → goal_2
    const stash = createEdgeFieldStash([
      {
        id: "e1",
        from: "risk_1",
        to: "goal_2",
        strength_mean: -0.6,
        strength_std: 0.2,
        belief_exists: 0.8,
        effect_direction: "negative",
      },
    ]);

    // After goal merge: goal_2 redirected to goal_1 (primary)
    // edge.id is now different (enforceStableEdgeIds changed it)
    const postMergeEdges = [
      { id: "risk_1->goal_1", from: "risk_1", to: "goal_1" },
    ];

    // nodeRenames: goal_2 was merged into goal_1
    const nodeRenames = new Map([["goal_2", "goal_1"]]);

    const { edges, restoredCount } = restoreEdgeFields(postMergeEdges, stash, nodeRenames);

    expect(restoredCount).toBe(1);
    expect(edges[0]).toMatchObject({
      id: "risk_1->goal_1",
      from: "risk_1",
      to: "goal_1",
      strength_mean: -0.6,
      strength_std: 0.2,
      belief_exists: 0.8,
      effect_direction: "negative",
    });
  });

  it("no-op when all V4 fields already present", () => {
    const stash = createEdgeFieldStash([
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "hypothesis" },
        provenance_source: "hypothesis",
      },
    ]);

    // Edge already has all fields
    const edgesWithFields = [
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "hypothesis" },
        provenance_source: "hypothesis",
      },
    ];

    const { edges, restoredCount } = restoreEdgeFields(edgesWithFields, stash, new Map());

    expect(restoredCount).toBe(0);
    expect(edges[0]).toEqual(edgesWithFields[0]);
  });

  it("does not overwrite existing values", () => {
    const stash = createEdgeFieldStash([
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        effect_direction: "positive",
      },
    ]);

    // Edge already has strength_mean but not effect_direction
    const edges = [
      {
        id: "e1",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.99, // different from stash — should NOT be overwritten
      },
    ];

    const { edges: result, restoredCount } = restoreEdgeFields(edges, stash, new Map());

    expect(restoredCount).toBe(1); // effect_direction was restored
    expect(result[0].strength_mean).toBe(0.99); // kept existing value
    expect((result[0] as any).effect_direction).toBe("positive"); // restored from stash
  });

  it("handles multiple nodeRenames for complex goal merge", () => {
    // Before: edges to goal_2 and goal_3, both merged into goal_1
    const stash = createEdgeFieldStash([
      { from: "risk_1", to: "goal_2", strength_mean: -0.3 },
      { from: "out_1", to: "goal_3", strength_mean: 0.8 },
    ]);

    // After merge: both redirected to goal_1
    const postMergeEdges = [
      { from: "risk_1", to: "goal_1" },
      { from: "out_1", to: "goal_1" },
    ];

    const nodeRenames = new Map([
      ["goal_2", "goal_1"],
      ["goal_3", "goal_1"],
    ]);

    const { edges, restoredCount } = restoreEdgeFields(postMergeEdges, stash, nodeRenames);

    expect(restoredCount).toBe(2);
    expect((edges[0] as any).strength_mean).toBe(-0.3);
    expect((edges[1] as any).strength_mean).toBe(0.8);
  });
});
