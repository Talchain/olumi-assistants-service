/**
 * ⭐⭐ AN UNCITED MAGNITUDE IS OURS WHICHEVER ORIGIN PRODUCED IT.
 *
 * `bindDirectStatedMagnitude` answers ONE question — *"is this option→factor
 * magnitude bound to a stated figure the user owns?"* — and it can only ask it
 * of a link that names a stated option (`from_stated`). An option the MODEL put
 * forward is an `option_refinement` claim, so its magnitude link names
 * `from_claim` instead and never reaches that binder. Measured at `d818ef5d` by
 * executing the projector: such an option projects `interventions` and
 * `raw_interventions` and **no `intervention_details` entry at all** — a number
 * on the graph with no receipt naming who authored it.
 *
 * That is the same class the stated-option branch closed at #1216 ("absence
 * represented as value"), still open on the origin that #1349's completion
 * prompt has just made the productive one: the model now ESTIMATES option
 * magnitudes where it previously withheld them, and a model-proposed option is
 * exactly an `option_refinement`.
 *
 * ⚠⚠ WHAT THIS FIX DOES NOT DO, MEASURED BEFORE IT WAS WRITTEN — READ BEFORE
 * TREATING THE RECEIPT AS A GUARANTEE. `InterventionV3.source` is a REQUIRED
 * field (`schemas/cee-v3.ts:452`) and the extractor writes it on every route,
 * so an intervention CANNOT reach a surface with no stamp; the missing receipt
 * changes the SENTENCE the user reads, not the `brief_extraction` /
 * `cee_hypothesis` verdict. And the verdict itself is decided downstream by
 * `classifyAmountAgainstBrief` over the WHOLE brief text, unbound to the
 * factor — so an uncited estimate still surfaces `brief_extraction` / high
 * whenever it coincides with any unit-compatible number anywhere in the brief,
 * on the stated-option origin (which HAS the receipt) exactly as much as on
 * this one. That residual is `intervention-extractor.ts`'s own documented
 * pre-existing gap and is NOT closed here. Naming it in the suite so the next
 * reader cannot mistake a complete receipt for a settled attribution
 * (CLAUDE.md trap 23 — the symptom metric moves, the outcome metric may not).
 *
 * ⛔ THE STAMP GOES ONE WAY ONLY. This branch may hand a value to Olumi; it may
 * never hand one to the user. A refinement that DOES cite the user's figures
 * keeps its existing route untouched — earning `brief_extraction` at the
 * projector for a model-authored option is the dangerous direction, and the
 * twins below fail if this fix ever takes it.
 */
import { describe, expect, it } from "vitest";

import type { OptionV3T } from "../../../../schemas/cee-v3.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import { PROJECTED_KIND_AFTER_NORMALISATION, projectRecordsToGraph } from "../projector.js";

const BRIEF =
  "Should we replace our current CRM with HubSpot next quarter, or keep what we have? " +
  "We are a 37-person B2B sales team. Annual CRM cost is about £50,000 and switching " +
  "would cost roughly £20,000 one-off. The goal is higher sales productivity without " +
  "blowing the budget.";

const FULL_SWITCH_QUOTE = "replace our current CRM with HubSpot next quarter";
const STATUS_QUO_QUOTE = "keep what we have";
const PILOT_LABEL = "Phased HubSpot Pilot (subset of team first)";
const COST_FACTOR = "One-Off Migration Cost";

/** The stated £20,000 switching cost. Index into `stated_items` below. */
const STATED_SWITCH_FIGURE = 4;

/**
 * @param pilotSetsTo   the magnitude on the MODEL-PROPOSED option's link.
 * @param pilotBasis    what that link cites. `[]` is the uncited case.
 * @param switchSetsTo  the magnitude on the USER-STATED option's link.
 * @param switchBasis   what THAT link cites — the opposite-direction control.
 */
function records(args: {
  pilotSetsTo: number;
  pilotBasis: readonly number[];
  switchSetsTo: number;
  switchBasis: readonly number[];
}): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: FULL_SWITCH_QUOTE, is_baseline: false },
      { kind: "option", source_quote: STATUS_QUO_QUOTE, is_baseline: true },
      {
        kind: "goal",
        source_quote: "higher sales productivity without blowing the budget",
        role: "target",
      },
      { kind: "figure", source_quote: "Annual CRM cost is about £50,000", value: 50_000, unit: "£" },
      {
        kind: "figure",
        source_quote: "switching would cost roughly £20,000 one-off",
        value: 20_000,
        unit: "£",
      },
      { kind: "figure", source_quote: "37-person B2B sales team", value: 37, unit: "people" },
      { kind: "constraint", source_quote: "without blowing the budget", direction: "ceiling" },
    ],
    claims: [
      { claim_kind: "factor", label: COST_FACTOR, basis: [STATED_SWITCH_FIGURE], value: 0 },
      { claim_kind: "option_refinement", label: PILOT_LABEL, basis: [0, 6], is_baseline: false },
      {
        claim_kind: "causal_link",
        label: "HubSpot switch incurs one-off migration cost",
        basis: [...args.switchBasis],
        from_stated: 0,
        to_claim: 0,
        effect: "positive",
        sets_to: args.switchSetsTo,
      },
      {
        claim_kind: "causal_link",
        label: "Status Quo incurs no migration cost",
        basis: [1, STATED_SWITCH_FIGURE],
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
        sets_to: 0,
      },
      {
        claim_kind: "causal_link",
        label: "Phased pilot sets a lower one-off migration cost",
        basis: [...args.pilotBasis],
        from_claim: 1,
        to_claim: 0,
        effect: "positive",
        sets_to: args.pilotSetsTo,
      },
      {
        claim_kind: "causal_link",
        label: "Migration cost contributes to the goal",
        basis: [STATED_SWITCH_FIGURE, 6],
        from_claim: 0,
        to_stated: 2,
        effect: "negative",
      },
    ],
  } as DraftRecordSet;
}

interface OptionNodeView {
  readonly id: string;
  readonly label: string;
  readonly interventions: Record<string, number>;
  readonly rawInterventions: Record<string, number>;
  readonly details: Record<string, { source?: string; reasoning?: string; raw_value?: number }>;
}

function optionNodes(recs: DraftRecordSet): {
  readonly byLabel: Map<string, OptionNodeView>;
  readonly costFactorId: string;
  readonly options: readonly OptionV3T[];
} {
  const projection = projectRecordsToGraph(recs, BRIEF);
  const graph = projection.graph as unknown as {
    nodes: Array<{ id: string; kind: string; label?: string; data?: Record<string, unknown> }>;
  };
  const byLabel = new Map<string, OptionNodeView>();
  for (const node of graph.nodes) {
    if (node.kind !== "option") continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    byLabel.set(node.label ?? node.id, {
      id: node.id,
      label: node.label ?? node.id,
      interventions: (data.interventions ?? {}) as Record<string, number>,
      rawInterventions: (data.raw_interventions ?? {}) as Record<string, number>,
      details: (data.intervention_details ?? {}) as OptionNodeView["details"],
    });
  }
  const costFactor = graph.nodes.find((n) => n.kind === "factor" && n.label === COST_FACTOR);
  expect(costFactor, "fixture precondition: the cost factor is on the graph").toBeDefined();
  const v3 = projectGraphAndOptionsToV3(projection.graph as never, { brief: BRIEF });
  return { byLabel, costFactorId: costFactor!.id, options: v3.options };
}

/**
 * ⭐ PIN THE PRECONDITION IN-TEST (CLAUDE.md trap 13b). Every assertion below is
 * about the MODEL-PROPOSED option, and it is worth nothing if the fixture stops
 * producing one — a refinement whose magnitude equals its parent's is MERGED
 * away, so this is a live way for the discriminator to stop discriminating with
 * no red anywhere.
 */
function pilot(byLabel: Map<string, OptionNodeView>): OptionNodeView {
  const node = byLabel.get(PILOT_LABEL);
  expect(
    node,
    `fixture precondition: the model-proposed option "${PILOT_LABEL}" survived as its own node`,
  ).toBeDefined();
  return node!;
}

function statedSwitch(byLabel: Map<string, OptionNodeView>): OptionNodeView {
  const label = [...byLabel.keys()].find((k) => k.toLowerCase().includes("hubspot") && k !== PILOT_LABEL);
  expect(label, "fixture precondition: the user-stated switch option survived").toBeDefined();
  return byLabel.get(label!)!;
}

describe("an option→factor magnitude carries a receipt whichever origin authored it", () => {
  it("RED-first: a MODEL-PROPOSED option's UNCITED magnitude is stamped as Olumi's own", () => {
    const { byLabel, costFactorId } = optionNodes(
      records({ pilotSetsTo: 8_000, pilotBasis: [], switchSetsTo: 31_500, switchBasis: [] }),
    );
    const node = pilot(byLabel);

    // Precondition: the value really is on the graph, so a missing receipt is a
    // missing receipt and not a missing intervention.
    expect(node.rawInterventions[costFactorId]).toBe(8_000);

    const detail = node.details[costFactorId];
    expect(
      detail,
      "a magnitude on the graph must name who authored it; this origin wrote none",
    ).toBeDefined();
    expect(detail!.source).toBe("cee_hypothesis");
    expect(detail!.raw_value).toBe(8_000);
    expect(detail!.reasoning).toMatch(/^Olumi estimate via edge \S+; no stated figure is cited/);
  });

  it("OPPOSITE-DIRECTION TWIN: a user-stated figure keeps the USER's authorship", () => {
    const { byLabel, costFactorId, options } = optionNodes(
      records({
        pilotSetsTo: 8_000,
        pilotBasis: [],
        switchSetsTo: 20_000,
        switchBasis: [STATED_SWITCH_FIGURE],
      }),
    );
    const node = statedSwitch(byLabel);

    // Precondition: this is the figure the user actually wrote.
    expect(node.rawInterventions[costFactorId]).toBe(20_000);

    const detail = node.details[costFactorId];
    expect(detail?.source).toBe("brief_extraction");
    expect(detail?.reasoning).toMatch(/^Direct causal value bound by edge \S+ to stated_items\[4\]/);
    expect(detail?.reasoning).not.toMatch(/Olumi estimate/);

    const surfaced = options.find((o) => o.id === node.id);
    expect(surfaced?.interventions?.[costFactorId]?.source).toBe("brief_extraction");
    expect(surfaced?.interventions?.[costFactorId]?.value_confidence).toBe("high");
  });

  it("OPPOSITE-DIRECTION TWIN: a MODEL-PROPOSED option that CITES the user's figure is not re-stamped", () => {
    const { byLabel, costFactorId, options } = optionNodes(
      records({
        pilotSetsTo: 20_000,
        pilotBasis: [STATED_SWITCH_FIGURE],
        switchSetsTo: 31_500,
        switchBasis: [],
      }),
    );
    const node = pilot(byLabel);
    expect(node.rawInterventions[costFactorId]).toBe(20_000);

    // The uncited stamp must not fire on a citation, in EITHER direction: it may
    // not claim the value for Olumi, and it may not grant the user's authorship
    // at the projector on a model-authored option's behalf.
    expect(node.details[costFactorId]?.reasoning ?? "").not.toMatch(/Olumi estimate/);
    expect(node.details[costFactorId]?.source).not.toBe("brief_extraction");

    const surfaced = options.find((o) => o.id === node.id);
    expect(surfaced?.interventions?.[costFactorId]?.value).toBeTypeOf("number");
  });

  it("the receipt changes the SENTENCE, not the verdict — the honest outcome metric", () => {
    const { byLabel, costFactorId, options } = optionNodes(
      records({ pilotSetsTo: 8_000, pilotBasis: [], switchSetsTo: 31_500, switchBasis: [] }),
    );
    const node = pilot(byLabel);
    const surfaced = options.find((o) => o.id === node.id);
    expect(surfaced, "the model-proposed option reaches the V3 surface").toBeDefined();

    // Measured at pristine and unchanged by this fix. Pinned so a later change
    // that moves the VERDICT here has to say so out loud.
    expect(surfaced!.interventions?.[costFactorId]?.source).toBe("cee_hypothesis");
    expect(surfaced!.interventions?.[costFactorId]?.value_confidence).toBe("low");
  });

  it("KNOWN RESIDUAL, NOT CLOSED HERE: a coincidental brief match still earns the user's authorship — on BOTH origins", () => {
    // £50,000 is in the brief, as the INCUMBENT's ANNUAL cost. Both links below
    // are uncited estimates about a ONE-OFF MIGRATION cost. The downstream
    // brief-text authority is not bound to the factor, so both surface as the
    // user's own. Recording the state of the world, so the suite REDs if it
    // changes in either direction rather than leaving it invisible.
    const { byLabel, costFactorId, options } = optionNodes(
      records({ pilotSetsTo: 50_000, pilotBasis: [], switchSetsTo: 50_000, switchBasis: [] }),
    );
    const node = statedSwitch(byLabel);

    // The projector DOES stamp this one — and the stamp does not survive.
    expect(node.details[costFactorId]?.source).toBe("cee_hypothesis");
    const surfaced = options.find((o) => o.id === node.id);
    expect(surfaced?.interventions?.[costFactorId]?.source).toBe("brief_extraction");
    expect(surfaced?.interventions?.[costFactorId]?.value_confidence).toBe("high");
  });

  it("DERIVED: `option` is the only stated kind that mints an option node, so `from_claim` is the whole remaining origin", () => {
    // Closes against the ENUMERATION rather than the instance. `from_stated`
    // reaches the stated-option binder; every other option→factor magnitude
    // arrives via `from_claim`. If a future stated kind starts projecting to an
    // option node, this REDs and the new origin gets audited for a receipt.
    const statedKindsThatMintOptions = Object.entries(PROJECTED_KIND_AFTER_NORMALISATION)
      .filter(([, nodeKind]) => nodeKind === "option")
      .map(([statedKind]) => statedKind)
      .sort();
    expect(statedKindsThatMintOptions).toEqual(["option"]);
  });
});
