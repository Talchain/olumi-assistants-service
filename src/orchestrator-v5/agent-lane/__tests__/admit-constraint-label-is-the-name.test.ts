/**
 * ⛔ THE LIMIT'S LABEL IS ITS NAME, NOT THE LIMIT.
 *
 * `GoalConstraintSchema.label` is a "Human-readable label, e.g. 'First-year budget cap'"; the bound is carried by
 * `operator` / `value` / `unit`, and every consumer renders those itself. The agent lane minted
 * "Annual PA salary < 40000GBP/year", so the served canvas pill read "Annual PA salary < 40000GBP/year ≤ 40,000
 * GBP/year" (Canvas D2, 5832368556), and the "could not be checked" card quoted the drafter's STRICT "<" while the
 * stored bound is the widened "<=" (source trace 5831577022).
 *
 * So the admitted label is the metric's name, and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateConstraints, type CandidateConstraint } from '../admit-constraint.js';
import { buildConstraintDisclosureFromState } from '../../coaching/constraint-gap-disclosure.js';

const ids: Record<string, string> = { 'Annual PA salary': 'annual_pa_salary', 'Gross margin': 'gross_margin' };
const admit = (c: CandidateConstraint) => admitCandidateConstraints([c], (m) => ids[m]).constraints[0]!;

describe('the admitted limit label is the limit\'s name', () => {
  it('D2: "Annual PA salary" < 40000 GBP/year → label "Annual PA salary"; the bound stays in operator/value/unit', () => {
    const a = admit({ metric: 'Annual PA salary', operator: '<', value: 40000, unit: 'GBP/year', provenance: 'explicit' });
    expect(a.label).toBe('Annual PA salary');
    expect(a.operator).toBe('<=');
    expect(a.value).toBe(40000);
    expect(a.unit).toBe('GBP/year');
  });

  it('no label carries a symbol, the value or the unit, whatever the operator', () => {
    for (const operator of ['<', '<=', '>', '>='] as const) {
      const a = admit({ metric: 'Gross margin', operator, value: 70, unit: '%', provenance: 'explicit' });
      expect(a.label).toBe('Gross margin');
      expect(a.label).not.toMatch(/[<>]=?|70|%/);
    }
  });

  it('THE CARD: the "could not be checked" disclosure quotes the limit by its name (it survives the egress)', () => {
    const a = admit({ metric: 'Annual PA salary', operator: '<', value: 40000, unit: 'GBP/year', provenance: 'explicit' });
    const card = buildConstraintDisclosureFromState('unevaluated', [{ constraint_id: a.constraint_id, label: a.label ?? null }]);
    expect(card, 'PRECONDITION: the unevaluated state discloses').toMatch(/could not be checked/);
    expect(card).toContain('“Annual PA salary”');
    expect(card).not.toMatch(/[<>]=?/);
  });
});
