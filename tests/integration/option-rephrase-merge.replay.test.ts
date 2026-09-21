/**
 * FIXED-INPUT REPLAY of the witnessed defect.
 *
 * Input is transcribed from the banked capture
 *   olumi-docs/PHASE0-EVIDENCE-2026-07-28/first-use-acceptance-2026-08-14/
 *     run-2/draws/A_hiring-2/step-DRAFT.json
 * (option nodes, their labels, their edges and the brief, verbatim). This is the
 * draw in which Paul's own "two developers" and the model's "Hire Two Developers
 * Only" shipped as two ranked options.
 *
 * ⚠ THE THIRD OPTION IS THE POINT. "Hire One Developer Now, Defer Second" is a
 * genuinely distinct staged-hire alternative that must survive every run. A
 * version of this suite that only asserted the merge would pass while destroying
 * it (trap 22b — every case gets its opposite-direction twin).
 */
import { describe, it, expect } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { OPTION_REPHRASE_ABSORBED } from "../../src/cee/transforms/option-rephrase-merge.js";

/** Verbatim from the capture's request.message. */
const A_HIRING_BRIEF =
  "Should I hire a Tech lead or two developers to increase productivity?";

/** Labels verbatim from the capture's body.draft_graph.nodes. */
const USER_TWO_DEVS = "two developers";
const USER_TECH_LEAD = "hire a Tech lead";
const AI_REPHRASE = "Hire Two Developers Only";
const AI_REAL_ALTERNATIVE = "Hire One Developer Now, Defer Second";

function buildCaptureReplay(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      nodes: [
        { id: "goal_prod", kind: "goal", label: "Increase productivity" },
        { id: "decision", kind: "decision", label: "Hiring decision" },
        // Factor ids are the capture's own.
        { id: "2c2ae0b7", kind: "factor", label: "Delivery capacity" },
        { id: "124ec3bb", kind: "factor", label: "Payroll cost" },
        { id: "756a7698", kind: "factor", label: "Technical leadership" },
        { id: "outcome_ship", kind: "outcome", label: "Faster shipping" },
        // The four option nodes, in the capture's order.
        { id: "31997614", kind: "option", label: AI_REPHRASE },
        { id: "5445635a", kind: "option", label: AI_REAL_ALTERNATIVE },
        { id: "be215545", kind: "option", label: USER_TWO_DEVS },
        { id: "e70301eb", kind: "option", label: USER_TECH_LEAD },
      ],
      edges: [
        { from: "decision", to: "31997614", weight: 1, belief: 1 },
        { from: "decision", to: "5445635a", weight: 1, belief: 1 },
        { from: "decision", to: "be215545", weight: 1, belief: 1 },
        { from: "decision", to: "e70301eb", weight: 1, belief: 1 },
        // The capture's option→factor edges.
        { from: "31997614", to: "124ec3bb", weight: 1, belief: 1 },
        { from: "31997614", to: "2c2ae0b7", weight: 1, belief: 1 },
        { from: "5445635a", to: "124ec3bb", weight: 1, belief: 1 },
        { from: "5445635a", to: "2c2ae0b7", weight: 1, belief: 1 },
        { from: "be215545", to: "2c2ae0b7", weight: 1, belief: 1 },
        { from: "e70301eb", to: "756a7698", weight: 1, belief: 1 },
        { from: "2c2ae0b7", to: "outcome_ship", weight: 0.8, belief: 0.9 },
        { from: "124ec3bb", to: "outcome_ship", weight: 0.4, belief: 0.8 },
        { from: "756a7698", to: "outcome_ship", weight: 0.7, belief: 0.8 },
        { from: "outcome_ship", to: "goal_prod", weight: 1, belief: 1 },
      ],
      meta: { roots: ["decision"], leaves: ["goal_prod"], source: "assistant" },
    },
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: "replay-a-hiring-2", correlation_id: "replay" },
  } as V1DraftGraphResponse;
}

function labelsOf(v3: ReturnType<typeof transformResponseToV3>): string[] {
  return (v3.options ?? []).map((o) => o.label);
}

describe("A_hiring-2 replay — an AI rephrase may not become a second canonical option", () => {
  const v3 = transformResponseToV3(buildCaptureReplay(), {
    brief: A_HIRING_BRIEF,
    requestId: "replay-a-hiring-2",
  });

  it("PRECONDITION: the binder reads the user's two labels as brief-borne and the model's two as inferred", () => {
    // Pins the fixture's own discriminating power (trap 13b): if provenance ever
    // stops splitting these four, the merge assertions below would pass or fail
    // for reasons that have nothing to do with this module.
    const provenanceByLabel = new Map(
      v3.nodes.filter((n) => n.kind === "option").map((n) => [n.label, n.provenance]),
    );
    expect(provenanceByLabel.get(USER_TWO_DEVS)).toBe("from_brief");
    expect(provenanceByLabel.get(USER_TECH_LEAD)).toBe("from_brief");
    expect(provenanceByLabel.get(AI_REAL_ALTERNATIVE)).toBe("ai_inferred");
  });

  it("merges the rephrase: exactly ONE two-developers option survives, under the USER's label", () => {
    const labels = labelsOf(v3);
    expect(labels).toContain(USER_TWO_DEVS);
    expect(labels).not.toContain(AI_REPHRASE);
    // Bound by identity, not by a count another option could satisfy (trap 19).
    expect(labels.filter((l) => l === USER_TWO_DEVS)).toHaveLength(1);
  });

  it("keeps the user's option id and provenance canonical — absorption never re-authors", () => {
    const canonical = (v3.options ?? []).find((o) => o.label === USER_TWO_DEVS);
    expect(canonical).toBeDefined();
    expect(canonical!.id).toBe("be215545");
    expect(canonical!.provenance?.source).toBe("brief_extraction");
  });

  it("⭐ OPPOSITE-DIRECTION TWIN: the genuinely distinct staged-hire alternative SURVIVES", () => {
    const labels = labelsOf(v3);
    expect(labels).toContain(AI_REAL_ALTERNATIVE);
    expect(labels).toContain(USER_TECH_LEAD);
    // Four options in, three out: exactly one absorption, not a cull.
    expect(v3.options).toHaveLength(3);
  });

  it("removes the absorbed twin from the GRAPH too, with no dangling edges", () => {
    const nodeIds = new Set(v3.nodes.map((n) => n.id));
    expect(nodeIds.has("31997614")).toBe(false);
    for (const e of v3.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("preserves the model's phrasing on the canonical option — nothing silently lost", () => {
    const canonical = (v3.options ?? []).find((o) => o.label === USER_TWO_DEVS);
    expect(canonical!.description).toContain(AI_REPHRASE);
  });

  it("DISCLOSES the absorption, and OFFERS the twin's extra factor link without adopting it", () => {
    const warning = (v3.validation_warnings ?? []).find(
      (w) => w.code === OPTION_REPHRASE_ABSORBED,
    );
    expect(warning).toBeDefined();
    const details = warning!.details as Record<string, unknown>;
    expect(details.absorbed_label).toBe(AI_REPHRASE);
    expect(details.canonical_label).toBe(USER_TWO_DEVS);
    expect(details.adopted).toBe(false);
    // The twin linked to 124ec3bb (payroll cost); the user's option did not.
    expect(details.offered_factor_links).toEqual(["124ec3bb"]);
    // OFFERED, NOT TAKEN — the canonical must not have gained the edge.
    const canonicalTargets = v3.edges
      .filter((e) => e.from === "be215545")
      .map((e) => e.to);
    expect(canonicalTargets).not.toContain("124ec3bb");
  });

  it("carries exactly one two-developers option into the analysis-ready payload", () => {
    const arLabels = (v3.analysis_ready?.options ?? []).map((o) => o.label);
    expect(arLabels.filter((l) => l === USER_TWO_DEVS)).toHaveLength(1);
    expect(arLabels).not.toContain(AI_REPHRASE);
    expect(arLabels).toContain(AI_REAL_ALTERNATIVE);
  });
});
