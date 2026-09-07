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
  CONTENTFUL_SUBJECT_KNOWN_DROPPED,
  MISSING_VALUE_ASK_EXEMPLARS,
  MISSING_VALUE_ASK_FORMAT_HINT,
  MISSING_VALUE_NO_CHANGE_PHRASE,
  MISSING_VALUE_NO_CHANGE_PHRASES,
  messageAnswersMissingValueAsk,
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

  // ══════════════════════════════════════════════════════════════════════════
  // ⭐⭐⭐ THE ASK STATES ITS ANSWER SHAPE — measured, not assumed.
  //
  // Every guard above pairs the ask's SCALE claim with acceptance. None of them
  // asked the question a stuck user actually has: **what do I type?** The hint
  // explained what the number MEANS and never what a reply should LOOK like, so
  // the product posed a prose question and accepted only a bare figure — and the
  // two forms were never introduced to each other.
  //
  // MEASURED AT PRISTINE `fa2c9e93`, reader + route, one live claimant
  // (`probe-matrix` / `probe-route`, both directions, controls firing):
  //
  //   BINDS     "30%" · "about 30%" · "roughly 30%" · "maybe 30%" · "I think 30%"
  //             · "set it to 30%" · "0%" · "100%" · "0.6"
  //   DEAD-END  "it's about 30%" · "it's 30%" · "that would be 30%"
  //             · "my guess is 30%" · "Churn rate is 30%" · "Handling time is 30%"
  //             · "it reaches 30%" · "Thirty percent" · "approx 30%"
  //
  // Sixteen ordinary answers where the IDENTICAL demand repeats. The fix is not
  // a wider parser — that was tried and parked after five oscillating rounds
  // (trap 22f). It is to ASK FOR WHAT THE BINDER CONSUMES, which the ask had
  // simply never said.
  // ══════════════════════════════════════════════════════════════════════════
  it('⭐ THE ASK SAYS WHAT A REPLY LOOKS LIKE, not only what the number means', () => {
    // The scale claim is necessary and was never sufficient. A user cannot
    // infer "send a bare figure" from a sentence about what the figure denotes.
    expect(
      MISSING_VALUE_ASK_FORMAT_HINT,
      'the ask explains the scale but never states the answer SHAPE — '
        + 'a user replying "Churn rate is 30%" gets the identical demand back',
    ).toMatch(/\bjust the percentage\b/i);
  });

  it('⭐⭐ EVERY FIGURE THE RENDERED ASK OFFERS BINDS — extracted at RUNTIME from the sentence a user reads', () => {
    // ⚠⚠ THIS IS STRICTLY STRONGER THAN THE `it.each` OVER THE EXEMPLAR LIST,
    // and the difference is the whole point. That guard drives the LIST; this
    // one drives THE STRING THE PRODUCT ACTUALLY EMITS. The hint is composed
    // from `MISSING_VALUE_ASK_EXEMPLARS[0]` and `[1]` today — but nothing stops
    // a future edit spelling a third figure inline, and a list-driven guard is
    // structurally blind to a form the copy gained without the list (trap 12d:
    // deriving a guard MOVES the risk, it does not remove it).
    //
    // So: render the real recovery, scrape every percentage out of the prose,
    // and drive each through the REAL route.
    const projection = projectReadinessRecovery(READINESS as never, [
      { id: 'opt-hire', kind: 'option', label: 'Hire two engineers' },
      { id: 'fac-payroll', kind: 'factor', label: 'Payroll cost' },
    ] as never);
    expect(projection.kind).toBe('provide_value');

    const offered = projection.nextStep.match(/\d+(?:\.\d+)?%/g) ?? [];
    // Precondition pin (trap 13): a scrape that found nothing would pass the
    // loop below by iterating zero times. Assert the instrument SAW something,
    // and saw the anchors the copy owner declares.
    expect(offered.length, `no figure found in: ${projection.nextStep}`).toBeGreaterThanOrEqual(2);
    expect(offered).toContain(MISSING_VALUE_ASK_EXEMPLARS[0]!.example);
    expect(offered).toContain(MISSING_VALUE_ASK_EXEMPLARS[1]!.example);

    for (const example of offered) {
      const reading = readMissingValueAnswer(example);
      expect(reading, `the ask offers "${example}" and the reader returns null`).not.toBeNull();

      const resolved = resolveRepairValueBinding({
        message: example,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `the ask offers "${example}" and the route refuses it`).toBe(true);
      if (!resolved.matched) continue;
      expect(resolved.kind).toBe('bind');
      if (resolved.kind !== 'bind') continue;
      // Bound to the pair the SAME sentence names — by identity, never by value.
      expect(resolved.pair.optionId).toBe('opt-hire');
      expect(resolved.pair.factorId).toBe('fac-payroll');
      const written = Number(resolved.valueText);
      expect(written).toBeGreaterThanOrEqual(0);
      expect(written).toBeLessThanOrEqual(1);
    }
  });

  it('⭐ THE OPPOSITE DIRECTION — an out-of-scale or unqualified figure still mints NOTHING', () => {
    // The twin of the guard above. Widening what the ask ADVERTISES must never
    // widen what the route WRITES: a bare magnitude with no unit is exactly the
    // two-scales-under-one-name cliff the design refuses (is `30` 0.30 or 30?),
    // and it must stay refused.
    for (const refused of ['30', '40,000', '150%', '8 minutes']) {
      const resolved = resolveRepairValueBinding({
        message: refused,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `"${refused}" must not reach a write`).toBe(false);
    }
  });

  // ⚠⚠ THE SET BELOW USED TO HOLD TWELVE MEMBERS AND NOW HOLDS ZERO. THE
  // ORIGINAL IS QUOTED RATHER THAN DELETED, because the estate's record of what
  // it once could not do is the thing that stops the claim coming back (trap
  // 14 — a confession must not be tidied into an excuse):
  //
  //   const KNOWN_DEAD_ENDS = [
  //     "it's about 30%", 'it is about 30%', "it's 30%", 'that would be 30%',
  //     'my guess is 30%', 'Churn rate is 30%', 'Churn rate is at 30%',
  //     'Handling time is 30%', 'the factor reaches 30%', 'it reaches 30%',
  //     'Thirty percent', 'approx 30%',
  //   ];
  //
  // ⛔ AND THE COMMENT ABOVE IT SAID *"This lane does not widen the parser to fix
  // them — it makes the ask stop inviting them"*, citing five oscillating
  // rounds. That was the right call FOR THAT LANE and it is not a permanent
  // ruling: the ask now says *"Just the percentage is enough"*, and an
  // independent reviewer then measured **`just 30%` and `Just 30%` dead at the
  // same head** — the product refusing an echo of the sentence it had just
  // printed. Instructing a shape you refuse is P8 wearing the fix's clothes.
  //
  // ⭐ THE PARSER IS NOW WIDENED, AND NOT AS ONE WINDOW. The oscillation ruling
  // is honoured by SPLITTING the predicate in two (`FRAME_LEAD` guards the GAP,
  // `FRAME_SUBJECTS` guards the LIE — see `missing-value-answer.ts`), so no move
  // on one can trade against the other. Each of the twelve is measured below,
  // and each carries its opposite-direction twin.
  it('⭐ THE TWELVE FORMER DEAD ENDS — every one now BINDS or is RECOGNISED', () => {
    const NOW_BINDS: readonly string[] = [
      "it's about 30%",
      'it is about 30%',
      "it's 30%",
      'that would be 30%',
      'my guess is 30%',
      'the factor reaches 30%',
      'it reaches 30%',
      'Thirty percent',
      'approx 30%',
      // Measured dead by an independent reviewer at `de58cff3`, and the sharpest
      // of the set: `just` is the FIRST WORD OF THE ASK'S OWN HINT.
      'just 30%',
      'Just 30%',
    ];
    for (const message of NOW_BINDS) {
      const resolved = resolveRepairValueBinding({
        message,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `"${message}" still dead-ends at the route`).toBe(true);
      if (!resolved.matched) continue;
      expect(resolved.kind).toBe('bind');
      if (resolved.kind !== 'bind') continue;
      // Bound BY IDENTITY to the pair the product asked about (trap 19), and
      // to the figure the user wrote — 30% is 0.3, never 30 and never 3.
      expect(resolved.pair.optionId).toBe('opt-hire');
      expect(resolved.pair.factorId).toBe('fac-payroll');
      expect(Number(resolved.valueText)).toBeCloseTo(0.3, 10);
    }

    // The remaining three of the twelve name a CONTENTFUL subject. They are a
    // different verdict, asserted separately below — never folded in here,
    // because "binds" and "is recognised" are two claims (trap 21).
    for (const message of CONTENTFUL_SUBJECT_KNOWN_DROPPED) {
      expect(messageAnswersMissingValueAsk(message), message).toBe(true);
    }
  });

  it('⛔ THE LIE DIRECTION — a CONTENTFUL subject terminates and NEVER binds', () => {
    // ⭐ THIS IS THE OPPOSITE-DIRECTION TWIN OF THE WIDENING, and the whole
    // reason the predicate has two parameters. `"it's 30%"` and
    // `"Churn rate is 30%"` are the SAME SHAPE; only the subject differs. One is
    // an answer to the question on screen, the other may name a quantity the
    // product never asked about — and TEXT CANNOT TELL. Binding it would be the
    // wrong-entity write.
    //
    // So: it must terminate (the demand stops repeating) and it must NOT bind.
    // If a later change makes any of these bind, this REDs — which is the point.
    expect(CONTENTFUL_SUBJECT_KNOWN_DROPPED.length, 'a vacuous pin is not a pin').toBeGreaterThan(0);
    for (const message of CONTENTFUL_SUBJECT_KNOWN_DROPPED) {
      expect(readMissingValueAnswer(message), `"${message}" must not read as a value`).toBeNull();
      expect(messageAnswersMissingValueAsk(message), `"${message}" must terminate`).toBe(true);
      const resolved = resolveRepairValueBinding({
        message,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `"${message}" reached a WRITE`).toBe(false);
    }

    // ⚠ THE DISCRIMINATION, PINNED IN-TEST (trap 13b). Both blocks could pass
    // while the reader answered the same way to both classes. Assert the ONE
    // character of difference actually decides: same frame, closed subject binds,
    // contentful subject does not.
    expect(readMissingValueAnswer("it's 30%")?.kind).toBe('numeric');
    expect(readMissingValueAnswer('Churn rate is 30%')).toBeNull();
  });

  it('⚠ THE HONEST GAP — what STILL dead-ends is pinned EXACTLY, so it REDs if it grows OR shrinks', () => {
    // ⭐ A GAP RECORDED IN THE SUITE IS HONEST; A GAP INVISIBLE TO IT IS HOW
    // FIVE ROUNDS HAPPENED (trap 22f). MEASURED at this tip: the reader returns
    // null AND the termination predicate returns false, so the identical demand
    // repeats at the user. Each is a DELIBERATE non-fix with a stated reason:
    //
    //   · word fractions ("half", "a third", "a quarter", "two thirds") —
    //     reading them means choosing between 0.33 and 0.333…, i.e. inventing
    //     precision the user did not give. The spelled-out arm reads INTEGERS
    //     only, so this refusal is structural rather than a rule to maintain.
    //   · "Thirty" with no unit — a spelled word has no second reading as the
    //     internal 0–1 spelling, so it is not a percentage claim. Its twin
    //     "Thirty percent" binds.
    //   · "-10%" — out of scale in the one direction the digit grammar does not
    //     admit at all. It stays refused (correctly) AND still loops, which is a
    //     smaller defect of the same family, deliberately NOT fixed here: the
    //     scope rule prohibits widening a conjunct this lane did not come for.
    //   · a NAMED TARGET in a frame — the edit lane owns it, and this path must
    //     not claim it.
    const KNOWN_DEAD_ENDS: readonly string[] = [
      '-10%',
      'that would be 30% for the subcontracting option',
      'Thirty',
      'half',
      'a third',
      'a quarter',
      'two thirds',
      'it is half',
      'it is a third',
    ];
    const stillDead = KNOWN_DEAD_ENDS.filter(
      (m) => readMissingValueAnswer(m) === null && !messageAnswersMissingValueAsk(m),
    );
    expect(stillDead).toEqual(KNOWN_DEAD_ENDS);

    // CONTRAST CONTROL — the probe must be capable of reporting "not dead".
    // Without this the filter above could return everything by being blind.
    const live = ['30%', 'about 30%', 'set it to 30%', "it's 30%", 'Thirty percent'].filter(
      (m) => readMissingValueAnswer(m) === null && !messageAnswersMissingValueAsk(m),
    );
    expect(live, 'the dead-end probe is blind — it calls working phrasings dead').toEqual([]);
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
