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
import { extractInterventionsForOption } from "../../src/cee/extraction/intervention-extractor.js";
import { matchInterventionToFactor } from "../../src/cee/extraction/factor-matcher.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

const GOAL_ID = "goal_profit";
const CHURN_ID = "factor_churn_rate";
const PRICE_ID = "factor_unit_price";

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

function exactIdGraph(): { nodes: NodeV3T[]; edges: EdgeV3T[] } {
  return {
    nodes: [
      { id: GOAL_ID, kind: "goal", label: "Annual profit" },
      {
        id: PRICE_ID,
        kind: "factor",
        label: "Unit Price",
        observed_state: { value: 50, source: "brief_extraction" },
      },
    ] as unknown as NodeV3T[],
    edges: [{ id: "e_price_goal", from: PRICE_ID, to: GOAL_ID }] as unknown as EdgeV3T[],
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
    // The extractor's own target text for this label is "price by" (its segment
    // boundary), so match the target rather than asserting an exact spelling the
    // extractor never produced.
    expect((option.unresolved_targets ?? []).some((t) => /price/i.test(t))).toBe(true);
    expect((option.user_questions ?? []).join(" ")).toMatch(/price/i);
  });

  it("never launders a semantic match into exact_id via an edge hint", () => {
    // The laundering is the mechanism that routed the value around the
    // resolved/unresolved rule. Pin the mechanism, not only its consequence —
    // otherwise a future change could re-open the hole from the other side.
    const { nodes, edges } = exactIdGraph();
    const option = extractInterventionsForOption(
      "Cut price by 15%",
      undefined,
      nodes,
      edges,
      GOAL_ID,
      new Set<string>(),
      [{ from_option_id: "opt_a", to_factor_id: PRICE_ID }],
      undefined,
      "opt_a",
    );
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const declared = intervention.target_match.match_type;
      const truth = matchInterventionToFactor("price", nodes, edges, GOAL_ID);
      if (truth.node_id === factorId && truth.match_type === "semantic") {
        expect(declared).not.toBe("exact_id");
      }
    }
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
