/**
 * ⭐ THE QUESTION THIS SPEC PINS: *"where did the ceiling we are enforcing come
 * from, and is that a rule the user may be refused against?"*
 *
 * It is NOT "is the value in range" — that is the pre-existing spec beside it.
 * The two are kept apart deliberately (CLAUDE.md trap 21): one predicate was
 * answering both, and the answers diverge.
 *
 * ── THE MEASURED HARM (founder session, 3 Sep 2026) ────────────────────────
 * `olumi-programme-docs` `artefacts/manual-test-2026-09-03/`, scenario
 * `7826c742-2939-4584-917c-f1286a663ae4`. The brief said *"£80-120k for the
 * first hire"*. The drafting path stored `raw_value: 80`, which set `cap: 100`.
 * When the founder supplied the true figure the product answered:
 *
 *   > "Value £100,000 exceeds the factor's cap of £100. I haven't changed
 *   >  anything."
 *
 * The same `observed_state` carried `uncertainty_drivers: ["Extracted from
 * brief — confirm value"]`. So the product asked to have the value confirmed
 * and, in the same breath, enforced a bound derived from it as a validation
 * rule — and refused the confirmation when it arrived.
 *
 * A scale defect that becomes a validation rule is a different severity from
 * one that merely displays wrong: it rejects the truth when the user supplies
 * it. That is the class this spec pins.
 *
 * ── OPPOSITE-DIRECTION PAIRS, ALWAYS TOGETHER ─────────────────────────────
 * Two harms live under the one `effectiveRaw < 0 || effectiveRaw > cap`
 * conjunct, and they cannot share a threshold (trap 22b):
 *
 *   · a bound too tight REJECTS TRUTH   — the founder's case;
 *   · a bound absent ADMITS NONSENSE    — a bare number, or a value below the
 *                                          zero every capped scale starts at.
 *
 * Every case below ships with its twin, so a fix in one direction cannot
 * silently re-open the other.
 */

import { describe, expect, it } from 'vitest';

import {
  capBoundOrigin,
  evaluateFactorValueProposal,
  evaluatePostOperatorFactorValue,
  suggestExtendedCap,
  type ProposalRejectionReason,
} from '../evaluate-factor-value-proposal.js';

/** The founder's factor, as the bundle recorded it before his correction. */
const FOUNDER_FACTOR = {
  factorCap: 100,
  factorUnit: '£',
  factorObservedValue: 0.8,
  factorObservedRawValue: 80,
} as const;

/** His correction: the true figure, with the scale stated. */
const FOUNDER_CORRECTION = {
  rawInput: 100_000,
  operator: 'set',
  unit: '£',
  inputHasUnit: true,
} as const;

describe('capBoundOrigin — where the enforced ceiling came from', () => {
  it('is undefined when no ceiling applies', () => {
    expect(capBoundOrigin({})).toBeUndefined();
  });

  it('is inherited_from_the_factor when the only ceiling is the stored one', () => {
    expect(capBoundOrigin({ factorCap: 100 })).toBe('inherited_from_the_factor');
  });

  it('is stated_on_this_proposal when the proposal carries a ceiling', () => {
    expect(capBoundOrigin({ proposalCap: 100 })).toBe('stated_on_this_proposal');
  });

  it('prefers the proposal ceiling over the stored one, matching the predicate', () => {
    // `cap = proposalCap ?? factorCap` in the predicate; the origin must be
    // computed over the SAME precedence or the two would disagree about which
    // number is being enforced.
    expect(capBoundOrigin({ proposalCap: 200, factorCap: 100 })).toBe(
      'stated_on_this_proposal',
    );
  });
});

describe('an inherited ceiling is not a rule the user is refused against', () => {
  it("carries unconfirmed_bound for the founder's own correction", () => {
    const r = evaluateFactorValueProposal({ ...FOUNDER_CORRECTION, ...FOUNDER_FACTOR });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unconfirmed_bound).toEqual({
      cap: 100,
      rescale_cap_to: suggestExtendedCap(100_000),
    });
  });

  it('TWIN — a ceiling stated on the proposal itself carries no unconfirmed_bound', () => {
    // The user (or the resumed rescale consent) supplied this ceiling in the
    // same act as the value. Judging the proposal against its own stated bound
    // is coherent; judging it against an inherited fact of unknown provenance
    // is the harm. Same overshoot, opposite verdict about the BOUND.
    const r = evaluateFactorValueProposal({
      ...FOUNDER_CORRECTION,
      ...FOUNDER_FACTOR,
      proposalCap: 100,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe<ProposalRejectionReason>('value_exceeds_cap');
    expect(r.unconfirmed_bound).toBeUndefined();
  });

  it('stops presenting the inherited ceiling as a rule the factor owns', () => {
    const r = evaluateFactorValueProposal({ ...FOUNDER_CORRECTION, ...FOUNDER_FACTOR });
    if (r.ok) throw new Error('expected a rejection');
    // The sentence the founder read. It asserts the bound as the factor's own
    // property and says nothing about where it came from.
    expect(r.specific_issue).not.toContain("the factor's cap");
    // What must be there instead: the user's figure, the bound, and the fact
    // that nothing confirms the bound.
    expect(r.specific_issue).toContain('£100,000');
    expect(r.specific_issue).toContain('£100');
    expect(r.specific_issue).toMatch(/confirm/i);
  });

  it('TWIN — the proposal-stated ceiling keeps its historic sentence byte-for-byte', () => {
    const r = evaluateFactorValueProposal({
      ...FOUNDER_CORRECTION,
      ...FOUNDER_FACTOR,
      proposalCap: 100,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.specific_issue).toBe("Value £100,000 exceeds the factor's cap of £100.");
  });

  it('offers a bound that actually admits the value it was computed for', () => {
    // Trap 13b — pin the remedy's OWN precondition. A `rescale_cap_to` that
    // does not admit the value would be a remedy the next turn refuses again,
    // and nothing else in the suite would notice.
    const r = evaluateFactorValueProposal({ ...FOUNDER_CORRECTION, ...FOUNDER_FACTOR });
    if (r.ok || r.unconfirmed_bound === undefined) throw new Error('expected an unconfirmed bound');
    const { rescale_cap_to } = r.unconfirmed_bound;
    expect(rescale_cap_to).toBeGreaterThanOrEqual(100_000);
    expect(
      evaluateFactorValueProposal({
        ...FOUNDER_CORRECTION,
        ...FOUNDER_FACTOR,
        proposalCap: rescale_cap_to,
      }).ok,
    ).toBe(true);
  });

  it('applies to a delta that overshoots an inherited ceiling too', () => {
    // The validator only computes a rescale suggestion for `operator: 'set'`,
    // so a delta overshoot is a dead end today. The BOUND is exactly as
    // unconfirmed either way, so the predicate must say so either way.
    const r = evaluateFactorValueProposal({
      rawInput: 50_000,
      operator: 'increase',
      unit: '£',
      inputHasUnit: true,
      factorExistingRaw: 80,
      ...FOUNDER_FACTOR,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.unconfirmed_bound?.cap).toBe(100);
    expect(r.unconfirmed_bound?.rescale_cap_to).toBe(suggestExtendedCap(50_080));
  });

  it('parity — the execute-time re-check reaches the same verdict about the bound', () => {
    // `evaluatePostOperatorFactorValue` is the backstop the handler runs. A
    // backstop that enforced a stronger rule than the gates in front of it
    // would refuse at execute what the validator had just accepted (the AC.1
    // parity invariant).
    const r = evaluatePostOperatorFactorValue({
      computedRaw: 100_000,
      unit: '£',
      inputHasUnit: true,
      factorCap: 100,
      factorUnit: '£',
      factorObservedValue: 0.8,
      factorObservedRawValue: 80,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.unconfirmed_bound).toEqual({
      cap: 100,
      rescale_cap_to: suggestExtendedCap(100_000),
    });
  });
});

describe('the guard is kept where the input asserts no scale of its own', () => {
  it('TWIN — a bare number over an inherited ceiling carries no unconfirmed_bound', () => {
    // Nothing in `100000` asserts a scale, so the ceiling is the only scale
    // evidence there is and widening on it would let a typo redefine what the
    // factor measures. This is the "a bound absent admits nonsense" direction,
    // and it must not move when the other direction is fixed.
    const r = evaluateFactorValueProposal({
      rawInput: 100_000,
      operator: 'set',
      inputHasUnit: false,
      ...FOUNDER_FACTOR,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.reason).toBe<ProposalRejectionReason>('bare_number_outside_cap');
    expect(r.unconfirmed_bound).toBeUndefined();
  });

  it('TWIN — a value below zero is refused whatever the ceiling is', () => {
    // The floor does not rest on the ceiling's NUMBER at all: a capped factor
    // is stored `value = raw / cap` on a scale that starts at zero, and a
    // negative has no representation on it. So this arm is untouched by the
    // ceiling's provenance.
    const r = evaluateFactorValueProposal({
      rawInput: 5_000,
      operator: 'decrease',
      unit: '£',
      inputHasUnit: true,
      factorExistingRaw: 80,
      ...FOUNDER_FACTOR,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.unconfirmed_bound).toBeUndefined();
  });

  it('a value below zero stops being described as exceeding an upper bound', () => {
    // Measured falsehood at staging f4c8f501: `-4920` produced "Value £-4,920
    // exceeds the factor's cap of £100." -4,920 does not exceed 100. One
    // conjunct was answering two questions and the copy inherited the wrong
    // one.
    const r = evaluateFactorValueProposal({
      rawInput: 5_000,
      operator: 'decrease',
      unit: '£',
      inputHasUnit: true,
      factorExistingRaw: 80,
      ...FOUNDER_FACTOR,
    });
    if (r.ok) throw new Error('expected a rejection');
    expect(r.specific_issue).not.toMatch(/exceeds/i);
    expect(r.specific_issue).toMatch(/below zero/i);
  });

  it('TWIN — an in-range value on an inherited ceiling is still accepted unchanged', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 90,
        operator: 'set',
        unit: '£',
        inputHasUnit: true,
        ...FOUNDER_FACTOR,
      }).ok,
    ).toBe(true);
  });
});
