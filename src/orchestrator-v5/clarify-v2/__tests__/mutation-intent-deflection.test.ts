/**
 * INV-M (ROADMAP 2.716) — a live clarify round must not eat graph-mutation
 * language.
 *
 * MECHANISM (capture-semantics-derivation-2026-08-08.md §3.1): the defect is
 * an ABSENT branch, not a wrong predicate. Eight anchored `^…$` guards decline
 * the message and the ninth position is the ladder's raw-concatenation
 * fallthrough — so `"Change the price to 90,000"` becomes part of the working
 * brief verbatim and the whole model is redrafted from the run-on string.
 * All eight commands below were MEASURED to fold at `8c316b5e`.
 *
 * ⚠ PREMISE CORRECTION, measured at this tip and required to reach 8/8: the
 * derivation's §3.2 table itself records row 4 ("Actually, make HubSpot's
 * licence cost 90,000 instead") as `edit-lane: no`, yet its §5.2 asks for all
 * eight. Re-measured here against the real modules: `EDIT_GRAPH_POSITIVE_REGEX`
 * misses it (no listed edit verb) and so does `isValueUpdatePhrasing`. The
 * estate-wide widening is deliberately out of scope (§6 R1 — it changes edit
 * dispatch everywhere and needs its own precision controls), so this seam
 * carries one narrow LOCAL correction pattern, pinned by the negative corpus
 * below.
 */

import { describe, it, expect } from "vitest";

import {
  decideClarifyV2Round1,
  decideClarifyV2Resume,
  incorporateAnswerIntoBrief,
  composeClarifyV2ReofferResponse,
  isGraphMutationCommand,
  type ClarifyV2RoundState,
} from "../preflight.js";
import { isDraftShapedText } from "../../../schemas/assist.js";

/**
 * FIXTURE HONESTY (§5.0): the round state is built by calling the PRODUCER,
 * never written as an object literal — the shape is the producer's contract.
 */
function liveRoundState(brief: string): ClarifyV2RoundState {
  const round1 = decideClarifyV2Round1(brief);
  if (round1.kind !== "ask") {
    throw new Error(
      `fixture precondition failed: round 1 did not ASK for this brief (kind=${round1.kind})`,
    );
  }
  return round1.state;
}

const THIN_BRIEF =
  "We are choosing a CRM for the sales team and need to pick one this quarter.";

function resume(message: string, state?: ClarifyV2RoundState) {
  return decideClarifyV2Resume({
    state: state ?? liveRoundState(THIN_BRIEF),
    message,
    messageIsDraftShaped: isDraftShapedText(message),
    explicitGenerateBrief: null,
  });
}

/** capture-semantics-derivation-2026-08-08.md §3.2 — the 8 that folded. */
const MUTATION_COMMANDS: readonly string[] = [
  "Change the price to 90,000",
  "Change the CRM licence cost to £90,000",
  "Set the migration cost to 40000",
  "Actually, make HubSpot's licence cost 90,000 instead",
  "Add a factor for training time",
  "Remove the Salesforce option",
  "Increase the churn estimate to 12%",
  "change X to Y",
];

/** Genuine answers to a clarify question. These MUST still fold. */
const GENUINE_ANSWERS: readonly string[] = [
  "About 90,000 a year",
  "Roughly £2m over three years",
  "Probably around twelve percent, based on last year",
  "The main constraint is the finance team's capacity",
  "We want to make the right call for the sales team",
  "Around 8 engineers, and the budget is £400,000",
];

describe("INV-M — mutation intent during a live clarify round is never folded", () => {
  describe("B6 — positive control: the harness CAN observe a fold", () => {
    it("a genuine answer folds and the brief GROWS by exactly the answer", () => {
      const state = liveRoundState(THIN_BRIEF);
      const decision = resume("About 90,000 a year", state);
      expect(decision.kind === "ask" || decision.kind === "proceed").toBe(true);
      const brief =
        decision.kind === "ask" ? decision.state.brief : (decision as { brief: string }).brief;
      expect(brief).toBe(incorporateAnswerIntoBrief(state.brief, "About 90,000 a year"));
      expect(brief).toContain("90,000");
    });
  });

  describe("B1 — all eight measured mutation commands deflect, brief byte-unchanged", () => {
    it.each(MUTATION_COMMANDS)("deflects: %s", (message) => {
      const state = liveRoundState(THIN_BRIEF);
      const decision = resume(message, state);
      expect(decision.kind).toBe("reoffer");
      if (decision.kind !== "reoffer") return;
      expect(decision.cue).toBe("mutation_intent");
      // The brief IS the damage — assert it, not just the kind.
      expect(decision.state.brief).toBe(state.brief);
      expect(decision.state.brief).not.toContain(message);
    });

    it("covers exactly the eight measured strings (no silent shrink)", () => {
      expect(MUTATION_COMMANDS).toHaveLength(8);
      expect(new Set(MUTATION_COMMANDS).size).toBe(8);
    });
  });

  describe("B2 — negative control: genuine answers still fold", () => {
    it.each(GENUINE_ANSWERS)("folds: %s", (message) => {
      const state = liveRoundState(THIN_BRIEF);
      const decision = resume(message, state);
      expect(decision.kind).not.toBe("reoffer");
      expect(decision.kind).not.toBe("decline");
      const brief =
        decision.kind === "ask" ? decision.state.brief : (decision as { brief: string }).brief;
      expect(brief).toBe(incorporateAnswerIntoBrief(state.brief, message));
    });
  });

  describe("B3 — ordering: a standalone draft-shaped restatement still REPLACES", () => {
    it("a new brief carrying an edit verb replaces rather than deflecting", () => {
      const message =
        "Should we expand into Germany or add a second warehouse in Poland instead?";
      // Precondition, pinned in-test: this message WOULD trip the mutation
      // predicate on its own, so the assertion below is about ORDERING and
      // cannot pass by the predicate quietly failing to match.
      expect(isGraphMutationCommand(message)).toBe(true);
      const decision = resume(message);
      expect(decision.kind).not.toBe("reoffer");
      const brief =
        decision.kind === "ask" ? decision.state.brief : (decision as { brief: string }).brief;
      expect(brief).toBe(message);
    });
  });

  describe("B4 — exactly one re-offer per round, then decline", () => {
    it("a second mutation-intent message declines", () => {
      const state = liveRoundState(THIN_BRIEF);
      const first = resume("Change the price to 90,000", state);
      expect(first.kind).toBe("reoffer");
      if (first.kind !== "reoffer") return;
      expect(first.state.reoffered).toBe(true);

      const second = resume("Remove the Salesforce option", first.state);
      expect(second.kind).toBe("decline");
      if (second.kind !== "decline") return;
      expect(second.cue).toBe("mutation_intent");
      expect(second.brief).toBe(state.brief);
    });
  });

  describe("B7 — the deflection DISCLOSES, and the copy is cue-specific", () => {
    it("names the ambiguity and offers both ways forward", () => {
      const response = composeClarifyV2ReofferResponse("mutation_intent");
      const text = String(response.assistant_text);
      expect(text).toContain("change to the model");
      expect(text).toContain("have not built");
      // Distinguishable from the other cues — a shared string would make the
      // disclosure untraceable in a transcript.
      expect(text).not.toBe(
        String(composeClarifyV2ReofferResponse("question_reply").assistant_text),
      );
      expect(text).not.toBe(
        String(composeClarifyV2ReofferResponse("bare_ack").assistant_text),
      );
      expect(response.suggested_actions.length).toBeGreaterThan(0);
    });
  });

  describe("B8 — the predicate itself, bound to its corpus", () => {
    it.each(MUTATION_COMMANDS)("recognises: %s", (m) => {
      expect(isGraphMutationCommand(m)).toBe(true);
    });
    it.each(GENUINE_ANSWERS)("does not recognise: %s", (m) => {
      expect(isGraphMutationCommand(m)).toBe(false);
    });
    it("the negative guard is live — a meta-question carrying an edit verb is not a command", () => {
      expect(isGraphMutationCommand("Can you explain why you added that factor?")).toBe(false);
      expect(isGraphMutationCommand("Compare the two options and tell me what to change")).toBe(false);
    });
  });

  describe("B9 — anti-vacuity: the guard depends on a LIVE round, and says so", () => {
    it("the fixture precondition is pinned in-test — a rotted state throws, "
      + "it does not silently pass", () => {
      // A brief the rubric finds COMPLETE never opens a round, so the
      // producer returns `proceed` and the fixture builder must refuse it.
      expect(() =>
        liveRoundState(
          "Should we migrate the CRM to HubSpot at £90,000 a year, or stay on "
            + "Salesforce at £120,000, so that sales cycle time drops below 30 days "
            + "by Q4? The options are HubSpot and Salesforce.",
        ),
      ).toThrowError(/fixture precondition failed|round 1 did not ASK/);
    });
  });
});
