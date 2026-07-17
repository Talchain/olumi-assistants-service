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
  composeClarifyV2Response,
  decideClarifyV2Round1,
  CLARIFY_V2_PROCEED_CHIP_ID,
} from "../../src/orchestrator-v5/clarify-v2/preflight.js";

const THIN_BRIEF = "Should we expand into the German market?";

function composeForThinBrief() {
  const d = decideClarifyV2Round1(THIN_BRIEF);
  if (d.kind !== "ask") throw new Error("fixture: thin brief must ask");
  return composeClarifyV2Response(d.questions, d.phase);
}

describe("clarify_v2 — #464 egress guard coverage (by construction)", () => {
  it("POSITIVE CONTROL: a candidate chip that replays the user's message verbatim is dropped at the chokepoint", () => {
    const response = composeForThinBrief();
    const firstChip = response.suggested_actions[0]!;
    // Simulate the degenerate turn: the user has ALREADY typed exactly
    // what the chip would re-submit. Clicking it would reproduce this
    // turn — the #464 dead-end loop shape.
    const sanitised = sanitiseOlumiResponseForEgress(response, {
      graph: null,
      requestId: "cv2-egress-pin",
      exitPath: "clarify_v2",
      userMessage: firstChip.message,
    });
    const ids = sanitised.suggested_actions.map((a) => a.id);
    expect(ids).not.toContain(firstChip.id);
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
    });
    expect(sanitised.suggested_actions.map((a) => a.id)).toEqual(
      response.suggested_actions.map((a) => a.id),
    );
  });
});
