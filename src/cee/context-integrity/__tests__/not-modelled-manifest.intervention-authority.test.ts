/**
 * The not-modelled manifest must recognise a quantity carried by the canonical
 * option -> factor InterventionV3 contract. The encoded `value` is an analysis
 * scale; `raw_value` + `unit` is the reversible real-world amount.
 *
 * This is deliberately authority-sensitive. An unresolved CEE hypothesis can
 * carry the same raw number, but it is not evidence that the user's stated
 * amount made it into the model.
 */

import { describe, expect, it } from "vitest";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

const FACTOR_ID = "fac_crm_switch_investment";
const OPTION_ID = "opt_full_crm_switch";

interface InterventionFixture {
  readonly value: number;
  readonly raw_value: number;
  readonly unit?: string;
  readonly source: "brief_extraction" | "cee_hypothesis";
  readonly value_confidence: "high" | "low";
}

function graphWithIntervention(intervention: InterventionFixture): Record<string, unknown> {
  return {
    nodes: [
      {
        id: FACTOR_ID,
        kind: "factor",
        label: "CRM Switch Investment",
        observed_state: { value: 0.5, source: "cee_inference" },
      },
      {
        id: OPTION_ID,
        kind: "option",
        label: "Replace our current CRM with HubSpot",
        interventions: {
          [FACTOR_ID]: {
            ...intervention,
            reasoning: "Direct causal amount carried from the user's brief",
            target_match: {
              node_id: FACTOR_ID,
              confidence: "high",
              match_type: "exact_id",
            },
          },
        },
      },
    ],
  };
}

function itemFor(
  literal: "£20,000" | "£25,000",
  graph: Record<string, unknown>,
) {
  const brief = `Switching would cost roughly ${literal} one-off.`;
  const item = deriveNotModelledManifest(brief, graph).quantities?.items.find(
    (candidate) => candidate.literal === literal,
  );
  expect(item, `the manifest must report ${literal}`).toBeDefined();
  return item!;
}

describe("canonical InterventionV3 quantity authority", () => {
  it.each([
    ["£20,000", 20_000, 0.4],
    ["£25,000", 25_000, 0.5],
  ] as const)(
    "classifies source-bound %s raw_value as in_model and names its factor",
    (literal, rawValue, encodedValue) => {
      const item = itemFor(
        literal,
        graphWithIntervention({
          value: encodedValue,
          raw_value: rawValue,
          unit: "£",
          source: "brief_extraction",
          value_confidence: "high",
        }),
      );

      expect(item.verdict).toBe("in_model");
      expect(item.matched_node_id).toBe(FACTOR_ID);
    },
  );

  it("does not certify an unresolved, unitless low-confidence hypothesis", () => {
    const item = itemFor(
      "£25,000",
      graphWithIntervention({
        value: 0.5,
        raw_value: 25_000,
        source: "cee_hypothesis",
        value_confidence: "low",
      }),
    );

    expect(item.verdict).not.toBe("in_model");
    expect(item.matched_node_id).toBeNull();
  });

  it("does not let a low-confidence hypothesis self-certify by supplying a unit", () => {
    const item = itemFor(
      "£25,000",
      graphWithIntervention({
        value: 0.5,
        raw_value: 25_000,
        unit: "£",
        source: "cee_hypothesis",
        value_confidence: "low",
      }),
    );

    expect(item.verdict).not.toBe("in_model");
    expect(item.matched_node_id).toBeNull();
  });
});
