/**
 * ⭐⭐⭐ THE BLOCK NAMES THE RISK BUT NOT THE WAY OUT — and the way a user would
 * GUESS does not work.
 *
 * ── WHAT #1670 ALREADY FIXED, AND WHAT IT LEFT ─────────────────────────────
 * `mapping-need-survives-to-the-wire.test.ts` pins that a risk-blocked option is
 * asked about the RISK rather than about a factor, and its own header states its
 * scope in as many words: *"This fixes the SENTENCE ONLY."* The sentence it
 * ships is:
 *
 *     How does X change <risk label>? The proposed relationship is retained,
 *     but its mechanism and value still need clarification.
 *
 * It names the obstacle. It does not name a single act that removes it — and
 * *"its mechanism and value still need clarification"* points at the one act
 * that provably does NOT.
 *
 * ── THE ROUTE TABLE, MEASURED BY EXECUTION AT CEE staging `01f282d8` ────────
 * Six candidate repairs, run through `resolveRunAdmission` on the spec fixture
 * of captured request `248dc8e5` (the same request `causal-repair-preservation`
 * pins). `willProceed`:
 *
 *     A  baseline, option→risk edge present                       false
 *     B  set a strength/coefficient on the option→risk edge       FALSE  ← the guess
 *     C  remove the option→risk edge                              true
 *     D  add an intervention on the option keyed to the risk      false
 *     E  model it through a new factor, KEEPING the risk edge     FALSE  ← the careful user
 *     F  model it through a factor AND remove the risk edge       true
 *
 * B is what *"its mechanism and value still need clarification"* invites, and it
 * changes nothing: `buildAnalysisReadyPayload`'s qualitative branch filters on
 * the edge's EXISTENCE (`edge.from === option.id && to.kind === "risk"`), with
 * no strength, value or provenance term anywhere in the predicate. B is also
 * already pinned from the other side by `tests/unit/causal-repair-preservation.
 * test.ts:127` (*"a changed coefficient does not resolve the missing intervention
 * mapping"*) — that test is the specification, and this suite does not touch it.
 *
 * E is the sharpest: a user who does the modelling thing correctly, and keeps the
 * qualitative link because it is TRUE, is still blocked — and, before #1670, was
 * still told to *"choose which factor Two Developers changes"*, which they had
 * just done.
 *
 * ── WHAT THIS SUITE DOES, AND WHY IT IS NOT A COPY ASSERTION ───────────────
 * A test that spelled the new sentence would be a fourth hand-maintained copy of
 * it (trap 12), and would pass just as happily if the sentence became false. So
 * the binding here is to the MEASURED route instead:
 *
 *   · it EXECUTES arms B and C inside the suite, and
 *   · asserts the sentence's claim AGREES with what those arms returned.
 *
 * If someone later makes a strength on the link clear admission, this REDs and
 * says the copy is now wrong — which is the only direction that matters. The
 * expectation is derived from the producer's own behaviour, never from the
 * author's reading of it (trap 13c: a mutant kit validates sensitivity, never
 * the oracle).
 *
 * ⛔ ADMISSION IS NOT TOUCHED. Every verdict asserted below is the one measured
 * at pristine, and these assertions are GREEN before and after the change. A
 * diff that moved `willProceed` for any arm REDs here.
 *
 * ── BINDING ────────────────────────────────────────────────────────────────
 * The graph is the same committed real capture `mapping-need-survives-to-the-
 * wire.test.ts` reads, unmodified on disk (trap 14b). Options are named BY ID
 * (trap 19). The risk label is READ from the capture, never typed here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { assessCanonicalAnalysisReadiness } from "../../../orchestrator/tools/analysis-ready-helper.js";
import { resolveRunAdmission } from "../../../orchestrator-v5/tools/handlers/analysis-ready-core.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

const CAPTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/held-baseline-journey-2026-09-18.json", import.meta.url),
    ),
    "utf-8",
  ),
) as { draft_graph: GraphV3T };

/** The captured option that genuinely carries two interventions. */
const TWO_INTERVENTION_ID = "3fb49c45";
/** The captured risk node the hypothesis points at. */
const RISK_ID = "150def25";

type RiskEdgeMode = "absent" | "present" | "present_with_strength";

/**
 * Build the arm. `strengthMean` is the ONLY difference between `present` and
 * `present_with_strength`, so the pair is a discriminating one: it isolates the
 * single field a user would reach for.
 */
function graphWithRiskEdge(mode: RiskEdgeMode): GraphV3T {
  if (mode === "absent") return CAPTURE.draft_graph;
  return {
    ...CAPTURE.draft_graph,
    edges: [
      ...CAPTURE.draft_graph.edges,
      {
        from: TWO_INTERVENTION_ID,
        to: RISK_ID,
        strength: { mean: mode === "present_with_strength" ? 0.15 : 0.42, std: 0.13 },
        exists_probability: 0.79,
        effect_direction: "positive",
        provenance: { source: "cee_hypothesis", reasoning: "Retained causal hypothesis" },
      },
    ],
  } as GraphV3T;
}

function mappingMessages(mode: RiskEdgeMode): string[] {
  return assessCanonicalAnalysisReadiness(graphWithRiskEdge(mode))
    .blockingIssues.filter(
      (issue) =>
        issue.option_id === TWO_INTERVENTION_ID && issue.code === "OPTION_NEEDS_MAPPING",
    )
    .map((issue) => issue.message);
}

function admits(mode: RiskEdgeMode): boolean {
  return resolveRunAdmission(graphWithRiskEdge(mode)).willProceed;
}

describe("a risk-blocked option names what would clear it", () => {
  // ── The preconditions this suite's copy claims REST ON ────────────────────
  // Asserted in-test rather than assumed, so the copy assertions below are
  // provably about the producer's behaviour and not about a fixture that has
  // quietly stopped reproducing the condition (trap 13b).

  it("PRECONDITION: the option→risk edge is what blocks, and its strength is not", () => {
    expect(mappingMessages("present").length).toBeGreaterThan(0);
    expect(mappingMessages("absent")).toHaveLength(0);
    // The discriminating half: a strength on the link changes NOTHING.
    expect(mappingMessages("present_with_strength").length).toBeGreaterThan(0);
  });

  it("PRECONDITION: admission agrees — removal clears, a strength does not", () => {
    expect(admits("present")).toBe(false);
    expect(admits("present_with_strength")).toBe(false);
    expect(admits("absent")).toBe(true);
  });

  // ── The gap #1670 leaves, stated as the user's question ───────────────────

  it("RED: the ask names removing the link as the act that clears it", () => {
    const text = mappingMessages("present").join(" ");
    // Derived from the arm measured directly above, not from a belief about it.
    expect(admits("absent")).toBe(true);
    expect(text.toLowerCase()).toContain("remove");
  });

  it("RED: the ask does not send the user to put a value on the link, which does not work", () => {
    const text = mappingMessages("present").join(" ");
    // The licence for this assertion, executed in the same run.
    expect(admits("present_with_strength")).toBe(false);
    // The shipped sentence's own words. `mechanism and value still need
    // clarification` is precisely an invitation to arm B.
    expect(text).not.toContain("its mechanism and value still need clarification");
  });

  it("RED: the ask tells the user what happens to the comparison, not only what is missing", () => {
    const text = mappingMessages("present").join(" ").toLowerCase();
    expect(text).toContain("compar");
  });

  // ── The guards that must stay GREEN through this change ───────────────────

  it("keeps naming the risk in the user's own label (no regression on #1670)", () => {
    const riskLabel =
      CAPTURE.draft_graph.nodes.find((node) => node.id === RISK_ID)?.label ?? "";
    expect(riskLabel).not.toBe("");
    expect(mappingMessages("present").join(" ")).toContain(riskLabel);
  });

  it("keeps naming the option, and never reverts to the factor-mapping ask", () => {
    const optionLabel =
      CAPTURE.draft_graph.nodes.find((node) => node.id === TWO_INTERVENTION_ID)?.label ?? "";
    expect(optionLabel).not.toBe("");
    const text = mappingMessages("present").join(" ");
    expect(text).toContain(optionLabel);
    expect(text).not.toContain("Choose which factor");
  });

  it("⛔ does not move admission for any arm — the copy may not become a gate", () => {
    // The three verdicts measured at pristine staging `01f282d8`, restated here
    // as a ratchet. Any diff that flips one has stopped being a copy change.
    expect({
      present: admits("present"),
      present_with_strength: admits("present_with_strength"),
      absent: admits("absent"),
    }).toEqual({ present: false, present_with_strength: false, absent: true });
  });

  it("⛔ does not change WHICH blockers are raised — only what they say", () => {
    const codes = (mode: RiskEdgeMode): string[] =>
      [
        ...new Set(
          assessCanonicalAnalysisReadiness(graphWithRiskEdge(mode)).blockingIssues.map(
            (issue) => issue.code,
          ),
        ),
      ].sort();
    // Measured at pristine: the risk edge adds exactly OPTION_NEEDS_MAPPING and
    // nothing else, and a strength on it changes no code.
    expect(codes("present")).toEqual(codes("present_with_strength"));
    const added = codes("present").filter((code) => !codes("absent").includes(code));
    expect(added).toEqual(["OPTION_NEEDS_MAPPING"]);
  });
});
