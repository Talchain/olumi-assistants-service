/**
 * Authored controls for the original #1576 fixture. UNRUN at authoring.
 * These cover projection and V3 carriage, not downstream analysis or Core's
 * separate baseline elicitation. A current-value estimate is not a baseline.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph, type ProjectedNode } from "../projector.js";
import { transformGraphToV3 } from "../../../transforms/schema-v3.js";

/** Bind by the projector's own minted id via kind+label — never by value (trap 19). */
function nodeByLabel(nodes: readonly ProjectedNode[], label: string): ProjectedNode | undefined {
  return nodes.find((n) => n.label === label);
}

/**
 * The original #1576 fixture: three measured claims and an excluded option,
 * with an explicit percentage convention and a connected causal spine.
 */
const RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "keep monthly churn under 4%" },
    { kind: "option", source_quote: "run a retention programme" },
  ],
  claims: [
    { claim_kind: "factor", label: "Support Response Time", value: 0.42, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "risk", label: "Pro Subscriber Churn Rate", value: 0.04, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "outcome", label: "Net Revenue Retention", value: 0.88, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "option_refinement", label: "Ship a win-back campaign", value: 0.5, unit: "%", value_scale: "unit_interval" },
    // The causal spine, so every node above survives the connectivity prune and
    // the comparison is between kinds rather than between a kept node and a
    // dropped one. option -> factor -> risk -> goal, and factor -> outcome -> goal.
    { claim_kind: "causal_link", label: "the campaign moves response time", from_stated: 1, to_claim: 0 },
    { claim_kind: "causal_link", label: "response time drives churn", from_claim: 0, to_claim: 1 },
    { claim_kind: "causal_link", label: "response time drives retention", from_claim: 0, to_claim: 2 },
    { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0 },
    { claim_kind: "causal_link", label: "retention bears on the goal", from_claim: 2, to_stated: 0 },
  ],
};

const EXPECTED = [
  { label: "Support Response Time", kind: "factor", value: 0.42, raw: 42, display: "42%" },
  { label: "Pro Subscriber Churn Rate", kind: "risk", value: 0.04, raw: 4, display: "4%" },
  { label: "Net Revenue Retention", kind: "outcome", value: 0.88, raw: 88, display: "88%" },
];

describe("the original level-bearing claims retain their quantity and attribution", () => {
  it.each(EXPECTED)("$kind retains its declared unit and display magnitude", ({ label, kind, value, raw }) => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const node = nodeByLabel(graph.nodes as readonly ProjectedNode[], label);
    expect(node).toBeDefined();
    expect(node!.kind).toBe(kind);
    expect(node!.data).toMatchObject({ value, raw_value: raw, unit: "%", extractionType: "inferred" });
    expect(node!.observed_state).toMatchObject({ value, raw_value: raw, declared_scale: "unit_interval" });
    expect(node!.declared_scale).toBe("unit_interval");
    expect(node!.observed_state?.baseline).toBeUndefined();
    expect(node!.data?.cap).toBeUndefined();
  });

  it.each(EXPECTED)("$kind survives V3 with a correct display, inferred source and no baseline", ({ label, kind, value, raw, display }) => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const v3 = transformGraphToV3(graph as never);
    const node = v3.graph.nodes.find((n) => n.label === label);
    expect(node).toBeDefined();
    expect(node!.kind).toBe(kind);
    expect(node!.observed_state).toMatchObject({
      value, raw_value: raw, unit: "%", declared_scale: "unit_interval", source: "cee_inference",
    });
    expect(node!.display_value).toBe(display);
    expect(node!.observed_state?.baseline).toBeUndefined();
    expect(node!.observed_state?.cap).toBeUndefined();
  });

  it("an option_refinement does not acquire an observed level", () => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const option = nodeByLabel(graph.nodes as readonly ProjectedNode[], "Ship a win-back campaign");
    expect(option).toBeDefined();
    expect(option!.kind).toBe("option");
    expect(option!.observed_state).toBeUndefined();
    expect(option!.data).toBeUndefined();
  });

  it("removing the scale declaration does not invent a raw percentage or declare a frame", () => {
    const records = {
      ...RECORDS,
      claims: RECORDS.claims.map(({ value_scale: _scale, ...claim }) => claim),
    };
    const { graph } = projectRecordsToGraph(records as never, "keep monthly churn under 4%");
    for (const { label, value } of EXPECTED) {
      const node = nodeByLabel(graph.nodes as readonly ProjectedNode[], label);
      expect(node).toBeDefined();
      expect(node!.data).toMatchObject({ value, unit: "%", extractionType: "inferred" });
      expect(node!.data?.raw_value).toBeUndefined();
      expect(node!.declared_scale).toBeUndefined();
    }
  });
});
