/**
 * ⭐⭐⭐ THE SEPARATION PERMISSION GETS A VOICE — the axis that withheld most
 * often and explained least.
 *
 * MEASURED, 19 Sep 2026, twelve debug captures across two manual sessions:
 * eleven withheld the recommendation. `separation_unavailable` appeared SEVEN
 * times, `constraint_verdict_withheld` three. The constraint axis has a full
 * set of voices in `withheld-reason-tail.ts`, each naming a cause and a repair
 * step. The separation axis had none, so on the MAJORITY of withheld turns the
 * person read `WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL` — *"No single option
 * can be put forward yet."* True, causeless, actionless.
 *
 * ⚠ WHAT THESE TESTS ARE FOR, beyond the two new sentences. The risk in this
 * change is NOT that the new copy is wrong; it is that adding a second
 * permission quietly changes the first one's population. The byte-identity
 * twin below is the load-bearing case.
 */
import { describe, it, expect } from 'vitest';
import { composeWithheldReasonTail } from '../withheld-reason-tail.js';
import {
  WITHHELD_NEAR_TIE,
  WITHHELD_SEPARATION_UNAVAILABLE,
  separationWithholdFromRobustness,
} from '../analysis-state-v1.js';
import type { RatifiedConstraint } from '../../../orchestrator/context/constraint-feasibility.js';

const NO_CONSTRAINTS: readonly RatifiedConstraint[] = [];

describe('the separation permission explains itself', () => {
  it('⭐ separation NOT EVALUATED: names the cause and asks for the thing that would measure it', () => {
    const tail = composeWithheldReasonTail(
      'evaluated_feasible',
      NO_CONSTRAINTS,
      null,
      WITHHELD_SEPARATION_UNAVAILABLE,
    );
    expect(tail).not.toBeNull();
    expect(tail!.kind).toBe('separation_not_evaluated');
    // The CAUSE, in the producer's own terms: we did not look.
    expect(tail!.text).toContain('not established on this run');
    // A NEXT ACTION that would actually change the answer.
    expect(tail!.text).toMatch(/run the analysis/i);
    // ...and useful help that does not depend on it, which is the whole point
    // of the change: a withheld claim must not end the conversation.
    expect(tail!.text).toMatch(/reasoning|assumptions/i);
  });

  it('⭐ NEAR TIE: says a re-run will not help, and asks the person instead', () => {
    const tail = composeWithheldReasonTail(
      'evaluated_feasible',
      NO_CONSTRAINTS,
      null,
      WITHHELD_NEAR_TIE,
    );
    expect(tail).not.toBeNull();
    expect(tail!.kind).toBe('separation_near_tie');
    expect(tail!.text).toMatch(/too close/i);
    expect(tail!.text).toMatch(/will not separate them/i);
    // The useful move on a genuine tie is a preference, and preferences are
    // the person's. This is the coaching answer, not a consolation prize.
    expect(tail!.text).toMatch(/what matters most to you/i);
  });

  /**
   * ⛔ THE ANTI-COLLAPSE PAIR. The tempting simplification is one
   * "we could not separate the options" sentence. It is wrong in one direction
   * on EACH population: it claims a measurement where none was taken, and
   * prescribes a futile re-run where one was. These two assertions fail the
   * moment someone merges them, which is exactly when the reminder is needed.
   */
  it('⛔ the two separation voices prescribe OPPOSITE next steps and must never merge', () => {
    const notEvaluated = composeWithheldReasonTail(
      'evaluated_feasible', NO_CONSTRAINTS, null, WITHHELD_SEPARATION_UNAVAILABLE,
    )!;
    const nearTie = composeWithheldReasonTail(
      'evaluated_feasible', NO_CONSTRAINTS, null, WITHHELD_NEAR_TIE,
    )!;
    expect(notEvaluated.text).not.toBe(nearTie.text);
    expect(notEvaluated.kind).not.toBe(nearTie.kind);
    // One asks for a run; the other says a run is pointless. If a future
    // edit makes both say the same thing about re-running, this REDs.
    expect(/will not separate them/i.test(notEvaluated.text)).toBe(false);
    expect(/will not separate them/i.test(nearTie.text)).toBe(true);
  });

  /**
   * ⭐⭐⭐ THE LOAD-BEARING CASE. Every constraint-withholding state must be
   * BYTE-IDENTICAL with and without a separation withhold present, because the
   * producer chooses `!entitled` FIRST for the published `withheld_reason`. If
   * this file spoke the separation voice there, the sentence and the wire code
   * would name different causes for one withholding.
   *
   * ⚠ This is the twin that would have caught the change going wrong. The two
   * positives above pass whether or not the constraint population moved.
   */
  it('⭐ every constraint-withholding state is byte-identical with a separation withhold present', () => {
    const constraintStates = ['evaluated_infeasible', 'unevaluated', 'identity_unresolved'] as const;
    for (const state of constraintStates) {
      const without = composeWithheldReasonTail(state, NO_CONSTRAINTS, null);
      for (const sep of [WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_NEAR_TIE] as const) {
        const withSep = composeWithheldReasonTail(state, NO_CONSTRAINTS, null, sep);
        expect(withSep, `${state} + ${sep}`).toEqual(without);
      }
    }
    // The unreadable state too — it fails closed and must keep doing so.
    const unreadable = composeWithheldReasonTail(null, NO_CONSTRAINTS, null);
    expect(
      composeWithheldReasonTail(null, NO_CONSTRAINTS, null, WITHHELD_NEAR_TIE),
    ).toEqual(unreadable);
  });

  it('a permitting state with NO separation withhold is still null — today’s behaviour', () => {
    expect(composeWithheldReasonTail('evaluated_feasible', NO_CONSTRAINTS, null)).toBeNull();
    expect(composeWithheldReasonTail('not_applicable', NO_CONSTRAINTS, null, null)).toBeNull();
  });

  /**
   * ⭐ ONE PREDICATE, NOT TWO. The voice is selected by the SAME function
   * `composeLeaderClaim` uses to mint the published `withheld_reason`, so the
   * sentence cannot describe a different cause than the wire does.
   *
   * Pinned against the three robustness shapes directly rather than trusting
   * the refactor: a derived guard proves agreement, and this is the agreement.
   */
  it('⭐ the voice is keyed on the producer’s own discrimination, over all three shapes', () => {
    expect(separationWithholdFromRobustness(null)).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
    expect(
      separationWithholdFromRobustness({ near_tie_is_tie: true } as never),
    ).toBe(WITHHELD_NEAR_TIE);
    expect(
      separationWithholdFromRobustness({ near_tie_is_tie: false } as never),
    ).toBeNull();
  });

  /** Both voices are leading-space fragments — the append seam's contract. */
  it('both voices are leading-space fragments', () => {
    for (const sep of [WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_NEAR_TIE] as const) {
      const tail = composeWithheldReasonTail('evaluated_feasible', NO_CONSTRAINTS, null, sep)!;
      expect(tail.text.startsWith(' ')).toBe(true);
    }
  });
});
