/**
 * NODE PROVENANCE — WHAT A USER IS ACTUALLY SHOWN.
 *
 * The projector's `provenance` object is read by the EDGE path. Node badges come
 * from a different chain entirely, and this file exists because inferring the
 * node rule from the edge rule is exactly the mistake that would ship a lie:
 *
 *   `extractionType`                (observed_state ?? node ?? data)
 *     → `nodeProvenanceDisplay`     ("explicit"|"observed" → `from_brief`)
 *     → `mayClaimFromBrief`         withdraws the claim unless RE-EARNED
 *                                   (`classifyFactorValueTier === "explicit"`,
 *                                    i.e. label AND numeric value both present)
 *
 * Every assertion below RUNS `transformNodeToV3` — the real transform, on the
 * real projection — so what is pinned is the badge a user would see, not the
 * field this module happened to set. A test that inspected our own
 * `extractionType` would pass identically if the consumer chain were deleted.
 *
 * ⭐ THE INVARIANT IS WRITTEN AGAINST THE SPEC IN BOTH DIRECTIONS, because two
 * opposite harms live here and they must not share one assertion:
 *   FALSE AUTHORSHIP — telling the user their brief said something it did not.
 *                      This is the LIE, and it is the one that must be zero.
 *   UNDER-CLAIMING   — telling the user the model inferred a number they
 *                      themselves stated. This is a GAP: it wastes their words
 *                      and makes the model look more inventive than it was.
 * A guard that only watched one door would pass while the other stood open.
 */
import { describe, expect, it } from "vitest";
import { transformNodeToV3 } from "../../../transforms/schema-v3.js";
import { NODE_KIND_MAP } from "../../../../adapters/llm/normalisation.js";
import { projectRecordsToGraph, type ProjectedNode } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "cut customer churn to 8%", role: "target" },
    { kind: "option", source_quote: "buy a new CRM" },
    { kind: "option", source_quote: "keep the current system" },
    // A stated figure WITH a number — the one class that may claim the brief.
    { kind: "figure", source_quote: "churn is currently 12%", value: 12, unit: "%", role: "baseline" },
    // A stated figure WITHOUT a number — stated, but carrying no brief value.
    { kind: "figure", source_quote: "support load is heavy" },
    { kind: "constraint", source_quote: "budget of £6,000", value: 6000, unit: "GBP", direction: "ceiling" },
  ],
  claims: [
    // A factor the MODEL added, carrying a number the model chose.
    { claim_kind: "factor", label: "implementation cost", basis: [1], category: "controllable", value: 4500 },
    // A factor the model added with no basis at all — pure invention.
    { claim_kind: "factor", label: "staff resistance", category: "external" },
    // ⚠ THE SPINE IS PART OF THE FIXTURE, not decoration. The projector
    // withdraws any factor or constraint that reaches no goal (see pass 3b), so
    // a fixture without connections would silently project to almost nothing and
    // every badge assertion below would pass vacuously on an empty set — the
    // failure mode where a test agrees with itself because there is nothing left
    // to disagree with. Every derived node here is deliberately connected.
    { claim_kind: "causal_link", label: "the new CRM raises capacity", basis: [1], from_stated: 1, to_claim: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "cost bears on the goal", basis: [1], from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "resistance bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "current churn bears on the goal", basis: [3], from_stated: 3, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "support load bears on the goal", basis: [4], from_stated: 4, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "the budget bears on the goal", basis: [5], from_stated: 5, to_stated: 0, effect: "negative" },
  ],
};

/**
 * The pipeline normalises kinds before the V3 transform (`constraint` → `risk`),
 * so the badge must be asserted on the kind the transform actually receives. A
 * fixture that skipped this would be testing a graph the product never sees.
 */
function projectedAndNormalised(): ProjectedNode[] {
  const g = projectRecordsToGraph(RECORDS).graph;
  return g.nodes.map((n) => ({ ...n, kind: NODE_KIND_MAP[n.kind.toLowerCase().trim()] ?? n.kind }) as ProjectedNode);
}

/** Bind by IDENTITY — the minted id for a named record — never by a value predicate. */
function nodeForQuote(nodes: ProjectedNode[], quote: string): ProjectedNode {
  const found = nodes.filter((n) => n.provenance?.source_quote === quote);
  expect(found, `exactly one node for quote ${JSON.stringify(quote)}`).toHaveLength(1);
  return found[0]!;
}

function badgeOf(node: ProjectedNode): string | undefined {
  const v3 = transformNodeToV3(node as never) as { provenance?: string };
  return v3.provenance;
}

describe("a stated figure carrying the user's own number reads from_brief", () => {
  it("badges the stated, valued figure as from_brief", () => {
    const badge = badgeOf(nodeForQuote(projectedAndNormalised(), "churn is currently 12%"));
    expect(badge).toBe("from_brief");
  });

  /**
   * The claim is EARNED, not asserted: strip the value and the existing 2.972
   * gate must withdraw the badge on its own. This proves the honesty comes from
   * the consumer's re-derivation and not from our label — if someone later
   * deleted `mayClaimFromBrief`, this goes red.
   */
  it("loses the claim the moment the value is gone, without our label changing", () => {
    const node = nodeForQuote(projectedAndNormalised(), "churn is currently 12%");
    const stripped = {
      ...node,
      data: { ...(node.data as Record<string, unknown>), value: undefined },
      observed_state: undefined,
    };
    expect((stripped.data as Record<string, unknown>).extractionType).toBe("explicit");
    expect(badgeOf(stripped as ProjectedNode)).toBe("ai_inferred");
  });
});

describe("ZERO FALSE AUTHORSHIP — nothing the model or the projector added may read from_brief", () => {
  it("badges a model-added factor as ai_inferred even though it carries a number", () => {
    const nodes = projectedAndNormalised();
    const inferred = nodes.filter((n) => n.label === "implementation cost");
    expect(inferred).toHaveLength(1);
    expect(badgeOf(inferred[0]!)).toBe("ai_inferred");
  });

  it("badges an unbased model factor as ai_inferred", () => {
    const nodes = projectedAndNormalised();
    const inferred = nodes.filter((n) => n.label === "staff resistance");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]!.provenance?.unbased).toBe(true);
    expect(badgeOf(inferred[0]!)).toBe("ai_inferred");
  });

  it("badges the projector's own decision scaffold as ai_inferred, never from_brief", () => {
    const nodes = projectedAndNormalised();
    const decision = nodes.filter((n) => n.provenance?.provenance_class === "projector_structural");
    expect(decision.length).toBeGreaterThan(0);
    for (const n of decision) expect(badgeOf(n)).toBe("ai_inferred");
  });

  /**
   * ⭐ THE WHOLE-GRAPH INVARIANT, written against the SPEC rather than against
   * the classes this fixture happens to contain: the ONLY nodes that may read
   * `from_brief` are those the projector built inside the stated-items loop AND
   * that carry a number the user gave. Anything else reading `from_brief` is the
   * lie, whatever kind it is and however it got there.
   */
  it("admits from_brief for no node outside the stated-and-valued class", () => {
    for (const node of projectedAndNormalised()) {
      if (badgeOf(node) !== "from_brief") continue;
      expect(node.provenance?.provenance_class).toBe("stated");
      const data = (node.data ?? {}) as Record<string, unknown>;
      const observed = (node.observed_state ?? {}) as Record<string, unknown>;
      expect(typeof (observed.value ?? data.value)).toBe("number");
    }
  });

  /** Nothing on any node may ever route to the USER-authored badge. */
  it("never reads user_set for any projected node", () => {
    for (const node of projectedAndNormalised()) {
      expect(badgeOf(node)).not.toBe("user_set");
    }
  });
});

describe("UNDER-CLAIMING — the opposite-direction twin", () => {
  /**
   * The gap direction. A stated figure with no number genuinely cannot claim the
   * brief under the 2.972 rule (a value-free node carries no brief information),
   * and this test pins that we accept that verdict rather than working around it
   * — but it ALSO pins that the node still carries its stated provenance class
   * and the user's verbatim words, so a later slice can surface "you said this"
   * without re-litigating the badge.
   */
  it("a stated but value-free figure loses the badge yet keeps its stated class and quote", () => {
    const node = nodeForQuote(projectedAndNormalised(), "support load is heavy");
    expect(badgeOf(node)).toBe("ai_inferred");
    expect(node.provenance?.provenance_class).toBe("stated");
    expect(node.provenance?.source_quote).toBe("support load is heavy");
  });

  /**
   * The projector claims the brief in EXACTLY ONE place. If a future edit adds a
   * second construction site, this count moves and the test says so — the
   * one-site-per-class mechanism is what makes the honesty structural rather
   * than a matter of care.
   */
  it("exactly one node in this projection claims the brief", () => {
    const claimed = projectedAndNormalised().filter((n) => badgeOf(n) === "from_brief");
    expect(claimed.map((n) => n.provenance?.source_quote)).toEqual(["churn is currently 12%"]);
  });
});
