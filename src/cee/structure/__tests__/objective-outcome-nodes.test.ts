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
