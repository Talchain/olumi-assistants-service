/**
 * Science's conditions on crediting option levels (RT-4 class A, #87 5999083694).
 *
 *  · W2 — a limit the user stated is never anchored to an option's level. Option
 *    candidates are collected before limit candidates, and `matchCandidate` takes
 *    the first match.
 *  · W3 — a figure that matches levels on two different factors names neither.
 *    The same factor set by several options is fine.
 *  · OWN SPAN (DL ruling on #2603, the Review Desk's ask; #2601's rule for an
 *    unquoted edge) — a level binds to the ONE brief literal with its value and
 *    unit. A same value and unit written about another quantity is never credited.
 *
 * Each guard row is paired with the control it must not cross.
 */

import { describe, expect, it } from "vitest";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

const level = (factorId: string, rawValue: number, unit: string) => ({
  value: 0.5,
  raw_value: rawValue,
  unit,
  source: "brief_extraction",
  target_match: { node_id: factorId, match_type: "exact_id", confidence: "high" },
});

const factor = (id: string, label: string) => ({ id, kind: "factor", label });

const itemsAt = (brief: string, graph: Record<string, unknown>) => {
  const items = deriveNotModelledManifest(brief, graph).quantities?.items ?? [];
  return (literal: string, nth: number) => {
    const at = brief.split(literal, nth + 1).join(literal).length;
    const item = items.find((i) => i.literal === literal && i.char_offset === at);
    expect(item, `the manifest must report ${literal}@${at}`).toBeDefined();
    return item!;
  };
};

describe("W2 — a stated limit is never anchored to an option's level", () => {
  // The ONE £120k in the brief is the limit, and the option level holds the same figure, so own-span binding
  // alone would bind the level to it: only W2 keeps the user's limit off the option's factor.
  const LIMIT_QUOTE = "Annual support spend must stay within £120k";
  const brief = `${LIMIT_QUOTE}. The AI triage tool would use the whole of it each year.`;
  const nodes = [
    factor("fac_support_spend", "Annual support spend"),
    factor("fac_tool_cost", "AI triage tool cost"),
    { id: "opt_buy_tool", kind: "option", label: "Buy the AI triage tool", interventions: { fac_tool_cost: level("fac_tool_cost", 120_000, "£") } },
  ];
  const limitRow = { node_id: "fac_support_spend", operator: "<=", value: 120_000, unit: "£", source_quote: LIMIT_QUOTE };

  it("the limit's £120k anchors to the limit's node, not the option's factor", () => {
    const item = itemsAt(brief, { nodes, goal_constraints: [limitRow] })("£120k", 0);
    expect(item.stated_kind).toBe("constraint");
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_support_spend");
  });

  it("a limit row holding the magnitude AS WRITTEN (120, \"£\") matches no limit carrier: only W2 keeps it off the option's factor", () => {
    // `classifyStatedKind` reads the span's value as written or expanded; `collectLimitCandidates` does not, so here no
    // other carrier claims the figure and the fallback route is open. W2 is what keeps the user's limit off the option.
    const item = itemsAt(brief, { nodes, goal_constraints: [{ ...limitRow, value: 120 }] })("£120k", 0);
    expect(item.stated_kind).toBe("constraint");
    expect(item.matched_node_id).not.toBe("fac_tool_cost");
  });

  it("CONTROL: with no limit stated, the same £120k is the option's level and is credited to its factor", () => {
    const item = itemsAt(brief, { nodes })("£120k", 0);
    expect(item.stated_kind).toBe("figure");
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_tool_cost");
  });
});

describe("FALLBACK ONLY — an option level never moves a figure another carrier already matches (Codex r2 (b))", () => {
  it("a served limit row with NO source_quote keeps its £120k on the limit's node", () => {
    const brief = "Annual support spend must stay within £120k. The AI triage tool would use the whole of it each year.";
    const item = itemsAt(brief, {
      nodes: [
        factor("fac_support_spend", "Annual support spend"),
        factor("fac_tool_cost", "AI triage tool cost"),
        { id: "opt_buy_tool", kind: "option", label: "Buy the AI triage tool", interventions: { fac_tool_cost: level("fac_tool_cost", 120_000, "£") } },
      ],
      // The constructor's real row: no source_quote, so no constraint span and W2 cannot classify the literal.
      goal_constraints: [{ node_id: "fac_support_spend", operator: "<=", value: 120_000, unit: "£" }],
    })("£120k", 0);
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_support_spend");
  });
});

describe("W3 — a figure matching levels on two different factors names neither", () => {
  it("10% set on price AND on staff hours is credited to neither", () => {
    // ONE written 10%, so both levels bind to it by own span: only W3 stops it naming one factor.
    const brief = "Either plan moves its lever by 10%: cut prices, or cut staff hours.";
    const at = itemsAt(brief, {
      nodes: [
        factor("fac_price_change", "Price change"),
        factor("fac_staff_hours", "Staff hours change"),
        { id: "opt_cut_prices", kind: "option", label: "Cut prices", interventions: { fac_price_change: level("fac_price_change", 10, "%") } },
        { id: "opt_cut_hours", kind: "option", label: "Cut staff hours", interventions: { fac_staff_hours: level("fac_staff_hours", 10, "%") } },
      ],
    });
    const item = at("10%", 0);
    expect(item.verdict).not.toBe("in_model");
    expect(item.matched_node_id).toBeNull();
  });

  it("CONTROL: two options setting the SAME factor to the one stated 8% are one claim, and it is credited", () => {
    const brief = "Both plans raise prices by 8%: one on its own, one with a loyalty card.";
    const item = itemsAt(brief, {
      nodes: [
        factor("fac_price_change", "Price change"),
        { id: "opt_raise", kind: "option", label: "Raise prices", interventions: { fac_price_change: level("fac_price_change", 8, "%") } },
        { id: "opt_raise_card", kind: "option", label: "Raise prices with a loyalty card", interventions: { fac_price_change: level("fac_price_change", 8, "%") } },
      ],
    })("8%", 0);
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_price_change");
  });
});

describe("OWN SPAN — a level is credited only to the one literal that states it", () => {
  const graph = {
    nodes: [
      factor("fac_price_change", "Price change"),
      { id: "opt_raise", kind: "option", label: "Raise prices", interventions: { fac_price_change: level("fac_price_change", 8, "%") } },
    ],
  };

  it("\"churn is 8%\" is about another quantity: the price level is credited to NEITHER 8%", () => {
    const at = itemsAt("We could raise prices by 8%. Churn is 8% today.", graph);
    for (const nth of [0, 1]) {
      const item = at("8%", nth);
      expect(item.verdict).not.toBe("in_model");
      expect(item.matched_node_id).toBeNull();
    }
  });

  it("CONTROL: the same level with the 8% stated once is credited to it", () => {
    const item = itemsAt("We could raise prices by 8%. Churn is 6% today.", graph)("8%", 0);
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_price_change");
  });
});
