/**
 * ⭐⭐ A LIMIT ON A SCALE THE TARGET'S DOMAIN CANNOT CARRY.
 *
 * The predicate under test mirrors PLoT's own out-of-domain gate, derived at
 * `plot-lite-service` staging `d68d4ffb` (17 Sep 2026),
 * `src/normalisation/constraint-filter.ts:158`:
 *
 *   isProbabilityNode && (value < 0 || value > 1) && !isTemporalUnit
 *     && !scalableIntoDomain   -> plot.constraint_out_of_domain
 *
 * with `PROBABILITY_DOMAIN_KINDS = {goal, outcome, risk}` (:41) and the
 * constraint STILL FORWARDED to ISL (warn, don't drop). So the limit is scored
 * against a [0,1] score and is satisfied by every option, forever.
 *
 * ⚠ THE TESTS BELOW ARE WRITTEN AGAINST THAT SPEC, NOT AGAINST THE MEASURED
 * SYMPTOM (CLAUDE.md trap 13d). The sign-symmetric `value < 0` limb and the
 * percent escape each get a case of their own, because each is a direction the
 * failure in hand does not point in.
 */
import { describe, expect, it } from 'vitest';

import { classifyConstraintScaleDomain } from '../constraint-scale-domain.js';

/** Paul's 16 Sep node, verbatim, but WITH the figure that hides the defect. */
const BUDGET_OVERRUN_RISK = {
  id: 'b87d004b',
  kind: 'risk',
  label: 'Budget Overrun',
  observed_state: { value: 0.3 },
};

describe('classifyConstraintScaleDomain', () => {
  it('REFUSES a currency limit on a risk node scored 0-1', () => {
    const verdict = classifyConstraintScaleDomain({
      target: BUDGET_OVERRUN_RISK,
      value: 200000,
      unit: '£',
    });
    expect(verdict).toEqual({ carriable: false, reason: 'target_scored_on_unit_interval' });
  });

  it('REFUSES the same limit spelled as a currency CODE', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: 200000, unit: 'GBP' }),
    ).toEqual({ carriable: false, reason: 'target_scored_on_unit_interval' });
  });

  it('REFUSES a NEGATIVE out-of-domain limit — the sign-symmetric limb', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: -5000, unit: '£' }),
    ).toEqual({ carriable: false, reason: 'target_scored_on_unit_interval' });
  });

  it('REFUSES on a goal node, which the measurability gate exempts entirely', () => {
    expect(
      classifyConstraintScaleDomain({
        target: { id: 'g1', kind: 'goal', label: 'Ship on budget', observed_state: { value: 0.5 } },
        value: 200000,
        unit: '£',
      }),
    ).toEqual({ carriable: false, reason: 'target_scored_on_unit_interval' });
  });

  // ── THE OPPOSITE DIRECTION: cases PLoT does NOT warn on, so we MUST be silent.

  it('is SILENT on a percent limit above 1 — PLoT resolves it against a cap of 100', () => {
    expect(
      classifyConstraintScaleDomain({
        target: { id: '8b73e070', kind: 'risk', label: 'Subscriber Churn Rate', observed_state: { value: 0.04 } },
        value: 7,
        unit: '%',
      }),
    ).toBeNull();
  });

  it('is SILENT when the node declares its own goal_threshold_cap', () => {
    expect(
      classifyConstraintScaleDomain({
        target: { ...BUDGET_OVERRUN_RISK, goal_threshold_cap: 250000 },
        value: 200000,
        unit: '£',
      }),
    ).toBeNull();
  });

  it('is SILENT for a cap carried on the V1 `data` sibling', () => {
    expect(
      classifyConstraintScaleDomain({
        target: { ...BUDGET_OVERRUN_RISK, data: { goal_threshold_cap: 250000 } },
        value: 200000,
        unit: '£',
      }),
    ).toBeNull();
  });

  it('is SILENT on a FACTOR — factors are not scored on the unit interval', () => {
    expect(
      classifyConstraintScaleDomain({
        target: { id: '7809def4', kind: 'factor', label: 'Hiring and Onboarding Cost', observed_state: { value: 0.6 } },
        value: 200000,
        unit: '£',
      }),
    ).toBeNull();
  });

  it('is SILENT when the limit is already inside [0,1]', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: 0.3, unit: '£' }),
    ).toBeNull();
  });

  it('is SILENT for a non-currency unit — the entailment is only proven for currency', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: 200000, unit: 'users' }),
    ).toBeNull();
  });

  it('is SILENT with no unit at all', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: 200000, unit: undefined }),
    ).toBeNull();
  });

  it('is SILENT on a non-finite value rather than reading it as out of range', () => {
    expect(
      classifyConstraintScaleDomain({ target: BUDGET_OVERRUN_RISK, value: Number.NaN, unit: '£' }),
    ).toBeNull();
  });
});
