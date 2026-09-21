/**
 * A BINDING'S EXISTENCE IS NOT A CLAIM AGAINST THE USER'S AUTHORSHIP.
 *
 * ── THE GAP THIS FILE EXISTS TO CLOSE ─────────────────────────────────────
 * `intervention-extractor.ts` gated both of its brief-authority routes on
 *
 *     binding !== undefined && binding.composed_citation !== true
 *
 * which asks *"did the projector write anything?"*. The question it means is
 * *"does the projector's receipt CONTEST the brief's authority?"* — and those
 * are two different questions under one condition (CLAUDE.md trap 21).
 *
 * While every binding the projector minted was either verified or contested the
 * two coincided. Then `bindDirectStatedMagnitude` gained a third kind — an
 * UNCITED magnitude, stamped `cee_hypothesis` so an unattributed number stops
 * masquerading as a fact — and the coincidence broke. That receipt contests
 * nothing: it reports that no stated ITEM was cited. But it lands on the
 * suppressing side of the old gate, so a figure the user typed VERBATIM in the
 * brief, never lifted into `stated_items`, is re-attributed to Olumi at low
 * confidence in a sentence that says no figure was cited. That is CLAUDE.md
 * class 6 — the user's value overwritten and re-attributed to the AI — and the
 * codebase has already recorded, at the site of the previous fix, that
 * *"wrongly claiming a user's value is far worse than omitting one of ours"*.
 *
 * ⭐⭐ AND THE REASON NOTHING CAUGHT IT: swept repo-wide before this file
 * existed, ZERO test files passed `v4InterventionBindings` to
 * `extractInterventionsForOption`. Every extractor test exercised the
 * `binding === undefined` arm exclusively, so the entire suite was
 * STRUCTURALLY INCAPABLE of observing the state the gate decides. A guard with
 * no test that reaches it is theatre; these tests reach it through the REAL
 * chain — `projectRecordsToGraph` → `normaliseDraftResponse` →
 * `projectGraphAndOptionsToV3` → the extractor — using the projector's OWN
 * emitted binding rather than a hand-authored fixture, because a fixture the
 * author writes encodes the author's model of the producer instead of the
 * producer (CLAUDE.md trap 16-inverse).
 *
 * ⭐ TWO OPPOSITE HARMS, AND THEY CANNOT SHARE ONE WINDOW. A user's stated
 * figure must never be re-attributed to Olumi (cases 1); an estimate that is
 * ours, or an attribution the records genuinely leave contested, must never be
 * presented as the user's (cases 2, 3, 4). Both directions are asserted here,
 * so a fix in either direction that reopens the other goes RED — the failure
 * mode that once cost four consecutive rounds on one predicate (trap 22b/22f).
 */
import { describe, expect, it } from "vitest";

import { normaliseDraftResponse } from "../../../adapters/llm/normalisation.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import { projectRecordsToGraph } from "../../draft/records/projector.js";
import { projectGraphAndOptionsToV3 } from "../../transforms/schema-v3.js";

/**
 * ⚠ `GBP 55,000` IS IN THE BRIEF TEXT AND — for case 1 — DELIBERATELY NOT A
 * `stated_items` FIGURE. That asymmetry is the whole point: the projector
 * matches `stated_items`, `classifyAmountAgainstBrief` scans the BRIEF TEXT,
 * and they are DIFFERENT SETS.
 */
const BRIEF =
  "We run a small consultancy and need to decide how to grow next year. " +
  "Opening the Berlin office would add GBP 48,000 a year to our operating cost. " +
  "Expanding in the UK would add GBP 12,000 a year to our operating cost. " +
  "Keeping things as they are still carries GBP 15,000 a year of operating cost. " +
  "A Berlin office would put annual operating cost at GBP 55,000. " +
  "The goal is to grow without losing control of the cost base.";

/** The sentence a contested figure quotes, verbatim from the brief above. */
const SHARED_QUOTE = "A Berlin office would put annual operating cost at GBP 55,000";

const BERLIN = "Opening the Berlin office";
const UK = "Expanding in the UK";
const STATUS_QUO = "Keeping things as they are";
const COST = "Annual Operating Cost";

/**
 * The V3 display label, authored by `deriveOptionActionLabel` at the V3
 * boundary. Named apart from the record-level quote deliberately — one constant
 * serving both would hide the distinction.
 */
const BERLIN_V3_LABEL = "Open the Berlin Office";

const FIG_BASELINE = 4;
/** Only present in the `sharedFigure` / `duplicateFigures` variants. */
const FIG_SHARED = 5;
const FIG_DUPLICATE = 6;

type Variant = {
  /** The magnitude the Berlin link claims the factor would take. */
  readonly setsTo: number;
  /** Add a `stated_items` figure of 55,000 that BOTH options' links cite. */
  readonly sharedFigure?: true;
  /** Add TWO `stated_items` figures of 55,000, both cited by the Berlin link. */
  readonly duplicateFigures?: true;
};

function records(variant: Variant): DraftRecordSet {
  const baseFigures = [
    {
      kind: "figure" as const,
      source_quote: "Keeping things as they are still carries GBP 15,000 a year of operating cost",
      value: 15_000,
      unit: "GBP/year",
    },
  ];
  const sharedFigure = {
    kind: "figure" as const,
    source_quote: SHARED_QUOTE,
    value: 55_000,
    unit: "GBP/year",
  };
  const extraFigures = variant.duplicateFigures
    ? [sharedFigure, { ...sharedFigure }]
    : variant.sharedFigure
      ? [sharedFigure]
      : [];

  /**
   * ⚠ THE BERLIN LINK'S BASIS IS THE DISCRIMINATOR BETWEEN THE THREE BINDING
   * KINDS, so it is derived from the variant rather than hardcoded:
   *   []                              -> uncited     -> must NOT withhold
   *   [FIG_SHARED]                    -> verified, contested by the UK link
   *   [FIG_SHARED, FIG_DUPLICATE]     -> unresolved candidates
   */
  const berlinBasis = variant.duplicateFigures
    ? [FIG_SHARED, FIG_DUPLICATE]
    : variant.sharedFigure
      ? [FIG_SHARED]
      : [];
  const ukBasis = variant.sharedFigure ? [FIG_SHARED] : [];
  const ukSetsTo = variant.sharedFigure ? 55_000 : 27_000;

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
      ...baseFigures,
      ...extraFigures,
    ],
    claims: [
      // ⚠ THE FACTOR'S BASIS CITES A FIGURE AND NO OPTION, so
      // `resolveDirectBindingBasis` cannot inherit it onto a link with an empty
      // basis of its own. Without that, the empty-basis variant would silently
      // fall to the COMPOSED branch and this file would test the wrong arm.
      { claim_kind: "factor", label: COST, basis: [FIG_BASELINE], value: 15_000 },
      {
        claim_kind: "causal_link",
        label: "Berlin office raises annual operating cost",
        basis: berlinBasis,
        from_stated: 0,
        to_claim: 0,
        effect: "positive",
        sets_to: variant.setsTo,
      },
      {
        claim_kind: "causal_link",
        label: "UK expansion raises annual operating cost",
        basis: ukBasis,
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
        sets_to: ukSetsTo,
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

/**
 * Drive the REAL chain and return both halves: the binding the projector
 * emitted, and the intervention the extractor built FROM that binding.
 *
 * ⭐ RETURNING BOTH IS WHAT MAKES THE PRECONDITION PINNABLE IN-TEST. Asserting
 * only the extractor's output would pass whenever the projector silently
 * stopped minting a binding at all — a guard agreeing with itself
 * (CLAUDE.md trap 13b). Every case below asserts the binding it MEANS to test
 * actually reached the extractor before asserting what the extractor did.
 */
function driveChain(variant: Variant) {
  const set = records(variant);
  const projection = projectRecordsToGraph(set, BRIEF);

  const optionNodes = projection.graph.nodes.filter((node) => node.label === BERLIN);
  expect(optionNodes, `expected exactly one node labelled ${BERLIN}`).toHaveLength(1);
  const factorNodes = projection.graph.nodes.filter((node) => node.label === COST);
  expect(factorNodes, `expected exactly one node labelled ${COST}`).toHaveLength(1);

  const binding = (
    optionNodes[0]!.data?.intervention_details as
      | Record<string, Record<string, unknown>>
      | undefined
  )?.[factorNodes[0]!.id];

  const normalised = normaliseDraftResponse(structuredClone(projection.graph));
  const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
  const v3Factor = v3.graph.nodes.find((node) => node.label === COST);
  expect(v3Factor, `expected the ${COST} factor to survive V3 projection`).toBeDefined();
  const v3Option = v3.options.find((option) => option.label === BERLIN_V3_LABEL);
  expect(v3Option, `expected the ${BERLIN_V3_LABEL} option to survive V3 projection`).toBeDefined();

  return { binding, intervention: v3Option!.interventions[v3Factor!.id] };
}

describe("a projector binding must not disown figures the user wrote", () => {
  it("1 · UNCITED RECEIPT — a magnitude the user typed in the brief keeps brief authority", () => {
    // The exact shape the option-effect-value change introduced: the model cited
    // no stated item, so the projector stamps the value as OURS. That stamp is a
    // report about `stated_items`. It is NOT a finding about the brief text, and
    // 55,000 is in the brief text verbatim.
    const { binding, intervention } = driveChain({ setsTo: 55_000 });

    // PRECONDITION, pinned in-test: the uncited receipt really did reach the
    // extractor, and it is the kind that must NOT withhold.
    expect(
      binding,
      "the uncited magnitude must carry a provenance receipt — an unstamped number is the other defect",
    ).toBeDefined();
    expect(binding).toMatchObject({ raw_value: 55_000, source: "cee_hypothesis" });
    expect(
      binding,
      "an uncited receipt contests nothing; only a genuinely contested one may close the brief routes",
    ).not.toHaveProperty("withholds_brief_authority");

    // RED at pristine: `cee_hypothesis` / `low`, carrying the projector's
    // "no stated figure is cited" sentence about a number the user typed.
    expect(intervention).toMatchObject({
      raw_value: 55_000,
      source: "brief_extraction",
      value_confidence: "high",
    });
    expect(
      String(intervention!.reasoning),
      "the product must not tell the user no figure was cited for a figure they wrote",
    ).not.toContain("no stated figure is cited");
  });

  it("2 · OPPOSITE DIRECTION — an estimate absent from the brief stays ours, at low confidence", () => {
    // 61,500 appears nowhere in the brief. Opening the gate must not make every
    // uncited estimate the user's: that is the mirror harm, and it is the one
    // the `cee_hypothesis` stamp exists to prevent.
    const { binding, intervention } = driveChain({ setsTo: 61_500 });

    expect(BRIEF, "the twin is vacuous if the brief happens to contain the value").not.toContain(
      "61,500",
    );
    expect(binding).toMatchObject({ raw_value: 61_500, source: "cee_hypothesis" });
    expect(binding).not.toHaveProperty("withholds_brief_authority");

    expect(intervention).toMatchObject({
      raw_value: 61_500,
      source: "cee_hypothesis",
      value_confidence: "low",
    });
    expect(String(intervention!.reasoning)).toContain("no stated figure is cited");
  });

  it("3 · OPPOSITE DIRECTION — a figure two options both claim stays contested, though it IS in the brief", () => {
    // Single ownership: the brief said 55,000 once and nothing in the records can
    // say which option owns it. The projector withdraws the unearned label; the
    // extractor must not hand it back through the brief-text route just because
    // the number is findable in the brief. This is the case a naive "delete the
    // gate" fix reopens.
    const { binding, intervention } = driveChain({ setsTo: 55_000, sharedFigure: true });

    expect(BRIEF, "the case is vacuous unless the brief really states the figure").toContain(
      "GBP 55,000",
    );
    expect(
      binding,
      "the contested magnitude must reach the extractor marked as withholding",
    ).toMatchObject({
      raw_value: 55_000,
      source: "cee_hypothesis",
      withholds_brief_authority: true,
    });
    expect(String(binding!.reasoning)).toContain("claimed by more than one option");

    expect(intervention).toMatchObject({
      raw_value: 55_000,
      source: "cee_hypothesis",
      value_confidence: "low",
    });
  });

  it("4 · OPPOSITE DIRECTION — an unresolved stated-item binding stays contested, though it IS in the brief", () => {
    // Two candidate figures carry the same value, so which one the magnitude is
    // bound to is undetermined. Same principle, different branch: the receipt
    // reports a genuine contest and must keep closing the brief routes.
    const { binding, intervention } = driveChain({ setsTo: 55_000, duplicateFigures: true });

    expect(
      binding,
      "the unresolved-candidates magnitude must reach the extractor marked as withholding",
    ).toMatchObject({
      raw_value: 55_000,
      source: "cee_hypothesis",
      withholds_brief_authority: true,
    });
    expect(String(binding!.reasoning)).toContain("candidates stated_items[");

    expect(intervention).toMatchObject({
      raw_value: 55_000,
      source: "cee_hypothesis",
      value_confidence: "low",
    });
  });
});
