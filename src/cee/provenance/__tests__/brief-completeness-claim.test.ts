/**
 * ROADMAP 2.972(c) — THE PRODUCT MUST NOT TELL A USER THEIR BRIEF WAS LIGHT ON
 * DETAIL WHEN THEIR BRIEF CONTAINS DETAIL.
 *
 * MEASURED on deployed staging 2026-08-08 (CEE `4b57b8f`): the draft response
 * for brief B3 — 2,563 characters, ~14 quantitative atoms, the densest of the
 * three briefs driven that day — opened with
 *
 *     "Your brief was light on detail, so adding specifics will make the
 *      comparison more reliable."
 *
 * The sentence is selected by `widening_log.brief_completeness`, an
 * LLM-AUTHORED enum. Nothing derived it, nothing could refute it, and it
 * shipped as a confident statement about the user's own input.
 *
 * Same doctrine as the rest of the row with the sign flipped: where a claim
 * about what the user did or did not say cannot be established, the honest
 * output is the weaker claim — here, silence.
 */

import { describe, it, expect } from "vitest";

import { buildPostDraftNarrative } from "../../../orchestrator-v5/coaching/post-draft-narrative.js";
import { assessBriefCompleteness } from "../../../orchestrator-v5/clarify-v2/rubric.js";
import { BRIEF_TEXT_AS_PERSISTED } from "./fixtures/trace-captures.js";

const GRAPH = {
  nodes: [
    { id: "goal", kind: "goal", label: "15% ARR growth without worse attrition" },
    { id: "opt_copilot", kind: "option", label: "Build the AI copilot" },
    { id: "opt_rewrite", kind: "option", label: "Do the platform rewrite" },
    { id: "fac_eng_capacity", kind: "factor", label: "Engineering capacity" },
    { id: "fac_llm_cost", kind: "factor", label: "LLM serving cost" },
  ],
} as any;

function narrate(briefText: string | null, completeness: "thin" | "partial" | "complete") {
  return buildPostDraftNarrative({
    graph: GRAPH,
    wideningLog: { brief_completeness: completeness } as any,
    briefText,
  });
}

const THIN_SENTENCE = "Your brief was light on detail";
const PARTIAL_SENTENCE = "Your brief covered the main points";

describe("2.972(c) the brief-completeness advisory", () => {
  it("withholds \"light on detail\" for B3, the brief it was measured making that claim about", () => {
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "thin");
    expect(result.text).not.toContain(THIN_SENTENCE);
    expect(result.telemetry.brief_completeness).toBe("thin"); // the enum is still reported honestly
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });

  it("withholds it for B1 and B2 too — every brief of the trace states amounts", () => {
    for (const brief of ["B1", "B2"] as const) {
      const result = narrate(BRIEF_TEXT_AS_PERSISTED[brief], "thin");
      expect(result.text, `${brief} still told its author the brief was light on detail`).not.toContain(
        THIN_SENTENCE,
      );
    }
  });

  it("KEEPS it when the brief genuinely states nothing quantitative (the discriminating positive)", () => {
    // Without this case the guard could pass by suppressing the advisory
    // unconditionally, which is a different behaviour and would delete a
    // legitimate nudge.
    const result = narrate("Should we go into Germany or push harder in the UK? Not sure.", "thin");
    expect(result.text).toContain(THIN_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
  });

  it("KEEPS it when no brief text is available (behaviour is unchanged where evidence is absent)", () => {
    const result = narrate(null, "thin");
    expect(result.text).toContain(THIN_SENTENCE);
  });

  it("no longer spares the `partial` rung for B3 — its stated precondition was falsified on 2026-08-13", () => {
    // ⚠ THIS PIN ASSERTED THE OPPOSITE UNTIL 2026-08-13, AND ITS REASONING IS
    // KEPT HERE RATHER THAN DELETED, BECAUSE THE REASONING WAS SOUND AND THE
    // PRECONDITION IS WHAT CHANGED. It read:
    //
    //     "leaves the `partial` rung alone — it makes no negative claim and
    //      nothing measured it false"
    //
    // Two conditions were offered for sparing `partial`. The second one has
    // now failed: see the `2.972(d)` block below for the witness. The first
    // one — "makes no negative claim" — was never the governing rule. The rule
    // is that the product may describe what IT did and may not tell the user
    // what THEY said, and a false COMPLIMENT breaches it exactly as a false
    // criticism does.
    //
    // This is NOT the trap-21 error the original comment guarded against. That
    // trap warns against ALIGNING two predicates that answer DIFFERENT
    // questions. These two arms answer the SAME question — "what was in the
    // user's brief?" — from the SAME underived enum. They were always one
    // question wearing two signs.
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "partial");
    expect(result.text).not.toContain(PARTIAL_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });

  it("leaves `complete` alone — it surfaced nothing before and surfaces nothing now", () => {
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "complete");
    expect(result.text).not.toContain(THIN_SENTENCE);
    expect(result.text).not.toContain(PARTIAL_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });
});

/**
 * ROADMAP 2.972(d) — THE COMPLIMENT IS THE SAME DEFECT AS THE CRITICISM.
 *
 * WITNESSED verbatim on deployed staging 2026-08-13 (UI `5deee0cf` / CEE
 * `219490e`, `WITNESS-20260813-EVENING.md`, scenario `e17089bf`). For the
 * 52-character brief below, the product asked THREE clarifying questions —
 * it had no goal, no options and no timeframe — and then, in the same
 * exchange, told its author:
 *
 *     "Your brief covered the main points; adding detail on the lighter
 *      areas would sharpen the comparison."
 *
 * TWO AUTHORITIES, ONE QUESTION, OPPOSITE ANSWERS, SAME SCREEN. The
 * disagreement is DERIVED, not argued — `assessBriefCompleteness` is a pure
 * function over the brief text and it is pinned below returning
 * `complete: false, missing: [goal, options, timeframe]` for this exact
 * string, while `widening_log.brief_completeness` — an LLM-authored enum
 * that nothing derives and nothing can refute — returned `partial`.
 *
 * A user who reads both concludes we are not paying attention, which is
 * worse than either sentence alone.
 *
 * WHY SUPPRESSION AND NOT A GATE. A gate could only make the sentence less
 * OFTEN false; it could not make it TRUE. The rubric tests four named
 * dimensions, and "covered the main points" is unbounded — a rubric that
 * finds nothing missing does not establish that a brief covered the main
 * points, it establishes that four detectors fired (traps 13e / 22: a narrow
 * probe cannot support a broad claim). Under the governing rule the sentence
 * is prohibited by its SUBJECT, not by its accuracy.
 *
 * WHY SUPPRESSION AND NOT A REPHRASE. This estate has already settled the
 * choice, and the two precedents point opposite ways for principled reasons.
 * `preflight.ts`'s draft-first disclosure was REPHRASED onto ourselves
 * because "disclosure is its whole job" — it must say something. This
 * advisory must not: it is the block `assembleSectionedNarrative` sheds at
 * rung 3, ahead of everything except the options list, so the module's own
 * priority ladder already ranks it the least load-bearing content in the
 * message. Withholding it costs the user nothing the builder itself treats
 * as load-bearing, and 2.972(c) is the matching precedent — silence where
 * the claim cannot be established.
 *
 * The honest, DERIVED version of this message already exists and is already
 * shipping: `composeDraftFirstDisclosure` names the exact dimension we
 * guessed ("I've assumed the goal in this draft, and I haven't confirmed it
 * with you"). The advisory was a second, underived authority answering the
 * same question — and losing it removes a contradiction rather than a
 * capability.
 */
describe("2.972(d) the `partial` compliment — a claim about the user's brief", () => {
  /** The witnessed brief, verbatim, 52 characters. */
  const WITNESSED_THIN_BRIEF = "Should we move the whole company to a four-day week?";

  /**
   * CONTRAST CONTROL for the precondition pin below. A brief the rubric scores
   * COMPLETE, proving the rubric discriminates rather than returning a constant
   * — without it, the precondition assertions could pass on a rubric that had
   * silently stopped working (trap 13b: a discriminator must pin its own
   * precondition; trap 13e: an absence needs a contrast whose answer differs).
   */
  const RUBRIC_COMPLETE_BRIEF =
    "We must decide by Q3 whether to launch our own free tier, hold the line and invest in enterprise sales, or reposition upmarket. Our goal is to grow ARR 15% without worse attrition. Current ARR is 4.2m and churn is 8%.";

  it("the product's own rubric contradicts the compliment on the witnessed brief (precondition, pinned in-test)", () => {
    const assessed = assessBriefCompleteness(WITNESSED_THIN_BRIEF);
    expect(WITNESSED_THIN_BRIEF.length).toBe(52);
    expect(assessed.complete).toBe(false);
    expect([...assessed.missing].sort()).toEqual(["goal", "options", "timeframe"]);

    // Contrast control — the same function, a different answer.
    expect(assessBriefCompleteness(RUBRIC_COMPLETE_BRIEF).complete).toBe(true);
  });

  it("does not tell a 52-character brief it covered the main points (the witnessed case)", () => {
    const result = narrate(WITNESSED_THIN_BRIEF, "partial");
    expect(
      result.text,
      "the witnessed brief was complimented while the product's own rubric called it incomplete",
    ).not.toContain(PARTIAL_SENTENCE);
    expect(result.text).not.toContain("lighter areas");
  });

  it("withholds the compliment for a RICH brief too — the rule is about the subject, not the accuracy", () => {
    // OPPOSITE-DIRECTION TWIN (trap 22b). Without this case the defect could be
    // "fixed" by gating the compliment on brief length or on the rubric, which
    // would leave an underived claim about the user's words shipping on every
    // brief that happened to clear the gate — the same lie, less often.
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "partial");
    expect(result.text).not.toContain(PARTIAL_SENTENCE);
  });

  it("withholds it when no brief text is available at all", () => {
    // The `thin` arm deliberately KEEPS its advisory when evidence is absent
    // (see the block above) because suppression there needs a refutation. This
    // arm is different: there is no evidence that could establish it, so
    // absence of brief text changes nothing.
    const result = narrate(null, "partial");
    expect(result.text).not.toContain(PARTIAL_SENTENCE);
  });

  it("still reports the enum honestly to ops — the signal is kept, only the claim is withheld", () => {
    const result = narrate(WITNESSED_THIN_BRIEF, "partial");
    expect(result.telemetry.brief_completeness).toBe("partial");
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });

  it("leaves the rest of the narrative intact — this suppresses a sentence, not the message", () => {
    // Guards the failure mode where "withhold the advisory" degrades into
    // "return an empty or truncated narrative".
    const result = narrate(WITNESSED_THIN_BRIEF, "partial");
    expect(result.text).toContain("I've built a first decision model");
    expect(result.text).toContain("Next, run the analysis");
    expect(result.text.trim().length).toBeGreaterThan(80);
  });

  it("does not disturb the `thin` arm's measured discriminating positive (regression floor)", () => {
    // 2.972(c) paid for this case with a live measurement. A change to the
    // `partial` arm that also silenced `thin` would delete a legitimate nudge.
    const result = narrate("Should we go into Germany or push harder in the UK? Not sure.", "thin");
    expect(result.text).toContain(THIN_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
  });
});
