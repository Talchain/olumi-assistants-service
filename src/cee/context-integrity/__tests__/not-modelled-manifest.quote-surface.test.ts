/**
 * THE PRODUCT QUOTED THE USER'S SENTENCE BACK AT THEM AND SCORED THAT AS
 * HAVING MODELLED THEIR NUMBER.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * Journey-witnessed on deployed CEE `4e88390` (2026-08-23), fresh isolated
 * guest. A brief stated two money figures of two different KINDS:
 *
 *   "A full switch costs £20,000 in migration and training."   <- one-off
 *   "our annual Salesforce licensing is £45,000"                <- recurring
 *
 * The compiler minted one money factor — a RECURRING licence cost — so the
 * one-off had no carrier and never became an intervention. `20000` occurs
 * ZERO times in the canonical model. The positive control is the other half of
 * the same brief: `45000` bound with `unit: "£"`, `source: "brief_extraction"`
 * and an explicit edge-to-stated-item binding. The binder works. One figure was
 * carried and the other was dropped.
 *
 * ── WHY THAT IS THIS MODULE'S PROBLEM ──────────────────────────────────────
 * This module owns exactly one semantic question — "which stated quantities
 * never reached the model?" — and it answers it by iterating the BRIEF's
 * quantities rather than the graph's factors, which is the correct quantifier
 * for the question. It is the canonical owner. It was answering WRONG.
 *
 * `NodeV3.source_quote` (`schemas/cee-v3.ts:229`) is documented at its producer
 * as the user's exact words carried through unchanged, and it is written onto
 * wire nodes at `transforms/schema-v3.ts:1145`. Nothing computes with it.
 *
 * `PROSE_KEYS` did not list it. `splitSurfaces` classifies by
 * `walkText(v, inProse || PROSE_KEYS.has(k))`, and absence from the deny-list
 * means MODEL surface. So the user's own sentence — carrying "£20,000" —
 * counted as model content, and the figure was reported `in_model`.
 *
 * The module's own header already named this direction of error out loud:
 * "A prose key MISSING from this list gets treated as model content, so a
 * quantity mentioned there is reported as `in_model` — we UNDER-report loss."
 * The reasoning was sound; `source_quote` was simply missing from the list.
 *
 * ── WHAT IS AND IS NOT CLAIMED ─────────────────────────────────────────────
 * This does NOT fix the drop. The one-off cost still has no carrier, and that
 * is a Model-Compiler question owned elsewhere. What it fixes is the product
 * TELLING THE USER IT KEPT A NUMBER IT DROPPED — a false "Confirmed" on the one
 * surface whose entire job is confirming what was kept.
 *
 * ⚠ SCOPE LIMIT, derived at the contract: `label_authored` is documented as
 * absent when "the label IS the user's own text" (`cee-v3.ts:231-236`). Where a
 * stated node's LABEL is itself the verbatim sentence carrying the figure, the
 * label is genuinely model surface and this repair does not reach it. Test 3
 * pins the fixture's quote route so this file cannot silently decay into
 * testing the label route instead.
 */

import { describe, it, expect } from "vitest";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

const BRIEF = [
  "We need to decide whether to move our whole sales team off Salesforce onto HubSpot this year.",
  "A full switch costs £20,000 in migration and training.",
  "Staying on Salesforce costs us nothing extra up front, and our annual Salesforce licensing is £45,000.",
].join(" ");

const FACTOR_ID = "fac_lic";
const OPTION_ID = "opt_switch";

/** The one-off figure survives ONLY as the verbatim echo of the user's sentence. */
const QUOTE = "A full switch costs £20,000 in migration and training.";

function graphWith(opts: { quote: boolean }): Record<string, unknown> {
  return {
    nodes: [
      {
        id: FACTOR_ID,
        kind: "factor",
        label: "Annual CRM Licensing Cost",
        observed_state: {
          value: 0.9,
          raw_value: 45000,
          unit: "£",
          source: "brief_extraction",
        },
      },
      {
        id: OPTION_ID,
        kind: "option",
        // Short label, deliberately NOT the user's sentence — so the quote
        // route is the only way the literal can reach a surface at all.
        label: "Full switch",
        ...(opts.quote ? { source_quote: QUOTE } : {}),
        interventions: {
          [FACTOR_ID]: {
            value: 0.9,
            raw_value: 45000,
            unit: "£",
            source: "brief_extraction",
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
    edges: [],
  };
}

/**
 * Bind by IDENTITY — the exact literal — never "the first absent item" and
 * never a value predicate another item could satisfy (trap 19).
 */
function itemFor(graph: Record<string, unknown>, literal: string) {
  const items = deriveNotModelledManifest(BRIEF, graph).quantities?.items ?? [];
  const found = items.filter((i) => i.literal === literal);
  expect(
    found.length,
    `expected exactly one manifest item for ${literal}; got ${found.length} of ${items.length} (${items.map((i) => i.literal).join(", ")})`,
  ).toBe(1);
  return found[0];
}

describe("not-modelled manifest — the user's own quoted words are not model surface", () => {
  it("a stated figure surviving only as the verbatim echo of the user's own sentence is prose_only, never in_model", () => {
    const item = itemFor(graphWith({ quote: true }), "£20,000");

    // Before the fix this read "in_model": the literal was found inside
    // `source_quote`, which `splitSurfaces` classified as model surface.
    expect(
      item.verdict,
      "the product reported it had modelled a figure that reached no factor, option or intervention — it had only quoted the user's sentence back at them",
    ).toBe("prose_only");
    expect(
      item.matched_node_id,
      "a prose-only figure must name no carrier",
    ).toBeNull();
  });

  it("TWIN: a figure a candidate actually carries stays in_model and keeps its matched node id, with the same sentence quoted on a node", () => {
    // Opposite direction. Identical before and after the fix — that identity is
    // the evidence. `classify` tries the numeric, unit-aware `matchCandidate`
    // BEFORE any text route, so a genuinely-carried figure is structurally
    // immune to a change in the text-surface split. This test is what proves
    // the fix cannot demote real carriage.
    const item = itemFor(graphWith({ quote: true }), "£45,000");

    expect(
      item.verdict,
      "the fix demoted a figure that a real intervention carries — it must only reclassify figures with no carrier",
    ).toBe("in_model");
    expect(item.matched_node_id).toBe(FACTOR_ID);
  });

  it("PRECONDITION: the fixture's quote surface is load-bearing — with source_quote removed the same figure is absent", () => {
    // Pins that the first test exercises the QUOTE route specifically. Without
    // this, a future refactor that stopped writing `source_quote` into the
    // fixture would leave test 1 passing for the wrong reason (trap 13b).
    const item = itemFor(graphWith({ quote: false }), "£20,000");

    expect(
      item.verdict,
      "with the quote removed the figure should reach no surface at all; if this is not `absent`, the fixture is carrying the literal somewhere else and test 1 proves nothing",
    ).toBe("absent");
  });

  it("BREADTH: the rule is unit-kind agnostic — a percent stated only in a node quote is also prose_only", () => {
    // Guards against the change being accidentally currency-scoped.
    const brief =
      "We think rep adoption would improve by 30% after the switch, but we have no reliable data yet.";
    const graph = {
      nodes: [
        {
          id: "fac_adopt",
          kind: "factor",
          label: "Rep Adoption Quality",
          source_quote: "rep adoption would improve by 30% after the switch",
          observed_state: { value: 0.5, source: "cee_inference" },
        },
      ],
      edges: [],
    };
    const items = deriveNotModelledManifest(brief, graph).quantities?.items ?? [];
    const item = items.find((i) => i.literal === "30%");
    expect(item, `no manifest item for 30% among [${items.map((i) => i.literal).join(", ")}]`).toBeDefined();
    expect(item!.verdict).toBe("prose_only");
  });
});
