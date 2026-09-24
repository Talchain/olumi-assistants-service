/**
 * ⭐ ONE PLACE ANSWERS "MAY A RUN BE OFFERED?".
 *
 * ⛔ IT WAS SPELT THREE WAYS, and two disagreed with the client that decides
 * whether the user actually sees a control:
 *
 *   route   `admitsRunOffer`        typeof may_run === 'boolean' ? may_run : status === 'ready'
 *   compose `chip-generator` x3     status === 'ready'
 *   UI      `admitsRunAffordance`   status === 'ready' || may_run === true   <- DEPLOYED
 *
 * These cells are the divergences, not hypotheticals.
 */

import { describe, it, expect } from 'vitest';
import { analysisReadyAdmitsRun } from '../analysis-admission.js';

describe('analysisReadyAdmitsRun matches the deployed client rule', () => {
  it('⭐ (ready, false) ADMITS — the route withheld here while the UI rendered the Run', () => {
    expect(analysisReadyAdmitsRun({ status: 'ready', may_run: false })).toBe(true);
  });

  it('⭐ (needs_user_mapping, true) ADMITS — the compose chips withheld on status alone', () => {
    // Population-measured: 3,168 of 15,255 persisted models sit in this state,
    // able to run and never offered it.
    expect(analysisReadyAdmitsRun({ status: 'needs_user_mapping', may_run: true })).toBe(true);
  });

  it('⛔ (needs_user_input, false) WITHHOLDS — never offer a Run CEE would refuse', () => {
    expect(analysisReadyAdmitsRun({ status: 'needs_user_input', may_run: false })).toBe(false);
  });

  it('⭐ ABSENCE falls back to status, never to a refusal', () => {
    // `may_run: undefined` means a producer older than the admission. Collapsing it
    // to false would withhold the Run from every payload minted before the field.
    expect(analysisReadyAdmitsRun({ status: 'ready' })).toBe(true);
    expect(analysisReadyAdmitsRun({ status: 'needs_user_input' })).toBe(false);
  });

  it('⛔ a missing or malformed payload is never an invitation', () => {
    expect(analysisReadyAdmitsRun(undefined)).toBe(false);
    expect(analysisReadyAdmitsRun(null)).toBe(false);
    expect(analysisReadyAdmitsRun('ready')).toBe(false);
    expect(analysisReadyAdmitsRun({ may_run: 'yes' })).toBe(false);
  });
});
