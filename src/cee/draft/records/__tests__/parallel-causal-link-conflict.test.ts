/**
 * ROOT 2(d) — ONE RELATIONSHIP, ONE EDGE.
 *
 * ⭐ WHY THIS EXISTS, AND WHAT MEASURED IT. On the first-use corpus the dominant
 * blocked-analysis cause was PLoT `DUPLICATE_EDGE_CONFLICT` (422 `blocked`,
 * `divergent_fields: ["strength.mean","strength.std"]`): CEE drafted a model its
 * own analysis then refused. The emitter is pass 3 of this projector — it mints
 * one edge per `causal_link` claim and edge identity includes the claim LABEL,
 * so two differently-worded claims about ONE relationship survived as two edges
 * carrying different strengths. Nothing downstream collapses them.
 *
 * ⚠ PROVENANCE OF THESE NUMBERS — read before changing one. Every strength pair
 * below is LIFTED FROM A BANKED STAGING CAPTURE of the deployed draft path, not
 * invented for this test (a fixture you wrote yourself is not evidence about the
 * wire — trap 16). The record sets that produced them were NOT captured, so the
 * inputs are RECONSTRUCTED; that reconstruction is not taken on trust, it is
 * asserted — each case pins the exact pair of strengths the capture carried, so
 * a reconstruction that stopped reproducing the captured shape fails here.
 *
 *   `147a2bbc->957ac013`  [0.8, 0.5]      batch-witness-b-20260814T190458Z/draws/P2
 *                                          (the pricing-brief family, ~40% blocked)
 *   `39576bbc->af317f53`  [-0.232, +0.232] first-use-rate-20260814T172445Z/draws/D_messy-1
 *                                          — SIGN CONFLICT, the hard case
 *   `756a7698->9c6b046d`  [0.271, 0.305]   first-use-acceptance run-2/draws/A_hiring-3
 *                                          — neither side is the 0.5 default
 *
 * ⭐ EVERY ASSERTION BINDS BY IDENTITY — the minted id of a node located by its
 * exact label — never by a value predicate another edge could satisfy.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/** Locate a node by its EXACT label and return its minted id. Fails loud if absent. */
function idOf(graph: { nodes: Array<{ id: string; label: string }> }, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}

/**
 * The goal, by KIND — a stronger binding than its label text, and now the only
 * correct one: the goal's display label is an AUTHORED objective (quality bar
 * §8 A1) while its verbatim lives on `provenance.source_quote`, so a lookup by
 * brief fragment matches nothing. A decision has exactly one goal node here, so
 * kind IS identity.
 */
function goalIdOf(graph: { nodes: Array<{ id: string; kind: string }> }): string {
  const hits = graph.nodes.filter((n) => n.kind === "goal");
  expect(hits, "expected exactly one goal node").toHaveLength(1);
  return hits[0]!.id;
}

const edgesBetween = (
  graph: { edges: Array<{ from: string; to: string; strength_mean?: number }> },
  from: string,
  to: string,
) => graph.edges.filter((e) => e.from === from && e.to === to);

/** The consumer's actual predicate, written against the SPEC and not against the
 * failure in hand: PLoT coalesces identical duplicates and blocks any pair that
 * differs. So the property is "no two edges share a pair with different
 * strengths", for EVERY pair on the graph — not just the one under test. */
function divergentDuplicatePairs(graph: {
  edges: Array<{ from: string; to: string; strength_mean?: number }>;
}): string[] {
  const byPair = new Map<string, Set<unknown>>();
  for (const e of graph.edges) {
    const key = `${e.from}->${e.to}`;
    const seen = byPair.get(key) ?? new Set();
    seen.add(e.strength_mean);
    byPair.set(key, seen);
  }
  return [...byPair.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
}

describe("ROOT 2(d): parallel causal_link claims on one pair collapse to one edge, canonically and disclosed", () => {
  /** The pricing-brief shape: one factor, two claims linking it to the goal. */
  const PRICING: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "Our aim is to raise our average seat price" },
      { kind: "option", source_quote: "Raise list price" },
    ],
    claims: [
      { claim_kind: "factor", label: "Average Seat Price Achievement" },
      { claim_kind: "causal_link", label: "the price rise lifts the average seat price", from_claim: 0, to_stated: 0, effect: "positive", strength: 0.8 },
      { claim_kind: "causal_link", label: "seat price achievement meets the stated aim", from_claim: 0, to_stated: 0, effect: "positive", strength: 0.5 },
    ],
  };

  it("emits ONE edge for the relationship, and it is the least extravagant claim", () => {
    const { graph } = projectRecordsToGraph(PRICING);
    const factor = idOf(graph, "Average Seat Price Achievement");
    const goal = goalIdOf(graph);

    const between = edgesBetween(graph, factor, goal);
    expect(between).toHaveLength(1);
    // 0.5, not 0.8: among contradictory claims the smallest magnitude wins.
    expect(between[0]!.strength_mean).toBe(0.5);
  });

  it("discloses the discarded claim by ITS OWN index and label, with a re-derivable signature", () => {
    const { graph, dropped } = projectRecordsToGraph(PRICING);
    const factor = idOf(graph, "Average Seat Price Achievement");
    const goal = goalIdOf(graph);

    const conflicts = dropped.filter((d) => d.reason === "parallel_causal_link_conflict");
    expect(conflicts).toHaveLength(1);
    // Bound by identity: the DISCARDED claim is index 1 ("the price rise…"), not
    // the survivor. A disclosure naming the wrong claim is worse than none.
    expect(conflicts[0]!.claim_index).toBe(1);
    expect(conflicts[0]!.label).toBe("the price rise lifts the average seat price");
    expect(conflicts[0]!.claim_kind).toBe("causal_link");
    // Chosen first, then what was discarded — the reader re-derives the decision.
    // Both semantic fields are rendered: strength, and the direction that a
    // strength-only signature would have hidden (F1).
    expect(conflicts[0]!.strength_signature).toBe(
      `${factor}->${goal}:0.5(positive)|0.8(positive)`,
    );
  });

  it("leaves no divergent duplicate anywhere on the graph — the consumer's own predicate", () => {
    const { graph } = projectRecordsToGraph(PRICING);
    expect(graph.edges.length).toBeGreaterThan(0); // positive control: it can see a presence
    expect(divergentDuplicatePairs(graph)).toEqual([]);
  });

  it("is a pure function of CONTENT, not of the model's claim order", () => {
    // The projector's premise. If the survivor depended on emission order, two
    // record sets identical but for the order of two equivalent claims would
    // analyse to different numbers — the defect 2(c) was written to close.
    const swapped: DraftRecordSet = {
      ...PRICING,
      claims: [PRICING.claims![0]!, PRICING.claims![2]!, PRICING.claims![1]!],
    };
    const a = projectRecordsToGraph(PRICING);
    const b = projectRecordsToGraph(swapped);
    const pick = (p: typeof a) => {
      const factor = idOf(p.graph, "Average Seat Price Achievement");
      const goal = goalIdOf(p.graph);
      return edgesBetween(p.graph, factor, goal).map((e) => e.strength_mean);
    };
    expect(pick(a)).toEqual([0.5]);
    expect(pick(b)).toEqual([0.5]);
  });

  it("SIGN CONFLICT (D_messy-1, ±0.232): still one edge, still total, still disclosed", () => {
    // Equal magnitude, opposite sign — "smallest magnitude" cannot break this,
    // so the signed tie-break must. Without a total rule the survivor would
    // depend on claim order, which is the same defect wearing a rarer input.
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "work out what to do before the renewal" }],
      claims: [
        { claim_kind: "factor", label: "Contract Renewal Leverage" },
        { claim_kind: "factor", label: "Switching Cost Exposure" },
        { claim_kind: "causal_link", label: "leverage raises exposure", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.23222222222222225 },
        { claim_kind: "causal_link", label: "leverage lowers exposure", from_claim: 0, to_claim: 1, effect: "negative", strength: -0.23222222222222225 },
        // Reaches the goal, or pass 3b prunes the pair before 2(d) can see it.
        { claim_kind: "causal_link", label: "exposure bears on the renewal", from_claim: 1, to_stated: 0, effect: "negative" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const from = idOf(graph, "Contract Renewal Leverage");
    const to = idOf(graph, "Switching Cost Exposure");

    const between = edgesBetween(graph, from, to);
    expect(between).toHaveLength(1);
    // Signed ascending breaks the magnitude tie: the negative claim survives.
    expect(between[0]!.strength_mean).toBe(-0.23222222222222225);
    expect(dropped.filter((d) => d.reason === "parallel_causal_link_conflict")).toHaveLength(1);
    expect(divergentDuplicatePairs(graph)).toEqual([]);
  });

  it("A_hiring-3 (0.271 vs 0.305): collapses a pair where NEITHER side is the 0.5 default", () => {
    // Guards against a fix that only recognises the default-strength signature.
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "decide the hiring plan" }],
      claims: [
        { claim_kind: "factor", label: "Technical Leadership Capacity" },
        { claim_kind: "factor", label: "Throughput and Feature Delivery Rate" },
        { claim_kind: "causal_link", label: "leadership guides the team", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.2714285714285714 },
        { claim_kind: "causal_link", label: "leadership unblocks delivery", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.3053571428571428 },
        // Reaches the goal, or pass 3b prunes the pair before 2(d) can see it.
        { claim_kind: "causal_link", label: "delivery rate bears on the plan", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph } = projectRecordsToGraph(RECORDS);
    const from = idOf(graph, "Technical Leadership Capacity");
    const to = idOf(graph, "Throughput and Feature Delivery Rate");
    const between = edgesBetween(graph, from, to);
    expect(between).toHaveLength(1);
    expect(between[0]!.strength_mean).toBe(0.2714285714285714);
    expect(divergentDuplicatePairs(graph)).toEqual([]);
  });

  it("an EXPLICIT strength outranks a SILENT claim, and the discard is still disclosed", () => {
    // Silence is not a competing magnitude, so the silent claim never wins. It
    // IS still disclosed when discarded: it differs from the survivor, and a
    // reader who is not told loses the fact that a second claim about this
    // relationship existed at all.
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "decide the hiring plan" }],
      claims: [
        { claim_kind: "factor", label: "Technical Leadership Capacity" },
        { claim_kind: "causal_link", label: "leadership bears on the aim", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "leadership strongly bears on the aim", from_claim: 0, to_stated: 0, effect: "positive", strength: 0.9 },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const from = idOf(graph, "Technical Leadership Capacity");
    const goal = goalIdOf(graph);
    const between = edgesBetween(graph, from, goal);
    expect(between).toHaveLength(1);
    expect(between[0]!.strength_mean).toBe(0.9);
    // Divergent-from-the-survivor, so it IS disclosed: the silent claim was
    // discarded and the reader is told which one and why.
    const conflicts = dropped.filter((d) => d.reason === "parallel_causal_link_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.label).toBe("leadership bears on the aim");
  });

  /**
   * ⭐⭐ F1 — DIRECTION IS THE SECOND SEMANTIC FIELD, AND IT CARRIES THE SHARPEST
   * CONTRADICTION. `effect_direction` is minted from the grammar's `effect`
   * independently of `strength`, with no coherence coupling anywhere. A
   * divergence predicate reading only `strength_mean` absorbs an outright
   * contradiction in silence — the survivor's direction settled by an id sort.
   * Both cases below were proven by execution in review before this guard existed.
   */
  it("F1: opposite directions, BOTH SILENT on strength — collapsed, and DISCLOSED", () => {
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "grow revenue this year" }],
      claims: [
        { claim_kind: "factor", label: "Customer Churn" },
        { claim_kind: "factor", label: "Revenue" },
        { claim_kind: "causal_link", label: "churn raises revenue", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "churn lowers revenue", from_claim: 0, to_claim: 1, effect: "negative" },
        { claim_kind: "causal_link", label: "revenue bears on the aim", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const churn = idOf(graph, "Customer Churn");
    const revenue = idOf(graph, "Revenue");

    expect(edgesBetween(graph, churn, revenue)).toHaveLength(1);
    // The contradiction must not vanish: equal strengths would hide it from any
    // strength-only predicate, which is exactly the hole this pins.
    const conflicts = dropped.filter((d) => d.reason === "parallel_causal_link_conflict");
    expect(conflicts).toHaveLength(1);
    // The signature must carry the DIRECTIONS, or a reader cannot re-derive the
    // decision — both terms would otherwise render identically as "unset".
    expect(conflicts[0]!.strength_signature).toMatch(/\(positive\)/);
    expect(conflicts[0]!.strength_signature).toMatch(/\(negative\)/);
  });

  it("F1: opposite directions with EQUAL strengths — collapsed, and DISCLOSED", () => {
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "grow revenue this year" }],
      claims: [
        { claim_kind: "factor", label: "Customer Churn" },
        { claim_kind: "factor", label: "Revenue" },
        { claim_kind: "causal_link", label: "churn raises revenue", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.6 },
        { claim_kind: "causal_link", label: "churn lowers revenue", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.6 },
        { claim_kind: "causal_link", label: "revenue bears on the aim", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const churn = idOf(graph, "Customer Churn");
    const revenue = idOf(graph, "Revenue");

    expect(edgesBetween(graph, churn, revenue)).toHaveLength(1);
    const conflicts = dropped.filter((d) => d.reason === "parallel_causal_link_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.strength_signature).toBe(`${churn}->${revenue}:0.6(positive)|0.6(negative)`);
  });

  /**
   * ⭐ THE SIGNATURE IS A PERMUTATION INVARIANT, NOT MERELY THE GRAPH.
   *
   * `group` is built by iterating `edges`, so `divergent` arrived in CLAIM-EMISSION
   * order: three parallel claims permuted produced `0.5|0.9|0.7` against
   * `0.5|0.7|0.9` for the SAME claim set, and the `dropped[]` append order flipped
   * with it. The model's emission order carries no meaning, so it must not reach
   * the disclosure either — the same principle pass 6 already applies to the graph.
   * Sorting `divergent` by edge id (`sha8(label, from, to)` — content, not position)
   * makes it true rather than merely documenting the exception.
   */
  it("emits a BYTE-IDENTICAL signature across permutations of the same claim set", () => {
    const goal = { kind: "goal", source_quote: "grow revenue this year" } as const;
    const factors = [
      { claim_kind: "factor", label: "Customer Churn" },
      { claim_kind: "factor", label: "Revenue" },
    ];
    const parallel = [
      { claim_kind: "causal_link", label: "churn hits revenue hard", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.9 },
      { claim_kind: "causal_link", label: "churn hits revenue mildly", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
      { claim_kind: "causal_link", label: "churn hits revenue moderately", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.7 },
    ];
    const bridge = { claim_kind: "causal_link", label: "revenue bears on the aim", from_claim: 1, to_stated: 0, effect: "positive" };

    // All 6 permutations of the three parallel claims — the whole set, not a sample.
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const signatures = new Set<string>();
    const appendOrders = new Set<string>();
    for (const p of perms) {
      const records = {
        stated_items: [goal],
        claims: [...factors, ...p.map((i) => parallel[i]!), bridge],
      } as unknown as DraftRecordSet;
      const { dropped } = projectRecordsToGraph(records);
      const conflicts = dropped.filter((d) => d.reason === "parallel_causal_link_conflict");
      expect(conflicts).toHaveLength(2); // positive control: two discards to order
      signatures.add(conflicts[0]!.strength_signature!);
      appendOrders.add(conflicts.map((c) => c.label).join(","));
    }
    // One signature across all six orderings, and one dropped[] append order.
    expect([...signatures]).toHaveLength(1);
    expect([...appendOrders]).toHaveLength(1);
  });

  it("F1 twin: SAME direction and same strength is still silent — the widening invented no conflict", () => {
    // The opposite-direction guard must not turn every exact duplicate into a
    // reported disagreement. Without this, F1's fix trades one silent failure
    // for a noisy one and the suite applauds.
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "grow revenue this year" }],
      claims: [
        { claim_kind: "factor", label: "Customer Churn" },
        { claim_kind: "factor", label: "Revenue" },
        { claim_kind: "causal_link", label: "churn lowers revenue", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.6 },
        { claim_kind: "causal_link", label: "churn hurts revenue", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.6 },
        { claim_kind: "causal_link", label: "revenue bears on the aim", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const churn = idOf(graph, "Customer Churn");
    const revenue = idOf(graph, "Revenue");
    expect(edgesBetween(graph, churn, revenue)).toHaveLength(1);
    expect(dropped.filter((d) => d.reason === "parallel_causal_link_conflict")).toHaveLength(0);
  });

  it("coalesces an EXACT duplicate in silence — nothing was discarded, so nothing is reported", () => {
    const RECORDS: DraftRecordSet = {
      stated_items: [{ kind: "goal", source_quote: "decide the hiring plan" }],
      claims: [
        { claim_kind: "factor", label: "Technical Leadership Capacity" },
        { claim_kind: "causal_link", label: "leadership bears on the aim", from_claim: 0, to_stated: 0, effect: "positive", strength: 0.5 },
        { claim_kind: "causal_link", label: "leadership matters for the aim", from_claim: 0, to_stated: 0, effect: "positive", strength: 0.5 },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(RECORDS);
    const from = idOf(graph, "Technical Leadership Capacity");
    const goal = goalIdOf(graph);
    expect(edgesBetween(graph, from, goal)).toHaveLength(1);
    expect(dropped.filter((d) => d.reason === "parallel_causal_link_conflict")).toHaveLength(0);
  });
});

describe("ROOT 2(d) does not disturb ROOT 2(c) — two authorities, two questions", () => {
  /**
   * ⚠ THE TRAP-21 GUARD, and the reason pass 6 runs where it does. Pass 3c
   * adjudicates `sets_to` per option→factor pair and DISCLOSES the conflict; it
   * reads the candidates off the edge list. Collapse those edges before 3c runs
   * and its disclosure silently stops firing while every other test stays green.
   * This pins that 3c still sees both candidates.
   */
  const RECORDS: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "raise sales productivity" },
      { kind: "option", source_quote: "replace the CRM" },
    ],
    claims: [
      { claim_kind: "factor", label: "rep hours saved" },
      { claim_kind: "causal_link", label: "the new CRM saves hours", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
      { claim_kind: "causal_link", label: "the new CRM saves many hours", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 18 },
      { claim_kind: "causal_link", label: "hours saved bear on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };

  it("still resolves and DISCLOSES the parallel intervention conflict", () => {
    const { dropped } = projectRecordsToGraph(RECORDS);
    const conflicts = dropped.filter((d) => d.reason === "parallel_intervention_conflict");
    expect(conflicts).toHaveLength(1);
    // Both candidate levels still reached 3c; the smallest won.
    expect(conflicts[0]!.intervention_signature).toMatch(/12\|18$/);
  });

  it("still collapses the duplicated option→factor edge on the wire", () => {
    const { graph } = projectRecordsToGraph(RECORDS);
    const option = idOf(graph, "replace the CRM");
    const factor = idOf(graph, "rep hours saved");
    expect(edgesBetween(graph, option, factor)).toHaveLength(1);
    expect(divergentDuplicatePairs(graph)).toEqual([]);
  });
});
