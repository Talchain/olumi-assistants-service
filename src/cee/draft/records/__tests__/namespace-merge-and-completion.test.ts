/**
 * ROUND 7 — the typed reference namespace, the kind-legality gate, the
 * option-duplication merge, and the completion pass.
 *
 * ── WHAT THE PRISTINE FAILURE WAS, AND WHERE THESE FIXTURES COME FROM ──────
 * These are not invented shapes. On the long brief B1 the model emitted a
 * complete 23-item / 34-claim record set in which the only three links intended
 * to terminate at the goal carried `to_ref="c0"`. The goal was `s0`; `c0` was
 * `claims[0]`, an `option_refinement`. Every reference RESOLVED — to the wrong
 * node — so nothing reached the goal, the connectivity prune withdrew everything
 * that could not, and the projection collapsed to 8 nodes / 6 edges. Measured at
 * pristine `4a0538ba` against the real banked emission before any of this was
 * written.
 *
 * ⚠ AND THE THREE BAD LINKS WERE TWO DIFFERENT DEFECTS, which is why there are
 * two mechanisms here and not one. `c25`/`c28` said "…contributes to ARR goal"
 * and meant `s0` — a namespace slip, which the typed fields remove. `c29` said
 * "Cash runway adequacy constrains ability to sustain Germany investment" and
 * meant the OPTION — a correctly-referenced, deliberately-intended
 * `factor → option`, which no reference-namespace change can reach and which
 * only the kind gate catches. Round 6 recorded all three as one defect; a lane
 * that inherited that reading would have shipped the typed fields alone, watched
 * B1 fail again, and blamed the typed fields.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import { projectDraftRecords, findGrammarFieldsDroppedBySeam } from "../seam.js";
import { enumerateCompletionAsk, mergeCompletionClaims, buildRecordsCompletionSchema } from "../completion.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * B1's shape, reduced to the parts that carry the defect and named for them.
 * `stated_items[0]` is the goal; `stated_items[1]` the user's own option;
 * `claims[0]` the refinement of it; `claims[1]` the factor; `claims[2]` the
 * link that MEANT the goal and named the refinement instead.
 */
const B1_SHAPE: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "get to £20m ARR by end of FY28" },
    { kind: "option", source_quote: "Germany in 2027" },
  ],
  claims: [
    { claim_kind: "option_refinement", label: "Germany Direct Entry (full BaFin + local hires)", basis: [1] },
    { claim_kind: "factor", label: "Germany new-logo pipeline", basis: [1] },
    // ⭐ THE DEFECT, verbatim in shape: meant `to_stated: 0` (the goal).
    { claim_kind: "causal_link", label: "Germany new-logo pipeline contributes to ARR goal", from_claim: 1, to_claim: 0, effect: "positive" },
  ],
};

describe("⭐ the namespace residue is CAUGHT at emission, never silently mis-bound", () => {
  it("rejects and DISCLOSES a link into an option, naming both resolved kinds", () => {
    const { dropped, graph } = projectRecordsToGraph(B1_SHAPE);

    // Bound by IDENTITY — the claim index and the label — not by a value
    // predicate another disclosure could satisfy (trap 19). `dropped` carries
    // several reasons on this fixture and a `.find(d => d.reason === ...)`
    // would pass on any of them.
    const illegal = dropped.find((d) => d.claim_index === 2);
    expect(illegal?.label).toBe("Germany new-logo pipeline contributes to ARR goal");
    expect(illegal?.reason).toBe("ref_kind_illegal");
    expect(illegal?.from_kind).toBe("factor");
    expect(illegal?.to_kind).toBe("option");
    // The reference is rendered by NAMESPACE, so a reader can see which list was
    // indexed without decoding a token.
    expect(illegal?.to_ref).toBe("claims[0]");

    // And it never became an edge. This is the whole point: at pristine it DID
    // become one, pointing at an option, and the graph died downstream.
    expect(graph.edges.some((e) => e.to === graph.nodes.find((n) => n.kind === "option")?.id && e.from !== graph.nodes.find((n) => n.kind === "decision")?.id)).toBe(false);
  });

  it("OPPOSITE-DIRECTION TWIN — the shapes a repair DOES rescue are NOT rejected", () => {
    // ⚠ The failure this guards is the one that would do real harm: a projector
    // that rejected everything `ALLOWED_EDGES` alone calls illegal would DELETE
    // causality the pipeline legitimately repairs. `factor → goal` is bridged by
    // `fixFactorGoalEdges`; `constraint → goal` is legal as `risk → goal` after
    // `NODE_KIND_MAP` maps constraint→risk; `option → goal` is rerouted by
    // `fixOptionGoalShortcut`. All three must survive this projector untouched.
    const rescued: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire more people" },
        { kind: "constraint", source_quote: "cash must stay above £1m", value: 1_000_000, direction: "floor" },
      ],
      claims: [
        { claim_kind: "factor", label: "sales capacity", basis: [1] },
        { claim_kind: "causal_link", label: "hiring lifts capacity", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "capacity lifts revenue", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "the cash floor bears on revenue", from_stated: 2, to_stated: 0, effect: "negative" },
      ],
    };
    const { dropped, graph } = projectRecordsToGraph(rescued);
    expect(dropped.filter((d) => d.reason === "ref_kind_illegal")).toEqual([]);
    // Non-vacuity: the three links really were built, so "none rejected" is a
    // statement about edges that exist rather than about an empty set.
    expect(graph.edges.filter((e) => e.provenance_source === "inferred")).toHaveLength(3);
  });

  it("THE ONE EDGE RULE — refuses a link INTO a factor an option acts on", () => {
    // B3's entire failure: three edges, all this one shape. `ALLOWED_EDGES`
    // admits `factor → factor` only when the TARGET is observable or external,
    // and `inferFactorCategories` makes a factor `controllable` EXACTLY when an
    // option points at it — so a link into an option-targeted factor is illegal
    // and no sweep stage rewrites `factor → factor`.
    const oneEdge: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire more people" },
      ],
      claims: [
        { claim_kind: "factor", label: "sales capacity", basis: [1] },
        { claim_kind: "factor", label: "market conditions" },
        { claim_kind: "causal_link", label: "hiring lifts capacity", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "capacity lifts revenue", from_claim: 0, to_stated: 0, effect: "positive" },
        // ⭐ ILLEGAL: `market conditions` points INTO the option-controlled factor.
        { claim_kind: "causal_link", label: "conditions bear on capacity", from_claim: 1, to_claim: 0, effect: "negative" },
      ],
    };
    const { dropped } = projectRecordsToGraph(oneEdge);
    const d = dropped.find((x) => x.claim_index === 4);
    expect(d?.label).toBe("conditions bear on capacity");
    expect(d?.reason).toBe("ref_kind_illegal");
    expect(d?.from_kind).toBe("factor");
    expect(d?.to_kind).toBe("factor");

    // ⚠ DISCRIMINATING TWIN. The SAME `factor → factor` shape is LEGAL when the
    // target is not option-controlled — otherwise the rule would forbid every
    // chain the instruction asks for. Without this half, a mutant that rejected
    // all factor→factor links would pass the assertion above.
    const legal = projectRecordsToGraph({
      ...oneEdge,
      claims: [
        ...oneEdge.claims.slice(0, 4),
        { claim_kind: "causal_link", label: "capacity bears on conditions", from_claim: 0, to_claim: 1, effect: "negative" },
      ],
    });
    expect(legal.dropped.find((x) => x.claim_index === 4)?.reason).not.toBe("ref_kind_illegal");
  });

  it("refuses BOTH namespace fields on one endpoint rather than preferring either", () => {
    const { dropped } = projectRecordsToGraph({
      stated_items: [{ kind: "goal", source_quote: "grow revenue" }],
      claims: [{ claim_kind: "causal_link", label: "contradictory", from_stated: 0, to_stated: 0, to_claim: 0 }],
    });
    const d = dropped.find((x) => x.claim_index === 0);
    expect(d?.reason).toBe("ambiguous_ref");
    expect(d?.to_ref).toBe("stated_items[0]+claims[0]");
  });
});

describe("⭐ the option-duplication merge is deterministic, and knows where NOT to fire", () => {
  it("binds a lone refinement to its stated parent instead of minting a second option", () => {
    const { graph, provenance, dropped } = projectRecordsToGraph(B1_SHAPE);
    const options = graph.nodes.filter((n) => n.kind === "option");
    expect(options).toHaveLength(1);

    // Bound by identity: the surviving option is the USER'S, carrying their
    // verbatim quote — never the model's refinement wording, which badged
    // `stated` would be a misrepresentation of the user to themselves.
    const option = options[0]!;
    expect(option.label).toBe("Germany in 2027");
    expect(provenance[option.id]?.provenance_class).toBe("stated");
    expect(provenance[option.id]?.source_quote).toBe("Germany in 2027");
    // APPEND-ONLY: the refinement is recorded alongside, not merged into, the quote.
    expect(provenance[option.id]?.merged_refinements).toEqual([
      "Germany Direct Entry (full BaFin + local hires)",
    ]);
    // …and the merge is DISCLOSED, never silent.
    expect(dropped.find((d) => d.claim_index === 0)?.reason).toBe("refinement_merged_into_stated_option");
  });

  it("DOES NOT fire when one option has TWO refinements — they are distinct alternatives", () => {
    // ⚠ THE HARM THIS PREVENTS is the one a decision tool may never commit:
    // silently narrowing the user's own choice set. Two refinements of one
    // option are competing sub-alternatives, not two names for one thing.
    const twoRefinements: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "expand into Germany" },
      ],
      claims: [
        { claim_kind: "option_refinement", label: "Germany direct", basis: [1] },
        { claim_kind: "option_refinement", label: "Germany via partner", basis: [1] },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(twoRefinements);
    expect(dropped.filter((d) => d.reason === "refinement_merged_into_stated_option")).toEqual([]);
    expect(graph.nodes.filter((n) => n.kind === "option").map((n) => n.label).sort()).toEqual([
      "Germany direct",
      "Germany via partner",
      "expand into Germany",
    ]);
  });

  it("DOES NOT fire when the refinement's basis names more than one stated item", () => {
    // B1's `c3` — basis [19,20], "Defer Germany 12 months, accelerate UK NRR" —
    // is a genuinely distinct alternative and correctly keeps its own node.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "Germany in 2027" },
        { kind: "option", source_quote: "UK depth" },
      ],
      claims: [{ claim_kind: "option_refinement", label: "Defer Germany, accelerate UK", basis: [1, 2] }],
    });
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(3);
  });
});

describe("⭐ the seam carries every field the grammar declares", () => {
  it("DERIVED — no grammar-declared property is dropped by the rebuild", () => {
    // The guard that would have caught `sets_to` shipping dark. It BUILDS a
    // probe record set carrying every declared key and RUNS the real seam, so it
    // cannot be satisfied by a list someone remembered to update (trap 13b).
    expect(findGrammarFieldsDroppedBySeam()).toEqual({ claims: [], statedItems: [] });
  });

  it("carries `sets_to` through to an intervention — the field that was dark", () => {
    // ⚠ RED AT PRISTINE. `sets_to` was in the grammar, the instruction and the
    // projector, and absent from the seam's field-by-field rebuild, so every
    // live draft parsed the magnitude and discarded it one line before
    // projection. `OptionData.interventions` was never populated on any real
    // run. Every interventions test called `projectRecordsToGraph` DIRECTLY and
    // so could not see it — this one goes through the seam on purpose.
    const result = projectDraftRecords({
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire more people" },
      ],
      claims: [
        { claim_kind: "factor", label: "sales capacity", basis: [1] },
        { claim_kind: "causal_link", label: "hiring lifts capacity", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 42 },
        { claim_kind: "causal_link", label: "capacity lifts revenue", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.claims[1]?.sets_to).toBe(42);

    const option = result.projection.graph.nodes.find((n) => n.label === "hire more people")!;
    const factor = result.projection.graph.nodes.find((n) => n.label === "sales capacity")!;
    // Keyed by the MINTED id of the factor the link named — identity, not position.
    expect((option.data as { interventions?: Record<string, number> }).interventions).toEqual({
      [factor.id]: 42,
    });
  });
});

describe("⭐ the completion pass asks about gaps, and only about gaps", () => {
  const unconnectedFigure: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue" },
      { kind: "option", source_quote: "hire more people" },
      { kind: "figure", source_quote: "NRR is 112%", value: 112, unit: "%" },
    ],
    claims: [
      { claim_kind: "factor", label: "sales capacity", basis: [1] },
      { claim_kind: "causal_link", label: "hiring lifts capacity", from_stated: 1, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "capacity lifts revenue", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };

  it("never asks the model to connect a record it CORRECTLY declined to connect", () => {
    // ⚠ THE INVENTION HAZARD, and this lane shipped it in its first attempt: an
    // ask built from every `unconnected_to_goal` disclosure listed 24 of B1's 40
    // items as problems, all of them stated figures the model was right to leave
    // unconnected. The projector withholds them precisely so they cannot
    // manufacture `NO_PATH_TO_GOAL`; the validator never sees them. Asking is
    // pressure to invent a causal link for a figure that has none — the exact
    // pressure the grammar declines to apply by refusing to floor `claims`.
    const projection = projectRecordsToGraph(unconnectedFigure);
    // Non-vacuity: the disclosure really is present, so "not asked about" is a
    // statement about a real record rather than an empty set.
    expect(projection.dropped.some((d) => d.reason === "unconnected_to_goal" && d.label === "NRR is 112%")).toBe(true);

    const ask = enumerateCompletionAsk(unconnectedFigure, projection);
    expect(ask.items.filter((i) => i.kind === "unconnected_record")).toEqual([]);
    // This set has no gaps at all, so no completion turn is spent on it.
    expect(ask.items).toEqual([]);
  });

  it("asks about an option with no chain to the goal, and reports the append base", () => {
    const bare: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire more people" },
        { kind: "option", source_quote: "do nothing" },
      ],
      claims: [],
    };
    const ask = enumerateCompletionAsk(bare, projectRecordsToGraph(bare));
    expect(ask.items.filter((i) => i.kind === "option_without_chain")).toHaveLength(2);
    expect(ask.baseClaimIndex).toBe(0);
  });

  it("APPEND-ONLY — existing indices are preserved and stated_items are untouched", () => {
    const merged = mergeCompletionClaims(unconnectedFigure, {
      claims: [{ claim_kind: "factor", label: "brand awareness" }],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    // Every pre-existing claim keeps the index every reference on the wire used.
    expect(merged.records.claims.slice(0, 3)).toEqual(unconnectedFigure.claims);
    expect(merged.records.claims[3]?.label).toBe("brand awareness");
    expect(merged.records.stated_items).toBe(unconnectedFigure.stated_items);
  });

  it("REFUSES a completion that carries stated_items, even though the schema forbids them", () => {
    // The property that the user's own words are untouched must never be
    // discovered lost, and a guarantee resting on "the schema wouldn't let it"
    // is a guarantee with no witness.
    expect(mergeCompletionClaims(unconnectedFigure, { stated_items: [], claims: [] })).toEqual({
      ok: false,
      reason: "stated_items_disturbed",
    });
  });

  it("the completion grammar CANNOT express a user quote — structurally, not by instruction", () => {
    const schema = buildRecordsCompletionSchema() as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["claims"]);
    expect(schema.required).toEqual(["claims"]);
    // A fabricated `source_quote` would wear a `stated` provenance badge. There
    // is no field through which the second turn could produce one.
    expect(JSON.stringify(schema)).not.toContain("stated_items");
    expect(JSON.stringify(schema)).not.toContain("source_quote");
  });
});
