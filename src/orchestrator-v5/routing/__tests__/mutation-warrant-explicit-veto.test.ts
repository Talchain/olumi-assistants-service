/**
 * ⭐ THE MUTATION-WARRANT CORPUS THAT DEFEATED FIVE VARIANTS.
 *
 * WHY THIS FILE EXISTS. The repo already had corpora for these predicates and
 * they were structurally blind to this class. Measured: across the 157 strings
 * the repo's own specs actually pass to `hasMutationWarrantSignal` /
 * `isStateQueryQuestionShape` / `hasMutationSignal`, a change that shipped a
 * defect AND its exact inverse moved 156 unchanged, 0 warrants gained, 1 lost.
 * The suite was green on both defects for exactly that reason — a corpus that
 * shares the code's blind spot cannot see the code's defect (CLAUDE.md trap 22).
 *
 * This corpus has since been measured against FIVE separate arrangements of
 * these predicates. Every one of them closed one direction and opened the other.
 * It also exposed a blind spot in ITS OWN earlier form (the post-nominal class,
 * `"what did the update TO hiring cost do?"`), which is why cases taken from
 * #1107's own spec are included and labelled as such.
 *
 * ── TWO HARMS, AND THEY MAY NOT SHARE A WINDOW ────────────────────────────
 *   LIE — a warrant granted on a NON-request. The model is silently rewritten.
 *   GAP — a warrant refused on a GENUINE edit. The user asks; nothing happens.
 * Every case carries its opposite-direction twin and both counts are asserted,
 * because five variants have now demonstrated that tuning one moves the other.
 *
 * ── THE LABELS ARE A JUDGEMENT; THE STRINGS ARE NOT ───────────────────────
 * Each row carries its PROVENANCE. The `message` values come from this repo's
 * fixtures, from prompts captured verbatim on the deployed product, or from an
 * independent review. The `label` is a REVIEWER JUDGEMENT, written per row so a
 * future reader can disagree with ONE label rather than the whole corpus. If a
 * label is wrong, change that row and say why — do not delete the case.
 *
 * ── `baseWarrant` IS A HISTORIC MEASUREMENT ───────────────────────────────
 * What `hasMutationWarrantSignal` returned at `c8eb71ec`, before this change.
 * It is evidence, not a fixture: never re-baseline it. A row that moves for a
 * reason this spec does not name is a finding to report, which is the point of
 * recording them.
 */

import { describe, expect, it } from 'vitest';

import { hasMutationSignal } from '../analytical-intent.js';
import {
  hasExplicitNoModelChangeIntent,
  hasMutationWarrantSignal,
} from '../mutation-warrant.js';

type Label = 'EDIT' | 'NON_EDIT';

interface WarrantCase {
  /** REVIEWER JUDGEMENT — see the header. */
  readonly label: Label;
  readonly message: string;
  /** Measured at c8eb71ec. Historic record; never re-baselined. */
  readonly baseWarrant: boolean;
}

const CORPUS: readonly WarrantCase[] = [
  // captured verbatim from the deployed product (calibration-consent-boundary.test.ts)
  { label: "NON_EDIT", message: "No - that is not what I meant. Please undo that change. By ‘pretty likely’ I mean the probability that churn stays below 3%. What numerical probability does ‘pretty likely’ map to? Do not change the graph until I confirm.", baseWarrant: true },
  // captured verbatim from the deployed product (calibration-consent-boundary.test.ts)
  { label: "EDIT", message: "I think monthly churn staying below 3% in December is pretty likely. Please set that estimate and show me the number you will use before applying it.", baseWarrant: false },
  // captured verbatim from the deployed product (calibration-consent-boundary.test.ts)
  { label: "EDIT", message: "Set AI Chatbot Deployment to pretty likely.", baseWarrant: true },
  // captured verbatim from the deployed product (calibration-consent-boundary.test.ts)
  { label: "EDIT", message: "Set Monthly Churn Rate on the basis that staying below 3% is pretty likely.", baseWarrant: true },
  // this repo's own spec fixtures
  { label: "NON_EDIT", message: "Do not change the current causal model.", baseWarrant: true },
  // named by an independent adversarial review (#1107)
  { label: "NON_EDIT", message: "What did that update do? Change nothing else.", baseWarrant: false },
  // opposite-direction twin, constructed for review
  { label: "EDIT", message: "What did that update do? Change the marketing budget to 50000.", baseWarrant: true },
  // named by an independent adversarial review (#1107)
  { label: "NON_EDIT", message: "Change of plan.", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "EDIT", message: "Change pricing to 100.", baseWarrant: true },
  // named by an independent adversarial review (#1107)
  { label: "NON_EDIT", message: "Update frequency matters.", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "EDIT", message: "Update frequency to weekly.", baseWarrant: true },
  // named by an independent adversarial review (#1107)
  { label: "NON_EDIT", message: "Edit history would help.", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "EDIT", message: "Edit hiring cost to 0.9.", baseWarrant: true },
  // named by an independent adversarial review (#1107)
  { label: "NON_EDIT", message: "Change is slow here.", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "EDIT", message: "Change churn to 0.05.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "NON_EDIT", message: "What did that update do? Do not change anything else.", baseWarrant: false },
  // systematic variant, constructed for review
  { label: "NON_EDIT", message: "What did that update do? Please leave everything else alone.", baseWarrant: false },
  // named by an independent adversarial review (#1107)
  { label: "EDIT", message: "Where did that come from? Increase hiring cost to 0.9.", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "NON_EDIT", message: "Where did that come from?", baseWarrant: false },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Increase hiring cost to 0.9.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Decrease pricing to 80.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Remove the marketing constraint.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Delete the churn factor.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Replace the pricing factor with margin.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Raise the budget to 60000.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Lower churn to 0.02.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "What did that update do? Simplify the model.", baseWarrant: false },
  // opposite-direction twin, constructed for review
  { label: "NON_EDIT", message: "What did that update do?", baseWarrant: false },
  // opposite-direction twin, constructed for review
  { label: "NON_EDIT", message: "What did the hiring cost update do?", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "Update budget.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "NON_EDIT", message: "Update budget?", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "Update budget!", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "Update budget", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "EDIT", message: "Change pricing.", baseWarrant: true },
  // systematic variant, constructed for review
  { label: "NON_EDIT", message: "Change pricing?", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "NON_EDIT", message: "Should we change pricing?", baseWarrant: true },
  // opposite-direction twin, constructed for review
  { label: "NON_EDIT", message: "Could you change the pricing?", baseWarrant: true },
  // taken from #1107's own spec (the class an earlier corpus missed)
  { label: "NON_EDIT", message: "What did the update to hiring cost do?", baseWarrant: true },
  // taken from #1107's own spec (the class an earlier corpus missed)
  { label: "NON_EDIT", message: "What did this adjustment on pre-seed runway do?", baseWarrant: false },
  // taken from #1107's own spec (the class an earlier corpus missed)
  { label: "NON_EDIT", message: "What did this pre-seed runway adjustment do?", baseWarrant: false },
  // taken from #1107's own spec (the class an earlier corpus missed)
  { label: "NON_EDIT", message: "What did your customer acquisition cost change do?", baseWarrant: true },
  // taken from #1107's own spec
  { label: "EDIT", message: "What did the hiring cost update do? Update budget.", baseWarrant: true },
  // taken from #1107's own spec
  { label: "EDIT", message: "What did the hiring cost update do? Change it back.", baseWarrant: true },
  // taken from #1107's own spec
  { label: "NON_EDIT", message: "What did the update to hiring cost do? Don't change it back.", baseWarrant: true },
  // taken from #1107's own spec
  { label: "NON_EDIT", message: "What did that update do? Don't change it back.", baseWarrant: false },
  // taken from #1107's own spec
  { label: "NON_EDIT", message: "What did that update do? Do not change it back.", baseWarrant: false },
  // taken from #1107's own spec
  { label: "NON_EDIT", message: "What did that update do? Should we change it back?", baseWarrant: false },
  // taken from #1107's own spec
  { label: "NON_EDIT", message: "What did the hiring cost update do? Update budget?", baseWarrant: true },];

/**
 * The two messages this change fixes. Both are explicit vetoes — the user said
 * the words and the product granted a write warrant anyway. One is this repo's
 * own fixture string; one was captured verbatim from the deployed product.
 */
const EXPLICIT_VETOES: readonly string[] = [
  "No - that is not what I meant. Please undo that change. By ‘pretty likely’ I mean the probability that churn stays below 3%. What numerical probability does ‘pretty likely’ map to? Do not change the graph until I confirm.",
  "Do not change the current causal model.",];

/**
 * ⚠⚠ KNOWN-UNFIXED, PINNED RATHER THAN PAPERED OVER.
 *
 * NON_EDIT messages that STILL grant a warrant after this change: 15 -> 13. An
 * improvement, NOT a fix. These turn on grammatical MOOD — declarative
 * ("Change of plan."), interrogative ("Should we change pricing?"), and read
 * questions whose wording satisfies the canonical list ("What did the update to
 * hiring cost do?").
 *
 * ⛔ SEPARATING THEM NEEDS AN UNBOUNDED NATURAL-LANGUAGE PREDICATE, and this
 * estate has spent four consecutive rounds proving that class does not
 * converge — each round closing one direction and reopening the other under a
 * fully green suite. Measured on one such attempt: a veto granted a warrant IFF
 * it did not end in a question mark. Rowed, deliberately not attempted here.
 *
 * Asserted EXACTLY, so it REDs if it GROWS (a regression) or SHRINKS (someone
 * fixed one — move it out of here and say so).
 */
const KNOWN_UNFIXED_LIES: readonly string[] = [
  "Change of plan.",
  "Update frequency matters.",
  "Edit history would help.",
  "Change is slow here.",
  "What did the hiring cost update do?",
  "Update budget?",
  "Change pricing?",
  "Should we change pricing?",
  "Could you change the pricing?",
  "What did the update to hiring cost do?",
  "What did your customer acquisition cost change do?",
  "What did the update to hiring cost do? Don't change it back.",
  "What did the hiring cost update do? Update budget?",];

const EDITS = CORPUS.filter((c) => c.label === 'EDIT');
const NON_EDITS = CORPUS.filter((c) => c.label === 'NON_EDIT');

describe('mutation warrant consults the explicit veto', () => {
  it('CORPUS_INTEGRITY — both directions present, no duplicates', () => {
    // A corpus that silently lost its EDIT half would let every GAP assertion
    // pass while proving nothing about the direction it exists to guard.
    expect(CORPUS.length).toBe(48);
    expect(EDITS.length).toBe(23);
    expect(NON_EDITS.length).toBe(25);
    expect(new Set(CORPUS.map((c) => c.message)).size).toBe(CORPUS.length);
  });

  /**
   * ⭐ THE FIX. RED-first target: at c8eb71ec both of these returned true.
   */
  it.each(EXPLICIT_VETOES)('refuses a warrant on an explicit veto: %j', (message) => {
    // Precondition pinned in-test: this really is the class under test, and it
    // really did grant a warrant before. Without this the assertion below would
    // pass on any message that merely happens to be warrant-free.
    expect(hasExplicitNoModelChangeIntent(message), 'not an explicit veto').toBe(true);
    expect(
      CORPUS.find((c) => c.message === message)?.baseWarrant,
      'this case did not grant a warrant at base, so it is not the defect',
    ).toBe(true);

    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  /**
   * ⭐⭐ THE OPPOSITE-DIRECTION TWIN, AND IT IS THE WHOLE SAFETY ARGUMENT.
   *
   * The veto predicate's own docstring names this contrast: "'do not change the
   * model' is a veto, while 'Set X to 0.7 and do not change anything else'
   * remains an authorised edit." Consulting it before the lexical terms is only
   * safe because it fires ONLY when no affirmative edit survives the protective
   * clause. If that ever stops holding, this change silently starts dropping
   * real edits — the exact harm the five earlier variants kept trading into.
   */
  it.each([
    'Set churn to 0.7 and do not change anything else.',
    'Change pricing to 100 and do not touch the rest of the model.',
    'Add a constraint below 50000, but do not change anything else.',
  ])('a protective clause does NOT disarm an accompanying edit: %j', (message) => {
    expect(hasExplicitNoModelChangeIntent(message), 'predicate over-fired').toBe(false);
    expect(hasMutationWarrantSignal(message)).toBe(true);
  });

  it('the veto predicate fires on NO genuine edit in the corpus', () => {
    const overfired = EDITS.filter((c) => hasExplicitNoModelChangeIntent(c.message));
    expect(overfired.map((c) => c.message)).toEqual([]);
  });

  /**
   * ⭐ THE COMPLETE DELTA. The justification for consulting an existing
   * authority is that it moves the two rows it was built to answer and nothing
   * else. If a third row moves, that claim is void and this REDs by naming it.
   */
  it('DELTA — exactly the two veto rows change against base', () => {
    const moved = CORPUS.filter(
      (c) => hasMutationWarrantSignal(c.message) !== c.baseWarrant,
    ).map((c) => c.message);
    expect([...moved].sort()).toEqual([...EXPLICIT_VETOES].sort());
  });

  it('GAPS — no genuine edit loses its warrant', () => {
    const gaps = EDITS.filter((c) => !hasMutationWarrantSignal(c.message)).map((c) => c.message);
    const baseGaps = EDITS.filter((c) => !c.baseWarrant).map((c) => c.message);
    expect(gaps).toEqual(baseGaps);
    expect(gaps.length).toBe(2);
  });

  it('LIES — 15 -> 13, and the remainder is EXACTLY the recorded set', () => {
    const lies = NON_EDITS.filter((c) => hasMutationWarrantSignal(c.message)).map((c) => c.message);
    const baseLies = NON_EDITS.filter((c) => c.baseWarrant).map((c) => c.message);
    expect(baseLies.length).toBe(15);
    expect([...lies].sort()).toEqual([...KNOWN_UNFIXED_LIES].sort());
    expect(lies.length).toBe(13);
  });

  /**
   * The superset relation and its ONE sanctioned exception, asserted here too
   * because this corpus — unlike the one beside the invariant — actually
   * contains the class that forks it.
   */
  it('SUPERSET — holds for every canonical hit that is not an explicit veto', () => {
    const canonical = CORPUS.filter((c) => hasMutationSignal(c.message));
    expect(canonical.length).toBeGreaterThan(0); // pin the precondition
    for (const testCase of canonical) {
      const expected = !hasExplicitNoModelChangeIntent(testCase.message);
      expect(
        hasMutationWarrantSignal(testCase.message),
        `${testCase.message} — superset forked for a reason other than an explicit veto`,
      ).toBe(expected);
    }
  });
});
