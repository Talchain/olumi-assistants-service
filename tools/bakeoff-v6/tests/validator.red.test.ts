/**
 * RED-first: the GraphV3 seam must reject violations before it is trusted.
 * The validator is the REAL src/schemas/cee-v3.ts import — never a local fork.
 */
import { describe, expect, it } from "vitest";
import { validateCandidate } from "../src/validate/validator.ts";
import { makeValidCandidate, mkEdge } from "./helpers.ts";

describe("GraphV3 seam (real CEEGraphResponseV3)", () => {
  it("accepts a minimal valid draft-graph candidate", () => {
    const result = validateCandidate(makeValidCandidate());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an empty object (invalid graph shape)", () => {
    const result = validateCandidate({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects null / non-object candidates", () => {
    expect(validateCandidate(null).valid).toBe(false);
    expect(validateCandidate("graph").valid).toBe(false);
  });

  it("rejects a candidate missing required fields (goal_node_id, options)", () => {
    const candidate = makeValidCandidate();
    delete candidate.goal_node_id;
    delete candidate.options;
    const result = validateCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("goal_node_id");
  });

  it("rejects an unknown node kind (e.g. 'assumption' is NOT a GraphV3 kind)", () => {
    const candidate = makeValidCandidate();
    (candidate.nodes as unknown[]).push({ id: "ass_1", kind: "assumption", label: "An assumption" });
    expect(validateCandidate(candidate).valid).toBe(false);
  });

  it("rejects an edge missing the nested strength shape", () => {
    const candidate = makeValidCandidate();
    (candidate.edges as unknown[]).push({ from: "goal_1", to: "dec_1", exists_probability: 0.5, effect_direction: "positive" });
    expect(validateCandidate(candidate).valid).toBe(false);
  });

  it("rejects strength.std <= 0 and exists_probability out of range", () => {
    const bad1 = makeValidCandidate();
    (bad1.edges as Record<string, unknown>[])[0].strength = { mean: 0.5, std: 0 };
    expect(validateCandidate(bad1).valid).toBe(false);

    const bad2 = makeValidCandidate();
    (bad2.edges as Record<string, unknown>[])[0].exists_probability = 1.7;
    expect(validateCandidate(bad2).valid).toBe(false);
  });

  it("rejects a wrong schema_version literal", () => {
    const candidate = makeValidCandidate();
    candidate.schema_version = "2.0";
    expect(validateCandidate(candidate).valid).toBe(false);
  });

  it("rejects invalid node id characters (canonical id regex)", () => {
    const candidate = makeValidCandidate();
    (candidate.nodes as unknown[]).push({ id: "Bad ID!", kind: "factor", label: "Bad id" });
    (candidate.edges as unknown[]).push(mkEdge("goal_1", "goal_1"));
    expect(validateCandidate(candidate).valid).toBe(false);
  });
});
