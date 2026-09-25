/**
 * ⛔ THE LIMIT'S LABEL IS WHAT THE GUEST READS, AND IT SHOWED THE WRONG BOUND AS A SYMBOL.
 *
 * The admitted label is quoted verbatim in the "could not be checked" card (`constraint-gap-disclosure.ts`, source
 * trace 5831577022): "One limit on your model could not be checked: “Total first-year cost < 250000GBP”". It was
 * built from the CANDIDATE operator ("<"), while the stored bound is the widened canonical one ("<="), so the card
 * promised a strict bound the model does not hold, in a symbol, with the unit glued to the number.
 *
 * So the label is built from the canonical operator, in words: "at most" / "at least".
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateConstraints, type CandidateConstraint } from '../admit-constraint.js';
import { buildConstraintDisclosureFromState } from '../../coaching/constraint-gap-disclosure.js';

const ids: Record<string, string> = { 'Total first-year cost': 'total_first_year_cost', 'Gross margin': 'gross_margin' };
const admit = (c: CandidateConstraint) => admitCandidateConstraints([c], (m) => ids[m]).constraints[0]!;

describe('the admitted limit label says the stored bound in words', () => {
  it('"<" 250000 GBP → "at most 250000 GBP", matching the stored <=', () => {
    const a = admit({ metric: 'Total first-year cost', operator: '<', value: 250000, unit: 'GBP', provenance: 'explicit' });
    expect(a.operator).toBe('<=');
    expect(a.label).toBe('Total first-year cost at most 250000 GBP');
  });

  it('">" 70 % → "at least 70%"', () => {
    const a = admit({ metric: 'Gross margin', operator: '>', value: 70, unit: '%', provenance: 'explicit' });
    expect(a.operator).toBe('>=');
    expect(a.label).toBe('Gross margin at least 70%');
  });

  it('no label carries a comparison symbol, whatever the operator', () => {
    for (const operator of ['<', '<=', '>', '>='] as const) {
      const a = admit({ metric: 'Gross margin', operator, value: 70, unit: '%', provenance: 'explicit' });
      expect(a.label).not.toMatch(/[<>]=?/);
    }
  });

  it('THE CARD: the "could not be checked" disclosure still QUOTES the label in words (it survives the egress)', () => {
    const a = admit({ metric: 'Total first-year cost', operator: '<', value: 250000, unit: 'GBP', provenance: 'explicit' });
    const card = buildConstraintDisclosureFromState('unevaluated', [{ constraint_id: a.constraint_id, label: a.label ?? null }]);
    expect(card, 'PRECONDITION: the unevaluated state discloses').toMatch(/could not be checked/);
    expect(card).toContain('“Total first-year cost at most 250000 GBP”');
    expect(card).not.toMatch(/[<>]=?/);
  });

  it('a word unit takes a space, a symbol unit attaches ("5 percentage points", "5% NRR")', () => {
    const pp = admit({ metric: 'Gross margin', operator: '<=', value: 5, unit: 'percentage points', provenance: 'explicit' });
    expect(pp.label).toBe('Gross margin at most 5 percentage points');
    const nrr = admit({ metric: 'Gross margin', operator: '>=', value: 5, unit: '% NRR', provenance: 'explicit' });
    expect(nrr.label).toBe('Gross margin at least 5% NRR');
  });

  it('a limit with no unit reads cleanly', () => {
    const a = admit({ metric: 'Gross margin', operator: '>=', value: 3, provenance: 'explicit' });
    expect(a.label).toBe('Gross margin at least 3');
  });
});
