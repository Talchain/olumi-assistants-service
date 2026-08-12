/**
 * DRAFT BY RECORDS — projector behaviour: authorship (C-K4), the floor/ceiling
 * mapping, disclosure of unresolvable references, and identity minting.
 *
 *
 * Every assertion here binds to its object by IDENTITY — a minted id, an exact
 * label, or a provenance class — never by a value predicate another object
 * could satisfy (the #800 rule: a spec that found a factor by `value === 60`
 * passed on a DIFFERENT factor while its extractor was deleted).
 */

import { describe, expect, it } from "vitest";
import { directionToOperator, projectRecordsToGraph, sha8 } from "../projector.js";
import { DRAFT_RECORD_DIRECTIONS, type DraftRecordSet } from "../grammar.js";

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "cut customer churn", role: "target" },
    { kind: "option", source_quote: "buy a new CRM" },
    { kind: "constraint", source_quote: "budget of £6,000", value: 6000, unit: "GBP", direction: "ceiling" },
    { kind: "constraint", source_quote: "margin must stay above 78%", value: 78, unit: "%", direction: "floor" },
    { kind: "figure", source_quote: "churn is 12%", value: 12, unit: "%", role: "baseline" },
  ],
  claims: [
    { claim_kind: "factor", label: "implementation cost", basis: [1, 2], category: "controllable", value: 4500 },
    { claim_kind: "prior", label: "market grows 8% annually", value: 8 },
    { claim_kind: "causal_link", label: "CRM reduces churn", basis: [1], from_stated: 1, to_stated: 4, effect: "negative", strength: 0.4 },
    // ⚠ THE SPINE IS PART OF THE FIXTURE. The projector withdraws any factor or
    // constraint that reaches no goal (pass 3b), so an unconnected fixture would
    // project to almost nothing and the assertions below would agree with
    // themselves on an empty set. Every derived node here is connected on purpose.
    { claim_kind: "causal_link", label: "churn bears on the goal", basis: [0], from_stated: 4, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "cost bears on the goal", basis: [0], from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "market growth bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "the budget bears on the goal", basis: [2], from_stated: 2, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "the margin floor bears on the goal", basis: [3], from_stated: 3, to_stated: 0, effect: "negative" },
  ],
};

const project = () => projectRecordsToGraph(JSON.parse(JSON.stringify(RECORDS)) as DraftRecordSet);

// Bind by IDENTITY: recompute the minted id the same way the projector does.
const goalId = sha8("goal", "cut customer churn");
const optionId = sha8("option", "buy a new CRM");
const budgetId = sha8("constraint", "budget of £6,000");
const marginId = sha8("constraint", "margin must stay above 78%");
const churnFigureId = sha8("figure", "churn is 12%");
const costClaimId = sha8("factor", "implementation cost");
const priorClaimId = sha8("prior", "market grows 8% annually");

describe("C-K4: the projector cannot commit false authorship", () => {
  it("every node minted from a stated item is badged `stated` and carries its exact quote", () => {
    const { provenance } = project();
    for (const [id, quote] of [
      [goalId, "cut customer churn"],
      [optionId, "buy a new CRM"],
      [budgetId, "budget of £6,000"],
      [marginId, "margin must stay above 78%"],
      [churnFigureId, "churn is 12%"],
    ] as const) {
      expect(provenance[id]?.provenance_class, `provenance for ${id}`).toBe("stated");
      expect(provenance[id]?.source_quote).toBe(quote);
      // A stated badge must never carry an inference basis.
      expect(provenance[id]?.basis).toBeUndefined();
    }
  });

  it("every node minted from a claim is badged `ai_inferred` and never carries a source quote", () => {
    const { provenance } = project();
    for (const id of [costClaimId, priorClaimId]) {
      expect(provenance[id]?.provenance_class, `provenance for ${id}`).toBe("ai_inferred");
      // ⭐ The 117/117 class inverted: an AI-chosen value badged as user-stated.
      // The projector has no path to attach a quote to a claim-derived node,
      // and this is the assertion that pins it.
      expect(provenance[id]?.source_quote).toBeUndefined();
    }
  });

  it("a claim with NO basis is explicitly marked as pure invention", () => {
    const { provenance } = project();
    expect(provenance[priorClaimId]?.unbased).toBe(true);
    expect(provenance[priorClaimId]?.basis).toEqual([]);
  });

  it("a claim WITH a basis resolves it to minted stated ids, and drops out-of-range indices", () => {
    const { provenance } = project();
    // basis [1, 2] → the option and the budget constraint, in that order.
    expect(provenance[costClaimId]?.basis).toEqual([optionId, budgetId]);
    expect(provenance[costClaimId]?.unbased).toBe(false);
  });

  it("the synthesised decision node is `projector_structural` — NOT stated, NOT ai_inferred", () => {
    const { graph, provenance } = project();
    const decision = graph.nodes.find((n) => n.kind === "decision");
    expect(decision, "a decision node is synthesised when options exist").toBeDefined();
    const prov = provenance[decision!.id];
    expect(prov?.provenance_class).toBe("projector_structural");
    // Badging it either way would itself be false authorship by the projector.
    expect(prov?.source_quote).toBeUndefined();
    expect(prov?.basis).toBeUndefined();
  });

  it("EVERY node and edge in the graph has a provenance record — none is unbadged", () => {
    const { graph, provenance } = project();
    const ids = [...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id)];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(provenance[id], `unbadged element ${id}`).toBeDefined();
    }
    // And the provenance map has no orphans pointing at nothing.
    expect(Object.keys(provenance).sort()).toEqual([...ids].sort());
  });

  it("no stated node's label is a paraphrase — it is the canonicalised quote verbatim", () => {
    const { graph, provenance } = project();
    for (const node of graph.nodes) {
      const prov = provenance[node.id];
      if (prov?.provenance_class !== "stated") continue;
      expect(node.label).toBe(prov.source_quote);
    }
  });
});

describe("the floor/ceiling → wire-operator mapping (#888's lesson, one site only)", () => {
  it("floor → `>=` and ceiling → `<=`, derived at the consumer's enum", () => {
    expect(directionToOperator("floor")).toBe(">=");
    expect(directionToOperator("ceiling")).toBe("<=");
  });

  it("the mapping is total over the declared vocabulary and lands only in the consumer's enum", () => {
    const allowed = new Set([">=", "<="]);
    for (const d of DRAFT_RECORD_DIRECTIONS) {
      expect(allowed.has(directionToOperator(d))).toBe(true);
    }
    // Both directions are reachable — a mapping that returned one operator for
    // everything would pass the line above and be the #888 defect exactly.
    expect(new Set(DRAFT_RECORD_DIRECTIONS.map(directionToOperator)).size).toBe(2);
  });

  it("a ceiling constraint carries `<=` in BOTH places PLoT reads", () => {
    const { graph } = project();
    const budget = graph.nodes.find((n) => n.id === budgetId);
    expect((budget?.data as Record<string, unknown>)?.operator).toBe("<=");
    expect(
      ((budget?.observed_state as Record<string, unknown>)?.metadata as Record<string, unknown>)?.operator,
    ).toBe("<=");
    expect((budget?.observed_state as Record<string, unknown>)?.value).toBe(6000);
  });

  it("a floor constraint carries `>=` in BOTH places — the inverse twin", () => {
    const { graph } = project();
    const margin = graph.nodes.find((n) => n.id === marginId);
    expect((margin?.data as Record<string, unknown>)?.operator).toBe(">=");
    expect(
      ((margin?.observed_state as Record<string, unknown>)?.metadata as Record<string, unknown>)?.operator,
    ).toBe(">=");
  });

  it("a factor's observed_state carries NO constraint metadata (the union would 400)", () => {
    const { graph } = project();
    const figure = graph.nodes.find((n) => n.id === churnFigureId);
    expect(figure?.observed_state).toBeDefined();
    expect("metadata" in (figure!.observed_state as Record<string, unknown>)).toBe(false);
  });
});

describe("unresolvable references are DISCLOSED, never silently swallowed", () => {
  const bad: DraftRecordSet = {
    stated_items: [{ kind: "goal", source_quote: "grow revenue" }],
    claims: [
      { claim_kind: "causal_link", label: "out of range", from_stated: 0, to_stated: 9 },
      // ⚠ v4: `unparseable_ref` IS NO LONGER REACHABLE THROUGH THE GRAMMAR, and
      // that is the namespace fix working rather than a case going missing. The
      // reference used to be a free string whose first character selected the
      // namespace (`s0` / `c0`), so `"banana"` was an emittable value; the
      // namespace is now the FIELD and the value is a typed integer, so a
      // provider that honours the schema cannot produce an unparseable
      // reference. The reason code survives for the fixture and test callers the
      // projector's header names, and the class it is replaced by here —
      // `ambiguous_ref` — is the one v4 actually introduced: BOTH namespace
      // fields of one endpoint set, which say different things and which the
      // projector refuses to choose between.
      { claim_kind: "causal_link", label: "ambiguous", from_stated: 0, to_stated: 0, to_claim: 0 },
      { claim_kind: "causal_link", label: "self loop", from_stated: 0, to_stated: 0 },
      { claim_kind: "causal_link", label: "missing", from_stated: 0 },
    ],
  };

  it("each bad-reference class is reported with its own reason and claim index", () => {
    const { dropped, graph } = projectRecordsToGraph(bad);
    expect(dropped.map((d) => [d.claim_index, d.reason])).toEqual([
      [0, "ref_out_of_range"],
      [1, "ambiguous_ref"],
      [2, "self_loop"],
      [3, "missing_ref"],
    ]);
    // And none of them became an edge.
    expect(graph.edges).toHaveLength(0);
  });

  it("a resolvable link DOES become an edge — so the drop path is not just rejecting everything", () => {
    const { graph, dropped } = project();
    expect(dropped).toHaveLength(0);
    // Bound by IDENTITY to the ONE link under test — the option→churn edge —
    // never by "the only inferred edge", which was true when this fixture had a
    // single link and would now quietly select whichever edge happened to be
    // first. A value predicate another object can satisfy is not a binding.
    const causal = graph.edges.filter(
      (e) => e.provenance_source === "inferred" && e.from === optionId && e.to === churnFigureId,
    );
    expect(causal).toHaveLength(1);
    expect(causal[0]!.effect_direction).toBe("negative");
    expect(causal[0]!.strength_mean).toBe(0.4);
    // The drop path is not rejecting everything, and the spine is present.
    expect(graph.edges.filter((e) => e.provenance_source === "inferred").length).toBeGreaterThan(1);
  });
});

describe("identity minting", () => {
  it("identical (kind, quote) pairs get DISTINCT ids — neither is silently lost", () => {
    const dupes: DraftRecordSet = {
      stated_items: [
        { kind: "figure", source_quote: "headcount is 40", value: 40 },
        { kind: "figure", source_quote: "headcount is 40", value: 40 },
      ],
      claims: [],
    };
    const { graph } = projectRecordsToGraph(dupes);
    expect(graph.nodes).toHaveLength(2);
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(2);
    expect(graph.nodes[1]!.id).toBe(`${graph.nodes[0]!.id}-2`);
  });

  it("whitespace-only differences canonicalise to the SAME base id", () => {
    const a = sha8("figure", "headcount is 40");
    const spaced: DraftRecordSet = {
      stated_items: [{ kind: "figure", source_quote: "  headcount\tis\r\n40  ", value: 40 }],
      claims: [],
    };
    expect(projectRecordsToGraph(spaced).graph.nodes[0]!.id).toBe(a);
  });

  it("sha8 is injective across part boundaries — ('ab','c') ≠ ('a','bc')", () => {
    // A space separator would make these collide; the NUL separator is what
    // stops a quote ending in a kind-name from forging another item's id.
    expect(sha8("ab", "c")).not.toBe(sha8("a", "bc"));
  });

  it("the default seed is the frozen 17 — the projector mints no seed of its own", () => {
    expect(project().graph.default_seed).toBe(17);
  });
});
