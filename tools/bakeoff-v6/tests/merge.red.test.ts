/**
 * RED-first: an invalid arm-C merge is RECORDED as a failure — never silently
 * dropped, never crashing, never mutating the graph.
 */
import { describe, expect, it } from "vitest";
import { mergeProposals } from "../src/merge/merge.ts";
import { stableStringify } from "../src/util/stable.ts";
import { makeValidCandidate, makeV8DraftCandidate, mkEdge } from "./helpers.ts";

const validRiskProposal = () => ({
  type: "added_risk",
  delta: {
    node: { id: "risk_vendor", kind: "risk", label: "Vendor lock-in risk" },
    edge: mkEdge("risk_vendor", "out_time", "negative"),
    question: null,
  },
  evidence_pointer: "brief: commercial CRM dependency",
  rationale: "Buying creates vendor dependency.",
});

describe("deterministic arm-C merge", () => {
  it("applies a valid node+edge proposal and stays contract-valid", () => {
    const { report, merged } = mergeProposals(makeValidCandidate(), [validRiskProposal()]);
    expect(report.applied).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.post_merge_valid).toBe(true);
    const nodes = (merged as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes.some((n) => n.id === "risk_vendor")).toBe(true);
  });

  it("RED: applies a proposal on the v8 LLM-boundary draft shape (no top-level options[]) instead of throwing", () => {
    // Live arm-C feeds this shape; before the fix, base.options.map(...) threw for
    // EVERY live candidate -> applied=0, failures=[] (proposals landed in no bucket).
    const draft = makeV8DraftCandidate();
    expect((draft as { options?: unknown }).options).toBeUndefined();
    const { report, merged } = mergeProposals(draft, [validRiskProposal()]);
    expect(report.applied).toBe(1);
    expect(report.failures).toEqual([]);
    const nodes = (merged as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes.some((n) => n.id === "risk_vendor")).toBe(true);
    // no phantom options[] array is invented on the v8 shape
    expect((merged as { options?: unknown }).options).toBeUndefined();
  });

  it("RED: an added_option proposal adds the option NODE on the v8 shape (option-node source of truth)", () => {
    const optionProposal = {
      type: "added_option",
      delta: {
        node: { id: "opt_hybrid", kind: "option", label: "Hybrid buy-then-extend" },
        edge: mkEdge("opt_hybrid", "fac_cost"),
        question: null,
      },
      evidence_pointer: "brief: phased approach",
      rationale: "A hybrid path was not modelled.",
    };
    const { report, merged } = mergeProposals(makeV8DraftCandidate(), [optionProposal]);
    expect(report.applied).toBe(1);
    const nodes = (merged as { nodes: Array<{ id: string; kind: string }> }).nodes;
    expect(nodes.some((n) => n.id === "opt_hybrid" && n.kind === "option")).toBe(true);
  });

  it("records a malformed proposal (missing evidence_pointer) as a failure", () => {
    const proposal = { ...validRiskProposal(), evidence_pointer: "" };
    const { report } = mergeProposals(makeValidCandidate(), [proposal]);
    expect(report.applied).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].reason).toContain("evidence_pointer");
  });

  it("records a dangling-endpoint causal link as a failure (schema alone cannot catch this)", () => {
    const proposal = {
      type: "added_causal_link",
      delta: { node: null, edge: mkEdge("fac_ghost", "goal_1"), question: null },
      evidence_pointer: "brief: something",
    };
    const { report, merged } = mergeProposals(makeValidCandidate(), [proposal]);
    expect(report.applied).toBe(0);
    expect(report.failures[0].reason).toContain("endpoint missing");
    expect((merged as { edges: unknown[] }).edges).toHaveLength((makeValidCandidate().edges as unknown[]).length);
  });

  it("records duplicate node id and duplicate label as failures", () => {
    const dupId = {
      type: "added_risk",
      delta: { node: { id: "fac_cost", kind: "risk", label: "A new risk" }, edge: null, question: null },
      evidence_pointer: "brief: x",
    };
    const dupLabel = {
      type: "added_risk",
      delta: { node: { id: "risk_cost2", kind: "risk", label: "Total cost" }, edge: null, question: null },
      evidence_pointer: "brief: x",
    };
    const { report } = mergeProposals(makeValidCandidate(), [dupId, dupLabel]);
    expect(report.applied).toBe(0);
    expect(report.failures).toHaveLength(2);
    expect(report.failures[0].reason).toContain("duplicate node id");
    expect(report.failures[1].reason).toContain("duplicate node label");
  });

  it("rejects a node whose kind is invalid for the proposal type", () => {
    const proposal = {
      type: "added_risk",
      delta: { node: { id: "risk_x", kind: "factor", label: "Not actually a risk" }, edge: null, question: null },
      evidence_pointer: "brief: x",
    };
    const { report } = mergeProposals(makeValidCandidate(), [proposal]);
    expect(report.failures[0].reason).toContain('kind "factor" not allowed');
  });

  it("rejects effect_direction inconsistent with strength.mean sign", () => {
    const edge = mkEdge("fac_cost", "goal_1", "positive");
    (edge.strength as { mean: number }).mean = -0.4;
    const proposal = {
      type: "added_causal_link",
      delta: { node: null, edge, question: null },
      evidence_pointer: "brief: x",
    };
    const { report } = mergeProposals(makeValidCandidate(), [proposal]);
    expect(report.failures[0].reason).toContain("inconsistent");
  });

  it("treats clarification proposals as NON-mutating artifacts; a mutating artifact is a failure", () => {
    const good = {
      type: "clarification_proposal",
      delta: { node: null, edge: null, question: "What is the payback horizon?" },
      evidence_pointer: "brief: budget",
    };
    const bad = {
      type: "uncertainty_flag",
      delta: { node: { id: "n_x", kind: "risk", label: "Sneaky mutation" }, edge: null, question: "q" },
      evidence_pointer: "brief: x",
    };
    const { report, artifacts, merged } = mergeProposals(makeValidCandidate(), [good, bad]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].question).toContain("payback");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].reason).toContain("must not carry node/edge deltas");
    expect((merged as { nodes: unknown[] }).nodes).toHaveLength((makeValidCandidate().nodes as unknown[]).length);
  });

  it("adds an options[] entry for added_option so the merged graph stays contract-valid", () => {
    const proposal = {
      type: "added_option",
      delta: {
        node: { id: "opt_hybrid", kind: "option", label: "Hybrid buy plus build" },
        edge: mkEdge("dec_1", "opt_hybrid"),
        question: null,
      },
      evidence_pointer: "brief: buy or build framing",
    };
    const { report, merged } = mergeProposals(makeValidCandidate(), [proposal]);
    expect(report.applied).toBe(1);
    expect(report.post_merge_valid).toBe(true);
    const options = (merged as { options: Array<{ id: string; status: string }> }).options;
    expect(options.some((o) => o.id === "opt_hybrid" && o.status === "needs_user_mapping")).toBe(true);
  });

  it("nothing is silently dropped: every proposal lands in exactly one bucket", () => {
    const proposals = [
      validRiskProposal(),
      { type: "clarification_proposal", delta: { node: null, edge: null, question: "q?" }, evidence_pointer: "e" },
      { not: "a proposal" },
    ];
    const { report, artifacts } = mergeProposals(makeValidCandidate(), proposals);
    expect(report.proposals_total).toBe(3);
    expect(report.applied + artifacts.length + report.failures.length).toBe(3);
  });

  it("is deterministic: same inputs produce byte-identical merged output", () => {
    const proposals = [validRiskProposal()];
    const a = mergeProposals(makeValidCandidate(), proposals);
    const b = mergeProposals(makeValidCandidate(), proposals);
    expect(stableStringify(a.merged)).toBe(stableStringify(b.merged));
    expect(stableStringify(a.report)).toBe(stableStringify(b.report));
  });
});
