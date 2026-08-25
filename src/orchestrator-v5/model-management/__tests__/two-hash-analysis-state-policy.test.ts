import { describe, expect, it } from "vitest";
import type { RunAnalysisHandlerFact } from "@talchain/schemas/orchestrator";

import {
  computeAnalysisAffectingGraphHash,
} from "../../context/graph-hash.js";
import { computeGraphIdentityHash } from "../../context/graph-identity.js";
import { deriveAnalysisFreshness } from "../../context/freshness.js";
import { decideModelVersionCreation } from "../version-creation-policy.js";

const SCENARIO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * The fixture graph's shape, declared rather than inferred.
 *
 * Declared because the tests below MUTATE the clone (`provenance`, `position`,
 * `strength.mean`) and an inferred type freezes each field at the exact shape
 * the literal happens to spell — so adding `evidence_id` to a provenance object
 * reads as an excess property against `{ source: string }`, even though the
 * ingress schema is `.passthrough()` at both the node and the edge level and
 * carries any such field through. Kept as a `type` alias (not an interface) so
 * it retains the implicit index signature that makes it assignable to the
 * passthrough `GraphStateIngress` the hash modules take: the helpers below
 * therefore pass the fixture at its real type instead of laundering it through
 * `unknown`.
 */
type TestProvenance = { source: string; evidence_id?: string };
type TestNode = {
  id: string;
  kind: string;
  label: string;
  observed_state?: { value: number; unit?: string };
  provenance?: TestProvenance;
  position?: { x: number; y: number };
};
type TestEdge = {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  effect_direction: string;
};
type TestGraph = { nodes: TestNode[]; edges: TestEdge[] };

const BASE: TestGraph = {
  nodes: [
    {
      id: "factor-a",
      kind: "factor",
      label: "Demand",
      observed_state: { value: 10, unit: "%" },
      provenance: { source: "brief" },
      position: { x: 10, y: 20 },
    },
    { id: "goal-a", kind: "goal", label: "Growth" },
  ],
  edges: [
    {
      from: "factor-a",
      to: "goal-a",
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
  ],
};

function fullHash(graph: TestGraph): string {
  return computeGraphIdentityHash(graph)!.value;
}

function analysisHash(graph: TestGraph): string {
  return computeAnalysisAffectingGraphHash(graph)!;
}

function fact(hash: string, computedAt = "2026-08-24T10:00:00.000Z"):
  RunAnalysisHandlerFact {
  return {
    fact_type: "run_analysis",
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: "option-a",
      summary: "Analysis complete.",
      graph_hash_at_run: hash,
      computed_at: computedAt,
      enrichment: { analysis_status: "computed" },
    },
  };
}

describe("two-hash version policy and AnalysisState dependency", () => {
  it("layout: full identity moves, analysis identity stays, no version and current analysis", () => {
    const changed = structuredClone(BASE);
    changed.nodes[0]!.position = { x: 900, y: 1200 };
    const beforeAnalysis = analysisHash(BASE);
    const afterAnalysis = analysisHash(changed);

    expect(fullHash(changed)).not.toBe(fullHash(BASE));
    expect(afterAnalysis).toBe(beforeAnalysis);
    expect(decideModelVersionCreation(BASE, changed)).toEqual({
      create: false,
      reason: "presentation_only",
    });
    expect(deriveAnalysisFreshness([fact(beforeAnalysis)], afterAnalysis)).toMatchObject({
      freshness: "fresh",
      reason: "graph_hash_match",
    });
  });

  it("evidence/provenance: full identity moves, analysis identity stays, version and current analysis", () => {
    const changed = structuredClone(BASE);
    changed.nodes[0]!.provenance = {
      source: "customer_interview",
      evidence_id: "evidence-9",
    };
    const beforeAnalysis = analysisHash(BASE);
    const afterAnalysis = analysisHash(changed);

    expect(fullHash(changed)).not.toBe(fullHash(BASE));
    expect(afterAnalysis).toBe(beforeAnalysis);
    expect(decideModelVersionCreation(BASE, changed)).toEqual({
      create: true,
      reason: "semantic_change",
    });
    expect(deriveAnalysisFreshness([fact(beforeAnalysis)], afterAnalysis)).toMatchObject({
      freshness: "fresh",
      reason: "graph_hash_match",
    });
  });

  it("edge strength: both identities move, version and stale analysis", () => {
    const changed = structuredClone(BASE);
    changed.edges[0]!.strength.mean = 0.8;
    const beforeAnalysis = analysisHash(BASE);
    const afterAnalysis = analysisHash(changed);

    expect(fullHash(changed)).not.toBe(fullHash(BASE));
    expect(afterAnalysis).not.toBe(beforeAnalysis);
    expect(decideModelVersionCreation(BASE, changed)).toEqual({
      create: true,
      reason: "semantic_change",
    });
    expect(deriveAnalysisFreshness([fact(beforeAnalysis)], afterAnalysis)).toMatchObject({
      freshness: "stale",
      reason: "graph_hash_diverged",
    });
  });

  it("A -> analyse -> B -> restore A stays stale until a newer rerun", () => {
    const hashA = analysisHash(BASE);
    const oldAnalysis = fact(hashA, "2026-08-24T10:00:00.000Z");
    const marker = "2026-08-24T10:05:00.000Z";

    expect(
      deriveAnalysisFreshness([oldAnalysis], hashA, undefined, {
        analysisInvalidatedAt: marker,
      })
    ).toMatchObject({
      freshness: "stale",
      reason: "model_restored_after_analysis",
    });

    const rerun = fact(hashA, "2026-08-24T10:06:00.000Z");
    expect(
      deriveAnalysisFreshness([oldAnalysis, rerun], hashA, undefined, {
        analysisInvalidatedAt: marker,
      })
    ).toMatchObject({ freshness: "fresh", reason: "graph_hash_match" });
  });
});
