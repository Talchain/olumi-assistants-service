/**
 * ROADMAP 2.104 — the withheld-why composer.
 *
 * THE THREE PROPERTIES THIS FILE EXISTS FOR, in the order they matter:
 *
 *   1. IT SAYS SOMETHING. Every withholding state produces an answer that names
 *      the reason, not a deflection. Asserted per state, on the shipped bytes.
 *   2. IT SAYS ONLY WHAT IS RECORDED. The persisted verdict carries no failing
 *      constraint id and no violation kind, so the copy must not name one —
 *      pinned by the multi-condition case, which is exactly where a well-meaning
 *      edit would reach for the list.
 *   3. IT IS NOT AN ORACLE. The answer's shape varies with the verdict state and
 *      the ratified condition count and with NOTHING about any option, so it
 *      cannot be probed for a hidden position (the #743 lesson, applied here
 *      before it could become a defect).
 */
import { describe, it, expect } from 'vitest';

import { composeWithheldWhyAnswer } from '../withheld-why-answer.js';
import {
  textNamesLeadingOption,
  findLeaderClaims,
} from '../leading-option-egress-guard.js';
import { buildConstraintDisclosureFromState } from '../../coaching/constraint-gap-disclosure.js';
import {
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';

const ONE: readonly RatifiedConstraint[] = [
  { constraint_id: 'c_cost', label: 'Three-Year Total Cost of Ownership' },
];
const TWO: readonly RatifiedConstraint[] = [
  ...ONE,
  { constraint_id: 'c_time', label: 'Delivery within two quarters' },
];
const UNLABELLED: readonly RatifiedConstraint[] = [{ constraint_id: 'c_cost', label: null }];

/** The three withholding states, DERIVED from the contract rather than listed. */
const WITHHOLDING_STATES = (
  Object.keys(MAY_NAME_LEADING_OPTION) as ConstraintVerdictState[]
).filter((s) => !MAY_NAME_LEADING_OPTION[s]);

const PERMITTING_STATES = (
  Object.keys(MAY_NAME_LEADING_OPTION) as ConstraintVerdictState[]
).filter((s) => MAY_NAME_LEADING_OPTION[s]);

describe('composeWithheldWhyAnswer — it answers, for every state that withholds', () => {
  it('covers every withholding state the contract declares, with no gaps', () => {
    // DERIVED, not hand-listed: a sixth withholding state added to the contract
    // arrives here as an unanswered case rather than as silence in production.
    expect(WITHHOLDING_STATES.length).toBeGreaterThan(0);
    for (const state of WITHHOLDING_STATES) {
      const answer = composeWithheldWhyAnswer(state, ONE);
      expect(answer, state).not.toBeNull();
      expect(answer!.text.length, state).toBeGreaterThan(80);
    }
  });

  it('evaluated_infeasible — names the sole condition and states that the result does not stand up to it', () => {
    const answer = composeWithheldWhyAnswer('evaluated_infeasible', ONE);
    expect(answer).not.toBeNull();
    expect(answer!.kind).toBe('constraint_infeasible');
    expect(answer!.named_constraint).toBe(true);
    expect(answer!.text).toContain('“Three-Year Total Cost of Ownership”');
    expect(answer!.text).toContain('was checked on this run');
    expect(answer!.text).toContain('does not stand up against it');
    // The repair step, which is what makes the answer actionable rather than
    // merely honest.
    expect(answer!.text).toContain('run the analysis again');
  });

  it('evaluated_infeasible with TWO conditions — names NEITHER, and says so', () => {
    // ⚠ THE PROPERTY MOST LIKELY TO BE "TIDIED UP" INTO A DEFECT. Which
    // condition the result fell short on is NOT persisted
    // (`PersistedClaimSafety` stores the state and the permission, nothing
    // else). Listing both would assert that each failed.
    const answer = composeWithheldWhyAnswer('evaluated_infeasible', TWO);
    expect(answer).not.toBeNull();
    expect(answer!.named_constraint).toBe(false);
    expect(answer!.text).not.toContain('Three-Year Total Cost of Ownership');
    expect(answer!.text).not.toContain('Delivery within two quarters');
    expect(answer!.text).toContain('All 2 conditions you set were checked');
    expect(answer!.text).toContain('Which one that is has not been recorded');
  });

  it('evaluated_infeasible never claims that NO option satisfies the condition', () => {
    // The brief's premise, refuted at the code:
    // `deriveWinnerConstraintInfeasibility` evaluates ONLY the winner, so a
    // sentence about "no option" would be a claim about options the analysis
    // never gated on.
    for (const constraints of [[], ONE, TWO, UNLABELLED]) {
      const text = composeWithheldWhyAnswer('evaluated_infeasible', constraints)!.text;
      expect(text.toLowerCase(), JSON.stringify(constraints)).not.toContain('no option satisf');
      expect(text.toLowerCase(), JSON.stringify(constraints)).not.toContain('none of the options');
      expect(text.toLowerCase(), JSON.stringify(constraints)).not.toContain('no option meets');
    }
  });

  it('evaluated_infeasible never asserts the satisfaction claim only hard_violation licenses', () => {
    // `kind` (hard_violation vs joint_tension) is not persisted either, and the
    // two carry DIFFERENT contracts — "does not satisfy" vs "in tension with".
    // Indistinguishable here, so the weaker claim is the only honest one.
    for (const constraints of [[], ONE, TWO]) {
      const text = composeWithheldWhyAnswer('evaluated_infeasible', constraints)!.text;
      expect(text.toLowerCase()).not.toContain('does not satisfy');
      expect(text.toLowerCase()).not.toContain('violates');
      expect(text.toLowerCase()).not.toContain('breaches');
    }
  });

  it('evaluated_infeasible with NO ratified conditions invents none', () => {
    // Reachable: `deriveConstraintVerdict` returns this state on
    // `ratified.length === 0` when the producer's own scoring condemns the
    // result. Copy that said "the condition you set" would be a fabricated
    // premise about the user's own scenario.
    const answer = composeWithheldWhyAnswer('evaluated_infeasible', []);
    expect(answer!.named_constraint).toBe(false);
    expect(answer!.text).toContain('the limits in your model');
    expect(answer!.text).not.toContain('the condition you set was checked');
  });

  it('unevaluated / identity_unresolved REUSE the disclosure copy rather than restating it', () => {
    // ⚠ NOT A STYLE POINT. Those two voices were got wrong twice before they
    // were got right ("pairing the wrong sentence with the state is the mistake
    // both earlier revisions of this fix made"). A second near-copy would drift
    // the first time either was reworded. This asserts the shipped bytes CONTAIN
    // the sibling module's own output, so a reword there moves this answer too.
    for (const state of ['unevaluated', 'identity_unresolved'] as const) {
      for (const constraints of [ONE, TWO]) {
        const disclosure = buildConstraintDisclosureFromState(state, constraints);
        expect(disclosure.length, `${state} fixture must produce a disclosure`).toBeGreaterThan(0);
        const answer = composeWithheldWhyAnswer(state, constraints);
        expect(answer!.text, state).toContain(disclosure.trim());
      }
    }
  });

  it('unevaluated says "not checked"; identity_unresolved says "could not be matched" — never each other', () => {
    // The exact conflation `constraint-gap-disclosure.ts` exists to prevent,
    // asserted at this module's own output so a future refactor cannot
    // reintroduce it here.
    const unevaluated = composeWithheldWhyAnswer('unevaluated', ONE)!.text;
    const unresolved = composeWithheldWhyAnswer('identity_unresolved', ONE)!.text;
    expect(unevaluated).toContain('was not checked');
    expect(unresolved).not.toContain('was not checked');
    expect(unresolved).toContain('could not be matched');
    expect(unevaluated).not.toContain('could not be matched');
  });

  it('a state whose conditions cannot be read back still answers, without naming one', () => {
    // Reachable when a condition is deleted after the run: the state persists,
    // the labels do not. The disclosure builder returns '' for an empty list,
    // which would otherwise leave the opening sentence answering nothing.
    for (const state of ['unevaluated', 'identity_unresolved'] as const) {
      expect(buildConstraintDisclosureFromState(state, [])).toBe('');
      const answer = composeWithheldWhyAnswer(state, []);
      expect(answer, state).not.toBeNull();
      expect(answer!.named_constraint, state).toBe(false);
      expect(answer!.text.length, state).toBeGreaterThan(80);
      expect(answer!.text, state).toContain('run the analysis again');
    }
  });

  it('an unreadable state says so, and does NOT reach for the ratified-condition voice', () => {
    // The F2 correctness lesson from `withheld-leader-projection.ts`: an
    // unconditional cause is a FABRICATED cause on every fact that carries none.
    const answer = composeWithheldWhyAnswer(null, TWO);
    expect(answer!.kind).toBe('reason_unrecorded');
    expect(answer!.text).toContain('The reason is not recorded on this result');
    expect(answer!.text).not.toContain('condition you set');
    expect(answer!.text).not.toContain('Three-Year Total Cost of Ownership');
  });

  it('declines the two PERMITTING states rather than explaining a withholding that did not happen', () => {
    for (const state of PERMITTING_STATES) {
      for (const constraints of [[], ONE, TWO]) {
        expect(composeWithheldWhyAnswer(state, constraints), state).toBeNull();
      }
    }
  });

  it('never throws on degenerate input', () => {
    expect(() =>
      composeWithheldWhyAnswer('unevaluated', null as unknown as RatifiedConstraint[]),
    ).not.toThrow();
    expect(() => composeWithheldWhyAnswer(null, [])).not.toThrow();
    // A label that is really an id degrades to the count shape rather than
    // leaking the id (`sanitiseLabel` refuses it).
    const idish = composeWithheldWhyAnswer('evaluated_infeasible', [
      { constraint_id: 'c_cost', label: 'c_cost' },
    ]);
    expect(idish!.named_constraint).toBe(false);
    expect(idish!.text).not.toContain('c_cost');
  });

  it('a label past the length bound degrades to the count shape, never a truncation', () => {
    const long = 'x'.repeat(61);
    const answer = composeWithheldWhyAnswer('evaluated_infeasible', [
      { constraint_id: 'c_cost', label: long },
    ]);
    expect(answer!.named_constraint).toBe(false);
    expect(answer!.text).not.toContain(long);
    expect(answer!.text).not.toContain('x'.repeat(40));
  });
});

describe('claim safety — no leader, and no oracle', () => {
  it('no voice trips the shared leader vocabulary, on any branch', () => {
    // The same assertion the module-load probe makes, run here too so a
    // regression names the branch instead of only failing the import.
    for (const state of [null, ...WITHHOLDING_STATES] as const) {
      for (const constraints of [[], ONE, TWO, UNLABELLED]) {
        const answer = composeWithheldWhyAnswer(state, constraints);
        if (answer === null) continue;
        // Through the ALARM'S OWN envelope walker, on the field this answer
        // actually ships in, rather than a string-level shortcut — so the check
        // is the one production runs.
        const hits = findLeaderClaims({ assistant_text: answer.text } as never);
        expect(hits, `${state ?? 'null'} / ${constraints.length}`).toEqual([]);
        expect(textNamesLeadingOption(answer.text)).toBe(false);
      }
    }
  });

  it('the module-load probe is not vacuous — it can SEE a leader claim', () => {
    // Trap 13: an absence assertion that has never seen a presence proves
    // nothing. This drives the probe's own reader over a sentence of the shape
    // the copy must never take.
    expect(textNamesLeadingOption('Hire Marketing Manager comes out ahead on this analysis.')).toBe(
      true,
    );
    expect(
      findLeaderClaims({ assistant_text: 'The leading option is Hold.' } as never).length,
    ).toBeGreaterThan(0);
  });

  it('THE ORACLE PROPERTY — the answer varies with the scenario, never with an option', () => {
    // #743's lesson, applied before it became a defect. Copy whose SHAPE
    // differed for the option that happens to be hidden would let a user read
    // the withheld position off the difference. This answer is composed from
    // the verdict state and the ratified condition list ALONE — there is no
    // option input to vary — so identical scenario inputs give identical bytes
    // no matter what the analysis found.
    for (const state of WITHHOLDING_STATES) {
      for (const constraints of [[], ONE, TWO]) {
        const a = composeWithheldWhyAnswer(state, constraints);
        const b = composeWithheldWhyAnswer(state, constraints.map((c) => ({ ...c })));
        expect(b!.text, `${state}/${constraints.length}`).toBe(a!.text);
      }
    }
  });

  it('never names an option, a probability, or a percentage', () => {
    for (const state of [null, ...WITHHOLDING_STATES] as const) {
      for (const constraints of [[], ONE, TWO]) {
        const answer = composeWithheldWhyAnswer(state, constraints);
        if (answer === null) continue;
        expect(answer.text, `${state ?? 'null'}`).not.toMatch(/\d+(?:\.\d+)?\s*%/);
        expect(answer.text).not.toMatch(/\b0\.\d+\b/);
      }
    }
  });
});
