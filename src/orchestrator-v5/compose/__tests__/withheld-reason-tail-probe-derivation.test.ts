/**
 * ROADMAP 2.579 — THE TAIL PROBE'S STATE UNIVERSE MUST BE DERIVED, NOT HAND-LISTED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS.
 *
 * `withheld-reason-tail.ts`'s build-time probe carried this comment:
 *
 *     ⚠ DERIVED FROM THE STATE ENUM, NOT HAND-LISTED. Driving
 *     `composeWithheldWhyAnswer` over every declared `ConstraintVerdictState`
 *     plus `null` also proves the switch is TOTAL — a sixth state added to the
 *     contract arrives here as a compile error and, failing that, as an
 *     unprobed voice this loop would not silently skip.
 *
 * directly above a PLAIN ARRAY LITERAL of six hand-typed values. Both halves of
 * the comment's promise were false in the way that matters:
 *
 *   - the list is typed `ReadonlyArray<ConstraintVerdictState | null>`, so a
 *     SIXTH state is perfectly assignable and its ABSENCE is not a type error;
 *   - so the loop DOES silently skip a new state's voice — the exact opposite
 *     of "would not silently skip".
 *
 * The named function `composeWithheldWhyAnswer` does not exist anywhere in the
 * repo (measured: one occurrence, and it is that comment). CLAUDE.md trap 12
 * (the hand-maintained mirror) plus trap 14 (an honest label overwritten by a
 * false one) — here in the same six lines.
 *
 * ⚠ WHY THIS IS LOAD-BEARING FOR 2.579 SPECIFICALLY, not tidy-up. The 2.579
 * ruling adds an INCOMPLETENESS reason to the withheld-leader verdict — i.e.
 * exactly the "sixth state" the comment promised would be caught. Its voice
 * wants to reach for the natural words ("we cannot say which option leads while
 * one is missing"), which is precisely the copy `textNamesLeadingOption` exists
 * to reject: `projectExplanationAnswerForWithheldClaim` would then replace the
 * answer wholesale on every withheld turn and the user would be deflected all
 * over again — with no symptom but a telemetry rate nobody had a reason to look
 * at. That is this probe's own stated rationale, and the hand-list is what
 * disarms it.
 *
 * ⭐ THE TWO SIBLINGS ALREADY DERIVE, so this is a conversion to an established
 * house pattern, not a new invention:
 *   - `withheld-explanation-answer.ts:411` — `Object.keys(MAY_NAME_LEADING_OPTION)`
 *   - `withheld-leader-projection.ts:443`  — `Object.keys(MAY_NAME_LEADING_OPTION)`
 * The first one's own comment records this exact drift happening once already:
 * "a hand-list would have left the two NEW voices ... unprobed".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THIS TEST DISCRIMINATES (CLAUDE.md trap 12d).
 *
 * A test that asserts the hand-list AGREES with the enum passes at pristine —
 * the mirror is in agreement TODAY; that is what makes it invisible. Agreement
 * can never prove derivation. The only thing that can is exercising the probe
 * with a state the hand-list does not contain.
 *
 * So this test MOCKS the canonical map with a SIXTH state (`importOriginal`
 * spread — the house pattern, CLAUDE.md trap 12) and asserts the module refuses
 * to import. At pristine the hand-list ignores the mock, the sixth voice is
 * skipped, the import succeeds, and this test is RED.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** The synthetic sixth state. Named for the 2.579 reason it stands in for. */
const SIXTH_STATE = 'candidate_set_incomplete';

const MODULE_UNDER_TEST = '../withheld-reason-tail.js';
const CANONICAL_MAP_MODULE = '../../../orchestrator/context/constraint-feasibility.js';

vi.mock('../../../orchestrator/context/constraint-feasibility.js', async (importOriginal) => {
  // ⚠ importOriginal SPREAD, never a hand-written stub. A `vi.mock` factory
  // REPLACES the module, so a stub silently drops every export the file has
  // gained since it was written — the 51-dark-tests defect in CLAUDE.md trap 12.
  const actual = await importOriginal<
    typeof import('../../../orchestrator/context/constraint-feasibility.js')
  >();
  return {
    ...actual,
    MAY_NAME_LEADING_OPTION: Object.freeze({
      ...actual.MAY_NAME_LEADING_OPTION,
      // A sixth state that WITHHOLDS — so it is a state whose voice the tail
      // must be able to speak, not a permitting state the probe may skip.
      [SIXTH_STATE]: false,
    }),
  };
});

describe('ROADMAP 2.579 — withheld-reason-tail probe drives every DECLARED state', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('PRECONDITION: the mock actually publishes the sixth state', async () => {
    // ⭐ CLAUDE.md trap 13b, third face — PIN THE PRECONDITION IN-TEST. Without
    // this, the discriminator below could go green because the mock silently
    // stopped reproducing anything (a module-path change, a hoisting change, a
    // vitest upgrade), and a discriminator that discriminates nothing is the
    // failure this estate measured twice on 5 Aug.
    const mapModule = await import(CANONICAL_MAP_MODULE);
    const keys = Object.keys(mapModule.MAY_NAME_LEADING_OPTION);

    expect(keys).toContain(SIXTH_STATE);
    // And the spread kept the real states — proving this is the REAL map plus
    // one, not a stub that happens to contain the key we look for.
    expect(keys).toContain('not_applicable');
    expect(keys).toContain('evaluated_feasible');
    expect(keys).toContain('evaluated_infeasible');
    expect(keys).toContain('unevaluated');
    expect(keys).toContain('identity_unresolved');
    expect(keys).toHaveLength(6);
  });

  it('refuses to import when a declared state has no voice, naming THAT state', async () => {
    // The probe runs at module scope, so an unvoiced declared state must make
    // the IMPORT fail. Binding is by IDENTITY (CLAUDE.md trap 19): the error
    // must name `candidate_set_incomplete` itself — not merely "some state",
    // and not a count, either of which a different state could satisfy.
    await expect(import(MODULE_UNDER_TEST)).rejects.toThrow(
      new RegExp(`withheld-reason-tail[\\s\\S]*${SIXTH_STATE}`),
    );
  });

  it('the refusal explains what the author must do, not just that it failed', async () => {
    // A loud failure that does not say what to add is a stall, not a guard.
    let message = '';
    try {
      await import(MODULE_UNDER_TEST);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toBe('');
    expect(message).toMatch(/composeWithheldReasonTail/);
    expect(message).toContain(SIXTH_STATE);
  });
});
