/**
 * INV-Q (ROADMAP 2.715) — a question to the assistant is not a decision brief.
 *
 * The corpus below is the ELEVEN messages measured to capture as decision
 * briefs at `8c316b5e` (capture-semantics-derivation-2026-08-08.md §1.4): each
 * is a typed paraphrase of one of the product's own coaching prompts, each
 * satisfies `isDraftShapedText` through the regex's `\?$` arm alone, and none
 * is caught by the process-meta guard's exact-string mirror.
 *
 * ⚠ TWO PREMISES OF THE DERIVATION ARE CORRECTED HERE, BOTH MEASURED AT THIS
 * TIP AND BOTH LOAD-BEARING:
 *
 *  1. §2.4 states that of the eleven, "none contains a decision verb". FALSE —
 *     "What should I be checking before I run this?" carries `should`. The
 *     rule as the row words it therefore leaves 1 of 11 capturing. The fix is
 *     the POSITIONAL refinement pinned below: `should`/`shall` are decision-
 *     bearing in the interrogative-OPENER slot ("Should we expand…?") and are
 *     ordinary advice modals anywhere else ("What should I be checking?").
 *     That is the same distinction `process-meta-intake.ts` already draws when
 *     it refuses those words as ARM OPENERS.
 *  2. §5.1 requires the new term to be applied to `derive-brief-seed`. It is
 *     already stronger there: `deriveBriefTextSeed` refuses ANY trailing-`?`
 *     message outright. Pinned below rather than duplicated.
 */

import { describe, it, expect } from "vitest";

import {
  AMBIGUOUS_MODAL_DECISION_VERBS,
  DECISION_VERB_ALTERNATION_SOURCE,
  DRAFT_GRAPH_DECISION_BRIEF_REGEX,
  INTERROGATIVE_OPENER_ALTERNATION_SOURCE,
  INTERROGATIVE_QUESTION_PATTERN,
  isDraftShapedText,
  isQuestionToAssistant,
} from "../assist.js";
import { isProcessMetaIntake } from "../../orchestrator-v5/routing/process-meta-intake.js";
import { CLARIFY_V2_QUESTION_REPLY_PATTERN } from "../../orchestrator-v5/clarify-v2/preflight.js";
import { deriveBriefTextSeed } from "../../orchestrator-v5/session/derive-brief-seed.js";

/** The measured capture predicate: the two message-TEXT terms of `draftShapedTurn`. */
function capturesAsBrief(message: string): boolean {
  return isDraftShapedText(message) && !isProcessMetaIntake(message);
}

/** capture-semantics-derivation-2026-08-08.md §1.4 — the 11 that captured. */
const CAPTURED_QUESTIONS: readonly string[] = [
  "What assumption matters most, and why?",
  "What risks and upsides am I missing from my model?",
  "Is this the right question for me to be asking here?",
  "What should I be checking before I run this?",
  "Can you take the outside view on this one, what do base rates suggest?",
  "Could you run a pre-mortem with me on this decision?",
  "How confident are you in the estimate you used for churn?",
  "Where do you and I differ on this, and why?",
  "Can you explain what the simulation actually does here?",
  "What does the confidence interval on that edge mean?",
  "Why did you pick 0.4 for that coefficient?",
];

/**
 * The precision bias, ratified in META-DECISION-DIAGNOSIS-2026-07-20 and
 * restated in `process-meta-intake.ts`: over-blocking a genuine decision brief
 * is a WORSE defect than the one this fixes. Every entry is interrogative and
 * MUST keep drafting.
 */
const GENUINE_INTERROGATIVE_BRIEFS: readonly string[] = [
  "Should we expand into Germany or double down on the UK?",
  "Should we expand into Germany or add a second warehouse in Poland?",
  "Whether to migrate the CRM to HubSpot this quarter or stay on Salesforce?",
  "Is it better to hire two engineers now or wait until Q3?",
  "Which vendor should we choose for the data platform migration?",
  "Shall we launch the new pricing tier in Q3 or hold it for Q4?",
  "Do we buy the warehouse outright or lease it for three years?",
];

describe("INV-Q — an interrogative with no decision verb is not a decision brief", () => {
  describe("A1 — the row's own string", () => {
    it("stops capturing", () => {
      expect(capturesAsBrief("What assumption matters most, and why?")).toBe(false);
    });
  });

  describe("A2 — all eleven measured captures", () => {
    it.each(CAPTURED_QUESTIONS)("does not capture: %s", (message) => {
      expect(capturesAsBrief(message)).toBe(false);
      expect(isQuestionToAssistant(message)).toBe(true);
    });

    it("covers exactly the eleven measured strings (no silent shrink)", () => {
      expect(CAPTURED_QUESTIONS).toHaveLength(11);
      expect(new Set(CAPTURED_QUESTIONS).size).toBe(11);
    });

    it("positive control — every entry is long enough and question-shaped, so the "
      + "old `\\?$` arm WOULD have captured it", () => {
      for (const m of CAPTURED_QUESTIONS) {
        expect(m.length).toBeGreaterThanOrEqual(30);
        expect(DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(m)).toBe(true);
      }
    });
  });

  describe("A3 — negative control: genuine interrogative briefs still draft", () => {
    it.each(GENUINE_INTERROGATIVE_BRIEFS)("still drafts: %s", (message) => {
      expect(isQuestionToAssistant(message)).toBe(false);
      expect(capturesAsBrief(message)).toBe(true);
    });
  });

  describe("A4 — the predicate is SINGLE-SOURCED, not mirrored", () => {
    it("clarify-v2's question-reply pattern IS the schemas export", () => {
      expect(CLARIFY_V2_QUESTION_REPLY_PATTERN).toBe(INTERROGATIVE_QUESTION_PATTERN);
    });

    it("the brief regex is byte-identical to its pre-refactor literal", () => {
      expect(DRAFT_GRAPH_DECISION_BRIEF_REGEX.source).toBe(
        "\\b(should|shall|whether|versus|vs\\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\\b|\\?$",
      );
      expect(DRAFT_GRAPH_DECISION_BRIEF_REGEX.flags).toBe("i");
    });

    it("the interrogative pattern is byte-identical to clarify-v2's original literal", () => {
      expect(INTERROGATIVE_QUESTION_PATTERN.source).toBe(
        "^\\s*(?:what|why|how|who|whom|whose|when|where|which|can|could|do|does|did|is|are|was|were|will|would|should|shall|whether)\\b[\\s\\S]*\\?\\s*$",
      );
      expect(INTERROGATIVE_QUESTION_PATTERN.flags).toBe("i");
    });

    it("the brief-text SEED gate is already strictly stronger — every captured "
      + "question is refused there, without this term (premise correction to §5.1)", () => {
      for (const m of CAPTURED_QUESTIONS) {
        expect(
          deriveBriefTextSeed(
            { kind: "message", stage: "frame", message: m } as never,
            { hasCommittedGraph: false },
          ),
        ).toBeUndefined();
      }
    });
  });

  describe("A5 — the ambiguous-modal set is derived-checked and its exclusion is tested", () => {
    const decisionVerbs = DECISION_VERB_ALTERNATION_SOURCE.split("|");
    const openers = INTERROGATIVE_OPENER_ALTERNATION_SOURCE.split("|");

    it("every ambiguous modal is a member of BOTH source lists", () => {
      for (const modal of AMBIGUOUS_MODAL_DECISION_VERBS) {
        expect(decisionVerbs).toContain(modal);
        expect(openers).toContain(modal);
      }
    });

    it("`whether` is in the intersection but DELIBERATELY excluded — it is a "
      + "choice marker, not an advice modal, so demoting it would strand "
      + "\"...work out whether to migrate or stay?\"", () => {
      expect(decisionVerbs).toContain("whether");
      expect(openers).toContain("whether");
      expect(AMBIGUOUS_MODAL_DECISION_VERBS).not.toContain("whether");
      expect(
        isQuestionToAssistant("Can you help me work out whether to migrate the CRM or stay?"),
      ).toBe(false);
    });

    it("a modal in the OPENER slot is decision-bearing; the same word elsewhere is not", () => {
      expect(isQuestionToAssistant("Should we hire a tech lead or two developers?")).toBe(false);
      expect(isQuestionToAssistant("What should I be checking before I run this?")).toBe(true);
      expect(isQuestionToAssistant("Shall we take the London office or the Leeds one?")).toBe(false);
      expect(isQuestionToAssistant("How shall I read the confidence interval you drew?")).toBe(true);
    });
  });

  describe("A6 — shape terms the predicate must NOT swallow", () => {
    it("a non-interrogative message is untouched", () => {
      expect(isQuestionToAssistant("We are deciding whether to expand into Germany.")).toBe(false);
      expect(isDraftShapedText("We are deciding whether to expand into Germany.")).toBe(true);
    });

    it("a question with no interrogative opener is untouched", () => {
      expect(isQuestionToAssistant("Germany or the UK, which one first?")).toBe(false);
    });

    it("the length floor still applies", () => {
      expect(isDraftShapedText("Expand?")).toBe(false);
    });
  });
});
