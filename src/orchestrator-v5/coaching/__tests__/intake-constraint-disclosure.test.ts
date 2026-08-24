/**
 * THE INTAKE_UNRECORDED DISCLOSURE — what the user reads when the limit they
 * stated was never recorded on their model.
 *
 * The founder's ratified doctrine, clause three, is the specification:
 *
 *   "If compliance CANNOT be evaluated: do not silently recommend across the
 *    unknown — state that compliance is unresolved, identify the missing
 *    information, and withhold or qualify the recommendation."
 *
 * So the copy has exactly three jobs, and this file pins all three plus the two
 * claims it must NEVER make (a breach, or compliance).
 *
 * ⚠ AND IT PINS THE PLUMBING, because a disclosure without it is INERT in
 * production: the composed summary passes through the registry-side egress
 * allowlist, which replaces anything not matching the published grammar with a
 * locked literal. A copy edit that breaks the grammar produces no error
 * anywhere — the user just silently receives "Ran analysis on your current
 * scenario." That is how the first revision of the sibling constraint-gap
 * disclosure shipped dark.
 */

import { describe, it, expect } from 'vitest';

import {
  buildConstraintDisclosure,
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
  CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS,
} from '../constraint-gap-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';
import {
  deriveConstraintVerdict,
  type ConstraintVerdict,
  type RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';
import {
  deriveIntakeConstraintReconciliation,
  type IntakeConstraintReconciliation,
} from '../../../orchestrator/context/intake-constraint-reconciliation.js';

const WITNESSED_BRIEF =
  'We need to modernise the production line this year, with a £50,000 cap.';

const ROW = (id: string, label: string): RatifiedConstraint => ({
  constraint_id: id,
  label,
  source_quote: null,
});

/** The verdict on the witnessed journey: no ratified rows at all. */
const NOT_APPLICABLE_VERDICT: ConstraintVerdict = deriveConstraintVerdict({}, [], 'opt_90k');

const WITNESSED_INTAKE: IntakeConstraintReconciliation =
  deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, []);

function disclose(
  intake: IntakeConstraintReconciliation | null,
  verdict: ConstraintVerdict = NOT_APPLICABLE_VERDICT,
): string {
  return buildConstraintDisclosure(verdict, WITNESSED_BRIEF, intake);
}

describe('what the user reads when their stated cap was never recorded', () => {
  it('says all three doctrine-required things, and says them exactly', () => {
    expect(disclose(WITNESSED_INTAKE)).toBe(
      ' Your brief states a limit that is not recorded on your model: “£50,000 cap”.' +
        ' It was not part of this analysis, so whether it holds is unresolved and no' +
        ' option can be put forward yet.' +
        ' Tell me the limit you meant in your own words and I will record it, then run' +
        ' the analysis again.',
    );
  });

  it('IDENTIFIES THE MISSING INFORMATION — verbatim, in the user’s own words', () => {
    const text = disclose(WITNESSED_INTAKE);
    expect(text).toContain('£50,000 cap');
    // The quoted span must be a contiguous slice of the submitted brief, or the
    // product is attributing words to the user that they did not write.
    expect(WITNESSED_BRIEF).toContain('£50,000 cap');
  });

  it('STATES COMPLIANCE IS UNRESOLVED, and WITHHOLDS', () => {
    const text = disclose(WITNESSED_INTAKE);
    expect(text).toContain('unresolved');
    expect(text).toContain('no option can be put forward yet');
  });

  it('IS NOT A DEAD END — it offers a repair the user can act on', () => {
    // Safety must not reduce the product to a refusal. A user told only "I
    // cannot check your budget cap" has nowhere to go.
    expect(disclose(WITNESSED_INTAKE)).toContain(
      'Tell me the limit you meant in your own words and I will record it',
    );
  });

  it('NEVER claims a breach and NEVER claims compliance', () => {
    const text = disclose(WITNESSED_INTAKE).toLowerCase();
    for (const forbidden of [
      'breach',
      'breached',
      'exceeds',
      'exceeded',
      'violat',
      'over budget',
      'within budget',
      'satisfies',
      'satisfied',
      'complies',
      'compliant',
      'passes',
      'fails',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('does not claim the user AUTHORED anything, only that the brief states it', () => {
    // `goal_constraints[]` rows are minted by the drafter as well as the user,
    // and this voice speaks where there is no row at all. "Your brief states" is
    // exactly as strong as the evidence; "you set" would not be.
    const text = disclose(WITNESSED_INTAKE);
    expect(text).toContain('Your brief states');
    expect(text).not.toContain('you set');
    expect(text).not.toContain('Re-state');
  });

  it('does not promise the unrecorded limit stays on the model', () => {
    // The sibling `unevaluated` repair step ends "…this one stays on the
    // model", disclosing that a correction appends beside the bad row. There is
    // no row here, so that clause would be false.
    expect(disclose(WITNESSED_INTAKE)).not.toContain('stays on the model');
  });
});

describe('plural and degraded shapes', () => {
  const twoLimits = deriveIntakeConstraintReconciliation(
    'Spend no more than £50,000 and keep gross margin at least 78%.',
    [],
  );

  it('names both limits in the plural form', () => {
    expect(twoLimits.state).toBe('limits_unrecorded');
    const text = disclose(twoLimits);
    expect(text).toContain('Your brief states 2 limits that are not recorded on your model');
    expect(text).toContain('“no more than £50,000”');
    expect(text).toContain('“at least 78%”');
    expect(text).toContain('whether they hold is unresolved');
    expect(text).toContain('I will record them');
  });

  it('degrades to a count-only form rather than losing the disclosure', () => {
    // A span that cannot be rendered costs SPECIFICITY, never the whole
    // sentence — the fall gives up exactly one thing.
    const unnameable: IntakeConstraintReconciliation = {
      state: 'limits_unrecorded',
      mayNameLeadingOption: false,
      unrecorded: [{ text: 'x'.repeat(400), magnitude: 1, index: 0 }],
    };
    const text = disclose(unnameable);
    expect(text).toBe(
      ' Your brief states a limit that is not recorded on your model.' +
        ' It was not part of this analysis, so whether it holds is unresolved and no' +
        ' option can be put forward yet.' +
        ' Tell me the limit you meant in your own words and I will record it, then run' +
        ' the analysis again.',
    );
    expect(isAllowedRunAnalysisAssistantText(`Ran analysis on your current scenario.${text}`)).toBe(
      true,
    );
  });

  it('says nothing rather than announce a gap it cannot name', () => {
    // Silence beats a hedge: a disclosure that says "a limit is missing"
    // without saying which is the generic hedge the doctrine forbids.
    expect(
      disclose({ state: 'limits_unrecorded', mayNameLeadingOption: false, unrecorded: [] }),
    ).toBe('');
  });
});

describe('the plumbing — this copy must survive the registry egress', () => {
  it('the composed summary is ADMITTED by the allowlist', () => {
    const text = disclose(WITNESSED_INTAKE);
    expect(
      isAllowedRunAnalysisAssistantText(`Ran analysis on your current scenario.${text}`),
    ).toBe(true);
  });

  it('matches this module’s own published grammar, exactly and anchored', () => {
    const anchored = new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`);
    for (const intake of [WITNESSED_INTAKE, deriveIntakeConstraintReconciliation(
      'Spend no more than £50,000 and keep gross margin at least 78%.',
      [],
    )]) {
      expect(anchored.test(disclose(intake))).toBe(true);
    }
  });

  it('fits the derived budget, which now covers the new voice', () => {
    const text = disclose(WITNESSED_INTAKE);
    expect(text.length).toBeLessThanOrEqual(CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS);
  });

  it('the grammar still cannot match the empty string', () => {
    // The anchored template branch of the allowlist depends on this.
    expect(new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`).test('')).toBe(false);
  });
});

describe('the existing voices are untouched — this is an addition, not a re-tuning', () => {
  const ratified = [ROW('c_budget', 'Budget at most £50,000')];

  it.each([
    [
      'unevaluated',
      deriveConstraintVerdict({ constraints_status: 'unavailable' }, ratified, 'opt_a'),
    ],
    [
      'identity_unresolved',
      deriveConstraintVerdict(
        { constraint_results: [{ constraint_id: 'other_id' }] },
        ratified,
        'opt_a',
      ),
    ],
  ])('the %s voice is byte-identical with and without the new argument', (_name, verdict) => {
    const before = buildConstraintDisclosure(verdict, WITNESSED_BRIEF);
    const after = buildConstraintDisclosure(
      verdict,
      WITNESSED_BRIEF,
      // A row exists, so the new axis is silent — which is the whole point.
      deriveIntakeConstraintReconciliation(WITNESSED_BRIEF, ratified),
    );
    expect(before.length).toBeGreaterThan(0);
    expect(after).toBe(before);
  });

  it('a null/absent third argument leaves every caller byte-identical', () => {
    const verdict = deriveConstraintVerdict({ constraints_status: 'unavailable' }, ratified, 'opt_a');
    expect(buildConstraintDisclosure(verdict, WITNESSED_BRIEF, null)).toBe(
      buildConstraintDisclosure(verdict, WITNESSED_BRIEF),
    );
    expect(buildConstraintDisclosure(verdict, WITNESSED_BRIEF, undefined)).toBe(
      buildConstraintDisclosure(verdict, WITNESSED_BRIEF),
    );
  });

  it('the new voice is silent on a not_applicable turn with no stated limit', () => {
    // The commonest turn in the product. It must be byte-identical to before.
    const recon = deriveIntakeConstraintReconciliation('no limits stated here', []);
    expect(buildConstraintDisclosure(NOT_APPLICABLE_VERDICT, 'no limits stated here', recon)).toBe(
      '',
    );
  });
});

describe('mutual exclusivity — a property, not an assumption', () => {
  it('the new voice can only speak where every other voice is silent', () => {
    // It fires only when the model records NO ratified constraint. With none,
    // `deriveConstraintVerdict` partitions an empty set, exits at
    // `effective.length === 0` to `not_applicable` (state voice ''), and has
    // nothing to place on `outOfScopeConstraints` ('').
    const verdict = deriveConstraintVerdict(
      {
        constraints_status: 'unavailable',
        _meta: { filtered_constraints: [{ constraint_id: 'c_budget' }] },
      },
      [], // ZERO ratified rows — the precondition for the new voice
      'opt_90k',
    );
    expect(verdict.state).toBe('not_applicable');
    expect(verdict.constraints).toEqual([]);
    expect(verdict.outOfScopeConstraints).toEqual([]);

    const text = buildConstraintDisclosure(verdict, WITNESSED_BRIEF, WITNESSED_INTAKE);
    // Exactly one voice speaks.
    expect(text).toContain('Your brief states a limit that is not recorded');
    expect(text).not.toContain('could not be checked');
    expect(text).not.toContain('This analysis does not test');
  });

  it('the grammar nevertheless admits the pairs, so reachability is not load-bearing', () => {
    // A reachability argument must not be what stands between a user and their
    // disclosure. If the exclusivity above were ever broken by a change
    // elsewhere, the composed pair still survives the egress rather than
    // reverting the whole summary to the locked template.
    const stateVoiceVerdict = deriveConstraintVerdict(
      { constraints_status: 'unavailable' },
      [ROW('c_budget', 'Budget at most £50,000')],
      'opt_a',
    );
    const stateText = buildConstraintDisclosure(stateVoiceVerdict, WITNESSED_BRIEF);
    const pair = `${stateText}${disclose(WITNESSED_INTAKE)}`;
    expect(new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`).test(pair)).toBe(true);
    expect(pair.length).toBeLessThanOrEqual(CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS);
  });
});
