/**
 * Unit coverage for the minimum-build gate. Mocks `execSync` so the test
 * does not depend on the local repo's git state. Verifies the four
 * branches: localhost bypass, exact-match short-circuit, git-confirmed
 * ancestry, git-rejected ancestry, and git-indeterminate fallback.
 */

import { describe, expect, it, vi } from 'vitest';

import { evaluateMinBuildGate, DEFAULT_MIN_BUILD_SHA } from '../../../tools/v5-journey-replay/min-build.js';

function mockExec(behaviour: 'success' | 'rejected' | 'enoent'): typeof import('node:child_process').execSync {
  return vi.fn((cmd: string) => {
    if (behaviour === 'success') return Buffer.from('');
    if (behaviour === 'rejected') {
      const err = new Error('not an ancestor') as Error & { status?: number };
      err.status = 1;
      throw err;
    }
    const err = new Error('git: command not found') as Error & { code?: string };
    err.code = 'ENOENT';
    throw err;
  }) as unknown as typeof import('node:child_process').execSync;
}

describe('evaluateMinBuildGate', () => {
  it('skips the gate on localhost', () => {
    const verdict = evaluateMinBuildGate('http://localhost:3000', 'abc1234');
    expect(verdict.halt).toBe(false);
    expect(verdict.note).toContain('localhost');
  });

  it('passes when healthz build matches min-build exactly', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      DEFAULT_MIN_BUILD_SHA,
    );
    expect(verdict.halt).toBe(false);
    expect(verdict.note).toContain('matches min-build');
  });

  it('passes when local git ancestry confirms min-build is an ancestor', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      'fffffff',
      'a555cf7',
      mockExec('success'),
    );
    expect(verdict.halt).toBe(false);
    expect(verdict.note).toContain('git ancestry confirmed');
  });

  it('halts when local git ancestry rejects min-build (deploy is older)', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      '0000000',
      'a555cf7',
      mockExec('rejected'),
    );
    expect(verdict.halt).toBe(true);
    expect(verdict.reason).toContain('older than required minimum');
  });

  it('halts when git is unavailable (ENOENT) and no override or matching --expected-build', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      'fffffff',
      'a555cf7',
      mockExec('enoent'),
    );
    expect(verdict.halt).toBe(true);
    expect(verdict.reason).toContain('git ancestry could not be verified');
  });

  it('passes on indeterminate git when --expected-build matches healthzBuild exactly', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      'fffffff',
      'a555cf7',
      mockExec('enoent'),
      'fffffff',
    );
    expect(verdict.halt).toBe(false);
    expect(verdict.note).toContain('--expected-build matches /healthz exactly');
  });

  it('still halts on indeterminate git when --expected-build mismatches healthzBuild', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      'fffffff',
      'a555cf7',
      mockExec('enoent'),
      'eeeeeee',
    );
    expect(verdict.halt).toBe(true);
  });

  it('halts when healthz returned no build field', () => {
    const verdict = evaluateMinBuildGate(
      'https://cee-staging.onrender.com',
      undefined,
    );
    expect(verdict.halt).toBe(true);
    expect(verdict.reason).toContain('no build field');
  });

  it('respects OLUMI_REPLAY_ALLOW_STALE_DEPLOY override on rejection', () => {
    const original = process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
    process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY = 'true';
    try {
      const verdict = evaluateMinBuildGate(
        'https://cee-staging.onrender.com',
        '0000000',
        'a555cf7',
        mockExec('rejected'),
      );
      expect(verdict.halt).toBe(false);
      expect(verdict.note).toContain('override active');
    } finally {
      if (original === undefined) {
        delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
      } else {
        process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY = original;
      }
    }
  });
});
