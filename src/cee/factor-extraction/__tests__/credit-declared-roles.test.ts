import { describe, expect, it } from "vitest";
import type { GraphT } from "../../../schemas/graph.js";
import type { DraftRecordRole, DraftRecordSet } from "../../draft/records/grammar.js";
import { projectRecordsToGraph } from "../../draft/records/projector.js";
import { transformNodeToV3 } from "../../transforms/schema-v3.js";
import { creditUserTypedFigures } from "../enricher.js";

function projectedClaim(role: DraftRecordRole, unbased = false, movement = false) {
  const quote = movement ? "Reduce churn rate from 6% to 4%" : {
    constraint: "Keep churn rate under 4%",
    target: "Our target churn rate is 4%",
    context: "The industry churn rate is 4%",
    baseline: "Our current churn rate is 4%",
  }[role];
  const statedValue = movement && role === "baseline" ? 6 : 4;
  const brief = `Keep customers. Improve onboarding or keep service. ${quote}.`;
  const records: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "Keep customers" },
      { kind: "option", source_quote: "Improve onboarding" },
      { kind: "option", source_quote: "keep service" },
      { kind: "figure", source_quote: quote, value: statedValue, unit: "%", role },
    ],
    claims: [
      {
        claim_kind: "factor", label: "Churn Rate", value: statedValue / 100, unit: "%",
        value_scale: "unit_interval", basis: unbased ? [] : [3],
      },
      { claim_kind: "causal_link", label: "Churn affects retention", from_claim: 0, to_stated: 0 },
      ...(unbased ? [{
        claim_kind: "causal_link" as const, label: "Declared figure informs retention",
        from_stated: 3, to_stated: 0,
      }] : []),
    ],
  };
  const graph = projectRecordsToGraph(records, brief).graph as unknown as GraphT;
  const claim = graph.nodes.find(node => node.label === "Churn Rate")!;
  expect(claim).toBeDefined();
  expect(claim.data?.extractionType).toBe("inferred");
  return { graph, brief, claim };
}

describe("provenance credit respects the records' current-value authority", () => {
  it.each(["constraint", "target", "context"] as const)(
    "does not credit an estimated current value from a declared %s",
    (role) => {
      const { graph, brief, claim } = projectedClaim(role);
      expect(creditUserTypedFigures(graph, brief)).toBe(0);
      const after = graph.nodes.find(node => node.id === claim.id)!;
      expect(after.data).toEqual(claim.data);
      expect(transformNodeToV3(after).observed_state?.source).toBe("cee_inference");
    },
  );

  it("still credits the same quantity when its declared role is current", () => {
    const { graph, brief, claim } = projectedClaim("baseline");
    expect(creditUserTypedFigures(graph, brief)).toBe(1);
    const after = graph.nodes.find(node => node.id === claim.id)!;
    expect(after.data?.value).toBe(0.04);
    expect(after.data?.raw_value).toBe(4);
    expect(transformNodeToV3(after).observed_state?.source).toBe("brief_extraction");
  });

  it("does not credit an unbased sibling with another node's protected target", () => {
    const { graph, brief, claim } = projectedClaim("target", true);
    expect(creditUserTypedFigures(graph, brief)).toBe(0);
    const after = graph.nodes.find(node => node.id === claim.id)!;
    expect(transformNodeToV3(after).observed_state?.source).toBe("cee_inference");
  });

  it.each(["target", "baseline"] as const)(
    "from-to wording credits only the current quantity (%s)",
    (role) => {
      const { graph, brief, claim } = projectedClaim(role, false, true);
      expect(creditUserTypedFigures(graph, brief)).toBe(role === "baseline" ? 1 : 0);
      const after = graph.nodes.find(node => node.id === claim.id)!;
      expect(after.data?.value).toBe(role === "baseline" ? 0.06 : 0.04);
      expect(transformNodeToV3(after).observed_state?.source).toBe(
        role === "baseline" ? "brief_extraction" : "cee_inference",
      );
    },
  );
});
