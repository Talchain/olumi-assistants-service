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

  // Blocking #1 (review round 3, 2026-05-20) — unit mismatch must
  // reject BEFORE any cap/range check fires. The handler's old
  // behaviour was to silently overwrite the factor's stored unit
  // with the proposal's unit; the predicate now blocks that path
  // upstream so a percent factor cannot become a currency factor.
  describe('unit_mismatch', () => {
    it('rejects when proposal carries £ but factor is %', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 50,
        operator: 'set',
        unit: '£',
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('unit_mismatch');
    });

    it('rejects when proposal carries % but factor is £', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 5,
        operator: 'set',
        unit: '%',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('unit_mismatch');
    });

    it('accepts when proposal carries a unit and factor has no stored unit', () => {
      // No factorUnit recorded → the proposal's unit becomes the
      // factor's unit on first write. This is acceptable historical
      // behaviour; only mismatch between two defined units is unsafe.
      const r = evaluateFactorValueProposal({
        rawInput: 5,
        operator: 'set',
        unit: '%',
        factorCap: 100,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(true);
    });

    it('accepts when factor has a stored unit and proposal omits unit (bare number in range)', () => {
      // Caller is asking to reuse the existing unit. Not a mismatch.
      const r = evaluateFactorValueProposal({
        rawInput: 50,
        operator: 'set',
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
    });

    it('accepts when both units agree', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 50,
        operator: 'set',
        unit: '%',
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(true);
    });
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

  // Value/unit honesty guard — a bare (unit-less) number below 1 on a
  // factor that HAS a unit reads as a normalised proportion (0.3), not a
  // value in that unit. Refuse rather than persist + narrate the
  // misleading "£0.3" / "0.3 people".
  describe('bare_ratio_on_unit_factor', () => {
    it('rejects a bare sub-1 number on a currency factor', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('rejects a bare sub-1 number on a percentage factor', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'set',
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('rejects a bare sub-1 number on a count/person-like factor (uncapped)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'set',
        factorUnit: 'people',
        inputHasUnit: false,
        // no cap — a headcount-style factor
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('rejects a bare sub-1 delta (increase) on a capped currency factor', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'increase',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('rejects a bare sub-1 delta (decrease) on a capped currency factor', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'decrease',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('ACCEPTS a bare sub-1 MULTIPLY on a CAPPED factor (dimensionless scaling factor, not a unit value)', () => {
      // "multiply by 0.3" = scale to 30%. The RHS is a multiplier, never a
      // value in the factor's unit, so there is no proportion-vs-unit
      // ambiguity — the guard must not fire. effectiveRaw 40000*0.3=12000
      // stays in [0, cap] and is accepted.
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'multiply',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
    });

    it('ACCEPTS a bare sub-1 MULTIPLY on an UNCAPPED factor (multiply is excluded from the unitless-delta guard too)', () => {
      // 12 people * 0.3 = 3.6 — bounded by the existing finite value, so an
      // uncapped multiply must not be refused as delta_no_cap_and_no_unit.
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'multiply',
        factorUnit: 'people',
        factorExistingRaw: 12,
        inputHasUnit: false,
        // no cap
      });
      expect(r.ok).toBe(true);
    });

    it('rejects a MULTIPLY whose product OVERSHOOTS the cap (falls through to the cap-range guard, not bare_ratio)', () => {
      // 40000 * 5 = 200000 > cap 100000; bare multiplier → bare_number_outside_cap.
      const r = evaluateFactorValueProposal({
        rawInput: 5,
        operator: 'multiply',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
    });

    it('rejects a NEGATIVE MULTIPLY (product below 0, contained by the cap-range guard)', () => {
      // 40000 * -0.5 = -20000 < 0 → bare_number_outside_cap.
      const r = evaluateFactorValueProposal({
        rawInput: -0.5,
        operator: 'multiply',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
    });

    it('ACCEPTS bare rawInput exactly 1 on a unit-bearing factor (boundary — not sub-1)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 1,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
    });

    it('rejects bare rawInput just below 1 on a unit-bearing factor (boundary — locks the < 1 cutoff)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.999999,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('does NOT fire on the POST-operator computed value when suppressBareRatioGate is set (normalise path)', () => {
      // Mirrors how normaliseFactorValue invokes the predicate: operator
      // 'set' on a computed product that lands in (0,1), with the gate
      // suppressed. Must accept (the stated-value check ran upstream).
      const r = evaluateFactorValueProposal({
        rawInput: 0.4, // e.g. 4% * 0.1
        operator: 'set',
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: false,
        suppressBareRatioGate: true,
      });
      expect(r.ok).toBe(true);
    });

    it('rejects a negative bare sub-1 number on a unit-bearing factor (fires before the cap-range guard)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: -0.5,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
    });

    it('ACCEPTS bare 0 on a unit-bearing factor (zeroing is unambiguous)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
    });

    it('ACCEPTS a bare sub-1 number on a UNITLESS factor (no unit to misrender)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.7,
        operator: 'set',
        inputHasUnit: false,
        // no factorUnit, no cap — a ratio-in-[0,1] factor
      });
      expect(r.ok).toBe(true);
    });

    it('ACCEPTS an explicit sub-1 currency value (the unit asserts the scale)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'set',
        unit: '£',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(true);
    });

    it('ACCEPTS a normal bare currency value >= 1 (no false reject)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 50000,
        operator: 'set',
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
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
      // NOTE: `bare_ratio_on_unit_factor` is intentionally NOT in this list.
      // It judges the user's STATED value and is enforced upstream (validator
      // precheck + the handler's `preEvaluation`). `normaliseFactorValue`
      // runs on the POST-operator computed value and sets
      // `suppressBareRatioGate`, so it does NOT throw bare_ratio — that would
      // falsely reject honest products that land in (0,1). Full-handler
      // parity for bare_ratio is covered by validator-executor-parity.test.ts.
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
