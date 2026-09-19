import { describe, expect, it } from "vitest";
import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { GraphV3, OptionV3, type NodeV3T, type OptionV3T } from "../../../schemas/cee-v3.js";
import { projectRecordsToGraph } from "../../draft/records/projector.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import { projectGraphAndOptionsToV3 } from "../schema-v3.js";

const FACTOR = "5c05ae61";
const GOAL = "goal_1";

function option(id: string, value: number, rawValue?: number, unit?: string): OptionV3T {
  return OptionV3.parse({
    id,
    label: id,
    status: "ready",
    interventions: {
      [FACTOR]: {
        value,
        ...(rawValue !== undefined ? { raw_value: rawValue } : {}),
        ...(unit !== undefined ? { unit } : {}),
        source: "cee_hypothesis",
        value_confidence: "low",
        reasoning: "Olumi estimate for this option",
        target_match: { node_id: FACTOR, match_type: "exact_id", confidence: "high" },
      },
    },
  });
}

function project(options: OptionV3T[], overrides: Partial<NodeV3T> = {}) {
  const graph = GraphV3.parse({
    nodes: [
      { id: GOAL, kind: "goal", label: "Sustainable growth" },
      {
        id: FACTOR,
        kind: "factor",
        label: "Sales Headcount Cost",
        observed_state: { value: 0, raw_value: 0, unit: "£", source: "cee_inference" },
        display_value: "£0",
        ...overrides,
      },
    ],
    edges: [],
  });
  const before = structuredClone(options);
  const payload = buildAnalysisReadyPayload(options, GOAL, graph);
  expect(options).toEqual(before);
  return payload;
}

function detail(payload: ReturnType<typeof project>, id: string) {
  const result = payload.options.find((candidate) => candidate.id === id)?.intervention_details?.[FACTOR];
  expect(result).toBeDefined();
  return result!;
}

describe("option-native quantities survive the analysis-ready projection", () => {
  it("carries the three captured cost amounts and genuine zero beside unchanged calculation values", () => {
    // 19 Sep d9c4066c and 54a6c321: native values survived in this raw map,
    // while the CEE details incorrectly read 0.7 £, 0.2 £ and 0.05 £.
    const rows = [
      ["05f973ef", 0.7, 140000, "£140k"],
      ["15f7737d", 0.2, 40000, "£40k"],
      ["6bdba05a", 0.05, 10000, "£10k"],
      ["94b13741", 0, 0, "£0"],
    ] as const;
    const options = rows.map(([id, level, raw]) => ({
      ...option(id, level), raw_interventions: { [FACTOR]: raw },
    }));
    const payload = project(options);
    for (const [id, level, raw, display] of rows) {
      expect(detail(payload, id)).toEqual({
        normalised_value: level, raw_value: raw, unit: "£", display_value: display,
      });
      const projected = payload.options.find((candidate) => candidate.id === id)!;
      expect(projected.interventions[FACTOR]).toMatchObject({ value: level, source: "cee_hypothesis" });
      expect(projected.raw_interventions?.[FACTOR]).toBe(raw);
      expect(projected.extraction_metadata?.source).toBe("cee_hypothesis");
    }
  });

  it("uses the canonical rich raw carrier before an older parallel map or factor-derived amount", () => {
    const input = option("current", 0.05, 10000, "£");
    input.raw_interventions = { [FACTOR]: 9000 };
    const payload = project([input], {
      observed_state: { value: 0.2, raw_value: 20000, unit: "£", source: "cee_inference" },
    });
    expect(detail(payload, "current")).toMatchObject({ raw_value: 10000, display_value: "£10k" });
    expect(payload.options[0]!.raw_interventions?.[FACTOR]).toBe(10000);
  });

  it("preserves an explicit native zero instead of substituting the factor's positive baseline", () => {
    const payload = project([option("free", 0.5, 0, "£")], {
      observed_state: { value: 0.5, raw_value: 10000, unit: "£", source: "cee_inference" },
      display_value: "£10k",
    });
    expect(detail(payload, "free")).toEqual({
      normalised_value: 0.5, raw_value: 0, unit: "£", display_value: "£0",
    });
  });

  it("does not infer an unknown native amount from a label or a zero baseline", () => {
    const payload = project([option("costs_10000", 0.05)], { label: "Cost £10,000" });
    expect(detail(payload, "costs_10000")).toEqual({
      normalised_value: 0.05, unit: "£", display_value: "0.05",
    });
    expect(payload.options[0]!.interventions[FACTOR]).toBe(0.05);
  });

  it("preserves a real sub-unit native amount without treating its magnitude as a calculation level", () => {
    const payload = project([option("pennies", 0.000005, 0.5, "£")]);
    expect(detail(payload, "pennies")).toMatchObject({ raw_value: 0.5, display_value: "£0.5" });
  });

  it.each(["people", "days"])("retains an option's native %s quantity", (unit) => {
    const payload = project([option("quantity", 0.3, 6, unit)], {
      observed_state: { value: 0, raw_value: 0, unit, source: "cee_inference" },
      display_value: undefined,
    });
    expect(detail(payload, "quantity")).toMatchObject({ raw_value: 6, unit, display_value: `6 ${unit}` });
  });

  it("renders the native amount over stale display text without changing authorship", () => {
    const input = option("budget", 0.05, 10000, "£");
    input.interventions[FACTOR]!.display_value = "0.05 £";
    input.interventions[FACTOR]!.source = "user_specified";
    const payload = project([input]);
    expect(detail(payload, "budget")).toMatchObject({ raw_value: 10000, display_value: "£10k" });
    expect(payload.options[0]!.interventions[FACTOR]).toMatchObject({ source: "user_specified", value: 0.05 });
  });
});

describe("quantity projection respects conversion evidence", () => {
  it("uses a stored calculation frame when the zero baseline cannot recover it", () => {
    const payload = project([option("framed", 0.05)], { scale_frame: 200000 });
    expect(detail(payload, "framed")).toMatchObject({ raw_value: 10000, display_value: "£10k" });
  });

  it("refuses to derive from a stored frame that contradicts the factor's value/raw pair", () => {
    const payload = project([option("conflict", 0.05)], {
      scale_frame: 200000,
      observed_state: { value: 0.2, raw_value: 20000, unit: "£", source: "cee_inference" },
    });
    expect(detail(payload, "conflict")).toEqual({ normalised_value: 0.05, unit: "£", display_value: "0.05" });
  });

  it("does not choose between conflicting cap and stored-frame conversions", () => {
    const payload = project([option("conflict", 0.05)], {
      scale_frame: 200000,
      observed_state: { value: 0, raw_value: 0, cap: 100000, unit: "£", source: "cee_inference" },
    });
    expect(detail(payload, "conflict").raw_value).toBeUndefined();
    expect(detail(payload, "conflict").display_value).toBe("0.05");
  });

  it("keeps the authored native amount even if calculation-frame evidence disagrees", () => {
    const payload = project([option("native", 0.05, 10000, "£")], {
      scale_frame: 200000,
      observed_state: { value: 0.2, raw_value: 20000, unit: "£", source: "cee_inference" },
    });
    expect(detail(payload, "native")).toMatchObject({ normalised_value: 0.05, raw_value: 10000, display_value: "£10k" });
  });

  it("keeps the intervention's own unit with its raw amount, without currency conversion", () => {
    const payload = project([option("dollars", 0, 10000, "$")]);
    expect(detail(payload, "dollars")).toEqual({
      normalised_value: 0, raw_value: 10000, unit: "$", display_value: "$10k",
    });
  });

  it("does not borrow the factor's conversion or baseline display across conflicting units", () => {
    const payload = project([option("dollars", 0.5, undefined, "$")], {
      scale_frame: 200000,
      observed_state: { value: 0.5, raw_value: 100000, unit: "£", source: "cee_inference" },
      display_value: "£100k",
    });
    expect(detail(payload, "dollars")).toEqual({ normalised_value: 0.5, unit: "$", display_value: "0.5" });
  });
});

describe("percentage record conventions remain separate from native display units", () => {
  it("preserves the captured fraction-record display rather than changing 18% into 0.18%", () => {
    const payload = project([option("fraction", 0.18, 0.18, "%")], {
      observed_state: { value: 0.12, unit: "%", source: "cee_inference" },
      display_value: "12%",
    });
    expect(detail(payload, "fraction")).toEqual({ normalised_value: 0.18, unit: "%", display_value: "18%" });
    expect(payload.options[0]!.raw_interventions?.[FACTOR]).toBe(0.18);
  });

  it.each([0.18, 18])("retains the proven percentage display for raw record %s", (recordRaw) => {
    const payload = project([option("percent", 0.18, recordRaw, "%")], {
      observed_state: { value: 0.12, raw_value: 12, unit: "%", source: "cee_inference" },
      display_value: "12%",
    });
    expect(detail(payload, "percent")).toEqual({ normalised_value: 0.18, raw_value: 18, unit: "%", display_value: "18%" });
    expect(payload.options[0]!.raw_interventions?.[FACTOR]).toBe(recordRaw);
  });
});

describe("the actual records producer reaches the same quantity boundary", () => {
  function fromRecords(unit: string, amounts: readonly number[], declared: boolean) {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Improve sustainable growth" },
        ...amounts.map((_, index) => ({ kind: "option" as const, source_quote: `Strategy ${index + 1}` })),
      ],
      claims: [
        { claim_kind: "factor", label: "The option's measured quantity", value: 0, unit,
          ...(declared ? { value_scale: "raw_count" as const } : {}) },
        ...amounts.map((amount, index) => ({
          claim_kind: "causal_link" as const,
          label: `Strategy ${index + 1} changes the quantity`,
          from_stated: index + 1,
          to_claim: 0,
          effect: "negative" as const,
          sets_to: amount,
        })),
        { claim_kind: "causal_link", label: "The quantity affects growth", from_claim: 0,
          to_stated: 0, effect: "negative" },
      ],
    };
    const projected = projectRecordsToGraph(records);
    const v3 = projectGraphAndOptionsToV3(projected.graph as Parameters<typeof projectGraphAndOptionsToV3>[0]);
    const factors = v3.graph.nodes.filter((node) => node.kind === "factor");
    expect(factors).toHaveLength(1);
    const factorId = factors[0]!.id;
    const payload = buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph);
    return { projected, v3, factorId, payload };
  }

  it("preserves native money through records, calculation framing, V3 extraction and details", () => {
    const amounts = [140000, 40000, 10000, 0];
    const { projected, v3, factorId, payload } = fromRecords("£", amounts, true);
    expect(v3.graph.nodes.find((node) => node.id === factorId)).toMatchObject({
      scale_frame: 200000, observed_state: { value: 0, raw_value: 0, unit: "£" },
    });
    expect(payload.options).toHaveLength(amounts.length);
    for (const [index, raw] of amounts.entries()) {
      const sourceOption = projected.graph.nodes.find((node) => node.kind === "option" && node.label === `Strategy ${index + 1}`);
      expect(sourceOption).toBeDefined();
      const canonical = v3.options.find((candidate) => candidate.id === sourceOption!.id)!;
      expect(canonical.interventions[factorId]).toMatchObject({ value: raw / 200000, raw_value: raw });
      const output = payload.options.find((candidate) => candidate.id === sourceOption!.id)!;
      expect(output.intervention_details?.[factorId]).toMatchObject({
        raw_value: raw, normalised_value: raw / 200000, unit: "£",
      });
      expect(output.intervention_details?.[factorId]?.display_value).toBe(["£140k", "£40k", "£10k", "£0"][index]);
    }
  });

  it("retains the real producer's undeclared percentage convention as a bounded compatibility control", () => {
    const { v3, factorId, payload } = fromRecords("%", [0.18], false);
    // This pre-conversion raw is a fraction; claiming every raw is already a
    // display percentage would silently turn the same option into 0.18%.
    expect(v3.options[0]!.interventions[factorId]).toMatchObject({ value: 0.18, raw_value: 0.18 });
    expect(payload.options[0]!.intervention_details?.[factorId]).toEqual({
      normalised_value: 0.18, unit: "%", display_value: "18%",
    });
    expect(payload.options[0]!.raw_interventions?.[factorId]).toBe(0.18);
  });
});
