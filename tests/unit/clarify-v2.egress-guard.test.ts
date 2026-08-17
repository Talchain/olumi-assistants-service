/**
 * Clarify v2 — egress looping-chip guard coverage pin (E0-B).
 *
 * The brief's instruction: the universal single-candidate-identical
 * clarifier guard (#464, live at `sanitiseOlumiResponseForEgress`) must
 * cover clarify-v2 questions BY CONSTRUCTION — verify, don't
 * re-implement. This test IS that verification:
 *
 *   - POSITIVE CONTROL first (a test proving an absence must first prove
 *     it can see a presence): a clarify-v2 response whose candidate chip
 *     would re-submit the user's own message verbatim LOSES that chip at
 *     the chokepoint. If the guard ever stopped walking clarify-v2 chips,
 *     this turns RED before any "covered" claim goes vacuous.
 *   - The genuine composition keeps all its chips (no false positives:
 *     candidate answers are never the user's own brief).
 *
 * The route half of the construction — every clarify-v2 200 exits through
 * `sendFinalised200` (the sole sanctioned 200 site, enforced by
 * scripts/check-no-direct-analysis-ready.sh) with `userMessage` threaded —
 * is pinned by route-v2-clarify-v2.test.ts.
 */
import { describe, it, expect } from "vitest";

import { sanitiseOlumiResponseForEgress } from "../../src/orchestrator-v5/compose/output-safety.js";
import {
  CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  composeClarifyV2Response,
  CLARIFY_V2_PROCEED_CHIP_ID,
} from "../../src/orchestrator-v5/clarify-v2/preflight.js";
import { assessBriefCompleteness } from "../../src/orchestrator-v5/clarify-v2/rubric.js";
import { composeClarifyQuestions } from "../../src/orchestrator-v5/clarify-v2/questions.js";

const THIN_BRIEF = "Should we expand into the German market?";

// The clarify ask response is RESUME-ONLY since draft-first intake
// (2026-08-17): follow-up asks over LEGACY live rounds. The question set
// derives from the live rubric + composer, as the resume arm does.
function composeForThinBrief() {
  const questions = composeClarifyQuestions(
    assessBriefCompleteness(THIN_BRIEF).missing,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  if (questions.length === 0) throw new Error("fixture: thin brief must have gaps");
  return composeClarifyV2Response(questions, "follow_up");
}

describe("clarify_v2 — #464 egress guard coverage (by construction)", () => {
  it("POSITIVE CONTROL: a candidate chip that replays the user's message verbatim is dropped at the chokepoint", () => {
    const response = composeForThinBrief();
    // A CANDIDATE chip, selected by identity rather than by position.
    // Indexing [0] used to mean "a candidate" only incidentally, because
    // the escape hatch happened to be composed last; it is now composed
    // FIRST (so no consumer cap can evict it), and replaying ITS message
    // would exercise the escape hatch rather than the candidate this
    // positive control is about.
    const candidateChip = response.suggested_actions.find(
      (a) => a.id !== CLARIFY_V2_PROCEED_CHIP_ID,
    )!;
    expect(candidateChip, "fixture: the round must carry at least one candidate chip").toBeDefined();
    // Simulate the degenerate turn: the user has ALREADY typed exactly
    // what the chip would re-submit. Clicking it would reproduce this
    // turn — the #464 dead-end loop shape.
    const sanitised = sanitiseOlumiResponseForEgress(response, {
      graph: null,
      requestId: "cv2-egress-pin",
      exitPath: "clarify_v2",
      userMessage: candidateChip.message,
      mayNameLeadingOption: true,
    });
    const ids = sanitised.suggested_actions.map((a) => a.id);
    expect(ids).not.toContain(candidateChip.id);
    // Only the looping chip is dropped — the rest of the question surface
    // (including the default-forward escape) survives.
    expect(ids).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(sanitised.suggested_actions.length).toBe(response.suggested_actions.length - 1);
  });

  it("the genuine composition keeps every chip (candidates are never the user's brief)", () => {
    const response = composeForThinBrief();
    const sanitised = sanitiseOlumiResponseForEgress(response, {
      graph: null,
      requestId: "cv2-egress-pin",
      exitPath: "clarify_v2",
      userMessage: THIN_BRIEF,
      mayNameLeadingOption: true,
    });
    expect(sanitised.suggested_actions.map((a) => a.id)).toEqual(
      response.suggested_actions.map((a) => a.id),
    );
  });
});
