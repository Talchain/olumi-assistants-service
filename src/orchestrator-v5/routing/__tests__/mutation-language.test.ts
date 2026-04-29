/**
 * Mutation-language detector — unit tests.
 */

import { describe, expect, it } from 'vitest';

import { containsMutationLanguage } from '../mutation-language.js';

describe('containsMutationLanguage', () => {
  it('detects "Proposing to add X" — the canonical staging-incident phrase', () => {
    // Verbatim staging incident phrase: an explain_from_structure turn
    // produced "Proposing to add a competitive response risk factor..." and
    // the user believed a graph mutation was being made.
    expect(
      containsMutationLanguage(
        'Proposing to add a competitive response risk factor to capture market dynamics.',
      ),
    ).toBe(true);
  });

  it('detects first-person commitment phrases ("I\'ll set", "I\'ll change", "I will update")', () => {
    expect(containsMutationLanguage("I'll set the budget to 300k.")).toBe(true);
    expect(containsMutationLanguage("I'll change the engineering capacity factor.")).toBe(true);
    expect(containsMutationLanguage('I will update the model.')).toBe(true);
    expect(containsMutationLanguage("I'd like to add a hiring constraint.")).toBe(true);
  });

  it('detects "adding/updating/removing the X" action-in-progress phrasing', () => {
    expect(containsMutationLanguage('Adding the engineering factor would help.')).toBe(true);
    expect(containsMutationLanguage('Updating the budget value to 250k.')).toBe(true);
    expect(containsMutationLanguage('Removing the Q3 deadline factor.')).toBe(true);
  });

  it('detects "I\'d suggest adding/updating" framing', () => {
    expect(containsMutationLanguage("I'd suggest adding a calibration step.")).toBe(true);
    expect(containsMutationLanguage('I would suggest updating the link strength.')).toBe(true);
  });

  it('returns false for benign explanation prose with no mutation language', () => {
    const benign = [
      'Engineering Capacity has the strongest causal footprint across your goal at 0.65 strength.',
      'The leading option performs best because of the combined effect of three factors.',
      'Looking at the model structure, the strongest direct link is from Capacity to Throughput.',
      'Probability sits at 62 per cent with a stable robustness band; the runner-up trails by twelve points.',
      'No analysis has been run on your model yet. The graph has 4 options configured and is ready to analyse.',
    ];
    for (const text of benign) {
      expect(containsMutationLanguage(text)).toBe(false);
    }
  });

  it('returns false for empty / non-string input', () => {
    expect(containsMutationLanguage('')).toBe(false);
    // Defensive against caller bugs — runtime types may diverge from TS.
    expect(containsMutationLanguage(undefined as unknown as string)).toBe(false);
    expect(containsMutationLanguage(null as unknown as string)).toBe(false);
  });

  it('is case-insensitive on the patterns it matches', () => {
    expect(containsMutationLanguage('PROPOSING TO ADD a factor')).toBe(true);
    expect(containsMutationLanguage("i'll set the value")).toBe(true);
  });
});
