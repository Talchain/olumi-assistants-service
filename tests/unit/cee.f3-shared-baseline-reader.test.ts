import { describe, it, expect } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { readIsBaseline } from "../../src/cee/baseline-identity.js";

/**
 * ROADMAP 2.55 / Codex Finding 3 (F3): split-field is_baseline flag
 * (node.is_baseline:true, data.is_baseline:false) must resolve to
 * is_baseline=true on the DISPLAY (graph nodes) and ANALYSIS-READY paths,
 * matching the #456 auto-baseline-dedup readIsBaseline truth table
 * (explicit true on EITHER surface wins).
 *
 * Before the fix, schema-v3.ts did `dataBaseline ?? nodeBaseline`, so
 * data:false MASKED node:true and the option was mis-resolved to
 * is_baseline=false — the UI then rendered wrong "current arrangement /
 * no changes" semantics.
 */

// Build a V1 response with a split-flag status-quo option whose LABEL does
// NOT match any baseline keyword, so the resolution is driven purely by the
// is_baseline flag surfaces (isolating the exact defect, not the label
// heuristic fallback).
function buildV1Response(opts: {
  alphaNodeBaseline?: boolean;
  alphaDataBaseline?: boolean;
  alphaLabel?: string;
}): V1DraftGraphResponse {
  const alphaNode: any = {
    id: "option_alpha",
    kind: "option",
    label: opts.alphaLabel ?? "Alpha Plan",
    body: "Alpha plan interventions",
    data: { interventions: { factor_price: 0.5 } },
  };
  if (opts.alphaDataBaseline !== undefined) {
    alphaNode.data.is_baseline = opts.alphaDataBaseline;
  }
  if (opts.alphaNodeBaseline !== undefined) {
    alphaNode.is_baseline = opts.alphaNodeBaseline;
  }

  return {
    graph: {
      version: "1",
      nodes: [
        { id: "goal_revenue", kind: "goal", label: "Maximize Annual Revenue" },
        { id: "factor_price", kind: "factor", label: "Product Price", data: { value: 49, unit: "GBP" } },
        alphaNode,
        {
          id: "option_beta",
          kind: "option",
          label: "Beta Plan",
          body: "Beta plan interventions",
          data: { interventions: { factor_price: 0.9 } },
        },
        { id: "outcome_growth", kind: "outcome", label: "Business Growth" },
      ],
      edges: [
        { from: "factor_price", to: "outcome_growth", weight: 0.8, belief: 0.9, effect_direction: "positive" },
        { from: "outcome_growth", to: "goal_revenue", weight: 1.0, belief: 1.0, effect_direction: "positive" },
        { from: "option_alpha", to: "factor_price", weight: 0.7, belief: 0.8 },
        { from: "option_beta", to: "factor_price", weight: 0.7, belief: 0.8 },
      ],
      meta: { roots: ["option_alpha", "option_beta"], leaves: ["goal_revenue"], source: "assistant" },
    } as any,
    quality: { overall: 8, structure: 9, coverage: 8, structural_proxy: 8 },
    trace: { request_id: "f3-test", correlation_id: "f3-corr" },
  } as V1DraftGraphResponse;
}

describe("F3: shared effective-baseline reader (split-field flag)", () => {
  describe("readIsBaseline truth table (single source of truth)", () => {
    const T = true, F = false;
    const cases: Array<[boolean | undefined, boolean | undefined, boolean | undefined]> = [
      // [data, node, expected]
      [T, T, T],
      [T, F, T],
      [T, undefined, T],
      [F, T, T], // *** the split-field cell — explicit node:true wins over data:false ***
      [F, F, F],
      [F, undefined, F],
      [undefined, T, T],
      [undefined, F, F],
      [undefined, undefined, undefined],
    ];
    for (const [data, node, expected] of cases) {
      it(`data=${String(data)} node=${String(node)} -> ${String(expected)}`, () => {
        expect(readIsBaseline({ is_baseline: node, data: { is_baseline: data } })).toBe(expected);
      });
    }
  });

  it("RED: split-field option (node:true, data:false) resolves is_baseline=true on graph nodes AND analysis-ready", () => {
    const v1 = buildV1Response({ alphaNodeBaseline: true, alphaDataBaseline: false });
    const v3 = transformResponseToV3(v1, { brief: "pricing", requestId: "f3-test" });

    // Display path: the option node in nodes[] must carry is_baseline=true.
    const alphaNode = v3.nodes.find((n) => n.kind === "option" && n.id === "option_alpha");
    expect(alphaNode).toBeDefined();
    expect((alphaNode as any).is_baseline).toBe(true);

    // Top-level options[] (canonical intervention source) must agree.
    const alphaOption = v3.options.find((o) => o.id === "option_alpha");
    expect(alphaOption).toBeDefined();
    expect(alphaOption!.is_baseline).toBe(true);

    // Analysis-ready path: the matching option must be marked baseline.
    const arAlpha = v3.analysis_ready.options.find((o) => o.id === "option_alpha");
    expect(arAlpha).toBeDefined();
    expect(arAlpha!.is_baseline).toBe(true);
    // And the sibling explicit non-baseline option must NOT be baseline.
    const arBeta = v3.analysis_ready.options.find((o) => o.id === "option_beta");
    expect(arBeta?.is_baseline).not.toBe(true);
  });

  it("GREEN-PIN: explicit-false-on-both stays non-baseline (never deletion/baseline eligible)", () => {
    const v1 = buildV1Response({ alphaNodeBaseline: false, alphaDataBaseline: false });
    const v3 = transformResponseToV3(v1, { brief: "pricing", requestId: "f3-test" });

    const alphaNode = v3.nodes.find((n) => n.kind === "option" && n.id === "option_alpha");
    expect((alphaNode as any).is_baseline).not.toBe(true);
    const arAlpha = v3.analysis_ready.options.find((o) => o.id === "option_alpha");
    expect(arAlpha?.is_baseline).not.toBe(true);
  });

  it("GREEN-PIN: absent-flag label heuristic unchanged (label 'Status Quo' still detected)", () => {
    // No flags on either surface, but the label matches a baseline keyword.
    const v1 = buildV1Response({ alphaLabel: "Status Quo" });
    const v3 = transformResponseToV3(v1, { brief: "pricing", requestId: "f3-test" });

    const arAlpha = v3.analysis_ready.options.find((o) => o.id === "option_alpha");
    expect(arAlpha?.is_baseline).toBe(true);
  });
});
