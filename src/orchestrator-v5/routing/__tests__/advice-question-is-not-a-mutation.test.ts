/**
 * Captured-session corpus: an ADVICE question is not a change instruction.
 *
 * ORACLE — the user's own words, deployed staging, 16 Sep 2026 ~23:30Z:
 *
 *   user    "What's one update based on this discussion that you recommend we
 *            make now?"
 *   product "I couldn't take that change forward, so the model is unchanged.
 *            Tell me a different way you would like to change it and I will
 *            try again."
 *
 * Nothing was requested to change. The user asked for a RECOMMENDATION and
 * received a CHANGE-APPLICATION ERROR. Traced at the bytes:
 * `EDIT_GRAPH_POSITIVE_REGEX` matched the NOUN `update` in "one update"; the
 * negative regex and `isAnalyticalQuestion` both cleared; `editVerbCandidate`
 * (route-v2.ts:5667) went true; the V4 edit_graph LLM ran; the referee gate
 * returned `rejected` and `GM_REJECTED_ASSISTANT_TEXT`
 * (edit-graph-referee-gate.ts:317) is the sentence above, verbatim.
 *
 * WHAT THIS PINS: the three-predicate chain route-v2 gates `edit_graph` on —
 * `EDIT_GRAPH_POSITIVE_REGEX && !EDIT_GRAPH_NEGATIVE_REGEX &&
 * !isAnalyticalQuestion`. Route-v2 assembles edit intent from further
 * detectors; this suite is scoped to THIS chain and claims nothing about the
 * others. It is the sibling of `advice-question-not-edit-instruction.test.ts`,
 * which pins the same chain over the 15 Sep capture; that suite's
 * opposite-direction rows are its ratchet and are NOT restated here.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the opposite-direction half deliberately
 * includes the class a corpus written beside a fix does not think of: a message
 * whose wh-word is the OBJECT of an imperative edit verb ("Now add what you
 * recommend"), and a question followed by a command in the same message. Those
 * are the rows that decided the predicate's shape, measured before it was
 * written, not after.
 */

import { describe, expect, it } from 'vitest';

import { isAnalyticalQuestion } from '../analytical-question-guard.js';
import { hasMutationSignal } from '../analytical-intent.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';

/** The exact gate route-v2 applies before dispatching the V4 edit_graph LLM. */
function dispatchesEditGraph(message: string): boolean {
  return (
    EDIT_GRAPH_POSITIVE_REGEX.test(message) &&
    !EDIT_GRAPH_NEGATIVE_REGEX.test(message) &&
    !isAnalyticalQuestion(message)
  );
}

/** The captured turn, transcribed from the 16 Sep session. Not authored here. */
const CAPTURED_ADVICE_QUESTION =
  "What's one update based on this discussion that you recommend we make now?";

/**
 * The captured turn IMMEDIATELY BEFORE it, which is a genuine instruction and
 * must keep the edit lane. Its own failure is a different defect (the referee
 * refused the batch the edit LLM built) and is explicitly out of this suite's
 * scope — but a fix for the question must not take the instruction with it.
 */
const CAPTURED_CHANGE_INSTRUCTION = 'Update the model to reflect all of this, then.';

describe('an advice question is not a change instruction (16 Sep capture)', () => {
  it('the captured question reaches edit_graph at pristine, which is the defect', () => {
    // Bound by IDENTITY to the user's sentence, and to the exact token that
    // carries it into the editor: the NOUN `update`.
    expect(EDIT_GRAPH_POSITIVE_REGEX.exec(CAPTURED_ADVICE_QUESTION)?.[0]).toBe('update');
    // The message carries NO concrete edit clause. `hasMutationSignal`'s own
    // docstring names this class ("What should we update based on this?") as
    // one that must reach advice paths — so the authority already agrees, and
    // the routing chain simply never consulted it.
    expect(hasMutationSignal(CAPTURED_ADVICE_QUESTION)).toBe(false);
  });

  it('the captured question must not dispatch edit_graph', () => {
    expect(isAnalyticalQuestion(CAPTURED_ADVICE_QUESTION)).toBe(true);
    expect(dispatchesEditGraph(CAPTURED_ADVICE_QUESTION)).toBe(false);
  });

  it.each([
    ['second-person recommendation sought', 'What do you recommend we add?'],
    ['which-headed', 'Which change do you recommend?'],
    ['fronted adverbial', 'Based on this discussion, what is one update you recommend?'],
    ['and-prefixed clause', 'And what do you suggest we remove?'],
    ['advise', 'Which of these do you advise we drop?'],
    ['propose', 'What do you propose we change first?'],
    ['embedded, no auxiliary', 'Which factor do you suggest I remove?'],
  ])('same family, %s: %s', (_name, message) => {
    expect(isAnalyticalQuestion(message), message).toBe(true);
    expect(dispatchesEditGraph(message), message).toBe(false);
  });
});

describe('the opposite direction: change instructions still reach edit_graph', () => {
  it('the captured instruction one turn earlier still dispatches', () => {
    expect(isAnalyticalQuestion(CAPTURED_CHANGE_INSTRUCTION)).toBe(false);
    expect(dispatchesEditGraph(CAPTURED_CHANGE_INSTRUCTION)).toBe(true);
  });

  it.each([
    ['remove an option', 'Remove that option'],
    ['add a risk', 'Add a risk for morale'],
    ['itemised edit', "Yes, add factor 'Senior Developer Morale'"],
    ['polite request', 'Can you add a risk for staff churn?'],
  ])('%s still reaches edit_graph: %s', (_name, message) => {
    expect(dispatchesEditGraph(message), message).toBe(true);
  });

  it('a wh-word that is the OBJECT of an imperative is an instruction, not a question', () => {
    // ⚠ THE ADVERSARIAL CLASS THAT DECIDED THE PREDICATE'S SHAPE. In each of
    // these the user issued a real instruction and would have watched it do
    // nothing had the pattern been anchored on the advice verb alone. Measured
    // against three candidate predicates BEFORE the fix was written; the two
    // looser candidates lost rows 1 and 4, which is why the shipped pattern
    // requires the clause to END the message.
    //
    // ⚠ DISCLOSED GAP, MEASURED NOT ASSUMED. The pattern carries THREE
    // conjuncts and this corpus pins only TWO of them. Mutants, each with a
    // non-zero applied-check against a pristine archive:
    //   · remove the END anchor            → RED on "So what do you recommend
    //                                          we add? Add it."
    //   · remove the `(?!\s*you\b)` lookahead → RED on "What you recommend is
    //                                          fine, add it."
    //   · remove the CLAUSE-INITIAL anchor  → GREEN, 16/16. Over this corpus
    //     the lookahead already subsumes it, and no natural message was found
    //     where it is the deciding conjunct. It is retained as DEFENCE IN
    //     DEPTH — the same status this file gives three of its other patterns
    //     — and is recorded here as unpinned rather than left to look
    //     load-bearing. A guard nothing can RED is a guard agreeing with
    //     itself; saying so is cheaper than discovering it later.
    //   · a fourth mutant was a FALSE SURVIVOR on the first attempt: the
    //     mutated string also occurred in a comment, so nothing was mutated
    //     and an unmutated tree read as an equivalent mutant. Re-run against
    //     the regex literal alone, it bites.
    for (const message of [
      'Now add what you recommend.',
      'Add what you recommend.',
      'Go ahead and add whatever you suggest.',
      'Just update what you recommend, please.',
      'What you recommend is fine, add it.',
    ]) {
      expect(isAnalyticalQuestion(message), `newly suppressed: ${message}`).toBe(false);
      expect(dispatchesEditGraph(message), `lost the edit lane: ${message}`).toBe(true);
    }
  });

  it('a question MIXED with a command in one message is an instruction', () => {
    // Two independent protections hold these: the clause-END anchor (nothing
    // may follow the question) and the inherited `hasMutationSignal` veto. Both
    // are asserted, because a row that only ever exercises one of them cannot
    // show the other is still doing its job.
    for (const message of [
      'What do you recommend? Set churn to 30%.',
      'So what do you recommend we add? Add it.',
      'Add a factor, what do you suggest calling it?',
      'Remove the churn factor, and what do you suggest we add next?',
      'How do you recommend we manage morale? Add a factor for staff morale.',
    ]) {
      expect(isAnalyticalQuestion(message), `newly suppressed: ${message}`).toBe(false);
      expect(dispatchesEditGraph(message), `lost the edit lane: ${message}`).toBe(true);
    }
  });
});
