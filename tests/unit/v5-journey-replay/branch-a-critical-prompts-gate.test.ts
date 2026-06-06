/**
 * V5 replay harness — `/healthz.critical_prompts_pms` deploy-gate assertion.
 *
 * Pins the preflight assertion added for the Branch A enforcement pass:
 * the deploy gate halts when the deployed `critical_prompts_pms` is present
 * and differs from the configurable expected value (default false). Absent
 * field (older deploy / localhost) is tolerated; localhost skips the gate;
 * the stale-deploy override bypasses the halt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { evaluateDeployGate } from '../../../tools/v5-journey-replay/index.js';
import type { HealthzResult } from '../../../tools/v5-journey-replay/types.js';

const REMOTE = 'https://cee-staging.onrender.com';

function healthz(over: Record<string, unknown> = {}): HealthzResult {
  return {
    status: 200,
    body: { ok: true, build: 'b8d5bcc', version: '1.12.0', degraded: false, ...over },
    elapsed_ms: 5,
  };
}

describe('evaluateDeployGate — critical_prompts_pms assertion', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when deployed value equals the expected default (false)', () => {
    expect(evaluateDeployGate(REMOTE, healthz({ critical_prompts_pms: false }), undefined, false).halt).toBe(
      false,
    );
  });

  it('halts when deployed value differs from expected false', () => {
    const v = evaluateDeployGate(REMOTE, healthz({ critical_prompts_pms: true }), undefined, false);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/critical_prompts_pms=true/);
    expect(v.reason).toMatch(/expected value is false/);
  });

  it('passes when expected is overridden to true and deployed matches', () => {
    expect(evaluateDeployGate(REMOTE, healthz({ critical_prompts_pms: true }), undefined, true).halt).toBe(
      false,
    );
  });

  it('halts when expected is true but deployed is false', () => {
    expect(evaluateDeployGate(REMOTE, healthz({ critical_prompts_pms: false }), undefined, true).halt).toBe(
      true,
    );
  });

  it('tolerates an absent field (no halt) for backwards-compat', () => {
    // healthz() omits critical_prompts_pms entirely.
    expect(evaluateDeployGate(REMOTE, healthz(), undefined, false).halt).toBe(false);
    expect(evaluateDeployGate(REMOTE, healthz(), undefined, true).halt).toBe(false);
  });

  it('localhost skips the gate even on a mismatch', () => {
    expect(
      evaluateDeployGate(
        'http://localhost:3000',
        healthz({ critical_prompts_pms: true }),
        undefined,
        false,
      ).halt,
    ).toBe(false);
  });

  it('stale-deploy override bypasses the halt', () => {
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
    expect(evaluateDeployGate(REMOTE, healthz({ critical_prompts_pms: true }), undefined, false).halt).toBe(
      false,
    );
  });
});
