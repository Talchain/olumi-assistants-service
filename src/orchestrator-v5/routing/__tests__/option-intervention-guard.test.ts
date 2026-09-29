/**
 * SIGNATURE CHANGE, 2026-07-25 — `impliesOptionInterventionEdit` gained a
 * required third argument, `nonOptionLabels` (the labels of every other
 * named entity in the graph). It closes a live data-corruption path: an
 * option referenced by a partial or inflected token — "Running the pop-up
 * pilot reduces Capital Investment in Leeds Site to £20,000" — was not
 * detected and silently rewrote the SHARED factor. See
 * `option-intervention-guard-partial-reference.test.ts` for the live
 * reproduction and `../option-intervention-guard.ts` for the mechanism.
 *
 * Every assertion below is UNCHANGED in message and expected value; only the
 * new argument has been threaded through. The third argument is deliberately
 * populated with a realistic factor vocabulary rather than `[]`, because
 * `[]` is the permissive extreme (nothing is subtracted, so the guard fires
 * most readily) and would make the false-positive tests weaker than
 * production. `FACTOR_LABELS` is what the guard actually sees on a real
 * graph, so these tests keep their discriminating power.
 */
import { describe, it, expect } from 'vitest';

import { impliesOptionInterventionEdit } from '../option-intervention-guard.js';

const OPTIONS = ['Outsource to BPO Vendor', 'In-House Build', 'Status Quo'];

/** The other named entities on the same fixture graph. */
const FACTOR_LABELS = ['Annual Support Cost', 'Customer churn', 'Marketing budget'];

describe('impliesOptionInterventionEdit — option/intervention vocabulary', () => {
  // The three required misroute exemplars from the lane brief — each must
  // be caught so it never silently mutates the shared factor.
  it('catches "Revise the Outsource option so its … intervention costs £135000"', () => {
    expect(
      impliesOptionInterventionEdit(
        'Revise the Outsource option so its Annual Support Cost intervention costs £135000.',
        OPTIONS,
        FACTOR_LABELS,
      ),
    ).toBe(true);
  });

  it("catches \"Change the Outsource option's Annual Support Cost to £135000\"", () => {
    expect(
      impliesOptionInterventionEdit(
        "Change the Outsource option's Annual Support Cost to £135000.",
        OPTIONS,
        FACTOR_LABELS,
      ),
    ).toBe(true);
  });

  it('catches "Update the cost intervention for the Outsource option"', () => {
    expect(
      impliesOptionInterventionEdit(
        'Update the cost intervention for the Outsource option.',
        OPTIONS,
        FACTOR_LABELS,
      ),
    ).toBe(true);
  });

  it('catches the word "intervention" alone (strong CEE-domain signal)', () => {
    expect(
      impliesOptionInterventionEdit(
        'Set the cost intervention to £100k.',
        OPTIONS,
        FACTOR_LABELS,
      ),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      impliesOptionInterventionEdit('REVISE THE OUTSOURCE OPTION COST', OPTIONS, FACTOR_LABELS),
    ).toBe(true);
  });
});

describe('impliesOptionInterventionEdit — naming an option by its full label', () => {
  it('catches a full option-label reference without the word "option"', () => {
    expect(
      impliesOptionInterventionEdit('Bump In-House Build cost to £90k', OPTIONS, FACTOR_LABELS),
    ).toBe(true);
  });

  it('matches the label on word boundaries (not as an embedded substring)', () => {
    // "Hire" must match "the hire budget" but not "hiring" / "outsourced".
    // NOTE: "Hire" is 4 characters, below the distinctive-token floor, so it
    // is never a token cue — this pair still exercises the FULL-LABEL rule
    // exactly as it did before the signature change.
    expect(impliesOptionInterventionEdit('raise the hire budget', ['Hire'], FACTOR_LABELS)).toBe(
      true,
    );
    expect(
      impliesOptionInterventionEdit('we are hiring more staff', ['Hire'], FACTOR_LABELS),
    ).toBe(false);
  });
});

describe('impliesOptionInterventionEdit — must NOT over-trigger (false-positive guards)', () => {
  it('plain factor-value edit with no option reference → false (legitimate edit still applies)', () => {
    expect(
      impliesOptionInterventionEdit('Set Annual Support Cost to £120,000', OPTIONS, FACTOR_LABELS),
    ).toBe(false);
  });

  it('"optional" does not match the "option" vocabulary', () => {
    expect(
      impliesOptionInterventionEdit(
        'Increase the optional discount to 5%',
        OPTIONS,
        FACTOR_LABELS,
      ),
    ).toBe(false);
  });

  it('returns false when the graph has no options (nothing to misroute to)', () => {
    expect(
      impliesOptionInterventionEdit(
        "Change the Outsource option's cost intervention to £135000",
        [],
        FACTOR_LABELS,
      ),
    ).toBe(false);
  });

  it('ignores empty / whitespace option labels', () => {
    expect(impliesOptionInterventionEdit('Set churn to 5%', ['', '   '], FACTOR_LABELS)).toBe(
      false,
    );
  });
});
