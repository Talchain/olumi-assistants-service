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

import { describe,expect,it } from "vitest";


import { assessBriefCompleteness } from "../../../orchestrator-v5/clarify-v2/rubric.js";










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












});
