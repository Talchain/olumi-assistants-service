/**
 * ROADMAP 2.159 — the normalised-range guard inside the shared predicate.
 *
 * The predicate is called from FOUR production sites (validator precheck,
 * TurnExecutor synthesis precheck, handler `preEvaluation`, and — via
 * `evaluatePostOperatorFactorValue` — `normaliseFactorValue` at execute time).
 * The AC.1 parity invariant is that they all run the SAME rules, so the guard
 * is pinned here once, at the predicate, plus at the route end-to-end in
 * `tests/integration/orchestrator/route-v2-factor-value-edit-normalised-bounds.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateFactorValueProposal,
  evaluatePostOperatorFactorValue,
  type ProposalRejectionReason,
} from '../evaluate-factor-value-proposal.js';
import { normaliseFactorValue } from '../normalise-factor-value.js';

describe('evaluateFactorValueProposal — normalised-range guard', () => {
  it('REFUSES 1.5 on an uncapped normalised factor (the live Codex P1 event)', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 1.5,
      operator: 'set',
      factorObservedValue: 0.65,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe<ProposalRejectionReason>('value_outside_normalised_range');
      // Prediction-free: the bound and the received value, nothing else.
      expect(r.specific_issue).toBe('This factor is on a 0 to 1 scale, and the value given was 1.5.');
    }
  });

  it('REFUSES a negative value — the bound is two-sided', () => {
    const r = evaluateFactorValueProposal({
      rawInput: -0.2,
      operator: 'set',
      factorObservedValue: 0.65,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_outside_normalised_range');
  });

  it('ACCEPTS an in-range value, and the 0 / 1 boundaries exactly', () => {
    for (const rawInput of [0, 0.5, 0.8, 1]) {
      expect(
        evaluateFactorValueProposal({
          rawInput,
          operator: 'set',
          factorObservedValue: 0.65,
          inputHasUnit: false,
        }).ok,
      ).toBe(true);
    }
  });

  it('REFUSES a DELTA that overshoots 1 (guard 7 runs on the post-operator value)', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 0.6,
      operator: 'increase',
      factorExistingRaw: 0.65,
      factorObservedValue: 0.65,
      // An uncapped delta needs a unit or a cap (guard 3b), so state one; the
      // factor is unitless, and `unit_mismatch` (2b) only fires when BOTH sides
      // carry a unit. This isolates guard 7 on the 1.25 product — and doubles
      // as the proof that the derivation reads the FACTOR's unit, not the
      // proposal's (were it the proposal's, this would classify `unbounded`
      // and pass).
      unit: 'x',
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_outside_normalised_range');
  });

  it('A PROPOSAL UNIT CANNOT BYPASS THE BOUND on a unitless normalised factor', () => {
    // "Set the 0-1 adoption factor to 30%" — today this silently persisted
    // value 30 / unit '%' / no cap, i.e. the same defect wearing a unit.
    const r = evaluateFactorValueProposal({
      rawInput: 30,
      operator: 'set',
      unit: '%',
      factorObservedValue: 0.65,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_outside_normalised_range');
  });
});

describe('evaluateFactorValueProposal — the guard stays OFF where the scale is not declared', () => {
  it('is inert on a CAPPED factor (the existing cap-range guard owns it)', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 50000,
      operator: 'set',
      factorCap: 100000,
      factorUnit: '£',
      factorObservedValue: 0.4,
      factorObservedRawValue: 40000,
      unit: '£',
      inputHasUnit: true,
    });
    expect(r.ok).toBe(true);
  });

  it('is inert on a %-unit factor — NRR-style ratios legitimately exceed 1', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 110,
      operator: 'set',
      factorUnit: '%',
      factorObservedValue: 1.05,
      factorObservedRawValue: 105,
      unit: '%',
      inputHasUnit: true,
    });
    expect(r.ok).toBe(true);
  });

  it('is inert on a small-count factor already outside [0,1]', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 7,
      operator: 'set',
      factorObservedValue: 3,
      factorObservedRawValue: 3,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });

  it('is inert when the caller supplies NO stored value (older mocks / no observed_state)', () => {
    // Absence must never tighten a guard — this is the compatibility contract
    // for every GraphLookup adapter that does not implement
    // `findFactorObservedState`.
    const r = evaluateFactorValueProposal({ rawInput: 1.5, operator: 'set', inputHasUnit: false });
    expect(r.ok).toBe(true);
  });

  it('is inert when a PROPOSAL cap is supplied (an explicit, consented scale)', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 1.5,
      operator: 'set',
      proposalCap: 2,
      factorObservedValue: 0.65,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe('normaliseFactorValue — the execute-time backstop enforces the same bound', () => {
  it('THROWS PARAMETER_INVALID for 1.5 on a normalised factor', () => {
    expect(() =>
      normaliseFactorValue({ rawInput: 1.5, factorObservedValue: 0.65, inputHasUnit: false }),
    ).toThrow(/0 to 1 scale/);
  });

  it('still writes raw === model for an in-range uncapped value (no cap invented)', () => {
    expect(
      normaliseFactorValue({ rawInput: 0.8, factorObservedValue: 0.65, inputHasUnit: false }),
    ).toEqual({ raw_value: 0.8, value: 0.8 });
  });

  it('evaluatePostOperatorFactorValue forwards the scale fields (not silently dropped)', () => {
    const r = evaluatePostOperatorFactorValue({
      computedRaw: 1.5,
      factorObservedValue: 0.65,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('value_outside_normalised_range');
  });
});
