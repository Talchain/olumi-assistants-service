/**
 * A FACTOR WHOSE UNIT *IS* A PROPORTION MUST ACCEPT A PROPORTION.
 *
 * ── THE DEFECT, WITNESSED ON DEPLOYED STAGING (build c12a54d, 22 Sep 2026) ──
 * Live factor "Product-Market Fit Investment": `unit: 'scale'`, `value: 0.3`,
 * NO `raw_value`, NO cap. Every way of setting it to 0.8 was refused:
 *
 *   "set ... to 80%"        -> "This factor uses scale; the value provided is in %"
 *   "set ... to 0.8"        -> "That looks like a proportion rather than a value in scale"
 *   "set ... to 0.8 scale"  -> same
 *
 * The guard rejected 0.8 as "a proportion" on a factor whose OWN PERSISTED VALUE
 * IS 0.3. The factor could not be set to any sub-1 value at all — and sub-1 is
 * the only range it has.
 *
 * ── FIRST WRONG BOUNDARY, ESTABLISHED BY EXECUTING THE GATE ────────────────
 * `isProportionScaledFactor` recognised a proportion factor ONLY by
 * `factorCap === 1`. Measured directly against the gate:
 *
 *   unit 'scale', no cap            -> REFUSED  bare_ratio_on_unit_factor
 *   unit 'scale', factorCap 1       -> ACCEPTED        <- the escape works
 *   unit 'unit_interval', no cap    -> REFUSED
 *   months + raw_value (CONTROL)    -> REFUSED         <- correctly ambiguous
 *   'scale', input 8 (CONTROL)      -> ACCEPTED
 *
 * So the escape hatch exists and the live factors simply carry no cap. The unit
 * declares the scale exactly as a cap does — `'scale'` is not an amount unit,
 * and a sub-1 input on it is not ambiguous, it is the only kind of value it takes.
 *
 * ── REACH, MEASURED ON LIVE DATA (30 days) ────────────────────────────────
 * `scale` 1,688 · `unit_interval` 15 · `ratio` 6 · `proportion` 3 — about 1,712
 * factors, the second-largest unit class after `£`.
 *
 * ⚠ THE VOCABULARY IS CLOSED AND EVIDENCE-BACKED, not a predicate. An open rule
 *   ("does it look proportional?") would silently reclassify amount units. These
 *   four tokens are the proportion-class units actually present in live data.
 */
import { describe, it, expect } from 'vitest';

import { evaluateFactorValueProposal } from '../evaluate-factor-value-proposal.js';

/** The live shape, minus the unit under test. */
const live = (factorUnit: string | undefined, rawInput = 0.8) => ({
  rawInput,
  operator: 'set' as const,
  factorUnit,
  factorExistingRaw: 0.3,
  factorObservedValue: 0.3,
  inputHasUnit: false,
});

describe('a proportion-unit factor accepts a proportion', () => {
  it('RED: unit `scale` with no cap accepts 0.8 — the witnessed live shape', () => {
    const v = evaluateFactorValueProposal(live('scale') as never);
    expect(v.ok, 'the factor\'s own value is 0.3; 0.8 is the same kind of number').toBe(true);
  });

  it('RED: `unit_interval` behaves the same', () => {
    expect(evaluateFactorValueProposal(live('unit_interval') as never).ok).toBe(true);
  });

  it('RED: `ratio` and `proportion` behave the same', () => {
    expect(evaluateFactorValueProposal(live('ratio') as never).ok).toBe(true);
    expect(evaluateFactorValueProposal(live('proportion') as never).ok).toBe(true);
  });

  /**
   * ⛔ THE TWO CONTROLS MY FIRST VERSION DID NOT HAVE, AND THE DEFECT THEY CATCH.
   *
   * Independent review refuted the first attempt (`cap === 1 || isProportionUnit`)
   * by executing it on a REAL staging capture: `fac_crm_capability`, `unit:
   * 'scale'`, **`cap: 100`**, `raw_value: 35`. A user typing `0.8` meaning 80 was
   * ACCEPTED and would have persisted `newRaw = 0.8` — 0.35 -> 0.008, a silent
   * ~100x corruption of the user's model.
   *
   * Every control in the first version used an AMOUNT unit or `cap: 1`, so the
   * "too wide" mutant was killed only by `months`/`£` — blind in the one
   * direction that mattered. These two pin the SCALE-DECLARATION boundary, not
   * just the unit-class one.
   */
  it('CONTROL — a `scale` factor WITH a cap is an amount scale and still refuses', () => {
    const v = evaluateFactorValueProposal({
      ...live('scale'), factorCap: 100, factorExistingRaw: 35, factorObservedValue: 0.35,
      factorObservedRawValue: 35,
    } as never);
    expect(v.ok, 'cap 100 says 0.8 probably means 80 — persisting 0.8 would be a ~100x error').toBe(false);
    if (!v.ok) expect(v.reason).toBe('bare_ratio_on_unit_factor');
  });

  it('CONTROL — a `scale` factor with a RECOVERABLE FRAME still refuses', () => {
    const v = evaluateFactorValueProposal({
      ...live('scale'), factorExistingRaw: 35, factorObservedValue: 0.35, factorObservedRawValue: 35,
    } as never);
    expect(v.ok, 'a value/raw_value pair proves an amount scale and outranks the unit token').toBe(false);
  });

  it('CONTROL — an AMOUNT unit with a frame still refuses a bare sub-1 input', () => {
    const v = evaluateFactorValueProposal({
      ...live('months'), factorExistingRaw: 9, factorObservedValue: 0.45, factorObservedRawValue: 9,
    } as never);
    expect(v.ok, '0.8 months is genuinely ambiguous and must still be asked about').toBe(false);
    if (!v.ok) expect(v.reason).toBe('bare_ratio_on_unit_factor');
  });

  it('CONTROL — a currency amount still refuses a bare sub-1 input', () => {
    const v = evaluateFactorValueProposal({ ...live('£'), factorExistingRaw: 25000 } as never);
    expect(v.ok).toBe(false);
  });

  it('CONTROL — an above-1 input on a proportion unit was always fine and still is', () => {
    expect(evaluateFactorValueProposal(live('scale', 8) as never).ok).toBe(true);
  });

  it('CONTROL — the existing factorCap===1 escape is unchanged', () => {
    expect(evaluateFactorValueProposal({ ...live('scale'), factorCap: 1 } as never).ok).toBe(true);
  });
});
