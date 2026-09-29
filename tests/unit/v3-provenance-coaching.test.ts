/**
 * V3 boundary contract tests for the new UI-facing fields:
 *   - node.provenance       (from extractionType)
 *   - edge.provenance_display (from provenance.source)
 *   - coaching.widening_log + coaching.bias_signals (passthrough survival)
 *
 * Covers the brief's "test the coaching field survives Stage 6 with the NEW
 * subfields" correction — passthrough alone is not assumed to cover them.
 */

import { describe, it, expect, vi } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";

// Suppress noisy logs.
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      debugCategoryTrace: false,
      debugLoggingEnabled: false,
    },
  },
  isProduction: () => false,
}));

function baseV1(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 1,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Pricing decision" },
        {
          id: "opt_raise",
          kind: "option",
          label: "Raise price",
          data: { interventions: { fac_price: 0.83 } },
        },
        {
          id: "opt_keep",
          kind: "option",
          label: "Keep price",
          data: { interventions: { fac_price: 0.69 } },
        },
        // explicit extraction → from_brief
        {
          id: "fac_price",
          kind: "factor",
          label: "Price level",
          category: "controllable",
          data: { value: 0.69, raw_value: 49, unit: "£", extractionType: "explicit" },
        },
        // observed extraction → from_brief
        {
          id: "fac_quality",
          kind: "factor",
          label: "Product quality",
          category: "observable",
          data: { value: 0.7, extractionType: "observed" },
        },
        // inferred extraction → ai_inferred
        {
          id: "fac_competition",
          kind: "factor",
          label: "Competitive intensity",
          category: "external",
          data: { value: 0.5, extractionType: "inferred" },
        },
        // absent extractionType → ai_inferred (default)
        {
          id: "out_revenue",
          kind: "outcome",
          label: "Revenue growth",
        },
        {
          id: "goal_mrr",
          kind: "goal",
          label: "Maximise MRR",
        },
      ],
      edges: [
        // structural
        { from: "dec_1", to: "opt_raise", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "dec_1", to: "opt_keep", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_raise", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_keep", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        // brief_extraction → from_brief
        {
          from: "fac_price",
          to: "out_revenue",
          strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9,
          effect_direction: "positive" as const,
          provenance_source: "brief_extraction",
        },
        // user_specified → user_set
        {
          from: "fac_quality",
          to: "out_revenue",
          strength_mean: 0.4, strength_std: 0.2, belief_exists: 0.8,
          effect_direction: "positive" as const,
          provenance_source: "user_specified",
        },
        // cee_hypothesis (mapped from "hypothesis") → ai_inferred
        {
          from: "fac_competition",
          to: "out_revenue",
          strength_mean: -0.3, strength_std: 0.2, belief_exists: 0.7,
          effect_direction: "negative" as const,
          provenance_source: "hypothesis",
        },
        // absent provenance → ai_inferred
        {
          from: "out_revenue",
          to: "goal_mrr",
          strength_mean: 0.9, strength_std: 0.05, belief_exists: 1,
          effect_direction: "positive" as const,
        },
      ],
      meta: { roots: [], leaves: [], source: "assistant" },
    },
    coaching: {
      summary: "Solid scaffold; consider broadening competitor scope.",
      strengthen_items: [
        {
          id: "si_1",
          label: "Add a churn driver",
          detail: "You are missing churn elasticity.",
          action_type: "add_node",
        },
      ],
      // The two fields under test — must survive Stage 6 boundary parse.
      // v0.11.0 schema amendment: widening_log is the canonical OBJECT shape.
      widening_log: {
        elements_added: ["fac_competition"],
        elements_considered_but_excluded: ["considered alternative competitors"],
        brief_completeness: "partial",
      },
      bias_signals: [
        { type: "anchoring", detail: "pinned to last quarter's price", target: "fac_price" },
      ],
    },
    quality: { overall: 7 },
    trace: { request_id: "v3-prov-coaching" },
  };
}

describe("V3 boundary: node provenance display", () => {
  it("maps explicit extractionType to from_brief", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "n-explicit" });
    const node = (v3 as any).nodes.find((n: any) => n.id === "fac_price");
    expect(node.provenance).toBe("from_brief");
  });

  it("maps observed extractionType to from_brief", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "n-observed" });
    const node = (v3 as any).nodes.find((n: any) => n.id === "fac_quality");
    expect(node.provenance).toBe("from_brief");
  });

  it("maps inferred extractionType to ai_inferred", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "n-inferred" });
    const node = (v3 as any).nodes.find((n: any) => n.id === "fac_competition");
    expect(node.provenance).toBe("ai_inferred");
  });

  it("falls back to ai_inferred for absent extractionType", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "n-absent" });
    const node = (v3 as any).nodes.find((n: any) => n.id === "out_revenue");
    expect(node.provenance).toBe("ai_inferred");
  });

  it("populates provenance on every node", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "n-all" });
    for (const node of (v3 as any).nodes) {
      expect(node.provenance).toBeDefined();
      expect(["from_brief", "ai_inferred", "user_set"]).toContain(node.provenance);
    }
  });
});

describe("V3 boundary: edge provenance_display", () => {
  it("maps brief_extraction to from_brief", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-brief" });
    const edge = (v3 as any).edges.find((e: any) => e.from === "fac_price" && e.to === "out_revenue");
    expect(edge.provenance_display).toBe("from_brief");
  });

  it("maps user_specified to user_set", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-user" });
    const edge = (v3 as any).edges.find((e: any) => e.from === "fac_quality" && e.to === "out_revenue");
    expect(edge.provenance_display).toBe("user_set");
  });

  it("maps cee_hypothesis to ai_inferred", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-hyp" });
    const edge = (v3 as any).edges.find((e: any) => e.from === "fac_competition" && e.to === "out_revenue");
    expect(edge.provenance_display).toBe("ai_inferred");
  });

  it("falls back to ai_inferred when provenance is absent", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-absent" });
    const edge = (v3 as any).edges.find((e: any) => e.from === "out_revenue" && e.to === "goal_mrr");
    expect(edge.provenance_display).toBe("ai_inferred");
  });

  it("preserves the structural provenance.source enum unchanged", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-coexist" });
    const edge = (v3 as any).edges.find((e: any) => e.from === "fac_price" && e.to === "out_revenue");
    // Structured provenance still present (sibling) — V3 consumers reading
    // .provenance.source must keep working.
    expect(edge.provenance?.source).toBe("brief_extraction");
    expect(edge.provenance_display).toBe("from_brief");
  });

  it("populates provenance_display on every edge", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "e-all" });
    for (const edge of (v3 as any).edges) {
      expect(edge.provenance_display).toBeDefined();
      expect(["from_brief", "ai_inferred", "user_set"]).toContain(edge.provenance_display);
    }
  });
});

describe("V3 boundary: response-only provenance overwrite (round-trip safety)", () => {
  // Stale `provenance` / `provenance_display` may arrive on inbound graphs
  // when a previous CEE response is re-submitted (e.g. during retries or
  // patch flows). The contract is RESPONSE-ONLY: the V3 transform must
  // recompute these fields from `extractionType` (nodes) and
  // `provenance.source` (edges) every time, ignoring whatever inbound
  // value the caller supplied. These tests are the regression guard.

  function baseV1WithStaleDisplayFields(): V1DraftGraphResponse {
    const v1 = baseV1();
    // Inject deliberately-wrong UI display values onto the inbound nodes
    // and edges. The V1 schema is permissive (passthrough) so these stick
    // through structural parse — the question is whether the V3 transform
    // recomputes them or trusts the input.
    for (const node of v1.graph.nodes) {
      (node as any).provenance = "user_set"; // wrong: every node should be from_brief / ai_inferred
    }
    for (const edge of v1.graph.edges) {
      (edge as any).provenance_display = "user_set"; // wrong: only user_specified edges should be user_set
    }
    return v1;
  }

  it("ignores stale node.provenance on the inbound graph and recomputes from extractionType", () => {
    const v3 = transformResponseToV3(baseV1WithStaleDisplayFields(), { requestId: "rt-node" });

    // explicit extraction → recomputed to from_brief, NOT preserved as user_set
    const priceNode = (v3 as any).nodes.find((n: any) => n.id === "fac_price");
    expect(priceNode.provenance).toBe("from_brief");

    // inferred extraction → recomputed to ai_inferred
    const competitionNode = (v3 as any).nodes.find((n: any) => n.id === "fac_competition");
    expect(competitionNode.provenance).toBe("ai_inferred");

    // No node should retain the stale "user_set" stamping.
    const userSetNodes = (v3 as any).nodes.filter((n: any) => n.provenance === "user_set");
    expect(userSetNodes).toHaveLength(0);
  });

  it("ignores stale edge.provenance_display on the inbound graph and recomputes from provenance.source", () => {
    const v3 = transformResponseToV3(baseV1WithStaleDisplayFields(), { requestId: "rt-edge" });

    // brief_extraction source → recomputed to from_brief
    const briefEdge = (v3 as any).edges.find((e: any) => e.from === "fac_price" && e.to === "out_revenue");
    expect(briefEdge.provenance_display).toBe("from_brief");

    // user_specified source → user_set is correct (and matches the stale
    // value by coincidence here — the next assertion below catches the
    // case where stale != recomputed).
    const userEdge = (v3 as any).edges.find((e: any) => e.from === "fac_quality" && e.to === "out_revenue");
    expect(userEdge.provenance_display).toBe("user_set");

    // No-provenance edge → recomputed to ai_inferred, NOT preserved as user_set.
    const absentEdge = (v3 as any).edges.find((e: any) => e.from === "out_revenue" && e.to === "goal_mrr");
    expect(absentEdge.provenance_display).toBe("ai_inferred");
  });
});

describe("V3 boundary: coaching widening_log + bias_signals survival", () => {
  it("preserves widening_log entries through CEEGraphResponseV3.safeParse", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "c-widening" });
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(`V3 parse failed: path=${first?.path.join(".")} ${first?.message}`);
    }
    expect((result.data.coaching as any)?.widening_log).toEqual({
      elements_added: ["fac_competition"],
      elements_considered_but_excluded: ["considered alternative competitors"],
      brief_completeness: "partial",
    });
  });

  it("preserves bias_signals entries through CEEGraphResponseV3.safeParse", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "c-bias" });
    const result = CEEGraphResponseV3.safeParse(v3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.coaching as any)?.bias_signals).toEqual([
        { type: "anchoring", detail: "pinned to last quarter's price", target: "fac_price" },
      ]);
    }
  });

  it("preserves coaching.summary and coaching.strengthen_items", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "c-base" });
    const result = CEEGraphResponseV3.safeParse(v3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coaching?.summary).toBe("Solid scaffold; consider broadening competitor scope.");
      expect(result.data.coaching?.strengthen_items).toHaveLength(1);
      expect(result.data.coaching?.strengthen_items[0]?.id).toBe("si_1");
    }
  });

  it("full V3 body validates against CEEGraphResponseV3 with new provenance fields and coaching", () => {
    const v3 = transformResponseToV3(baseV1(), { requestId: "c-full" });
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(`V3 parse failed: path=${first?.path.join(".")} ${first?.message}`);
    }
    expect(result.success).toBe(true);
  });
});
