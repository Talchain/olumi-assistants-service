import { describe, it, expect } from 'vitest';

import { impliesOptionInterventionEdit } from '../option-intervention-guard.js';

const OPTIONS = ['Outsource to BPO Vendor', 'In-House Build', 'Status Quo'];

describe('impliesOptionInterventionEdit — option/intervention vocabulary', () => {
  // The three required misroute exemplars from the lane brief — each must
  // be caught so it never silently mutates the shared factor.
  it('catches "Revise the Outsource option so its … intervention costs £135000"', () => {
    expect(
      impliesOptionInterventionEdit(
        'Revise the Outsource option so its Annual Support Cost intervention costs £135000.',
        OPTIONS,
      ),
    ).toBe(true);
  });

  it("catches \"Change the Outsource option's Annual Support Cost to £135000\"", () => {
    expect(
      impliesOptionInterventionEdit(
        "Change the Outsource option's Annual Support Cost to £135000.",
        OPTIONS,
      ),
    ).toBe(true);
  });

  it('catches "Update the cost intervention for the Outsource option"', () => {
    expect(
      impliesOptionInterventionEdit(
        'Update the cost intervention for the Outsource option.',
        OPTIONS,
      ),
    ).toBe(true);
  });

  it('catches the word "intervention" alone (strong CEE-domain signal)', () => {
    expect(
      impliesOptionInterventionEdit('Set the cost intervention to £100k.', OPTIONS),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      impliesOptionInterventionEdit('REVISE THE OUTSOURCE OPTION COST', OPTIONS),
    ).toBe(true);
  });
});

describe('impliesOptionInterventionEdit — naming an option by its full label', () => {
  it('catches a full option-label reference without the word "option"', () => {
    expect(
      impliesOptionInterventionEdit('Bump In-House Build cost to £90k', OPTIONS),
    ).toBe(true);
  });

  it('matches the label on word boundaries (not as an embedded substring)', () => {
    // "Hire" must match "the hire budget" but not "hiring" / "outsourced".
    expect(impliesOptionInterventionEdit('raise the hire budget', ['Hire'])).toBe(true);
    expect(impliesOptionInterventionEdit('we are hiring more staff', ['Hire'])).toBe(false);
  });
});

describe('impliesOptionInterventionEdit — must NOT over-trigger (false-positive guards)', () => {
  it('plain factor-value edit with no option reference → false (legitimate edit still applies)', () => {
    expect(
      impliesOptionInterventionEdit('Set Annual Support Cost to £120,000', OPTIONS),
    ).toBe(false);
  });

  it('"optional" does not match the "option" vocabulary', () => {
    expect(
      impliesOptionInterventionEdit('Increase the optional discount to 5%', OPTIONS),
    ).toBe(false);
  });

  it('returns false when the graph has no options (nothing to misroute to)', () => {
    expect(
      impliesOptionInterventionEdit(
        "Change the Outsource option's cost intervention to £135000",
        [],
      ),
    ).toBe(false);
  });

  it('ignores empty / whitespace option labels', () => {
    expect(impliesOptionInterventionEdit('Set churn to 5%', ['', '   '])).toBe(false);
  });
});
