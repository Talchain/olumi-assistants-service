/**
 * ROUND 10 — THE REFINEMENT PARENT LINK COUNTS STATED OPTIONS, NOT BASIS ENTRIES.
 *
 * `basis.length === 1` was a DEFECT in the implementation of a rule whose own
 * contract (`grammar.ts`) says the refinement must "name exactly one stated
 * `option`". `basis` is an EVIDENCE field the projector repurposed as a parent
 * pointer, so citing a figure alongside the parent option silently vetoed the
 * merge — and the projector then minted a rival option node for one alternative,
 * which is what `OPTIONS_IDENTICAL` fires on.
 *
 * ⭐ THE DISCRIMINATING PAIR IS THE POINT. Neither case alone shows the binding:
 *   · ONE option + a figure  → MUST merge   (the correction)
 *   · TWO options            → MUST NOT merge (the decision that is NOT overturned)
 * A fix that merged everything would pass the first and fail the second; a fix
 * that merged nothing would do the reverse.
 *
 * Both fixtures are the REAL banked shapes, not shapes invented here:
 *   run 16 `5dd2c1dc`  "Defer Germany 12 Months (CFO path)"  basis [19,22] → [option, figure]
 *   run 12 `4ffcc52c`  "Rewrite first, then copilot (sequenced)" basis [1,2] → [option, option]
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * Run 16's shape, reduced to its load-bearing parts: three stated options, a
 * figure, and a refinement of ONE option that also cites the figure.
 */
function runSixteenShape(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "reach £10m ARR by 2027" },
      { kind: "option", source_quote: "push into Germany next year" },
      { kind: "option", source_quote: "double down on the UK" },
      { kind: "figure", source_quote: "we have £3.1m of cash", value: 3.1, unit: "m" },
    ],
    claims: [
      // basis names ONE option (1) plus a FIGURE (3). This is the disputed shape,
      // and it is the most common composition in the banked corpus (34%).
      { claim_kind: "option_refinement", label: "Defer Germany 12 Months (CFO path)", basis: [1, 3] },
      { claim_kind: "factor", label: "German ARR" },
      { claim_kind: "causal_link", label: "Germany drives ARR", from_stated: 1, to_claim: 1, effect: "positive", sets_to: 2 },
      { claim_kind: "causal_link", label: "UK drives ARR", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 1 },
      { claim_kind: "causal_link", label: "ARR reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  };
}

/** Run 12's shape: a refinement naming TWO stated options — a real third alternative. */
function runTwelveShape(): DraftRecordSet {
  const base = runSixteenShape();
  return {
    stated_items: base.stated_items,
    claims: [
      { claim_kind: "option_refinement", label: "Rewrite first, then copilot (sequenced)", basis: [1, 2] },
      ...base.claims.slice(1),
    ],
  };
}

const optionLabels = (records: DraftRecordSet): string[] =>
  projectRecordsToGraph(records)
    .graph.nodes.filter((n) => n.kind === "option")
    .map((n) => n.label)
    .sort();

describe("the parent link counts stated OPTIONS, not basis entries", () => {
  it("MERGES a refinement naming ONE option plus a figure (run 16's shape)", () => {
    const records = runSixteenShape();
    const projection = projectRecordsToGraph(records);

    // PRECONDITION, pinned in-test: the fixture really is the disputed shape —
    // basis length 2, exactly one of which is a stated option. Without this the
    // assertion could pass on a fixture that had quietly become length-1.
    const basis = records.claims[0]!.basis!;
    expect(basis).toHaveLength(2);
    expect(basis.filter((b) => records.stated_items[b]!.kind === "option")).toHaveLength(1);
    expect(records.stated_items[basis[1]!]!.kind).toBe("figure");

    // BOUND BY IDENTITY: the merge is disclosed by reason AND names the claim.
    const merged = projection.dropped.filter((d) => d.reason === "refinement_merged_into_stated_option");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.label).toBe("Defer Germany 12 Months (CFO path)");

    // And the consequence that matters: NO rival option node was minted. The
    // graph carries the user's TWO stated options and nothing else.
    expect(optionLabels(records)).toEqual(["double down on the UK", "push into Germany next year"]);
  });

  it("does NOT merge a refinement naming TWO options (run 12's shape) — the decision that stands", () => {
    const records = runTwelveShape();
    const projection = projectRecordsToGraph(records);

    // PRECONDITION: two stated options in the basis, so this is genuinely the
    // other arm of the pair and not a second copy of the first case.
    const basis = records.claims[0]!.basis!;
    expect(basis.filter((b) => records.stated_items[b]!.kind === "option")).toHaveLength(2);

    expect(
      projection.dropped.filter((d) => d.reason === "refinement_merged_into_stated_option"),
    ).toHaveLength(0);
    // It stands as its own alternative — three option nodes, not two.
    expect(optionLabels(records)).toEqual([
      "Rewrite first, then copilot (sequenced)",
      "double down on the UK",
      "push into Germany next year",
    ]);
  });

  it("still does not merge a refinement naming NO stated option", () => {
    // 18% of the corpus. A refinement citing only figures has no parent to bind
    // to, and inventing one would be worse than leaving it standing.
    const base = runSixteenShape();
    const records: DraftRecordSet = {
      stated_items: base.stated_items,
      claims: [{ ...base.claims[0]!, basis: [3] }, ...base.claims.slice(1)],
    };
    expect(
      projectRecordsToGraph(records).dropped.filter(
        (d) => d.reason === "refinement_merged_into_stated_option",
      ),
    ).toHaveLength(0);
  });

  it("treats an option named TWICE in one basis as ONE option", () => {
    // `[1,1,3]` names one option, twice. The dedup is what makes the count a
    // count of OPTIONS rather than of entries that happen to be options.
    const base = runSixteenShape();
    const records: DraftRecordSet = {
      stated_items: base.stated_items,
      claims: [{ ...base.claims[0]!, basis: [1, 1, 3] }, ...base.claims.slice(1)],
    };
    const merged = projectRecordsToGraph(records).dropped.filter(
      (d) => d.reason === "refinement_merged_into_stated_option",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.label).toBe("Defer Germany 12 Months (CFO path)");
  });

  it("still refuses to merge TWO refinements of the same option — the choice-set guard", () => {
    // Unchanged by round 10 and asserted so, because widening the parent test
    // increases how often two refinements can land on one parent. Two competing
    // sub-alternatives of one stated option are NOT one thing under two names,
    // and collapsing them would narrow the user's choice set.
    const base = runSixteenShape();
    const records: DraftRecordSet = {
      stated_items: base.stated_items,
      claims: [
        { claim_kind: "option_refinement", label: "Germany direct, full BaFin", basis: [1, 3] },
        { claim_kind: "option_refinement", label: "Germany via a local partner", basis: [1, 3] },
        ...base.claims.slice(1),
      ],
    };
    const projection = projectRecordsToGraph(records);
    expect(
      projection.dropped.filter((d) => d.reason === "refinement_merged_into_stated_option"),
    ).toHaveLength(0);
    expect(optionLabels(records)).toContain("Germany direct, full BaFin");
    expect(optionLabels(records)).toContain("Germany via a local partner");
  });
});
