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
  { label: "NON_EDIT", message: "What did the hiring cost update do? Update budget?", baseWarrant: true },

  // ─────────────────────────────────────────────────────────────────────────
  // ⭐⭐ THE EDIT + SCOPE-FENCE CLASS. ADDED BECAUSE ITS ABSENCE WAS THE ROOT
  // CAUSE OF THIS ROUND, NOT AS AN AFTERTHOUGHT TO THE CODE FIX.
  //
  // Every one of the 23 EDIT rows above is free of prohibition wording, so this
  // corpus was STRUCTURALLY INCAPABLE of observing what an explicit-veto term
  // does to a fenced edit. The first arrangement of Term 0 stripped the warrant
  // from 81 of 81 rows in a 9-core x 9-fence matrix, and every assertion in this
  // file stayed green (CLAUDE.md trap 22).
  //
  // These are ordinary business English: an instruction, plus a fence telling
  // the assistant to stay inside it. They MUST warrant. Measured at c8eb71ec:
  // all true. Each rides a canonical or constraint signal, which is what the
  // conjuncts in Term 0 consult.
  { label: "EDIT", message: "Set Churn to 0.5 and do not change the model.", baseWarrant: true },
  { label: "EDIT", message: "Increase hiring cost to 0.9 but do not change the model.", baseWarrant: true },
  { label: "EDIT", message: "Add an edge from pricing to churn. Do not change the model.", baseWarrant: true },
  { label: "EDIT", message: "Lower the discount rate to 0.05 and never change the model.", baseWarrant: true },
  { label: "EDIT", message: "Raise the price ceiling to 120, and do not change the current causal model.", baseWarrant: true },
  { label: "EDIT", message: "Update churn to 0.03 and don't change the graph.", baseWarrant: true },

  // ⭐ THE CONSTRAINT-ONLY HALF, AND IT IS HERE BECAUSE A MUTANT SURVIVED WITHOUT IT.
  // Term 0 negates TWO signals. With only the rows above, deleting the
  // `!hasConstraintMutationSignal` conjunct changed nothing any assertion could
  // see — every fenced row that rode the constraint list ALSO rode the canonical
  // one, so the second conjunct was never independently load-bearing in the
  // corpus. These two ride the constraint list ALONE (hasMutationSignal = false),
  // which is what makes that conjunct's mutant bite.
  { label: "EDIT", message: "Keep churn below 3% and do not change the model.", baseWarrant: true },
  { label: "EDIT", message: "Cap the hiring cost at 0.9 and do not change the model.", baseWarrant: true },

  // The same class, but the edit rides `isEditRequestShape` ALONE — no canonical
  // and no constraint signal. Term 0's conjuncts cannot see it, so these STILL
  // lose their warrant. Genuine edits, genuinely broken, pinned as
  // KNOWN_OPEN_GAPS rather than left invisible.
  { label: "EDIT", message: "Edit hiring cost to 0.9 and do not change the model.", baseWarrant: true },
  { label: "EDIT", message: "Reduce churn to 0.02 and do not change the model.", baseWarrant: true },

  // ⛔ THE RETRACTION. The user asked for an edit and then took it back in the
  // same breath. The correct answer is NO WARRANT; this file records that we
  // grant one. See KNOWN_OPEN_LIES for why it is not being "fixed".
  { label: "NON_EDIT", message: "Set Churn to 0.5 - actually no, do not change the model.", baseWarrant: true },];

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

/**
 * ⛔ KNOWN-OPEN **GAP** — genuine edits that do NOT get a warrant. Pinned, not fixed.
 *
 * These ride `isEditRequestShape` ALONE: `hasMutationSignal` and
 * `hasConstraintMutationSignal` are both FALSE for them. Term 0 refuses when the
 * user fenced the turn AND both canonical lists are silent, so exactly this
 * shape falls through the conjuncts. Closing it needs the veto predicate to
 * consult its own affirmative-edit check on the unbounded path — a change to
 * `hasExplicitNoModelChangeIntent` itself, not to the warrant — which is a
 * larger, separately-reviewable piece of work.
 *
 * Asserted EXACTLY, so this REDs if it GROWS (more edits silently dropped) or
 * SHRINKS (someone fixed one — move it out of here and say so).
 */
const KNOWN_OPEN_GAPS: readonly string[] = [
  "Edit hiring cost to 0.9 and do not change the model.",
  "Reduce churn to 0.02 and do not change the model.",];

/**
 * ⛔⛔ KNOWN-OPEN **LIE** — a retraction that still gets a warrant. THE PRICE OF
 * THE FENCE FIX, PAID KNOWINGLY AND WRITTEN DOWN.
 *
 * Unguarded Term 0 refused this row, correctly. Adding the conjuncts that
 * rescued 72 of 81 fenced edits also rescued this one, and it should not have
 * been. That is a real, disclosed regression against the previous arrangement —
 * accepted because "edit + scope fence" is ordinary business English and a
 * mid-sentence retraction is a narrower, rarer construction.
 *
 * ⛔ DO NOT WRITE A PREDICATE TO SEPARATE THIS FROM A SCOPE FENCE.
 * "…and do not change anything else" must warrant; "…actually no, do not change
 * the model" must not. That is a natural-language discrimination over trailing
 * clauses, and this estate has already burned FOUR consecutive rounds on exactly
 * that shape on exactly this module — each round closing one direction and
 * reopening the other under a fully green suite — before closing PR #1107 after
 * five variants across two independent corpora. The standing ruling is that no
 * further punctuation-only or lexical rule will settle it. If you find yourself
 * writing that predicate, STOP and report.
 *
 * Asserted EXACTLY, in both directions, for the same reason as the set above.
 */
const KNOWN_OPEN_LIES: readonly string[] = [
  "Set Churn to 0.5 - actually no, do not change the model.",];

const EDITS = CORPUS.filter((c) => c.label === 'EDIT');
const NON_EDITS = CORPUS.filter((c) => c.label === 'NON_EDIT');

describe('mutation warrant consults the explicit veto', () => {
  it('CORPUS_INTEGRITY — both directions present, no duplicates', () => {
    // A corpus that silently lost its EDIT half would let every GAP assertion
    // pass while proving nothing about the direction it exists to guard.
    expect(CORPUS.length).toBe(59);
    expect(EDITS.length).toBe(33);
    expect(NON_EDITS.length).toBe(26);
    expect(new Set(CORPUS.map((c) => c.message)).size).toBe(CORPUS.length);

    // ⭐ THE BLIND SPOT THAT CAUSED THIS ROUND, NOW PINNED AS A PROPERTY OF THE
    // CORPUS ITSELF. The original 23 EDIT rows contained ZERO prohibition
    // wording, so no assertion in this file could observe what an explicit-veto
    // term does to a fenced edit. Closing the code without closing the corpus
    // would leave the next author exactly where this one started.
    const fencedEdits = EDITS.filter((c) => /\b(?:do not|don't|never)\b/i.test(c.message));
    expect(fencedEdits.length, 'the fenced-edit class vanished from the corpus').toBe(10);
    // Every known-open row must actually be IN the corpus, or these sets pin nothing.
    const messages = new Set(CORPUS.map((c) => c.message));
    for (const m of [...KNOWN_OPEN_GAPS, ...KNOWN_OPEN_LIES]) {
      expect(messages.has(m), `known-open row missing from CORPUS: ${m}`).toBe(true);
    }
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

  /**
   * ⚠ THIS TEST USED TO ASSERT THE VETO PREDICATE FIRES ON **NO** GENUINE EDIT,
   * AND THAT WAS ONLY TRUE BECAUSE THE CORPUS HAD NO FENCED EDITS IN IT.
   *
   * It fires on all 8 of them — that is the whole point of the class, and it is
   * precisely why consulting the predicate ALONE was unsafe. The honest form is
   * to assert it over-fires on no edit that carries no fence, and to state the
   * fenced count separately so a change to either number is visible.
   */
  it('the veto predicate fires on no UNFENCED edit, and on every fenced one', () => {
    const fenced = EDITS.filter((c) => /\b(?:do not|don't|never)\b/i.test(c.message));
    const unfenced = EDITS.filter((c) => !/\b(?:do not|don't|never)\b/i.test(c.message));
    expect(unfenced.length, 'the unfenced edit half drifted').toBe(23);
    expect(fenced.length, 'the fenced edit half drifted').toBe(10);

    const overfired = unfenced.filter((c) => hasExplicitNoModelChangeIntent(c.message));
    expect(overfired.map((c) => c.message)).toEqual([]);

    // The contrast half: without this, the assertion above would pass just as
    // well if the veto predicate had stopped firing on anything at all.
    const underfired = fenced.filter((c) => !hasExplicitNoModelChangeIntent(c.message));
    expect(underfired.map((c) => c.message)).toEqual([]);
  });

  /**
   * ⭐ THE COMPLETE DELTA. The justification for consulting an existing
   * authority is that it moves the two rows it was built to answer and nothing
   * else. If a third row moves, that claim is void and this REDs by naming it.
   */
  it('DELTA — exactly the two veto rows and the two known-open gaps change against base', () => {
    const moved = CORPUS.filter(
      (c) => hasMutationWarrantSignal(c.message) !== c.baseWarrant,
    ).map((c) => c.message);
    // The vetoes moved because this change fixes them. The known-open gaps moved
    // because it breaks them, which is why they are named here rather than
    // absorbed into a looser assertion. Anything else moving voids the claim
    // that this change touches only what it says it touches.
    expect([...moved].sort()).toEqual([...EXPLICIT_VETOES, ...KNOWN_OPEN_GAPS].sort());
  });

  it('GAPS — the only edits without a warrant are the base gaps plus the recorded known-open set', () => {
    const gaps = EDITS.filter((c) => !hasMutationWarrantSignal(c.message)).map((c) => c.message);
    const baseGaps = EDITS.filter((c) => !c.baseWarrant).map((c) => c.message);
    expect(baseGaps.length, 'base gap count drifted').toBe(2);
    expect([...gaps].sort()).toEqual([...baseGaps, ...KNOWN_OPEN_GAPS].sort());
    expect(gaps.length).toBe(4);
  });

  /**
   * ⭐⭐ THE ROWS THIS CHANGE EXISTS TO RESCUE, ASSERTED POSITIVELY AND BY NAME.
   *
   * Kept as its OWN test rather than folded into GAPS above, and that is a
   * deliberate binding decision. GAPS is legitimately sensitive to Term 3 — break
   * `isEditRequestShape` and rows unrelated to this change become gaps, so GAPS
   * REDs for reasons that have nothing to do with the conjuncts. It therefore
   * cannot discriminate "these rows are rescued BY TERM 0's conjuncts" from
   * "something else in the function moved". Measured: with GAPS as the target, a
   * Term 3 mutant RED — which would have been read as this class biting when it
   * was not.
   *
   * This test binds to the conjuncts alone. Every row below is a canonical or
   * constraint hit, so it returns before Term 3 is ever reached, and the
   * discriminating mutant pair is:
   *   remove either conjunct  -> this REDs
   *   break Term 3            -> this stays GREEN
   */
  it('RESCUED — a scope fence does not strip a canonical or constraint edit', () => {
    const rescued = EDITS
      .filter((c) => /\b(?:do not|don't|never)\b/i.test(c.message))
      .filter((c) => !KNOWN_OPEN_GAPS.includes(c.message));
    expect(rescued.length, 'the rescued fenced-edit rows vanished').toBe(8);

    // Both conjuncts must be independently load-bearing in this set, or one of
    // their mutants survives with nothing to say. Pinned so it stays that way.
    const canonicalRidden = rescued.filter((c) => hasMutationSignal(c.message));
    const constraintOnly = rescued.filter((c) => !hasMutationSignal(c.message));
    expect(canonicalRidden.length, 'no canonical-ridden fenced edit').toBe(6);
    expect(constraintOnly.length, 'no constraint-ONLY fenced edit — the second conjunct is unpinned').toBe(2);

    for (const c of rescued) {
      // Precondition pinned in-test: this really IS a fenced edit, i.e. the veto
      // predicate fires on it. Otherwise the warrant below could be true simply
      // because Term 0 never engaged, and the row would prove nothing.
      expect(hasExplicitNoModelChangeIntent(c.message), `not a fenced edit: ${c.message}`).toBe(true);
      expect(hasMutationWarrantSignal(c.message), `fenced edit lost its warrant: ${c.message}`).toBe(true);
    }
  });

  it('LIES — 16 -> 14, and the remainder is EXACTLY the two recorded sets', () => {
    const lies = NON_EDITS.filter((c) => hasMutationWarrantSignal(c.message)).map((c) => c.message);
    const baseLies = NON_EDITS.filter((c) => c.baseWarrant).map((c) => c.message);
    expect(baseLies.length).toBe(16);
    expect([...lies].sort()).toEqual([...KNOWN_UNFIXED_LIES, ...KNOWN_OPEN_LIES].sort());
    expect(lies.length).toBe(14);
  });

  /**
   * ⭐ THE SUPERSET RELATION, UNCONDITIONAL — AND THIS IS THE FILE WHERE IT
   * ACTUALLY EXECUTES.
   *
   * ⚠ THE EARLIER FORM OF THIS TEST CARRIED A "NOT AN EXPLICIT VETO" EXCEPTION,
   * AND THAT BRANCH WAS DEAD HERE TOO. Measured: of the corpus rows that satisfy
   * `hasMutationSignal`, the number that are ALSO an explicit veto was ZERO, so
   * the computed expectation was TRUE for every row and the exception never ran.
   * It is gone rather than carved out, because the fork it admitted does not
   * exist: Term 0 refuses only when `hasMutationSignal` is FALSE. Measured over
   * 1,093,500 generated canonical-hit messages: 0 forks, against 850,500 with an
   * unguarded Term 0.
   *
   * ⭐ The fenced-edit rows added above are what make this file's copy of the
   * invariant load-bearing rather than decorative: they are canonical hits that
   * ARE explicit vetoes, so they are exactly the rows an unguarded Term 0 forks.
   */
  it('SUPERSET — every canonical hit gets a warrant, no exceptions', () => {
    const canonical = CORPUS.filter((c) => hasMutationSignal(c.message));
    // Pin the precondition AND its size: a corpus that quietly stopped containing
    // canonical hits would leave this loop asserting nothing, which is exactly
    // how the copy of this invariant in mutation-warrant.test.ts read as coverage
    // for 43 rows while executing zero times.
    expect(canonical.length, 'canonical-hit rows drifted').toBe(22);

    // The rows that make this test discriminating — canonical hits that are also
    // explicit vetoes. If this ever reads 0, the invariant above is vacuous
    // against the only class that can fork it, and this REDs to say so.
    const forkable = canonical.filter((c) => hasExplicitNoModelChangeIntent(c.message));
    expect(forkable.length, 'no canonical hit is an explicit veto — invariant is vacuous').toBe(7);

    for (const testCase of canonical) {
      expect(
        hasMutationWarrantSignal(testCase.message),
        `${testCase.message} — superset forked`,
      ).toBe(true);
    }
  });
});
