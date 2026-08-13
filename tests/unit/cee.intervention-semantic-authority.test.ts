/**
 * SECOND SEMANTIC AUTHORITY — the prose fallback must not author a user lever.
 *
 * ## What this pins, and why it is not a style preference
 *
 * `extractInterventionsForOption` runs its prose extractor ONLY when the canonical
 * record projection stated no magnitude for that option (`intervention-extractor.ts`
 * early-returns to `buildInterventionsFromV4Data` whenever `v4Interventions` is
 * non-empty; `projector.ts` omits the `interventions` key entirely for an option
 * with no stated magnitude — "THE PROJECTOR INVENTS NOTHING HERE"). So every value
 * the prose path emits is, BY CONSTRUCTION, one the canonical layer had no warrant
 * for. The two paths are mutually exclusive: there is no case where prose
 * extraction recovers a magnitude that the canonical path would also have produced.
 *
 * The module ALREADY holds the right rule — `determineOptionStatus`'s own comment:
 *   "KEY RULE: Both exact_id AND exact_label matches count as 'resolved'.
 *    Only semantic matches or unmatched targets block 'ready' status."
 * ...but it applied that rule to STATUS only, while the VALUE path wrote the
 * intervention regardless. This suite pins the value path to the same rule.
 *
 * Two defects, both measured at CEE `51704f12` before the fix:
 *
 *  (1) A synonym-table collision (`price/cost/pricing/rate/fee/charge` are one
 *      group) let "Cut price by 15%" match a factor labelled "Churn Rate" at
 *      score 0.75, and the fallback then WROTE `churn := 0.102` (0.12 × 0.85 —
 *      the price instruction applied to the churn baseline). It reached
 *      `options[].interventions`, was copied to `node.interventions`, and is what
 *      `mergeInterventionSourceObjects` hands the analysis. The team is shown one
 *      strategy; the maths receives another.
 *
 *  (2) The edge hint LAUNDERED the provenance: `match_type` was overwritten to
 *      `exact_id` whenever the matched factor happened to be edge-connected. An
 *      edge answers "are these two nodes connected?"; a match_type answers "did
 *      the user's text name this factor?" — two different questions under one
 *      field (CLAUDE.md trap 21). The overwrite destroyed the only evidence a
 *      downstream consumer could have used to distrust the mapping, and it also
 *      routed the value around the resolved/unresolved rule above.
 *
 * The fix does not silence the product: the option still reports the target as
 * unresolved and still ASKS. That is the ruling in trap 22f — where the mapping
 * cannot be determined, make the ambiguity the product rather than guessing.
 */
import { describe, it, expect } from "vitest";
import {
  extractInterventionsForOption,
  extractRawInterventions,
} from "../../src/cee/extraction/intervention-extractor.js";
import { matchInterventionToFactor } from "../../src/cee/extraction/factor-matcher.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

const GOAL_ID = "goal_profit";
const CHURN_ID = "factor_churn_rate";

function churnOnlyGraph(): { nodes: NodeV3T[]; edges: EdgeV3T[] } {
  return {
    nodes: [
      { id: GOAL_ID, kind: "goal", label: "Annual profit" },
      {
        id: CHURN_ID,
        kind: "factor",
        label: "Churn Rate",
        observed_state: { value: 0.12, source: "brief_extraction" },
      },
    ] as unknown as NodeV3T[],
    edges: [{ id: "e_churn_goal", from: CHURN_ID, to: GOAL_ID }] as unknown as EdgeV3T[],
  };
}

describe("prose fallback must not author a user lever from a semantic guess", () => {
  it("PRECONDITION: the matcher really does map a price target onto the churn factor", () => {
    // Pins this suite's own precondition in-test (CLAUDE.md trap 13b): if the
    // synonym table ever stops colliding, the cases below would pass for the
    // WRONG reason — they would be asserting about a mapping that no longer
    // happens. This assertion fails loudly if that day comes.
    const { nodes, edges } = churnOnlyGraph();
    const m = matchInterventionToFactor("price", nodes, edges, GOAL_ID);
    expect(m.matched).toBe(true);
    expect(m.node_id).toBe(CHURN_ID);
    expect(m.match_type).toBe("semantic");
  });

  it("does not write an intervention onto a semantically-matched factor", () => {
    const { nodes, edges } = churnOnlyGraph();
    const option = extractInterventionsForOption(
      "Cut price by 15%",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      // The edge hint is present precisely because it is what laundered the
      // match_type to exact_id before the fix.
      [{ from_option_id: "opt_a", to_factor_id: CHURN_ID }],
      undefined,
      "opt_a",
    );

    // Bound by IDENTITY (the factor id), never by a value predicate another
    // object could satisfy (CLAUDE.md trap 19).
    expect(Object.keys(option.interventions)).not.toContain(CHURN_ID);
    expect(option.interventions[CHURN_ID]).toBeUndefined();
  });

  it("reports the unmapped target and asks, rather than guessing silently", () => {
    const { nodes, edges } = churnOnlyGraph();
    const option = extractInterventionsForOption(
      "Cut price by 15%",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [{ from_option_id: "opt_a", to_factor_id: CHURN_ID }],
      undefined,
      "opt_a",
    );

    expect(option.status).toBe("needs_user_mapping");
    expect((option.unresolved_targets ?? []).some((t) => /price/i.test(t))).toBe(true);

    const asked = (option.user_questions ?? []).join(" ");
    // The question must name the FACTOR WE MATCHED — a fact we own — and must
    // NOT quote the extracted target back as the user's words: `target_text` is
    // a tokeniser output, not a phrase the user wrote.
    expect(asked).toMatch(/Churn Rate/);
    // And it must not report a POLICY as a CONFIDENCE STATE. Across the
    // refusals this guard produces the matcher is usually highly confident; we
    // decline on principle, not from doubt.
    expect(asked).not.toMatch(/not confident/i);
    expect(asked).toMatch(/by meaning/i);
  });

  it("reports an edge-hinted match by its MEASURED type, never upgraded to exact_id", () => {
    // ⚠ THIS TEST WAS VACUOUS IN ITS FIRST FORM AND A MUTANT CAUGHT IT.
    // It originally drove a SEMANTIC match and looped over the resulting
    // interventions — but the fix refuses semantic matches, so the map is empty
    // and the loop body never ran. It passed while asserting nothing, and the
    // "restore the laundering" mutant SURVIVED against it (CLAUDE.md trap 13b:
    // a guard whose evidence comes from itself).
    //
    // Bound instead to an EXACT_LABEL match, which is reachable past the guard
    // and is precisely where laundering can still misreport: the hint must not
    // promote exact_label to exact_id. The two answer different questions —
    // "are these nodes connected?" vs "did the text name this factor?".
    const FACTOR_ID = "f_1";
    const nodes = [
      { id: GOAL_ID, kind: "goal", label: "Annual profit" },
      {
        id: FACTOR_ID,
        kind: "factor",
        label: "Price",
        observed_state: { value: 50, source: "brief_extraction" },
      },
    ] as unknown as NodeV3T[];
    const edges = [{ id: "e", from: FACTOR_ID, to: GOAL_ID }] as unknown as EdgeV3T[];

    // Precondition pinned in-test: this really is an exact_label match, so the
    // assertion below cannot pass merely because nothing was extracted.
    const truth = matchInterventionToFactor("price", nodes, edges, GOAL_ID);
    expect(truth.node_id).toBe(FACTOR_ID);
    expect(truth.match_type).toBe("exact_label");

    const option = extractInterventionsForOption(
      "Set price to 40",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      // The hint is present — it is what did the laundering before the fix.
      [{ from_option_id: "opt_a", to_factor_id: FACTOR_ID }],
      undefined,
      "opt_a",
    );

    // Non-vacuity: the intervention must EXIST before its match_type means anything.
    expect(Object.keys(option.interventions)).toContain(FACTOR_ID);
    expect(option.interventions[FACTOR_ID].target_match.match_type).toBe("exact_label");
  });

  it("refuses a semantically-matched CATEGORICAL target instead of writing a placeholder", () => {
    // The categorical limb is the sharper of the two: with no default encoding
    // it writes `value: 0`, so a semantic mis-match does not merely pick the
    // wrong factor — it pins the wrong factor to zero, which the analysis reads
    // as a deliberate lever position. Measured at CEE `51704f12`: option
    // "Adopt Vue" wrote an intervention onto a factor labelled "Technology
    // Spend" via the categorical hint "technology".
    const TECH_ID = "factor_technology_spend";
    const nodes = [
      { id: GOAL_ID, kind: "goal", label: "Annual profit" },
      { id: TECH_ID, kind: "factor", label: "Technology Spend" },
    ] as unknown as NodeV3T[];
    const edges = [{ id: "e", from: TECH_ID, to: GOAL_ID }] as unknown as EdgeV3T[];

    // Precondition pinned in-test: the mapping really is semantic.
    const truth = matchInterventionToFactor("technology", nodes, edges, GOAL_ID);
    expect(truth.node_id).toBe(TECH_ID);
    expect(truth.match_type).toBe("semantic");

    const option = extractInterventionsForOption(
      "Adopt Vue",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [],
      undefined,
      "opt_a",
    );
    expect(Object.keys(option.interventions)).not.toContain(TECH_ID);
    expect((option.unresolved_targets ?? []).some((t) => /technology/i.test(t))).toBe(true);
  });

  it("asks once per factor when several patterns match the same phrase", () => {
    // ⚠ THE INPUT IS THE WHOLE TEST, AND MY FIRST ATTEMPT GOT IT WRONG.
    // This assertion originally rode the "Cut price by 15%" case, which yields
    // exactly ONE raw extraction — so it could never observe a duplicate and
    // the "remove the dedupe" mutant SURVIVED against it. The `<target> to <N>`
    // family is the one that duplicates: "Set price to 40" matches both the
    // leading-verb rule ("set price to 40") and the bare rule ("price to 40"),
    // and `processedSegments` dedupes by FULL MATCH, so both survive as two
    // raws with the same target.
    const { nodes, edges } = churnOnlyGraph();

    // Precondition pinned in-test: the input really does produce two raws.
    expect(extractRawInterventions("Set price to 40", "brief_extraction").length).toBe(2);

    const option = extractInterventionsForOption(
      "Set price to 40",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [],
      undefined,
      "opt_a",
    );

    expect(option.user_questions?.filter((q) => /Churn Rate/.test(q)).length).toBe(1);
    expect(option.unresolved_targets?.length).toBe(1);
  });

  it("the two surfaces agree: analysis_ready must not offer to run what the panel refused", () => {
    // ⛔ THE DEFECT THIS CLOSES. The `observed_state` fallback in
    // `analysis-ready.ts` fires ONLY on options with zero interventions, and
    // the semantic refusal above is what creates that population. Before the
    // fix the fallback flipped the analysis-ready COPY to `status: "ready"`
    // while public `options[]` stayed `needs_user_mapping` — so the panel said
    // "we have not set a value for this" and `chip-generator.ts:358`, reading
    // that status, offered an executable "Run the analysis" at the same time.
    //
    // A defect that could not fire before a change and fires after it belongs
    // to that change, whatever its age.
    const body = transformResponseToV3(
      {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_profit", kind: "goal", label: "Annual profit" },
            {
              id: "factor_churn_rate",
              kind: "factor",
              label: "Churn Rate",
              category: "controllable",
              data: { value: 0.12, extractionType: "observed" },
            },
            // No `data.interventions`: the canonical projection stated no magnitude.
            { id: "opt_a", kind: "option", label: "Cut price by 15%", body: "Cut price by 15%" },
            { id: "opt_b", kind: "option", label: "Hold the current plan", body: "Hold the current plan" },
          ],
          edges: [
            { from: "opt_a", to: "factor_churn_rate" },
            { from: "opt_b", to: "factor_churn_rate" },
            { from: "factor_churn_rate", to: "goal_profit" },
          ],
        },
      } as never,
      { brief: "Cut price by 15%" },
    ) as unknown as {
      options: Array<{ id: string; status: string }>;
      analysis_ready?: { status: string; options: Array<{ id: string; status: string }> };
    };

    const publicById = new Map(body.options.map((o) => [o.id, o]));
    const ready = body.analysis_ready;
    expect(ready).toBeDefined();

    // Non-vacuity: the fallback must actually have fired, or this test would
    // pass on a payload where there was never anything to disagree about.
    const opt = ready!.options.find((o) => o.id === "opt_a");
    expect(opt).toBeDefined();
    expect(publicById.get("opt_a")!.status).toBe("needs_user_mapping");

    // The claim: no option may be advertised as ready when the object the team
    // is shown says it still needs their input. Bound per option by IDENTITY.
    for (const a of ready!.options) {
      const shown = publicById.get(a.id);
      expect(shown).toBeDefined();
      if (shown!.status === "needs_user_mapping") {
        expect(a.status).not.toBe("ready");
      }
    }
    // ...and the payload-level status the chip reads must not say ready either.
    expect(ready!.status).not.toBe("ready");
  });

  it("a one-word factor is still reached through '<verb> <factor> by <N>%'", () => {
    // The refusal boundary is correct, but its price was a TOKENISER ARTEFACT:
    // every target group is greedy over two words, so "Increase price by 20%"
    // captured "price by", which matches the factor "Price" neither by id nor
    // by label and could only ever land semantically — i.e. exactly the limb
    // the value path must now refuse.
    //
    // ⚠ This case originally cited an 82-case corpus in which the strip
    // recovered 34 otherwise-lost extractions. That figure is WITHDRAWN: on 355
    // real captured graphs a mutant removing the strip left 1,182/1,182 records
    // identical — 0 recovered, 0 cost. The behaviour below is still the correct
    // behaviour, and this case still pins it; it simply is not load-bearing for
    // anything else in this change.
    const nodes = [
      { id: "goal_rev", kind: "goal", label: "Revenue" },
      {
        id: "f_price",
        kind: "factor",
        label: "Price",
        observed_state: { value: 100, source: "brief_extraction" },
      },
    ] as unknown as NodeV3T[];
    const edges = [{ id: "e", from: "f_price", to: "goal_rev" }] as unknown as EdgeV3T[];

    const option = extractInterventionsForOption(
      "Increase price by 20%",
      undefined,
      nodes,
      edges,
      "goal_rev",
      new Set<string>(),
      [],
      undefined,
      "opt_a",
    );

    expect(Object.keys(option.interventions)).toContain("f_price");
    // Matched BY NAME, not by meaning — that is what makes the value legitimate.
    expect(option.interventions["f_price"].target_match.match_type).toBe("exact_label");
    expect(option.interventions["f_price"].value).toBe(120); // 100 × 1.2
    expect(option.status).toBe("ready");
  });

  it("CONTRAST CONTROL: an exact_id target still yields a real intervention", () => {
    // Proves the guard discriminates rather than blanket-refusing. Without this
    // the four cases above would all pass on a function that returns {} always
    // (CLAUDE.md trap 13 — an absence assertion needs a matching presence).
    const nodes = [
      { id: GOAL_ID, kind: "goal", label: "Annual profit" },
      {
        id: "price",
        kind: "factor",
        label: "Unit Price",
        observed_state: { value: 50, source: "brief_extraction" },
      },
    ] as unknown as NodeV3T[];
    const edges = [{ id: "e", from: "price", to: GOAL_ID }] as unknown as EdgeV3T[];

    const truth = matchInterventionToFactor("price", nodes, edges, GOAL_ID);
    expect(truth.match_type).toBe("exact_id");

    const option = extractInterventionsForOption(
      "Set price to 40",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [],
      undefined,
      "opt_a",
    );
    expect(Object.keys(option.interventions)).toContain("price");
    expect(option.interventions["price"].target_match.match_type).toBe("exact_id");
  });

  it("CONTRAST CONTROL: canonical v4 interventions are untouched by this guard", () => {
    // The canonical path must remain the authority it already is — this fix
    // must not narrow it. Same graph, but the magnitude arrives canonically.
    const { nodes, edges } = churnOnlyGraph();
    const option = extractInterventionsForOption(
      "Cut price by 15%",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [],
      { [CHURN_ID]: 0.09 },
      "opt_a",
    );
    expect(option.interventions[CHURN_ID]?.value).toBe(0.09);
    expect(option.status).toBe("ready");
  });
});
