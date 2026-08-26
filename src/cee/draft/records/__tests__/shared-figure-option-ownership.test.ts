/**
 * ONE STATED FIGURE MAY LICENSE AT MOST ONE OPTION.
 *
 * Live shape, measured 26 Aug 2026 over the banked golden-journey corpus
 * (117 draft captures; 6 carried a direct stated-option binding; 4 of those 6
 * carried this exact collision — runs `c96f01`, `17c4a0`, `d30b34`, `693ddb`,
 * CEE builds `c24bfe3` / `7a5cd91` / `58fdb11`):
 *
 *   brief:  "…replace our current CRM with HubSpot next quarter, or keep what
 *            we have? … Annual CRM cost is about £50,000 and switching would
 *            cost roughly £20,000 one-off."
 *
 * The model emitted TWO direct option→factor links onto the same licence-cost
 * factor, both citing the SAME stated figure ("Annual CRM cost is about
 * £50,000"), and the projector certified BOTH as `brief_extraction` at high
 * confidence. So the product told the user they had stated HubSpot's annual
 * licence cost, when the sentence they wrote is about the incumbent.
 *
 * ⛔ THE QUOTE CANNOT SETTLE IT, AND THE EXISTING QUOTE VETOES GET IT BACKWARDS.
 * Ported and run against the real quotes: `figureQuoteContradictsOptionBasis`
 * does NOT fire on the challenger (the defect) and DOES fire on the baseline
 * (the one true claim), because "CRM" sits in the challenger's own label
 * *and* in the incumbent's cost sentence. `figureQuoteContradictsTypedOptionRole`
 * fires on neither. The incumbent-ness lives in the brief's PRECEDING clause,
 * not in the quoted sentence — `source-authority-option-magnitude.test.ts`
 * already pins the shared-CRM-token quote as not vetoable.
 *
 * ⭐ THE REMEDY IS THIS FILE'S OWN RATIFIED PRINCIPLE, MISSING FROM ONE BRANCH.
 * `bindFactorCarriedStatedMagnitude` (the recovery branch) already refuses when
 * the evidence cannot name ONE owning option — "A target factor that cites two
 * options cannot lend one option's figure to the other… the old rule falsely
 * certified both links as brief extraction, including the status quo"
 * (source-authority-option-magnitude.test.ts:419-431). `bindDirectStatedMagnitude`
 * never received it. This suite pins that A now does what B does.
 *
 * The refusal is FAIL-CLOSED, not silent: the value is kept, only the unearned
 * label is withdrawn, and the existing "has unresolved stated-item binding"
 * receipt routes it to the `ambiguous_value` / `confirm_value` ask the system
 * already understands. Nothing new is minted.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const FULL_SWITCH = "replace our current CRM with HubSpot next quarter";
const STATUS_QUO = "keep what we have";
const LICENCE = "CRM Annual Licence Cost";
const MIGRATION = "One-Off Migration Cost";

/**
 * The four live specimens this suite exists for, pinned BY IDENTITY so a
 * reword cannot quietly detach the test from its evidence. Golden-journey
 * capture ids, CEE builds `c24bfe3` / `7a5cd91` / `58fdb11`, all 26 Aug 2026.
 */
const LIVE_SPECIMEN_RUNS = ["c96f01", "17c4a0", "d30b34", "693ddb"] as const;

/** The exact sentence all four specimens bound to BOTH options. */
const SHARED_FIGURE_QUOTE = "Annual CRM cost is about £50,000";
/**
 * The natural control from the same corpus: across all 117 captures the
 * £20,000 switching figure is claimed by exactly ONE option, every time. A real
 * never-shared figure is a stronger control than a synthetic one.
 */
const SOLE_FIGURE_QUOTE = "switching would cost roughly £20,000 one-off";

const BRIEF =
  `Should we ${FULL_SWITCH}, or ${STATUS_QUO}? ` +
  `We are a 26-person B2B sales team. ${SHARED_FIGURE_QUOTE} and ${SOLE_FIGURE_QUOTE}. ` +
  "The goal is higher sales productivity without blowing the budget.";

/**
 * `baselineAlsoClaimsSharedFigure` is the ONLY axis under test. With it false
 * the licence figure has one owner and must keep its brief authority; with it
 * true two mutually exclusive options claim the same sentence and neither may.
 */
function records(args: { baselineAlsoClaimsSharedFigure: boolean }): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: FULL_SWITCH, is_baseline: false },
      { kind: "option", source_quote: STATUS_QUO, is_baseline: true },
      {
        kind: "goal",
        source_quote: "higher sales productivity without blowing the budget",
        role: "target",
      },
      { kind: "figure", source_quote: SHARED_FIGURE_QUOTE, value: 50_000, unit: "£" },
      { kind: "figure", source_quote: SOLE_FIGURE_QUOTE, value: 20_000, unit: "£" },
    ],
    claims: [
      { claim_kind: "factor", label: LICENCE, basis: [3], value: 50_000 },
      { claim_kind: "factor", label: MIGRATION, basis: [4], value: 0 },
      {
        claim_kind: "causal_link",
        label: "HubSpot sets the annual licence cost",
        basis: [3],
        from_stated: 0,
        to_claim: 0,
        effect: "positive",
        sets_to: 50_000,
      },
      ...(args.baselineAlsoClaimsSharedFigure
        ? ([
            {
              claim_kind: "causal_link",
              label: "Status quo sets the annual licence cost",
              basis: [3],
              from_stated: 1,
              to_claim: 0,
              effect: "positive",
              sets_to: 50_000,
            },
          ] as DraftRecordSet["claims"])
        : []),
      {
        claim_kind: "causal_link",
        label: "HubSpot incurs the one-off migration cost",
        basis: [4],
        from_stated: 0,
        to_claim: 1,
        effect: "positive",
        sets_to: 20_000,
      },
      {
        claim_kind: "causal_link",
        label: "Status quo incurs no migration cost",
        from_stated: 1,
        to_claim: 1,
        effect: "positive",
        sets_to: 0,
      },
      {
        claim_kind: "causal_link",
        label: "Licence cost affects the goal",
        basis: [3],
        from_claim: 0,
        to_stated: 2,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "Migration cost affects the goal",
        basis: [4],
        from_claim: 1,
        to_stated: 2,
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

/** Bind by IDENTITY — option label AND factor label — never by a value predicate. */
function bindingOf(
  projection: Projected,
  optionLabel: string,
  factorLabel: string,
): Record<string, unknown> | undefined {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, factorLabel);
  return (
    option.data?.intervention_details as Record<string, Record<string, unknown>> | undefined
  )?.[factor.id];
}

function rawOf(projection: Projected, optionLabel: string, factorLabel: string): unknown {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, factorLabel);
  return (option.data?.raw_interventions as Record<string, unknown> | undefined)?.[factor.id];
}

describe("a stated figure may license at most one option (direct binding branch)", () => {
  it("withdraws brief authority from BOTH options when they claim the same stated figure", () => {
    const projection = projectRecordsToGraph(records({ baselineAlsoClaimsSharedFigure: true }), BRIEF);

    // ⭐ PRECONDITION PINNED IN-TEST (trap 13b): this assertion is only about
    // the refusal if both options really did mint a licence intervention. A
    // fixture that silently minted nothing would satisfy a bare "not
    // brief_extraction" check while proving nothing.
    const challenger = bindingOf(projection, FULL_SWITCH, LICENCE);
    const baseline = bindingOf(projection, STATUS_QUO, LICENCE);
    expect(challenger, "challenger must carry a licence intervention").toBeDefined();
    expect(baseline, "baseline must carry a licence intervention").toBeDefined();
    expect(rawOf(projection, FULL_SWITCH, LICENCE)).toBe(50_000);
    expect(rawOf(projection, STATUS_QUO, LICENCE)).toBe(50_000);

    // THE DEFECT: the product asserted the user stated HubSpot's licence cost.
    expect(challenger).toMatchObject({ source: "cee_hypothesis" });
    // AND ITS TWIN: the status quo's claim on the same sentence is equally
    // undeterminable from the evidence, so it is withdrawn too. Fail-closed in
    // BOTH directions — never a rule that quietly prefers one role.
    expect(baseline).toMatchObject({ source: "cee_hypothesis" });

    // The receipt routes to the existing confirm-value ask; nothing new minted.
    expect(String(challenger?.reasoning)).toContain("unresolved stated-item binding");
    expect(String(baseline?.reasoning)).toContain("unresolved stated-item binding");

    // Evidence pinned by identity, not by count: these four captures are the
    // measured population this refusal was written against (4 of the 6 corpus
    // runs that used this branch). Kept in-test so the suite names its evidence.
    expect(LIVE_SPECIMEN_RUNS).toEqual(["c96f01", "17c4a0", "d30b34", "693ddb"]);
  });

  it("keeps brief authority when the figure has exactly ONE owning option", () => {
    const projection = projectRecordsToGraph(records({ baselineAlsoClaimsSharedFigure: false }), BRIEF);

    // The licence figure is now claimed only by the challenger — authority stands.
    expect(bindingOf(projection, FULL_SWITCH, LICENCE)).toMatchObject({
      raw_value: 50_000,
      unit: "£",
      source: "brief_extraction",
    });
    expect(bindingOf(projection, STATUS_QUO, LICENCE)).toBeUndefined();
  });

  it("never touches a figure that only one option ever claims (the £20,000 corpus control)", () => {
    // Present in BOTH fixtures, including the colliding one: the collision on
    // the licence figure must not leak onto an unrelated, singly-owned figure.
    for (const baselineAlsoClaimsSharedFigure of [false, true]) {
      const projection = projectRecordsToGraph(records({ baselineAlsoClaimsSharedFigure }), BRIEF);
      expect(
        bindingOf(projection, FULL_SWITCH, MIGRATION),
        `£20,000 authority must survive (collision=${baselineAlsoClaimsSharedFigure})`,
      ).toMatchObject({ raw_value: 20_000, unit: "£", source: "brief_extraction" });
    }
  });
});
