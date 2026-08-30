/**
 * EVERY OPTION→FACTOR EFFECT VALUE CARRIES A PROVENANCE STAMP.
 *
 * ── THE INVARIANT, WRITTEN AGAINST THE SPEC AND NOT AGAINST THE SYMPTOM ─────
 * CLAUDE.md's standing invariant admits exactly three states for a quantity:
 *
 *   explicit user fact → PRESERVE IT
 *   defensible Olumi estimate → the estimate, WITH its provenance
 *   genuinely unknown → UNKNOWN / needs input
 *
 * A number on the graph that carries NO provenance is none of the three. It is
 * the second state wearing the first state's clothes, and it is the estate's
 * class-1 defect ("absence represented as value") in the one place it does the
 * most damage: `OptionData.interventions` is what the analysis compares the
 * options on, so an unstamped estimate becomes a recommendation the product
 * cannot attribute.
 *
 * ⚠ THIS TEST IS NOT ABOUT `sets_to` BEING PRESENT. Whether the model emits a
 * value is the instruction's business. This pins the OTHER half of that change:
 * whatever value does arrive is stamped. The two ship together on purpose —
 * asking the model for more estimates while leaving them unattributable would
 * trade a refusal the user can see for a fabrication they cannot.
 *
 * ── WHY THE FOURTH CASE EXISTS ─────────────────────────────────────────────
 * `cee/transforms/analysis-ready.ts:831-835` raises a NON-WAIVABLE
 * `ambiguous_value` blocker on any intervention whose reasoning matches
 * `/^Direct causal value (?:bound by edge|has unresolved stated-item binding)/`
 * while its binding is unresolved. A stamp that reused that prefix would swap a
 * hard `MISSING_OPTION_VALUE` refusal for a hard `AMBIGUOUS_OPTION_VALUE` one —
 * the symptom metric would move and the user would still be blocked (CLAUDE.md
 * trap 23). The predicate is derived HERE from the consumer's own bytes rather
 * than restated, so the pin cannot drift into agreeing with itself.
 *
 * ⭐ ASSERTIONS BIND BY IDENTITY — the minted id of a node located by its EXACT
 * label — never by a value predicate another node could satisfy (trap 19).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * The consumer's ACTUAL predicate, copied from
 * `cee/transforms/analysis-ready.ts:833`. Any receipt matching this and left
 * unresolved becomes a non-waivable `ambiguous_value` refusal.
 */
const AMBIGUOUS_VALUE_TRIGGER =
  /^Direct causal value (?:bound by edge|has unresolved stated-item binding)/;

interface ProjectedGraph {
  nodes: Array<{ id: string; kind?: string; label?: string; data?: Record<string, unknown> }>;
}

/** Locate a node by EXACT label; fails loud on 0 or 2+ so nothing is ambiguous. */
function idOf(graph: ProjectedGraph, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}

function optionData(graph: ProjectedGraph, optionId: string): Record<string, unknown> {
  const node = graph.nodes.find((n) => n.id === optionId);
  expect(node, `option ${optionId} is on the graph`).toBeDefined();
  return (node!.data ?? {}) as Record<string, unknown>;
}

const interventionsOf = (graph: ProjectedGraph, optionId: string) =>
  optionData(graph, optionId).interventions as Record<string, number> | undefined;

const detailsOf = (graph: ProjectedGraph, optionId: string) =>
  optionData(graph, optionId).intervention_details as
    | Record<string, { source: string; reasoning?: string; raw_value?: number }>
    | undefined;

/**
 * One brief, two options, one shared controllable factor.
 *
 * `stated_items[3]` is a figure the user really did give, and the CHALLENGER's
 * link cites it — that is the `brief_extraction` arm. The BASELINE's link cites
 * nothing, which is the arm the model produces whenever the brief does not hand
 * it a per-option number: the case that must be stamped as ours.
 */
const BRIEF =
  "We want to raise sales productivity. We could replace the CRM, which the vendor quotes at 240000 a year, or keep what we have.";

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "raise sales productivity" },
    { kind: "option", source_quote: "replace the CRM" },
    { kind: "option", source_quote: "keep what we have", is_baseline: true },
    { kind: "figure", source_quote: "the vendor quotes at 240000 a year", value: 240000 },
  ],
  claims: [
    { claim_kind: "factor", label: "CRM annual licence cost" },
    { claim_kind: "outcome", label: "sales productivity gain" },
    {
      claim_kind: "causal_link",
      label: "the new CRM costs the quoted licence fee",
      from_stated: 1,
      to_claim: 0,
      effect: "negative",
      basis: [3],
      sets_to: 240000,
    },
    {
      // NO `basis`, and a value the brief never states: the estimate arm.
      claim_kind: "causal_link",
      label: "staying put holds the licence cost where it is",
      from_stated: 2,
      to_claim: 0,
      effect: "positive",
      sets_to: 90000,
    },
    { claim_kind: "causal_link", label: "licence cost bears on productivity", from_claim: 0, to_claim: 1, effect: "negative" },
    { claim_kind: "causal_link", label: "productivity reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

describe("an option→factor effect value is never projected without a provenance stamp", () => {
  const { graph } = projectRecordsToGraph(RECORDS, BRIEF) as { graph: ProjectedGraph };
  const challengerId = idOf(graph, "replace the CRM");
  const baselineId = idOf(graph, "keep what we have");
  const factorId = idOf(graph, "CRM annual licence cost");

  it("⭐ PRECONDITION — both options really do carry an intervention on the named factor", () => {
    // Without this the invariant below would pass vacuously on an empty map,
    // which is exactly the "guard agreeing with itself" shape (trap 13b).
    expect(Object.keys(interventionsOf(graph, challengerId) ?? {})).toContain(factorId);
    expect(Object.keys(interventionsOf(graph, baselineId) ?? {})).toContain(factorId);
  });

  it("⭐⭐ THE INVARIANT — every intervention key on every option has a provenance entry", () => {
    for (const node of graph.nodes) {
      if (node.kind !== "option") continue;
      const interventions = interventionsOf(graph, node.id) ?? {};
      const details = detailsOf(graph, node.id) ?? {};
      for (const key of Object.keys(interventions)) {
        expect(
          details[key],
          `option "${node.label}" carries a value for factor ${key} with no provenance entry`,
        ).toBeDefined();
        expect(details[key]!.source).toBeTruthy();
      }
    }
  });

  it("the UNCITED estimate is stamped as Olumi's, never as the user's", () => {
    const detail = (detailsOf(graph, baselineId) ?? {})[factorId];
    expect(detail, "the baseline's estimate carries a provenance entry").toBeDefined();
    expect(detail!.source).toBe("cee_hypothesis");
    expect(detail!.raw_value).toBe(90000);
  });

  it("⭐ THE OPPOSITE-DIRECTION TWIN — a cited, brief-verified figure still earns brief authority", () => {
    // The estimate stamp must not be bought by demoting the user's own number.
    // If this ever goes red alongside the case above, the fix swallowed the
    // distinction instead of adding to it.
    const detail = (detailsOf(graph, challengerId) ?? {})[factorId];
    expect(detail, "the challenger's stated figure carries a provenance entry").toBeDefined();
    expect(detail!.source).toBe("brief_extraction");
    expect(detail!.raw_value).toBe(240000);
  });

  it("the estimate's receipt does NOT trip the consumer's ambiguous_value refusal", () => {
    // Derived from `cee/transforms/analysis-ready.ts:833`, not restated from
    // memory. A receipt that matched would trade one hard block for another.
    const detail = (detailsOf(graph, baselineId) ?? {})[factorId];
    expect(AMBIGUOUS_VALUE_TRIGGER.test(detail?.reasoning ?? "")).toBe(false);
    // And the positive control: the predicate can still say YES, so a `false`
    // above is a discrimination rather than a dead regex.
    expect(
      AMBIGUOUS_VALUE_TRIGGER.test("Direct causal value bound by edge e1 to stated_items[3]: x"),
    ).toBe(true);
  });
});
