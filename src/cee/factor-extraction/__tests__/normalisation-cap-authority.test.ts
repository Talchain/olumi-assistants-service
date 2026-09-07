/**
 * `isNormalisationMintedCap` — the predicate, in BOTH directions.
 *
 * This predicate decides whether a user-stated value may outrank a factor's
 * cap. Two OPPOSITE harms sit under it, and the estate has shipped a fix and
 * its exact inverse in consecutive rounds on this class of predicate
 * (CLAUDE.md traps 22b / 22d), so every case here carries its
 * opposite-direction twin:
 *
 *   · answering TRUE where the cap is a real bound would let a genuine unit
 *     slip through — the defect class the cap exists to catch;
 *   · answering FALSE where the cap is a normalisation artefact traps the
 *     user behind a number no one stated — the founder defect this closes.
 *
 * The expectations are derived from the PRODUCER, not from the failure mode:
 * both minting sites in `enricher.ts` read, byte-identically,
 *
 *     if (factor.unit !== "%" && factor.value > 1) {
 *       cap = computeNormalisationCap(factor.value);
 *       ...
 *     }
 *
 * so each conjunct below is tested against that gate rather than against the
 * founder's numbers (CLAUDE.md traps 13c / 13d).
 */

import { describe, it, expect } from 'vitest';

import {
  computeNormalisationCap,
  isNormalisationMintedCap,
} from '../normalisation-cap.js';

describe('computeNormalisationCap — unchanged by the move out of enricher.ts', () => {
  it.each([
    [80, 100],
    [800, 1000],
    [50_000, 100_000],
    [100, 100],
    [1, 1],
    [0, 1],
    [-5, 1],
  ])('computeNormalisationCap(%s) === %s', (raw, expected) => {
    expect(computeNormalisationCap(raw)).toBe(expected);
  });
});

describe('isNormalisationMintedCap — TRUE only where the enricher could have minted it', () => {
  it('THE FOUNDER NODE, as captured on the wire at deployed CEE 578e809', () => {
    // observed_state {"value":0.8,"unit":"£","raw_value":80,"cap":100} on node
    // 919d7f50 "Sales Headcount Investment". 100 is exactly
    // computeNormalisationCap(80), so the bound is an artefact of the stored
    // magnitude and not a scale anyone stated.
    expect(
      isNormalisationMintedCap({ factorCap: 100, factorObservedRawValue: 80, factorUnit: '£' }),
    ).toBe(true);
  });

  it.each([
    ['£', 800, 1000],
    ['$', 50_000, 100_000],
    ['months', 18, 100],
    ['people', 3, 10],
  ])('a %s factor storing %s under cap %s reads as minted', (unit, raw, cap) => {
    expect(
      isNormalisationMintedCap({ factorCap: cap, factorObservedRawValue: raw, factorUnit: unit }),
    ).toBe(true);
    // Precondition, in-test: the cap under assertion really is this
    // function's own output for this magnitude, so the TRUE above is the
    // predicate's doing and not the fixture's (CLAUDE.md trap 13b).
    expect(computeNormalisationCap(raw)).toBe(cap);
  });
});

describe('isNormalisationMintedCap — FALSE, one row per conjunct, each the opposite-direction twin', () => {
  it('TWIN of the founder row — a PERCENTAGE factor on 0-100 is NEVER minted here', () => {
    // The minting gate is `factor.unit !== "%"`, so a percent factor's cap is
    // intrinsic to its unit. This is the row that keeps "120000%" refused
    // against a genuine percentage scale. Note the numbers are otherwise
    // IDENTICAL to a minted case (100 === computeNormalisationCap(80)) — only
    // the unit differs, so the row cannot pass by accident.
    expect(computeNormalisationCap(80)).toBe(100);
    expect(
      isNormalisationMintedCap({ factorCap: 100, factorObservedRawValue: 80, factorUnit: '%' }),
    ).toBe(false);
  });

  it('a cap that is NOT this function output for the stored magnitude — a declared scale', () => {
    // A user who says "the budget scale runs to £200,000" leaves a cap the
    // order-of-magnitude rule would never produce (it emits powers of ten).
    expect(computeNormalisationCap(80_000)).toBe(100_000);
    expect(
      isNormalisationMintedCap({
        factorCap: 200_000,
        factorObservedRawValue: 80_000,
        factorUnit: '£',
      }),
    ).toBe(false);
  });

  it('a stored magnitude of 1 or below — outside the minting gate `factor.value > 1`', () => {
    expect(
      isNormalisationMintedCap({ factorCap: 1, factorObservedRawValue: 1, factorUnit: '£' }),
    ).toBe(false);
    expect(
      isNormalisationMintedCap({ factorCap: 1, factorObservedRawValue: 0.8, factorUnit: '£' }),
    ).toBe(false);
  });

  it('a factor with NO stored magnitude — nothing to recognise the cap against', () => {
    expect(
      isNormalisationMintedCap({
        factorCap: 100,
        factorObservedRawValue: undefined,
        factorUnit: '£',
      }),
    ).toBe(false);
  });

  it('an UNCAPPED factor — the framed/capless shape the records projector writes', () => {
    expect(
      isNormalisationMintedCap({
        factorCap: undefined,
        factorObservedRawValue: 80,
        factorUnit: '£',
      }),
    ).toBe(false);
  });

  it('non-finite inputs are refused rather than propagated', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        isNormalisationMintedCap({ factorCap: bad, factorObservedRawValue: 80, factorUnit: '£' }),
      ).toBe(false);
      expect(
        isNormalisationMintedCap({ factorCap: 100, factorObservedRawValue: bad, factorUnit: '£' }),
      ).toBe(false);
    }
  });

  it('NEGATIVE magnitudes — the class a corpus of positive money figures would omit', () => {
    // The contract admits a bare `z.number()`, so the sign-symmetric case is
    // inside the domain even though no founder figure exercises it. Checking
    // what the corpus EXCLUDES, not only what it covers (CLAUDE.md trap 13d).
    expect(
      isNormalisationMintedCap({ factorCap: 1, factorObservedRawValue: -80, factorUnit: '£' }),
    ).toBe(false);
    expect(
      isNormalisationMintedCap({ factorCap: 100, factorObservedRawValue: -80, factorUnit: '£' }),
    ).toBe(false);
  });
});
