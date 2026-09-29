/**
 * ⭐ A CURRENCY RATE IS SAID AS "£59/month" — served-claim audit UF-3 (#70 5850056041), the price half.
 *
 * SERVED (CEE staging, DL acceptance runs 26 Sep 2026; fixture verbatim in `tests/fixtures/display/currency-rate-served.json`):
 * the Pro price reached every option card as "59 £ per month", "59 GBP/month", "59 GBP per month" or "59 £/month" — the
 * amount before its own currency sign, on the same line as the UI's "£49/month". Tally over the acceptance captures:
 * >1,500 such displays.
 *
 * THE SPEC: a unit that is a currency `synthesiseDisplayValue` already prefixes, then "/" or " per ", then a denominator,
 * is a rate: the sign leads and the denominator follows. Every other unit renders exactly as served.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { synthesiseDisplayValue } from "../../factor-extraction/display-value.js";
import type { GraphV3T, OptionV3T } from "../../../schemas/cee-v3.js";

interface ServedOption {
  option_id: string;
  label: string;
  interventions: Record<string, number>;
  served_intervention_details: Record<string, { display_value: string; raw_value?: number; unit?: string }> | null;
}
interface Served { goal_node_id: string; graph: { nodes: unknown[]; edges: unknown[] }; options: ServedOption[] }

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../tests/fixtures/display/currency-rate-served.json", import.meta.url)), "utf8"),
) as { captures: Record<string, Served> };

function build(c: Served) {
  const options = c.options.map((o) => ({
    id: o.option_id,
    label: o.label,
    status: "ready",
    interventions: Object.fromEntries(Object.entries(o.interventions).map(([fid, value]) => [fid, {
      value,
      source: "brief_extraction",
      target_match: { node_id: fid, match_type: "exact_id", confidence: "high" },
    }])),
  })) as unknown as OptionV3T[];
  return buildAnalysisReadyPayload(options, c.goal_node_id, c.graph as unknown as GraphV3T);
}

const detail = (payload: ReturnType<typeof build>, optionId: string, factorId: string) =>
  (payload.options.find((o) => o.id === optionId) as { intervention_details?: Record<string, { display_value: string }> })
    ?.intervention_details?.[factorId]?.display_value;

const RATE_UNITS: Record<string, string> = {
  pound_per_month: "£ per month",
  gbp_slash_month: "GBP/month",
  gbp_per_month: "GBP per month",
  pound_slash_month: "£/month",
};

describe("UF-3 (price) — a currency rate is said as £59/month", () => {
  for (const [key, unit] of Object.entries(RATE_UNITS)) {
    it(`[served ${unit}] every priced option reads £<amount>/month, not "<amount> ${unit}"`, () => {
      const c = FIXTURE.captures[key];
      const payload = build(c);
      let priced = 0;
      for (const o of c.options) {
        const served = o.served_intervention_details?.pro_plan_price;
        if (served === undefined) continue;
        expect(served.unit).toBe(unit);
        expect(served.display_value).toBe(`${served.raw_value} ${unit}`);
        expect(detail(payload, o.option_id, "pro_plan_price")).toBe(`£${served.raw_value}/month`);
        priced++;
      }
      expect(priced).toBeGreaterThan(0);
    });
  }

  it("[served, all four] control: every other detail is what was served, save #2055's switch words", () => {
    let compared = 0;
    for (const c of Object.values(FIXTURE.captures)) {
      const payload = build(c);
      for (const o of c.options) {
        for (const [fid, d] of Object.entries(o.served_intervention_details ?? {})) {
          if (fid === "pro_plan_price") continue;
          // #2055: a switch held at 0 that an option sets to 1 reads "on"; with no held level it stays "1" (both states).
          const held = (c.graph.nodes as Array<{ id: string; observed_state?: { value?: number } }>)
            .find((n) => n.id === fid)?.observed_state?.value;
          const expected = d.display_value === "1" && held === 0 ? "on" : d.display_value;
          expect(detail(payload, o.option_id, fid)).toBe(expected);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("the rate rule's edges (synthesiseDisplayValue)", () => {
  it("the denominator follows as written; the amount keeps the currency ladder", () => {
    expect(synthesiseDisplayValue({ raw_value: 59, unit: "£ per user" })).toBe("£59/user");
    expect(synthesiseDisplayValue({ raw_value: 12500, unit: "USD/year" })).toBe("$12.5k/year");
    expect(synthesiseDisplayValue({ raw_value: 49, unit: "EUR per seat" })).toBe("€49/seat");
  });

  it("contrasts: a bare currency, a currency with a magnitude, a percent rate and a non-currency rate are unchanged", () => {
    expect(synthesiseDisplayValue({ raw_value: 59, unit: "GBP" })).toBe("£59");
    expect(synthesiseDisplayValue({ raw_value: 59, unit: "£k/month" })).toBe("59 £k/month");
    expect(synthesiseDisplayValue({ raw_value: 7, unit: "% per month" })).toBe("7 % per month");
    expect(synthesiseDisplayValue({ raw_value: 40, unit: "hours/week" })).toBe("40 hours/week");
  });
});
