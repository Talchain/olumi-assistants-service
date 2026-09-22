/**
 * ⛔ The failure this pins is SILENT: treating a caller whose token failed
 * verification as anonymous is indistinguishable from a legitimate guest, and
 * it would let a failed authentication read an owned scenario.
 */

import { describe, it, expect } from 'vitest';
import { callerIdentityFrom } from '../caller-identity.js';

describe('callerIdentityFrom', () => {
  it('uses the VERIFIED user id', () => {
    expect(callerIdentityFrom({ mode: 'verified', userId: 'u-1' })).toEqual({ kind: 'caller', userId: 'u-1' });
  });

  it('REFUSES a presented-but-unverifiable token, never downgrades it to guest', () => {
    for (const reason of ['invalid_token', 'expired_token', 'verification_unavailable', 'missing_token'] as const) {
      const r = callerIdentityFrom({ mode: 'refused', reason });
      expect(r.kind, `mode=refused reason=${reason} must not become a guest`).toBe('refuse');
    }
  });

  it('keeps genuine guests working — the contrast control', () => {
    // If these refused too, guest use would break and the test above would be
    // proving nothing about the distinction that matters.
    expect(callerIdentityFrom({ mode: 'off' })).toEqual({ kind: 'caller', userId: null });
    expect(callerIdentityFrom({ mode: 'service_legacy' })).toEqual({ kind: 'caller', userId: null });
  });

  it('never invents a user id for an anonymous caller', () => {
    for (const m of [{ mode: 'off' } as const, { mode: 'service_legacy' } as const]) {
      const r = callerIdentityFrom(m);
      expect(r.kind === 'caller' && r.userId).toBe(null);
    }
  });
});
