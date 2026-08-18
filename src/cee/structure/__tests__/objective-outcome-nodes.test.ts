/**
 * ⭐⭐ A BRIEF'S NON-PRIMARY OBJECTIVES SURVIVE AS OUTCOME NODES — quality bar §8 A3.
 *
 * ── THE RULING (Paul, 18 Aug 2026) ─────────────────────────────────────────
 * "A brief with multiple objectives yields ONE overarching goal node + SEPARATE
 *  explicit outcome/criterion nodes carrying the distinct objectives/targets.
 *  Not several goal roots; not objectives hidden in coaching; never a string
 *  join. Exact user wording preserved as provenance."
 *
 * ── THE DEFECT, MEASURED AT THE WIRE BEFORE THE FIX ────────────────────────
 * `enforceSingleGoal` kept `goalIds[0]` and FILTERED the rest out, recording
 * them in `merged_from` / `merged_goals`. Both are stripped by `GraphV3` (a
 * plain `z.object`) and both have ZERO product readers. On the founder's own
 * brief, driven through the real chain, "productivity" and "code quality"
 * reached **zero nodes**. Two of three objectives left the product.
 *
 * ── WHY THESE TESTS DRIVE THE WHOLE CHAIN ──────────────────────────────────
 * The defect was INVISIBLE at the producer: `enforceSingleGoal` returned an
 * object that carried every objective, and a producer-side assertion would have
 * passed on it. It is only visible after `GraphV3.safeParse`, which is where the
 * undeclared keys are deleted. So the wire assertions below parse for real
 * rather than inspecting the intermediate (P1: one seam beyond the guard).
 *
 * ── BINDING (trap 19) ──────────────────────────────────────────────────────
 * Every assertion binds to its objective BY IDENTITY — the node whose
 * `source_quote` is that objective's verbatim quote — never by "some outcome
 * node exists with a matching-looking label", which another objective's node
 * would satisfy just as well.
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../../draft/records/projector.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import { enforceSingleGoal } from "../index.js";
import { projectGraphAndOptionsToV3 } from "../../transforms/schema-v3.js";
import { GraphV3 } from "../../../schemas/cee-v3.js";
import { quantityTokens } from "../compound-goal-label.js";

const canonical = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

interface AnyNode {
  id: string;
  kind: string;
  label?: string;
  source_quote?: string;
  label_authored?: boolean;
  provenance?: { source_quote?: string; label_authored?: boolean; provenance_class?: string };
}

/** The founder's witnessed brief — three objectives in two casual sentences. */
const FOUNDER_BRIEF =
  "We'd like to spend less. We also want to increase productivity, " +
  "while maintaining code quality. We could refactor the monolith, or buy a platform.";

const FOUNDER_OBJECTIVES = [
  "we'd like to spend less",
  "increase productivity",
  "maintaining code quality",
] as const;

function founderRecords(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: FOUNDER_OBJECTIVES[0] },
      { kind: "goal", source_quote: FOUNDER_OBJECTIVES[1] },
      { kind: "goal", source_quote: FOUNDER_OBJECTIVES[2] },
      { kind: "option", source_quote: "refactor the monolith" },
      { kind: "option", source_quote: "buy a platform" },
    ],
    claims: [
      { claim_kind: "factor", label: "Engineering Spend", basis: [3] },
      { claim_kind: "outcome", label: "Delivery Throughput", basis: [3] },
      {
        claim_kind: "causal_link",
        label: "refactoring moves engineering spend",
        from_stated: 3,
        to_claim: 0,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "buying moves engineering spend",
        from_stated: 4,
        to_claim: 0,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "spend drives throughput",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "throughput reaches the goal",
        from_claim: 1,
        to_stated: 0,
        effect: "positive",
      },
    ],
  } as unknown as DraftRecordSet;
}

/** records → projector → enforceSingleGoal. The merge stage's real input. */
function mergedGraph(records: DraftRecordSet, brief: string) {
  const projected = projectRecordsToGraph(records, brief).graph;
  const merged = enforceSingleGoal({
    nodes: projected.nodes,
    edges: projected.edges,
  } as never);
  return {
    projected,
    graph: merged!.graph as unknown as { nodes: AnyNode[]; edges: Array<Record<string, unknown>> },
  };
}

/** …and one seam further: the real V3 transform + the real contract parse. */
function wireNodes(graph: unknown, brief: string): AnyNode[] {
  const v3 = projectGraphAndOptionsToV3(graph as never, { brief }) as unknown as {
    graph: unknown;
  };
  const parsed = GraphV3.safeParse(v3.graph);
  if (!parsed.success) {
    throw new Error(`GraphV3 rejected the projected graph: ${parsed.error.message}`);
  }
  return (parsed.data as unknown as { nodes: AnyNode[] }).nodes;
}

/** Bind by IDENTITY: the node carrying THIS objective's verbatim quote. */
function nodeForObjective(nodes: readonly AnyNode[], quote: string): AnyNode | undefined {
  return nodes.find(
    (n) => canonical(n.source_quote ?? n.provenance?.source_quote) === canonical(quote),
  );
}

// ---------------------------------------------------------------------------
// The instrument, proven before it is used (trap 13: an absence assertion needs
// a positive control). If the projector ever stops minting one goal node per
// stated goal, every test below would pass by testing nothing.
// ---------------------------------------------------------------------------
describe("the instrument: the projector really does mint one goal per stated objective", () => {
  it("projects the founder's three objectives as three goal nodes, each with its own quote", () => {
    const projected = projectRecordsToGraph(founderRecords(), FOUNDER_BRIEF).graph;
    const goals = (projected.nodes as unknown as AnyNode[]).filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(3);
    expect(
      goals.map((g) => canonical(g.provenance?.source_quote)).sort(),
    ).toEqual([...FOUNDER_OBJECTIVES].map(canonical).sort());
  });
});

describe("⭐ THE LEAD RED — the founder's brief must not lose objectives", () => {
  it("yields ONE goal and TWO new outcome nodes, and every objective reaches the wire", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const nodes = wireNodes(graph, FOUNDER_BRIEF);

    // Exactly one overarching goal — not three goal roots.
    expect(nodes.filter((n) => n.kind === "goal")).toHaveLength(1);

    // Each objective is on the wire, bound BY ITS OWN QUOTE.
    for (const objective of FOUNDER_OBJECTIVES) {
      const node = nodeForObjective(nodes, objective);
      expect(node, `objective not on the wire: ${objective}`).toBeDefined();
    }

    // The primary stays the goal; the other two are outcome nodes.
    expect(nodeForObjective(nodes, FOUNDER_OBJECTIVES[0])!.kind).toBe("goal");
    expect(nodeForObjective(nodes, FOUNDER_OBJECTIVES[1])!.kind).toBe("outcome");
    expect(nodeForObjective(nodes, FOUNDER_OBJECTIVES[2])!.kind).toBe("outcome");

    // Two outcome nodes ADDED by the demotion, beside the model's own one.
    const demoted = nodes.filter(
      (n) =>
        n.kind === "outcome" &&
        FOUNDER_OBJECTIVES.some(
          (q) => canonical(q) === canonical(n.source_quote ?? n.provenance?.source_quote),
        ),
    );
    expect(demoted).toHaveLength(2);
  });

  it("no node label is a string join of two objectives", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    for (const node of wireNodes(graph, FOUNDER_BRIEF)) {
      expect(node.label ?? "").not.toContain("Compound Goal");
      expect(node.label ?? "").not.toContain(" + ");
      expect(node.label ?? "").not.toContain("; ");
    }
  });

  it("each demoted objective carries its VERBATIM quote and an authored display label", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const nodes = wireNodes(graph, FOUNDER_BRIEF);

    for (const objective of FOUNDER_OBJECTIVES.slice(1)) {
      const node = nodeForObjective(nodes, objective)!;
      // Verbatim provenance survives `GraphV3`'s field stripping.
      expect(node.source_quote).toBe(objective);
      // …and the DISPLAY label is not the raw fragment.
      expect(canonical(node.label)).not.toBe(canonical(objective));
      expect(node.label_authored).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The quad. `merged_goals` claimed to preserve it and could not: `GraphV3`
// strips that key, and only ONE of the four fields was ever copied into it. The
// outcome node is the mechanism that actually delivers the quality bar's HARD
// rule, so the rule is asserted where it is now kept — at the wire, per node.
// ---------------------------------------------------------------------------
describe("the goal_threshold quad rides the demoted objective all the way to the wire", () => {
  const THRESHOLD_BRIEF =
    "We must reach 800 active customers. We also want to cut support cost.";
  const THRESHOLD_OBJECTIVES = ["reach 800 active customers", "cut support cost"] as const;
  const QUAD = {
    goal_threshold: 0.8,
    goal_threshold_raw: 800,
    goal_threshold_unit: "customers",
    goal_threshold_cap: 1000,
  } as const;

  function thresholdRecords(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: THRESHOLD_OBJECTIVES[0] },
        { kind: "goal", source_quote: THRESHOLD_OBJECTIVES[1] },
        { kind: "option", source_quote: "hire two reps" },
        { kind: "option", source_quote: "keep the current team" },
      ],
      claims: [
        { claim_kind: "factor", label: "Sales Capacity", basis: [2] },
        { claim_kind: "outcome", label: "Customer Growth", basis: [2] },
        {
          claim_kind: "causal_link",
          label: "hiring moves capacity",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "status quo holds capacity",
          from_stated: 3,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "capacity drives growth",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "growth reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    } as unknown as DraftRecordSet;
  }

  it("all FOUR threshold fields survive on the demoted objective's own node", () => {
    const projected = projectRecordsToGraph(thresholdRecords(), THRESHOLD_BRIEF).graph;
    // Put the quad on the NON-PRIMARY objective — the one the old code deleted.
    const secondary = (projected.nodes as unknown as AnyNode[]).filter(
      (n) => n.kind === "goal",
    )[1]!;
    Object.assign(secondary, QUAD);

    // Positive control: the quad is genuinely on the node we are about to merge.
    expect((secondary as unknown as Record<string, unknown>).goal_threshold_raw).toBe(800);

    const merged = enforceSingleGoal({
      nodes: projected.nodes,
      edges: projected.edges,
    } as never)!;
    const nodes = wireNodes(merged.graph, THRESHOLD_BRIEF);

    // Bound by identity: THIS objective's node, not "a node carrying 800".
    const node = nodeForObjective(nodes, THRESHOLD_OBJECTIVES[1]);
    expect(node, "the demoted objective is not on the wire at all").toBeDefined();
    expect(node!.kind).toBe("outcome");

    const wire = node as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(QUAD)) {
      expect(wire[field], `${field} did not survive to the wire`).toBe(value);
    }
  });

  it("the superseded carriers are gone — no node ships merged_from or merged_goals", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    for (const node of graph.nodes) {
      const n = node as unknown as Record<string, unknown>;
      expect(n).not.toHaveProperty("merged_from");
      expect(n).not.toHaveProperty("merged_goals");
    }
  });
});

// ---------------------------------------------------------------------------
// A2 conservation, per node, with `source_quote` EXCLUDED from the union.
//
// ⚠ THE EXCLUSION IS THE WHOLE POINT. `source_quote` is the quote, so a union
// that includes it conserves every token of the quote by construction — the
// assertion would be `tokens(q) ⊆ tokens(q)`, true for any implementation, and
// it would pass just as happily if the node were deleted and re-minted empty.
// Excluding it makes the claim the ruling actually cares about: the numerals
// survive somewhere a USER CAN SEE — the label or the threshold quad.
// ---------------------------------------------------------------------------
describe("A2 conservation — every objective's numerals survive OUTSIDE its own quote", () => {
  const QUANTIFIED_BRIEF =
    "We want to cut cloud spend by 30%. We also need to lift deploy frequency to 12 per week.";
  const QUANTIFIED_OBJECTIVES = [
    "cut cloud spend by 30%",
    "lift deploy frequency to 12 per week",
  ] as const;

  function quantifiedRecords(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: QUANTIFIED_OBJECTIVES[0] },
        { kind: "goal", source_quote: QUANTIFIED_OBJECTIVES[1] },
        { kind: "option", source_quote: "consolidate regions" },
        { kind: "option", source_quote: "keep the current setup" },
      ],
      claims: [
        { claim_kind: "factor", label: "Cloud Spend", basis: [2] },
        { claim_kind: "outcome", label: "Deploy Throughput", basis: [2] },
        {
          claim_kind: "causal_link",
          label: "consolidating moves spend",
          from_stated: 2,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "status quo holds spend",
          from_stated: 3,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "spend drives throughput",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "throughput reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    } as unknown as DraftRecordSet;
  }

  /** The union A2 is asserted over, with `source_quote` deliberately absent. */
  function conservingFields(node: AnyNode): string {
    const n = node as unknown as Record<string, unknown>;
    return [
      node.label,
      n.goal_threshold_raw,
      n.goal_threshold_unit,
      n.goal_threshold,
      n.goal_threshold_cap,
      JSON.stringify(n.goal_constraints ?? []),
    ]
      .filter((v) => v !== undefined && v !== null)
      .join(" ");
  }

  it("the quantity predicate can see these quotes at all (positive control)", () => {
    expect([...quantityTokens(QUANTIFIED_OBJECTIVES[0])]).toContain("30%");
    expect([...quantityTokens(QUANTIFIED_OBJECTIVES[1])]).toContain("12");
  });

  it("each objective's numerals survive in that objective's OWN node, quote excluded", () => {
    const { graph } = mergedGraph(quantifiedRecords(), QUANTIFIED_BRIEF);
    const nodes = wireNodes(graph, QUANTIFIED_BRIEF);

    for (const objective of QUANTIFIED_OBJECTIVES) {
      // Bound by identity — this objective's node, not "a node that happens to
      // contain the number", which the other objective's node could satisfy.
      const node = nodeForObjective(nodes, objective);
      expect(node, `no node for ${objective}`).toBeDefined();
      const survived = quantityTokens(conservingFields(node!));
      for (const token of quantityTokens(objective)) {
        expect(
          survived.has(token),
          `token "${token}" from "${objective}" survives nowhere but its own quote`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// THE OPPOSITE TWINS. Without these, deleting the guard and demoting every goal
// unconditionally — or minting an outcome on every draft — would satisfy every
// test above.
// ---------------------------------------------------------------------------
describe("opposite twins — the demotion fires ONLY where there is a second objective", () => {
  function singleObjectiveRecords(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: "increase productivity" },
        { kind: "option", source_quote: "refactor the monolith" },
        { kind: "option", source_quote: "buy a platform" },
      ],
      claims: [
        { claim_kind: "factor", label: "Engineering Spend", basis: [1] },
        { claim_kind: "outcome", label: "Delivery Throughput", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "refactoring moves spend",
          from_stated: 1,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "buying moves spend",
          from_stated: 2,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "spend drives throughput",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "throughput reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    } as unknown as DraftRecordSet;
  }

  it("TWIN A — a single-objective brief gains NO outcome node and NO new edge", () => {
    const brief =
      "We want to increase productivity. We could refactor the monolith, or buy a platform.";
    const { projected, graph } = mergedGraph(singleObjectiveRecords(), brief);

    const outcomesBefore = (projected.nodes as unknown as AnyNode[]).filter(
      (n) => n.kind === "outcome",
    );
    const outcomesAfter = graph.nodes.filter((n) => n.kind === "outcome");

    // The model's own outcome node, and nothing added beside it.
    expect(outcomesAfter).toHaveLength(outcomesBefore.length);
    expect(outcomesAfter.map((n) => n.id).sort()).toEqual(outcomesBefore.map((n) => n.id).sort());
    // Node and edge counts are untouched: the merge did not run at all.
    expect(graph.nodes).toHaveLength(projected.nodes.length);
    expect(graph.edges).toHaveLength(projected.edges.length);
  });

  it("TWIN B — an outcome node the draft already had is byte-identical after the merge", () => {
    const { projected, graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);

    // The model's own outcome, bound by identity through its label.
    const before = (projected.nodes as unknown as AnyNode[]).find(
      (n) => n.kind === "outcome" && n.label === "Delivery Throughput",
    );
    expect(before, "the pre-existing outcome node is the control; it must exist").toBeDefined();

    const after = graph.nodes.find((n) => n.id === before!.id);
    expect(after).toBeDefined();
    // Untouched, field for field — the demotion must not reach a node it did
    // not create.
    expect(after).toEqual(before);
  });

  it("TWIN C — the pre-existing outcome gains no synthetic edge to the goal", () => {
    const { projected, graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const modelOutcome = (projected.nodes as unknown as AnyNode[]).find(
      (n) => n.kind === "outcome" && n.label === "Delivery Throughput",
    )!;
    const goalId = graph.nodes.find((n) => n.kind === "goal")!.id;

    const synthetic = graph.edges.filter(
      (e) =>
        e.from === modelOutcome.id &&
        e.to === goalId &&
        (e as { provenance_source?: string }).provenance_source === "synthetic",
    );
    expect(synthetic).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ THE MISATTRIBUTION RULING, IN EXECUTABLE FORM.
//
// Technical-architect ruling, 18 Aug 2026: PRESERVE THE USER'S STATED CAUSALITY.
// The inbound edges of a demoted goal are NOT redirected to the primary — they
// stay on the node through its conversion to an outcome.
//
// WHY. The redirect was built for a world where the secondary goal was DELETED
// and its edges had to go somewhere. Once the node SURVIVES, the redirect
// misattributes the user's own causal claims: "marketing spend drives
// productivity" silently becomes "marketing spend drives cost reduction". That
// is a fabricated causal claim wearing the user's provenance — the class the
// scientific ruling forbids, and strictly worse than the deletion it replaced,
// because a deleted objective is visibly absent while a misattributed edge
// looks like the user said it.
//
// The demoted objective receives its OWN stated drivers, and contributes to the
// overarching goal through the minted `outcome → goal` edge.
// ---------------------------------------------------------------------------
describe("⭐ the user's stated causality survives — a driver of objective B reaches B", () => {
  const MISATTRIB_BRIEF =
    "We want to cut cost. We also want to raise productivity. " +
    "Marketing spend drives productivity. We could restructure, or hold.";
  const OBJ_A = "cut cost";
  const OBJ_B = "raise productivity";

  /** `Marketing Spend` is stated to drive OBJECTIVE B, and nothing else. */
  function misattributionRecords(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: OBJ_A },
        { kind: "goal", source_quote: OBJ_B },
        { kind: "option", source_quote: "restructure" },
        { kind: "option", source_quote: "hold" },
      ],
      claims: [
        { claim_kind: "factor", label: "Marketing Spend", basis: [2] },
        {
          claim_kind: "causal_link",
          label: "restructuring moves marketing spend",
          from_stated: 2,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "holding moves marketing spend",
          from_stated: 3,
          to_claim: 0,
          effect: "positive",
        },
        // ⭐ THE LOAD-BEARING CLAIM: the factor drives objective B, not A.
        {
          claim_kind: "causal_link",
          label: "marketing spend drives productivity",
          from_claim: 0,
          to_stated: 1,
          effect: "positive",
        },
      ],
    } as unknown as DraftRecordSet;
  }

  it("the edge the user stated into objective B still ends at objective B's node", () => {
    const projected = projectRecordsToGraph(misattributionRecords(), MISATTRIB_BRIEF).graph;

    // Positive control: the stated edge really does target objective B pre-merge.
    const goalsIn = (projected.nodes as unknown as AnyNode[]).filter((n) => n.kind === "goal");
    const bIn = goalsIn.find((n) => canonical(n.provenance?.source_quote) === canonical(OBJ_B))!;
    const factorIn = (projected.nodes as unknown as AnyNode[]).find(
      (n) => n.label === "Marketing Spend",
    )!;
    expect(
      (projected.edges as Array<Record<string, unknown>>).some(
        (e) => e.from === factorIn.id && e.to === bIn.id,
      ),
      "instrument: the stated factor→objective-B edge is not in the projection",
    ).toBe(true);

    const merged = enforceSingleGoal({
      nodes: projected.nodes,
      edges: projected.edges,
    } as never)!;
    const graph = merged.graph as unknown as {
      nodes: AnyNode[];
      edges: Array<Record<string, unknown>>;
    };

    // Bound by IDENTITY: objective B's own node, found by its own quote.
    const bNode = graph.nodes.find(
      (n) => canonical(n.provenance?.source_quote) === canonical(OBJ_B),
    )!;
    expect(bNode.kind).toBe("outcome");

    // THE RULING: the factor still points at B, and NOT at the primary goal.
    const aNode = graph.nodes.find(
      (n) => canonical(n.provenance?.source_quote) === canonical(OBJ_A),
    )!;
    expect(
      graph.edges.some((e) => e.from === factorIn.id && e.to === bNode.id),
      "the user's stated driver of objective B was taken off objective B",
    ).toBe(true);
    expect(
      graph.edges.some((e) => e.from === factorIn.id && e.to === aNode.id),
      "the user's driver of objective B was MISATTRIBUTED to objective A",
    ).toBe(false);
  });

  it("F2 — the demoted objective is NOT a parentless root: it keeps ≥1 inbound edge", () => {
    // ISL's `robustness_analyzer_v2.py:1905-1918` defaults a root that carries no
    // observed_state. A demoted objective that kept its stated drivers is not a
    // root, so that condition cannot fire on it. This asserts the CEE-side half
    // by execution; live ISL confirmation rides the composed journey witness.
    const projected = projectRecordsToGraph(misattributionRecords(), MISATTRIB_BRIEF).graph;
    const merged = enforceSingleGoal({
      nodes: projected.nodes,
      edges: projected.edges,
    } as never)!;
    const graph = merged.graph as unknown as {
      nodes: AnyNode[];
      edges: Array<Record<string, unknown>>;
    };
    const bNode = graph.nodes.find(
      (n) => canonical(n.provenance?.source_quote) === canonical(OBJ_B),
    )!;
    const inbound = graph.edges.filter((e) => e.to === bNode.id);
    expect(inbound.length).toBeGreaterThanOrEqual(1);
  });

  it("an existing demoted→primary edge is PRESERVED as outcome→goal, never a self-loop", () => {
    // The self-loop exception in the outbound redirect (`to !== primaryId`).
    // Without it, a user-stated "objective B contributes to objective A" edge is
    // rewritten to `primary → primary` — a self-loop that asserts nothing and
    // that the dedup would happily keep — while the mint then adds a SECOND
    // `B → A` edge beside it. Bound by identity to the specific edge.
    const graph: any = {
      nodes: [
        { id: "g1", kind: "goal", label: "A" },
        { id: "g2", kind: "goal", label: "B" },
        { id: "d1", kind: "decision", label: "Decision" },
      ],
      edges: [{ id: "e_contrib", from: "g2", to: "g1", belief_exists: 0.6 }],
    };
    const merged = enforceSingleGoal(graph)!;
    const edges = (merged.graph as any).edges as Array<Record<string, unknown>>;

    // No self-loop was manufactured.
    expect(edges.some((e) => e.from === "g1" && e.to === "g1")).toBe(false);
    // The user's own contribution edge survived, by id, and is now outcome→goal.
    const contrib = edges.filter((e) => e.from === "g2" && e.to === "g1");
    expect(contrib).toHaveLength(1);
    expect(contrib[0].id).toBe("e_contrib");
    // …and it was NOT replaced by a freshly minted synthetic duplicate.
    expect(contrib[0].provenance_source).not.toBe("synthetic");
    expect(contrib[0].belief_exists).toBe(0.6);
  });

  it("TWIN — an OUTBOUND edge from a demoted goal is still redirected (it has no legal shape)", () => {
    // `ALLOWED_EDGES` has no rule with `goal` as a source, so a `goal → factor`
    // or `goal → decision` edge cannot legally survive the conversion as
    // `outcome → factor`. Only the INBOUND redirect is dropped; the outbound one
    // stays, and this pins that the ruling was read narrowly rather than as
    // "stop redirecting".
    const graph: any = {
      nodes: [
        { id: "g1", kind: "goal", label: "A" },
        { id: "g2", kind: "goal", label: "B" },
        { id: "d1", kind: "decision", label: "Decision" },
        { id: "f1", kind: "factor", label: "F" },
      ],
      edges: [
        { id: "e_out", from: "g2", to: "d1" },
        { id: "e_in", from: "f1", to: "g2" },
      ],
    };
    const merged = enforceSingleGoal(graph)!;
    const edges = (merged.graph as any).edges as Array<Record<string, unknown>>;

    // Outbound moved to the primary…
    expect(edges.some((e) => e.from === "g1" && e.to === "d1")).toBe(true);
    expect(edges.some((e) => e.from === "g2" && e.to === "d1")).toBe(false);
    // …inbound stayed on the demoted node.
    expect(edges.some((e) => e.from === "f1" && e.to === "g2")).toBe(true);
    expect(edges.some((e) => e.from === "f1" && e.to === "g1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P6 — system-inferred structure must not manufacture a user obligation.
//
// The demoted objective is structure the SYSTEM placed (the user stated the
// objective; the system chose to model it as an outcome node). P6 says such
// structure may be shown and offered for confirmation, and may not BLOCK. The
// two arms below are the same graph with the demotion applied and withheld, so
// the comparison is a delta rather than an absolute — an absolute would pass on
// any graph whose blockers happen to be zero for unrelated reasons.
//
// ⚠ THE EDGE IS WHAT MAKES THIS TRUE, and it is not decoration.
// `validateReachability` exempts an outcome from `UNREACHABLE_FROM_DECISION`
// only when it can reach the goal; an unwired demoted objective would be an
// ERROR, i.e. exactly the manufactured obligation P6 forbids. The mutant that
// deletes the edge mint must turn this red.
// ---------------------------------------------------------------------------
describe("P6 — demoting an objective adds no blocker and does not change run admission", () => {
  /** The pre-change behaviour: demoted goals simply deleted, edges redirected. */
  function withDemotedGoalsDeleted(graph: { nodes: AnyNode[]; edges: Array<Record<string, unknown>> }) {
    const goals = graph.nodes.filter((n) => n.kind === "goal");
    const primary = goals[0]!.id;
    const drop = new Set(
      graph.nodes
        .filter(
          (n) =>
            n.kind === "outcome" &&
            FOUNDER_OBJECTIVES.slice(1).some(
              (q) => canonical(q) === canonical(n.provenance?.source_quote),
            ),
        )
        .map((n) => n.id),
    );
    return {
      ...graph,
      nodes: graph.nodes.filter((n) => !drop.has(n.id)),
      edges: graph.edges
        .filter((e) => !(drop.has(e.from as string) && e.to === primary))
        .map((e) => ({
          ...e,
          from: drop.has(e.from as string) ? primary : e.from,
          to: drop.has(e.to as string) ? primary : e.to,
        })),
    };
  }

  it("the validator's ERROR set is identical with and without the demoted objectives", async () => {
    const { validateGraph } = await import("../../../validators/graph-validator.js");
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const without = withDemotedGoalsDeleted(graph);

    // Positive control: the two arms really are different graphs.
    expect(graph.nodes.length).toBe(without.nodes.length + 2);

    const codes = (g: unknown): string[] =>
      ((validateGraph({ graph: g } as never) as unknown as { errors?: Array<{ code: string }> })
        .errors ?? [])
        .map((e) => e.code)
        .sort();

    expect(codes(graph)).toEqual(codes(without));
  });

  it("the demoted objectives are EXEMPT (info), never UNREACHABLE_FROM_DECISION (error)", async () => {
    const { validateGraph } = await import("../../../validators/graph-validator.js");
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const result = validateGraph({ graph } as never) as unknown as {
      errors?: Array<{ code: string }>;
      controllability_summary?: { exempt_node_ids?: string[] };
    };

    expect((result.errors ?? []).map((e) => e.code)).not.toContain("UNREACHABLE_FROM_DECISION");

    // Bound by IDENTITY: the exempt set is exactly the two demoted objectives.
    const demotedIds = FOUNDER_OBJECTIVES.slice(1).map(
      (q) => graph.nodes.find((n) => canonical(n.provenance?.source_quote) === canonical(q))!.id,
    );
    expect((result.controllability_summary?.exempt_node_ids ?? []).sort()).toEqual(
      [...demotedIds].sort(),
    );
  });

  it("run admission is unchanged, and no mandatory obligation is added", async () => {
    const { resolveRunAdmission } = await import(
      "../../../orchestrator-v5/tools/handlers/analysis-ready-core.js"
    );
    const { assessRouteAdmission } = await import("../../graph-readiness/canonical-readiness.js");
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const without = withDemotedGoalsDeleted(graph);

    // ⚠ PIN THE PRECONDITION IN-TEST (trap 13b). Without this the two arms are
    // the SAME graph whenever the demotion does not fire, and "admission is
    // unchanged" holds by identity — a guard agreeing with itself. Measured:
    // this assertion is what makes the test RED at pristine.
    expect(graph.nodes.length).toBe(without.nodes.length + 2);
    expect(graph.edges.length).toBe(without.edges.length + 2);

    const admission = (g: unknown) =>
      (resolveRunAdmission(g) as unknown as { willProceed: boolean }).willProceed;
    expect(admission(graph)).toBe(admission(without));

    const blockers = (g: unknown) =>
      ((assessRouteAdmission(g) as unknown as { blockers?: unknown[] }).blockers ?? []).length;
    expect(blockers(graph)).toBe(blockers(without));
  });
});

// ---------------------------------------------------------------------------
// F1 — the demoted outcome must behave like an ORGANIC outcome, not like a
// missing bridge layer. Parity with organic is the acceptance bar; equality
// with the 1-goal control is NOT (a graph that has a bridge should not get a
// second, synthetic one minted on top).
// ---------------------------------------------------------------------------
describe("F1 — terminal-bridge behaviour reaches parity with an organic outcome", () => {
  const factor = (id: string) => ({ id, kind: "factor", label: id });

  /** goal + factors, no bridge layer at all — the bridge SHOULD fire. */
  const oneGoalControl = () => ({
    nodes: [{ id: "g1", kind: "goal", label: "A" }, factor("f1"), factor("f2"), { id: "d1", kind: "decision", label: "D" }],
    edges: [{ from: "f1", to: "g1" }, { from: "f2", to: "g1" }],
  });

  /** goal + a real outcome carrying inbound edges — the parity REFERENCE. */
  const organicOutcome = () => ({
    nodes: [
      { id: "g1", kind: "goal", label: "A" },
      { id: "out1", kind: "outcome", label: "Organic" },
      factor("f1"), factor("f2"), { id: "d1", kind: "decision", label: "D" },
    ],
    edges: [{ from: "f1", to: "out1" }, { from: "f2", to: "out1" }, { from: "out1", to: "g1" }],
  });

  /** three objectives, each with its own stated driver, through the REAL merge. */
  const threeGoalMerged = () => {
    const raw = {
      nodes: [
        { id: "g1", kind: "goal", label: "A" },
        { id: "g2", kind: "goal", label: "B" },
        { id: "g3", kind: "goal", label: "C" },
        factor("f1"), factor("f2"), { id: "d1", kind: "decision", label: "D" },
      ],
      edges: [{ from: "f1", to: "g2" }, { from: "f2", to: "g3" }],
    };
    return (enforceSingleGoal(raw as never)!).graph as unknown as {
      nodes: AnyNode[]; edges: Array<Record<string, unknown>>;
    };
  };

  it("the control really does need a bridge (positive control — else parity is vacuous)", async () => {
    const { needsTerminalBridge } = await import(
      "../../unified-pipeline/stages/repair/terminal-bridge.js"
    );
    expect(needsTerminalBridge(oneGoalControl() as never)).toBe(true);
  });

  it("PARITY — the 3-goal target and an organic outcome give the SAME verdict", async () => {
    const { needsTerminalBridge } = await import(
      "../../unified-pipeline/stages/repair/terminal-bridge.js"
    );
    const target = needsTerminalBridge(threeGoalMerged() as never);
    const organic = needsTerminalBridge(organicOutcome() as never);
    expect(target).toBe(organic);
    // …and the shared verdict is "no synthetic bridge", because one now exists.
    expect(target).toBe(false);
  });

  it("the suppression is EARNED — every factor reaches the goal through a demoted outcome", () => {
    // This is the substantive half of F1. Suppressing the synthetic bridge is
    // only correct if the demoted outcome IS a bridge. Asserted structurally,
    // not inferred from the predicate agreeing with itself.
    const g = threeGoalMerged();
    const goalId = g.nodes.find((n) => n.kind === "goal")!.id;
    const outcomeIds = new Set(g.nodes.filter((n) => n.kind === "outcome").map((n) => n.id));
    const factors = g.nodes.filter((n) => n.kind === "factor");
    expect(factors.length).toBeGreaterThan(0);
    for (const f of factors) {
      const bridged = g.edges.some(
        (e) =>
          e.from === f.id &&
          outcomeIds.has(e.to as string) &&
          g.edges.some((e2) => e2.from === e.to && e2.to === goalId),
      );
      expect(bridged, `factor ${f.id} reaches the goal through no outcome`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// F4 — the ONE wire exception, pinned so the comment cannot quietly become false.
// ---------------------------------------------------------------------------
describe("F4 — goal_baseline is dropped for a demoted node, and that is parity not harm", () => {
  it("goal_baseline does not reach the wire, while the threshold quad does", () => {
    const projected = projectRecordsToGraph(founderRecords(), FOUNDER_BRIEF).graph;
    const secondary = (projected.nodes as unknown as AnyNode[]).filter((n) => n.kind === "goal")[1]!;
    Object.assign(secondary, { goal_baseline: 0.42, goal_threshold_raw: 7, goal_threshold_unit: "pts" });

    const merged = enforceSingleGoal({
      nodes: projected.nodes, edges: projected.edges,
    } as never)!;
    const nodes = wireNodes(merged.graph, FOUNDER_BRIEF);
    const node = nodes.find(
      (n) => canonical(n.source_quote) === canonical(FOUNDER_OBJECTIVES[1]),
    )!;
    const wire = node as unknown as Record<string, unknown>;

    // The kind-gated observed_state limb did not run: no baseline projection…
    expect(wire.observed_state).toBeUndefined();
    // …which is exactly what an ORGANIC outcome looks like (the parity control).
    const organic = nodes.find((n) => n.kind === "outcome" && n.label === "Delivery Throughput")!;
    expect((organic as unknown as Record<string, unknown>).observed_state).toBeUndefined();
    // …while the kind-INDEPENDENT quad copy did run.
    expect(wire.goal_threshold_raw).toBe(7);
    expect(wire.goal_threshold_unit).toBe("pts");
  });
});

// ---------------------------------------------------------------------------
// The topology, asserted against the contract's own table rather than restated.
// ---------------------------------------------------------------------------
describe("topology — each demoted objective is wired outcome → goal, the one allowed shape", () => {
  it("mints exactly one outcome→goal edge per demoted objective, and none elsewhere", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const goalId = graph.nodes.find((n) => n.kind === "goal")!.id;

    for (const objective of FOUNDER_OBJECTIVES.slice(1)) {
      const node = graph.nodes.find(
        (n) => canonical(n.provenance?.source_quote) === canonical(objective),
      )!;
      expect(node.kind).toBe("outcome");
      const edges = graph.edges.filter((e) => e.from === node.id && e.to === goalId);
      expect(edges, `no outcome→goal edge for ${objective}`).toHaveLength(1);
      // The shared constructor's shape, not a locally invented one.
      expect(edges[0].effect_direction).toBe("positive");
      expect(edges[0].origin).toBe("default");
      expect(edges[0].provenance_source).toBe("synthetic");
    }
  });

  it("the primary goal is the only goal, and meta.roots names it alone", () => {
    const { graph } = mergedGraph(founderRecords(), FOUNDER_BRIEF);
    const goals = graph.nodes.filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(1);
    expect((graph as unknown as { meta?: { roots?: string[] } }).meta?.roots).toEqual([goals[0].id]);
  });
});
