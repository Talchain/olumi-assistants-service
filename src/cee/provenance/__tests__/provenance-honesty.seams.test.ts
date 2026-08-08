/**
 * ROADMAP 2.972 — THE PRODUCT MUST NOT ASSERT PROVENANCE IT DOES NOT HAVE.
 *
 * ⚠ EVERY EXPECTATION HERE IS ANCHORED TO A MEASURED BEHAVIOUR OF THE DEPLOYED
 * BUILD, not to a hypothesis. The context-integrity trace of 2026-08-08 drove
 * staging (CEE `4b57b8f`) with three real briefs and captured, at the wire:
 *
 *   (a) 47 of 47 option interventions stamped
 *       `source: "brief_extraction", value_confidence: "high"` while carrying
 *       model-chosen normalised lever levels (0.8, 0.75, 0.45, …) that appear
 *       NOWHERE in the user's words;
 *   (b) `fac_nrr` stamped `extractionType: "explicit", provenance: "from_brief"`
 *       with NO value at all — while `factor_value_coverage` in the SAME
 *       payload scored `explicit: 0`. Two subsystems, one response, one lie.
 *
 * The captures are the fixtures (`fixtures/trace-captures.ts`), so nothing in
 * this file is a shape the author invented (CLAUDE.md trap 16-inverse: a
 * fixture you wrote yourself is not evidence about the wire).
 *
 * BINDING IS BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19). Every
 * assertion names THE option, THE factor, THE node — `opt_germany_direct` →
 * `fac_marketing_spend`, `fac_nrr` — so a different object satisfying the same
 * shape cannot keep the suite green. The discriminating-mutant pair recorded
 * in the PR body strips the guard for ALL nodes (must RED) and for a DIFFERENT
 * node only (must stay GREEN).
 *
 * THE PROPERTY, stated once: a provenance claim must be DERIVABLE from what
 * the user actually supplied; where it cannot be established the honest output
 * is the WEAKER claim, never the stronger one. The value itself is never
 * dropped — only its unearned label.
 */

import { describe, it, expect } from "vitest";

import { extractOptionsFromNodes } from "../../extraction/intervention-extractor.js";
import { transformResponseToV3 } from "../../transforms/schema-v3.js";
import type { NodeV3T, EdgeV3T } from "../../../schemas/cee-v3.js";
import {
  BRIEF_TEXT_AS_PERSISTED,
  MEASURED_FACTOR_NODES,
  MEASURED_INTERVENTIONS,
} from "./fixtures/trace-captures.js";

// ---------------------------------------------------------------------------
// Reconstruct the seam inputs from the captures
// ---------------------------------------------------------------------------

/**
 * The factor nodes the extractor validates interventions against, rebuilt from
 * the captured graph. `unit` on an intervention is copied by the extractor
 * from `factor.observed_state.unit`, so the captured units are what make the
 * reconstruction faithful rather than decorative.
 */
function factorsFor(brief: "B1" | "B2" | "B3"): NodeV3T[] {
  return MEASURED_FACTOR_NODES.filter((f) => f.brief === brief).map((f) => {
    const node: Record<string, unknown> = { id: f.id, kind: "factor", label: f.label };
    if (f.category !== undefined) node.category = f.category;
    if (f.unit !== undefined || f.observedValue !== undefined) {
      node.observed_state = {
        ...(f.observedValue !== undefined ? { value: f.observedValue } : { value: 0 }),
        ...(f.unit !== undefined && { unit: f.unit }),
      };
    }
    return node as unknown as NodeV3T;
  });
}

/** The option-node inputs, rebuilt from the captured interventions. */
function optionInputsFor(brief: "B1" | "B2" | "B3") {
  const byOption = new Map<string, Record<string, number>>();
  for (const iv of MEASURED_INTERVENTIONS) {
    if (iv.brief !== brief) continue;
    const bag = byOption.get(iv.optionId) ?? {};
    bag[iv.factorId] = iv.value;
    byOption.set(iv.optionId, bag);
  }
  return [...byOption.entries()].map(([id, v4Interventions]) => ({
    id,
    label: id,
    v4Interventions,
  }));
}

function extractFor(brief: "B1" | "B2" | "B3", briefText: string | undefined) {
  return extractOptionsFromNodes(
    optionInputsFor(brief),
    factorsFor(brief),
    [] as EdgeV3T[],
    "goal",
    [],
    briefText,
  );
}

function interventionOf(options: ReturnType<typeof extractFor>, optionId: string, factorId: string) {
  const option = options.find((o) => o.id === optionId);
  if (!option) throw new Error(`fixture precondition failed: option ${optionId} absent`);
  const intervention = option.interventions?.[factorId];
  if (!intervention) {
    throw new Error(`fixture precondition failed: intervention ${optionId}→${factorId} absent`);
  }
  return intervention;
}

// ---------------------------------------------------------------------------
// (a) Intervention values
// ---------------------------------------------------------------------------

describe("2.972(a) an intervention value may not claim brief extraction unless the brief states it", () => {
  it("withdraws brief_extraction/high from opt_germany_direct→fac_marketing_spend (0.8 £m: B1 states no such amount)", () => {
    // PRECONDITION PINNED IN-TEST (trap 13b third face): this is the exact
    // value the deployed build stamped `brief_extraction`/`high`, and £0.8m
    // is genuinely absent from B1 — the £ amounts B1 states are 11.2m, 20m,
    // 3.1m, 100k, 1.5m, 15.8m, 16m.
    const captured = MEASURED_INTERVENTIONS.find(
      (i) => i.optionId === "opt_germany_direct" && i.factorId === "fac_marketing_spend",
    );
    expect(captured).toBeDefined();
    expect(captured?.value).toBe(0.8);
    expect(captured?.unit).toBe("£m");
    expect(captured?.observedSource).toBe("brief_extraction");
    expect(captured?.observedValueConfidence).toBe("high");
    expect(BRIEF_TEXT_AS_PERSISTED.B1).not.toContain("£0.8m");

    const iv = interventionOf(extractFor("B1", BRIEF_TEXT_AS_PERSISTED.B1), "opt_germany_direct", "fac_marketing_spend");

    expect(iv.value).toBe(0.8); // the VALUE is never dropped
    expect(iv.source).not.toBe("brief_extraction");
    expect(iv.value_confidence).not.toBe("high");
  });

  it("withdraws the claim from opt_germany_direct→fac_headcount_budget (0.25 £m must not be earned by B1's €250k)", () => {
    // The currency swap is itself one of the measured losses: B1 states
    // "€250k", the draft stamped a £m unit. A £-denominated value is not made
    // brief-backed by a €-denominated statement.
    expect(BRIEF_TEXT_AS_PERSISTED.B1).toContain("€250k");
    const iv = interventionOf(extractFor("B1", BRIEF_TEXT_AS_PERSISTED.B1), "opt_partner_germany", "fac_headcount_budget");
    expect(iv.value).toBe(0.25);
    expect(iv.unit).toBe("£m");
    expect(iv.source).not.toBe("brief_extraction");
  });

  it("withdraws the claim from opt_copilot→fac_copilot_build (a 1 lever must not be earned by B3's \"100%\")", () => {
    expect(BRIEF_TEXT_AS_PERSISTED.B3).toContain("100%");
    const iv = interventionOf(extractFor("B3", BRIEF_TEXT_AS_PERSISTED.B3), "opt_copilot", "fac_copilot_build");
    expect(iv.value).toBe(1);
    expect(iv.source).not.toBe("brief_extraction");
  });

  it("withdraws the claim from all 47 captured interventions, and drops none of their values", () => {
    let checked = 0;
    for (const brief of ["B1", "B2", "B3"] as const) {
      const options = extractFor(brief, BRIEF_TEXT_AS_PERSISTED[brief]);
      for (const captured of MEASURED_INTERVENTIONS.filter((i) => i.brief === brief)) {
        const iv = interventionOf(options, captured.optionId, captured.factorId);
        expect(iv.value).toBe(captured.value);
        expect(
          iv.source,
          `${brief} ${captured.optionId}→${captured.factorId} (${captured.value}${captured.unit ?? ""}) still claims brief extraction`,
        ).not.toBe("brief_extraction");
        checked += 1;
      }
    }
    expect(checked).toBe(47);
  });

  it("KEEPS brief_extraction/high when the brief does state the amount (the discriminating positive)", () => {
    // Same seam, same option, same factor — only the brief changes. Without
    // this case the guard could pass by stripping unconditionally, which is a
    // different (and also dishonest) behaviour.
    const brief =
      "We will hold German marketing spend at £0.8m next year while the licence is pending.";
    const iv = interventionOf(extractFor("B1", brief), "opt_germany_direct", "fac_marketing_spend");
    expect(iv.value).toBe(0.8);
    expect(iv.source).toBe("brief_extraction");
    expect(iv.value_confidence).toBe("high");

    // …and the sibling intervention in the SAME option, whose value that brief
    // does NOT state, is still withdrawn. Per-intervention, not per-option.
    const sibling = interventionOf(extractFor("B1", brief), "opt_germany_direct", "fac_headcount_budget");
    expect(sibling.source).not.toBe("brief_extraction");
  });

  it("withdraws the claim when no brief is available at all (a missing brief is not evidence)", () => {
    const iv = interventionOf(extractFor("B1", undefined), "opt_germany_direct", "fac_marketing_spend");
    expect(iv.source).not.toBe("brief_extraction");
  });

  it("leaves the OPTION's own provenance alone (it answers a different question)", () => {
    // CLAUDE.md trap 21: `option.provenance.source` says where the OPTION came
    // from; `intervention.source` says where its VALUE came from. Reconciling
    // the two would be aligning the defaults of two different questions.
    const options = extractFor("B1", BRIEF_TEXT_AS_PERSISTED.B1);
    const option = options.find((o) => o.id === "opt_germany_direct");
    expect(option?.provenance?.source).toBe("brief_extraction");
    expect(option?.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// (b) Node-level provenance, reconciled with factor_value_coverage
// ---------------------------------------------------------------------------

/**
 * `fac_nrr` exactly as the repair stage leaves it before the V3 transform:
 * reclassified `external`, `data.value` deleted, `extractionType` promoted to
 * the node — the shape whose wire output the trace captured.
 */
function graphWithNrrShape() {
  return {
    graph: {
      nodes: [
        { id: "goal", kind: "goal", label: "Reach £20m ARR by FY28" },
        {
          id: "fac_nrr",
          kind: "factor",
          label: "Net Revenue Retention",
          category: "external",
          prior: { distribution: "uniform", range_min: 0, range_max: 1 },
          extractionType: "explicit",
        },
        {
          id: "fac_marketing_spend",
          kind: "factor",
          label: "Marketing Spend",
          category: "controllable",
          data: { value: 0.3, unit: "£m", cap: 1.5, extractionType: "explicit", factor_type: "cost" },
        },
      ],
      edges: [{ from: "fac_nrr", to: "goal", edge_type: "causal" }],
    },
  } as any;
}

function v3NodeById(body: any, id: string) {
  const found = (body.nodes ?? []).find((n: any) => n.id === id);
  if (!found) throw new Error(`fixture precondition failed: node ${id} absent from transform output`);
  return found;
}

describe("2.972(b) a value-free node may not claim it came from the brief", () => {
  it("fac_nrr shipped from_brief/explicit with no value — the measured defect", () => {
    const captured = MEASURED_FACTOR_NODES.find((f) => f.brief === "B1" && f.id === "fac_nrr");
    expect(captured).toBeDefined();
    expect(captured?.observedProvenance).toBe("from_brief");
    expect(captured?.observedExtractionType).toBe("explicit");
    expect(captured?.observedValue).toBeUndefined();
    expect(captured?.prior).toEqual({ distribution: "uniform", range_min: 0, range_max: 1 });
  });

  it("withdraws from_brief from fac_nrr at the transform seam", () => {
    const body: any = transformResponseToV3(graphWithNrrShape(), { brief: BRIEF_TEXT_AS_PERSISTED.B1 });
    const nrr = v3NodeById(body, "fac_nrr");
    expect(nrr.provenance).toBe("ai_inferred");
    // The prior — the only real content the node carries — is untouched.
    expect(nrr.prior).toEqual({ distribution: "uniform", range_min: 0, range_max: 1 });
  });

  it("withdraws the unearned extractionType too, so the wire carries no contradicting label", () => {
    const body: any = transformResponseToV3(graphWithNrrShape(), { brief: BRIEF_TEXT_AS_PERSISTED.B1 });
    const nrr = v3NodeById(body, "fac_nrr");
    expect(nrr.extractionType).not.toBe("explicit");
    expect(nrr.observed_state?.extractionType).not.toBe("explicit");
  });

  it("KEEPS from_brief on a DIFFERENT factor in the SAME graph that does carry a value", () => {
    // The discriminating half: the guard is bound to "no value", not to
    // "any factor". Stripping for everything would also pass the case above.
    const body: any = transformResponseToV3(graphWithNrrShape(), { brief: BRIEF_TEXT_AS_PERSISTED.B1 });
    const spend = v3NodeById(body, "fac_marketing_spend");
    expect(spend.provenance).toBe("from_brief");
    expect(spend.observed_state?.value).toBe(0.3);
    expect(spend.observed_state?.extractionType).toBe("explicit");
  });
});
