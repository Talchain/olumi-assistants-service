import { describe, expect, it } from "vitest";

import { decideModelVersionCreation } from "../version-creation-policy.js";

/**
 * The fixture graph's shape, declared rather than inferred.
 *
 * Declared because the tests below MUTATE the clone, and an inferred type
 * freezes each field at the exact shape the literal happens to spell — so
 * adding `evidence_id` to a provenance object reads as an excess property
 * against `{ source: string }`, even though the ingress node schema is
 * `.passthrough()` and carries any such field through to the identity
 * projection (which is precisely what the evidence/provenance case asserts).
 */
type TestNode = {
  id: string;
  kind: string;
  label: string;
  observed_state?: { value: number };
  provenance?: { source: string; evidence_id?: string };
  position?: { x: number; y: number };
  description?: string;
};
type TestGraph = { nodes: TestNode[]; edges: { from: string; to: string }[] };

const BASE: TestGraph = {
  nodes: [
    {
      id: "factor-price",
      kind: "factor",
      label: "Price",
      observed_state: { value: 10 },
      provenance: { source: "brief" },
      position: { x: 1, y: 2 },
    },
  ],
  edges: [],
};

describe("model-version creation policy", () => {
  it("no-op creates no version", () => {
    expect(decideModelVersionCreation(BASE, structuredClone(BASE))).toEqual({
      create: false,
      reason: "no_op",
    });
  });

  it("pure layout changes create no version", () => {
    const presentation = structuredClone(BASE);
    presentation.nodes[0]!.position = { x: 90, y: 120 };
    expect(decideModelVersionCreation(BASE, presentation)).toEqual({
      create: false,
      reason: "presentation_only",
    });
  });

  it("label/description changes create a semantic version", () => {
    const wording = structuredClone(BASE);
    wording.nodes[0]!.label = "Current list price";
    wording.nodes[0]!.description = "The price customers pay before discounts.";
    expect(decideModelVersionCreation(BASE, wording)).toEqual({
      create: true,
      reason: "semantic_change",
    });
  });

  it("evidence/provenance change creates a version even when analysis inputs are unchanged", () => {
    const evidence = structuredClone(BASE);
    evidence.nodes[0]!.provenance = {
      source: "customer interview",
      evidence_id: "ev-9",
    };
    expect(decideModelVersionCreation(BASE, evidence)).toEqual({
      create: true,
      reason: "semantic_change",
    });
  });
});
