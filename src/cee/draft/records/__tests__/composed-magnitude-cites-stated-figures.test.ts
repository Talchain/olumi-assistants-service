/**
 * A COMPOSED MAGNITUDE THAT CITES THE USER'S OWN FIGURES IS NOT "MODEL-CHOSEN".
 *
 * ── THE LIVE DEFECT THIS PINS ──────────────────────────────────────────────
 * Scenario `c3b1bb17`, driven 27 Aug 2026 on the deployed quartet (UI
 * `4c681e78` · CEE `885c6e8`). The brief, verbatim:
 *
 *   "Opening the Berlin office would ADD GBP 48,000 a year TO OUR OPERATING COST.
 *    Expanding in the UK would ADD GBP 12,000 a year TO OUR OPERATING COST.
 *    Keeping things as they are STILL CARRIES GBP 15,000 a year of operating cost."
 *
 * `instruction.ts:244-249` asks for `sets_to` as THE VALUE THE FACTOR WOULD TAKE
 * IF THE OPTION WERE CHOSEN, and sanctions deriving it from *"a figure the user
 * stated, **or a change they described**"*. So on a factor whose observed state
 * IS the 15,000 baseline, the model's 63,000 and 27,000 are CORRECT — the user's
 * own increments composed onto the user's own baseline. Nothing was invented.
 *
 * ⭐ THE DEFECT IS STRUCTURAL, NOT STOCHASTIC. `bindDirectStatedMagnitude`
 * accepts a basis figure only on `item.value === claim.sets_to`. A composed
 * level can never equal any single stated figure, so EVERY option whose brief
 * figure is an increment over a non-zero baseline is GUARANTEED to fall to
 * `matches.length === 0` — which returned `undefined`, writing NO binding, and
 * DISCARDING the fact that the claim cited the user's figures at all. The
 * extractor's own fallback then told the user *"this amount is not stated in
 * the brief"*, and the product answered "did you change my numbers?" with
 * *"Figures I could not find in the model: 48,000 a year, 12,000 a year"* —
 * which is false: both ARE in the model, as summands.
 *
 * ⭐⭐ AND THE HARM IS THAT NOBODY IS ASKED. `transforms/analysis-ready.ts`
 * already raises `ambiguous_value` / `confirm_value` — live, wire-typed
 * (`schemas/analysis-ready.ts:140,145`), counted actionable
 * (`canonical-analysis-state.ts:132`), rendered as coaching
 * (`readiness-recovery.ts:313-315`) — gated on the reasoning matching
 * `/^Direct causal value (?:bound by edge|has unresolved stated-item binding)/`.
 * Route `undefined` cannot produce that prefix, so the loop `continue`s and a
 * LIVE USER-FACING ASK stays structurally blind to exactly the case that fires.
 *
 * The fix keeps the `cee_hypothesis` stamp and the low confidence untouched —
 * the honesty layer is the only part that worked — and only stops throwing the
 * cited basis away, so the ask that already exists can see the case.
 *
 * ⚠ SCOPE OF THE FIXTURE. The `basis` arrays here assert the model CITED the
 * figures it composed from. That is what `instruction.ts:174-177` asks for and
 * what makes the composition recoverable; whether the live draw populated it is
 * a separate live measurement (Slice 0) and is NOT claimed by this test.
 */
import { describe, expect, it } from "vitest";

import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { buildAnalysisReadyPayload } from "../../../transforms/analysis-ready.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const BRIEF =
  "We run a small consultancy and need to decide how to grow next year. " +
  "Opening the Berlin office would add GBP 48,000 a year to our operating cost. " +
  "Expanding in the UK would add GBP 12,000 a year to our operating cost. " +
  "Keeping things as they are still carries GBP 15,000 a year of operating cost. " +
  "The goal is to grow without losing control of the cost base.";

const BERLIN = "Opening the Berlin office";
/**
 * ⚠ THE V3 DISPLAY LABEL, WHICH IS NO LONGER THE QUOTE. `deriveOptionActionLabel`
 * authors an option's display name at the V3 boundary (`schema-v3.ts`), so a
 * lookup by label must use the authored string while the RECORD-level lookups
 * above keep using the quote. Named apart deliberately: one constant serving
 * both would hide exactly the distinction this change introduces.
 */
const BERLIN_V3_LABEL = "Open the Berlin Office";
const UK = "Expanding in the UK";
const STATUS_QUO = "Keeping things as they are";
const COST = "Annual Operating Cost";

/** Index of each stated figure, named so assertions bind by identity. */
const FIG_BERLIN_INCREMENT = 4;
const FIG_UK_INCREMENT = 5;
const FIG_BASELINE = 6;

/**
 * @param berlinBasis the Berlin link's basis. Defaults to citing the 48,000
 *   increment; `[]` is the NEGATIVE TWIN — a model that cited nothing, which
 *   must stay `undefined` because it genuinely IS model-chosen.
 */
function records(args: { berlinBasis?: number[] } = {}): DraftRecordSet {
  const berlinBasis = args.berlinBasis ?? [FIG_BERLIN_INCREMENT];
  return {
    stated_items: [
      { kind: "option", source_quote: BERLIN, is_baseline: false },
      { kind: "option", source_quote: UK, is_baseline: false },
      { kind: "option", source_quote: STATUS_QUO, is_baseline: true },
      {
        kind: "goal",
        source_quote: "grow without losing control of the cost base",
        role: "target",
      },
      {
        kind: "figure",
        source_quote: "Opening the Berlin office would add GBP 48,000 a year to our operating cost",
        value: 48_000,
        unit: "GBP/year",
      },
      {
        kind: "figure",
        source_quote: "Expanding in the UK would add GBP 12,000 a year to our operating cost",
        value: 12_000,
        unit: "GBP/year",
      },
      {
        kind: "figure",
        source_quote: "Keeping things as they are still carries GBP 15,000 a year of operating cost",
        value: 15_000,
        unit: "GBP/year",
      },
    ],
    claims: [
      { claim_kind: "factor", label: COST, basis: [FIG_BASELINE], value: 15_000 },
      {
        claim_kind: "causal_link",
        label: "Berlin office raises annual operating cost",
        basis: berlinBasis,
        from_stated: 0,
        to_claim: 0,
        effect: "positive",
        // 15,000 baseline + 48,000 increment. Correct, and equal to no stated figure.
        sets_to: 63_000,
      },
      {
        claim_kind: "causal_link",
        label: "UK expansion raises annual operating cost",
        basis: [FIG_UK_INCREMENT],
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
        sets_to: 27_000,
      },
      {
        claim_kind: "causal_link",
        label: "Status quo carries the current operating cost",
        basis: [FIG_BASELINE],
        from_stated: 2,
        to_claim: 0,
        effect: "positive",
        sets_to: 15_000,
      },
      {
        claim_kind: "causal_link",
        label: "Operating cost bears on the goal",
        basis: [FIG_BASELINE],
        from_claim: 0,
        to_stated: 3,
        effect: "negative",
      },
    ],
  };
}

type Projected = ReturnType<typeof projectRecordsToGraph>;

function nodeByLabel(projection: Projected, label: string) {
  const matches = projection.graph.nodes.filter((node) => node.label === label);
  expect(matches, `expected exactly one node labelled ${label}`).toHaveLength(1);
  return matches[0]!;
}

function bindingOf(projection: Projected, optionLabel: string): Record<string, unknown> | undefined {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, COST);
  return (option.data?.intervention_details as Record<string, Record<string, unknown>> | undefined)?.[
    factor.id
  ];
}

/** The exact predicate `transforms/analysis-ready.ts` gates the ask on. */
const ASK_GATE = /^Direct causal value (?:bound by edge|has unresolved stated-item binding)/;

describe("composed magnitude citing the user's own stated figures", () => {
  it("keeps the cee_hypothesis stamp but records the cited figures, so the confirm-value ask can see it", () => {
    const projection = projectRecordsToGraph(records(), BRIEF);
    const berlin = bindingOf(projection, BERLIN);

    // RED at pristine: `matches.length === 0` returned undefined and the cited
    // basis was discarded, so no binding was ever written.
    expect(berlin, "the Berlin link cited stated_items[4]; that must not be discarded").toBeDefined();

    // ⛔ THE STAMP DOES NOT MOVE. The value is not a figure the user stated, so
    // it has not earned brief authority — withdrawing that claim is correct and
    // is the only part of this pipeline that was already working.
    expect(berlin).toMatchObject({ raw_value: 63_000, source: "cee_hypothesis" });

    // The reasoning must join the family the live ask already recognises, and
    // must NAME the figure it composed from — strictly more specific than the
    // "this amount is not stated in the brief" it replaces, never vaguer.
    const reasoning = String(berlin!.reasoning);
    expect(reasoning).toMatch(ASK_GATE);
    expect(reasoning).toContain(`stated_items[${FIG_BERLIN_INCREMENT}]`);
    expect(reasoning).toContain("48000");
  });

  it("NEGATIVE TWIN — a link that cited no figure at all is stamped as model-chosen, never as a citation", () => {
    const projection = projectRecordsToGraph(records({ berlinBasis: [] }), BRIEF);
    const berlin = bindingOf(projection, BERLIN);

    // ⚠ ASSERTION CHANGED, AND THE INTENT IS THE REASON IT COULD BE.
    // This read `toBeUndefined()` until the option-effect-value change. That was
    // ONE assertion answering TWO questions (CLAUDE.md trap 21): "has this
    // earned brief authority?" (no — still no) and "does it carry a provenance
    // record at all?" (previously no, and that was the class-1 defect). An
    // uncited magnitude now carries a stamp saying it is OURS, which is the
    // opposite of dressing it as a citation — this test's stated intent — so
    // the intent is asserted directly instead of through the old proxy.
    expect(
      berlin,
      "an uncited magnitude must still be attributable — an unstamped number is the defect, not the safeguard",
    ).toBeDefined();
    expect(
      berlin!.source,
      "an empty basis is a genuine 'I chose this' and must never earn brief authority",
    ).toBe("cee_hypothesis");
    // The specific harm this case was written against: it must not be dressed
    // as a citation it does not have.
    expect(berlin).not.toHaveProperty("composed_citation");
    expect(String(berlin!.reasoning)).not.toContain("stated_items[");
  });

  it("MIRROR GUARD — a value that IS a stated figure elsewhere keeps its existing route", () => {
    // The claim cites the 48,000 increment but sets the factor to 12,000, which
    // the user DID state (as the UK increment). Demoting that here would trade
    // this defect for its mirror image — withdrawing brief authority from a
    // number the user actually wrote — so the composed branch must stand aside
    // and leave `classifyAmountAgainstBrief` its existing say.
    const mirrored = records();
    const berlinLink = mirrored.claims.find(
      (claim) => claim.claim_kind === "causal_link" && claim.from_stated === 0,
    )!;
    Object.assign(berlinLink, { sets_to: 12_000 });

    expect(bindingOf(projectRecordsToGraph(mirrored, BRIEF), BERLIN)).toBeUndefined();
  });

  it("PROBE-A — a figure the user typed VERBATIM but absent from stated_items keeps brief authority", () => {
    // ⭐⭐ THE REGRESSION THIS PR SHIPPED ONCE, AND THE WORSE HARM OF THE TWO.
    //
    // The projector matches `stated_items`; `classifyAmountAgainstBrief` scans
    // the BRIEF TEXT. DIFFERENT SETS. The first version of this fix guarded on
    // `statedItems.some(...)`, so a number present in the brief but never lifted
    // into `stated_items` still got a receipt — and the extractor, gating both
    // its brief-authority routes on `binding === undefined`, then withdrew the
    // user's own attribution and asked them to confirm a number they had typed.
    // Wrongly claiming a user's value is far worse than omitting one of ours, so
    // this direction is the one that must never regress.
    const probeBrief = `${BRIEF} A Berlin office would put annual operating cost at GBP 55,000.`;
    const set = records();
    const berlinLink = set.claims.find(
      (claim) => claim.claim_kind === "causal_link" && claim.from_stated === 0,
    )!;
    // 55,000 is in the BRIEF TEXT above, and deliberately NOT a stated_item.
    Object.assign(berlinLink, { sets_to: 55_000 });

    const projection = projectRecordsToGraph(set, probeBrief);
    const normalised = normaliseDraftResponse(structuredClone(projection.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: probeBrief });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    const berlin = v3.options.find((option) => option.label === BERLIN_V3_LABEL)!;

    expect(berlin.interventions[factor.id]).toMatchObject({
      raw_value: 55_000,
      source: "brief_extraction",
      value_confidence: "high",
    });
    expect(String(berlin.interventions[factor.id]!.reasoning)).not.toContain(
      "is not itself a stated figure",
    );
  });

  it("PROBE-G — an INHERITED factor basis is credited to the factor, not to the claim", () => {
    // `resolveDirectBindingBasis` falls back to the target factor's basis when
    // the link carries none, so "empty claim basis => inert" is FALSE. The
    // receipt must name the actual citer rather than crediting the claim with a
    // citation it never made.
    const set = records({ berlinBasis: [] });
    const factorClaim = set.claims[0]!;
    // The factor cites the Berlin option and the 48,000 figure — the exact
    // inheritable shape `resolveDirectBindingBasis` accepts.
    Object.assign(factorClaim, { basis: [0, FIG_BERLIN_INCREMENT] });
    const berlinLink = set.claims.find(
      (claim) => claim.claim_kind === "causal_link" && claim.from_stated === 0,
    )!;
    Object.assign(berlinLink, { to_claim: 0 });

    // ⚠ PIN THE PRECONDITION IN-TEST. A conditional assertion here would pass
    // whether the inheritance fired or not — a guard agreeing with itself
    // (CLAUDE.md trap 13b). Assert the binding EXISTS first, so this test fails
    // loudly if the inheritable shape ever stops reaching this branch.
    const binding = bindingOf(projectRecordsToGraph(set, BRIEF), BERLIN);
    expect(binding, "the inheritable factor basis must reach the composed branch").toBeDefined();
    const reasoning = String(binding!.reasoning);
    expect(reasoning).toMatch(ASK_GATE);
    expect(reasoning).toContain("the target factor cites");
    expect(reasoning).not.toContain("the claim composes it from");
  });

  it("does not disturb the baseline, whose absolute level IS a stated figure", () => {
    const projection = projectRecordsToGraph(records(), BRIEF);

    expect(bindingOf(projection, STATUS_QUO)).toMatchObject({
      raw_value: 15_000,
      source: "brief_extraction",
    });
  });

  it("reaches the user: readiness raises a confirm_value blocker naming the option and factor", () => {
    const projection = projectRecordsToGraph(records(), BRIEF);
    const normalised = normaliseDraftResponse(structuredClone(projection.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
    const readiness = buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph);

    const berlinOption = v3.options.find((option) => option.label === BERLIN_V3_LABEL);
    expect(berlinOption, "expected the Berlin option to survive projection").toBeDefined();

    const blockers = (readiness.blockers ?? []).filter(
      (blocker) =>
        blocker.option_id === berlinOption!.id && blocker.blocker_type === "ambiguous_value",
    );
    expect(
      blockers,
      "the live confirm-value ask must now see the composed magnitude it was always meant to catch",
    ).toHaveLength(1);
    expect(blockers[0]!.suggested_action).toBe("confirm_value");
  });
});
