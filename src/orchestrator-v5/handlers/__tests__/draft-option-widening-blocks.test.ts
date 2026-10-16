/**
 * Pin the draft option-widening emitter.
 *
 * ── FIXTURE PROVENANCE (trap 16, non-negotiable) ───────────────────────────
 * Every `elements_considered_but_excluded` string below is a VERBATIM REAL
 * CAPTURE from the Step-0 census of the staging `scenarios` table taken
 * 2026-08-17 (complete table: 2,977 rows, 2026-04-18 → 2026-08-17; 2,165 rows
 * carry a non-empty exclusion record; contrast controls fired). A fixture the
 * author wrote themselves encodes the author's model of the drafter rather than
 * the drafter, and this module's whole design turns on what the drafter really
 * writes — which is NOT what the brief assumed. Each fixture names the scenario
 * id it came from.
 *
 * ⚠ TWO EXCEPTIONS, both labelled at their site rather than left to be assumed:
 *   - `'Nothing else in the brief suggests a further option'` is CONSTRUCTED. A
 *     search of all 4,922 entries found ZERO instances of its shape, and it is
 *     the only input that discriminates conjunct 1. Kept, and marked.
 *   - the `con-current`/`opt_phased_rollout` R3 inputs are CONSTRUCTED probes of
 *     the id-shape boundary, not observed captures.
 *
 * The option LABELS are likewise the real labels persisted on those same rows.
 * The BRIEF strings are the other specification-only element: the census pulled
 * graphs, not briefs, so the briefs here are constructed to drive
 * `deriveIntakeOptionReconciliation` into a NAMED state, and every test that
 * depends on that state PINS IT IN-TEST before asserting anything else
 * (trap 13b third face: a guard whose discrimination depends on a fixture
 * nothing pins is a guard that will silently stop discriminating).
 *
 * Every emitted block is validated against the REAL boundary
 * `CoachingBlockSchema`, so the field shape the UI parser reads is pinned to the
 * wire contract rather than to a hand-copied shape.
 */
import { describe,expect,it } from 'vitest';


import { deriveIntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';




/** Real capture: scenario 75ff7b6d-4d0c-4179-b274-d1551b911b7f, 2026-08-15. */

/** Real capture: scenario d8c1dbdc-a59e-4a65-9c5d-b1c3f1e69b9d, 2026-08-15 (quoted shape). */

/** Real capture: scenario 4c0d7764-8fbe-4c42-ab85-e0fd670a0bec, 2026-07-31 (quoted, with reason). */

/** Real capture: scenario 83604ca0-6de7-4cfa-ae0a-1795d1e43079, 2026-08-13 — reason carries GRAPH VOCABULARY. */

/**
 * Real capture: scenario 7f2ee8ef-cbcb-4f93-94af-efd83da2b68a, 2026-07-22 — a
 * designation long enough to exceed `action_label`'s 40-char contract bound.
 */

/** Real captures: scenario 99bdb476-31f7-4563-b6ec-47356e3bfe44, 2026-08-17 — FACTORS, not options. */

/**
 * Real capture: scenario 7f2ee8ef-cbcb-4f93-94af-efd83da2b68a, 2026-07-22. ⭐ THE LIE TWIN:
 * its DESIGNATION is a factor, and only its REASON says "option". A predicate
 * that tests the whole entry calls this a set-aside option — a fabrication.
 */

/**
 * Real capture: scenario 5df20177, 2026-08-10. ⭐⭐ THE SHARPER LIE TWIN, AND IT
 * EXISTS BECAUSE A MUTANT SURVIVED.
 *
 * A mutant that looked for the option word ANYWHERE IN THE ENTRY (rather than
 * in the designation) survived the twin above — because that twin's designation
 * contains the word "factor", so the NON_OPTION_ENTITY veto caught it and the
 * test could not tell which of the two clauses was protecting it. Searching the
 * census for the class the mutant would mis-accept found **76 real entries**
 * whose designation carries NO entity word at all while their REASON mentions
 * options. This is one of them. Without this fixture the emitter's protection
 * rested entirely on a hand-written veto list (trap 12); with it, the test binds
 * to the head-scoping that is the actual design.
 */


/** Real option labels: scenario 75ff7b6d…, 2026-08-15. Two options — a narrow set. */


/** No enumeration cue, so the reconciler has NO OPINION (`not_applicable`). */
const BRIEF_NO_ENUMERATION =
  'Our CRM is creaking and the renewal lands next quarter. Sales are complaining about duplicate records.';

/** Carries a cue AND names an option the graph does not have → `options_missing`. */
const BRIEF_OPTIONS_MISSING =
  'We are choosing between replacing the CRM, keeping it, and a phased rollout. Renewal is next quarter.';











describe('buildDraftOptionWideningBlocks — 5. ⭐ the trap-21 anti-collision gate', () => {
  it('PRECONDITION PINNED: the unbound fixture leaves identity unverified', () => {
    // Without this, a silence below could be the FIXTURE failing rather than
    // the gate firing, and the test would pass while guarding nothing.
    const reconciliation = deriveIntakeOptionReconciliation(BRIEF_OPTIONS_MISSING, [
      'Replacing the CRM',
      'Keeping it',
    ]);
    expect(reconciliation.state).toBe('identity_unverified');
    expect(reconciliation.missing).toEqual([]);
  });

  it('PRECONDITION PINNED: the firing fixture does NOT drive it to options_missing', () => {
    expect(
      deriveIntakeOptionReconciliation(BRIEF_NO_ENUMERATION, ['Replacing the CRM', 'Keeping it'])
        .state,
    ).not.toBe('options_missing');
  });


});











/**
 * ⭐⭐ B1 — THE FABRICATION SUITE. The field holds REASON PROSE BY DESIGN
 * (`coaching-pass.ts:108` "brief reasons"; the legacy normaliser's "canonical
 * 'reason descriptions' surface"). Every entry below is reason prose that an
 * earlier revision of this module accepted as a set-aside OPTION, because it
 * took `parts[0]` without requiring that a separator was found — so `head`
 * became the whole sentence and passed for containing "option" and no veto word.
 *
 * 10 of 13 such inputs produced a card asserting the drafter set aside an option
 * that is not an option, WITH A 48-TEST SUITE GREEN THROUGHOUT. That is why
 * these are pinned by class and not as a one-off regression.
 */
