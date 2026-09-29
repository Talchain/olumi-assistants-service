/**
 * ⭐ THE PRODUCT WIRES AN OPTION, THEN ASKS THE USER WHAT THAT OPTION CHANGES.
 *
 * MEASURED LIVE on `cee-staging.onrender.com/proxy/v5/turn` (frame stage, fresh
 * scenario per run, 2026-09-14). On a draft of the pricing brief the response
 * carried, simultaneously:
 *
 *   draft_graph.edges[]   { from: <option>, to: <factor>, origin: "repair",
 *                           provenance: { reasoning: "Status-quo option wired
 *                           to factor" } }                        ×2
 *   analysis_ready.options[] { option_id: <same option>,
 *                              status: "needs_user_mapping",
 *                              status_reason: "No interventions extracted" }
 *   readiness_issues[]    { code: "OPTION_NEEDS_MAPPING",
 *                           message: "Choose which factor \"increase the Pro
 *                           plan price from £49 to £59 per month with the next
 *                           Pro feature release\" changes and by how much." }
 *
 * TWO DEFECTS, AND THEY HAVE DIFFERENT CAUSES — established before either was
 * touched, because the remedies are incompatible:
 *
 *  1. THE REASONING STRING NAMED THE WRONG OPTION CLASS, and the string is the
 *     only thing that was wrong. The option it wired was labelled with the
 *     user's own words — a proposal to RAISE the price — while a genuine
 *     `is_baseline` status-quo option ("Hold Price at £49") sat in the same
 *     graph, fully connected and untouched. But the repair did NOT select the
 *     wrong node: `fixStatusQuoConnectivity` selects on `!hasPathToGoal` and
 *     nothing else, and that option genuinely had no route to goal. The
 *     selection was right; the hardcoded literal describing it was boilerplate.
 *     Its sibling `action` string was DERIVED and already honest ("Wired
 *     disconnected option …"). Fixed by making the minted string truthful; the
 *     predicate is deliberately untouched, because changing it would break a
 *     correct connectivity repair.
 *
 *  2. THE ASK WAS PUT FROM SCRATCH ABOUT AN OPTION THE PRODUCT HAD ALREADY
 *     WIRED. `connectedFactorCount` excluding repair-authored edges is correct,
 *     deliberate and documented (ROADMAP 2.1266, `option-status.ts:276-290`) —
 *     a link the product drew for itself is not a mapping the user made — and
 *     it is NOT changed here. What is fixed is the sentence: it now names the
 *     link, disowns it, and says it carries no value, instead of reading like
 *     the product does not know its own state.
 *
 * ⛔ WHAT THIS FIX MUST NOT DO, pinned below as a guard: make the ask disappear
 * by counting repair edges as connections. That would silence a legitimate
 * question by inflating a readiness count. The `stillAsked` assertions in BOTH
 * arms exist to fail if anyone tries it.
 *
 * ⚠ WHY THE DISCLOSURE HAD TO GO IN THE SENTENCE. The standing justification
 * for NOT surfacing this repair (`transforms/analysis-ready.ts:677-680`,
 * `stages/boundary.ts:38-39`) is that it "stays disclosed" because it rides
 * `trace.repair_summary.deterministic_repairs[]`, "which the UI renders".
 * DERIVED AT THE LIVE WIRE on the same responses: the substrings
 * `repair_summary` and `deterministic_repairs` occur ZERO times in the
 * `/proxy/v5/turn` payload. `STATUS_QUO_WIRED` survives in exactly one place,
 * `_diagnostic_trace.pipeline_outcome.repair_provenance[]` — the diagnostic
 * channel. It is absent from `analysis_ready.model_adjustments` (which carried
 * 5 other rows, so the surface was live and simply does not admit this code —
 * the closed-enum adjudication in `boundary.ts` is correct) and absent from
 * `model_building_notices`, which is counts-only with `details_redacted: true`.
 * SCOPE, stated precisely: this is a claim about what the draft-turn RESPONSE
 * carries, not about what the UI renders from it. It is enough to establish
 * that the carrier the adjudication relies on is not in that response.
 */

import { describe, it, expect } from "vitest";
import { assessCanonicalAnalysisReadiness } from "../../src/orchestrator/tools/analysis-ready-helper.js";
import { REPAIR_AUTHORED_ORIGIN } from "../../src/graph/repair-authored-edge.js";
import {
  CONNECTIVITY_REPAIR_WIRING_REASON,
  fixStatusQuoConnectivity,
} from "../../src/cee/unified-pipeline/stages/repair/status-quo-fix.js";

// ---------------------------------------------------------------------------
// Fixtures — the live shape, reduced. `opt_hold` is the DISCONNECTED option.
// ---------------------------------------------------------------------------

/** Shared spine: one connected option, one factor, an outcome and a goal. */
function baseGraph(): any {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Pricing?" },
      { id: "opt_a", kind: "option", label: "Raise to £59", data: { interventions: { fac_price: 0.59 } } },
      { id: "opt_hold", kind: "option", label: "Raise Price to £59 with Feature Release" },
      { id: "fac_price", kind: "factor", label: "Pro Plan Monthly Price", category: "controllable", observed_state: { value: 0.49 } },
      { id: "out_1", kind: "outcome", label: "MRR" },
      { id: "goal_1", kind: "goal", label: "Reach £20k MRR" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_hold", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_price", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "fac_price", to: "out_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
      { from: "out_1", to: "goal_1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 1, effect_direction: "positive" },
    ],
  };
}

/**
 * THE DEFECT ARM: `opt_hold` carries the repair's own option→factor edge,
 * exactly as it reaches readiness on the V3 wire. Note the provenance is
 * already `cee_hypothesis` — the transform coerces `"synthetic"` away, which is
 * why `origin` is the only surviving discriminator.
 */
function repairWiredGraph(): any {
  const graph = baseGraph();
  graph.edges.push({
    from: "opt_hold",
    to: "fac_price",
    strength: { mean: 1, std: 0.01 },
    exists_probability: 1,
    effect_direction: "positive",
    origin: REPAIR_AUTHORED_ORIGIN,
    provenance: { source: "cee_hypothesis", reasoning: CONNECTIVITY_REPAIR_WIRING_REASON },
  });
  return graph;
}

/**
 * ⛔ THE NEGATIVE CONTROL, and it is the load-bearing half of this file. The
 * SAME option, genuinely unwired: no repair edge, no stated edge, nothing. It
 * must STILL be asked, in the plain words, with no disclosure — a fix that
 * stops the product asking is worse than the defect it replaces.
 */
function genuinelyUnwiredGraph(): any {
  return baseGraph();
}

function mappingIssueFor(graph: any, optionId: string): any {
  const assessment: any = assessCanonicalAnalysisReadiness(graph);
  const issues: any[] = assessment.issues ?? [];
  return {
    assessment,
    issue: issues.find((i) => i.option_id === optionId && i.code === "OPTION_NEEDS_MAPPING"),
    option: (assessment.analysisReady?.options ?? []).find(
      (o: any) => (o.option_id ?? o.id) === optionId,
    ),
  };
}

// ---------------------------------------------------------------------------

describe("the repair's own wiring is disclosed, not re-asked from scratch", () => {
  it("names the link, disowns it, and says it carries no value", () => {
    const { issue } = mappingIssueFor(repairWiredGraph(), "opt_hold");

    expect(issue).toBeDefined();
    // The ask itself is UNCHANGED and still leads the sentence.
    expect(issue.message).toContain(
      'Choose which factor "Raise Price to £59 with Feature Release" changes and by how much.',
    );
    // …and it now says the product already drew a link, whose inference it is,
    // and that the link carries nothing numeric.
    expect(issue.message).toContain("already linked it to one factor");
    expect(issue.message).toContain("Olumi's own inference rather than a mapping you stated");
    expect(issue.message).toContain("carries no effect value");
  });

  it("⛔ NEGATIVE CONTROL — a genuinely unwired option is still asked, with no disclosure", () => {
    const { issue } = mappingIssueFor(genuinelyUnwiredGraph(), "opt_hold");

    expect(issue).toBeDefined();
    // The question still fires. This is the assertion that fails if anyone
    // "fixes" the defect by making the ask go away.
    expect(issue.message).toContain(
      'Choose which factor "Raise Price to £59 with Feature Release" changes and by how much.',
    );
    // Nothing was invented to disclose.
    expect(issue.message).not.toContain("already linked");
    expect(issue.message).not.toContain("Olumi's own inference");
    // The plain ask is EXACTLY the historical sentence, byte for byte.
    expect(issue.message).toBe(
      'Choose which factor "Raise Price to £59 with Feature Release" changes and by how much.',
    );
  });

  it("⛔ the repair's edge is still NOT counted as a connection — readiness is not inflated", () => {
    const wired = mappingIssueFor(repairWiredGraph(), "opt_hold");
    const unwired = mappingIssueFor(genuinelyUnwiredGraph(), "opt_hold");

    // ROADMAP 2.1266's exclusion is untouched: in BOTH arms the option is still
    // awaiting a mapping, and in neither did the product's own wiring promote
    // it. A `ready` here, or a swap to `needs_encoding`, means the forbidden fix
    // has been taken.
    for (const arm of [wired, unwired]) {
      expect(arm.option?.status).toBe("needs_user_mapping");
      expect(arm.option?.status).not.toBe("ready");
      expect(arm.option?.status).not.toBe("needs_encoding");
      expect(arm.issue.code).toBe("OPTION_NEEDS_MAPPING");
    }
  });

  it("the two arms differ ONLY by the disclosure — the discrimination is real", () => {
    // Trap 13b: a guard whose discriminating power is unpinned decays into a
    // tautology. Assert the two messages are genuinely different, and that the
    // difference is a strict suffix on the unchanged ask.
    const wired = mappingIssueFor(repairWiredGraph(), "opt_hold").issue.message;
    const unwired = mappingIssueFor(genuinelyUnwiredGraph(), "opt_hold").issue.message;

    expect(wired).not.toBe(unwired);
    expect(wired.startsWith(unwired)).toBe(true);
    expect(wired.length).toBeGreaterThan(unwired.length);
  });
});

describe("the repair stops claiming an option class it never tested", () => {
  it("the minted edge's reasoning names the repair, not the status quo", () => {
    // Bound to the producer by IDENTITY (trap 19), never a re-copied literal.
    expect(CONNECTIVITY_REPAIR_WIRING_REASON).not.toMatch(/status[- ]quo/i);
    expect(CONNECTIVITY_REPAIR_WIRING_REASON).toContain("Connectivity repair");
    expect(CONNECTIVITY_REPAIR_WIRING_REASON).toContain("no effect value is implied");
  });

  it("is what the repair actually stamps on the edge it mints", () => {
    // POSITIVE CONTROL: prove the repair fires on this graph at all, so the
    // assertion below is about an edge that exists rather than about an empty
    // set (trap 13 — an absence assertion needs a presence first).
    const graph = genuinelyUnwiredGraph();
    const before = graph.edges.length;

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    expect(result.repairs.some((r) => r.code === "STATUS_QUO_WIRED")).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(before);

    const minted = graph.edges.filter((e: any) => e.origin === REPAIR_AUTHORED_ORIGIN);
    expect(minted.length).toBeGreaterThan(0);

    const reasons = minted
      .map((e: any) => e.provenance?.quote ?? e.provenance?.reasoning)
      .filter((q: unknown): q is string => typeof q === "string");
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toBe(CONNECTIVITY_REPAIR_WIRING_REASON);
      expect(reason).not.toMatch(/status[- ]quo/i);
    }

    // The DERIVED sibling string was always honest and stays that way.
    const wired = result.repairs.find((r) => r.code === "STATUS_QUO_WIRED");
    expect(wired?.action).toContain("Wired disconnected option");
  });
});
