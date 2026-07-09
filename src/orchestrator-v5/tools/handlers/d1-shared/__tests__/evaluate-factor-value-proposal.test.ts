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
  evaluatePostOperatorFactorValue,
  applyFactorValueOperator,
  resolveExistingRawValue,
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

    it('rejects a bare MULTIPLY on an UNCAPPED factor (no cap to bound it → delta_no_cap_and_no_unit)', () => {
      // An uncapped multiply has no cap-range guard to contain it, so a bare
      // multiplier (× -0.5 → -6, or × 1e9) could write a nonsensical /
      // unbounded value. It is rejected at gate 3b like any uncapped bare
      // delta. (Capped multiply is exempted at gate 3c, where the cap-range
      // guard contains the product.)
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'multiply',
        factorUnit: 'people',
        factorExistingRaw: 12,
        inputHasUnit: false,
        // no cap
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('delta_no_cap_and_no_unit');
    });

    it('rejects a NEGATIVE bare MULTIPLY on an UNCAPPED factor (no -6 people)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: -0.5,
        operator: 'multiply',
        factorUnit: 'people',
        factorExistingRaw: 12,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('delta_no_cap_and_no_unit');
    });

    it('ACCEPTS an explicit MATCHING-unit MULTIPLY (RHS unit not dimensionally validated, treated as scalar)', () => {
      // `£40,000 × £0.3` — the £ on the multiplier is incoherent but is
      // ignored; the math is ×0.3 → £12,000 (honest). Documented behaviour.
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'multiply',
        unit: '£',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(true);
    });

    it('rejects an explicit MISMATCHED-unit MULTIPLY (unit_mismatch still applies)', () => {
      const r = evaluateFactorValueProposal({
        rawInput: 0.3,
        operator: 'multiply',
        unit: '%',
        factorUnit: '£',
        factorCap: 100000,
        factorExistingRaw: 40000,
        inputHasUnit: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('unit_mismatch');
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

    it('evaluatePostOperatorFactorValue does NOT fire bare_ratio on a computed product in (0,1)', () => {
      // Mirrors normaliseFactorValue: a computed product 0.4 (e.g. 4% × 0.1)
      // must be accepted — the bare-ratio gate judges the stated RHS, which
      // ran upstream. The dedicated API encapsulates the suppression.
      const r = evaluatePostOperatorFactorValue({
        computedRaw: 0.4,
        factorUnit: '%',
        factorCap: 100,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(true);
    });

    it('evaluatePostOperatorFactorValue STILL enforces the cap-range guard on the computed value', () => {
      // Suppressing bare_ratio must not suppress cap containment.
      const r = evaluatePostOperatorFactorValue({
        computedRaw: 200000, // > cap 100000
        factorUnit: '£',
        factorCap: 100000,
        inputHasUnit: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
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

    // Tier A #1 (edit-reliability, 2026-07-09) — FIX 3 (1.45-F6): "set X to
    // 0.8" was refused as an ambiguous bare ratio even when the factor's OWN
    // native scale IS [0,1] (factorCap === 1) — e.g. a churn-rate-style
    // factor stored as a 0-1 proportion but ALSO carrying a unit string
    // (e.g. '%'). There the "0.8 looks like a proportion" warning is false:
    // 0.8 IS a value in that scale, not an ambiguous overlay. This is the
    // ONE unambiguous case — a cap of exactly 1 means the factor's range
    // literally IS [0,1], so no other interpretation is possible. The doctrine-
    // open case (a %-unit factor on a 0-100 scale, e.g. factorCap: 100, where
    // "0.8" could mean 0.8% or a typo for 80%) is DELIBERATELY left alone —
    // see the pinned cap:100 tests above ("rejects a bare sub-1 number on a
    // percentage factor" etc.), which must keep failing after this fix.
    describe('cap===1 proportion-scaled factor exemption (FIX 3)', () => {
      it('ACCEPTS a bare sub-1 SET on a %-unit factor whose cap is exactly 1 (factor IS proportion-scaled)', () => {
        const r = evaluateFactorValueProposal({
          rawInput: 0.8,
          operator: 'set',
          factorUnit: '%',
          factorCap: 1,
          inputHasUnit: false,
        });
        expect(r.ok).toBe(true);
      });

      it('ACCEPTS a bare sub-1 INCREASE on a cap-1 factor (same clear case, delta operator)', () => {
        const r = evaluateFactorValueProposal({
          rawInput: 0.1,
          operator: 'increase',
          factorUnit: '%',
          factorCap: 1,
          factorExistingRaw: 0.5,
          inputHasUnit: false,
        });
        expect(r.ok).toBe(true);
      });

      it('does NOT bypass the cap-range guard — an out-of-range value on a cap-1 factor is still rejected', () => {
        const r = evaluateFactorValueProposal({
          rawInput: 1.5,
          operator: 'set',
          factorUnit: '%',
          factorCap: 1,
          inputHasUnit: false,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
      });

      it('DOCTRINE BOUNDARY (unchanged): a %-unit factor on a 0-100 scale (cap: 100) STILL refuses a bare sub-1 value — the pp-vs-relative ambiguity is NOT settled by this fix', () => {
        const r = evaluateFactorValueProposal({
          rawInput: 0.8,
          operator: 'set',
          factorUnit: '%',
          factorCap: 100,
          inputHasUnit: false,
        });
        expect(r.ok).toBe(false);
        if (!r.ok)
          expect(r.reason).toBe<ProposalRejectionReason>('bare_ratio_on_unit_factor');
      });

      it('ACCEPTS a bare sub-1 value on a cap-1 currency-labelled factor too (cap is the signal, not the unit string)', () => {
        // Deliberately an odd unit/cap combination to prove the gate keys
        // off `cap === 1`, not the unit string — the exemption is scale-
        // based, not unit-based.
        const r = evaluateFactorValueProposal({
          rawInput: 0.25,
          operator: 'set',
          factorUnit: '£',
          factorCap: 1,
          inputHasUnit: false,
        });
        expect(r.ok).toBe(true);
      });
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

  // De-normalisation of the delta LHS — the inverse of normaliseFactorValue.
  // Guards the legacy-factor corruption fix (capped factor with only `value`).
  describe('resolveExistingRawValue', () => {
    it('uses raw_value directly when present', () => {
      expect(
        resolveExistingRawValue({ raw_value: 40000, value: 0.4, cap: 100000 }),
      ).toEqual({ kind: 'resolved', raw: 40000 });
    });
    it('de-normalises value * cap on a capped factor without raw_value (the legacy bug fix)', () => {
      expect(resolveExistingRawValue({ value: 0.4, cap: 100000, unit: '£' })).toEqual({
        kind: 'resolved',
        raw: 40000,
      });
    });
    it('uses value directly on an uncapped factor without raw_value (value === raw)', () => {
      expect(resolveExistingRawValue({ value: 12 })).toEqual({ kind: 'resolved', raw: 12 });
    });
    it('treats a stored value > 1 on a capped factor as already-raw (off-contract graph, no double-scaling)', () => {
      // {value:200000, cap:500000} is off-contract (normalised value is always
      // ≤1); value*cap would be 1e11 — use the already-raw 200000 instead.
      expect(resolveExistingRawValue({ value: 200000, cap: 500000, unit: '£' })).toEqual({
        kind: 'resolved',
        raw: 200000,
      });
    });
    it('treats a stored value < 0 as already-raw too (symmetric off-contract handling)', () => {
      expect(resolveExistingRawValue({ value: -0.5, cap: 100000, unit: '£' })).toEqual({
        kind: 'resolved',
        raw: -0.5,
      });
    });
    // Percentage scale: normaliseFactorValue stores value = raw/cap for EVERY
    // capped factor, so the % divisor is only unambiguous when cap === 100.
    it('reconstructs a percentage factor only when cap === 100 (value*100 === value*cap)', () => {
      expect(resolveExistingRawValue({ value: 0.05, unit: '%', cap: 100 })).toEqual({
        kind: 'resolved',
        raw: 5,
      });
    });
    it('reconstructs an UNCAPPED in-[0,1] percentage as value*100 (brief-extractor convention; handler-produced always has raw_value)', () => {
      // {value:0.04, %} with no raw_value/cap is the canonical extracted shape
      // for "4%" — unambiguously raw 4 (handler-produced % always carries
      // raw_value and short-circuits, so this branch is extractor-only).
      expect(resolveExistingRawValue({ value: 0.04, unit: '%' })).toEqual({
        kind: 'resolved',
        raw: 4,
      });
    });
    it('is AMBIGUOUS for a % value OUTSIDE [0,1] (5 → 500%? or legacy raw 5%? — no reliable scale provenance)', () => {
      // The display fallback treats {value:5,'%'} as "5%", the extractor
      // convention as 500% — genuinely ambiguous, so fail closed.
      expect(resolveExistingRawValue({ value: 5, unit: '%' })).toEqual({ kind: 'ambiguous' });
    });
    it('is AMBIGUOUS for a CAPPED percentage factor with cap !== 100 (display /100 vs normalise /cap)', () => {
      // {value:0.1, %, cap:50} = raw 5 under normalise (raw/cap), but 10 under
      // the /100 display convention — ambiguous, so do not guess.
      expect(resolveExistingRawValue({ value: 0.1, unit: '%', cap: 50 })).toEqual({
        kind: 'ambiguous',
      });
    });
    it('is MISSING when there is no value at all (delta guards then fail closed)', () => {
      expect(resolveExistingRawValue({})).toEqual({ kind: 'missing' });
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
