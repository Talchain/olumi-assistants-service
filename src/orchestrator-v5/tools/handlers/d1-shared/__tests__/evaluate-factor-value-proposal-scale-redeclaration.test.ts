/**
 * ROADMAP 2.159 (re-scoped) — the SILENT SCALE REDECLARATION guards.
 *
 * The handler persists `after.unit = parsed.unit ?? before.unit` and
 * `after.cap = parsed.cap ?? before.cap`, so a proposal carrying a unit or a
 * cap permanently changes WHAT A FACTOR MEASURES on a factor that had neither
 * — with no consent step, and (for the cap) no intervention renormalisation,
 * because `capChanged` requires `before.cap !== undefined`.
 *
 * ⚠ WHAT THIS FILE DELIBERATELY DOES NOT TEST. It does not bound an uncapped,
 * unitless factor to [0,1]. The first attempt at this workstream did, by
 * classifying a factor as normalised when its stored value happened to sit in
 * [0,1]; adversarial review refuted that at the bytes (a small COUNT factor at
 * 0 or 1 is indistinguishable by magnitude, and was refused a legitimate 1→3
 * edit with factually false copy). Bounding a normalised factor needs a
 * DECLARED scale on the contract — rowed as 2.193. Until then an uncapped
 * unitless factor is as unbounded as it has always been, and the tests below
 * assert that fail-open explicitly rather than leaving it implied.
 */
import { describe, it, expect } from 'vitest';

import {
  canonicaliseUnit,
  evaluateFactorValueProposal,
  evaluatePostOperatorFactorValue,
  type ProposalRejectionReason,
} from '../evaluate-factor-value-proposal.js';
import { normaliseFactorValue } from '../normalise-factor-value.js';

describe('unit_redeclares_scale', () => {
  it('REFUSES a unit-bearing proposal against a factor recorded WITHOUT a unit', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 0.9,
      operator: 'set',
      unit: '%',
      factorObservedValue: 0.65,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe<ProposalRejectionReason>('unit_redeclares_scale');
      expect(r.specific_issue).toBe(
        'This factor is recorded without a unit, so applying a value in % would change what it measures.',
      );
    }
  });

  it('the refusal copy carries NO computed number — only the stated unit', () => {
    // Regression pin: an earlier draft interpolated a post-operator float and
    // rendered "the value given was 1.2999999999999998".
    const r = evaluateFactorValueProposal({
      rawInput: 0.30000000000000004,
      operator: 'set',
      unit: '£',
      factorObservedValue: 0.65,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.specific_issue).not.toMatch(/\d{6}/);
  });

  it('is inert when the factor ALREADY has that unit (unit_mismatch owns the disagreement case)', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 50,
        operator: 'set',
        unit: '%',
        factorUnit: '%',
        factorObservedValue: 0.4,
        factorObservedRawValue: 40,
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
  });

  it('is inert on a FIRST-TIME declaration — a factor with no recorded value', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 50000,
        operator: 'set',
        unit: '£',
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
  });

  it('is inert for a bare (unit-less) proposal', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 0.9,
        operator: 'set',
        factorObservedValue: 0.65,
        inputHasUnit: false,
      }).ok,
    ).toBe(true);
  });
});

describe('cap_redeclares_scale', () => {
  it('REFUSES a cap-bearing proposal against a factor recorded WITHOUT a cap', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 1.5,
      operator: 'set',
      proposalCap: 2,
      factorObservedValue: 0.7,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe<ProposalRejectionReason>('cap_redeclares_scale');
      expect(r.specific_issue).toBe(
        'This factor is recorded without an upper limit, so applying this change would set one and rescale the factor.',
      );
    }
  });

  it('LEAVES THE CONSENTED CAP EXTENSION ALONE — the factor already has a cap', () => {
    // 1.16 item A2's replay shape, on a factor whose cap is already set. That
    // path renormalises option interventions; it must not be caught here.
    expect(
      evaluateFactorValueProposal({
        rawInput: 250000,
        operator: 'set',
        unit: '£',
        proposalCap: 312500,
        factorCap: 100000,
        factorUnit: '£',
        factorObservedValue: 0.4,
        factorObservedRawValue: 40000,
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
  });

  it('is inert on a first-time declaration — a factor with no recorded value', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 50000,
        operator: 'set',
        unit: '£',
        proposalCap: 100000,
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
  });

  it('still reports cap_non_positive first for a nonsensical cap', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 5,
      operator: 'set',
      proposalCap: 0,
      factorObservedValue: 0.7,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('cap_non_positive');
  });
});

describe('THE FAIL-OPEN, asserted explicitly (an uncapped unitless factor is NOT bounded)', () => {
  it('ACCEPTS 1.5 on an uncapped, unitless factor — this is 2.193, not closed here', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 1.5,
        operator: 'set',
        factorObservedValue: 0.65,
        inputHasUnit: false,
      }).ok,
    ).toBe(true);
  });

  it('ACCEPTS a legitimate small-COUNT edit 1 -> 3 (the refuted heuristic broke this)', () => {
    // `prompts/defaults-v187.ts:301` — "Small count (0-10) | raw integer".
    expect(
      evaluateFactorValueProposal({
        rawInput: 3,
        operator: 'set',
        factorObservedValue: 1,
        factorObservedRawValue: 1,
        inputHasUnit: false,
      }).ok,
    ).toBe(true);
  });

  it('ACCEPTS a count edit in BOTH directions — no one-way trapdoor', () => {
    for (const [from, to] of [[3, 1], [1, 4], [0, 7], [7, 0]] as const) {
      expect(
        evaluateFactorValueProposal({
          rawInput: to,
          operator: 'set',
          factorObservedValue: from,
          factorObservedRawValue: from,
          inputHasUnit: false,
        }).ok,
      ).toBe(true);
    }
  });
});

describe('the execute-time backstop applies the SAME gates', () => {
  it('normaliseFactorValue throws on a unit redeclaration', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: 0.9,
        unit: '%',
        factorObservedValue: 0.65,
        inputHasUnit: true,
      }),
    ).toThrow(/recorded without a unit/);
  });

  it('evaluatePostOperatorFactorValue forwards the fields (not silently dropped)', () => {
    const r = evaluatePostOperatorFactorValue({
      computedRaw: 1.5,
      proposalCap: 2,
      factorObservedValue: 0.7,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('cap_redeclares_scale');
  });

  it('still writes raw === model for an in-range uncapped value (no cap invented)', () => {
    expect(
      normaliseFactorValue({ rawInput: 0.8, factorObservedValue: 0.65, inputHasUnit: false }),
    ).toEqual({ raw_value: 0.8, value: 0.8 });
  });
});

describe('an empty / whitespace-only unit is NOT a unit (canonicaliseUnit)', () => {
  it('canonicalises the empty, whitespace-only and padded forms', () => {
    expect(canonicaliseUnit(undefined)).toBeUndefined();
    expect(canonicaliseUnit('')).toBeUndefined();
    expect(canonicaliseUnit('   ')).toBeUndefined();
    expect(canonicaliseUnit('\t\n')).toBeUndefined();
    expect(canonicaliseUnit(' £ ')).toBe('£');
    expect(canonicaliseUnit('%')).toBe('%');
  });

  it('a `unit: ""` proposal is treated as a BARE number, not a redeclaration', () => {
    // Chosen semantics: `''` is no unit at all, so there is nothing to
    // redeclare and nothing to refuse. The alternative (treat any defined unit
    // as a declaration) would refuse this and render "applying a value in  …".
    const r = evaluateFactorValueProposal({
      rawInput: 5,
      operator: 'set',
      unit: '',
      factorObservedValue: 0.7,
      factorObservedRawValue: 0.7,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });

  it('a whitespace-only unit is likewise not a redeclaration', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 5,
        operator: 'set',
        unit: '   ',
        factorObservedValue: 0.7,
        inputHasUnit: false,
      }).ok,
    ).toBe(true);
  });

  it('RETIRES THE MALFORMED COPY — a factor already storing `unit: ""` reads as unitless', () => {
    // Before: `bare_ratio_on_unit_factor` fired and rendered
    // "0.5 looks like a proportion, not a value in . Tell me the amount in ."
    const r = evaluateFactorValueProposal({
      rawInput: 0.5,
      operator: 'set',
      factorUnit: '',
      factorObservedValue: 0.7,
      factorObservedRawValue: 0.7,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });

  it('RESTORES GUARD 2c for a factor already storing `unit: ""`', () => {
    // Before: 2c was permanently inert (factorUnit === ''), so a real unit
    // landed as `unit_mismatch` instead — falsifying 2c's own claim.
    const r = evaluateFactorValueProposal({
      rawInput: 9,
      operator: 'set',
      unit: '£',
      factorUnit: '',
      factorObservedValue: 0.7,
      factorObservedRawValue: 0.7,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('unit_redeclares_scale');
  });

  it('NO refusal copy anywhere in this predicate can render an empty unit', () => {
    // Sweep the unit-interpolating rejection paths with a `''` on either side.
    const cases: Array<Parameters<typeof evaluateFactorValueProposal>[0]> = [
      { rawInput: 0.5, operator: 'set', factorUnit: '', factorObservedValue: 0.7, inputHasUnit: false },
      { rawInput: 250000, operator: 'set', unit: '', factorCap: 100, factorObservedValue: 0.4, inputHasUnit: false },
      { rawInput: 0.3, operator: 'set', unit: '   ', factorUnit: '  ', factorObservedValue: 0.7, inputHasUnit: false },
    ];
    for (const input of cases) {
      const r = evaluateFactorValueProposal(input);
      if (!r.ok) {
        expect(r.specific_issue).not.toMatch(/in \./);
        expect(r.specific_issue).not.toMatch(/ {2}/);
      }
    }
  });
});
