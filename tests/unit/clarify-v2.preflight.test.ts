/**
 * Clarify v2 preflight decision core — round semantics, no-repeat, stop
 * rule, response composition (E0-B, ROADMAP 1.94 Option A replacement).
 *
 * RED-first on base (module absent). The mutation checks for these pins
 * (run in a throwaway worktree):
 *   - forcing the rubric to always return complete turns the fires-at-all
 *     pins RED (the retired never-asks baseline);
 *   - dropping `asked` from the resume filter turns the no-repeat pin RED;
 *   - removing the round budget turns the stop-rule pin RED.
 */
import { describe, it, expect } from "vitest";

import { OlumiResponseSchema } from "@talchain/schemas/boundary";

import {
  CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  CLARIFY_V2_MAX_ROUNDS,
  CLARIFY_V2_PROCEED_CHIP_ID,
  CLARIFY_V2_PROCEED_MESSAGE,
  CLARIFY_V2_PROCEED_PATTERN,
  composeClarifyV2Response,
  decideClarifyV2Resume,
  decideClarifyV2Round1,
  incorporateAnswerIntoBrief,
} from "../../src/orchestrator-v5/clarify-v2/preflight.js";
import { parsePendingAction } from "../../src/orchestrator-v5/session/pending-action.js";
import { DRAFT_GRAPH_MAX_BRIEF_LENGTH } from "../../src/schemas/assist.js";

const THIN_BRIEF = "Should we expand into the German market?";
const COMPLETE_BRIEF =
  "Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?";

describe("clarify_v2 round 1 (draft preflight)", () => {
  it("FIRES on a thin brief — asks up to the question budget (never-fires baseline is RED)", () => {
    const d = decideClarifyV2Round1(THIN_BRIEF);
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") return;
    expect(d.questions.length).toBeGreaterThanOrEqual(1);
    expect(d.questions.length).toBeLessThanOrEqual(CLARIFY_V2_MAX_QUESTIONS_PER_ROUND);
    expect(d.state.round).toBe(1);
    expect(d.state.brief).toBe(THIN_BRIEF);
    // asked-history records exactly the asked dimensions — the REAL
    // history the retired plumbing never had (always-empty previous_answers).
    expect(d.state.asked).toEqual(d.questions.map((q) => q.dimension));
  });

  it("stays SILENT on a complete brief (no busywork)", () => {
    const d = decideClarifyV2Round1(COMPLETE_BRIEF);
    expect(d).toEqual({ kind: "proceed", brief: COMPLETE_BRIEF, reason: "complete" });
  });

  it("more than 3 missing dimensions still asks at most the budget", () => {
    const d = decideClarifyV2Round1(THIN_BRIEF);
    if (d.kind !== "ask") throw new Error("expected ask");
    expect(d.questions.length).toBe(CLARIFY_V2_MAX_QUESTIONS_PER_ROUND);
  });

  it("PRODUCER/READER: an over-length round-1 brief is capped at the WRITE so the pending's own reader accepts it (PR #490 review P1)", () => {
    // A thin decision question + a long pasted background (the probe that
    // proved the dead end live was 6,341 chars). Round 1 must persist a
    // working brief the `clarify_v2_round` parser will accept back —
    // otherwise the pending is dropped at the next turn's read, answers
    // are silently ignored and the escape chip is dead.
    const longBrief = `${THIN_BRIEF} ${"Background detail. ".repeat(320)}`.trim();
    expect(longBrief.length).toBeGreaterThan(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
    const d = decideClarifyV2Round1(longBrief);
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") return;
    expect(d.state.brief.length).toBeLessThanOrEqual(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
    expect(d.state.brief.startsWith(THIN_BRIEF)).toBe(true);
    // The REAL reader accepts the persisted shape (round-trip, not a mirror).
    const parsed = parsePendingAction({
      id: "cv2_turn-1",
      scenario_id: "scenario-1",
      chip_id: CLARIFY_V2_PROCEED_CHIP_ID,
      action: {
        kind: "clarify_v2_round",
        brief: d.state.brief,
        asked_dimensions: d.state.asked,
        round: d.state.round,
      },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: new Date(Date.now() + 60_000).toISOString(),
      emitted_at_iso: new Date(Date.now()).toISOString(),
    });
    expect(parsed).not.toBeNull();
    // And the round stays alive end-to-end: an answer incorporates, the
    // escape chip proceeds.
    const answered = decideClarifyV2Resume({
      state: d.state,
      message: "The goal is to increase revenue.",
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(answered.kind === "ask" || answered.kind === "proceed").toBe(true);
    const escaped = decideClarifyV2Resume({
      state: d.state,
      message: CLARIFY_V2_PROCEED_MESSAGE,
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(escaped).toEqual({ kind: "proceed", brief: d.state.brief, reason: "user_proceed" });
  });
});

describe("clarify_v2 resume — answers incorporate via the normal turn flow", () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== "ask") throw new Error("fixture: round 1 must ask");
  const state1 = round1.state;

  it("an answer that completes the brief proceeds to draft with the augmented brief", () => {
    // Answer all four dimensions in one typed message.
    const answer =
      "The goal is to increase revenue; the alternative is doing nothing; the stakes are around £200,000; it plays out within this year.";
    const d = decideClarifyV2Resume({
      state: state1,
      message: answer,
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(d.kind).toBe("proceed");
    if (d.kind !== "proceed") return;
    expect(d.reason).toBe("complete");
    expect(d.brief).toContain(THIN_BRIEF);
    expect(d.brief).toContain("increase revenue");
  });

  it("NO-REPEAT: a partially-answering reply never re-asks an already-asked dimension", () => {
    // Round 1 asked goal/options/timeframe (3 of the 4 missing). Answer
    // only the goal — the still-missing options/timeframe were ALREADY
    // asked, so the stop rule proceeds with defaults rather than
    // re-asking them; quantities (never asked) is the only askable dim.
    const d = decideClarifyV2Resume({
      state: state1,
      message: "The goal is to increase revenue.",
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    if (d.kind === "ask") {
      // Any follow-up round may only ask never-asked dimensions.
      for (const q of d.questions) {
        expect(state1.asked).not.toContain(q.dimension);
      }
      // And the asked-history accumulates.
      for (const dim of state1.asked) {
        expect(d.state.asked).toContain(dim);
      }
    } else {
      expect(["all_missing_already_asked", "complete"]).toContain(d.reason);
    }
  });

  it("STOP RULE: when every still-missing dimension has been asked, proceed with defaults", () => {
    const stateAllAsked = {
      brief: THIN_BRIEF,
      asked: ["goal", "options", "timeframe", "quantities"] as const,
      round: 1,
    };
    const d = decideClarifyV2Resume({
      state: stateAllAsked,
      message: "The goal is to increase revenue.",
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(d.kind).toBe("proceed");
    if (d.kind !== "proceed") return;
    expect(d.reason).toBe("all_missing_already_asked");
  });

  it("STOP RULE: the round budget is a hard ceiling", () => {
    const stateAtBudget = {
      brief: THIN_BRIEF,
      asked: ["goal"] as const, // options/timeframe/quantities still askable
      round: CLARIFY_V2_MAX_ROUNDS,
    };
    const d = decideClarifyV2Resume({
      state: stateAtBudget,
      message: "The goal is to increase revenue.",
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(d.kind).toBe("proceed");
    if (d.kind !== "proceed") return;
    expect(d.reason).toBe("round_budget_exhausted");
  });

  it("STOP RULE: the default-forward chip message proceeds immediately", () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: CLARIFY_V2_PROCEED_MESSAGE,
      messageIsDraftShaped: false,
      explicitGenerate: false,
    });
    expect(d).toEqual({ kind: "proceed", brief: THIN_BRIEF, reason: "user_proceed" });
  });

  it.each(["yes", "OK", "go ahead", "just draft it", "use sensible defaults", "Proceed."])(
    "STOP RULE: typed go-ahead '%s' proceeds immediately",
    (msg) => {
      expect(CLARIFY_V2_PROCEED_PATTERN.test(msg)).toBe(true);
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerate: false,
      });
      expect(d.kind).toBe("proceed");
      if (d.kind !== "proceed") return;
      expect(d.reason).toBe("user_proceed");
    },
  );

  it("a real answer is NOT mis-claimed as a go-ahead", () => {
    expect(CLARIFY_V2_PROCEED_PATTERN.test("The goal is to increase revenue.")).toBe(false);
    expect(
      CLARIFY_V2_PROCEED_PATTERN.test("The main alternative is doing nothing and keeping things as they are."),
    ).toBe(false);
  });

  it("explicit-generate on a live round proceeds from the WORKING brief (canned chip text never becomes the brief)", () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: "Yes, build the model now please",
      messageIsDraftShaped: false,
      explicitGenerate: true,
    });
    expect(d).toEqual({ kind: "proceed", brief: THIN_BRIEF, reason: "explicit_generate" });
  });

  it("a draft-shaped reply REPLACES the working brief instead of appending", () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: COMPLETE_BRIEF,
      messageIsDraftShaped: true,
      explicitGenerate: false,
    });
    expect(d.kind).toBe("proceed");
    if (d.kind !== "proceed") return;
    expect(d.brief).toBe(COMPLETE_BRIEF);
  });

  it("incorporation caps the augmented brief at the draft pipeline max", () => {
    const long = "x".repeat(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
    const out = incorporateAnswerIntoBrief(long, "The goal is to increase revenue.");
    expect(out.length).toBeLessThanOrEqual(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  });

  it("incorporation PRESERVES the answer when the working brief is at the cap (the brief's tail makes room, never the answer)", () => {
    const long = "x".repeat(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
    const answer = "The goal is to increase revenue.";
    const out = incorporateAnswerIntoBrief(long, answer);
    expect(out.length).toBeLessThanOrEqual(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
    expect(out).toContain(answer);
  });
});

describe("clarify_v2 response composition (wire shape)", () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== "ask") throw new Error("fixture: round 1 must ask");
  const response = composeClarifyV2Response(round1.questions, round1.phase);

  it("parses the strict OlumiResponseSchema (contract floor: 100%)", () => {
    const parsed = OlumiResponseSchema.safeParse(response);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it("NO DEAD ENDS: carries every question's candidates AND the default-forward chip", () => {
    const chipIds = response.suggested_actions.map((a) => a.id);
    for (const q of round1.questions) {
      for (const c of q.candidates) expect(chipIds).toContain(c.id);
    }
    expect(chipIds).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    const proceedChip = response.suggested_actions.find((a) => a.id === CLARIFY_V2_PROCEED_CHIP_ID);
    expect(proceedChip?.message).toBe(CLARIFY_V2_PROCEED_MESSAGE);
  });

  it("chips are conversational (no action_type) so a tap re-enters normal routing", () => {
    for (const chip of response.suggested_actions) {
      expect(chip.action_type).toBeUndefined();
    }
  });

  it("prose names every question, its impact, and the escape hatch", () => {
    for (const q of round1.questions) {
      expect(response.assistant_text).toContain(q.text);
      expect(response.assistant_text).toContain(q.impact);
    }
    expect(response.assistant_text).toContain("go ahead");
    expect(response.stage_indicator).toBe("frame");
  });
});

// Review fix A10 (17 Jul) — the proceed PATTERN must cover the canned
// proceed MESSAGE exactly (the redundant exact-string check was removed as
// dead code; this pin keeps it dead rather than silently uncovered).
import {
  CLARIFY_V2_PROCEED_PATTERN as A10_PATTERN,
  CLARIFY_V2_PROCEED_MESSAGE as A10_MESSAGE,
} from '../../src/orchestrator-v5/clarify-v2/preflight.js';

describe('A10 — proceed pattern covers the canned proceed message', () => {
  it('CLARIFY_V2_PROCEED_PATTERN matches CLARIFY_V2_PROCEED_MESSAGE', () => {
    expect(A10_PATTERN.test(A10_MESSAGE)).toBe(true);
  });
});
