/**
 * ⭐⭐ THE OPTION LABEL IS AUTHORED BY THE SAME AUTHORITY AS THE GOAL LABEL —
 * AND THIS SUITE ALSO PINS, BY NAME, EVERYTHING THAT AUTHORITY CANNOT REACH.
 *
 * ── THE WITNESSED DEFECT (two independent witnesses, 18 Aug 2026) ──────────
 * `COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`, link 2 PARTIAL: the two options
 * the USER stated keep `label === source_quote` exactly, at 85 and 101
 * characters, and truncate mid-phrase on an unclosed `(`:
 *
 *     • double down on enterprise sales (higher          ← no ellipsis
 *     Configure double down on enterprise sales (higher…  ← the repair chip
 *
 * `UX-GATE-2026-08-18.md`: the drafted GOAL is a raw lifted fact, 90
 * characters, and it is the string truncated mid-phrase in Olumi's opening
 * sentence.
 *
 * It is not cosmetic. Ledger N-26: three downstream guards need a full label,
 * word-bounded, inside the user's message to identify which entity the user
 * means. Against an 85-101 character label they go blind.
 *
 * ── THE CANONICAL AUTHORITY, AND WHAT THIS CHANGES ─────────────────────────
 * `objective-label.ts` is the single authority for a stated node's DISPLAY
 * label. Before this change the projector called it for `goal` alone
 * (`projector.ts`, "⚠ SCOPED TO `goal`"), so an option's label was still its
 * `source_quote` — a field whose producer declares it PROVENANCE
 * (`instruction.ts`: "copied VERBATIM … do not paraphrase, tidy, translate or
 * summarise"). This suite drives the authority over `option` as well.
 *
 * ── ⚠⚠ AND THE PREMISE IT REFUTES, MEASURED BEFORE ANY CODE WAS WRITTEN ────
 * "Apply the existing label-authoring path uniformly" was expected to fix the
 * witnessed defect. **It does not, and the numbers are pinned below so nobody
 * has to re-derive them.** Over the 37 governed option nodes carrying
 * `label === source_quote`, the authority authors 14 and refuses 23 — and of
 * the 14, **twelve are pure title-casing and only TWO get shorter, by 6 and 3
 * characters.** Not one long label is reduced.
 *
 * The reason is structural and is the authority working as designed.
 * `wouldDiscardAClause` is a WHITELIST: a label may be produced only by
 * transformations that delete no propositional content, and the derivation
 * refuses the moment any clause would be discarded at all. That whitelist was
 * installed after an adversarial corpus showed 32 of 45 authored quotes
 * changing meaning, and six minimal pairs proved every token-list veto had a
 * synonym that walked through it. **The option defect IS a clause-discard
 * problem — 17 of the 23 refusals here are `clause_discarded`** — so the
 * authority is structurally incapable of reaching it, and no further
 * punctuation-or-token rule will settle it (trap 22f: this repo has already
 * burned four rounds on exactly one such predicate).
 *
 * So the honest shape of this change is: **uniformity and two reductions now,
 * with the unreachable class pinned BY NAME so it is visible in the suite
 * rather than invisible to it** (the KNOWN-DROPPED discipline). A test that
 * quietly omitted the 23 would report a fix this change does not deliver.
 *
 * ── WHY THE CORPUS, NOT FIXTURES (trap 22) ─────────────────────────────────
 * Every assertion about a label's TEXT is a predicate over natural language,
 * so a corpus from the author's head cannot see the class the author did not
 * imagine. The inputs are (a) the two witness files' quotes, copied verbatim,
 * and (b) the frozen governed baseline — 14 real staging captures at `b9389df`
 * against served prompt v195, already in-tree. Nothing here invents a brief.
 *
 * ⚠ THE CORPUS IS A HISTORIC RECORD (trap 14b): it is read, never rewritten.
 *
 * ── EVERY CASE HAS ITS OPPOSITE-DIRECTION TWIN (trap 22b) ──────────────────
 * A corpus that tests one direction is a guard watching one door. Each block
 * below carries both: a long quote that MUST be left alone beside a reducible
 * quote that MUST be authored; an option that keeps `from_brief` beside a
 * control that must read `ai_inferred`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import { deriveStatedObjectiveLabel, labelIsDerivedFrom } from "../objective-label.js";
import type { DraftRecordSet } from "../grammar.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

interface CorpusNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance?: { readonly source_quote?: string };
}
interface CorpusCase {
  readonly brief_id: string;
  readonly graph?: { readonly nodes?: readonly CorpusNode[] };
}

function corpusCases(): readonly CorpusCase[] {
  const run = JSON.parse(fs.readFileSync(GOVERNED, "utf8")) as {
    run: { cases: readonly CorpusCase[] };
  };
  return run.run.cases;
}

const canonical = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Every governed OPTION node whose label IS still its own verbatim quote —
 *  the defect class, selected by a STRUCTURAL signal and nothing else. */
function optionsWhoseLabelIsTheirQuote(): { key: string; quote: string }[] {
  const out: { key: string; quote: string }[] = [];
  for (const c of corpusCases()) {
    for (const node of c.graph?.nodes ?? []) {
      if (node.kind !== "option") continue;
      const quote = node.provenance?.source_quote;
      if (typeof quote !== "string" || quote.length === 0) continue;
      if (canonical(quote) !== canonical(node.label)) continue;
      out.push({ key: `${c.brief_id}:${node.id}`, quote });
    }
  }
  return out;
}

// ── THE TWO WITNESSED QUOTES, COPIED VERBATIM ───────────────────────────────
// `COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md` §LINK 2(c), and `UX-GATE-2026-08-18.md`
// §"Model-quality observation". Neither is paraphrased; both are the bytes the
// deployed build put on a customer's screen.
const WITNESS_OPTION_A =
  "double down on enterprise sales (higher margins but longer cycles and more headcount)";
const WITNESS_OPTION_B =
  "invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)";
const WITNESS_UX_GATE_GOAL =
  "Several of our largest enterprise customers are asking for a self-hosted deployment option";

describe("the instrument: the governed corpus can SEE the defect, and discriminates", () => {
  it("carries 50 option nodes, of which 37 have label === source_quote and 13 do not", () => {
    const options = corpusCases()
      .flatMap((c) => c.graph?.nodes ?? [])
      .filter((n) => n.kind === "option");
    expect(options).toHaveLength(50);

    // ⭐ THE CONTRAST CONTROL (trap 13e / trap 20). An equality probe that
    // returned the same answer for every node would be reporting on itself.
    // 37 hit and 13 miss is the discrimination this whole suite rests on.
    expect(optionsWhoseLabelIsTheirQuote()).toHaveLength(37);
    expect(options.length - optionsWhoseLabelIsTheirQuote().length).toBe(13);
  });

  it("both witnessed option quotes are present in the corpus at their witnessed lengths", () => {
    const quotes = optionsWhoseLabelIsTheirQuote().map((o) => o.quote);
    expect(quotes).toContain(WITNESS_OPTION_A);
    expect(quotes).toContain(WITNESS_OPTION_B);
    expect(WITNESS_OPTION_A).toHaveLength(85);
    expect(WITNESS_OPTION_B).toHaveLength(101);
  });
});

// The one record set both tests below drive, so the mutant pair varies only the
// derivation and never the input.
const WEEKLY_BRIEF =
    "We are deciding how to schedule deliveries. We could carry on keeping weekly deliveries, " +
    "or partner with third-party couriers.";
const WEEKLY_RECORDS: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "raise retention" },
      { kind: "option", source_quote: "keeping weekly deliveries" },
      { kind: "option", source_quote: "partner with third-party couriers" },
    ],
    claims: [
      { claim_kind: "factor", label: "Delivery Flexibility", basis: [1] },
      { claim_kind: "outcome", label: "Customer Retention", basis: [0] },
      {
        claim_kind: "causal_link",
        label: "weekly holds flexibility",
        from_stated: 1,
        to_claim: 0,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "couriers move flexibility",
        from_stated: 2,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "flexibility drives retention",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "retention reaches the goal",
        from_claim: 1,
        to_stated: 0,
        effect: "positive",
      },
    ],
  };

describe("a user-stated option's display label is authored by the same authority as a goal's", () => {
  /**
   * ⭐ THE LEAD RED. `keeping weekly deliveries` is a governed option quote
   * (`10-many-observables`) that the authority CAN reduce. Driven through the
   * projector, not through the derivation alone, because the defect is in the
   * projector's kind gate and a unit call on the derivation would pass at
   * pristine while the product still shipped the raw fragment.
   */
  it("the projector authors a reducible user-stated option label and badges it", () => {
    const projected = projectRecordsToGraph(WEEKLY_RECORDS, WEEKLY_BRIEF).graph;

    // Bound by IDENTITY — this option is found by its OWN source_quote, never
    // by a length or label predicate another node could satisfy (trap 19).
    const weekly = projected.nodes.find(
      (n) => n.kind === "option" && n.provenance?.source_quote === "keeping weekly deliveries",
    );
    expect(weekly).toBeDefined();
    expect(weekly?.label).toBe("Keep Weekly Deliveries");
    expect(weekly?.provenance?.label_authored).toBe(true);
    // ⭐ THE VERBATIM SURVIVES UNCHANGED. This is the provenance answer a user
    // asking "why is this called that?" must still receive.
    expect(weekly?.provenance?.source_quote).toBe("keeping weekly deliveries");

  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN, DELIBERATELY IN ITS OWN `it()`.
   *
   * It began life inside the test above, and a DISCRIMINATING MUTANT PAIR
   * showed why that was wrong: loosening the derivation for THIS option alone
   * ("couriers") turned the test above red, so that test was not in fact bound
   * to the object it names. Split, the pair reads correctly — mutate the twin
   * and the lead stays green; mutate `weekly` and only the lead goes red. One
   * assertion, one object (trap 19).
   */
  it("a sibling option in the same graph is authored from its OWN quote, not the first one found", () => {
    const projected = projectRecordsToGraph(WEEKLY_RECORDS, WEEKLY_BRIEF).graph;
    const couriers = projected.nodes.find(
      (n) =>
        n.kind === "option" && n.provenance?.source_quote === "partner with third-party couriers",
    );
    expect(couriers).toBeDefined();
    expect(couriers?.label).toBe("Partner With Third-Party Couriers");
    expect(couriers?.provenance?.source_quote).toBe("partner with third-party couriers");
  });

  it("authors exactly 14 of the 37 governed option quotes, and every one is derivable from its own words", () => {
    const authored = optionsWhoseLabelIsTheirQuote().filter(
      (o) => deriveStatedObjectiveLabel(o.quote).authored,
    );
    expect(authored).toHaveLength(14);

    // ⭐ THE NO-FABRICATION GUARANTEE, STATED AGAINST THE SPEC rather than
    // against the failure mode (trap 13d). Every token of every authored label
    // must be a token of that label's OWN quote.
    for (const { key, quote } of authored) {
      const derived = deriveStatedObjectiveLabel(quote);
      expect(labelIsDerivedFrom(derived.label, quote), key).toBe(true);
    }
  });

  it("only TWO of the 14 are genuine reductions — the rest are recasings, and this is pinned so it cannot be reported as a fix", () => {
    const shortened = optionsWhoseLabelIsTheirQuote()
      .map((o) => ({ ...o, derived: deriveStatedObjectiveLabel(o.quote) }))
      .filter((o) => o.derived.authored && o.derived.label.length < o.quote.length)
      .map((o) => o.key)
      .sort();

    expect(shortened).toEqual([
      "01-simple-binary:a27fee56", // -6ch  "raising our subscription price by 20%, …"
      "10-many-observables:320eb3eb", // -3ch  "keeping weekly deliveries"
    ]);
  });
});

describe("KNOWN-DROPPED: what the authority cannot reach, named so it can neither grow nor shrink in silence", () => {
  /**
   * ⚠⚠ THE HONEST GAP (trap 22f). These 23 governed option quotes keep their
   * verbatim label. Refusal falls back to the pre-existing shipped behaviour,
   * so none of them is made worse — but none is fixed either, and both of the
   * witnessed 85/101-character options are in this set. A suite that did not
   * name them would be green for the wrong reason.
   */
  it("names all 23 refusals with the reason each one refused", () => {
    const refused = optionsWhoseLabelIsTheirQuote()
      .map((o) => ({ key: o.key, derived: deriveStatedObjectiveLabel(o.quote) }))
      .filter((o) => !o.derived.authored)
      .map((o) => `${o.key} [${o.derived.reason}]`)
      .sort();

    expect(refused).toEqual([
      "02-multi-option-constrained:6cae0780 [clause_discarded]",
      "02-multi-option-constrained:b68dc79f [deliberation_frame]",
      "02-multi-option-constrained:b6cb0510 [clause_discarded]",
      "02-multi-option-constrained:efc9f413 [clause_discarded]",
      "04-conflicting-constraints:4abad64d [clause_discarded]",
      "04-conflicting-constraints:e755ec33 [clause_discarded]",
      "05-product-feature:6b43f55b [clause_discarded]",
      "05-product-feature:dd605b53 [clause_discarded]",
      "06-operations-warehouse:8767c250 [no_concise_form]",
      "07-cloud-migration:21ec6581 [clause_discarded]",
      "07-cloud-migration:7eb4d21c [clause_discarded]",
      "07-cloud-migration:aec0b067 [clause_discarded]",
      "09-nested-subdecision:7cb3711f [clause_discarded]",
      "09-nested-subdecision:c1148bbb [clause_discarded]",
      "10-many-observables:6b8520dc [clause_discarded]",
      "10-many-observables:d6d0bcad [no_concise_form]",
      "11-feedback-loop-trap:009b519e [clause_discarded]",
      "11-feedback-loop-trap:5845e0cb [clause_discarded]",
      "12-similar-options:5a7ea889 [clause_discarded]",
      "12-similar-options:a0e5c5c4 [clause_discarded]",
      "12-similar-options:a2a88e70 [no_concise_form]",
      "13-forced-binary:7b5130f3 [no_concise_form]",
      "13-forced-binary:e715d413 [head_disclaims]",
    ]);
  });

  it("both witnessed options are KNOWN-DROPPED, keep their exact words, and say why", () => {
    for (const quote of [WITNESS_OPTION_A, WITNESS_OPTION_B]) {
      const derived = deriveStatedObjectiveLabel(quote);
      expect(derived.authored, quote).toBe(false);
      // A parenthetical is a discarded clause, and the whitelist refuses every
      // clause discard. Dropping "(higher margins but longer cycles …)" would
      // be the estate's own measured `(payments platform excluded)` failure.
      expect(derived.reason, quote).toBe("clause_discarded");
      // ⭐ A LONG HONEST LABEL BEATS A SHORT INVENTED ONE.
      expect(derived.label, quote).toBe(quote);
    }
  });

  it("the UX-gate goal is KNOWN-DROPPED too: a lifted fact with no concise form is kept whole", () => {
    const derived = deriveStatedObjectiveLabel(WITNESS_UX_GATE_GOAL);
    expect(derived.authored).toBe(false);
    expect(derived.reason).toBe("no_concise_form");
    expect(derived.label).toBe(WITNESS_UX_GATE_GOAL);
    expect(WITNESS_UX_GATE_GOAL).toHaveLength(90);
  });
});

describe("authoring an option's label does not move its provenance verdict", () => {
  /**
   * ⭐⭐ THE NAMED PREREQUISITE, SETTLED BY EXECUTION RATHER THAN BY READING.
   *
   * `projector.ts` refused to author option labels on the ground that
   * `transforms/schema-v3.ts` binds an option's provenance to its LABEL, so an
   * authored label would flip `from_brief` → `ai_inferred`. That is true of the
   * LEGACY label-only path. It is NOT true of a typed record: `readTypedRecordProvenance`
   * recognises the record and returns before the label-bound branch, and the
   * verdict is decided by `brief_binding`, which is derived from the QUOTE.
   *
   * ⚠ A single option asserting `from_brief` would prove nothing — the value
   * could be a constant. The DISCRIMINATING PAIR is what carries the claim: an
   * authored option that keeps `from_brief` beside a control whose quote is
   * absent from the brief and must read `ai_inferred`, both in one projection.
   */
  it("an authored stated option keeps from_brief, while an unbound control reads ai_inferred", () => {
    const v1 = {
      version: "1",
      nodes: [
        {
          id: "opt_authored",
          kind: "option",
          label: "Keep Weekly Deliveries",
          data: { interventions: {} },
          provenance: {
            provenance_class: "stated",
            source_quote: "keeping weekly deliveries",
            brief_binding: "verified",
            label_authored: true,
          },
        },
        {
          id: "opt_control",
          kind: "option",
          label: "Charter A Fleet Of Airships",
          data: { interventions: {} },
          provenance: {
            provenance_class: "stated",
            source_quote: "charter a fleet of airships",
            brief_binding: "unverified",
          },
        },
      ],
      edges: [],
    };

    const projection = projectGraphAndOptionsToV3(v1 as never, {
      brief: "We are keeping weekly deliveries for now.",
    });

    const authored = projection.graph.nodes.find((n) => n.id === "opt_authored");
    const control = projection.graph.nodes.find((n) => n.id === "opt_control");

    // The claim: an authored label does not cost the option its badge …
    expect(authored?.provenance).toBe("from_brief");
    expect(authored?.label_authored).toBe(true);
    expect(authored?.source_quote).toBe("keeping weekly deliveries");
    // … and the control proves the field is still discriminating, not constant.
    expect(control?.provenance).toBe("ai_inferred");
  });
});
