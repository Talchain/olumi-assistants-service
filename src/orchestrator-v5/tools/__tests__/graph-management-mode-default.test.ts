/**
 * ROADMAP 2.474 / AMENDMENT A10 — `CEE_GRAPH_MANAGEMENT_MODE` ships ON.
 *
 * Why this is a TEST and not just a changed literal: the whole trust story of
 * the Graph Management design — every hold, every confirm chip, the resume
 * path's re-referee — exists only while the mode resolves to 'live', and the
 * resume path re-reads the mode AT RESUME TIME. While the repo default was
 * 'off' and staging supplied 'live' through the Render dashboard, one env
 * reset silently bypassed every consent hold (ARCH-REVIEW-2 S2S3 R-7) and
 * nothing in the codebase would have noticed. Under the no-env-var-gates and
 * no-dark-launches doctrine the capability ships ON, rollback is a code
 * revert, and the default is pinned here so a future "tidy the flags" pass
 * cannot quietly reinstate the hazard.
 *
 * Trap 18 rider, stated rather than assumed: this pins the REPO DEFAULT, which
 * is a claim about this codebase. It is NOT a claim about what any deployed
 * environment serves — that lives in the Render dashboard and is only knowable
 * from the Render API or a live behavioural witness.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

async function freshConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const mod = await import('../../../config/index.js');
  return mod.config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('A10 — the referee ships live by default', () => {
  it('with the env var UNSET, a staging boot resolves graphManagementMode to "live"', async () => {
    const config = await freshConfig({ NODE_ENV: 'test', CEE_ENV: 'staging' });
    expect(config.features.graphManagementMode).toBe('live');
  });

  it('with the env var EMPTY (the "set but blank" shape), it still resolves to "live"', async () => {
    const config = await freshConfig({
      NODE_ENV: 'test',
      CEE_ENV: 'staging',
      CEE_GRAPH_MANAGEMENT_MODE: '',
    });
    expect(config.features.graphManagementMode).toBe('live');
  });

  it('THE KILL-SWITCH SURVIVES — an explicit "shadow" still wins over the new default', async () => {
    // A default that could not be overridden would be a worse gate than the
    // one it replaced. Rollback is a code revert; this is the operational
    // brake, and it must still work.
    const config = await freshConfig({
      NODE_ENV: 'test',
      CEE_ENV: 'staging',
      CEE_GRAPH_MANAGEMENT_MODE: 'shadow',
    });
    expect(config.features.graphManagementMode).toBe('shadow');
  });

  it('an explicit "off" still wins', async () => {
    const config = await freshConfig({
      NODE_ENV: 'test',
      CEE_ENV: 'staging',
      CEE_GRAPH_MANAGEMENT_MODE: 'off',
    });
    expect(config.features.graphManagementMode).toBe('off');
  });

  it('THE PRODUCTION LOCKDOWN IS UNCHANGED — an unconfigured prod boot resolves to "shadow", never "live"', async () => {
    // The stated consequence of the new default, asserted rather than
    // discovered: prod used to resolve 'off' (no referee calls) and now
    // resolves 'shadow' (referee evaluates, emits telemetry, never blocks).
    // Shadow cannot change an outcome by construction — that is the mode's
    // definition — so this is added observability, not a prod behaviour change.
    const config = await freshConfig({ NODE_ENV: 'production', CEE_ENV: 'prod' });
    expect(config.features.graphManagementMode).toBe('shadow');
  });
});
