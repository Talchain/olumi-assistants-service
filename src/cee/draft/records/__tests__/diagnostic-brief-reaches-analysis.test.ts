/**
 * ⭐⭐⭐ THE OUTCOME ARM: does a diagnostic brief reach a COMPLETED ANALYSIS?
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * Instruction v11 was judged on "zero false options" — the SYMPTOM metric — and
 * it moved that metric while leaving the user exactly as blocked. Worse, 6 of
 * its 9 clean draws were clean only by emitting `stated_items[].kind = "claim"`,
 * a value the structured-outputs enum forbids, so the improvement could not
 * happen on the wire at all.
 *
 * Nothing in the estate measured the question that actually matters: GIVEN a
 * record set shaped the way the instruction asks for, does the user get an
 * analysis? This file measures it, and it is the arm that decides whether the
 * wording change is worth anything.
 *
 * ── ⚠⚠ WHAT THIS FILE IS AND IS NOT — DO NOT FLATTEN THIS ──────────────────
 * It is a DETERMINISTIC CONSUMER CONTROL over the real ingress → projector →
 * V3 → readiness chain. It proves the pipeline CAN carry a diagnostic brief to a
 * completed analysis, with attribution intact.
 *
 * It is NOT evidence that the model WILL emit this shape. The record sets below
 * are hand-built, and a fixture you wrote yourself is not evidence about the
 * wire (CLAUDE.md trap 16-inverse). Model compliance needs real provider draws
 * against the grammar, and no such measurement is claimed here.
 *
 * Read together with `instruction-pin.test.ts`, which pins the WORDING that asks
 * for this shape. This file pins that the shape, once emitted, PAYS.
 */
import { describe, expect, it } from "vitest";

import { projectDraftRecords } from "../seam.js";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import { assessCanonicalAnalysisReadiness } from "../../../../orchestrator/tools/analysis-ready-helper.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * The brief from the DEPLOYED BEFORE witness (CEE `a18e194`, 2026-08-30).
 * Banked verbatim at
 * `Docs/v5/evidence/records-v11-cause-not-option-2026-08-30/briefs/A1.txt`.
 */
const A1 =
  "Our revenue growth has stalled over the last three quarters and the leadership team does not agree on why. Some think the product has fallen behind competitors, others think onboarding is the problem, and others think we're selling to the wrong customers. We need to work out what is actually going on before the board meeting in March.";

type Chain = {
  readonly graph: unknown;
  readonly options: readonly { label?: string; interventions?: Record<string, unknown> }[];
  readonly nodes: readonly { kind?: string; type?: string; label?: string; provenance?: unknown }[];
  readonly safeToAnalyse: boolean;
  readonly status: string | undefined;
  readonly blocking: readonly string[];
};

/** The real chain a drafted record set travels to reach the readiness gate. */
function drive(records: DraftRecordSet, brief: string): Chain {
  const seam = projectDraftRecords(records, brief);
  if (!seam.ok) throw new Error(`seam refused the record set: ${seam.reason}`);
  const normalised = normaliseDraftResponse(
    JSON.parse(JSON.stringify(seam.projection.graph)),
  ) as Record<string, unknown>;
  const projected = projectGraphAndOptionsToV3(normalised as never, { brief });
  const assessment = assessCanonicalAnalysisReadiness(projected.graph);
  return {
    graph: projected.graph,
    options: projected.options as never,
    nodes: projected.graph.nodes,
    safeToAnalyse: assessment.safeToAnalyse,
    status: (assessment.analysisReady as { status?: string } | undefined)?.status,
    blocking: assessment.blockingIssues.map((i) => i.code),
  };
}

const kindOf = (n: { kind?: string; type?: string }) => n.type ?? n.kind;
const labelsOfKind = (c: Chain, kind: string) =>
  c.nodes.filter((n) => kindOf(n) === kind).map((n) => n.label);

/**
 * ⭐ THE DEFECT ARM, shaped as the DEPLOYED capture actually returned it.
 *
 * `DEPLOYED-BEFORE-witness-A1-assist-v1-draft-graph.json` came back with three
 * option nodes — "The Product Has Fallen Behind Competitors", "Onboarding Is the
 * Problem", "We're Selling to the Wrong Customers" — each `from_brief`, each
 * carrying the attributed span as its `source_quote`. Three competing
 * EXPLANATIONS, put on the graph to be scored and ranked against one another.
 */
function explanationsFiledAsOptions(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "revenue growth" },
      { kind: "option", source_quote: "the product has fallen behind competitors" },
      { kind: "option", source_quote: "onboarding is the problem" },
      { kind: "option", source_quote: "we're selling to the wrong customers" },
    ],
    claims: [
      { claim_kind: "factor", label: "Growth Rate", basis: [0] },
      { claim_kind: "causal_link", label: "a", from_stated: 1, to_claim: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "b", from_stated: 2, to_claim: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "c", from_stated: 3, to_claim: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "d", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  } as unknown as DraftRecordSet;
}

/**
 * ⭐⭐ THE v12 ARM — the shape the instruction now asks for, and nothing more.
 *
 * The three hypotheses are RETAINED as `factor` claims: they are the reasoning
 * the leadership team arrived with, and a diagnostic tool that deletes them to
 * tidy the graph has removed the thing they are arguing about.
 *
 * The two actions are `option_refinement` claims — the route the instruction now
 * names. Neither is quoted from the brief, because the brief names no course of
 * action; both were in the model's reach all along (the same deployed draw that
 * mis-filed the causes ALSO emitted "Commission structured win/loss review" and
 * "Run rapid customer interviews and churn analysis").
 *
 * `sets_to` is on the option→factor links and belongs there: these are ACTIONS,
 * so "the value that factor would take if this option were chosen" is a defined
 * question. It was never defined for the explanations, which is exactly why
 * forcing it onto them would have been worse than blocking.
 */
function causesAsFactorsActionsAsRefinements(): DraftRecordSet {
  return {
    stated_items: [{ kind: "goal", source_quote: "revenue growth" }],
    claims: [
      { claim_kind: "factor", label: "Competitive Product Position", basis: [0] },
      { claim_kind: "factor", label: "Onboarding Conversion", basis: [0] },
      { claim_kind: "factor", label: "Customer Segment Fit", basis: [0] },
      { claim_kind: "outcome", label: "Quarterly Revenue Growth", basis: [0] },
      { claim_kind: "option_refinement", label: "Commission a structured win/loss review", basis: [0] },
      { claim_kind: "option_refinement", label: "Run rapid customer interviews across churned accounts", basis: [0] },
      { claim_kind: "causal_link", label: "review sharpens competitive read", from_claim: 4, to_claim: 0, effect: "positive", sets_to: 0.8 },
      { claim_kind: "causal_link", label: "review sharpens onboarding read", from_claim: 4, to_claim: 1, effect: "positive", sets_to: 0.4 },
      { claim_kind: "causal_link", label: "review sharpens segment read", from_claim: 4, to_claim: 2, effect: "positive", sets_to: 0.5 },
      { claim_kind: "causal_link", label: "interviews sharpen competitive read", from_claim: 5, to_claim: 0, effect: "positive", sets_to: 0.5 },
      { claim_kind: "causal_link", label: "interviews sharpen onboarding read", from_claim: 5, to_claim: 1, effect: "positive", sets_to: 0.9 },
      { claim_kind: "causal_link", label: "interviews sharpen segment read", from_claim: 5, to_claim: 2, effect: "positive", sets_to: 0.8 },
      { claim_kind: "causal_link", label: "competitive position bears on growth", from_claim: 0, to_claim: 3, effect: "positive" },
      { claim_kind: "causal_link", label: "onboarding bears on growth", from_claim: 1, to_claim: 3, effect: "positive" },
      { claim_kind: "causal_link", label: "segment fit bears on growth", from_claim: 2, to_claim: 3, effect: "positive" },
      { claim_kind: "causal_link", label: "growth reaches the goal", from_claim: 3, to_stated: 0, effect: "positive" },
    ],
  } as unknown as DraftRecordSet;
}

describe("a diagnostic brief, filed the way v12 asks, reaches a completed analysis", () => {
  /**
   * The CONTRAST CONTROL. Without it, every assertion in the next test is a
   * claim about a chain that might behave identically on any input — and the
   * v12 arm's `ready` would be evidence about the pipeline, not about the
   * shape (CLAUDE.md trap 13).
   */
  it("BEFORE — explanations filed as options are RANKED AS ALTERNATIVES", () => {
    const before = drive(explanationsFiledAsOptions(), A1);
    const options = labelsOfKind(before, "option");

    // The witnessed defect, reproduced: three EXPLANATIONS standing as the
    // user's alternatives, scored and ranked against one another.
    expect(options).toContain("The Product Has Fallen Behind Competitors");
    expect(options).toContain("Onboarding Is the Problem");
    expect(options).toContain("We're Selling to the Wrong Customers");

    // And not one of them is a factor — the hypotheses exist ONLY as options,
    // so the disagreement itself has been destroyed by the filing.
    expect(labelsOfKind(before, "factor")).not.toContain("Competitive Product Position");
  });

  it("AFTER — (a) the causes are no longer options, and they are still THERE", () => {
    const after = drive(causesAsFactorsActionsAsRefinements(), A1);

    // (a) zero explanation-shaped options
    const options = labelsOfKind(after, "option");
    expect(options).not.toContain("The Product Has Fallen Behind Competitors");
    expect(options).not.toContain("Onboarding Is the Problem");
    expect(options).not.toContain("We're Selling to the Wrong Customers");

    // ⭐ AND THE HALF A "ZERO FALSE OPTIONS" COUNT CANNOT SEE: every hypothesis
    // SURVIVED. Deleting them would also score zero on the symptom metric, and
    // would be the worse outcome — the user came with a disagreement, and the
    // disagreement is the reasoning.
    const factors = labelsOfKind(after, "factor");
    expect(factors).toContain("Competitive Product Position");
    expect(factors).toContain("Onboarding Conversion");
    expect(factors).toContain("Customer Segment Fit");
  });

  it("AFTER — (c) the analysis COMPLETES, which is the arm that matters", () => {
    const after = drive(causesAsFactorsActionsAsRefinements(), A1);

    // THE OUTCOME METRIC. v11 moved the symptom and left this exactly where it
    // was: "Not ready for analysis yet".
    expect(after.blocking).toEqual([]);
    expect(after.status).toBe("ready");
    expect(after.safeToAnalyse).toBe(true);

    // Two AI-proposed actions carried the alternatives, via `option_refinement`.
    // ⭐ Bound by IDENTITY (exact label), not by a count another node could
    // satisfy. Note the wording is carried through VERBATIM as authored, not
    // title-cased the way a `source_quote` label is — these are the model's own
    // words, and they are not being dressed up as a quotation from the user.
    expect(labelsOfKind(after, "option")).toEqual([
      "Commission a structured win/loss review",
      "Run rapid customer interviews across churned accounts",
    ]);
  });

  it("AFTER — it buys the analysis WITHOUT erasing attribution or inventing user facts", () => {
    const after = drive(causesAsFactorsActionsAsRefinements(), A1);

    // ⭐ THE PRODUCT RULING, ASSERTED: Olumi's own contributions stay
    // distinguishable from the user's. Every option here is ours, and says so.
    for (const node of after.nodes.filter((n) => kindOf(n) === "option")) {
      expect(node.provenance).toBe("ai_inferred");
      expect(node.provenance).not.toBe("from_brief");
    }

    // ⭐ AND NO INVENTED USER QUANTITY. Every intervention is OURS
    // (`cee_hypothesis`), never dressed as a figure the user supplied
    // (`brief_extraction`) — the brief states no per-option magnitude, so a
    // `brief_extraction` here would be a fabricated user fact.
    const sources = after.options.flatMap((o) =>
      Object.values(o.interventions ?? {}).map((i) => (i as { source?: string }).source),
    );
    expect(sources.length).toBe(6);
    expect(new Set(sources)).toEqual(new Set(["cee_hypothesis"]));
    expect(sources).not.toContain("brief_extraction");
  });

  /**
   * ⭐⭐ THE DISCRIMINATING CONTROL, and without it the `ready` above is a claim
   * about the PIPELINE rather than about the ROUTE.
   *
   * Change ONE thing — the two proposed actions' `claim_kind`, from
   * `option_refinement` to `factor` — and hold every other byte of the record
   * set fixed. If `ready` still came back, the verdict above would be telling us
   * the chain is permissive, not that the route carries. It does not: with no
   * option to act on them the graph cannot be analysed at all.
   *
   * This is the same shape as the F2 carrier probe's role-sensitivity control,
   * run here against the readiness gate rather than the projector.
   */
  it("CONTROL — flip only the claim role and the analysis stops being reachable", () => {
    const flipped = causesAsFactorsActionsAsRefinements() as unknown as {
      claims: { claim_kind: string; label?: string }[];
    };
    for (const claim of flipped.claims) {
      if (claim.claim_kind === "option_refinement") claim.claim_kind = "factor";
    }
    const after = drive(flipped as unknown as DraftRecordSet, A1);

    // The proposed actions are no longer options...
    expect(labelsOfKind(after, "option")).not.toContain(
      "Commission a structured win/loss review",
    );
    // ...and the analysis the previous test reached is gone.
    expect(after.safeToAnalyse).toBe(false);
    expect(after.status).not.toBe("ready");
  });
});

/**
 * ⭐⭐ ARM (b) — THE COUNTERPART THAT MUST NOT REGRESS, ASSERTED AT CARRIAGE.
 *
 * A rule keyed on ATTRIBUTION rather than on ACTION would silently delete the
 * user's real alternatives, and that harm is STRICTLY WORSE than the one v12
 * closes: it removes choices the user actually stated from their own decision,
 * and no corpus of diagnostic briefs could ever show it (CLAUDE.md trap 22b).
 *
 * The instruction half of this is pinned in `instruction-pin.test.ts` ("Who said
 * it makes no difference"). This is the half that proves the PIPELINE still
 * carries such options end to end.
 */
describe("attributed REAL actions survive as the user's own options", () => {
  const B = "Sales says cut the price by 15%, product says hold price and ship the integrations. We need to protect renewal revenue this quarter.";

  it("two real acts, each attributed to a named team, both stay stated options", () => {
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "protect renewal revenue" },
        { kind: "option", source_quote: "cut the price by 15%" },
        { kind: "option", source_quote: "hold price and ship the integrations" },
      ],
      claims: [
        { claim_kind: "factor", label: "Renewal Rate", basis: [0] },
        { claim_kind: "outcome", label: "Renewal Revenue", basis: [0] },
        { claim_kind: "causal_link", label: "price cut moves renewals", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.8 },
        { claim_kind: "causal_link", label: "integrations move renewals", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0.7 },
        { claim_kind: "causal_link", label: "renewals drive revenue", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "revenue reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    } as unknown as DraftRecordSet;

    const chain = drive(records, B);
    const options = labelsOfKind(chain, "option");

    // ZERO LOSSES: both of the user's real alternatives are still alternatives,
    // despite each being introduced by "sales says" / "product says".
    expect(options).toHaveLength(2);
    expect(options).toContain("Cut the Price by 15%");
    expect(options).toContain("Hold Price and Ship the Integrations");

    // ⭐ AND THEY ARE STILL THE USER'S. A demotion to `ai_inferred` here would be
    // the estate's other false-authorship defect running in reverse: the product
    // quietly taking credit for the user's own alternatives.
    for (const node of chain.nodes.filter((n) => kindOf(n) === "option")) {
      expect(node.provenance).toBe("from_brief");
    }
  });
});
