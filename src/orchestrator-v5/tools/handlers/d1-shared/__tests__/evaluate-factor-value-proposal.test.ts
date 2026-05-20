/**
 * Unit tests for `evaluateFactorValueProposal` — the shared predicate
 * that the validator, the deterministic-synthesis precheck, and the
 * handler's `normaliseFactorValue` all delegate to.
 *
 * These tests pin the AC.1 / AC.3 invariants from the V5
 * set_factor_value validator/executor parity workstream:
 *
 *   AC.1 — anything `normaliseFactorValue` would reject MUST also be
 *          rejected by this predicate, with a matching granular reason.
 *   AC.3 — delta operators MUST surface `delta_no_existing_value`
 *          BEFORE `applyFactorValueOperator` runs. Silently defaulting
 *          a missing existing raw to 0 is the regression class.
 */

import { describe, expect, it } from 'vitest';

import {
  evaluateFactorValueProposal,
  applyFactorValueOperator,
  type ProposalRejectionReason,
} from '../evaluate-factor-value-proposal.js';
import { normaliseFactorValue } from '../normalise-factor-value.js';
import { D1HandlerError } from '../errors.js';

describe('evaluateFactorValueProposal — predicate semantics', () => {
  it('returns ok for absolute in-range value with explicit unit', () => {
    const result = evaluateFactorValueProposal({
      rawInput: 50,
      operator: 'set',
      unit: '%',
      factorCap: 100,
      inputHasUnit: true,
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok for absolute boundary values (0 and cap)', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 0,
        operator: 'set',
        unit: '%',
        factorCap: 100,
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
    expect(
      evaluateFactorValueProposal({
        rawInput: 100,
        operator: 'set',
        unit: '%',
        factorCap: 100,
        inputHasUnit: true,
      }).ok,
    ).toBe(true);
  });

  it('returns non_finite for NaN rawInput', () => {
    const r = evaluateFactorValueProposal({
      rawInput: Number.NaN,
      operator: 'set',
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('non_finite');
  });

  it('returns cap_non_positive when cap is 0', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 5,
      operator: 'set',
      factorCap: 0,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('cap_non_positive');
  });

  it('returns bare_number_outside_cap for unitless overshoot on a capped factor', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 500,
      operator: 'set',
      factorCap: 100,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
  });

  it('returns value_exceeds_cap for unit-bearing overshoot on a capped factor', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 500000,
      operator: 'set',
      unit: '£',
      factorCap: 100000,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_exceeds_cap');
  });

  // AC.3 — DELTA GUARD ORDERING
  // The predicate MUST return `delta_no_existing_value` before
  // `applyFactorValueOperator` runs. We assert this by feeding inputs
  // where calling `applyFactorValueOperator(0, 'increase', X)` would
  // produce a value the predicate would otherwise ACCEPT — so any
  // accept-with-zero-default behaviour would surface as ok:true.
  describe('AC.3 — delta guard precedes applyOperator', () => {
    it('returns delta_no_existing_value when factorExistingRaw is undefined (operator increase)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 30,
        operator: 'increase',
        unit: '%',
        factorCap: 100,
        inputHasUnit: true,
        // factorExistingRaw deliberately omitted
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('delta_no_existing_value');
    });

    it('returns delta_no_existing_value when factorExistingRaw is NaN', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 1000,
        operator: 'decrease',
        unit: '£',
        factorCap: 100000,
        inputHasUnit: true,
        factorExistingRaw: Number.NaN,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('delta_no_existing_value');
    });

    it('returns delta_no_existing_value when factorExistingRaw is +Infinity', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 5,
        operator: 'multiply',
        factorCap: 100,
        inputHasUnit: false,
        factorExistingRaw: Number.POSITIVE_INFINITY,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('delta_no_existing_value');
    });

    it('accepts a delta when factorExistingRaw is finite and post-operator value lands in range', () => {
      // existing 40000, +3000 → 43000 ≤ cap 100000 ⇒ ok
      const r = evaluateFactorValueProposal({
        rawInput: 3000,
        operator: 'increase',
        unit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(true);
    });

    it('rejects a delta whose post-operator value exceeds the cap', () => {
      // existing 99000, +3000 → 102000 > cap 100000 ⇒ value_exceeds_cap
      const r = evaluateFactorValueProposal({
        rawInput: 3000,
        operator: 'increase',
        unit: '£',
        factorCap: 100000,
        factorExistingRaw: 99000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_exceeds_cap');
    });

    it('returns delta_no_cap_and_no_unit for unitless delta on an uncapped factor', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 10,
        operator: 'increase',
        factorExistingRaw: 5,
        inputHasUnit: false,
        // no cap, no unit
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('delta_no_cap_and_no_unit');
    });
  });

  // AC.1 — PARITY WITH normaliseFactorValue (handler-side guard)
  // For every input that the predicate rejects with a cap/range/non-finite
  // reason, `normaliseFactorValue` must also throw a D1HandlerError. (The
  // handler runs the predicate internally so this is true by construction;
  // we pin it as a regression guard.)
  describe('AC.1 — handler parity', () => {
    const parityCases: ReadonlyArray<{
      label: string;
      input: Parameters<typeof evaluateFactorValueProposal>[0];
    }> = [
      {
        label: 'unit-bearing overshoot (currency)',
        input: {
          rawInput: 500000,
          operator: 'set',
          unit: '£',
          factorCap: 100000,
          inputHasUnit: true,
        },
      },
      {
        label: 'unit-bearing overshoot (percent)',
        input: {
          rawInput: 150,
          operator: 'set',
          unit: '%',
          factorCap: 100,
          inputHasUnit: true,
        },
      },
      {
        label: 'unitless overshoot',
        input: {
          rawInput: 500,
          operator: 'set',
          factorCap: 100,
          inputHasUnit: false,
        },
      },
      {
        label: 'non-finite input',
        input: {
          rawInput: Number.POSITIVE_INFINITY,
          operator: 'set',
          factorCap: 100,
          inputHasUnit: false,
        },
      },
    ];

    for (const { label, input } of parityCases) {
      it(`predicate rejection → normaliseFactorValue throws (${label})`, () => {
        const evaluation = evaluateFactorValueProposal(input);
        expect(evaluation.ok).toBe(false);
        expect(() =>
          normaliseFactorValue({
            rawInput: input.rawInput,
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.proposalCap !== undefined
              ? { proposalCap: input.proposalCap }
              : {}),
            ...(input.factorCap !== undefined ? { factorCap: input.factorCap } : {}),
            ...(input.factorUnit !== undefined ? { factorUnit: input.factorUnit } : {}),
            inputHasUnit: input.inputHasUnit,
          }),
        ).toThrow(D1HandlerError);
      });
    }

    it('predicate accept → normaliseFactorValue produces a normalised result', () => {
      const out = normaliseFactorValue({
        rawInput: 50,
        unit: '%',
        factorCap: 100,
        inputHasUnit: true,
      });
      expect(out).toEqual({ raw_value: 50, value: 0.5 });
    });
  });
});

describe('applyFactorValueOperator — pure helper', () => {
  it('set returns rhs', () => {
    expect(applyFactorValueOperator(10, 'set', 99)).toBe(99);
  });
  it('increase adds rhs to current', () => {
    expect(applyFactorValueOperator(10, 'increase', 5)).toBe(15);
  });
  it('decrease subtracts rhs from current', () => {
    expect(applyFactorValueOperator(10, 'decrease', 3)).toBe(7);
  });
  it('multiply multiplies current by rhs', () => {
    expect(applyFactorValueOperator(10, 'multiply', 4)).toBe(40);
  });
  it('undefined operator behaves as set', () => {
    expect(applyFactorValueOperator(10, undefined, 7)).toBe(7);
  });
});
