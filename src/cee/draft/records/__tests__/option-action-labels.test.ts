/**
 * ⭐⭐ AN OPTION IS A COURSE OF ACTION, AND ITS LABEL IS THE NAME OF THAT ACTION.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * Option nodes that shipped, were scored and were ranked with win probabilities
 * on the deployed build, across 16 signed-in runs and 7 realistic briefs:
 *
 *   "Should we hire a sales lead?"                    ← the user's own question,
 *                                                       and it became the
 *                                                       BASELINE option
 *   "events budget which everyone loves but I've
 *    never seen a deal come out of one"
 *   "We do not know what local certification would
 *    cost or how long it takes"                       ← a stated unknown
 *   "Today, suitability records are captured in free
 *    text by 60 advisers across four offices…"        ← win probability 0.0542
 *
 * ── THE CAUSE, DERIVED AT THE BYTES ────────────────────────────────────────
 * On the live records path an option node's label IS `stated_items[].source_quote`
 * (`projector.ts`), and `instruction.ts` REQUIRES that field to be copied
 * verbatim. A `stated_item` has no `label` field, so no instruction addressed to
 * the model could author an option label — the display string was a provenance
 * field, exactly as the goal's was before `deriveGoalObjectiveLabel`.
 *
 * ── WHY THIS CORPUS, AND NOT FIXTURES ──────────────────────────────────────
 * Every assertion here is a predicate over natural language, so a corpus from
 * the author's head cannot see the class the author did not imagine (trap 22).
 * Three sources, none of them written to pass:
 *   1. the FROZEN GOVERNED BASELINE — 37 stated option quotes across 14 real
 *      staging captures at `b9389df` against served prompt v195, already
 *      in-tree, read and never rewritten (trap 14b);
 *   2. the SIX WITNESSED LABELS above, taken from the deployed build;
 *   3. their OPPOSITE-DIRECTION TWINS — spans where the user effectively
 *      supplied the name and the whole harm is a label that no longer sounds
 *      like theirs.
 *
 * ⚠ THE KNOWN-AUTHORED SET IS PINNED BY NAME, so it REDs if it grows OR shrinks
 * (trap 22f's honest-gap discipline). A silent widening is the direction that
 * puts words in the user's mouth; a silent narrowing means the fix stopped
 * working and every suite still passes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import { deriveOptionActionLabel, labelIsDerivedFrom } from "../objective-label.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

const canonical = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Every DISTINCT stated-option quote in the frozen governed baseline. */
function governedStatedOptionQuotes(): readonly string[] {
  const run = JSON.parse(fs.readFileSync(GOVERNED, "utf8")) as {
    run: {
      cases: readonly {
        readonly graph?: {
          readonly nodes?: readonly {
            readonly kind: string;
            readonly provenance?: { readonly source_quote?: string };
          }[];
        };
      }[];
    };
  };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of run.run.cases) {
    for (const node of c.graph?.nodes ?? []) {
      if (node.kind !== "option") continue;
      const quote = node.provenance?.source_quote;
      if (typeof quote !== "string" || quote.length === 0 || seen.has(quote)) continue;
      seen.add(quote);
      out.push(quote);
    }
  }
  return out;
}

/**
 * ⭐ THE KNOWN-AUTHORED SET — 11 of the 37 governed stated-option quotes.
 *
 * Pinned as PAIRS rather than as a count: a count cannot tell "the same eleven
 * still author correctly" from "eleven author, four of them differently now".
 */
const GOVERNED_AUTHORED: ReadonlyArray<readonly [string, string]> = [
  ["keep it as is", "Keep It as Is"],
  ["hire more engineers", "Hire More Engineers"],
  ["focus on sales", "Focus on Sales"],
  ["invest £800k in robotic picking systems", "Invest £800k in Robotic Picking Systems"],
  ["invest in our own retail stores", "Invest in Our Own Retail Stores"],
  [
    "launch a wholesale channel to department stores",
    "Launch a Wholesale Channel to Department Stores",
  ],
  ["partner with third-party couriers", "Partner With Third-Party Couriers"],
  ["build our own last-mile delivery fleet", "Build Our Own Last-Mile Delivery Fleet"],
  ["keeping weekly deliveries", "Keep Weekly Deliveries"],
  ["launch our own subscription offering", "Launch Our Own Subscription Offering"],
  ["always done bespoke client work", "Always Done Bespoke Client Work"],
];

describe("the governed corpus: what authors, and nothing else", () => {
  it("authors EXACTLY the known set, label for label", () => {
    const quotes = governedStatedOptionQuotes();
    // The corpus itself is asserted non-empty first: a probe that read nothing
    // agrees with every other probe that read nothing (standing brief §4).
    expect(quotes.length).toBe(37);

    const authored = quotes
      .map((quote) => [quote, deriveOptionActionLabel(quote)] as const)
      .filter(([, result]) => result.authored)
      .map(([quote, result]) => [quote, result.label] as const);

    expect(authored).toEqual(GOVERNED_AUTHORED);
  });

  it("never emits a token the user did not write — over the WHOLE corpus, not the authored half", () => {
    for (const quote of governedStatedOptionQuotes()) {
      const result = deriveOptionActionLabel(quote);
      expect(labelIsDerivedFrom(result.label, quote), quote).toBe(true);
    }
  });

  it("a refusal returns the verbatim BYTE-FOR-BYTE, so refusing cannot regress a label", () => {
    // The safety argument of the whole module: over-refusal costs nothing
    // because the fallback IS the shipped behaviour. Asserted, not argued.
    for (const quote of governedStatedOptionQuotes()) {
      const result = deriveOptionActionLabel(quote);
      if (result.authored) continue;
      expect(result.label, quote).toBe(canonical(quote));
    }
  });

  it("`authored` holds exactly when the label changed — the flag is derived, never asserted", () => {
    for (const quote of governedStatedOptionQuotes()) {
      const result = deriveOptionActionLabel(quote);
      expect(result.authored, quote).toBe(canonical(result.label) !== canonical(quote));
    }
  });
});

/**
 * ⭐⭐ THE SIX WITNESSED LABELS — AND THE HONEST RESULT IS THAT ALL SIX REFUSE.
 *
 * Five of them are not courses of action at all (a question, a stated unknown,
 * two pieces of history, one description of how things work today) and the
 * sixth is the decision question. **A tidier label for a non-option would make
 * a classification defect HARDER to see, not easier**, so the label path
 * refuses and the classification half is answered in the instruction's `option`
 * bullet (`instruction-pin.test.ts`, the v9 rules). Two questions, two
 * mechanisms, deliberately not merged into one predicate (trap 21).
 *
 * The reason is pinned per case, not just the refusal: a refusal reached for
 * the wrong reason is a guard agreeing with itself (trap 13b).
 */
describe("the six labels witnessed on the deployed build", () => {
  const WITNESSED: ReadonlyArray<readonly [string, string]> = [
    ["Should we hire a sales lead?", "asks_a_question"],
    [
      "events budget which everyone loves but I've never seen a deal come out of one",
      "clause_discarded",
    ],
    ["I have not seen the certification question addressed in it", "head_disclaims"],
    ["We do not know what local certification would cost or how long it takes", "states_alternatives"],
    [
      "Today, suitability records are captured in free text by 60 advisers across four offices",
      "no_concise_form",
    ],
    ["Last year I split the budget 70/20/10 and everyone was unhappy", "no_concise_form"],
  ];

  it.each(WITNESSED)("refuses %j, and refuses it for the stated reason", (quote, reason) => {
    const result = deriveOptionActionLabel(quote);
    expect(result.authored).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.label).toBe(quote);
  });

  it("the question refusal is structural, not a phrase list — the same span WITHOUT the question mark is authored", () => {
    // ⭐ THE DISCRIMINATING PAIR FOR THE ONE NEW PREDICATE. If `asks_a_question`
    // were matching on "should we" it would be indistinguishable from the
    // deliberation frame; varying ONLY the terminal punctuation on a span with
    // no frame proves it is the `?` doing the work.
    expect(deriveOptionActionLabel("hire a sales lead?").reason).toBe("asks_a_question");
    expect(deriveOptionActionLabel("hire a sales lead").label).toBe("Hire a Sales Lead");
  });
});

/**
 * ⭐⭐ THE OPPOSITE-DIRECTION HARM, AND IT IS THE ONE THAT MATTERS MOST.
 *
 * "A label so aggressively normalised that the user cannot recognise their own
 * idea is worse than a clumsy one." Where the user effectively supplied the
 * name, every word of it must survive — so these assert the FULL label, not a
 * containment, because a containment passes on a truncation.
 */
describe("a name the user supplied comes through intact", () => {
  const SUPPLIED: ReadonlyArray<readonly [string, string]> = [
    // Distinctive user casing is returned byte-identical — re-casing `HubSpot`
    // would be editing the user's own notation.
    ["Phased HubSpot pilot", "Phased HubSpot Pilot"],
    ["hire a sales lead", "Hire a Sales Lead"],
    ["the events budget", "The Events Budget"],
    ["outsourcing the whole function", "Outsource the Whole Function"],
    ["keep what we have", "Keep What We Have"],
    // Every clause survives: nothing here may settle half of a two-part move.
    ["hold price and push volume instead", "Hold Price and Push Volume Instead"],
  ];

  it.each(SUPPLIED)("keeps the user's meaning in %j", (quote, expected) => {
    const result = deriveOptionActionLabel(quote);
    expect(result.label).toBe(expected);
    expect(labelIsDerivedFrom(result.label, quote)).toBe(true);
  });

  it("refuses rather than settling a choice the user has not made", () => {
    // The harm this closes is the goal path's measured one, in option clothing:
    // dropping an `or` branch asserts one alternative the user left open.
    const both = deriveOptionActionLabel("build our own fleet or partner with a courier");
    expect(both.authored).toBe(false);
    expect(both.reason).toBe("states_alternatives");
  });

  /**
   * ⚠ THIS TEST'S FIRST EXPECTATION WAS WRONG AND THE CODE WAS RIGHT — recorded
   * because it is the exact shape of trap 13c. I asserted that a qualified span
   * REFUSES, which was the failure mode I had in mind rather than the spec. The
   * spec is *nothing propositional may be discarded*, and a comma-joined
   * qualification is not discarded by any whitelisted transformation, so the
   * honest outcome is that it is CARRIED, in full, into the label. Rewritten as
   * the spec-level invariant: a qualification is kept whole, or the derivation
   * refuses. It is never dropped, and the three constructions below are the
   * three ways that can come out.
   */
  it("a qualification is carried whole, or refused — never dropped", () => {
    // Carried: no whitelisted transformation cuts at a comma, so every word stays.
    const comma = deriveOptionActionLabel("raise prices, but only for new customers");
    expect(comma.authored).toBe(true);
    expect(comma.label).toBe("Raise Prices, but Only for New Customers");

    // Refused: an em-dash preamble cut would leave "Raise Prices", which
    // CONTRADICTS its own quote while using only the user's words.
    const dash = deriveOptionActionLabel("raise prices — but only for new customers");
    expect(dash.authored).toBe(false);
    expect(dash.reason).toBe("clause_discarded");

    // Refused: the same harm inside a parenthetical.
    const aside = deriveOptionActionLabel(
      "move the whole estate to Azure (but not the payments platform)",
    );
    expect(aside.authored).toBe(false);
    expect(aside.reason).toBe("clause_discarded");
  });

  it("is idempotent — an authored label fed back in is returned unchanged", () => {
    const once = deriveOptionActionLabel("launch our own subscription offering");
    expect(once.authored).toBe(true);
    const twice = deriveOptionActionLabel(once.label);
    expect(twice.label).toBe(once.label);
    expect(twice.authored).toBe(false);
    expect(twice.reason).toBe("identical_to_quote");
  });
});

/**
 * ⭐⭐⭐ THE PROJECTOR AND THE WIRE — AND THE BLOCKER THE GOAL LANE NAMED.
 *
 * `projector.ts` recorded: *"Option labels are NOT touched: `schema-v3.ts:1130`
 * binds an option's provenance on its LABEL, so authoring one flips
 * `from_brief` → `ai_inferred`."* Re-derived at those bytes: `projectNodeProvenance`
 * reads the TYPED record provenance first and `continue`s for EVERY kind, so a
 * records-path option never reaches the label binding at all. These tests are
 * that refutation, executed rather than argued — if the typed branch is ever
 * reordered behind the label binding, the provenance assertion REDs.
 */
describe("the user's exact words survive authoring, and the badge does not move", () => {
  const BRIEF =
    "We are weighing what to do next. We could launch our own subscription offering, " +
    "or carry on as we always have done bespoke client work.";

  const RECORDS: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue" },
      { kind: "option", source_quote: "launch our own subscription offering" },
      { kind: "option", source_quote: "always done bespoke client work", is_baseline: true },
    ],
    claims: [
      { claim_kind: "factor", label: "Recurring Revenue Share", basis: [1] },
      { claim_kind: "outcome", label: "Revenue", basis: [0] },
      {
        claim_kind: "causal_link",
        label: "subscription lifts recurring share",
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "bespoke holds recurring share",
        from_stated: 2,
        to_claim: 0,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "recurring share lifts revenue",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "revenue reaches the goal",
        from_claim: 1,
        to_stated: 0,
        effect: "positive",
      },
    ],
  };

  /**
   * ⭐ THE RECORD IS UNTOUCHED, AND THAT IS THE POINT OF AUTHORING AT THE WIRE.
   * `projector-behaviour.test.ts`'s C-K4 states the projector's invariant — a
   * stated node's label is the canonicalised quote, verbatim — and this change
   * does not weaken it. Asserted here as well as there, because a reader of THIS
   * file needs to know where the split falls.
   */
  it("the RECORD still carries the verbatim label — the projector authors nothing for an option", () => {
    const projected = projectRecordsToGraph(RECORDS, BRIEF).graph;
    // Bound by IDENTITY — the source quote — never by a value predicate another
    // option could satisfy (trap 19).
    const option = projected.nodes.find(
      (n) => n.provenance?.source_quote === "launch our own subscription offering",
    );
    expect(option?.kind).toBe("option");
    expect(option?.label).toBe("launch our own subscription offering");
    expect(option?.provenance?.label_authored).toBeUndefined();
    expect(option?.provenance?.provenance_class).toBe("stated");
  });

  it("the WIRE node reads as a name, keeps the verbatim beside it, and says the label is ours", () => {
    const projected = projectRecordsToGraph(RECORDS, BRIEF).graph;
    const projection = projectGraphAndOptionsToV3(projected as never, { brief: BRIEF });
    const wire = projection.graph.nodes.find(
      (n) => n.source_quote === "launch our own subscription offering",
    );
    expect(wire?.kind).toBe("option");
    expect(wire?.label).toBe("Launch Our Own Subscription Offering");
    expect(wire?.label_authored).toBe(true);
  });

  it("a refused option keeps its verbatim label on the wire AND carries no label_authored", () => {
    const records: DraftRecordSet = {
      ...RECORDS,
      stated_items: [
        RECORDS.stated_items[0]!,
        { kind: "option", source_quote: "Should we hire a sales lead?" },
        RECORDS.stated_items[2]!,
      ],
    };
    const projected = projectRecordsToGraph(records, BRIEF).graph;
    const projection = projectGraphAndOptionsToV3(projected as never, { brief: BRIEF });
    const wire = projection.graph.nodes.find(
      (n) => n.source_quote === "Should we hire a sales lead?",
    );
    expect(wire?.label).toBe("Should we hire a sales lead?");
    expect(wire?.label_authored).toBeUndefined();
  });

  it("authoring the label does NOT move the option's provenance badge", () => {
    // The refuted blocker, executed rather than argued: if the typed-provenance
    // branch is ever reordered behind the label binding at `schema-v3.ts:1188`,
    // this REDs.
    const projected = projectRecordsToGraph(RECORDS, BRIEF).graph;
    const projection = projectGraphAndOptionsToV3(projected as never, { brief: BRIEF });
    const wire = projection.graph.nodes.find(
      (n) => n.source_quote === "launch our own subscription offering",
    );
    expect(wire?.provenance).toBe("from_brief");
  });

  it("the graph node and the top-level option carry ONE name, not two", () => {
    // Two labels for one option is the defect this change exists to fix, one
    // level up: the canvas reads `nodes[]` and the ranked list reads `options[]`.
    const projected = projectRecordsToGraph(RECORDS, BRIEF).graph;
    const projection = projectGraphAndOptionsToV3(projected as never, { brief: BRIEF });
    const wire = projection.graph.nodes.find(
      (n) => n.source_quote === "launch our own subscription offering",
    );
    const option = projection.options.find((o) => o.id === wire?.id);
    expect(option?.label).toBe("Launch Our Own Subscription Offering");
  });

  it("`options[].provenance.brief_quote` is the user's QUOTE, never the authored label", () => {
    // The one real coupling the projector's old comment named. A label sitting
    // in a field called `brief_quote` is a display string wearing a provenance
    // field's name — the very defect this change exists to undo, one level down.
    const projected = projectRecordsToGraph(RECORDS, BRIEF).graph;
    const projection = projectGraphAndOptionsToV3(projected as never, { brief: BRIEF });
    const wire = projection.graph.nodes.find(
      (n) => n.source_quote === "launch our own subscription offering",
    );
    const option = projection.options.find((o) => o.id === wire?.id);
    expect(option?.provenance?.source).toBe("brief_extraction");
    expect(option?.provenance?.brief_quote).toBe("launch our own subscription offering");
  });

  it("a LEGACY graph node — no typed record — is not touched at all", () => {
    // ⭐ THE DISCRIMINATING TWIN FOR THE `source_quote` GATE. On the legacy path
    // an option's provenance genuinely IS bound on its label (`:1188`), so
    // authoring there would flip the badge. The gate is the presence of a typed
    // record; this proves it discriminates rather than merely existing.
    const legacy = {
      version: "1",
      nodes: [
        { id: "goal_1", kind: "goal", label: "grow revenue" },
        {
          id: "opt_1",
          kind: "option",
          label: "launch our own subscription offering",
          data: { interventions: {} },
        },
      ],
      edges: [],
    };
    const projection = projectGraphAndOptionsToV3(legacy as never, {
      brief: "We could launch our own subscription offering.",
    });
    const wire = projection.graph.nodes.find((n) => n.kind === "option");
    expect(wire?.label).toBe("launch our own subscription offering");
    expect(wire?.label_authored).toBeUndefined();
    expect(wire?.provenance).toBe("from_brief");
  });
});
