/**
 * B1 — SOURCE AUTHORITY ON OPTION MAGNITUDES.
 *
 * Live-shape regression from scenario 4add27c3-0e41-46e4-ba64-00be6d389138:
 * the user stated a £20,000 full-switch cost and a valid £0 status quo; the
 * model separately authored an £8,000 phased pilot. The pilot names exactly
 * one stated option plus a constraint in its basis, so the deployed projector
 * merged it into the full switch and let "smallest wins" replace £20,000.
 *
 * The fixture keeps the exact authority-bearing record shape while reducing
 * unrelated CRM factors. Every assertion binds by option/factor identity.
 */
import { describe, expect, it } from "vitest";

import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import type { OptionV3T } from "../../../../schemas/cee-v3.js";
import { buildAnalysisReadyPayload } from "../../../transforms/analysis-ready.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import {
  compareCanonicalInterventionCandidates,
  projectRecordsToGraph,
} from "../projector.js";

const BRIEF =
  "Should we replace our current CRM with HubSpot next quarter, or keep what we have? " +
  "We are a 37-person B2B sales team. Annual CRM cost is about £50,000 and switching " +
  "would cost roughly £20,000 one-off. The goal is higher sales productivity without " +
  "blowing the budget.";

const FULL_SWITCH = "replace our current CRM with HubSpot next quarter";
const STATUS_QUO = "keep what we have";
const PILOT = "Phased HubSpot Pilot (subset of team first)";
const COST = "One-Off Migration Cost";

function records(args: {
  fullSwitchCost?: number;
  pilotCost?: number;
  statusQuoCost?: number;
  identicalRefinement?: boolean;
  swapMagnitudeLinks?: boolean;
} = {}): DraftRecordSet {
  const fullSwitchCost = args.fullSwitchCost ?? 20_000;
  const pilotCost = args.pilotCost ?? 8_000;
  const statusQuoCost = args.statusQuoCost ?? 0;
  const pilotMagnitude = args.identicalRefinement ? fullSwitchCost : pilotCost;

  const magnitudeLinks: DraftRecordSet["claims"] = [
    {
      claim_kind: "causal_link",
      label: "HubSpot switch incurs one-off migration cost",
      basis: [0, 4],
      from_stated: 0,
      to_claim: 0,
      effect: "positive",
      sets_to: fullSwitchCost,
    },
    {
      claim_kind: "causal_link",
      label: "Status Quo incurs no migration cost",
      basis: [1, 4],
      from_stated: 1,
      to_claim: 0,
      effect: "positive",
      sets_to: statusQuoCost,
    },
    {
      claim_kind: "causal_link",
      label: "Phased pilot sets lower one-off migration cost initially",
      basis: [4],
      from_claim: 1,
      to_claim: 0,
      effect: "positive",
      sets_to: pilotMagnitude,
    },
  ];

  return {
    stated_items: [
      { kind: "option", source_quote: FULL_SWITCH, is_baseline: false },
      { kind: "option", source_quote: STATUS_QUO, is_baseline: true },
      {
        kind: "goal",
        source_quote: "higher sales productivity without blowing the budget",
        role: "target",
      },
      { kind: "figure", source_quote: "Annual CRM cost is about £50,000", value: 50_000, unit: "£" },
      {
        kind: "figure",
        source_quote: `switching would cost roughly £${fullSwitchCost.toLocaleString("en-GB")} one-off`,
        value: fullSwitchCost,
        unit: "£",
      },
      { kind: "figure", source_quote: "37-person B2B sales team", value: 37, unit: "people" },
      { kind: "constraint", source_quote: "without blowing the budget", direction: "ceiling" },
    ],
    claims: [
      { claim_kind: "factor", label: COST, basis: [4], value: 0 },
      {
        claim_kind: "option_refinement",
        label: PILOT,
        basis: [0, 6],
        is_baseline: false,
      },
      ...(args.swapMagnitudeLinks ? [...magnitudeLinks].reverse() : magnitudeLinks),
      {
        claim_kind: "causal_link",
        label: "Migration cost contributes to the goal",
        basis: [4, 6],
        from_claim: 0,
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

function interventionOf(projection: Projected, optionLabel: string): number {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, COST);
  return (option.data?.interventions as Record<string, number>)[factor.id]!;
}

function rawInterventionOf(projection: Projected, optionLabel: string): unknown {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, COST);
  return (option.data?.raw_interventions as Record<string, unknown> | undefined)?.[factor.id];
}

function bindingOf(projection: Projected, optionLabel: string): Record<string, unknown> | undefined {
  const option = nodeByLabel(projection, optionLabel);
  const factor = nodeByLabel(projection, COST);
  return (
    option.data?.intervention_details as Record<string, Record<string, unknown>> | undefined
  )?.[factor.id];
}

function v3OptionByLabel(options: OptionV3T[], label: string): OptionV3T {
  const matches = options.filter((option) => option.label === label);
  expect(matches, `expected exactly one V3 option labelled ${label}`).toHaveLength(1);
  return matches[0]!;
}

describe("B1 source authority: stated full-switch magnitude vs AI pilot", () => {
  it("keeps £20k on the full switch, £0 on status quo, and £8k on a distinct pilot", () => {
    const projection = projectRecordsToGraph(records(), BRIEF);

    expect(interventionOf(projection, FULL_SWITCH)).toBe(0.4);
    expect(interventionOf(projection, STATUS_QUO)).toBe(0);
    expect(interventionOf(projection, PILOT)).toBe(0.16);

    expect(rawInterventionOf(projection, FULL_SWITCH)).toBe(20_000);
    expect(rawInterventionOf(projection, STATUS_QUO)).toBe(0);
    expect(rawInterventionOf(projection, PILOT)).toBe(8_000);
    expect(bindingOf(projection, FULL_SWITCH)).toMatchObject({
      raw_value: 20_000,
      unit: "£",
      source: "brief_extraction",
    });

    expect(
      projection.dropped.filter(
        (entry) => entry.reason === "refinement_merged_into_stated_option",
      ),
    ).toHaveLength(0);
  });

  it("is invariant to non-identity-bearing causal-link order", () => {
    const original = projectRecordsToGraph(records(), BRIEF);
    const reordered = projectRecordsToGraph(records({ swapMagnitudeLinks: true }), BRIEF);

    const canonicalGraph = (projection: Projected) => ({
      ...projection.graph,
      nodes: [...projection.graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...projection.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect(canonicalGraph(reordered)).toEqual(canonicalGraph(original));
    expect(reordered.dropped).toEqual(original.dropped);
    const select = (projection: Projected) => ({
      full: interventionOf(projection, FULL_SWITCH),
      fullRaw: rawInterventionOf(projection, FULL_SWITCH),
      fullBinding: bindingOf(projection, FULL_SWITCH),
      statusQuo: interventionOf(projection, STATUS_QUO),
      pilot: interventionOf(projection, PILOT),
    });
    expect(select(reordered)).toEqual(select(original));
  });

  it("lets direct stated-option content outrank a remapped AI refinement in defence in depth", () => {
    const candidates = [
      { edgeId: "ai-pilot", setsTo: 8_000, authority: "ai_claim" as const },
      {
        edgeId: "stated-full-switch",
        setsTo: 20_000,
        authority: "direct_stated_option" as const,
      },
    ];
    expect([...candidates].sort(compareCanonicalInterventionCandidates)[0]?.setsTo).toBe(20_000);

    // Equal authority retains the pre-existing least-extravagant rule.
    expect(
      candidates
        .map((candidate) => ({ ...candidate, authority: "ai_claim" as const }))
        .sort(compareCanonicalInterventionCandidates)[0]?.setsTo,
    ).toBe(8_000);

    const projection = projectRecordsToGraph(records(), BRIEF);
    expect(interventionOf(projection, FULL_SWITCH)).toBe(0.4);

    // Discrimination: mutating only the pilot cannot move the stated option.
    const changedPilot = projectRecordsToGraph(records({ pilotCost: 7_000 }), BRIEF);
    expect(interventionOf(changedPilot, FULL_SWITCH)).toBe(0.4);
    expect(interventionOf(changedPilot, PILOT)).toBe(0.14);
    expect(rawInterventionOf(changedPilot, PILOT)).toBe(7_000);
  });

  it("changes only the full-switch binding for a separately sourced £25k twin", () => {
    const twinBrief = BRIEF.replace("£20,000", "£25,000");
    const twin = projectRecordsToGraph(records({ fullSwitchCost: 25_000 }), twinBrief);

    expect(interventionOf(twin, FULL_SWITCH)).toBe(0.5);
    expect(rawInterventionOf(twin, FULL_SWITCH)).toBe(25_000);
    expect(bindingOf(twin, FULL_SWITCH)).toMatchObject({
      raw_value: 25_000,
      unit: "£",
      source: "brief_extraction",
    });
    expect(interventionOf(twin, STATUS_QUO)).toBe(0);
    expect(interventionOf(twin, PILOT)).toBe(0.16);

    const normalised = normaliseDraftResponse(structuredClone(twin.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: twinBrief });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    const fullSwitch = v3OptionByLabel(v3.options, FULL_SWITCH);
    const pilot = v3OptionByLabel(v3.options, PILOT);
    expect(fullSwitch.interventions[factor.id]).toMatchObject({
      value: 0.5,
      raw_value: 25_000,
      unit: "£",
      source: "brief_extraction",
    });
    expect(pilot.interventions[factor.id]).toMatchObject({
      value: 0.16,
      raw_value: 8_000,
      source: "cee_hypothesis",
    });
    expect(buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph).status).toBe("ready");
  });

  it("binds the live £25k shape when the direct link omits basis but its target factor carries the same option and figure", () => {
    const twinBrief = BRIEF.replace("£20,000", "£25,000");
    const liveShape = structuredClone(records({ fullSwitchCost: 25_000 }));
    // Exact mounted 3a54d3e shape: the factor cites both the full-switch option
    // and £25k figure, while the direct option→factor link carries sets_to but
    // omits its own basis array.
    liveShape.claims[0] = { ...liveShape.claims[0]!, basis: [0, 4] };
    const fullSwitchLink = liveShape.claims.find(
      (claim) => claim.claim_kind === "causal_link" && claim.from_stated === 0 && claim.to_claim === 0,
    )!;
    delete fullSwitchLink.basis;

    const projected = projectRecordsToGraph(liveShape, twinBrief);
    expect(bindingOf(projected, FULL_SWITCH)).toMatchObject({
      raw_value: 25_000,
      unit: "£",
      source: "brief_extraction",
    });

    const normalised = normaliseDraftResponse(structuredClone(projected.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: twinBrief });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    expect(v3OptionByLabel(v3.options, FULL_SWITCH).interventions[factor.id]).toMatchObject({
      value: 0.5,
      raw_value: 25_000,
      unit: "£",
      source: "brief_extraction",
      value_confidence: "high",
    });

    // A target factor that cites only the figure does not establish which
    // option owns it; that weaker shape must remain unbound.
    const noOptionJoin = structuredClone(liveShape);
    noOptionJoin.claims[0] = { ...noOptionJoin.claims[0]!, basis: [4] };
    expect(bindingOf(projectRecordsToGraph(noOptionJoin, twinBrief), FULL_SWITCH)).toBeUndefined();

    // An explicit (but incomplete) link basis remains authoritative; target
    // inheritance must not silently repair or reinterpret it.
    const explicitIncompleteBasis = structuredClone(liveShape);
    const explicitLink = explicitIncompleteBasis.claims.find(
      (claim) => claim.claim_kind === "causal_link" && claim.from_stated === 0 && claim.to_claim === 0,
    )!;
    explicitLink.basis = [0];
    expect(
      bindingOf(projectRecordsToGraph(explicitIncompleteBasis, twinBrief), FULL_SWITCH),
    ).toBeUndefined();

    // Two same-valued candidate figures are ambiguous even when only one quote
    // happens to verify against this brief. Preserve the existing fail-closed
    // source instead of choosing a convenient candidate.
    const ambiguous = structuredClone(liveShape);
    ambiguous.stated_items.push({
      kind: "figure",
      source_quote: "A separate contingency is also £25,000",
      value: 25_000,
      unit: "£",
    });
    ambiguous.claims[0] = { ...ambiguous.claims[0]!, basis: [0, 4, 7] };
    expect(bindingOf(projectRecordsToGraph(ambiguous, twinBrief), FULL_SWITCH)).toMatchObject({
      raw_value: 25_000,
      source: "cee_hypothesis",
      reasoning: expect.stringContaining("unresolved stated-item binding"),
    });
  });

  it("preserves the genuine identical-refinement consolidation control", () => {
    const projection = projectRecordsToGraph(records({ identicalRefinement: true }), BRIEF);

    expect(projection.graph.nodes.filter((node) => node.kind === "option")).toHaveLength(2);
    expect(nodeByLabel(projection, FULL_SWITCH).provenance?.merged_refinements).toContain(PILOT);
    expect(interventionOf(projection, FULL_SWITCH)).toBe(0.4);
    expect(rawInterventionOf(projection, FULL_SWITCH)).toBe(20_000);
    expect(interventionOf(projection, STATUS_QUO)).toBe(0);
  });

  it("carries the reversible binding into InterventionV3 and admits the resolved model", () => {
    const projected = projectRecordsToGraph(records(), BRIEF);
    const normalised = normaliseDraftResponse(structuredClone(projected.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    const fullSwitch = v3OptionByLabel(v3.options, FULL_SWITCH);
    const pilot = v3OptionByLabel(v3.options, PILOT);
    const statusQuo = v3OptionByLabel(v3.options, STATUS_QUO);

    expect(fullSwitch.interventions[factor.id]).toMatchObject({
      value: 0.4,
      raw_value: 20_000,
      unit: "£",
      source: "brief_extraction",
    });
    const fullSwitchGraphNode = v3.graph.nodes.find(
      (node) => node.kind === "option" && node.label === FULL_SWITCH,
    );
    expect(fullSwitchGraphNode?.interventions?.[factor.id]).toMatchObject({
      value: 0.4,
      raw_value: 20_000,
      unit: "£",
      source: "brief_extraction",
    });
    expect(fullSwitch.raw_interventions?.[factor.id]).toBe(20_000);
    expect(pilot.interventions[factor.id]).toMatchObject({
      value: 0.16,
      raw_value: 8_000,
      source: "cee_hypothesis",
    });
    expect(statusQuo.interventions[factor.id]).toMatchObject({ value: 0, raw_value: 0 });
    expect(pilot.raw_interventions?.[factor.id]).toBe(8_000);
    expect(statusQuo.raw_interventions?.[factor.id]).toBe(0);

    const ready = buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph);
    expect(ready.status).toBe("ready");
    expect(ready.blockers ?? []).toEqual([]);
    expect(ready.options.find((option) => option.id === fullSwitch.id)?.raw_interventions).toMatchObject({
      [factor.id]: 20_000,
    });
  });

  it("fails closed when an explicit raw binding is present but its V3 source carrier is unresolved", () => {
    const projected = projectRecordsToGraph(records(), BRIEF);
    const normalised = normaliseDraftResponse(structuredClone(projected.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    const fullSwitch = v3OptionByLabel(v3.options, FULL_SWITCH);
    const broken = structuredClone(fullSwitch);
    delete broken.interventions[factor.id]!.raw_value;
    delete broken.interventions[factor.id]!.unit;
    broken.interventions[factor.id]!.source = "cee_hypothesis";
    broken.interventions[factor.id]!.value_confidence = "low";

    const options = v3.options.map((option) => (option.id === broken.id ? broken : option));
    const readiness = buildAnalysisReadyPayload(options, v3.goal_node_id, v3.graph);
    expect(readiness.status).toBe("needs_user_input");
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({
        option_id: fullSwitch.id,
        factor_id: factor.id,
        blocker_type: "ambiguous_value",
        message: expect.stringContaining("20000"),
      }),
    );
  });

  it("fails closed from the real producer when the stated figure cannot be source-verified", () => {
    const unboundRecords = structuredClone(records());
    unboundRecords.stated_items[4] = {
      kind: "figure",
      source_quote: "A different sentence says switching costs £20,000",
      value: 20_000,
      unit: "£",
    };
    const projected = projectRecordsToGraph(unboundRecords, BRIEF);
    const normalised = normaliseDraftResponse(structuredClone(projected.graph));
    const v3 = projectGraphAndOptionsToV3(normalised as never, { brief: BRIEF });
    const factor = v3.graph.nodes.find((node) => node.label === COST)!;
    const fullSwitch = v3OptionByLabel(v3.options, FULL_SWITCH);

    expect(fullSwitch.interventions[factor.id]).toMatchObject({
      value: 0.4,
      raw_value: 20_000,
      source: "cee_hypothesis",
      reasoning: expect.stringContaining("unresolved stated-item binding"),
    });
    const readiness = buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph);
    expect(readiness.status).toBe("needs_user_input");
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({
        option_id: fullSwitch.id,
        factor_id: factor.id,
        blocker_type: "ambiguous_value",
        message: expect.stringContaining("20000"),
      }),
    );
  });

  it("keeps the status-quo £0 control load-bearing", () => {
    const changed = projectRecordsToGraph(records({ statusQuoCost: 1 }), BRIEF);
    expect(interventionOf(changed, STATUS_QUO)).not.toBe(0);
  });
});
