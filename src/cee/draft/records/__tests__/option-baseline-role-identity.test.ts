import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../grammar.js";
import type { ProjectedNode, RecordProjection } from "../projector.js";
import { projectDraftRecords } from "../seam.js";

// Controlled record shape, NOT a recovered provider preimage. The native
// increase-label/49-effect symptom motivated the test; its raw records are absent.
const INCREASE = "increase the Pro plan price from £49 to £59 per month";
const HOLD = "Hold the Pro plan price";
const GOAL = "reaching £20k MRR within 12 months";
const CONSTRAINT = "keeping monthly churn under 4%";
const BRIEF = `Given our goal of ${GOAL} while ${CONSTRAINT}, should we ${INCREASE} with the next Pro feature release?`;
const FACTOR = "Pro plan price";

function records(args: {
  parentRole?: boolean;
  refinementRole?: boolean;
  parentQuote?: string;
  refinementLabel?: string;
  value?: number;
  parentValue?: number;
  qualitative?: boolean;
} = {}): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: args.parentQuote ?? INCREASE,
        ...(args.parentRole !== undefined ? { is_baseline: args.parentRole } : {}) },
      { kind: "goal", source_quote: GOAL, role: "target" },
      { kind: "constraint", source_quote: CONSTRAINT, direction: "ceiling", value: 4, unit: "%" },
    ],
    claims: [
      { claim_kind: "factor", label: FACTOR, basis: [0], category: "controllable" },
      { claim_kind: "option_refinement", label: args.refinementLabel ?? HOLD, basis: [0, 2],
        ...(args.refinementRole !== undefined ? { is_baseline: args.refinementRole } : {}) },
      { claim_kind: "causal_link", label: "Stated option acts on factor", from_stated: 0,
        to_claim: 0, effect: "positive",
        ...(args.parentValue !== undefined ? { sets_to: args.parentValue } : {}) },
      { claim_kind: "causal_link", label: "Refinement acts on factor", from_claim: 1,
        to_claim: 0, effect: "positive",
        ...(!args.qualitative ? { sets_to: args.value ?? 49 } : {}) },
      { claim_kind: "causal_link", label: "Factor contributes to goal", from_claim: 0,
        to_stated: 1, effect: "positive" },
      { claim_kind: "causal_link", label: "Constraint affects goal", from_stated: 2,
        to_stated: 1, effect: "negative" },
    ],
  };
}

function project(input: DraftRecordSet, brief = BRIEF): RecordProjection {
  const decoded = projectDraftRecords(input, brief);
  if (!decoded.ok) throw new Error(`Real records seam refused fixture: ${decoded.reason}`);
  return decoded.projection;
}

function node(projection: RecordProjection, predicate: (value: ProjectedNode) => boolean): ProjectedNode {
  const found = projection.graph.nodes.find(predicate);
  if (!found) throw new Error("Expected identity-bound projected node is missing");
  return found;
}

function parent(projection: RecordProjection, quote = INCREASE): ProjectedNode {
  return node(projection, (value) => value.kind === "option" && value.provenance?.source_quote === quote);
}

function refinement(projection: RecordProjection, label = HOLD): ProjectedNode {
  return node(projection, (value) => value.kind === "option" && value.label === label);
}

function expectMagnitude(projection: RecordProjection, option: ProjectedNode, raw: number): void {
  const factor = node(projection, (value) => value.kind === "factor" && value.label === FACTOR);
  expect(option.data).toMatchObject({ raw_interventions: { [factor.id]: raw } });
  // Use the producer's actual shared scale, not a guessed currency denominator.
  const frame = factor.scale_frame;
  if (typeof frame !== "number" || !Number.isFinite(frame) || frame <= 0) {
    throw new Error("Expected real positive factor scale frame");
  }
  expect(option.data).toMatchObject({ interventions: { [factor.id]: raw / frame } });
  expect(projection.graph.edges.some((edge) => edge.from === option.id && edge.to === factor.id)).toBe(true);
}

describe("real draft seam: explicit baseline roles bound option identity", () => {
  it("does not move a HOLD/49 refinement onto the user's INCREASE/false option", () => {
    const input = records({ parentRole: false, refinementRole: true });
    const before = structuredClone(input);
    const projection = project(input);
    const stated = parent(projection);
    const hold = refinement(projection);
    expect(stated.is_baseline).toBe(false);
    expect(stated.provenance).toMatchObject({ source_quote: INCREASE, provenance_class: "stated" });
    expect(stated.provenance?.merged_refinements).toBeUndefined();
    expect(stated.data?.interventions).toBeUndefined();
    expect(hold.is_baseline).toBe(true);
    expect(hold.provenance?.provenance_class).toBe("ai_inferred");
    expectMagnitude(projection, hold, 49);
    expect(node(projection, (value) => value.provenance?.source_quote === CONSTRAINT)).toBeDefined();
    expect(input).toEqual(before);
  });

  it("also keeps a non-baseline increase separate from an explicitly baseline parent", () => {
    const quote = "keep the Pro plan price at £49";
    const label = "Increase the Pro plan price to £59";
    const projection = project(records({ parentRole: true, refinementRole: false,
      parentQuote: quote, refinementLabel: label, value: 59 }), BRIEF.replace(INCREASE, quote));
    expect(parent(projection, quote).is_baseline).toBe(true);
    expect(parent(projection, quote).data?.interventions).toBeUndefined();
    expect(refinement(projection, label).is_baseline).toBe(false);
    expectMagnitude(projection, refinement(projection, label), 59);
  });

  it.each([true, false])("retains the existing merge for the same explicit role %s", (role) => {
    const projection = project(records({ parentRole: role, refinementRole: role }));
    expect(projection.graph.nodes.filter((value) => value.kind === "option")).toHaveLength(1);
    expect(parent(projection).is_baseline).toBe(role);
    expect(parent(projection).provenance?.merged_refinements).toContain(HOLD);
    expectMagnitude(projection, parent(projection), 49);
  });

  it("counts an opposite-role competitor before deciding whether another refinement can merge", () => {
    const input = records({ parentRole: false, refinementRole: true });
    const index = input.claims.length;
    input.claims.push(
      { claim_kind: "option_refinement", label: "Smaller increase", basis: [0], is_baseline: false },
      { claim_kind: "causal_link", label: "Smaller increase value", from_claim: index,
        to_claim: 0, effect: "positive", sets_to: 54 },
    );
    const projection = project(input);
    expect(projection.graph.nodes.filter((value) => value.kind === "option")).toHaveLength(3);
    expect(parent(projection).provenance?.merged_refinements).toBeUndefined();
    expect(parent(projection).data?.interventions).toBeUndefined();
    expectMagnitude(projection, refinement(projection), 49);
    expectMagnitude(projection, refinement(projection, "Smaller increase"), 54);
  });

  it.each([
    { parentRole: undefined, refinementRole: true, expected: true },
    { parentRole: false, refinementRole: undefined, expected: false },
    { parentRole: undefined, refinementRole: undefined, expected: undefined },
  ])("does not infer conflict from missing flags: %j", ({ parentRole, refinementRole, expected }) => {
    const projection = project(records({ parentRole, refinementRole }));
    expect(projection.graph.nodes.filter((value) => value.kind === "option")).toHaveLength(1);
    expect(parent(projection).is_baseline).toBe(expected);
    expectMagnitude(projection, parent(projection), 49);
  });

  it("respects typed roles for qualitative non-pricing alternatives without inventing values", () => {
    const quote = "replace our current CRM";
    const label = "Keep the existing CRM";
    const projection = project(records({ parentRole: false, refinementRole: true,
      parentQuote: quote, refinementLabel: label, qualitative: true }), `Should we ${quote}? ${GOAL}; ${CONSTRAINT}.`);
    expect(parent(projection, quote).is_baseline).toBe(false);
    expect(refinement(projection, label).is_baseline).toBe(true);
    for (const option of projection.graph.nodes.filter((value) => value.kind === "option")) {
      expect(option.data?.interventions).toBeUndefined();
      expect(option.data?.raw_interventions).toBeUndefined();
    }
  });

  it("preserves an explicit zero on its own baseline alternative", () => {
    const projection = project(records({ parentRole: false, refinementRole: true, value: 0 }));
    expect(parent(projection).data?.interventions).toBeUndefined();
    const zero = refinement(projection);
    const factor = node(projection, (value) => value.kind === "factor" && value.label === FACTOR);
    expect(zero.data).toMatchObject({ raw_interventions: { [factor.id]: 0 }, interventions: { [factor.id]: 0 } });
  });

  it("retains the existing numeric-conflict veto even when both baseline roles agree", () => {
    const projection = project(records({ parentRole: false, refinementRole: false, parentValue: 59 }));
    expect(parent(projection).provenance?.merged_refinements).toBeUndefined();
    expectMagnitude(projection, parent(projection), 59);
    expectMagnitude(projection, refinement(projection), 49);
  });
});
