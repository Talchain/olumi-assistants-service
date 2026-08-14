/**
 * ⭐⭐ RISKS AND OUTCOMES MUST BE EXPRESSIBLE — the grammar half of the
 * 14 Aug analysis-outage root cause.
 *
 * ── THE DEFECT, MEASURED ───────────────────────────────────────────────────
 * The 12 Aug R1 cutover (`9f94e81b`) introduced `grammar.ts` with a DRAFTABLE
 * subset of four claim kinds — `factor | causal_link | option_refinement |
 * prior`. `risk` and `outcome` are in NEITHER kinds list, and the list IS the
 * Anthropic structured-output enum (`buildDraftRecordsSchema`), so a model that
 * reasons about a risk has no field in which to say so. Live evidence, 5/5
 * draws on the pinned brief (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/
 * analysis-outage-2026-08-14/summary.json`): `riskCount: 0` every time, and
 * every outcome on the graph was minted by `fixFactorGoalEdges`.
 *
 * The banked live capture in this very directory shows the flattening happening
 * in the model's own words: `live-emission-round11-set12.json` carries a FACTOR
 * claim labelled **"Engineering Attrition Risk"**. The model wanted a risk and
 * had only `factor`.
 *
 * ── ⚠ A CORRECTED PREMISE, AND IT NARROWS THE FIX ─────────────────────────
 * The root-cause report names BOTH `DRAFT_RECORD_STATED_KINDS` (:136) and
 * `DRAFT_RECORD_CLAIM_KINDS` (:148) as the site. Derived at the bytes, the
 * STATED half is not a hole: `normaliseDraftResponse` runs immediately after
 * projection and `NODE_KIND_MAP` maps `constraint → risk`, so a hazard the USER
 * states already reaches a `risk` node through the `constraint` stated kind.
 * That path is pinned below as a POSITIVE CONTROL, because a fix that widened
 * the stated enum too would have cost grammar bytes, invited the model to file
 * real thresholded constraints as bare risks, and bought no reachable
 * capability. The hole is the CLAIM axis: what the model itself adds.
 */
import { describe, expect, it } from "vitest";

import {
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORD_STATED_KINDS,
  buildDraftRecordsSchema,
  measureDraftRecordsSchemaBudget,
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  ANTHROPIC_UNION_PARAM_LIMIT,
  SERIALIZED_BYTES_BUDGET,
} from "../grammar.js";
import { projectDraftRecords } from "../seam.js";
import { renderLegalEdgeVocabulary } from "../completion.js";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * A record set in which the model states a risk and an outcome IN ITS OWN
 * VOICE, on a basis the user supplied.
 *
 * Shaped as the real spine the validator checks — option → factor → outcome →
 * goal, with the risk hanging off the same factor — so the assertions below are
 * about a set the pipeline would actually accept, not about a fragment.
 */
function recordsWithRiskAndOutcome(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "grow ARR 15% next year" },
      { kind: "option", source_quote: "hire a tech lead" },
      { kind: "option", source_quote: "hire two developers" },
    ],
    claims: [
      // claims[0]
      { claim_kind: "factor", label: "Engineering Throughput", basis: [0] },
      // claims[1] — THE OUTCOME THE MODEL REASONED TO
      { claim_kind: "outcome", label: "Feature Delivery Rate", basis: [0] },
      // claims[2] — THE RISK THE MODEL REASONED TO
      { claim_kind: "risk", label: "Engineering Attrition", basis: [0] },
      { claim_kind: "causal_link", label: "lead raises throughput", from_stated: 1, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "devs raise throughput", from_stated: 2, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "throughput drives delivery", from_claim: 0, to_claim: 1, effect: "positive" },
      { claim_kind: "causal_link", label: "throughput strains the team", from_claim: 0, to_claim: 2, effect: "positive" },
      { claim_kind: "causal_link", label: "delivery reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "attrition threatens the goal", from_claim: 2, to_stated: 0, effect: "negative" },
    ],
  };
}

describe("the draft-records grammar can express a risk and an outcome", () => {
  it("declares `risk` and `outcome` as claim kinds", () => {
    expect(DRAFT_RECORD_CLAIM_KINDS).toContain("risk");
    expect(DRAFT_RECORD_CLAIM_KINDS).toContain("outcome");
  });

  it("puts both kinds in the STRUCTURED-OUTPUT enum the adapter attaches", () => {
    // Derived from the schema builder, never from a copy: the enum the model is
    // constrained by is the one `buildDraftRecordsSchema()` returns, and that is
    // the object `anthropic.ts` attaches.
    const schema = buildDraftRecordsSchema() as {
      properties: { claims: { items: { properties: { claim_kind: { enum: string[] } } } } };
    };
    const enumValues = schema.properties.claims.items.properties.claim_kind.enum;
    expect(enumValues).toContain("risk");
    expect(enumValues).toContain("outcome");
  });

  it("stays inside every live-probed grammar budget after the widening", () => {
    // The widening is two enum members. This asserts it did not push the
    // compiled grammar past the boundary that silently degrades every draft to
    // prompt-only JSON — the failure mode the budget instruments exist for.
    const budget = measureDraftRecordsSchemaBudget();
    expect(budget.serializedBytes).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
    expect(budget.optionalParams).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    expect(budget.unionParams).toBeLessThanOrEqual(ANTHROPIC_UNION_PARAM_LIMIT);
    expect(budget.forbiddenKeywords).toEqual([]);
    expect(budget.objectsMissingAdditionalPropertiesFalse).toEqual([]);
  });

  it("does NOT widen the stated-item enum — the corrected premise, pinned", () => {
    // Recorded as an assertion rather than a comment so a later lane that
    // "completes" the widening has to argue with a red test and read the
    // positive control below first.
    expect(DRAFT_RECORD_STATED_KINDS).not.toContain("risk");
    expect(DRAFT_RECORD_STATED_KINDS).not.toContain("outcome");
  });
});

describe("a record set carrying risk and outcome claims projects risk and outcome NODES", () => {
  /**
   * Through `projectDraftRecords` — the SEAM, i.e. the wire validator plus the
   * projector — because that is the surface the product runs. Calling the
   * projector directly is how `sets_to` shipped dark for a whole train.
   */
  it("projects one risk node and one outcome node, bound by LABEL", () => {
    const result = projectDraftRecords(recordsWithRiskAndOutcome(), "grow ARR 15% next year");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nodes = result.projection.graph.nodes;
    // Bound by identity (kind + exact label), never by a count another node
    // could satisfy.
    const risk = nodes.find((n) => n.label === "Engineering Attrition");
    const outcome = nodes.find((n) => n.label === "Feature Delivery Rate");
    expect(risk?.kind).toBe("risk");
    expect(outcome?.kind).toBe("outcome");
  });

  it("badges both `ai_inferred` — they are the model's claims, not the user's", () => {
    const result = projectDraftRecords(recordsWithRiskAndOutcome(), "grow ARR 15% next year");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nodes = result.projection.graph.nodes;
    for (const label of ["Engineering Attrition", "Feature Delivery Rate"]) {
      const node = nodes.find((n) => n.label === label);
      expect(node?.provenance?.provenance_class).toBe("ai_inferred");
    }
  });

  it("carries the causal links the model drew INTO and OUT OF them", () => {
    const result = projectDraftRecords(recordsWithRiskAndOutcome(), "grow ARR 15% next year");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { nodes, edges } = result.projection.graph;
    const idOf = (label: string) => nodes.find((n) => n.label === label)?.id;
    const throughput = idOf("Engineering Throughput");
    const risk = idOf("Engineering Attrition");
    const outcome = idOf("Feature Delivery Rate");
    const goal = idOf("grow ARR 15% next year");

    expect(edges.some((e) => e.from === throughput && e.to === outcome)).toBe(true);
    expect(edges.some((e) => e.from === throughput && e.to === risk)).toBe(true);
    expect(edges.some((e) => e.from === outcome && e.to === goal)).toBe(true);
    expect(edges.some((e) => e.from === risk && e.to === goal)).toBe(true);
  });

  it("survives normalisation with both kinds intact (they are canonical, not synonyms)", () => {
    const result = projectDraftRecords(recordsWithRiskAndOutcome(), "grow ARR 15% next year");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const normalised = normaliseDraftResponse(
      JSON.parse(JSON.stringify(result.projection.graph)),
    ) as { nodes: { kind: string; label: string }[] };

    expect(normalised.nodes.find((n) => n.label === "Engineering Attrition")?.kind).toBe("risk");
    expect(normalised.nodes.find((n) => n.label === "Feature Delivery Rate")?.kind).toBe("outcome");
  });
});

describe("POSITIVE CONTROL — the stated `constraint` path already reaches a risk node", () => {
  /**
   * This is the control that makes the narrowed fix defensible rather than
   * merely smaller. Without it, "we did not widen the stated enum" is an
   * unevidenced choice; with it, the stated half is demonstrably not a hole.
   */
  it("a stated constraint becomes a `constraint` node that NORMALISES to `risk`", () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow ARR 15% next year" },
        { kind: "constraint", source_quote: "we cannot lose more engineers" },
      ],
      // The link is REQUIRED, not decorative: the projector prunes anything that
      // cannot reach the goal, so a bare constraint would vanish and the control
      // would "pass" by measuring nothing (trap 13).
      claims: [
        { claim_kind: "causal_link", label: "the limit bears on the goal", from_stated: 1, to_stated: 0, effect: "negative" },
      ],
    };
    const result = projectDraftRecords(records, "grow ARR 15% next year; we cannot lose more engineers");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projected = result.projection.graph.nodes.find(
      (n) => n.label === "we cannot lose more engineers",
    );
    expect(projected?.kind).toBe("constraint");

    const normalised = normaliseDraftResponse(
      JSON.parse(JSON.stringify(result.projection.graph)),
    ) as { nodes: { kind: string; label: string }[] };
    expect(
      normalised.nodes.find((n) => n.label === "we cannot lose more engineers")?.kind,
    ).toBe("risk");
  });
});

describe("the completion turn's legal vocabulary tells the model an outcome is emittable", () => {
  /**
   * `MODEL_UNREACHABLE_KIND_REASON` classified `outcome` as *"never emitted by
   * the model; the sweep mints it from a factor→goal edge"*. That sentence was
   * TRUE and is now FALSE, and while it stood the vocabulary block silently
   * dropped both `factor → outcome` and `outcome → goal` from the legal list it
   * shows the model — so a completion turn was never told the shape that ends a
   * chain honestly.
   */
  it("lists `factor → outcome` and `outcome → goal` as shapes the model may emit", () => {
    const vocabulary = renderLegalEdgeVocabulary();
    expect(vocabulary).toContain("an outcome");
    const legalHalf = vocabulary.split("These shapes are dropped outright")[0] ?? "";
    expect(legalHalf).toMatch(/a factor → an outcome/);
    expect(legalHalf).toMatch(/an outcome → the goal/);
  });

  it("still names a risk as emittable, and still forbids pointing into an option", () => {
    const vocabulary = renderLegalEdgeVocabulary();
    expect(vocabulary).toMatch(/a factor → a risk/);
    const forbiddenHalf = vocabulary.split("These shapes are dropped outright")[1] ?? "";
    expect(forbiddenHalf).toContain("an option");
  });
});
