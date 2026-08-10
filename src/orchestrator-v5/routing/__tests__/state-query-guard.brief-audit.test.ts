/**
 * ROADMAP 2.975 — THE BRIEF-AUDIT QUESTION STOPS BEING ANSWERED BY THE
 * SESSION-EDIT GUARD.
 *
 * ── THE DEFECT, AT THE WIRE ────────────────────────────────────────────────
 * The 2026-08-08 context-integrity trace asked the deployed product, on three
 * separate briefs, what it had done with the user's input. All three received
 * the same canned line about edit history, with ZERO LLM calls:
 *
 *   user  → "…what from my brief did you keep in the model, 2) what did you
 *            add or infer yourself, 3) what did you leave out…"
 *   olumi → "I don't have a record of recent edits in this conversation."
 *
 * Captured verbatim at
 * `PHASE0-EVIDENCE-2026-07-28/context-integrity-trace-2026-08-08/raw/
 *  {496a89d9,2fa5e8b8}-T4_FOURQ.json` and `496a89d9-T4C_EXCLUDED.json`.
 *
 * ── WHY IT HAPPENS (CLAUDE.md trap 21) ─────────────────────────────────────
 * Two DIFFERENT questions wearing similar words, with only one authority:
 *
 *   "what did you change?"           → about THIS SESSION'S EDITS
 *   "what did you change from my brief?" → about THE DRAFT'S FIDELITY
 *
 * `STATE_QUERY_PATTERNS` answers the first. It matches the second on the bare
 * verb, claims the turn, finds no session edits, and deflects. Neither the
 * pattern nor the copy is wrong for the question it was written for — the
 * defect is that nothing separated the two questions.
 *
 * ── THE CORPUS IS NOT MINE (trap 22) ───────────────────────────────────────
 * Every BRIEF-AUDIT message below is a verbatim capture from the trace, and
 * every SESSION-EDIT twin is lifted from the existing `state-query-guard.test.ts`
 * corpus — i.e. both directions come from outside this author's head, and the
 * opposite-direction twins are what stop a widened predicate from silently
 * stealing the session-edit question (trap 22b: a false positive that DROPS the
 * audit answer is a gap; one that ANSWERS AN EDIT QUESTION WITH BRIEF DATA is a
 * lie, and they cannot share a window).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { RecentMutation } from '../../context/recent-changes.js';
import { isEditRequestShape } from '../mutation-warrant.js';
import {
  isStateQueryQuestionShape,
  tryStateQueryGuard,
} from '../state-query-guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The unedited `brief_text` + `graph` from the trace's own cold-read captures
 * against CEE build `4b57b8f`. A fixture this lane wrote itself would only
 * encode this lane's model of the producer (trap 16-inverse).
 */
function loadCapture(name: string): { brief_text: string; graph: unknown } {
  return JSON.parse(
    readFileSync(
      join(
        HERE,
        '../../../cee/context-integrity/__tests__/fixtures',
        `${name}.cold-read.json`,
      ),
      'utf8',
    ),
  ) as { brief_text: string; graph: unknown };
}

const B1 = loadCapture('b1-growth');

/** Verbatim from `496a89d9-T4_FOURQ.json` / `2fa5e8b8-T4_FOURQ.json`. */
const CAPTURED_FOUR_QUESTION_AUDIT =
  'Before I go further I want to audit what you did with my brief. Tell me ' +
  'specifically: 1) what from my brief did you keep in the model, 2) what did ' +
  'you add or infer yourself, 3) what did you leave out, and 4) what did you ' +
  'change or reinterpret? Be specific about numbers.';

/** Verbatim from `496a89d9-T4C_EXCLUDED.json`. */
const CAPTURED_EXCLUDED_QUESTION =
  'Which parts of my brief did you leave out of the model, and which numbers ' +
  'did you change or reinterpret?';

/** The exact deflection the trace measured, 3/3 briefs. */
const CANNED_DEFLECTION = "I don't have a record of recent edits";

const ADD_CONSTRAINT_50K: RecentMutation = {
  action: 'constraint_added',
  summary: 'Added constraint: Total cost must be at most £50,000.',
  target_label: 'Total cost',
};

function ctxWith(recent: readonly RecentMutation[]): Pick<ContextPack, 'recent_changes'> {
  return { recent_changes: recent };
}

const briefAudit = { briefText: B1.brief_text, graph: B1.graph };

describe('ROADMAP 2.975 — brief-audit questions are not answered from edit history', () => {
  const capturedAuditQuestions: readonly (readonly [string, string])[] = [
    ['T4_FOURQ (B1 + B3, byte-identical)', CAPTURED_FOUR_QUESTION_AUDIT],
    ['T4C_EXCLUDED (B1)', CAPTURED_EXCLUDED_QUESTION],
  ];

  for (const [label, message] of capturedAuditQuestions) {
    describe(label, () => {
      it('never returns the canned edit-history deflection', () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        const text = outcome.matched ? outcome.assistant_text : '';
        expect(text).not.toContain(CANNED_DEFLECTION);
      });

      it('is claimed by the brief_audit dispatch, not a session-edit dispatch', () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        expect(outcome.matched).toBe(true);
        expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
      });

      it('still refuses the edit-history answer even when session edits DO exist', () => {
        // The discriminator must key on the QUESTION, never on whether edits
        // happen to exist. A brief-audit question asked after a real edit is
        // still a brief-audit question.
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          briefAudit,
        });
        expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
      });
    });
  }

  describe('the answer is grounded in the derived manifest, not in prose', () => {
    function answer(): string {
      const outcome = tryStateQueryGuard({
        message: CAPTURED_FOUR_QUESTION_AUDIT,
        contextPack: ctxWith([]),
        briefAudit,
      });
      if (!outcome.matched || outcome.dispatch !== 'brief_audit') {
        throw new Error('expected a brief_audit dispatch');
      }
      return outcome.assistant_text;
    }

    /**
     * Bound by IDENTITY (the user's exact bytes at a known offset), never by a
     * value predicate another quantity could satisfy (trap 19). `£11.2m` is the
     * company's ARR, stated at char 177 of B1 and absent from the drafted model
     * — derived from the producer, not asserted by this author.
     */
    it("quotes a stated figure that did NOT reach the model, in the user's own bytes", () => {
      expect(answer()).toContain('£11.2m');
    });

    it('reports the derived tally of stated quantities', () => {
      // B1: 25 stated quantities, 17 of them absent from the model.
      const text = answer();
      expect(text).toContain('25');
      expect(text).toContain('17');
    });

    /**
     * The anti-reassurance clause. The manifest's own header is explicit that an
     * `absent` list read as exhaustive would be "a NEW lie, more damaging than
     * silence" — so the answer must never let a finite list imply completeness.
     */
    it('discloses that the check cannot see every loss class', () => {
      expect(answer()).toMatch(/not (?:a )?complete/i);
    });

    it('names what it could not look for, rather than implying it looked everywhere', () => {
      // `NOT_TRACKED_CLASSES` includes dissenting proposals and corrections —
      // the two classes the trace measured at 0% survival.
      expect(answer()).toMatch(/dissent|competing|correction/i);
    });
  });

  describe('it refuses to claim when it cannot look (never a reassuring zero)', () => {
    it('falls through rather than answering when no brief is persisted', () => {
      const outcome = tryStateQueryGuard({
        message: CAPTURED_FOUR_QUESTION_AUDIT,
        contextPack: ctxWith([]),
        briefAudit: { briefText: null, graph: B1.graph },
      });
      expect(outcome.matched).toBe(false);
    });

    it('falls through rather than answering when no graph exists', () => {
      const outcome = tryStateQueryGuard({
        message: CAPTURED_FOUR_QUESTION_AUDIT,
        contextPack: ctxWith([]),
        briefAudit: { briefText: B1.brief_text, graph: null },
      });
      expect(outcome.matched).toBe(false);
    });

    it('falls through when the caller supplies no brief-audit source at all', () => {
      const outcome = tryStateQueryGuard({
        message: CAPTURED_FOUR_QUESTION_AUDIT,
        contextPack: ctxWith([]),
      });
      expect(outcome.matched).toBe(false);
    });

    /**
     * The load-bearing negative: falling through must NOT hand the turn back to
     * the session-edit arm, or the deflection returns by the back door on
     * exactly the scenarios we know least about.
     */
    it('does not deflect to edit history on the fall-through path', () => {
      const outcome = tryStateQueryGuard({
        message: CAPTURED_FOUR_QUESTION_AUDIT,
        contextPack: ctxWith([]),
        briefAudit: { briefText: null, graph: null },
      });
      const text = outcome.matched ? outcome.assistant_text : '';
      expect(text).not.toContain(CANNED_DEFLECTION);
    });
  });

  /**
   * ROUND 2 / F1 — THE CANNED LIE SURVIVED FOR TWO OF THE FOUR QUESTIONS.
   *
   * ⚠ AND THE RATIONALE IN ROUND 1 WAS INVERTED FOR THIS CLASS. Round 1 argued
   * that a narrow audit predicate "fails toward the GAP". That holds ONLY for
   * utterances `STATE_QUERY_PATTERNS` does not match, which fall through to the
   * LLM. For utterances it DOES match, narrowness fails toward the LIE, because
   * the session-edit arm claims the turn and the canned deflection fires.
   *
   * Two of PR1's four questions are in that second class:
   *   "what did you add or infer yourself?"  -> matches `what did you add`
   *   "what did you change or reinterpret?"  -> matches `what did you change`
   * Measured at the round-1 head: both returned the canned deflection.
   *
   * Round 1's corpus could not see this: it carried "infer" and "reinterpret"
   * ONLY inside the compound T4_FOURQ capture, where the co-occurring "my
   * brief" fired the predicate for a reason that vanishes when the question is
   * asked on its own (trap 22 — the corpus shared the code's blind spot).
   */
  describe('F1: each of PR1\'s four questions, asked SINGLY', () => {
    // Derived by splitting the verbatim T4_FOURQ capture at its own numbering.
    const fourQuestionsSingly: readonly (readonly [string, string])[] = [
      ['Q1 retained', 'what from my brief did you keep in the model?'],
      ['Q2 inferred', 'what did you add or infer yourself?'],
      ['Q3 excluded', 'what did you leave out?'],
      ['Q4 changed', 'what did you change or reinterpret?'],
    ];

    for (const [label, message] of fourQuestionsSingly) {
      it(`${label}: never returns the canned edit-history deflection`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        const text = outcome.matched ? outcome.assistant_text : '';
        expect(text).not.toContain(CANNED_DEFLECTION);
      });

      it(`${label}: is answered from the derived manifest`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
      });
    }

    /**
     * Real paraphrases, taken from the trace's OWN captures rather than from
     * this author's head — the exact failure mode that produced F1.
     */
    const capturedParaphrases: readonly (readonly [string, string])[] = [
      ['T4C_EXCLUDED (Q3+Q4 compound)', CAPTURED_EXCLUDED_QUESTION],
      ['T4_FOURQ (all four compound)', CAPTURED_FOUR_QUESTION_AUDIT],
      [
        'T4C first clause alone',
        'Which parts of my brief did you leave out of the model?',
      ],
      [
        'T4C second clause alone',
        'which numbers did you change or reinterpret?',
      ],
    ];

    for (const [label, message] of capturedParaphrases) {
      it(`${label}: answered from the manifest, never deflected`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
      });
    }

    /**
     * REAL NEGATIVES, also from the captures. These are questions about the
     * MODEL or the ANALYSIS, not about fidelity to the brief, and the trace
     * showed the grounded LLM path answers them well. The predicate must leave
     * them alone.
     */
    const capturedNonAudits: readonly (readonly [string, string])[] = [
      ['T4B_REVIEW', 'Walk me through the model so I can review it before running the analysis.'],
      ['T4D_ASSUM', 'Which assumptions in this model matter most to check before I act on this result?'],
      ['T4E_BUDGET (pointed single-fact)', 'I gave you two budget numbers, which one is the model using?'],
    ];

    for (const [label, message] of capturedNonAudits) {
      it(`${label}: is NOT claimed as a brief audit`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([]),
          briefAudit,
        });
        const dispatch = outcome.matched ? outcome.dispatch : 'unmatched';
        expect(dispatch).not.toBe('brief_audit');
      });
    }
  });

  /**
   * ROUND 2 / F2 — THE SUPPRESSOR WAS CLOSED ONLY FOR THE `change` CLASS.
   *
   * `EDIT_VERB_PATTERN` was tested FIRST and returned early, so an audit
   * question carrying remove / adjust / replace / lower never reached the
   * brief-audit check. Measured at the round-1 head: "did you remove anything
   * from my brief?" classified as a brief audit BY THIS MODULE'S OWN PREDICATE
   * and was still granted a mutation warrant.
   *
   * A question must never be able to change the thing it asks about, for ANY
   * verb — so the audit classification is authoritative over warrant-granting.
   */
  describe('F2: an audit question is never granted a mutation warrant', () => {
    const auditQuestionsCarryingEditVerbs: readonly string[] = [
      'did you remove anything from my brief?',
      "did you adjust my brief's figures?",
      'did you lower any figure from my brief?',
      'what did you remove from my brief?',
      'have you replaced anything I wrote?',
    ];

    for (const message of auditQuestionsCarryingEditVerbs) {
      it(`${JSON.stringify(message)}: is question-shaped despite the edit verb`, () => {
        expect(isStateQueryQuestionShape(message)).toBe(true);
      });

      it(`${JSON.stringify(message)}: is refused a mutation warrant`, () => {
        // Asserted against the product's OWN warrant door, not a copy of it.
        expect(isEditRequestShape(message)).toBe(false);
      });
    }

    it('a genuine imperative edit still gets its warrant', () => {
      // The suppressor must not swallow real edits, or nothing could be edited.
      expect(isEditRequestShape('Remove the NRR factor.')).toBe(true);
    });

    it('a compound audit-plus-edit turn still reaches normal routing', () => {
      expect(
        isStateQueryQuestionShape(
          'What did you leave out of my brief? Add a constraint below 50000.',
        ),
      ).toBe(false);
    });
  });

  /**
   * Found by mutation M12: nothing pinned the ROUTE-LEVEL half.
   *
   * `isStateQueryQuestionShape` is what stops `route-v2` hijacking a question
   * into `edit_graph`, and what suppresses the mutation warrant
   * (`mutation-warrant.ts:221`). The captured audit question carries the edit
   * verb `change` — *"which numbers did you change or reinterpret?"* — so
   * without this the route could answer a question ABOUT the model by MUTATING
   * the model. Every other assertion in this file passed with it removed.
   */
  describe('audit questions are suppressed from edit routing at the route', () => {
    for (const [label, message] of [
      ['T4_FOURQ', CAPTURED_FOUR_QUESTION_AUDIT],
      ['T4C_EXCLUDED', CAPTURED_EXCLUDED_QUESTION],
    ] as const) {
      it(`${label}: is question-shaped, so edit_graph cannot claim it`, () => {
        expect(isStateQueryQuestionShape(message)).toBe(true);
      });
    }

    it('a bare omission question is question-shaped', () => {
      expect(isStateQueryQuestionShape('What did you leave out?')).toBe(true);
    });

    it('an imperative edit is still NOT question-shaped', () => {
      // The suppressor must not swallow real edits, or nothing could be edited.
      expect(
        isStateQueryQuestionShape('Add a constraint below 50000.'),
      ).toBe(false);
    });

    it('a compound audit-plus-edit turn is left to normal routing', () => {
      expect(
        isStateQueryQuestionShape(
          'What did you leave out of my brief? Add a constraint below 50000.',
        ),
      ).toBe(false);
    });
  });

  /**
   * OPPOSITE-DIRECTION TWINS (trap 22b). Every one of these is a genuine
   * session-edit question from the existing guard corpus. If the brief-audit
   * predicate steals any of them, the product answers "what did you just
   * change?" with a report about the brief — a lie, and strictly worse than the
   * gap this row closes.
   */
  describe('session-edit questions keep their existing answer', () => {
    const sessionEditQuestions: readonly string[] = [
      'What changed?',
      "What's changed?",
      'What has changed?',
      'What just changed?',
      'what update did you make?',
      'What change did you make?',
      'What did you change?',
      'What did you update?',
      'What did you add?',
      'did you change anything?',
      'Did you update it?',
      'Did you apply that?',
      'Did you add it?',
      "I can't see it",
      "I can't see this constraint",
      'where is it?',
      'where did it go?',
      'show me what you added',
      'show me what you changed',
    ];

    for (const message of sessionEditQuestions) {
      it(`${JSON.stringify(message)} still routes to the session-edit guard`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          briefAudit,
        });
        expect(outcome.matched).toBe(true);
        expect(outcome.matched && outcome.dispatch).toBe('with_recent_change');
      });
    }

    it('quotes the mutation summary verbatim, unchanged by this row', () => {
      const outcome = tryStateQueryGuard({
        message: 'What did you change?',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        briefAudit,
      });
      expect(outcome.matched && outcome.assistant_text).toContain(
        'Added constraint: Total cost must be at most £50,000.',
      );
    });

    /**
     * A brief REFERENT alone must not flip an imperative edit into an audit.
     * "add a factor from my brief" names the brief and asks for a change.
     */
    it('an imperative edit that mentions the brief is not an audit question', () => {
      const outcome = tryStateQueryGuard({
        message: 'Add a factor from my brief about the German TAM.',
        contextPack: ctxWith([]),
        briefAudit,
      });
      expect(outcome.matched).toBe(false);
    });

    it('a compound audit-plus-edit turn is left to the LLM', () => {
      const outcome = tryStateQueryGuard({
        message:
          'What did you leave out of my brief? Add a constraint below 50000.',
        contextPack: ctxWith([]),
        briefAudit,
      });
      expect(outcome.matched).toBe(false);
    });
  });
});
