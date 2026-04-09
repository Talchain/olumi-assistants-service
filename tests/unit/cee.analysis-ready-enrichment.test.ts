/**
 * Unit tests for analysis-ready enrichment additions:
 * - is_baseline detection (CEE-2, Task 3)
 * - intervention_details construction including CEE-6 echo stripping (CEE-9, Task 4)
 */

import { describe, it, expect } from "vitest";
import { buildAnalysisReadyPayload } from "../../src/cee/transforms/analysis-ready.js";
import type { OptionV3T, GraphV3T, NodeV3T } from "../../src/schemas/cee-v3.js";

// ============================================================================
// Helpers
// ============================================================================

/** Minimal V3 option with empty interventions */
function makeOption(id: string, label: string, extra?: Record<string, unknown>): OptionV3T {
  return {
    id,
    label,
    status: "ready",
    interventions: {},
    ...extra,
  } as unknown as OptionV3T;
}

/** Minimal V3 graph with a goal node */
function makeGraph(extraNodes: NodeV3T[] = []): GraphV3T {
  return {
    nodes: [
      {
        id: "goal_1",
        kind: "goal",
        label: "Grow revenue",
      },
      ...extraNodes,
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** Build a minimal option with one intervention pointing to a factor */
function makeOptionWithIntervention(
  id: string,
  label: string,
  factorId: string,
  value: number,
): OptionV3T {
  return {
    id,
    label,
    status: "ready",
    interventions: {
      [factorId]: {
        value,
        source: "brief_extraction",
        target_match: { node_id: factorId, match_type: "exact_id", confidence: "high" },
      },
    },
  } as unknown as OptionV3T;
}

/** Minimal factor node */
function makeFactorNode(id: string, label: string, extra?: Partial<NodeV3T>): NodeV3T {
  return {
    id,
    kind: "factor",
    label,
    ...extra,
  } as NodeV3T;
}

// ============================================================================
// is_baseline — spec golden fixtures
// ============================================================================

describe("is_baseline detection", () => {
  it("marks 'Do nothing' option as baseline", () => {
    const options = [
      makeOption("opt_hire", "Hire full-time developer"),
      makeOption("opt_contract", "Use contractors"),
      makeOption("opt_nothing", "Do nothing"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[2] as Record<string, unknown>).is_baseline).toBe(true);
    expect((payload.options[0] as Record<string, unknown>).is_baseline).toBeUndefined();
    expect((payload.options[1] as Record<string, unknown>).is_baseline).toBeUndefined();
  });

  it("matches 'current' keyword", () => {
    const options = [
      makeOption("opt_a", "Expand to Europe"),
      makeOption("opt_b", "Focus on UK"),
      makeOption("opt_c", "Maintain current strategy"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[2] as Record<string, unknown>).is_baseline).toBe(true);
  });

  it("does not mark any option when no keyword matches", () => {
    const options = [
      makeOption("opt_a", "Option A"),
      makeOption("opt_b", "Option B"),
      makeOption("opt_c", "Option C"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    for (const opt of payload.options) {
      expect((opt as Record<string, unknown>).is_baseline).toBeUndefined();
    }
  });

  it("marks 'status quo' option as baseline", () => {
    const options = [
      makeOption("opt_new", "New CRM Platform"),
      makeOption("opt_sq", "Status quo"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[1] as Record<string, unknown>).is_baseline).toBe(true);
  });

  it("prefers LLM-provided is_baseline flag over keyword", () => {
    const options = [
      makeOption("opt_a", "Do nothing", { is_baseline: true }),
      makeOption("opt_b", "Current approach"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[0] as Record<string, unknown>).is_baseline).toBe(true);
    // Second option keyword matched but LLM flag on first wins
    expect((payload.options[1] as Record<string, unknown>).is_baseline).toBeUndefined();
  });

  it("first match wins when multiple labels match keyword", () => {
    const options = [
      makeOption("opt_a", "Keep existing"),
      makeOption("opt_b", "Maintain current setup"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[0] as Record<string, unknown>).is_baseline).toBe(true);
    expect((payload.options[1] as Record<string, unknown>).is_baseline).toBeUndefined();
  });

  it("matches 'baseline' keyword", () => {
    const options = [
      makeOption("opt_a", "Scale up marketing"),
      makeOption("opt_b", "Baseline scenario"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[1] as Record<string, unknown>).is_baseline).toBe(true);
  });

  it("is case-insensitive", () => {
    const options = [
      makeOption("opt_a", "DO NOTHING"),
      makeOption("opt_b", "Something else"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    expect((payload.options[0] as Record<string, unknown>).is_baseline).toBe(true);
  });

  it("does not match partial word (e.g. 'currently' does not trigger 'current')", () => {
    const options = [
      makeOption("opt_a", "Currently in progress"),
      makeOption("opt_b", "Something else"),
    ];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    // "currently" contains "current" so the boundary check should handle this
    // The regex uses word boundary so "currently" should NOT match "current"
    for (const opt of payload.options) {
      expect((opt as Record<string, unknown>).is_baseline).toBeUndefined();
    }
  });
});

// ============================================================================
// intervention_details — spec golden fixtures
// ============================================================================

describe("intervention_details construction", () => {
  it("builds display_value from factor raw_value + unit", () => {
    const factorNode = makeFactorNode("fac_dev_headcount", "Developer Headcount", {
      observed_state: {
        value: 0.5,
        raw_value: 5,
        unit: "people",
        source: "brief_extraction",
      },
    });
    const options = [makeOptionWithIntervention("opt_a", "Hire team", "fac_dev_headcount", 0.5)];
    const graph = makeGraph([factorNode]);

    const payload = buildAnalysisReadyPayload(options, "goal_1", graph);
    const details = (payload.options[0] as Record<string, unknown>).intervention_details as Record<
      string,
      { display_value: string; normalised_value: number; raw_value?: number; unit?: string }
    >;

    expect(details).toBeDefined();
    expect(details["fac_dev_headcount"]).toBeDefined();
    expect(details["fac_dev_headcount"].display_value).toBe("5 people");
    expect(details["fac_dev_headcount"].normalised_value).toBe(0.5);
    expect(details["fac_dev_headcount"].raw_value).toBe(5);
    expect(details["fac_dev_headcount"].unit).toBe("people");
  });

  it("CEE-6: strips echo when display_value matches factor label", () => {
    // Factor with display_value that would echo its label
    const factorNode = makeFactorNode("fac_marketing", "Marketing Expertise", {
      display_value: "Marketing Expertise",
      observed_state: { value: 0.15, source: "brief_extraction" },
    });
    const options = [makeOptionWithIntervention("opt_a", "Boost marketing", "fac_marketing", 0.7)];
    const graph = makeGraph([factorNode]);

    const payload = buildAnalysisReadyPayload(options, "goal_1", graph);
    const details = (payload.options[0] as Record<string, unknown>).intervention_details as Record<
      string,
      { display_value: string; normalised_value: number }
    >;

    expect(details["fac_marketing"].display_value).not.toBe("Marketing Expertise");
    // Should be numeric/qualitative instead
    expect(details["fac_marketing"].normalised_value).toBe(0.7);
  });

  it("uses LLM display_value from factor when not an echo", () => {
    const factorNode = makeFactorNode("fac_dev_cost", "Development Cost", {
      display_value: "£200k",
      observed_state: {
        value: 0.4,
        raw_value: 200000,
        unit: "£",
        source: "brief_extraction",
      },
    });
    const options = [makeOptionWithIntervention("opt_a", "Outsource", "fac_dev_cost", 0.4)];
    const graph = makeGraph([factorNode]);

    const payload = buildAnalysisReadyPayload(options, "goal_1", graph);
    const details = (payload.options[0] as Record<string, unknown>).intervention_details as Record<
      string,
      { display_value: string }
    >;

    expect(details["fac_dev_cost"].display_value).toBe("£200k");
  });

  it("falls back to qualitative band when no factor metadata", () => {
    // Option references a factor that is not in the graph
    const options = [makeOptionWithIntervention("opt_a", "Some option", "fac_unknown", 0.7)];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());

    const details = (payload.options[0] as Record<string, unknown>).intervention_details as Record<
      string,
      { display_value: string }
    >;

    // Without factor metadata, should still produce something reasonable
    expect(details["fac_unknown"]).toBeDefined();
    expect(details["fac_unknown"].display_value).toBeTruthy();
  });

  it("omits intervention_details when no interventions", () => {
    const options = [makeOption("opt_empty", "Empty option")];
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph());
    const details = (payload.options[0] as Record<string, unknown>).intervention_details;
    // No interventions → no details object
    expect(details).toBeUndefined();
  });

  it("preserves existing interventions field unchanged", () => {
    const factorNode = makeFactorNode("fac_price", "Pricing", {
      observed_state: { value: 0.6, raw_value: 59, unit: "£", source: "brief_extraction" },
    });
    const options = [makeOptionWithIntervention("opt_a", "Premium pricing", "fac_price", 0.6)];
    const graph = makeGraph([factorNode]);

    const payload = buildAnalysisReadyPayload(options, "goal_1", graph);

    // Original interventions field must be unchanged
    expect(payload.options[0].interventions["fac_price"]).toBe(0.6);
  });
});
