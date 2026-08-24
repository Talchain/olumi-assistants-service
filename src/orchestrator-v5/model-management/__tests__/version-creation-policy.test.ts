import { describe, expect, it } from "vitest";

import { decideModelVersionCreation } from "../version-creation-policy.js";

const BASE = {
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
    const wording = structuredClone(BASE) as typeof BASE & {
      nodes: Array<(typeof BASE.nodes)[number] & { description?: string }>;
    };
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
