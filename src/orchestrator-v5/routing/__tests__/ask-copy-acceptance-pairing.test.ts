/**
 * ⭐⭐ NEVER ASK WHAT YOU CANNOT ACCEPT (P8) — enforced, not documented.
 *
 * THE DEFECT CLASS. `compose/configure-option-clarify-response.ts` records what
 * happens without this guard: the recovery copy ended `— 0.6, say.` and called
 * the exemplar *"wire-proven to route"*. The exemplar was; the SHAPE the copy
 * wrapped it in was not, and all three deterministic readers returned null on
 * the sentence the product itself suggested. `parameter-user-phrasing.ts`
 * states the rule that broke: *recovery copy must only recommend an input the
 * system can CURRENTLY accept*.
 *
 * SO THIS FILE DRIVES THE REAL BINDER OVER THE REAL COPY'S OWN EXEMPLARS. It
 * cannot be satisfied by a fixture, and it REDs in both directions — if the copy
 * gains a form the binder refuses, and if the binder narrows past a form the
 * copy advertises.
 */

import { describe, expect, it } from 'vitest';

import {
  MISSING_VALUE_ASK_EXEMPLARS,
  MISSING_VALUE_ASK_FORMAT_HINT,
  MISSING_VALUE_NO_CHANGE_PHRASE,
  MISSING_VALUE_NO_CHANGE_PHRASES,
  readMissingValueAnswer,
} from '../missing-value-answer.js';
import { resolveRepairValueBinding } from '../repair-value-binding.js';
import { projectReadinessRecovery } from '../../coaching/readiness-recovery.js';

const READINESS = {
  status: 'needs_user_input',
  blockers: [
    {
      blocker_type: 'missing_value',
      option_id: 'opt-hire',
      option_label: 'Hire two engineers',
      factor_id: 'fac-payroll',
      factor_label: 'Payroll cost',
    },
  ],
};

describe('every phrasing the ask offers is one the binder accepts', () => {
  it('the exemplar list is non-empty — a vacuous guard is not a guard', () => {
    // Trap 13: an assertion over an empty list passes by testing nothing.
    expect(MISSING_VALUE_ASK_EXEMPLARS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MISSING_VALUE_ASK_EXEMPLARS.map((e) => [e.form, e.example] as const))(
    'the "%s" form, written as "%s", reads as a numeric answer AND binds to the asked pair',
    (_form, exemplar) => {
      const reading = readMissingValueAnswer(exemplar);
      expect(reading, `the copy offers "${exemplar}" and the reader returns null`).not.toBeNull();
      expect(reading?.kind).toBe('numeric');

      const resolved = resolveRepairValueBinding({
        message: exemplar,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `"${exemplar}" does not resolve`).toBe(true);
      if (!resolved.matched) return;
      expect(resolved.kind).toBe('bind');
      if (resolved.kind !== 'bind') return;
      // Bound BY IDENTITY, not by value (trap 19).
      expect(resolved.pair.optionId).toBe('opt-hire');
      expect(resolved.pair.factorId).toBe('fac-payroll');
      // And the figure it would write is inside the producer's own 0-1 scale.
      const written = Number(resolved.valueText);
      expect(Number.isFinite(written)).toBe(true);
      expect(written).toBeGreaterThanOrEqual(0);
      expect(written).toBeLessThanOrEqual(1);
    },
  );

  it('the hint SENTENCE is built FROM the anchors, not spelled beside them', () => {
    // A second spelling is the copy that rots (trap 12). The two ANCHORS the
    // list declares are the two figures the sentence may contain, and both must
    // appear verbatim in the sentence a user reads.
    const [low, high] = MISSING_VALUE_ASK_EXEMPLARS;
    expect(MISSING_VALUE_ASK_FORMAT_HINT).toContain(low!.example);
    expect(MISSING_VALUE_ASK_FORMAT_HINT).toContain(high!.example);
  });

  it('⛔ THE ASK DOES NOT OFFER "no change" — P8 CHECKS THE ROUTE, NOT ONLY THE READER', () => {
    // ⚠⚠ THIS ASSERTION IS THE INVERSE OF THE ONE IT REPLACES, and the flip is
    // the finding. This lane advertised `Say "no change" if the option leaves it
    // alone.` and pinned it here as a THIRD offered answer — on the strength of
    // the reader recognising it.
    //
    // ⛔ RECOGNITION IS NOT A ROUTE. Measured end to end: `kind: 'no_change'`
    // has ONE consumer, whose two call sites are gated on
    // `detectConfigureOptionIntent`, and **0 of 225 accepted no-change phrasings
    // match that detector** (positive control fired; fabricated control
    // declined). The honest reply appeared in **0 of 8** live compositions, and
    // the invitation contradicted the refusal inside a single message:
    //   "I can't put 'no change' on that link — the effect value has to be a
    //    number… Say 'no change' if the option leaves it alone."
    //
    // ⚠ AND THIS FILE IS WHY IT SHIPPED. Every other guard here drives
    // `readMissingValueAnswer` and proves an advertised form is RECOGNISED —
    // which is necessary and nowhere near sufficient. A form may only be
    // ADVERTISED once its route is witnessed end to end.
    expect(MISSING_VALUE_ASK_FORMAT_HINT).not.toContain(MISSING_VALUE_NO_CHANGE_PHRASE);
    expect(MISSING_VALUE_ASK_FORMAT_HINT.toLowerCase()).not.toContain('leaves it alone');
  });

  it('…but the READER still recognises it — removing the offer removed nothing else', () => {
    // ⭐ THE OPPOSITE-DIRECTION TWIN OF THE SUBTRACTION. Withdrawing an
    // invitation must not withdraw the honest answer: someone will say it
    // anyway, and they must still get a reply rather than the demand repeating.
    // If this ever goes red alongside the block above, the fix over-subtracted.
    for (const phrase of MISSING_VALUE_NO_CHANGE_PHRASES) {
      expect(readMissingValueAnswer(phrase)?.kind, phrase).toBe('no_change');
    }
    // Precondition pin: the vocabulary is non-empty, so the loop is a
    // measurement rather than a guard agreeing with itself (trap 13).
    expect(MISSING_VALUE_NO_CHANGE_PHRASES.length).toBeGreaterThan(0);
  });

  it('⛔ THE ASK DESCRIBES AN ABSOLUTE ASSIGNMENT, NEVER CAUSAL STRENGTH', () => {
    // ⚠⚠ THIS GUARD REPLACES A `toContain('percentage')` ASSERTION, and the
    // swap is a STRENGTHENING, not a relaxation — recorded here because a
    // weakened guard that looks like a tidy-up is how this estate loses seams.
    //
    // The old assertion checked the ask named the NOTATION. It was satisfied by
    // the sentence Codex blocked this PR over — *"How strong is that effect?
    // … 0% if this option does nothing to it"* — which named the notation
    // correctly and the QUANTITY falsely. A user who followed it set a real
    // cost to zero.
    //
    // Measured on deployed ISL `28fe0c95`: the value is `do(X=x)`, an absolute
    // assignment of the factor's own level. So the properties worth guarding are
    // semantic, and the notation is carried by the `%` in the anchors above.
    const hint = MISSING_VALUE_ASK_FORMAT_HINT.toLowerCase();

    // (a) It must not ask about the STRENGTH of an effect.
    expect(hint).not.toContain('how strong');
    expect(hint).not.toContain('strength');
    // (b) It must never gloss the low anchor as "no effect" — that is the exact
    //     false equivalence that made zeroing a cost look like the safe answer.
    expect(hint).not.toContain('does nothing to it');
    expect(hint).not.toContain('no effect');
    // (c) It must not describe the number as the SIZE OF A CHANGE either — that
    //     is change-from-baseline, refuted by the same four-way discriminator.
    expect(hint).not.toMatch(/how (?:big|much) (?:the|a) (?:change|difference) is/);
    // (d) Positive control — the guard must be capable of failing. It asserts
    //     the sentence says what the number IS, so a sentence that dropped the
    //     claim entirely would RED here rather than passing silently.
    expect(hint).toContain('level');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⭐⭐⭐ THE TWO HARMS, EACH WITH ITS OPPOSITE-DIRECTION TWIN.
  //
  // One seam, two opposite failures, and they CANNOT SHARE A WINDOW (trap 22b).
  // The estate lost four consecutive rounds on one such predicate, each round
  // fixing one direction and silently reopening the other, every round under a
  // fully green suite. So both directions are pinned here, together, and each
  // names the harm it prevents.
  // ══════════════════════════════════════════════════════════════════════════

  it.each(MISSING_VALUE_NO_CHANGE_PHRASES.map((p) => [p] as const))(
    'HARM 1 — "%s" means NO CHANGE and must never bind an intervention of 0',
    (phrase) => {
      const answer = readMissingValueAnswer(phrase);
      expect(answer, `"${phrase}" reads as nothing at all`).not.toBeNull();
      // Bound by KIND, not by a value predicate another reading could satisfy.
      expect(answer?.kind, `"${phrase}" must read no_change`).toBe('no_change');
      // ⛔ THE HARM, STATED AS AN ASSERTION: a user saying "this option leaves
      // that factor alone" must NEVER produce the number 0. On deployed ISL
      // `28fe0c95` an intervention is `do(X=x)`, so 0 SETS the factor to zero —
      // a real cost, duration or headcount driven to nothing.
      expect(answer?.kind).not.toBe('numeric');
      // And it must not be demoted to an uninterpretable word either: this is a
      // phrase the product UNDERSTANDS and must answer, not quote back.
      expect(answer?.kind).not.toBe('qualitative');
    },
  );

  it.each([
    ['0%', 0],
    ['0', 0],
    ['set it to 0', 0],
    ['set it to 0%', 0],
    ['0.0', 0],
  ] as const)(
    'HARM 2 (TWIN) — "%s" means DRIVE IT TO ZERO and must never read as no_change',
    (phrase, expected) => {
      const answer = readMissingValueAnswer(phrase);
      expect(answer, `"${phrase}" reads as nothing at all`).not.toBeNull();
      // ⛔ THE MIRROR HARM: a user saying "this option drives it to zero" must
      // NEVER be recorded as "no intervention". That would silently discard a
      // genuine, decision-relevant effect — and, because ISL evaluates an empty
      // `interventions={}` on the SAMPLED draws, it would also restore a
      // variance the user had just told us is gone.
      expect(answer?.kind, `"${phrase}" must stay numeric`).toBe('numeric');
      if (answer?.kind !== 'numeric') return;
      expect(Number(answer.modelUnitText)).toBe(expected);
    },
  );

  // ⭐⭐ A HAND-WRITTEN CORPUS, DELIBERATELY *NOT* DERIVED FROM THE EXPORTED SET
  // — and this is the only thing in the file that can notice the set is SHORT.
  //
  // `HARM 1` above iterates `MISSING_VALUE_NO_CHANGE_PHRASES`, so it proves the
  // reader AGREES with the list and is structurally blind to a member being
  // removed: delete a phrase and you delete its own test case, and the suite
  // stays green (trap 12d — deriving a guard MOVES the risk, it does not remove
  // it). These are written out, so a shrinking vocabulary REDs here.
  //
  // ⚠ THEY ARE ALSO THE ONLY CASES IN THIS FILE NOT SOURCED FROM THE AUTHOR'S
  // MODEL OF THE READER. Every one is a phrasing measured reading `null` at
  // pristine `a77979ec` — i.e. a real dead end, not an imagined one.
  it.each([
    'no change',
    'No change.',
    'no effect',
    'unchanged',
    'it does nothing to it',
    'this option does nothing to it',
    'it leaves it unchanged',
    'it stays the same',
    "it doesn't affect it",
  ])('CORPUS (underived) — "%s" must read as no_change', (phrase) => {
    expect(readMissingValueAnswer(phrase)?.kind).toBe('no_change');
  });

  it('the two directions are DISCRIMINATED, not merely both handled', () => {
    // ⚠ A GUARD THAT PINS ITS OWN PRECONDITION (trap 13b). Each block above
    // could pass while the reader answered the SAME way to both classes — if,
    // say, everything read numeric. This asserts the reader actually
    // distinguishes them, so the pair cannot decay into two tests of one branch.
    const noChange = readMissingValueAnswer(MISSING_VALUE_NO_CHANGE_PHRASE);
    const zero = readMissingValueAnswer('0%');
    expect(noChange?.kind).not.toBe(zero?.kind);
    expect(noChange?.kind).toBe('no_change');
    expect(zero?.kind).toBe('numeric');
  });

  it('⚠⚠ THE HINT NEVER NAMES THE INTERNAL REPRESENTATION — the founder ruling', () => {
    // A strategic user is never asked to understand Olumi's normalised
    // coefficient scale. The ONLY figures permitted in the ask are the two
    // human anchors; anything of the form `0.x` is the internal representation
    // leaking into user copy, and a mid-scale specimen is additionally a number
    // put in the user's mouth (the property `post-draft-narrative.test.ts`
    // independently guards).
    expect(MISSING_VALUE_ASK_FORMAT_HINT).not.toMatch(/\b0\.\d/);
    const anchors = new Set(
      MISSING_VALUE_ASK_EXEMPLARS.slice(0, 2).map((e) => e.example.replace('%', '')),
    );
    const figures = MISSING_VALUE_ASK_FORMAT_HINT.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
    expect(figures.length, 'the ask must contain figures — else this is vacuous').toBeGreaterThan(0);
    expect(figures.every((f) => anchors.has(f)), figures.join(',')).toBe(true);
  });
});

describe('the on-screen ask carries the hint', () => {
  it('the provide_value recovery names the slot AND says what an answer looks like', () => {
    const projection = projectReadinessRecovery(READINESS as never, [
      { id: 'opt-hire', kind: 'option', label: 'Hire two engineers' },
      { id: 'fac-payroll', kind: 'factor', label: 'Payroll cost' },
    ] as never);

    expect(projection.kind).toBe('provide_value');
    // The slot, unchanged.
    expect(projection.nextStep).toContain('Hire two engineers');
    expect(projection.nextStep).toContain('Payroll cost');
    expect(projection.nextStep).toContain('choose the missing effect value');
    // ⭐ AND THE FORMAT — the half a tester had no way to know at pristine.
    expect(projection.nextStep).toContain(MISSING_VALUE_ASK_FORMAT_HINT);
  });

  it('⭐⭐ THE OUTCOME METRIC — the ask says how many more there are', () => {
    // MEASURED wire-level on the same deployed build: recovery clears the
    // blocker it asked about 9 of 10 times, and terminates in a RUN 1 of 10.
    // Drafts carry 3-8 missing effect values and the affordance surfaces one, so
    // a user who answers perfectly clears one of eight and cannot tell whether
    // they are one step from a run or seven. Trap 23 in the live product.
    const many = {
      status: 'needs_user_input',
      blockers: [1, 2, 3, 4, 5].map((n) => ({
        blocker_type: 'missing_value',
        option_id: `opt-${n}`, option_label: `Option ${n}`,
        factor_id: `fac-${n}`, factor_label: `Factor ${n}`,
      })),
    };
    const p = projectReadinessRecovery(many as never, [] as never);
    expect(p.kind).toBe('provide_value');
    expect(p.nextStep).toContain('There are 4 more effect values to set after this one');
    // ⚠⚠ AND IT NAMES A COUNT, NOT THE PAIRS — the discriminating half, and the
    // reason is a misbind class. If the ask LISTED all five, a user replying
    // "60%" would have it bound to `blockers[0]` by `deriveOnScreenEffectAsk`,
    // whose entire justification is that a bare figure's only antecedent is the
    // ONE question on screen. A batched ASK is fine; a batched order-guessed
    // WRITE is banned, and listing the set is one edit away from it.
    for (const n of [2, 3, 4, 5]) {
      expect(p.nextStep, `Option ${n}`).not.toContain(`Option ${n}`);
      expect(p.nextStep, `Factor ${n}`).not.toContain(`Factor ${n}`);
    }
    // Exactly one question is live, and it is the head.
    expect(p.nextStep).toContain('Option 1');
    expect(p.nextStep).toContain('Factor 1');
  });

  it('⚠ THE TWIN — with ONE outstanding value the ask says nothing about more', () => {
    // "and 0 more after this" is noise, and the single-blocker case is the one
    // that actually ends in a run.
    const p = projectReadinessRecovery(READINESS as never, [] as never);
    expect(p.kind).toBe('provide_value');
    expect(p.nextStep).not.toMatch(/more effect value/);
  });

  it('⚠ the hint is NOT added to asks that are about something else', () => {
    // The DISCRIMINATING half: a guard that fired everywhere would prove nothing
    // about the branch it names. A blocked graph renders "resolve the model
    // issue", where an effect-value format hint would be noise at best and a
    // wrong instruction at worst.
    const blocked = projectReadinessRecovery(
      { ...READINESS, status: 'blocked' } as never,
      [] as never,
    );
    expect(blocked.kind).toBe('resolve_model_issue');
    expect(blocked.nextStep).not.toContain(MISSING_VALUE_ASK_FORMAT_HINT);

    const ready = projectReadinessRecovery({ status: 'ready', blockers: [] } as never, [] as never);
    expect(ready.kind).toBe('run');
    expect(ready.nextStep).not.toContain(MISSING_VALUE_ASK_FORMAT_HINT);
  });
});
