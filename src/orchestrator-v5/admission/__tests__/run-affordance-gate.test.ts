/**
 * The predicate's own spec. Every branch, plus the two polarity traps the
 * contract calls out by name.
 */
import { describe, expect, it } from 'vitest';
import { isRunAffordanceAdmitted } from '../run-affordance-gate.js';

describe('isRunAffordanceAdmitted', () => {
  it('⭐ ADMITS an admissible model that is not yet "ready" — the 20.77% case', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: true })).toBe(true);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_mapping', may_run: true })).toBe(true);
  });

  it('WITHHOLDS when neither term admits', () => {
    expect(isRunAffordanceAdmitted({ status: 'blocked', may_run: false })).toBe(false);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_mapping', may_run: false })).toBe(false);
  });

  it('ABSENCE means an older producer, never "no" — status alone still admits', () => {
    expect(isRunAffordanceAdmitted({ status: 'ready' })).toBe(true);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input' })).toBe(false);
  });

  /**
   * ⛔ PARITY WITH THE DEPLOYED UI, WHICH IS THE TERMINAL CONSUMER.
   * `admitsRunAffordance` on UI staging is
   * `analysisStatus === 'ready' || mayRun === true`. These two cells are where
   * a plausible alternative (`may_run !== false`) DIVERGES from it — one a
   * regression, one a chip the UI would silently drop. Both are empty across
   * 400 real models, so only a parity test catches them.
   */
  it('(ready, may_run:false) still admits — the UI renders it, so CEE must emit it', () => {
    expect(isRunAffordanceAdmitted({ status: 'ready', may_run: false })).toBe(true);
  });

  it('a malformed may_run does not widen the gate', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: 'yes' as unknown })).toBe(false);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: null as unknown })).toBe(false);
  });

  it('a missing payload is never an invitation', () => {
    expect(isRunAffordanceAdmitted(undefined)).toBe(false);
    expect(isRunAffordanceAdmitted(null)).toBe(false);
  });
});
