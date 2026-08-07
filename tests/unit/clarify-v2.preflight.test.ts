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
  CLARIFY_V2_HEDGED_PROCEED_PATTERN,
  CLARIFY_V2_CANDIDATE_CHIP_BUDGET,
  CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  CLARIFY_V2_MAX_ROUNDS,
  CLARIFY_V2_PROCEED_CHIP_ID,
  CLARIFY_V2_PROCEED_MESSAGE,
  CLARIFY_V2_PROCEED_PATTERN,
  composeClarifyV2ReofferResponse,
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
      explicitGenerateBrief: null,
    });
    expect(answered.kind === "ask" || answered.kind === "proceed").toBe(true);
    const escaped = decideClarifyV2Resume({
      state: d.state,
      message: CLARIFY_V2_PROCEED_MESSAGE,
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(escaped).toEqual({ kind: "proceed", brief: d.state.brief, reason: "user_proceed" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// a1/first-message-drafts (19 Jul journey probe) — round 1 RESPECTS an
// explicit generate instruction. RED-first: on base decideClarifyV2Round1
// ignores the second argument and runs the rubric, so the probe brief asks
// goal (+ timeframe pre-rubric-fix) instead of proceeding. Mutation-check:
// reverting the isExplicitGenerate branch turns every pin below RED.
// ─────────────────────────────────────────────────────────────────────────
describe("clarify_v2 round 1 — explicit generate is respected (first-message-drafts)", () => {
  const PROBE_BRIEF =
    "Should we hire a senior engineer now or wait until after our next funding round? Budget around £120k, current runway 14 months.";

  it("the journey probe brief + explicit generate PROCEEDS on turn 1 (reason explicit_generate), never asks", () => {
    const d = decideClarifyV2Round1(PROBE_BRIEF, true);
    expect(d).toEqual({
      kind: "proceed",
      brief: PROBE_BRIEF,
      reason: "explicit_generate",
    });
  });

  it("explicit generate is respected even on a GENUINELY THIN brief (clarifying over Generate is a dead-end class)", () => {
    const d = decideClarifyV2Round1(THIN_BRIEF, true);
    expect(d).toEqual({ kind: "proceed", brief: THIN_BRIEF, reason: "explicit_generate" });
  });

  it("NOT lobotomised: the SAME thin brief with NO generate flag still asks (clarify still fires when the user did not press Generate)", () => {
    const d = decideClarifyV2Round1(THIN_BRIEF);
    expect(d.kind).toBe("ask");
    // The default second argument is 'not a generate turn' — behaviour is
    // bit-identical to the single-arg call the rest of the suite uses.
    expect(decideClarifyV2Round1(THIN_BRIEF, false).kind).toBe("ask");
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
      explicitGenerateBrief: null,
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
      explicitGenerateBrief: null,
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
      expect(d.kind).toBe("proceed");
      if (d.kind !== "proceed") return;
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
      explicitGenerateBrief: null,
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
      explicitGenerateBrief: null,
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
      explicitGenerateBrief: null,
    });
    expect(d).toEqual({ kind: "proceed", brief: THIN_BRIEF, reason: "user_proceed" });
  });

  it.each(["yes", "go ahead", "just draft it", "use sensible defaults", "Proceed."])(
    "STOP RULE: typed go-ahead '%s' proceeds immediately",
    (msg) => {
      expect(CLARIFY_V2_PROCEED_PATTERN.test(msg)).toBe(true);
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
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
      explicitGenerateBrief: THIN_BRIEF,
    });
    expect(d).toEqual({ kind: "proceed", brief: THIN_BRIEF, reason: "explicit_generate" });
  });

  it("a draft-shaped reply REPLACES the working brief instead of appending", () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: COMPLETE_BRIEF,
      messageIsDraftShaped: true,
      explicitGenerateBrief: null,
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

  /**
   * NARROWED 20 Jul (defect B). This pin used to assert that EVERY
   * question's every candidate reached the wire — the 16 Jul clarify
   * doctrine invariant. That is unsatisfiable under D-K ("0–3 chips",
   * 15 Jul): the fixture round alone produces 10 candidate chips and the
   * UI renders three, so "every candidate is tap-able" was never true in
   * the product — it was only true in this test, which asserted the
   * emitted array and not what the user can reach.
   *
   * What survives, and is now pinned harder (see the chip-cap describe
   * below): the escape hatch is ALWAYS reachable, every ASKED question is
   * represented among the surviving candidate chips, and no question is a
   * dead end because the prose names all of them and free-typed answers
   * always route.
   */
  it("NO DEAD ENDS: every asked question is represented, and the default-forward chip is present", () => {
    const chipIds = response.suggested_actions.map((a) => a.id);
    const representedQuestions = round1.questions.filter((q) =>
      q.candidates.some((c) => chipIds.includes(c.id)),
    );
    // Under the cap, "represented" is per-question, not per-candidate.
    expect(representedQuestions.length).toBe(
      Math.min(round1.questions.length, CLARIFY_V2_CANDIDATE_CHIP_BUDGET),
    );
    // Every emitted candidate chip is a REAL candidate of an asked question
    // (no fabricated ids reach the wire).
    const everyCandidateId = round1.questions.flatMap((q) => q.candidates.map((c) => c.id));
    for (const id of chipIds) {
      if (id === CLARIFY_V2_PROCEED_CHIP_ID) continue;
      expect(everyCandidateId).toContain(id);
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

// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 1.152 — design-bearing review fixes (17 Jul record), RED-first.
// ─────────────────────────────────────────────────────────────────────────

describe('1.152 A1 — decline releases the round honestly', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it.each(['not now', 'Hold off', "I don't want to answer these questions", 'stop', 'cancel', 'later', 'wait', 'No, not right now thanks'])(
    "decline cue '%s' → DECLINE (round released, brief kept), never a forced draft",
    (msg) => {
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      expect(d.kind).toBe('decline');
      if (d.kind !== 'decline') return;
      expect(d.cue).toBe('decline');
      // The working brief is KEPT for a later resume.
      expect(d.brief).toBe(THIN_BRIEF);
    },
  );

  it('a decline-word inside a real ANSWER is not mis-claimed (anchored cues)', () => {
    // 'wait' inside a timeframe answer; 'stop' inside a goal answer.
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'We should wait until Q3 before committing the budget.',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d.kind === 'ask' || d.kind === 'proceed').toBe(true);
  });

  it("a statement of preference about the DECISION ('I don't want to expand into Germany') is an answer, not a decline", () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: "I don't want to expand into Germany",
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d.kind === 'ask' || d.kind === 'proceed').toBe(true);
  });
});

describe('1.152 A1 — not-an-answer guard (question-shaped replies never fold in)', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it('a question back to the assistant → RE-OFFER (not folded into the brief)', () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'What do you mean by timeframe?',
      messageIsDraftShaped: true, // ≥30 chars + trailing '?' satisfies the route regex
      explicitGenerateBrief: null,
    });
    expect(d.kind).toBe('reoffer');
    if (d.kind !== 'reoffer') return;
    expect(d.cue).toBe('question_reply');
    // Brief untouched; round/asked untouched; reoffer marked.
    expect(d.state.brief).toBe(THIN_BRIEF);
    expect(d.state.round).toBe(state1.round);
    expect(d.state.asked).toEqual(state1.asked);
    expect(d.state.reoffered).toBe(true);
  });

  it('a SECOND question-shaped reply in the same round → DECLINE (re-offer once per round)', () => {
    const d = decideClarifyV2Resume({
      state: { ...state1, reoffered: true },
      message: 'Why do you need to know that?',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d.kind).toBe('decline');
    if (d.kind !== 'decline') return;
    expect(d.cue).toBe('question_reply');
    expect(d.brief).toBe(THIN_BRIEF);
  });

  it('doctrine preserved: a brief-shaped NON-answer statement still folds in and proceeds via the stop rules', () => {
    // Not a question, not a decline, not draft-shaped: appends, and the
    // assessment machinery (complete / all-asked / budget) decides.
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'The board meets soon and morale is low.',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d.kind === 'ask' || d.kind === 'proceed').toBe(true);
    const brief = d.kind === 'ask' ? d.state.brief : d.kind === 'proceed' ? d.brief : '';
    expect(brief).toContain('morale is low');
  });
});

describe('1.152 A2 — wholesale replacement needs a genuinely standalone restatement', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it("the 33-char 'whether' fragment APPENDS (the review's canonical probe) — the working brief survives", () => {
    const fragment = 'It depends on whether Sam accepts.'; // 34 chars, 'whether' → route-draft-shaped
    expect(fragment.length).toBeLessThan(60);
    const d = decideClarifyV2Resume({
      state: state1,
      message: fragment,
      messageIsDraftShaped: true,
      explicitGenerateBrief: null,
    });
    const brief = d.kind === 'ask' ? d.state.brief : d.kind === 'proceed' ? d.brief : '';
    expect(brief).toContain(THIN_BRIEF); // NOT wholesale-discarded
    expect(brief).toContain('whether Sam accepts');
  });

  it('a ≥60-char standalone draft-shaped restatement REPLACES', () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: COMPLETE_BRIEF,
      messageIsDraftShaped: true,
      explicitGenerateBrief: null,
    });
    expect(d.kind).toBe('proceed');
    if (d.kind !== 'proceed') return;
    expect(d.brief).toBe(COMPLETE_BRIEF);
  });

  it('a short standalone decision QUESTION restatement also replaces', () => {
    const restatement = 'Should we focus on France instead?'; // <60 but a standalone decision question
    const d = decideClarifyV2Resume({
      state: state1,
      message: restatement,
      messageIsDraftShaped: true,
      explicitGenerateBrief: null,
    });
    const brief = d.kind === 'ask' ? d.state.brief : d.kind === 'proceed' ? d.brief : '';
    expect(brief).toContain('France');
    expect(brief).not.toContain('German');
  });

  it('a meta-question that happens to clear the route regex NEVER replaces (precision bias protects the destructive action)', () => {
    const meta = 'Should I answer all of the questions you listed?';
    const d = decideClarifyV2Resume({
      state: state1,
      message: meta,
      messageIsDraftShaped: true,
      explicitGenerateBrief: null,
    });
    expect(d.kind).toBe('reoffer');
  });
});

describe('1.152 A3 — explicit-generate brief is incorporated, not discarded', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it('an assembled brief that is a SUBSET of the working brief adds nothing (no duplication)', () => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'Yes, build the model now please',
      messageIsDraftShaped: false,
      explicitGenerateBrief: THIN_BRIEF, // e.g. persisted brief == round-1 seed
    });
    expect(d).toEqual({ kind: 'proceed', brief: THIN_BRIEF, reason: 'explicit_generate' });
  });

  it('an assembled brief that is a SUPERSET restatement wins outright', () => {
    const superset = `${THIN_BRIEF} The stakes are around £2m and it must land this year.`;
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'Yes, build the model now please',
      messageIsDraftShaped: false,
      explicitGenerateBrief: superset,
    });
    expect(d.kind).toBe('proceed');
    if (d.kind !== 'proceed') return;
    expect(d.brief).toBe(superset);
  });

  it('genuinely NEW assembled content merges into the working brief (C2 append convention, capped)', () => {
    const extra = 'Our runway is about £500,000 and hiring freezes start next quarter.';
    const d = decideClarifyV2Resume({
      state: state1,
      message: 'Yes, build the model now please',
      messageIsDraftShaped: false,
      explicitGenerateBrief: extra,
    });
    expect(d.kind).toBe('proceed');
    if (d.kind !== 'proceed') return;
    expect(d.reason).toBe('explicit_generate');
    expect(d.brief).toContain(THIN_BRIEF);
    expect(d.brief).toContain('£500,000');
    expect(d.brief.length).toBeLessThanOrEqual(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  });
});

describe('1.152 A4 — bare single-word acks are calibrated, not auto-proceeds', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it.each(['ok', 'OK.', 'sure', 'fine'])(
    "bare ack '%s' while questions are pending → RE-OFFER of the default-forward choice",
    (msg) => {
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      expect(d.kind).toBe('reoffer');
      if (d.kind !== 'reoffer') return;
      expect(d.cue).toBe('bare_ack');
      expect(d.state.reoffered).toBe(true);
    },
  );

  it("after the re-offer, a bare ack IS the answer to 'shall I draft with defaults?' → proceed", () => {
    const d = decideClarifyV2Resume({
      state: { ...state1, reoffered: true },
      message: 'ok',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d).toEqual({ kind: 'proceed', brief: THIN_BRIEF, reason: 'user_proceed' });
  });

  it("strong go-aheads ('yes', 'go ahead', 'draft it') still proceed immediately — A4 demotes only weak acks", () => {
    for (const msg of ['yes', 'go ahead', 'just draft it']) {
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      expect(d.kind).toBe('proceed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 1.152(i) — #498-review P2/P3: widened decline cue set + hedged
// proceed, RED-first (every decline probe below folded as an ANSWER at
// #498's head; the hedged-proceed probe folded too).
// ─────────────────────────────────────────────────────────────────────────

describe('1.152(i) P2 — widened decline cues (RED-first at #498 head)', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it.each([
    'no thanks',
    'no',
    'No.',
    'nope',
    'nah',
    'no thank you',
    'cancel it',
    "let's not do this now",
    "Let's not.",
    'actually hold off',
    'Actually, hold off for now',
    'honestly, not now',
    'Actually, no',
  ])("genuine decline '%s' → DECLINE (round released, brief kept)", (msg) => {
    const d = decideClarifyV2Resume({
      state: state1,
      message: msg,
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d.kind).toBe('decline');
    if (d.kind !== 'decline') return;
    expect(d.cue).toBe('decline');
    expect(d.brief).toBe(THIN_BRIEF);
  });
});

describe('1.152(i) — the 24-case answer battery (danger direction: every one MUST fold as an answer)', () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  // Each case carries a decline/hedge cue WORD or shape that the widened
  // patterns must NOT claim. Asserting the incorporated brief CONTAINS the
  // message proves the fold (not merely "not declined").
  const ANSWER_BATTERY: readonly string[] = [
    // The four named danger pins (#498 review):
    "I don't want to expand into Germany",
    'we want to stop customer churn',
    'the options are to cancel the contract or renegotiate it',
    'Wait, the budget is £2m',
    // Cue words INSIDE real answers:
    'We should wait until Q3 before committing the budget.',
    'No, the budget is £2m not £200k',
    'We should stop hiring contractors first.',
    'Stop-loss is capped at £50k.',
    'No more than three new hires this quarter.',
    'Cancel culture is hurting our brand in the US market.',
    'Later this year we plan to open the Berlin office.',
    'Not now, but within six months we must decide.',
    "Let's not forget the Berlin team depends on this decision.",
    // Leading-adverb answers (the new softener prefix must not claim them):
    'Actually the goal is to cut costs, not grow revenue.',
    'Honestly we just want to survive the next 12 months.',
    // Hedge words INSIDE real answers (the hedged-proceed pattern's
    // required proceed-phrase tail must not claim them):
    "Maybe France, maybe Germany — we're torn.",
    'I guess the biggest risk is churn in the enterprise segment.',
    'maybe we should expand into France instead',
    // Ordinary answers (regression floor from the A1 battery):
    'The goal is to increase revenue.',
    'The main alternative is doing nothing and keeping things as they are.',
    'It depends on whether Sam accepts.',
    'The board meets soon and morale is low.',
    'The timeframe is 18 months.',
    'Our budget is £2m and the deadline is Q4.',
  ];

  it('battery integrity: exactly 24 cases', () => {
    expect(ANSWER_BATTERY).toHaveLength(24);
  });

  it.each(ANSWER_BATTERY.map((m) => [m] as const))(
    "'%s' folds as an ANSWER (never decline / re-offer; the brief carries it)",
    (msg) => {
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      expect(d.kind === 'ask' || d.kind === 'proceed').toBe(true);
      const brief = d.kind === 'ask' ? d.state.brief : d.kind === 'proceed' ? d.brief : '';
      expect(brief).toContain(msg.trim());
      expect(brief).toContain(THIN_BRIEF); // appended, not replaced
    },
  );
});

describe("1.152(i) P3 — hedged proceed ('not sure — maybe just draft it?') is proceed-INTENT → one re-offer, then consent (pinned decision)", () => {
  const round1 = decideClarifyV2Round1(THIN_BRIEF);
  if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
  const state1 = round1.state;

  it.each(['not sure — maybe just draft it?', 'Maybe just draft it?', "I'm not sure, just go ahead"])(
    "hedged proceed '%s' → RE-OFFER with cue hedged_proceed (not decline, not fold)",
    (msg) => {
      const d = decideClarifyV2Resume({
        state: state1,
        message: msg,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      expect(d.kind).toBe('reoffer');
      if (d.kind !== 'reoffer') return;
      expect(d.cue).toBe('hedged_proceed');
      // The hedge is about OUR questions, not the decision: never folded.
      expect(d.state.brief).toBe(THIN_BRIEF);
      expect(d.state.reoffered).toBe(true);
    },
  );

  it('after the re-offer (a direct yes/no), the same hedge IS consent → proceed', () => {
    const d = decideClarifyV2Resume({
      state: { ...state1, reoffered: true },
      message: 'not sure — maybe just draft it?',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(d).toEqual({ kind: 'proceed', brief: THIN_BRIEF, reason: 'user_proceed' });
  });

  it("the hedged re-offer copy is the DIRECT yes/no (same as bare-ack), with the default-forward chip", () => {
    const response = composeClarifyV2ReofferResponse('hedged_proceed');
    expect(response.assistant_text).toContain('shall I draft with sensible defaults');
    expect(response.suggested_actions.map((a) => a.id)).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it("boundary: 'maybe later' is a DECLINE, an unhedged 'just draft it' still proceeds immediately, and a bare hedge folds as an answer", () => {
    expect(CLARIFY_V2_HEDGED_PROCEED_PATTERN.test('maybe later')).toBe(false);
    const declined = decideClarifyV2Resume({
      state: state1,
      message: 'maybe later',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(declined.kind).toBe('decline');

    expect(CLARIFY_V2_HEDGED_PROCEED_PATTERN.test('just draft it')).toBe(false);
    const proceeded = decideClarifyV2Resume({
      state: state1,
      message: 'just draft it',
      messageIsDraftShaped: false,
      explicitGenerateBrief: null,
    });
    expect(proceeded.kind).toBe('proceed');

    // Documented residual: a bare "not sure" (no proceed phrase) is not a
    // hedged proceed — it folds as an answer, same as at #498 head.
    expect(CLARIFY_V2_HEDGED_PROCEED_PATTERN.test('not sure')).toBe(false);
  });
});

describe('1.152 A12 — proceed vocabulary vs SHORT_CONFIRM: deliberate divergence, pinned', () => {
  it('weak acks live in SHORT_CONFIRM (single-offer consent) but NOT in the clarify proceed set (A4)', async () => {
    const { SHORT_CONFIRM_PATTERN } = await import(
      '../../src/orchestrator-v5/routing/deterministic-short-confirm.js'
    );
    for (const ack of ['ok', 'sure']) {
      expect(SHORT_CONFIRM_PATTERN.test(ack)).toBe(true);
      expect(CLARIFY_V2_PROCEED_PATTERN.test(ack)).toBe(false);
    }
    // Draft-domain phrases are meaningless to short-confirm and stay local.
    expect(CLARIFY_V2_PROCEED_PATTERN.test('use sensible defaults')).toBe(true);
    expect(SHORT_CONFIRM_PATTERN.test('use sensible defaults')).toBe(false);
  });
});

/**
 * DEFECT B (dress rehearsal, 20 Jul) — CEE over-emits chips and the
 * escape hatch is evicted.
 *
 * Observed: CEE emitted 4 `suggested_actions`; the UI renders at most 3
 * (D-K "0–3 chips", ratified 15 Jul). The default-forward escape hatch
 * was appended LAST, so it was ALWAYS the chip the cap dropped — the one
 * chip the clarify doctrine calls mandatory ("no question is ever a dead
 * end") was the only one guaranteed never to reach the user.
 *
 * RED-first on base: base emits `[...candidateChips, proceedChip]` with
 * no cap, so (1) the count pin fails and (2) the survival pin fails.
 *
 * Mutation check for these pins (throwaway worktree): restore
 * `[...candidateChips, proceedChip]` in `composeClarifyV2Response` and
 * BOTH the cap pin and the survival pin go RED.
 */
describe('clarify_v2 chip cap (D-K 0–3) — the escape hatch must never be the evicted chip', () => {
  /** The ratified UI display cap. Producer-side contract, not a hint. */
  const UI_DISPLAY_CAP = 3;

  /** What the UI actually does with an over-long chip row. */
  const asRenderedByUi = (
    r: { suggested_actions: readonly { id: string }[] },
    cap: number = UI_DISPLAY_CAP,
  ) => r.suggested_actions.slice(0, cap).map((a) => a.id);

  /**
   * Consumer caps to prove survival against. DGAI staging 42390d7f
   * renders `slice(0, 3)`, but its own comment cites DS v5 §21.4 "max 2"
   * with the amendment owned by the DS-1 lane — so the cap this producer
   * must survive is genuinely uncertain, and pinning only the value we
   * happen to see today rebuilds the coupling that caused the defect.
   * 1 is included as the degenerate floor.
   */
  const PLAUSIBLE_CONSUMER_CAPS = [1, 2, 3] as const;

  /**
   * Every clarify response shape this module can put on the wire, derived
   * from the module's OWN budget constant rather than hand-listed — a
   * hand-maintained shape list would drift the moment a round shape is
   * added (the recorded mirror-drift defect class).
   */
  const everyClarifyResponseShape = () => {
    const shapes: { name: string; response: ReturnType<typeof composeClarifyV2Response> }[] = [];
    const round1 = decideClarifyV2Round1(THIN_BRIEF);
    if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
    shapes.push({ name: 'round1(thin brief)', response: composeClarifyV2Response(round1.questions, round1.phase) });
    // Derived worst case: the full per-round question budget.
    for (let n = 1; n <= Math.min(CLARIFY_V2_MAX_QUESTIONS_PER_ROUND, round1.questions.length); n += 1) {
      for (const phase of ['initial', 'follow_up'] as const) {
        shapes.push({
          name: `${n} question(s), phase=${phase}`,
          response: composeClarifyV2Response(round1.questions.slice(0, n), phase),
        });
      }
    }
    return shapes;
  };

  it('POSITIVE CONTROL: the fixture round really does carry a multi-chip candidate set', () => {
    const round1 = decideClarifyV2Round1(THIN_BRIEF);
    if (round1.kind !== 'ask') throw new Error('fixture: round 1 must ask');
    const totalCandidates = round1.questions.reduce((n, q) => n + q.candidates.length, 0);
    // If this ever drops to 0 the cap assertions below would pass vacuously.
    expect(totalCandidates).toBeGreaterThan(0);
    expect(round1.questions.length).toBeGreaterThan(0);
  });

  it('emits AT MOST the ratified cap on every response shape (RED on base: 4+)', () => {
    for (const { name, response } of everyClarifyResponseShape()) {
      expect(
        response.suggested_actions.length,
        `${name}: emitted ${response.suggested_actions.length} chips, cap is ${UI_DISPLAY_CAP}`,
      ).toBeLessThanOrEqual(UI_DISPLAY_CAP);
    }
  });

  it('the escape hatch SURVIVES the UI cap on every response shape (RED on base: evicted)', () => {
    for (const { name, response } of everyClarifyResponseShape()) {
      expect(asRenderedByUi(response), `${name}: escape hatch evicted by the UI cap`).toContain(
        CLARIFY_V2_PROCEED_CHIP_ID,
      );
    }
  });

  it('the escape hatch survives ANY plausible consumer cap, not just the one we see today', () => {
    for (const cap of PLAUSIBLE_CONSUMER_CAPS) {
      for (const { name, response } of everyClarifyResponseShape()) {
        expect(
          asRenderedByUi(response, cap),
          `${name}: escape hatch evicted at consumer cap ${cap} — the guarantee is coupled to the consumer's number`,
        ).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
      }
      for (const cue of ['bare_ack', 'question_reply', 'hedged_proceed'] as const) {
        expect(
          asRenderedByUi(composeClarifyV2ReofferResponse(cue), cap),
          `reoffer(${cue}): escape hatch evicted at consumer cap ${cap}`,
        ).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
      }
    }
  });

  it('the escape hatch keeps its stable id and resume message inside the capped set', () => {
    for (const { name, response } of everyClarifyResponseShape()) {
      const proceed = response.suggested_actions.find((a) => a.id === CLARIFY_V2_PROCEED_CHIP_ID);
      expect(proceed, `${name}: escape hatch absent`).toBeDefined();
      expect(proceed?.message, `${name}: resume path would not recognise the chip`).toBe(
        CLARIFY_V2_PROCEED_MESSAGE,
      );
    }
  });

  it('the re-offer response is already within the cap and carries the escape hatch', () => {
    for (const cue of ['bare_ack', 'question_reply', 'hedged_proceed'] as const) {
      const response = composeClarifyV2ReofferResponse(cue);
      expect(response.suggested_actions.length).toBeLessThanOrEqual(UI_DISPLAY_CAP);
      expect(asRenderedByUi(response)).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    }
  });
});
