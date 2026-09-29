/**
 * ⭐ A 0/1 SWITCH IS SAID AS "on" / "off" — served-claim audit UF-3 (#70 5850056041).
 *
 * SERVED (CEE staging, DL acceptance runs, 26 Sep 2026; fixture verbatim in `tests/fixtures/display/switch-served.json`):
 *  · Run B `01-F1-brief.json`: "Next AI Feature Released" (`unit: "binary (0/1)"`, held at 0) reached every release
 *    option card as `intervention_details.next_ai_feature_released.display_value: "1"`.
 *  · Run A `07-F5-approve1.json`: after the starting point was adopted, the blocker read
 *    'Factor "AI feature availability" is currently 0 release status (0/1). What should option … set it to?'.
 *
 * THE SPEC: a factor the magnitude contract calls a switch (`isSwitch`) has its state said as `switchStateWords`, the
 * vocabulary "switching on" already uses. Every other factor renders exactly as it was served. Bound by identity: the
 * option id + factor id of each detail, and the exact blocker sentence.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import type { GraphV3T, OptionV3T } from "../../../schemas/cee-v3.js";

interface ServedOption {
  option_id: string;
  label: string;
  interventions: Record<string, number>;
  raw_interventions?: Record<string, number>;
  served_intervention_details: Record<string, { display_value: string; raw_value?: number; unit?: string }> | null;
}
interface Served {
  goal_node_id: string;
  graph: { nodes: Array<Record<string, unknown>>; edges: unknown[]; goal_constraints?: unknown };
  options: ServedOption[];
  served_blockers: string[];
}

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../tests/fixtures/display/switch-served.json", import.meta.url)), "utf8"),
) as { captures: Record<string, Served> };

function v3Options(options: ServedOption[]): OptionV3T[] {
  return options.map((o) => ({
    id: o.option_id,
    label: o.label,
    status: "ready",
    ...(o.raw_interventions ? { raw_interventions: o.raw_interventions } : {}),
    interventions: Object.fromEntries(Object.entries(o.interventions).map(([fid, value]) => [fid, {
      value,
      source: "brief_extraction",
      target_match: { node_id: fid, match_type: "exact_id", confidence: "high" },
    }])),
  })) as unknown as OptionV3T[];
}

function build(c: Served, options: ServedOption[] = c.options) {
  return buildAnalysisReadyPayload(v3Options(options), c.goal_node_id, c.graph as unknown as GraphV3T);
}

const detail = (payload: ReturnType<typeof build>, optionId: string, factorId: string) =>
  (payload.options.find((o) => o.id === optionId) as { intervention_details?: Record<string, { display_value: string }> })
    ?.intervention_details?.[factorId]?.display_value;

const B = FIXTURE.captures.runB_F1_brief;
const A = FIXTURE.captures.runA_F5_approve;

describe("UF-3 — a switch's state is said as on / off", () => {
  it("[served B F1] the release option's switch reads 'on', not '1'", () => {
    const release = B.options.find((o) => o.label === "£59 with AI Release")!;
    expect(release.served_intervention_details?.next_ai_feature_released.display_value).toBe("1");
    expect(detail(build(B), release.option_id, "next_ai_feature_released")).toBe("on");
  });

  it("[served B F1] control: every non-switch detail is what was served, save #2060's currency-rate spelling", () => {
    const payload = build(B);
    let compared = 0;
    for (const o of B.options) {
      for (const [fid, d] of Object.entries(o.served_intervention_details ?? {})) {
        if (fid === "next_ai_feature_released") continue;
        // #2060: a price in "GBP/month" reads "£59/month"; every other detail renders exactly as served.
        const expected = d.unit === "GBP/month" ? `£${d.raw_value}/month` : d.display_value;
        expect(detail(payload, o.option_id, fid)).toBe(expected);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("[served A F5] the blocker says the switch is 'off', not '0 release status (0/1)'", () => {
    expect(A.served_blockers).toContain(
      'Factor "AI feature availability" is currently 0 release status (0/1). What should option "Test £54 versus £59 by customer cohort before rollout" set it to?',
    );
    const messages = build(A).blockers?.map((b) => b.message) ?? [];
    expect(messages).toContain(
      'Factor "AI feature availability" is currently off. What should option "Test £54 versus £59 by customer cohort before rollout" set it to?',
    );
    expect(messages.some((m) => m.includes("0 release status (0/1)"))).toBe(false);
  });

  it("[served A F5] control: the non-switch blocker is unchanged", () => {
    const messages = build(A).blockers?.map((b) => b.message) ?? [];
    expect(A.served_blockers).toContain('Factor "AI add-on price" needs a numeric value for option "Keep £49 and add a paid AI add-on"');
    expect(messages).toContain('Factor "AI add-on price" needs a numeric value for option "Keep £49 and add a paid AI add-on"');
  });

  it("[served A F5] an option that sets the switch to its held 0 reads 'off', not the persisted '0 release status (0/1)'", () => {
    const node = A.graph.nodes.find((n) => n.id === "ai_feature_availability")!;
    expect(node.display_value).toBe("0 release status (0/1)");
    const options = A.options.map((o) => o.label === "Test £54 versus £59 by customer cohort before rollout"
      ? { ...o, interventions: { ...o.interventions, ai_feature_availability: 0 } } : o);
    const id = options.find((o) => o.label === "Test £54 versus £59 by customer cohort before rollout")!.option_id;
    expect(detail(build(A, options), id, "ai_feature_availability")).toBe("off");
  });

  it("contrast: once one option sets a level between 0 and 1, the factor is no switch and nothing reads on / off", () => {
    const options = B.options.map((o) => o.label === "£49 with AI Release"
      ? { ...o, interventions: { ...o.interventions, next_ai_feature_released: 0.6 } } : o);
    const payload = build(B, options);
    const at1 = options.find((o) => o.label === "£59 with AI Release")!.option_id;
    const at06 = options.find((o) => o.label === "£49 with AI Release")!.option_id;
    expect(detail(payload, at1, "next_ai_feature_released")).toBe("1");
    expect(detail(payload, at06, "next_ai_feature_released")).toBe("0.6");
  });

  it("contrast: both states must be in use; a factor whose every level is 0 is no switch", () => {
    const options = B.options.map((o) => "next_ai_feature_released" in o.interventions
      ? { ...o, interventions: { ...o.interventions, next_ai_feature_released: 0 } } : o);
    const id = options.find((o) => o.label === "£59 with AI Release")!.option_id;
    expect(detail(build(B, options), id, "next_ai_feature_released")).not.toMatch(/^(on|off)$/);
  });

  it("a native amount the option stated is a quantity, not a state; a carrier equal to the level is still 'on'", () => {
    const withCarrier = (raw: number) => B.options.map((o) => o.label === "£59 with AI Release"
      ? { ...o, raw_interventions: { next_ai_feature_released: raw } } : o);
    const id = B.options.find((o) => o.label === "£59 with AI Release")!.option_id;
    expect(detail(build(B, withCarrier(5000)), id, "next_ai_feature_released")).not.toBe("on");
    expect(detail(build(B, withCarrier(1)), id, "next_ai_feature_released")).toBe("on");
  });
});
