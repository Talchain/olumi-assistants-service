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

import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import {
  resolveRunAdmission,
  NO_COMPARISON_NEXT_STEP,
} from "../../../../orchestrator-v5/tools/handlers/analysis-ready-core.js";
import { buildAnalysisReadyPayload } from "../../../transforms/analysis-ready.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const FULL_SWITCH = "replace our current CRM with HubSpot next quarter";
const STATUS_QUO = "keep what we have";
const LICENCE = "CRM Annual Licence Cost";
const MIGRATION = "One-Off Migration Cost";
/** Deliberately never linked to the goal, so the connectivity prune removes it. */
const ORPHAN = "Unconnected Licence Sub-Cost";

/**
 * The four live specimens this suite exists for: golden-journey captures
 * `c96f01`, `17c4a0`, `d30b34`, `693ddb` (CEE builds `c24bfe3` / `7a5cd91` /
 * `58fdb11`, all 26 Aug 2026).
 *
 * ⚠ DOCUMENTATION ONLY — deliberately NOT asserted. An earlier version compared
 * this constant to a copy of its own literals, which drives no fixture and
 * cannot RED on a reword: a constant compared to itself has no honest version.
 * What actually binds this suite to those specimens is the fixture reproducing
 * their exact quote/value/role and `bindingOf`/`nodeByLabel` selecting by option
 * AND factor IDENTITY (trap 19), not by any value predicate.
 */

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
function records(args: {
  baselineAlsoClaimsSharedFigure: boolean;
  /**
   * Only meaningful with `baselineAlsoClaimsSharedFigure`. The rival link keeps
   * the same `sets_to` but cites NO basis, so it names no evidence at all. This
   * is the axis that pins the basis-membership conjunct: a rival that cites
   * nothing has not claimed the figure and must not contest it.
   */
  rivalOmitsBasis?: boolean;
  /**
   * Only meaningful with `baselineAlsoClaimsSharedFigure`. The rival link points
   * at a factor with no path to the goal, so the connectivity prune removes it
   * and the rival's EDGE never reaches the graph — while its CLAIM survives in
   * the records the model emitted.
   */
  rivalTargetsOrphanFactor?: boolean;
}): DraftRecordSet {
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
      { claim_kind: "factor", label: ORPHAN, basis: [3], value: 50_000 },
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
              ...(args.rivalOmitsBasis === true ? {} : { basis: [3] }),
              from_stated: 1,
              to_claim: args.rivalTargetsOrphanFactor === true ? 2 : 0,
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

describe("what counts as a rival claim", () => {
  it("a rival that cites NO evidence has not claimed the figure — authority stands", () => {
    // ⭐ THIS PINS THE BASIS-MEMBERSHIP CONJUNCT, the claim doing the most work in
    // the fix. Reproduced as a SURVIVOR first: deleting that conjunct left all 475
    // records tests green, so the guard's own load-bearing condition was untested.
    // Non-equivalent, not merely uncovered — without it this case demotes.
    const projection = projectRecordsToGraph(
      records({ baselineAlsoClaimsSharedFigure: true, rivalOmitsBasis: true }),
      BRIEF,
    );

    // Precondition pinned in-test: the rival link really is present and really
    // does set the SAME magnitude — otherwise this passes for want of a rival
    // rather than for want of its evidence. Measured: a basis-less rival carries
    // the value but NO binding detail (it cites nothing, so it earns nothing),
    // which is exactly the shape this case is about.
    expect(rawOf(projection, STATUS_QUO, LICENCE)).toBe(50_000);
    // ⚠ PRECONDITION SHARPENED (option-effect-value change). This read
    // `toBeUndefined()`, which conflated "cites nothing, so it earns no BRIEF
    // authority" — the property this case is about — with "carries no
    // provenance at all", which was the class-1 defect. The rival now carries
    // the value AND an honest `cee_hypothesis` stamp; what it still does not
    // carry is brief authority, which is what leaves FULL_SWITCH's claim intact
    // below.
    expect(bindingOf(projection, STATUS_QUO, LICENCE)).toMatchObject({
      source: "cee_hypothesis",
    });

    expect(bindingOf(projection, FULL_SWITCH, LICENCE)).toMatchObject({
      raw_value: 50_000,
      source: "brief_extraction",
    });
  });

  it("a rival whose EDGE is pruned still contests the figure — decided, not incidental", () => {
    // ⛔ A DELIBERATE, NAMED COST. The rival's target factor has no path to the
    // goal, so the connectivity prune removes its edge — yet its CLAIM still
    // withdraws the challenger's brief authority.
    //
    // KEPT, on the file's own doctrine. This guard asks a question about the
    // RECORDS the model emitted — "did the user's sentence name one option or
    // two?" — not about which nodes survived graph shaping. Binding it to
    // surviving edges would make AUTHORSHIP depend on the connectivity prune and
    // the option budget: the same brief and the same sentence would earn brief
    // authority or not according to whether an unrelated factor got pruned. That
    // is a worse coupling than the extra ask, and `projector.ts`'s own pass 3c
    // reads surviving edges because it answers a DIFFERENT question (which edges
    // exist) — aligning the two would be two questions under one name (trap 21).
    //
    // Direction is FAIL-CLOSED: one extra confirm-value ask, never a false claim.
    const projection = projectRecordsToGraph(
      records({ baselineAlsoClaimsSharedFigure: true, rivalTargetsOrphanFactor: true }),
      BRIEF,
    );

    // Precondition pinned in-test: the prune really did fire.
    expect(projection.graph.nodes.filter((node) => node.label === ORPHAN)).toHaveLength(0);

    expect(bindingOf(projection, FULL_SWITCH, LICENCE)).toMatchObject({
      source: "cee_hypothesis",
    });
  });
});

/**
 * COMPOSITION WITH #1143's `IDENTICAL_OPTIONS` FLOOR.
 *
 * Two individually-correct changes can define the same authority. #1143 refuses a
 * STRICTLY-READY graph whose options carry the same intervention map (locally,
 * instead of letting PLoT 422 a network hop away). This change withdraws brief
 * authority when one stated figure is claimed by two options — and the shape that
 * triggers it, both options set to the SAME magnitude from the SAME sentence, is
 * precisely a shape whose maps can be identical. They meet on one payload.
 *
 * ⭐ MEASURED, BOTH TREES, SAME PAYLOAD (2026-08-27):
 *
 *                          staging (#1143 alone)   with this change
 *   willProceed            false                   false      (UNCHANGED)
 *   analysis_ready.status  "ready"                 "needs_user_input"
 *   blockers               0                       2 ambiguous_value/confirm_value
 *   intervention source    brief_extraction        cee_hypothesis
 *                          (the FALSE claim live)
 *
 * The floor keys on intervention VALUES, which this change does not touch, so it
 * fires identically either way. What the change adds is the two asks that say how
 * to resolve what the floor refuses: at staging alone the user gets a refusal with
 * ZERO blockers while the product still asserts they stated the challenger's price.
 * Complementary, not competing — and the direction is additive in the user's favour.
 *
 * ⚠ Separately measured: `ambiguous_value` blockers do NOT gate admission (a graph
 * with distinct maps reads `needs_user_input` with these asks AND `willProceed:
 * true`), so this change cannot weaken the floor even in principle.
 */
describe("composition with the IDENTICAL_OPTIONS admission floor", () => {
  /** One factor only, so both options' maps are COMPLETE and IDENTICAL. */
  function singleFactor(contested: boolean): DraftRecordSet {
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
        {
          claim_kind: "causal_link",
          label: "HubSpot sets the annual licence cost",
          basis: [3],
          from_stated: 0,
          to_claim: 0,
          effect: "positive",
          sets_to: 50_000,
        },
        contested
          ? // Both options claim the SAME figure: identical maps AND a contest.
            {
              claim_kind: "causal_link",
              label: "Status quo sets the annual licence cost",
              basis: [3],
              from_stated: 1,
              to_claim: 0,
              effect: "positive",
              sets_to: 50_000,
            }
          : // Control: a different figure and a distinct value — no contest.
            {
              claim_kind: "causal_link",
              label: "Status quo sets a different level",
              basis: [4],
              from_stated: 1,
              to_claim: 0,
              effect: "positive",
              sets_to: 20_000,
            },
        {
          claim_kind: "causal_link",
          label: "Licence cost affects the goal",
          basis: [3],
          from_claim: 0,
          to_stated: 2,
          effect: "negative",
        },
      ],
    };
  }

  function evaluate(contested: boolean) {
    const projection = projectRecordsToGraph(singleFactor(contested), BRIEF);
    const normalised = normaliseDraftResponse(structuredClone(projection.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
    return {
      readiness: buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph),
      admission: resolveRunAdmission(v3.graph as unknown),
    };
  }

  it("refuses the run AND names the asks that resolve it", () => {
    const { readiness, admission } = evaluate(true);

    // Precondition pinned in-test: the floor is the operative gate here. A graph
    // that were merely un-ready would refuse for a different reason entirely, and
    // this assertion would then be about the wrong mechanism.
    expect(admission.strict?.status).toBe("analysis_ready");
    expect(admission.willProceed).toBe(false);

    // ⭐ UPDATED with the silent-refusal fix. This line asserted `toBeNull()`,
    // and the comment below it ("what that refusal does not carry on its own")
    // recorded exactly why: a graph refused by the IDENTICAL_OPTIONS floor alone
    // has `strict.status === "analysis_ready"`, so it inherited a NULL next step
    // and the refusal reached the user carrying no reason.
    //
    // That null was an observation of the defect, never the property this test
    // exists to prove — the subject is that the ASKS below resolve the contest.
    // Those assertions are untouched. The refusal now also names the user's next
    // move, and the copy is honest for this shape specifically: two options that
    // set the SAME figure are not two different options to weigh.
    // See `tests/unit/analysis-refusal-carries-a-reason.test.ts`.
    expect(admission.blockedNextStep).toBe(NO_COMPARISON_NEXT_STEP);

    // And this is the channel that supplies the per-contest asks.
    expect(readiness.status).toBe("needs_user_input");
    const asks = (readiness.blockers ?? []).filter(
      (blocker) => blocker.blocker_type === "ambiguous_value",
    );
    expect(asks).toHaveLength(2);
    expect(asks.every((blocker) => blocker.suggested_action === "confirm_value")).toBe(true);
  });

  it("leaves an uncontested, genuinely-distinct comparison admissible", () => {
    // The discriminating control: without it, the case above proves only that
    // SOMETHING refuses, not that the refusal tracks the contested shape.
    const { readiness, admission } = evaluate(false);

    expect(admission.willProceed).toBe(true);
    expect(readiness.status).toBe("ready");
    expect(readiness.blockers ?? []).toHaveLength(0);
  });
});
