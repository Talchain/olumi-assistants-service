/**
 * THE INTAKE-CONSTRAINT AXIS — "did we RECORD the limit the user stated?".
 *
 * The defect it closes, measured on a fresh-guest journey against the deployed
 * build (2026-08-24): a brief with an explicit £50,000 cap produced ZERO
 * `goal_constraints[]` rows across three journeys, and the £90,000 option —
 * £40,000 OVER the cap — was crowned "Leading option" at 71%, with the two
 * compliant options ranked 3rd and 4th and nothing said to the user.
 *
 * ⚠ THE FOUR OPPOSITE-DIRECTION TWINS (CLAUDE.md trap 22b) ARE THE POINT OF
 * THIS FILE, AND THE FIRST TWO ARE THE LOAD-BEARING ONES. A guard that
 * withholds where it should not is worse than the gap it closes: it suppresses
 * a TRUE ranking on a brief that stated no limit at all. Every firing case
 * below therefore has a non-firing twin, and the non-firing twins assert
 * BYTE-IDENTICAL pre-change behaviour rather than merely "not the new state".
 */

import { describe, it, expect } from 'vitest';

import {
  deriveIntakeConstraintReconciliation,
  extractStatedHardLimits,
  applyIntakeConstraintToLeaderPermission,
  INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION,
} from '../intake-constraint-reconciliation.js';
import {
  deriveConstraintVerdict,
  projectClaimSafety,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

/** The brief the 24 Aug fresh-guest journey actually submitted, in shape. */
const WITNESSED_BRIEF =
  'We need to modernise the production line this year, with a £50,000 cap.';

const ROW = (id: string, label: string): RatifiedConstraint => ({
  constraint_id: id,
  label,
  source_quote: null,
});

describe('extractStatedHardLimits', () => {
  it('reads the witnessed trailing-cue shape, verbatim', () => {
    const limits = extractStatedHardLimits(WITNESSED_BRIEF);
    expect(limits).toHaveLength(1);
    // VERBATIM — the span must be a contiguous slice of the submitted text, or
    // the disclosure that quotes it back is attributing words to the user.
    expect(limits[0]!.text).toBe('£50,000 cap');
    expect(WITNESSED_BRIEF).toContain(limits[0]!.text);
    expect(limits[0]!.magnitude).toBe(50000);
  });

  it.each([
    ['The budget must not exceed £50,000.', 'must not exceed £50,000'],
    ['Spend no more than £50,000 on this.', 'no more than £50,000'],
    ['We have a cap of £50,000.', 'a cap of £50,000'],
    ['Keep gross margin at least 78% throughout.', 'at least 78%'],
    ['Costs must not exceed £1.5 million.', 'must not exceed £1.5 million'],
    ['The £1.5 million cap is firm.', '£1.5 million cap'],
    ['Headcount is capped at 12.', 'capped at 12'],
  ])('reads an explicit limit from %j', (brief, expected) => {
    const limits = extractStatedHardLimits(brief);
    expect(limits).toHaveLength(1);
    expect(limits[0]!.text).toBe(expected);
    // Every span this module emits is a contiguous slice of the brief.
    expect(brief).toContain(limits[0]!.text);
  });

  /**
   * ⚠ THE FALSE-POSITIVE CONTROLS — the direction that costs a true ranking.
   * `over`, `under`, `below` and `more than` are constantly used descriptively
   * in ordinary business prose, and a brief that merely MENTIONS a magnitude is
   * not setting a limit.
   */
  it.each([
    ['Revenue grew over £2m last year and staffing is under 50 people.'],
    ['Nothing numeric here at all.'],
    ['Total three-year cost below £2,500.'],
    ['We serve more than 900 customers across three regions.'],
    ['Last quarter we spent £75,000 on contractors.'],
  ])('reads NO limit from the descriptive brief %j', (brief) => {
    expect(extractStatedHardLimits(brief)).toEqual([]);
  });

  it('does not let a cue in one clause bind to an amount in another', () => {
    // The cue and the amount are in DIFFERENT sentences. Binding them would be
    // the wide-window false positive the adjacency rule exists to prevent.
    expect(
      extractStatedHardLimits('We must not exceed our remit; last year we spent £2m.'),
    ).toEqual([]);
  });

  it('a leading cue wins, so a trailing cue cannot drag in the next clause', () => {
    const brief = 'Our budget of £120,000 is fixed and headcount is capped at 12.';
    const limits = extractStatedHardLimits(brief);
    expect(limits.map((l) => l.text)).toEqual(['budget of £120,000', 'capped at 12']);
  });

  it('the decimal point in the amount cannot clip its own cue windows', () => {
    // CLAUDE.md trap 22 shipped six live defects behind a window cut at the
    // first `[.!?]`, because the decimal point is also a full stop. Both
    // windows here are measured OUTSIDE the matched span, so "£1.5 million"
    // keeps its cue in BOTH positions. Twinned deliberately: one prefix, one
    // suffix, because a one-sided assertion would not notice a one-sided bug.
    expect(extractStatedHardLimits('Costs must not exceed £1.5 million.')).toHaveLength(1);
    expect(extractStatedHardLimits('The £1.5 million cap is firm.')).toHaveLength(1);
  });

  it('is empty for an absent or blank brief', () => {
    expect(extractStatedHardLimits(null)).toEqual([]);
    expect(extractStatedHardLimits(undefined)).toEqual([]);
    expect(extractStatedHardLimits('')).toEqual([]);
  });
});

describe('deriveIntakeConstraintReconciliation — the four twins', () => {
  /** TWIN 1 (load-bearing): the user stated NO limit ⇒ unchanged behaviour. */
  it('TWIN 1 — no stated limit ⇒ not_applicable, leader permitted', () => {
    const recon = deriveIntakeConstraintReconciliation(
      'We are choosing between three suppliers this quarter.',
      [],
    );
    expect(recon.state).toBe('not_applicable');
    expect(recon.mayNameLeadingOption).toBe(true);
    expect(recon.unrecorded).toEqual([]);
  });

  /**
   * TWIN 2 (load-bearing): the user stated a limit AND it was recorded and
   * evaluated ⇒ this axis has no opinion and the leader survives.
   */
  it('TWIN 2 — stated limit, constraint recorded ⇒ not_applicable, leader permitted', () => {
    const recon = deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, [
      ROW('c_budget', 'Budget at most £50,000'),
    ]);
    expect(recon.state).toBe('not_applicable');
    expect(recon.mayNameLeadingOption).toBe(true);
    expect(recon.unrecorded).toEqual([]);
  });

  /** TWIN 3: the witnessed defect — stated, never recorded ⇒ withhold + name. */
  it('TWIN 3 — stated limit, ZERO recorded constraints ⇒ limits_unrecorded, leader WITHHELD', () => {
    const recon = deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, []);
    expect(recon.state).toBe('limits_unrecorded');
    expect(recon.mayNameLeadingOption).toBe(false);
    // NAMES WHAT IS MISSING — the doctrine requires identifying the missing
    // information, not merely withholding.
    expect(recon.unrecorded.map((l) => l.text)).toEqual(['£50,000 cap']);
  });

  /**
   * TWIN 4: recorded but UNEVALUABLE.
   *
   * ⚠ THE BRIEF FOR THIS LANE EXPECTED THE NEW STATE TO FIRE HERE TOO. It must
   * not, and the reason is that lane's own binding invariant — "the existing
   * states must keep behaving EXACTLY as they do". A recorded-but-unevaluable
   * constraint is ALREADY `unevaluated` on the verdict axis, which ALREADY
   * declares `mayNameLeadingOption: false` and ALREADY names the condition. The
   * required OBSERVABLE — leader withheld, missing thing named — is therefore
   * already true, and firing a second axis on it would double-report one fact
   * under two reason codes. What this test pins is the observable, and that the
   * new axis leaves it untouched.
   */
  it('TWIN 4 — recorded but unevaluable ⇒ withheld by the EXISTING verdict, new axis silent', () => {
    const ratified = [ROW('c_budget', 'Budget at most £50,000')];
    const verdict = deriveConstraintVerdict(
      { constraints_status: 'unavailable' },
      ratified,
      'opt_a',
    );
    // Unchanged, pre-existing behaviour: the verdict withholds and names.
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.mayNameLeadingOption).toBe(false);
    expect(verdict.constraints.map((c) => c.constraint_id)).toEqual(['c_budget']);

    // The new axis stands down — a row exists, so it has no sound opinion.
    const recon = deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, ratified);
    expect(recon.state).toBe('not_applicable');

    // And the composed permission is still withheld, by the verdict.
    expect(
      applyIntakeConstraintToLeaderPermission(projectClaimSafety(verdict), recon)
        .may_name_leading_option,
    ).toBe(false);
  });
});

describe('the fold into the persisted leader permission', () => {
  it('the witnessed journey: permission flips from PERMITTED to WITHHELD', () => {
    // The verdict alone, on the witnessed shape (no ratified rows at all).
    // This is the pre-change product, and it is why the £90,000 option was
    // crowned: the constraint axis correctly has nothing to say.
    const verdict = deriveConstraintVerdict({}, [], 'opt_90k');
    expect(verdict.state).toBe('not_applicable');
    const before = projectClaimSafety(verdict);
    expect(before.may_name_leading_option).toBe(true);

    const recon = deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, []);
    const after = applyIntakeConstraintToLeaderPermission(before, recon);
    expect(after.may_name_leading_option).toBe(false);
    // ⚠ THE STATE FIELD IS NOT TOUCHED (trap 21). This axis has nothing true to
    // say about the CONSTRAINT evidence and must not overwrite a statement
    // about it — and the contract's five-member enum could not carry a sixth
    // value anyway.
    expect(after.constraint_verdict_state).toBe('not_applicable');
  });

  it('is transparent on every non-firing state — the object is returned unchanged', () => {
    const persisted = projectClaimSafety(deriveConstraintVerdict({}, [], 'opt_a'));
    const recon = deriveIntakeConstraintReconciliation('no limits here', []);
    // IDENTITY, not equality: a transparent fold must not even rebuild the
    // object, so a future edit that starts rewriting fields is visible here.
    expect(applyIntakeConstraintToLeaderPermission(persisted, recon)).toBe(persisted);
  });

  it('can only ever REMOVE the permission, never grant it', () => {
    // A verdict that already withholds stays withheld when this axis is silent.
    const withheld = projectClaimSafety(
      deriveConstraintVerdict({ constraints_status: 'unavailable' }, [ROW('c1', 'x')], 'opt_a'),
    );
    expect(withheld.may_name_leading_option).toBe(false);
    const silent = deriveIntakeConstraintReconciliation('no limits here', [ROW('c1', 'x')]);
    expect(silent.mayNameLeadingOption).toBe(true);
    expect(
      applyIntakeConstraintToLeaderPermission(withheld, silent).may_name_leading_option,
    ).toBe(false);
  });
});

describe('the permission table', () => {
  it('declares an answer for every state, and only the new state withholds', () => {
    // Derived from the table's own key set, never a hand-listed copy
    // (CLAUDE.md trap 12), so a future state with no declared answer is visible
    // here rather than reading `undefined` at a call site.
    expect(Object.keys(INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION).sort()).toEqual([
      'limits_unrecorded',
      'not_applicable',
    ]);
    for (const [state, permits] of Object.entries(INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION)) {
      expect(permits).toBe(state !== 'limits_unrecorded');
    }
  });

  it('every reconciliation copies its state’s declared answer', () => {
    for (const [brief, ratified] of [
      ['no limits here', []],
      [WITNESSED_BRIEF, []],
      [WITNESSED_BRIEF, [ROW('c1', 'x')]],
    ] as const) {
      const recon = deriveIntakeConstraintReconciliation(brief, ratified);
      expect(recon.mayNameLeadingOption).toBe(
        INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION[recon.state],
      );
    }
  });
});

describe('what this axis must never claim', () => {
  it('reads no producer envelope at all — the PLoT clamp cannot reach it', () => {
    // PLoT's repair layer clamps a real-money cap (£50,000) to `<= 1` at
    // `severity: info`. On a 0–1 axis that would certify an over-cap option as
    // COMPLIANT. This axis takes no envelope argument, so no clamped value can
    // reach it — pinned by the SIGNATURE, so a future parameter is a visible
    // change here rather than a silent one.
    expect(deriveIntakeConstraintReconciliation.length).toBe(2);
  });

  it('never reports a breach — the state means unresolved, in both directions', () => {
    // The firing state carries the stated limits and NOTHING about compliance:
    // no verdict, no option id, no margin, no probability.
    const recon = deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, []);
    expect(Object.keys(recon).sort()).toEqual([
      'mayNameLeadingOption',
      'state',
      'unrecorded',
    ]);
    expect(recon.unrecorded.every((l) => Object.keys(l).sort().join(',') === 'index,magnitude,text')).toBe(true);
  });
});
