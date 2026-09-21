/**
 * ROADMAP 2.146 — `projectGraphForStagedFrame` strips the validation pipeline's
 * two wire keys, for every negotiated schema version.
 *
 * Why this is a separate suite from the pipeline-ordering one: those are two
 * different claims. The ordering suite proves the await moved; this proves the
 * GRAPH_READY frame's "structure only" claim survives the move BY CONSTRUCTION
 * rather than by winning a race against a fast Pass 2.
 *
 * Every absence assertion below is preceded by a POSITIVE CONTROL that the
 * corresponding presence is real (trap 13) — for v3 that control is load-bearing,
 * because `transformEdgeToV3` explicitly preserves `validation` (schema-v3.ts),
 * so without the strip the key genuinely WOULD be on the frame.
 */

import { describe, it, expect } from "vitest";

import { projectGraphForStagedFrame } from "../../src/cee/unified-pipeline/staged-graph-projection.js";
import { transformGraphToV3 } from "../../src/cee/transforms/schema-v3.js";
import {
  VALIDATION_EDGE_METADATA_KEY,
  VALIDATION_GRAPH_SUMMARY_KEY,
} from "../../src/cee/validation-pipeline/types.js";

const PROSE = "PASS2_PROSE_MARKER — independent reviewer narrative that must not ride this frame.";

const metadata = {
  status: "contested",
  contested_reasons: ["sign_flip"],
  pass1: { strength_mean: 0.6, strength_std: 0.1, exists_probability: 0.8 },
  pass2: { strength_mean: -0.2, strength_std: 0.2, exists_probability: 0.6, reasoning: PROSE, basis: "domain_prior" },
  max_divergence: 0.8,
};

function graphWithValidation() {
  return {
    nodes: [
      { id: "g1", kind: "goal", label: "Decide X" },
      { id: "f1", kind: "factor", label: "Cost", category: "controllable" },
    ],
    edges: [
      {
        from: "f1",
        to: "g1",
        strength_mean: 0.6,
        strength_std: 0.1,
        belief_exists: 0.8,
        [VALIDATION_EDGE_METADATA_KEY]: metadata,
      },
    ],
    [VALIDATION_GRAPH_SUMMARY_KEY]: { contested_count: 1, total_edges_validated: 1 },
  } as any;
}

function edgesOf(projected: unknown): Array<Record<string, unknown>> {
  const g = projected as { edges?: unknown };
  expect(Array.isArray(g.edges)).toBe(true);
  return g.edges as Array<Record<string, unknown>>;
}

describe("projectGraphForStagedFrame — validation-metadata strip (2.146)", () => {
  it("POSITIVE CONTROL: the v3 transform preserves edge.validation, so there IS something to strip", () => {
    // If this ever stops being true the strip becomes vacuous and every
    // assertion below starts passing for the wrong reason. That is exactly the
    // failure mode a control exists to catch.
    const transformed = transformGraphToV3(graphWithValidation()).graph as any;
    expect(transformed.edges[0][VALIDATION_EDGE_METADATA_KEY]).toEqual(metadata);
  });

  for (const schemaVersion of ["v1", "v2", "v3"] as const) {
    it(`strips edge.validation and graph.validation_summary (${schemaVersion})`, () => {
      const projected = projectGraphForStagedFrame(graphWithValidation(), schemaVersion, "req-1");

      for (const edge of edgesOf(projected)) {
        expect(edge).not.toHaveProperty(VALIDATION_EDGE_METADATA_KEY);
      }
      expect(projected as Record<string, unknown>).not.toHaveProperty(
        VALIDATION_GRAPH_SUMMARY_KEY,
      );
      // Byte-level: no reviewer prose anywhere under any key name.
      expect(JSON.stringify(projected)).not.toContain("PASS2_PROSE_MARKER");
    });

    it(`preserves node/edge identity while stripping (${schemaVersion})`, () => {
      // The strip must not become a second, quieter way to break the identity
      // guarantee this module exists to provide.
      const projected = projectGraphForStagedFrame(graphWithValidation(), schemaVersion, "req-1") as any;
      expect(projected.nodes.map((n: any) => n.id)).toEqual(["g1", "f1"]);
      const edge = edgesOf(projected)[0];
      expect(edge.from).toBe("f1");
      expect(edge.to).toBe("g1");
    });
  }

  it("does NOT mutate the graph it was handed", () => {
    // ctx.graph is the live pipeline graph and Stage 5 (Package) is the
    // metadata's real consumer. A delete here would destroy the payload the
    // whole flip exists to deliver.
    const graph = graphWithValidation();
    projectGraphForStagedFrame(graph, "v3", "req-1");
    expect(graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toEqual(metadata);
    expect(graph[VALIDATION_GRAPH_SUMMARY_KEY]).toBeDefined();
  });

  it("is a no-op for a graph that never carried validation metadata", () => {
    // Flag-off / pre-flip behaviour must be untouched: same keys, same values.
    const plain = {
      nodes: [{ id: "g1", kind: "goal", label: "Decide X" }],
      edges: [{ from: "g1", to: "g1", strength_mean: 0.5 }],
    } as any;
    const before = JSON.stringify(projectGraphForStagedFrame(structuredClone(plain), "v3", "r"));
    const after = JSON.stringify(projectGraphForStagedFrame(structuredClone(plain), "v3", "r"));
    expect(before).toBe(after);
    expect(before).not.toContain(VALIDATION_EDGE_METADATA_KEY);
  });

  it("stays total: undefined / non-object graphs pass through without throwing", () => {
    expect(projectGraphForStagedFrame(undefined, "v3", "r")).toBeUndefined();
    // A malformed graph must degrade, never throw — the frame is optional, the
    // draft is not.
    expect(() => projectGraphForStagedFrame({ nodes: null, edges: null } as any, "v1", "r")).not.toThrow();
  });
});
