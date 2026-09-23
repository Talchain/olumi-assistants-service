/**
 * The predicate's own spec. Every branch, plus the two polarity traps the
 * contract calls out by name.
 */
import { describe, expect, it } from 'vitest';
import { isRunAffordanceAdmitted } from '../run-affordance-gate.js';

describe('isRunAffordanceAdmitted', () => {
  it('⭐ ADMITS an admissible model that is not yet "ready" — the 27% case', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: true })).toBe(true);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_mapping', may_run: true })).toBe(true);
  });

  it('WITHHOLDS when the run path itself refuses, whatever the status says', () => {
    expect(isRunAffordanceAdmitted({ status: 'ready', may_run: false })).toBe(false);
    expect(isRunAffordanceAdmitted({ status: 'blocked', may_run: false })).toBe(false);
  });

  it('ABSENCE means an older producer, never "no" — falls back to status', () => {
    expect(isRunAffordanceAdmitted({ status: 'ready' })).toBe(true);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input' })).toBe(false);
  });

  /**
   * ⛔ THE CONTRACT NAMES `may_run !== false`, NOT `may_run === true`. The two
   * differ only on a malformed value, and the estate's polarity for this field
   * is to CARRY rather than withhold. Binding this pins the difference so a
   * "tidy-up" to `=== true` turns RED.
   */
  it('a malformed may_run carries rather than withholds', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: 'yes' as unknown })).toBe(true);
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: null as unknown })).toBe(true);
  });

  it('a missing payload is never an invitation', () => {
    expect(isRunAffordanceAdmitted(undefined)).toBe(false);
    expect(isRunAffordanceAdmitted(null)).toBe(false);
  });
});
