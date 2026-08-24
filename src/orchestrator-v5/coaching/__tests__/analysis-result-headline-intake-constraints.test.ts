/**
 * THE MEASURED HARM, AT THE SURFACE IT WAS MEASURED ON.
 *
 * Fresh-guest journey, deployed build, 2026-08-24. A brief carrying an explicit
 * £50,000 cap produced ZERO `goal_constraints[]` rows across three journeys.
 * The cap became an ordinary risk node ("Budget Constraint Breach", "50%
 * strength · est.") — a drafted guess, not the user's stated condition. The
 * £90,000 option, £40,000 OVER the cap, was then crowned "Leading option" at
 * 71% (84% on reproduction), with the two compliant options ranked 3rd and 4th
 * and nothing disclosed to the user.
 *
 * ⚠ THE DISCRIMINATING PAIR IS THE POINT OF THIS FILE, not the withhold on its
 * own (CLAUDE.md trap 19). Every `expect(text).toBeNull()` in this estate can be
 * satisfied by a headline builder that has simply stopped working. So each
 * withhold is paired with a POSITIVE CONTROL running the SAME enrichment
 * through the SAME builder with the limit RECORDED, asserting the leader is
 * named BY NAME. One green assertion proves nothing; the pair proves the
 * withhold is caused by the unrecorded limit and by nothing else.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
} from '../analysis-result-headline.js';
import { deriveIntakeConstraintReconciliation } from '../../../orchestrator/context/intake-constraint-reconciliation.js';
import type { RatifiedConstraint } from '../../../orchestrator/context/constraint-feasibility.js';

const CAPPED_BRIEF =
  'We need to modernise the production line this year, with a £50,000 cap.';

/** The £90,000 option leading at 71%, as witnessed. */
const ENRICHMENT: Record<string, unknown> = {
  results: [
    { option_id: 'opt_90k', option_label: 'Full Line Replacement', win_probability: 0.71 },
    { option_id: 'opt_45k', option_label: 'Partial Retrofit', win_probability: 0.14 },
    { option_id: 'opt_30k', option_label: 'Refurbish In Place', win_probability: 0.15 },
  ],
};

const RECORDED_ROW: RatifiedConstraint = {
  constraint_id: 'c_budget',
  label: 'Budget at most £50,000',
  source_quote: null,
};

function inputFor(ratified: readonly RatifiedConstraint[], brief: string | undefined) {
  const intake = deriveIntakeConstraintReconciliation(brief, ratified);
  return {
    intake,
    input: {
      enrichment: ENRICHMENT,
      leading_option_id: 'opt_90k',
      status_kind: 'ok' as const,
      intake_constraints_unrecorded: intake.state === 'limits_unrecorded',
    },
  };
}

describe('the witnessed journey', () => {
  it('WITHHOLDS the leading-option claim when the stated cap was never recorded', () => {
    const { intake, input } = inputFor([], CAPPED_BRIEF);

    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b). Without this the
    // withhold below could be caused by a fixture that quietly stopped
    // reproducing the gap — a discriminator whose discrimination is unguarded
    // at rest, which is exactly how a green suite stops meaning anything.
    expect(intake.state).toBe('limits_unrecorded');
    expect(intake.unrecorded.map((l) => l.text)).toEqual(['£50,000 cap']);

    expect(buildAnalysisResultHeadline(input)).toBeNull();
    expect(describeAnalysisHeadline(input).reason).toBe('intake_constraints_unrecorded');
    expect(describeAnalysisHeadline(input).case).toBeNull();
  });

  it('POSITIVE CONTROL — the SAME run names the leader once the cap is recorded', () => {
    // Same brief, same enrichment, same builder. The ONLY difference is that
    // the limit the user stated now exists on the model. If this does not name
    // the leader, the withhold above proves nothing.
    const { intake, input } = inputFor([RECORDED_ROW], CAPPED_BRIEF);
    expect(intake.state).toBe('not_applicable');
    expect(input.intake_constraints_unrecorded).toBe(false);

    // BOUND BY IDENTITY, not by a value predicate another option could satisfy
    // (trap 19): the control has to name THE £90,000 OPTION. `not.toBeNull()`
    // would be satisfied by a headline naming any of the three.
    expect(buildAnalysisResultHeadline(input)).toContain('Full Line Replacement');
    expect(describeAnalysisHeadline(input).reason).not.toBe('intake_constraints_unrecorded');
  });

  it('POSITIVE CONTROL — the SAME run names the leader when no limit was stated', () => {
    // The second half of the control: it is the UNRECORDED LIMIT that
    // withholds, not merely "a brief was present". A brief stating no explicit
    // limit must leave the product byte-identical to its previous behaviour.
    const { intake, input } = inputFor(
      [],
      'We need to modernise the production line this year.',
    );
    expect(intake.state).toBe('not_applicable');
    expect(buildAnalysisResultHeadline(input)).toContain('Full Line Replacement');
  });

  it('POSITIVE CONTROL — no brief at all leaves the leader named', () => {
    const { intake, input } = inputFor([], undefined);
    expect(intake.state).toBe('not_applicable');
    expect(buildAnalysisResultHeadline(input)).toContain('Full Line Replacement');
  });
});

describe('the flag is transparent when absent', () => {
  it.each([
    ['omitted', {}],
    ['false', { intake_constraints_unrecorded: false }],
    ['undefined', { intake_constraints_unrecorded: undefined }],
  ])('%s ⇒ byte-identical to the pre-change headline', (_name, extra) => {
    const base = {
      enrichment: ENRICHMENT,
      leading_option_id: 'opt_90k',
      status_kind: 'ok' as const,
    };
    // ⚠ `buildAnalysisResultHeadline` returns `string | null`, NOT an object.
    // An earlier draft of this test compared `.text` / `.descriptor` on it and
    // was therefore asserting `undefined === undefined` — vacuously green on
    // any behaviour whatsoever (CLAUDE.md trap 13). Compare the returned values
    // themselves, and pin that they are non-null so the comparison has content.
    const withFlag = buildAnalysisResultHeadline({ ...base, ...extra });
    const without = buildAnalysisResultHeadline(base);
    expect(without).not.toBeNull();
    expect(without).toContain('Full Line Replacement');
    expect(withFlag).toBe(without);
    expect(describeAnalysisHeadline({ ...base, ...extra })).toEqual(
      describeAnalysisHeadline(base),
    );
  });
});

describe('reason-code separation (CLAUDE.md trap 21)', () => {
  it('never files an unrecorded limit under a constraint reason', () => {
    const descriptor = describeAnalysisHeadline(inputFor([], CAPPED_BRIEF).input);
    // Filing a DRAFTING gap under a producer statistic would make the dashboard
    // wrong about both. Three constraint reasons exist and none of them is this.
    expect(descriptor.reason).toBe('intake_constraints_unrecorded');
    expect(descriptor.reason).not.toBe('constraint_unevaluated');
    expect(descriptor.reason).not.toBe('constraint_identity_unresolved');
    expect(descriptor.reason).not.toBe('constraint_infeasible');
  });

  it('an incomplete option set still outranks it — the more fundamental defect', () => {
    // A candidate set that is not the user's set breaks the presupposition that
    // there IS a well-formed set for a leader to exist in.
    const descriptor = describeAnalysisHeadline({
      ...inputFor([], CAPPED_BRIEF).input,
      intake_options_missing: true,
    });
    expect(descriptor.reason).toBe('intake_options_missing');
  });

  it('a constraint reason still wins when a row exists to have an opinion about', () => {
    // With a recorded row the new axis is silent by construction, so the
    // existing reason codes keep their turns exactly as before.
    const descriptor = describeAnalysisHeadline({
      ...inputFor([RECORDED_ROW], CAPPED_BRIEF).input,
      constraint_unevaluated: true,
    });
    expect(descriptor.reason).toBe('constraint_unevaluated');
  });
});
