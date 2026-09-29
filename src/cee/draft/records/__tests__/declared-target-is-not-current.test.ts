import { describe, expect, it } from "vitest";
import { LLMDraftResponse } from "../../../../adapters/llm/shared-schemas.js";
import { enrichGraphWithFactors, enrichGraphWithFactorsAsync } from "../../../factor-extraction/enricher.js";
import { transformNodeToV3 } from "../../../transforms/schema-v3.js";
import { transformResponseToV3 } from "../../../transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../../../schemas/cee-v3.js";
import type { DraftRecordRole, DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

function fixture(role: DraftRecordRole, claimBased = false, sibling = false, independentBaseline = false, claimLabel = "Price") {
  const quote = {
    target: "The target price is £80", baseline: "The current price is £80",
    constraint: "The maximum price is £80", context: "The benchmark price is £80",
  }[role];
  const records: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "Grow sustainably" },
      { kind: "option", source_quote: "Release a new product" },
      { kind: "option", source_quote: "Keep the current product" },
      { kind: "figure", source_quote: quote, value: 80, unit: "£", role },
    ],
    claims: claimBased ? [
      { claim_kind: "factor", label: claimLabel, basis: [3] },
      { claim_kind: "causal_link", label: "Price supports growth", from_claim: 0, to_stated: 0 },
    ] : [
      { claim_kind: "causal_link", label: "Price supports growth", from_stated: 3, to_stated: 0 },
    ],
  };
  if (sibling) {
    const index = records.claims.length;
    records.claims.push(
      { claim_kind: "factor", label: "Price exposure", basis: [] },
      { claim_kind: "causal_link", label: "Exposure affects growth", from_claim: index, to_stated: 0 },
    );
  }
  if (independentBaseline) {
    const index = records.stated_items.length;
    records.stated_items.push({ kind: "figure", source_quote: "The current price is £80", value: 80, unit: "£", role: "baseline" });
    const claimIndex = records.claims.length;
    records.claims.push(
      { claim_kind: "factor", label: "Current price", basis: [index] },
      { claim_kind: "causal_link", label: "Current price affects growth", from_claim: claimIndex, to_stated: 0 },
    );
  }
  const brief = `Grow sustainably. Release a new product or keep the current product. ${quote}.${independentBaseline ? " The current price is £80." : ""}`;
  const projection = projectRecordsToGraph(records, brief);
  const node = projection.graph.nodes.find(n => n.kind === "factor")!;
  expect(node).toBeDefined();
  expect(LLMDraftResponse.safeParse(projection.graph).success).toBe(true);
  return { projection, node, brief, quote, records };
}

describe("declared target remains distinct from a current measurement", () => {
  it("discloses a contextual quantity once, according to its final retained or withdrawn disposition", () => {
    const retained = fixture("context");
    expect(retained.projection.dropped.filter(d => d.node_id === retained.node.id)).toEqual([
      expect.objectContaining({ reason: "stated_figure_not_current_value", value: 80, unit: "£" }),
    ]);
    expect(transformNodeToV3(retained.node as never).observed_state).toBeUndefined();

    const withdrawn = projectRecordsToGraph({ ...retained.records, claims: [] }, retained.brief);
    expect(withdrawn.graph.nodes.some(n => n.id === retained.node.id)).toBe(false);
    expect(withdrawn.dropped.filter(d => d.node_id === retained.node.id)).toEqual([
      expect.objectContaining({ reason: "unconnected_to_goal", value: 80, unit: "£" }),
    ]);
    const wire = CEEGraphResponseV3.parse(transformResponseToV3({
      graph: withdrawn.graph, record_disclosures: withdrawn.dropped,
    } as never));
    expect(wire.record_disclosures?.filter(d => d.label === retained.quote)).toEqual([
      expect.objectContaining({ reason: "unconnected_to_goal", value: 80, unit: "£" }),
    ]);
  });
  it("withholds target observations through conversion and retains the unresolved quantity", () => {
    const { projection, node, quote } = fixture("target");
    expect(node.data).toEqual({ role: "target", unit: "£" });
    expect(node.observed_state).toBeUndefined();
    expect(transformNodeToV3(node as never).observed_state).toBeUndefined();
    expect(projection.dropped).toContainEqual(expect.objectContaining({
      reason: "stated_target_not_represented_as_threshold", label: quote, value: 80, unit: "£",
    }));
    const wire = CEEGraphResponseV3.parse(transformResponseToV3({
      graph: projection.graph, record_disclosures: projection.dropped,
    } as never));
    expect(wire.record_disclosures).toContainEqual(expect.objectContaining({
      reason: "stated_target_not_represented_as_threshold", label: quote, value: 80, unit: "£",
    }));
  });

  it("still carries an authored current measurement in its original units", () => {
    const { node, projection } = fixture("baseline");
    expect(transformNodeToV3(node as never).observed_state?.raw_value).toBe(80);
    expect(projection.dropped.some(d => d.reason === "stated_target_not_represented_as_threshold")).toBe(false);
  });

  for (const enrich of [enrichGraphWithFactors, enrichGraphWithFactorsAsync]) {
    for (const claimBased of [false, true]) {
    it(`${enrich.name} cannot route a protected quantity into an unbased sibling (claim ${claimBased})`, async () => {
      const input = fixture("target", claimBased, true, false, "Commercial terms");
      const output = await enrich(input.projection.graph as never, input.brief);
      expect(output.graph.nodes.filter(n => n.kind === "factor")).toHaveLength(2);
      for (const factor of output.graph.nodes.filter(n => n.kind === "factor")) {
        expect(transformNodeToV3(factor as never).observed_state).toBeUndefined();
      }
      const positive = fixture("target", claimBased, true, true, "Commercial terms");
      expect(positive.projection.graph.nodes.find(n => n.label === "Current price")?.data?.value).toBeUndefined();
      const kept = await enrich(positive.projection.graph as never, positive.brief);
      const baseline = kept.graph.nodes.find(n => n.label === "Current price")!;
      expect(baseline).toBeDefined();
      const observed = transformNodeToV3(baseline as never).observed_state;
      expect(observed?.raw_value ?? observed?.value).toBe(80);
      expect(observed?.unit).toBe("£");
      expect(kept.factorsEnhanced).toBeGreaterThan(0);
    });
    }
  }

  for (const role of ["target", "constraint", "context"] as const) {
  for (const claimBased of [false, true]) {
    for (const enrich of [enrichGraphWithFactors, enrichGraphWithFactorsAsync]) {
      it(`${enrich.name} cannot reinstall a ${claimBased ? "claim-basis" : "direct"} target as current (${role})`, async () => {
        const target = fixture(role, claimBased);
        const baseline = fixture("baseline", claimBased);
        if (claimBased) {
          expect(target.node.provenance?.basis_figures).toEqual([
            { value: 80, unit: "£", source_quote: target.quote, role },
          ]);
        }
        const output = await enrich(target.projection.graph as never, target.brief);
        const current = output.graph.nodes.find(n => n.id === target.node.id)!;
        expect(current).toBeDefined();
        expect(transformNodeToV3(current as never).observed_state).toBeUndefined();
        expect(output.graph.nodes.filter(n => n.kind === "factor")).toHaveLength(1);

        const positive = await enrich(baseline.projection.graph as never, baseline.brief);
        const baselineNode = positive.graph.nodes.find(n => n.id === baseline.node.id)!;
        const observed = transformNodeToV3(baselineNode as never).observed_state;
        expect(observed?.raw_value ?? observed?.value).toBe(80);
        expect(observed?.unit).toBe("£");
        if (claimBased) expect(positive.factorsEnhanced).toBeGreaterThan(0);
      });
    }
  }
  }
});
