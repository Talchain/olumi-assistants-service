/**
 * ⭐⭐ THE DEAD END: A DECLARATION IS NOT A **RE**DECLARATION WHEN NOTHING IS
 * DECLARED (P0, journey-witnessed on deployed staging, 2026-09-11).
 *
 * THE MEASURED LOOP. A capless, unitless factor is edited to a bare magnitude
 * (`250000`) through the inline editor the analysis' own remedy button opens.
 * `normaliseFactorValue` writes `{value: 250000, raw_value: 250000}`
 * (`normalise-factor-value.ts:289` — the deliberate raw fallback; a currency
 * pins no divisor and inventing one is the banned move). The next run then
 * refuses at `findScaleIncoherentBaselineFactorIds`
 * (`plot-intervention-scale.ts:813`) with `baseline_scale_unresolved`, whose
 * copy asks for the one thing that would fix it: *"recorded as a bare amount
 * with no range for me to measure it against"*.
 *
 * ⛔ AND EVERY ROUTE TO SUPPLYING THAT RANGE WAS SEALED — BY THE USER'S OWN
 * ACCEPTED EDIT. `cap_redeclares_scale` and `unit_redeclares_scale`
 * (`evaluate-factor-value-proposal.ts`, 2c / 2d) are both conjoined on
 * `factorHasRecordedValue`, which the bare edit had just made true. So the
 * product asked for a range, and then refused the range: *"This factor is
 * recorded without a unit…"* — the second refusal in the witness, verbatim.
 *
 * ⚠ WHAT THIS FILE DOES **NOT** DO. It does not loosen the run's readiness
 * check by one byte, and it does not widen 2c/2d in general. The two harms
 * those gates were written for are asserted here as UNCHANGED, in the same
 * file, because a fix that closes a gap and reopens a lie is this estate's
 * signature trade (CLAUDE.md trap 22b):
 *   · the two-turn launder — `{0.9, unit:'%'}` onto a factor recorded at 0.65;
 *   · the one-step cap dodge — `{1.5, cap:2}` onto a factor recorded at 0.7.
 * Both sit on a factor whose recorded scale is READABLE, so both still refuse.
 *
 * ⚠ TRAP 21 — THE TWO QUESTIONS, NAMED APART. `factorHasRecordedValue` answers
 * *"does this factor carry a value?"*. 2c/2d need *"would this declaration
 * overwrite a scale the factor already has?"*. For `{value: 250000,
 * raw_value: 250000}`, no cap, no unit, no frame, the answers differ: there IS
 * a value and there is NO scale. The new input names the second question and
 * leaves the first alone; absent, every gate behaves exactly as it does today,
 * which is what keeps `encode-option-interventions.ts` and the validator
 * unaffected BY CONSTRUCTION rather than by assumption.
 *
 * ⚠ THE AUTHORITY IS THE RUN GATE, NOT A SECOND PREDICATE WRITTEN HERE. The
 * caller derives the flag from `findScaleIncoherentBaselineFactorIds` itself
 * (see `set-factor-value-scale-declaration-clears-dead-end.test.ts`), so the
 * edit seam and the analysis seam cannot drift into disagreeing about which
 * factors are unusable — which is the defect class this whole PR exists to
 * close, one storey up.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateFactorValueProposal,
  evaluatePostOperatorFactorValue,
  type ProposalRejectionReason,
} from '../evaluate-factor-value-proposal.js';

/**
 * The witnessed factor, as the predicate sees it: a bare magnitude with no
 * cap, no unit and no frame — `value === raw_value`, so `recoverScaleFrame`
 * refuses it and the analysis seam names it.
 */
const WITNESSED_BARE_MAGNITUDE = {
  factorObservedValue: 250_000,
  factorObservedRawValue: 250_000,
} as const;

describe('a scale DECLARATION on a factor whose recorded scale is unusable', () => {
  it('⭐ ADMITS a cap — the range the run refusal asked for is no longer refused', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 250_000,
      operator: 'set',
      proposalCap: 500_000,
      ...WITNESSED_BARE_MAGNITUDE,
      factorRecordedScaleIsUnusable: true,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });

  it('⭐ ADMITS a unit on the same shape', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 250_000,
      operator: 'set',
      unit: '£',
      ...WITNESSED_BARE_MAGNITUDE,
      factorRecordedScaleIsUnusable: true,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(true);
  });

  it('⭐ the EXECUTE-TIME re-check admits it too (AC.1 parity — one rule set, both runs)', () => {
    const r = evaluatePostOperatorFactorValue({
      computedRaw: 250_000,
      proposalCap: 500_000,
      ...WITNESSED_BARE_MAGNITUDE,
      factorRecordedScaleIsUnusable: true,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe('the two harms 2c/2d were written for are UNCHANGED', () => {
  it('the two-turn launder still refuses: a unit onto a factor recorded at 0.65', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 0.9,
      operator: 'set',
      unit: '%',
      factorObservedValue: 0.65,
      factorRecordedScaleIsUnusable: false,
      inputHasUnit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('unit_redeclares_scale');
  });

  it('the one-step cap dodge still refuses: a cap onto a factor recorded at 0.7', () => {
    const r = evaluateFactorValueProposal({
      rawInput: 1.5,
      operator: 'set',
      proposalCap: 2,
      factorObservedValue: 0.7,
      factorRecordedScaleIsUnusable: false,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe<ProposalRejectionReason>('cap_redeclares_scale');
  });

  it('⭐ OMITTING the flag is identical to declaring the scale usable — the default is today', () => {
    // The discriminator for "additive, inert by default". Every caller that
    // does not thread the flag (the validator, `encode-option-interventions`)
    // keeps exactly today's behaviour, and this asserts that rather than
    // leaving it implied.
    const omitted = evaluateFactorValueProposal({
      rawInput: 1.5,
      operator: 'set',
      proposalCap: 2,
      factorObservedValue: 0.7,
      inputHasUnit: false,
    });
    expect(omitted.ok).toBe(false);
    if (!omitted.ok) expect(omitted.reason).toBe<ProposalRejectionReason>('cap_redeclares_scale');
  });

  it('⭐ the flag does NOT admit a declaration onto a factor with NO recorded value', () => {
    // Kept explicit because it is the inert half of the original gate: a
    // first-time declaration was always accepted, and must not start
    // depending on a flag that describes a state the factor does not have.
    const r = evaluateFactorValueProposal({
      rawInput: 250_000,
      operator: 'set',
      proposalCap: 500_000,
      inputHasUnit: false,
    });
    expect(r.ok).toBe(true);
  });
});
